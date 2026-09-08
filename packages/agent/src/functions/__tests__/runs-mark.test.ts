import {
  FunctionScopeSchema,
  STANDING_APPROVAL_SCOPE,
  asRunId,
} from '@vostride/agent-qa-schema'
import type {
  FeedbackPort,
  FunctionCaller,
  MarkReceipt,
  RunsMarkInput,
  RunsMarkOutcome,
} from '@vostride/agent-qa-schema'
import { describe, expect, it, vi } from 'vitest'

import { FunctionDeniedError, FunctionNotBoundError, FunctionScopeError, invokeFunction } from '../invoke.js'
import { RUNS_MARK_FUNCTION_ID, runsMarkSpec } from '../ops/runs-mark.js'
import { createFunctionRegistry } from '../registry.js'
import type { FunctionDeps } from '../spec.js'

const RUN_ID = asRunId('run-alpha')
const INPUT: RunsMarkInput = { runId: RUN_ID, kind: 'false-fail', note: 'private note' }
const CALLER: FunctionCaller = {
  surface: 'mcp',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'agent',
}
const TRUSTED: FunctionCaller = { ...CALLER, credential: { scope: STANDING_APPROVAL_SCOPE } }

function receipt(overrides: Partial<MarkReceipt> = {}): MarkReceipt {
  return {
    schemaVersion: 1,
    markId: 'mark_0123456789ab',
    runId: RUN_ID,
    runSlug: 'run-alpha',
    testIndex: 0,
    kind: 'false-fail',
    origin: 'user',
    ordinal: 1,
    markedAt: 0,
    note: INPUT.note,
    disposition: { kind: 'quarantined', class: 'flake' },
    gold: [],
    evidence: { confirmed: 0, overturned: 0 },
    ...overrides,
  }
}

function deps(feedback?: FeedbackPort): FunctionDeps {
  return {
    runs: {
      list: async () => [], get: async () => undefined, readEvents: async () => [],
      readStepEvidence: async () => ({ kind: 'run-not-recorded' }),
    },
    knowledge: {
      listBundles: async () => [], inspectRecords: async () => [], diffSince: async () => [],
      showRecord: async ({ recordId }) => ({ kind: 'not-found', schemaVersion: 1, recordId }),
    },
    entities: { resolve: async () => ({ kind: 'none', reason: 'no-match' }), get: async () => undefined },
    config: { getMasked: async () => ({ schemaVersion: 1, configPath: 'agent-qa.config.yaml', entries: [] }) },
    ...(feedback === undefined ? {} : { feedback }),
  }
}

function host(feedback?: FeedbackPort) {
  return createFunctionRegistry({
    deps: deps(feedback),
    resolveExecutionContext: () => 'local-headless',
    auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
  })
}

function stub() {
  const outcome: RunsMarkOutcome = { kind: 'marked', receipt: receipt() }
  const mark = vi.fn(async (_input: RunsMarkInput) => outcome)
  const port: FeedbackPort = { mark, marksFor: async () => [] }
  return { port, mark, outcome }
}

describe('runs.mark registration and binding (419 GATE3-01)', () => {
  it('declares the lowercase-dot identity, write scope, shared risk and feedback binding', () => {
    expect(RUNS_MARK_FUNCTION_ID).toBe('runs.mark')
    expect(RUNS_MARK_FUNCTION_ID).toMatch(/^[a-z]+(?:\.[a-z]+)+$/)
    expect(runsMarkSpec.id).toBe(RUNS_MARK_FUNCTION_ID)
    expect(runsMarkSpec.requiredScopes).toEqual(['knowledge-write'])
    expect(runsMarkSpec.risk.declaredTier).toBe('mutating-shared')
    expect(runsMarkSpec.risk.readOnly).toBe(false)
    expect(runsMarkSpec.requiresHumanOrigin).toBeUndefined()
    expect(runsMarkSpec.boundThrough).toBe('feedback')
  })

  it('lists an unbound host by name and refuses through the registry and body', async () => {
    const registry = host()
    expect(registry.list(CALLER).find(({ id }) => id === RUNS_MARK_FUNCTION_ID)?.bindingStatus).toBe('unbound')
    // The gate precedes binding checks: an authorized caller can observe the named absence.
    await expect(invokeFunction(registry, RUNS_MARK_FUNCTION_ID, INPUT, TRUSTED)).rejects.toBeInstanceOf(FunctionNotBoundError)
    await expect(runsMarkSpec.invoke(INPUT, {} as FunctionDeps)).rejects.toBeInstanceOf(FunctionNotBoundError)
  })

  it('forwards the complete false-fail input and returns the port outcome unchanged', async () => {
    const { port, mark, outcome } = stub()
    expect(await runsMarkSpec.invoke(INPUT, deps(port))).toBe(outcome)
    expect(await invokeFunction(host(port), RUNS_MARK_FUNCTION_ID, INPUT, TRUSTED)).toEqual(outcome)
    expect(mark.mock.calls).toEqual([[INPUT], [INPUT]])
  })

  it('requires knowledge-write even when the caller holds a standing credential', async () => {
    const { port, mark } = stub()
    await expect(invokeFunction(host(port), RUNS_MARK_FUNCTION_ID, INPUT, { ...TRUSTED, grantedScopes: ['read'] }))
      .rejects.toBeInstanceOf(FunctionScopeError)
    expect(mark).not.toHaveBeenCalled()
  })
})

describe('no-TTY gate on the actual mark op (419 D-13/D-20)', () => {
  it('refuses an uncredentialed MCP agent with all three actionable remedy kinds', async () => {
    const { port, mark } = stub()
    const error = await invokeFunction(host(port), RUNS_MARK_FUNCTION_ID, INPUT, CALLER).catch(error => error)
    expect(error).toBeInstanceOf(FunctionDeniedError)
    expect((error as FunctionDeniedError).remedies.map(remedy => remedy.kind)).toEqual([
      'answer-confirm', 'trust-session-flag', 'present-bearer-scope',
    ])
    expect(mark).not.toHaveBeenCalled()
  })

  it('lets the same MCP agent reach the port once with the exact standing scope', async () => {
    const { port, mark, outcome } = stub()
    expect(await invokeFunction(host(port), RUNS_MARK_FUNCTION_ID, INPUT, TRUSTED)).toEqual(outcome)
    expect(mark.mock.calls).toEqual([[INPUT]])
  })

  it('denies a mismatched credential without reaching the port', async () => {
    const { port, mark } = stub()
    await expect(invokeFunction(host(port), RUNS_MARK_FUNCTION_ID, INPUT, {
      ...CALLER, credential: { scope: { project: 'another-workspace' } },
    })).rejects.toBeInstanceOf(FunctionDeniedError)
    expect(mark).not.toHaveBeenCalled()
  })
})

describe('mark outcome classifications omit producer text', () => {
  it.each<RunsMarkOutcome>([
    { kind: 'run-not-found', runId: RUN_ID },
    { kind: 'member-not-found', runId: RUN_ID, testId: 'private member name' },
    { kind: 'step-not-found', runId: RUN_ID, testIndex: 0, stepIndex: 9, stepCount: 3 },
    { kind: 'ambiguous-address', runId: RUN_ID, candidates: [{ testIndex: 0 }, { testIndex: 1 }] },
  ])('classifies $kind as refused', output => {
    expect(runsMarkSpec.classify!(output).status).toBe('refused')
    expect(runsMarkSpec.classify!(output).outcome).not.toContain('private')
  })

  it('classifies new and identical marks as executed without including the note', () => {
    expect(runsMarkSpec.classify!({ kind: 'marked', receipt: receipt() })).toEqual({
      status: 'executed', outcome: 'marked false-fail · quarantined',
    })
    expect(runsMarkSpec.classify!({ kind: 'already-marked', receipt: receipt() })).toEqual({
      status: 'executed', outcome: 'already marked: identical repeat, prior receipt returned',
    })
  })
})
