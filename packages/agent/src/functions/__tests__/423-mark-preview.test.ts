// 2026-09-15, 423 D-16/D-17: the exact-input consequence preview contract over feedbackReads.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMaskingContext, setActiveMaskingContextResolver } from '@vostride/agent-qa-safety'
import * as schema from '@vostride/agent-qa-schema'
import { RunsMarkInputSchema, RunsMarkOutcomeSchema, asRunId, maskedMarker } from '@vostride/agent-qa-schema'
import type { FunctionCaller, RunsMarkInput } from '@vostride/agent-qa-schema'
import type { z } from 'zod'
import { invokeFunction } from '../invoke.js'
import { runsMarkSpec } from '../ops/runs-mark.js'
import { createRegistryFromSpecs } from '../registry.js'
import * as spec from '../spec.js'
import type { FunctionDeps, FunctionSpec } from '../spec.js'

type PreviewModule = { runsMarkPreviewSpec?: FunctionSpec; RUNS_MARK_PREVIEW_FUNCTION_ID?: string }
let previewModule: PreviewModule = {}
beforeEach(async () => {
  previewModule = await import('../ops/runs-mark-preview.js').catch(() => ({})) as PreviewModule
})

function previewSpec(): FunctionSpec {
  expect(typeof previewModule.runsMarkPreviewSpec, 'ops/runs-mark-preview must export runsMarkPreviewSpec').toBe('object')
  return previewModule.runsMarkPreviewSpec!
}
function resultSchema(): z.ZodType {
  const found = (schema as Record<string, unknown>).RunsMarkPreviewResultSchema
  expect(typeof found, 'the schema root must export RunsMarkPreviewResultSchema').toBe('object')
  return found as z.ZodType
}

const runId = asRunId('run-423-mark-preview')
const member = { testIndex: 1, testId: 'checkout' }
const input: RunsMarkInput = { runId, testId: 'checkout', kind: 'false-fail', note: 'should have passed' }

function consequences(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'consequences', runId, prospective: true, markKind: 'false-fail', member,
    resolvedStep: { stepIndex: 2, reason: 'failing-step' },
    markedDecisionCount: 1,
    groundTruth: [{ testIndex: 1, stepIndex: 2, verdict: 'pass',
      recordedVerdict: { pass: false, reasoning: 'banner missing' }, correctedAction: false }],
    labels: [{ testIndex: 1, stepIndex: 2, decisionOrdinal: 0, sourceCassetteId: 'leaf-1-2-0', channel: 'user-mark',
      correction: { verdict: 'pass' } }],
    knowledge: { servedRecordIds: ['record-a'], appendsEvidence: true },
    draft: { kind: 'knowledge', fix: 'fact', target: { grain: 'record', recordId: 'record-a' } },
    latest: { kind: 'first' },
    basis: { ledgerOrdinal: 0 },
    ...overrides,
  }
}

const SUPERSEDING = {
  latest: { kind: 'supersedes', markId: 'mark_00000000000a', ordinal: 3 },
  basis: { ledgerOrdinal: 4, priorMarkOrdinal: 3 },
  withdraws: { proposalId: 'proposal-prior', proposalKind: 'knowledge' },
}

const quarantined = (overrides: Record<string, unknown> = {}) => ({
  kind: 'quarantined', runId, prospective: true, markKind: 'false-fail', member, class: 'flake',
  resolvedStep: { stepIndex: 0, reason: 'failing-step' }, latest: { kind: 'first' }, basis: { ledgerOrdinal: 2 },
  ...overrides,
})

const alreadyMarked = (overrides: Record<string, unknown> = {}) => ({
  kind: 'already-marked', runId,
  prior: { markId: 'mark_00000000000a', ordinal: 3, kind: 'false-fail', testIndex: 1, testId: 'checkout',
    disposition: { kind: 'quarantined', class: 'flake' } },
  basis: { ledgerOrdinal: 4, priorMarkOrdinal: 3 },
  ...overrides,
})

// Hand-spelled from runs.mark's outcome union: the preview answers with exactly these refusal objects.
const REFUSALS = [
  { kind: 'run-not-found', runId },
  { kind: 'member-not-found', runId, testId: 'checkout' },
  { kind: 'step-not-found', runId, testIndex: 1, stepIndex: 9, stepCount: 3 },
  { kind: 'ambiguous-address', runId, candidates: [{ testIndex: 0, testId: 'checkout' }, { testIndex: 1, testId: 'checkout' }] },
  { kind: 'ambiguous-correction', runId, testIndex: 1, decisionCount: 2 },
] as const

function port(answer: unknown) {
  return { history: vi.fn(async () => { throw new Error('preview must not read history') }),
    preview: vi.fn(async (_input: RunsMarkInput) => answer) }
}

function deps(feedbackReads?: object) {
  const forbidden = vi.fn(() => { throw new Error('preview must not touch runs, config or the mark writer') })
  return {
    forbidden,
    deps: {
      runs: { list: forbidden, get: forbidden, readEvents: forbidden, readStepEvidence: forbidden },
      knowledge: { listBundles: forbidden, inspectRecords: forbidden, diffSince: forbidden, showRecord: forbidden },
      entities: { resolve: forbidden, get: forbidden },
      config: { getMasked: forbidden },
      feedback: { mark: forbidden, marksFor: forbidden },
      ...(feedbackReads === undefined ? {} : { feedbackReads }),
    } as unknown as FunctionDeps,
  }
}

async function previewOf(answer: unknown, raw: unknown = input) {
  const reads = port(answer)
  const { deps: bound, forbidden } = deps(reads)
  const result = await previewSpec().invoke(raw, bound) as Record<string, unknown>
  expect(forbidden).not.toHaveBeenCalled()
  expect(reads.history).not.toHaveBeenCalled()
  return { result, reads }
}

beforeEach(() => setActiveMaskingContextResolver(() => createMaskingContext()))
afterEach(() => setActiveMaskingContextResolver(() => undefined))

describe('423-37 runs.mark.preview contract (D-16/D-17)', () => {
  it('PREVIEW-INPUT-IDENTICAL: the preview input is RunsMarkInputSchema itself and runs.mark gains no preview field', async () => {
    const op = previewSpec()
    expect(op.id).toBe('runs.mark.preview')
    expect(previewModule.RUNS_MARK_PREVIEW_FUNCTION_ID).toBe('runs.mark.preview')
    expect(op.input).toBe(RunsMarkInputSchema)
    expect(op.input).toBe(runsMarkSpec.input)

    // runs.mark's own contract is unchanged: exact input keys and exact outcome arms, no preview token.
    expect(Object.keys(RunsMarkInputSchema.shape)).toEqual(
      ['runId', 'testId', 'stepIndex', 'kind', 'note', 'correctedExpectation', 'correctedAction'])
    expect(RunsMarkOutcomeSchema.options.map(option => option.shape.kind.value)).toEqual(
      ['marked', 'already-marked', 'run-not-found', 'member-not-found', 'step-not-found', 'ambiguous-address', 'ambiguous-correction'])
    for (const option of RunsMarkOutcomeSchema.options) {
      expect(Object.keys(option.shape).filter(key => /preview|basis|token|prospective/i.test(key))).toEqual([])
    }
    expect(runsMarkSpec.output).toBe(RunsMarkOutcomeSchema)

    const full: RunsMarkInput = { runId, testId: 'checkout', stepIndex: 2, kind: 'false-pass', note: 'n',
      correctedExpectation: 'the banner reads saved' }
    const { reads } = await previewOf(consequences({ markKind: 'false-pass' }), full)
    expect(reads.preview).toHaveBeenCalledTimes(1)
    expect(reads.preview.mock.calls[0]![0]).toEqual(RunsMarkInputSchema.parse(full))

    const refused = port(consequences())
    await expect(previewSpec().invoke({ ...input, previewToken: 'basis-3' }, deps(refused).deps)).rejects.toThrow()
    await expect(previewSpec().invoke({ ...input, basis: { priorMarkOrdinal: 3 } }, deps(refused).deps)).rejects.toThrow()
    expect(refused.preview).not.toHaveBeenCalled()
  })

  it('PREVIEW-REFUSAL-PARITY: every runs.mark refusal arm is the preview arm, with the same parse and classification', async () => {
    const byKind = new Map(RunsMarkOutcomeSchema.options.map(option => [option.shape.kind.value, option]))
    const previewOptions = (resultSchema() as unknown as { options: { shape: { kind: { value: string } } }[] }).options
    for (const refusal of REFUSALS) {
      expect(previewOptions.find(option => option.shape.kind.value === refusal.kind)).toBe(byKind.get(refusal.kind))
      const { result } = await previewOf(refusal)
      expect(result).toEqual(refusal)
      expect(RunsMarkOutcomeSchema.parse(result)).toEqual(result)
      expect(resultSchema().parse(result)).toEqual(result)
      expect(previewSpec().classify(result as never)).toEqual(runsMarkSpec.classify(refusal as never))
      expect(previewSpec().classify(result as never).status).toBe('refused')
    }
    // The writer's success arm is never a preview answer.
    expect(previewOptions.map(option => option.shape.kind.value)).not.toContain('marked')
    expect(resultSchema().safeParse({ kind: 'marked', receipt: {} }).success).toBe(false)
  })

  it('PREVIEW-BASIS: the prior mark ordinal is reported when present and must agree with latest-mark-wins', async () => {
    const first = await previewOf(consequences())
    expect(first.result.basis).toEqual({ ledgerOrdinal: 0 })
    expect(first.result.latest).toEqual({ kind: 'first' })

    const superseding = await previewOf(consequences(SUPERSEDING))
    expect(superseding.result.basis).toEqual({ ledgerOrdinal: 4, priorMarkOrdinal: 3 })
    expect(superseding.result.latest).toEqual({ kind: 'supersedes', markId: 'mark_00000000000a', ordinal: 3 })
    expect(superseding.result.withdraws).toEqual({ proposalId: 'proposal-prior', proposalKind: 'knowledge' })

    const repeat = await previewOf(alreadyMarked())
    expect(repeat.result).toEqual(alreadyMarked())
    expect((await previewOf(quarantined())).result.basis).toEqual({ ledgerOrdinal: 2 })

    const parse = (value: unknown) => resultSchema().safeParse(value).success
    expect(parse(consequences({ latest: SUPERSEDING.latest }))).toBe(false)
    expect(parse(consequences({ basis: SUPERSEDING.basis }))).toBe(false)
    expect(parse(consequences({ ...SUPERSEDING, basis: { ledgerOrdinal: 4, priorMarkOrdinal: 2 } }))).toBe(false)
    expect(parse(consequences({ ...SUPERSEDING, basis: { ledgerOrdinal: 2, priorMarkOrdinal: 3 } }))).toBe(false)
    expect(parse(consequences({ basis: { ledgerOrdinal: 0, priorMarkOrdinal: 0 } }))).toBe(false)
    expect(parse(consequences({ withdraws: SUPERSEDING.withdraws }))).toBe(false)
    expect(parse(quarantined({ basis: { ledgerOrdinal: 2, priorMarkOrdinal: 1 } }))).toBe(false)
    expect(parse(alreadyMarked({ basis: { ledgerOrdinal: 4 } }))).toBe(false)
    expect(parse(alreadyMarked({ basis: { ledgerOrdinal: 4, priorMarkOrdinal: 2 } }))).toBe(false)
    expect(parse(consequences({ basis: { ledgerOrdinal: 0, previewToken: 'x' } }))).toBe(false)
  })

  it('PREVIEW-PROSPECTIVE: a read-tier op that reports what runs.mark would do, never a write, receipt or minted id', async () => {
    const op = previewSpec()
    expect(op.requiredScopes).toEqual(['read'])
    expect(op.resultKind).toBe('unary')
    expect(op.risk).toEqual({ name: 'fn:runs.mark.preview', recognized: true, readOnly: true })
    expect(op.requiresHumanOrigin).toBeUndefined()
    expect(op.boundThrough).toBe('feedbackReads')

    const falsePass = consequences({ markKind: 'false-pass', resolvedStep: { stepIndex: 2, reason: 'passing-verdict' },
      groundTruth: [{ testIndex: 1, stepIndex: 2, verdict: 'fail', recordedVerdict: { pass: true, reasoning: 'looked fine' },
        correctedAction: false }],
      labels: [
        { testIndex: 1, stepIndex: 2, decisionOrdinal: 0, sourceCassetteId: 'leaf-1-2-0', channel: 'user-mark', correction: { verdict: 'fail' } },
        { testIndex: 1, stepIndex: 2, decisionOrdinal: 0, sourceCassetteId: 'leaf-1-2-0', channel: 'overturned-verdict', correction: { verdict: 'fail' } },
      ],
      draft: { kind: 'no-draftable-fix', checked: { servedRecords: 0, procedureReads: 0, assertionDrift: true } } })
    for (const answer of [consequences(), consequences(SUPERSEDING), falsePass, quarantined(),
      consequences({ markKind: 'confirmed-bug', draft: { kind: 'confirmed-bug' } }),
      consequences({ draft: { kind: 'test-edit', testRef: 'tests/checkout.yaml::checkout' } })]) {
      const { result } = await previewOf(answer)
      expect(result.prospective).toBe(true)
      expect(resultSchema().parse(result)).toEqual(result)
      const wire = JSON.stringify(result)
      for (const key of ['"receipt"', '"markedAt"', '"gold"', '"cassetteId"', '"proposalId":"proposal-new']) {
        expect(wire).not.toContain(key)
      }
      const verdict = op.classify(result as never)
      expect(verdict.status).toBe('executed')
      expect(verdict.outcome).toMatch(/^preview: /)
      expect(verdict.outcome).toMatch(/nothing written/)
    }
    const parse = (value: unknown) => resultSchema().safeParse(value).success
    expect(parse(consequences({ prospective: false }))).toBe(false)
    expect(parse(consequences({ markedAt: 1 }))).toBe(false)
    expect(parse(consequences({ receipt: {} }))).toBe(false)
    expect(parse(consequences({ draft: { kind: 'confirmed-bug' } }))).toBe(false)
    expect(parse(consequences({ markKind: 'confirmed-bug' }))).toBe(false)
    expect(parse({ ...falsePass, markKind: 'false-fail' })).toBe(false)
    expect(parse(consequences({ member: { testIndex: 0 } }))).toBe(false)

    const secret = 'synthetic-sensitive-token'
    const masking = createMaskingContext()
    masking.register(secret)
    setActiveMaskingContextResolver(() => masking)
    const sensitive = consequences({ groundTruth: [{ testIndex: 1, stepIndex: 2, verdict: 'pass',
      recordedVerdict: { pass: false, reasoning: `reasoning ${secret}` }, correctedExpectation: `expect ${secret}`,
      correctedAction: true }] })
    const masked = await previewOf(sensitive)
    expect(JSON.stringify(masked.result)).not.toContain(secret)
    expect(masked.result.groundTruth).toEqual([{ testIndex: 1, stepIndex: 2, verdict: 'pass',
      recordedVerdict: { pass: false, reasoning: masking.mask(`reasoning ${secret}`) },
      correctedExpectation: masking.mask(`expect ${secret}`), correctedAction: true }])
    setActiveMaskingContextResolver(() => undefined)
    const cold = await previewOf(sensitive)
    expect(cold.result.groundTruth).toMatchObject([{ recordedVerdict: { reasoning: maskedMarker('secret') },
      correctedExpectation: maskedMarker('secret') }])

    await expect(previewSpec().invoke(input, deps(port({ kind: 'run-not-found', runId: asRunId('run-other') })).deps))
      .rejects.toThrow(/another run/)

    const reads = port(consequences())
    const { deps: bound, forbidden } = deps(reads)
    const options = { deps: bound, resolveExecutionContext: () => 'local-headless' as const,
      auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} } }
    const caller: FunctionCaller = { surface: 'mcp', grantedScopes: ['read'], safeMode: true, origin: 'agent' }
    const registry = createRegistryFromSpecs([{ ...op }], options)
    expect(registry.list(caller).find(entry => entry.id === 'runs.mark.preview')?.bindingStatus).toBe('bound')
    const viaGate = await invokeFunction(registry, 'runs.mark.preview', input, caller) as Record<string, unknown>
    expect(viaGate.kind).toBe('consequences')
    expect(forbidden).not.toHaveBeenCalled()

    const unbound = createRegistryFromSpecs([{ ...op }], { ...options, deps: deps().deps })
    await expect(invokeFunction(unbound, 'runs.mark.preview', input, caller)).rejects.toBeInstanceOf(spec.FunctionNotBoundError)
    await expect(op.invoke(input, deps({ history: vi.fn() }).deps)).rejects.toBeInstanceOf(spec.FunctionNotBoundError)
  })
})
