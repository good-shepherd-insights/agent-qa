// `authoring.funnel.get` at the function layer (394-07, D-12/D-13 · WTST-05).
//
// WHAT THESE CASES PIN, AND WHY EACH ONE:
//
//  1. THE TIER IS THE ENFORCEMENT, STATED ON THE SPEC. `['read']` and `readOnly: true` are what
//     make this op safe-mode-visible and gate-cheap, and they are also the claim a reviewer
//     objects to if per-session authoring history behind `read` is the wrong call (T-394-26). A
//     comment saying "this is read-only" is worth nothing; the descriptor is what the gate reads.
//  2. REFUSAL BY NAME, AT BOTH LAYERS. `invokeFunction` refuses on the DECLARATION, and the op
//     body guards too, so a direct in-layer call cannot slip past. An unbound host answering an
//     all-zero funnel would say "this session authored nothing" about a store it has never been
//     able to read — and worse, a zero funnel reads as a loop that filtered EVERYTHING, which is
//     the one wrong answer that flatters the thing this measurement exists to keep honest.
//  3. THE OP DERIVES NOTHING. Its answer must deep-equal `computeAuthoringFunnel` over the same
//     receipts. A second computation anywhere would be a second answer to the question the
//     one-read-op law exists to make singular.

import { FunctionScopeSchema, computeAuthoringFunnel } from '@vostride/agent-qa-schema'
import type {
  AuthoringFunnel,
  DraftReceipt,
  FunctionCaller,
} from '@vostride/agent-qa-schema'
import { DraftReceiptSchema } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { FunctionNotBoundError, invokeFunction } from '../invoke.js'
import { createFunctionRegistry } from '../registry.js'
import {
  AUTHORING_FUNNEL_GET_FUNCTION_ID,
  authoringFunnelGetSpec,
} from '../ops/authoring-funnel-get.js'
import type { AuthoringFunnelPortLike } from '../../authoring/funnel.js'
import type { FunctionDeps } from '../spec.js'

const CALLER: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'agent',
}

function receipt(digest: string, sessionRef?: string): DraftReceipt {
  return DraftReceiptSchema.parse({
    schemaVersion: 1,
    draftRef: {
      filePath: `tests/.agent-qa-drafts/${digest}.yaml`,
      testId: `t_${digest}`,
      testName: `draft ${digest}`,
      contentDigest: digest,
    },
    gates: {
      executesDefinitive: { pass: true, runRefs: ['run-1'], indefinitiveRunRefs: [] },
      stableVerdict: {
        pass: true,
        runRefs: ['run-1'],
        distinctOutcomes: ['passed'],
        earlyStopped: false,
      },
      addsValue: { pass: true, novelElementCount: 1, comparedTestCount: 1 },
      falsifiableAssertion: { pass: true, assertionStepCount: 1, falsifiableAssertionCount: 1 },
    },
    stepTable: [],
    gateRuns: [{ runId: 'run-1', memberOutcome: 'passed', definitive: true, healed: false }],
    addsValueFinding: { novelElements: ['el:button:Save'], comparedTests: [] },
    stabilityRunsRequested: 3,
    stabilityRunsCompleted: 3,
    disposition: 'keep-eligible',
    evaluatedAt: 1_700_000_000_000,
    ...(sessionRef === undefined ? {} : { sessionRef }),
  })
}

/** 12 receipts — above the floor of 10. 2026-10-01 (432-17): no acceptance is recorded for any. */
const RECEIPTS = Array.from({ length: 12 }, (_unused, index) => receipt(`d${index}`, 'sess-alpha'))

function funnelPort(): AuthoringFunnelPortLike {
  return {
    receipts: { async list() { return [...RECEIPTS] } },
  }
}

function deps(authoringFunnel?: AuthoringFunnelPortLike): FunctionDeps {
  return {
    runs: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    knowledge: {
      listBundles: () => Promise.resolve([]),
      inspectRecords: () => Promise.resolve([]),
      diffSince: () => Promise.resolve([]),
      showRecord: ({ recordId }) =>
        Promise.resolve({ kind: 'not-found', schemaVersion: 1, recordId } as const),
    },
    entities: {
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: () => Promise.resolve(undefined),
    },
    config: {
      getMasked: () => Promise.resolve({
        schemaVersion: 1,
        configPath: 'agent-qa.config.yaml',
        entries: [],
      }),
    },
    ...(authoringFunnel === undefined ? {} : { authoringFunnel }),
  }
}

function registryWith(authoringFunnel?: AuthoringFunnelPortLike) {
  return createFunctionRegistry({
    deps: deps(authoringFunnel),
    resolveExecutionContext: () => 'local-headless',
    auditSink: { appendGuardrailAudit() {} },
  })
}

describe(`${AUTHORING_FUNNEL_GET_FUNCTION_ID} — the honesty funnel's one read`, () => {
  it('declares `read` alone and a read-only risk descriptor', () => {
    expect(authoringFunnelGetSpec.id).toBe('authoring.funnel.get')
    expect([...authoringFunnelGetSpec.requiredScopes]).toEqual(['read'])
    expect(authoringFunnelGetSpec.risk.readOnly).toBe(true)
    expect(authoringFunnelGetSpec.risk.recognized).toBe(true)
    expect(authoringFunnelGetSpec.boundThrough).toBe('authoringFunnel')
  })

  it('refuses BY NAME from an unbound composition — never an all-zero funnel', async () => {
    await expect(invokeFunction(
      registryWith(),
      AUTHORING_FUNNEL_GET_FUNCTION_ID,
      { window: { scope: 'all-time' } },
      CALLER,
    )).rejects.toThrow(FunctionNotBoundError)

    await expect(invokeFunction(
      registryWith(),
      AUTHORING_FUNNEL_GET_FUNCTION_ID,
      { window: { scope: 'all-time' } },
      CALLER,
    )).rejects.toThrow(AUTHORING_FUNNEL_GET_FUNCTION_ID)
  })

  it('refuses BY NAME on a DIRECT in-layer call too, past the declaration check', async () => {
    await expect(authoringFunnelGetSpec.invoke(
      { window: { scope: 'all-time' } },
      deps(),
    )).rejects.toThrow(FunctionNotBoundError)
  })

  it('answers exactly `computeAuthoringFunnel` over the same receipts — it derives nothing', async () => {
    const answered = await invokeFunction(
      registryWith(funnelPort()),
      AUTHORING_FUNNEL_GET_FUNCTION_ID,
      { window: { scope: 'all-time' } },
      CALLER,
    ) as AuthoringFunnel

    const expected = computeAuthoringFunnel({ receipts: RECEIPTS, acceptances: [], sideCounters: {} })

    expect(answered).toEqual(expected)
  })

  it('answers no acceptance and no ACCEPTANCE FAILURE through the op, since nothing records one', async () => {
    // RE-SPELLED 2026-10-01 (432-17, D-06): this cell drove 11 applied test-draft envelopes through
    // the op to raise the flag. A draft a keep-gate did not reject is written in its own call and
    // the inbox the decisions lived in is deleted, so the op counts no acceptance over a population
    // above the floor. The flag's own arithmetic stays pinned on `computeAuthoringFunnel` in schema.
    const answered = await invokeFunction(
      registryWith(funnelPort()),
      AUTHORING_FUNNEL_GET_FUNCTION_ID,
      { window: { scope: 'all-time' } },
      CALLER,
    ) as AuthoringFunnel

    expect(answered.stages).toEqual({
      built: 12,
      passedStably: 12,
      addedValue: 12,
      accepted: 0,
    })
    expect(answered.acceptanceFailure).toBe(false)
    expect(answered.line).not.toContain('ACCEPTANCE FAILURE')
  })

  it('scopes by session through the op, excluding a receipt with no ref', async () => {
    const port: AuthoringFunnelPortLike = {
      receipts: {
        async list() {
          return [receipt('with', 'sess-alpha'), receipt('without'), receipt('other', 'sess-beta')]
        },
      },
    }

    const answered = await invokeFunction(
      registryWith(port),
      AUTHORING_FUNNEL_GET_FUNCTION_ID,
      { window: { scope: 'session', sessionRef: 'sess-alpha' } },
      CALLER,
    ) as AuthoringFunnel

    expect(answered.stages.built).toBe(1)
  })

  it('refuses an input carrying anything but the window', async () => {
    await expect(invokeFunction(
      registryWith(funnelPort()),
      AUTHORING_FUNNEL_GET_FUNCTION_ID,
      { window: { scope: 'all-time' }, product: 'shop' },
      CALLER,
    )).rejects.toThrow()
  })
})
