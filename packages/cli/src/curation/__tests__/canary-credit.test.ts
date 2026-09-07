import { asRecordId, asRunId, type CompletedRunHandoff } from '@vostride/agent-qa-schema'
import { describe, expect, it, vi } from 'vitest'
import { creditCanaryAttributions, type CanaryAblation, type CanaryAblationResult } from '../canary-credit.js'
import type { ProjectedCanaryAttribution } from '../emit-canary-outcomes.js'

const DIGEST = 'c'.repeat(64)
const handoff: CompletedRunHandoff = { schemaVersion: 3, runId: asRunId('run-credit'),
  scope: { tier: 'product', key: 'storefront' }, buildOrdinal: 43,
  executionContext: 'local-interactive', aggregateVerdict: 'passed',
  configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' }, startedAt: 1, endedAt: 2, tests: [] }
function row(candidateId = 'candidate-checkout', runOutcome: 'positive' | 'negative' = 'positive'): ProjectedCanaryAttribution {
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
function credit(attributions: ProjectedCanaryAttribution[], ablation?: CanaryAblation) {
  return creditCanaryAttributions({ attributions, ablation, handoff, runDir: '/tmp/run',
    observationIdOf: () => 'fixture-observation' })
}
describe('418 credit pass', () => {
  it('flipped copies the ablation evidence and its own digest', async () => {
    const ablation = capability()
    ablation.corpusDigest = async () => ({ kind: 'digest', corpusDigest: 'd'.repeat(64) })
    const report = await credit([row()], ablation)
    expect(report.counters.credited).toBe(1)
    expect(report.attributions[0]).toMatchObject({ crossCheck: 'flipped', outcome: {
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
