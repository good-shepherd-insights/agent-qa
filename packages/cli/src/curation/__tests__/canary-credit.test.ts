import { asRecordId, asRunId, distilledScreenStateDigest, type CompletedRunHandoff, type ScreenState, type StepEvidence } from '@vostride/agent-qa-schema'
import { describe, expect, it, vi } from 'vitest'
import { creditCanaryAttributions, type CanaryAblation, type CanaryAblationResult, type CanaryCreditInput } from '../canary-credit.js'
import type { ProjectedCanaryAttribution } from '../emit-canary-outcomes.js'

const DIGEST = 'c'.repeat(64)
const D = DIGEST
const { makeScreenStateFixture } = await import(new URL(
  '../../../../knowledge-local/src/__tests__/fixtures/bundle-fixture.js', import.meta.url,
).href)
const handoff: CompletedRunHandoff = { schemaVersion: 3, runId: asRunId('run-credit'),
  scope: { tier: 'product', key: 'storefront' }, buildOrdinal: 43,
  executionContext: 'local-interactive', aggregateVerdict: 'passed',
  configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' }, startedAt: 1, endedAt: 2, tests: [] }
function row(candidateId = 'candidate-checkout', runOutcome: 'positive' | 'negative' = 'positive'): Extract<ProjectedCanaryAttribution, { kind: 'outcome' }> {
  return { kind: 'outcome', source: 'served-brief', outcome: {
    candidateId: asRecordId(candidateId), runOutcome, benefit: 'rode-along', stateValidity: 'unknown',
    runId: String(handoff.runId), testId: 'checkout', testIndex: 0, stepIndex: 0,
    buildOrdinal: 43, briefDigest: 'brief', attribution: 'Checkout exercised',
    exercisedAnchor: { t: 'el', role: 'button', name: 'checkout', ordinal: 0 },
  } }
}
function result(crossCheck: 'flipped' | 'held' | 'inconclusive' | 'not-run' = 'flipped'): CanaryAblationResult {
  return { kind: 'ablated', crossCheck, corpusDigest: DIGEST, k: 3, baseSeed: 11,
    seeds: [11, 12, 13], seedHonored: true,
    spend: { modelCalls: 5, screens: 5, promptTokens: 10, completionTokens: 2 }, gate2Dir: '/tmp/gate2' }
}
function capability(value: CanaryAblationResult = result()): CanaryAblation {
  return { ablate: vi.fn(async () => value),
    corpusDigest: vi.fn(async () => ({ kind: 'digest' as const, corpusDigest: DIGEST })) }
}
function credit(attributions: ProjectedCanaryAttribution[], ablation?: CanaryAblation, overrides: Partial<CanaryCreditInput> = {}) {
  return creditCanaryAttributions({ attributions, ablation, handoff, runDir: '/tmp/run',
    knowledgeRoot: '/tmp/knowledge', maxAblations: 4,
    readBundleStateDigests: () => ({ kind: 'not-found' }),
    observationIdOf: () => 'fixture-observation', ...overrides })
}
describe('418 credit pass', () => {
  it('caps two candidates at one attempt and keeps the pass-level corpusDigest: D on excess rows', async () => {
    const ablation = capability()
    const report = await credit([row('a'), row('b')], ablation, { maxAblations: 1 })
    expect(ablation.ablate).toHaveBeenCalledTimes(1)
    expect(report.counters.ablationCapExceeded).toBe(1)
    expect(report.attributions[1]).toMatchObject({ outcome: { benefit: 'rode-along', corpusDigest: D } })
  })
  it('ablates a candidate once per run and counts later matches as ride-along before cap checks', async () => {
    const later = row()
    if (later.kind === 'outcome') later.outcome.stepIndex = 1
    const ablation = capability()
    const report = await credit([row(), later], ablation, { maxAblations: 1 })
    expect(ablation.ablate).toHaveBeenCalledTimes(1)
    expect(report.counters.rideAlongUncredited).toBe(1)
    expect(report.counters.ablationCapExceeded).toBe(0)
    expect(report.attributions[1]).toMatchObject({ outcome: { benefit: 'rode-along' } })
  })
  it('counts a failed attempt against both the per-run cap and the candidate once rule', async () => {
    const ablation = capability({ kind: 'error', message: 'failed attempt' })
    const report = await credit([row('a'), row('a'), row('b')], ablation, { maxAblations: 1 })
    expect(ablation.ablate).toHaveBeenCalledTimes(1)
    expect(report.counters).toMatchObject({ ablationError: 1, rideAlongUncredited: 1, ablationCapExceeded: 1 })
  })
  it.each(['valid', 'stale', 'missing-step', 'not-found', 'empty'] as const)('computes %s snapshot validity for positives and negatives', async (mode) => {
    const state: ScreenState = makeScreenStateFixture()
    const observedStateDigest = distilledScreenStateDigest(state)
    const live: CompletedRunHandoff = { ...handoff, tests: [{
      testId: 'checkout', testIndex: 0, testName: 'Checkout', filePath: 'checkout.yaml', outcome: 'passed',
      steps: mode === 'missing-step' ? [] : [{ stepIndex: 0, subActions: [{ stateBefore: state }] } as StepEvidence],
    }] }
    const readBundleStateDigests = vi.fn<CanaryCreditInput['readBundleStateDigests']>(() => mode === 'not-found'
      ? { kind: 'not-found' } : { kind: 'found', digests: mode === 'empty' ? []
        : [mode === 'stale' ? distilledScreenStateDigest({ ...state, url: '/changed' }) : observedStateDigest] })
    const report = await credit([row('a'), row('b', 'negative')], capability(), { handoff: live, readBundleStateDigests })
    const stateValidity = mode === 'valid' ? 'valid' : mode === 'stale' ? 'stale' : 'unknown'
    expect(report.attributions[1]).toMatchObject({ outcome: { stateValidity, benefit: 'exercised-harmed', corpusDigest: D } })
    for (const attribution of report.attributions) {
      expect(attribution).toMatchObject({ outcome: { stateValidity } })
      if (mode !== 'missing-step') expect(attribution).toMatchObject({ outcome: { observedStateDigest } })
    }
    expect(readBundleStateDigests).toHaveBeenCalledWith({ knowledgeRoot: '/tmp/knowledge', candidateId: 'b' })
  })
  it('a step without sub-action evidence stays unknown', async () => {
    const live: CompletedRunHandoff = { ...handoff, tests: [{
      testId: 'checkout', testIndex: 0, testName: 'Checkout', filePath: 'checkout.yaml', outcome: 'passed',
      steps: [{ stepIndex: 0 } as StepEvidence],
    }] }
    const report = await credit([row()], capability(), { handoff: live,
      readBundleStateDigests: () => ({ kind: 'found', digests: [D] }) })
    expect(report.attributions[0]).toMatchObject({ outcome: { stateValidity: 'unknown' } })
    if (report.attributions[0]?.kind === 'outcome') expect(report.attributions[0].outcome).not.toHaveProperty('observedStateDigest')
  })
  it('no-eval-root puts no digest on positives, negatives, duplicates or cap-exceeded rows', async () => {
    const ablation = capability({ kind: 'no-eval-root' })
    ablation.corpusDigest = vi.fn(async () => ({ kind: 'no-eval-root' as const }))
    const report = await credit([row('a'), row('a'), row('b'), row('c', 'negative')], ablation, { maxAblations: 1 })
    for (const attribution of report.attributions) {
      if (attribution.kind === 'outcome') expect(attribution.outcome).not.toHaveProperty('corpusDigest')
    }
    expect(ablation.corpusDigest).toHaveBeenCalledTimes(1)
  })
  it('rejects an invalid cap before any corpus read or ablation', async () => {
    const ablation = capability()
    await expect(credit([row()], ablation, { maxAblations: 0 })).rejects.toThrow('positive integer')
    expect(ablation.corpusDigest).not.toHaveBeenCalled()
    expect(ablation.ablate).not.toHaveBeenCalled()
  })
  it('flipped copies the ablation evidence and its own digest', async () => {
    const ablation = capability()
    ablation.corpusDigest = async () => ({ kind: 'digest', corpusDigest: 'd'.repeat(64) })
    const report = await credit([row()], ablation)
    expect(report.counters.credited).toBe(1)
    expect(report.attributions[0]).toMatchObject({ crossCheck: 'flipped', corpusDigestMoved: true, outcome: {
      benefit: 'exercised-benefited', stateValidity: 'unknown', corpusDigest: DIGEST,
      ablation: { crossCheck: 'flipped', k: 3, baseSeed: 11, seeds: [11, 12, 13],
        seedHonored: true, spend: { modelCalls: 5, screens: 5, promptTokens: 10, completionTokens: 2 } },
    } })
  })
  it.each([
    [result('held'), 'ablationHeld'], [result('inconclusive'), 'ablationInconclusive'],
    [result('not-run'), 'ablationInconclusive'], [{ kind: 'no-eval-root' }, 'rideAlongUncredited'],
    [{ kind: 'unavailable', reason: 'missing target' }, 'ablationInconclusive'],
    [{ kind: 'error', message: 'failed replay' }, 'ablationError'],
  ] as const)('degrades %j under %s', async (value, counter) => {
    const report = await credit([row()], capability(value))
    expect(report.counters[counter]).toBe(1)
    expect(report.counters.credited).toBe(0)
    expect(report.attributions[0]).toMatchObject({ outcome: { benefit: 'rode-along', stateValidity: 'unknown' } })
  })
  it('procedure-source positives never ablate or read corpusDigest()', async () => {
    const ablation = capability()
    const report = await credit([{ ...row(), source: 'procedure-replay' }], ablation)
    expect(report.counters.rideAlongUncredited).toBe(1)
    expect(ablation.ablate).not.toHaveBeenCalled()
    expect(ablation.corpusDigest).not.toHaveBeenCalled()
    expect(report.attributions[0]).toMatchObject({ outcome: { benefit: 'rode-along' } })
  })
  it('negative rows cite corpusDigest() once per pass without replaying', async () => {
    const ablation = capability()
    const report = await credit([row('a', 'negative'), row('b', 'negative'), row('c', 'negative')], ablation)
    expect(ablation.corpusDigest).toHaveBeenCalledTimes(1)
    expect(ablation.ablate).not.toHaveBeenCalled()
    for (const attribution of report.attributions) expect(attribution).toMatchObject({
      outcome: { benefit: 'exercised-harmed', corpusDigest: DIGEST },
    })
  })
  it.each(['absent', 'no-eval-root', 'unavailable', 'rejected'] as const)('negative has no invented digest when %s', async mode => {
    const ablation = capability()
    ablation.corpusDigest = async () => {
      if (mode === 'rejected') throw new Error('unreadable')
      return mode === 'no-eval-root' ? { kind: 'no-eval-root' } : { kind: 'unavailable', reason: 'unreadable' }
    }
    const report = await credit([row('a', 'negative')], mode === 'absent' ? undefined : ablation)
    expect(report.attributions[0]).toMatchObject({ outcome: { benefit: 'exercised-harmed' } })
    const attributed = report.attributions[0]!
    if (attributed.kind === 'outcome') expect(attributed.outcome).not.toHaveProperty('corpusDigest')
    expect(report.counters.ablationError).toBe(0)
  })
  it('two candidates on one decision are ablated independently', async () => {
    const ablation = capability()
    const report = await credit([row('candidate-a'), row('candidate-b')], ablation)
    expect(report.counters.credited).toBe(2)
    expect(ablation.ablate).toHaveBeenNthCalledWith(1, expect.objectContaining({ candidateId: 'candidate-a' }))
    expect(ablation.ablate).toHaveBeenNthCalledWith(2, expect.objectContaining({ candidateId: 'candidate-b' }))
    expect(ablation.corpusDigest).toHaveBeenCalledTimes(1)
  })
  it('unresolved rows pass through untouched and never touch the eval root', async () => {
    const unresolved: ProjectedCanaryAttribution = { kind: 'unresolved', source: 'served-brief',
      candidateId: asRecordId('missing'), testId: 'checkout', testIndex: 0, stepIndex: 0, reason: 'not-found' }
    const ablation = capability()
    expect((await credit([unresolved], ablation)).attributions[0]).toBe(unresolved)
    expect(ablation.corpusDigest).not.toHaveBeenCalled()
  })
})
