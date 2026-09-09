import { describe, expect, it } from 'vitest'
import { buildEvalReport } from '../metrics'
import { metricEntry, metricPair, passLabel } from './fixtures/label-metric-fixtures'

const zeroRate = { numerator: 0, denominator: 0 }
const zeroRecovery = { selfHealPairCount: 0, recoveredPositiveCount: 0, eligiblePositiveCount: 0,
  negativeDecisionCount: 0, negativeFullMatchCount: 0, weightSum: 0, pairsWithoutWeight: 0 }
const zeroCost = { decisionCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0 }
const zeroCell = { firstAttemptDecisionAccuracy: zeroRate, verifierFalsePassRate: zeroRate,
  recovery: zeroRecovery, perDecisionCost: zeroCost }

describe('420 split metrics', () => {
  it('always emits four complete empty cells with absent rates and accuracies', () => {
    expect(buildEvalReport([])).toHaveProperty('perSplit', {
      natural: zeroCell, 'held-out': { shared: zeroCell, private: zeroCell },
      adversarial: zeroCell, unassignedCount: 0,
    })
  })

  it('reports all four populations independently with unchanged headline and cost', () => {
    const entries = [
      { ...metricEntry('natural'), split: 'natural' as const, label: passLabel() },
      { ...metricEntry('shared', false), split: 'held-out' as const, heldOutVisibility: 'shared' as const, label: passLabel() },
      { ...metricEntry('private'), split: 'held-out' as const, heldOutVisibility: 'private' as const, label: passLabel('overturned-verdict') },
      { ...metricEntry('adversarial', false), split: 'adversarial' as const },
    ]
    const report = buildEvalReport(entries)
    expect(report).toHaveProperty('perSplit')
    expect(report.perSplit.natural.firstAttemptDecisionAccuracy).toEqual({ numerator: 1, denominator: 1, rate: 1 })
    expect(report.perSplit['held-out'].shared.firstAttemptDecisionAccuracy).toEqual({ numerator: 0, denominator: 1, rate: 0 })
    expect(report.perSplit['held-out'].private.verifierFalsePassRate).toEqual({ numerator: 1, denominator: 1, rate: 1 })
    expect(report.perSplit.adversarial.verifierFalsePassRate).toEqual(zeroRate)
    for (const cell of [report.perSplit.natural, report.perSplit['held-out'].shared,
      report.perSplit['held-out'].private, report.perSplit.adversarial]) {
      expect(cell.recovery).toEqual(zeroRecovery)
      expect(cell.perDecisionCost).toEqual({ decisionCount: 1, promptTokens: 10,
        completionTokens: 5, totalTokens: 15, durationMs: 10 })
    }
    expect(report.headline.firstAttemptDecisionAccuracy).toEqual({ numerator: 2, denominator: 4, rate: 0.5 })
    expect(report.headline.perDecisionCost.decisionCount).toBe(4)
    expect(report.totalCost.totalTokens).toBe(60)
  })

  it('assigns globally selected false-pass representatives to their actual private split', () => {
    const entries = [
      { ...metricEntry('source'), logicalSourceId: 'source', split: 'natural' as const, label: passLabel() },
      { ...metricEntry('user'), logicalSourceId: 'source', split: 'held-out' as const,
        heldOutVisibility: 'shared' as const, label: passLabel('user-mark') },
      { ...metricEntry('overturned'), logicalSourceId: 'source', split: 'held-out' as const,
        heldOutVisibility: 'private' as const, label: passLabel('overturned-verdict') },
    ]
    for (const order of [entries, [...entries].reverse()]) {
      const report = buildEvalReport(order)
      expect(report).toHaveProperty('perSplit')
      expect(report.perSplit.natural.verifierFalsePassRate).toEqual(zeroRate)
      expect(report.perSplit['held-out'].shared.verifierFalsePassRate).toEqual(zeroRate)
      expect(report.perSplit['held-out'].private.verifierFalsePassRate).toEqual({ numerator: 1, denominator: 1, rate: 1 })
      expect(report.headline.verifierFalsePassRate.denominator).toBe(1)
    }
  })

  it('falls back to the active user clone when overturned evidence is excluded', () => {
    const entries = [
      { ...metricEntry('source'), logicalSourceId: 'source', split: 'natural' as const, label: passLabel() },
      { ...metricEntry('user'), logicalSourceId: 'source', split: 'held-out' as const,
        heldOutVisibility: 'shared' as const, label: passLabel('user-mark') },
      { ...metricEntry('overturned'), logicalSourceId: 'source', split: 'held-out' as const,
        heldOutVisibility: 'private' as const, label: passLabel('overturned-verdict'), scoringExcluded: true },
    ]
    const report = buildEvalReport(entries)
    expect(report).toHaveProperty('perSplit')
    expect(report.perSplit.natural.verifierFalsePassRate).toEqual(zeroRate)
    expect(report.perSplit['held-out'].shared.verifierFalsePassRate).toEqual({ numerator: 0, denominator: 1, rate: 0 })
    expect(report.perSplit['held-out'].private.firstAttemptDecisionAccuracy).toEqual(zeroRate)
    expect(report.perSplit['held-out'].private.perDecisionCost.totalTokens).toBe(15)
  })

  it('keeps weighted recovery in its actual pair split without inventing missing partners', () => {
    const pair = metricPair('same', true, 0.25).map(entry => ({ ...entry, split: 'adversarial' as const }))
    const cross = metricPair('cross', true, 0.75).map((entry, i) => ({ ...entry,
      split: i === 0 ? 'natural' as const : 'held-out' as const, heldOutVisibility: 'shared' as const }))
    const report = buildEvalReport([...pair, ...cross])
    expect(report).toHaveProperty('perSplit')
    expect(report.perSplit.adversarial.recovery).toEqual({ selfHealPairCount: 1,
      eligiblePositiveCount: 1, recoveredPositiveCount: 1, recoveryAccuracy: 1,
      weightSum: 0.25, weightedAccuracy: 1, pairsWithoutWeight: 0,
      negativeDecisionCount: 1, negativeFullMatchCount: 1 })
    expect(report.perSplit.natural.recovery).toEqual(zeroRecovery)
    expect(report.perSplit['held-out'].shared.recovery.eligiblePositiveCount).toBe(0)
    expect(report.recovery.selfHealPairCount).toBe(2)
    expect(report.recovery.weightSum).toBe(1)
  })

  it('discloses staged missing ownership without manufacturing a split', () => {
    const report = buildEvalReport([
      { ...metricEntry('staged'), label: passLabel('overturned-verdict') },
      { ...metricEntry('held-out-unknown'), split: 'held-out' as const },
      { ...metricEntry('visibility-only'), heldOutVisibility: 'private' as const },
    ])
    expect(report).toHaveProperty('perSplit', { natural: zeroCell,
      'held-out': { shared: zeroCell, private: zeroCell }, adversarial: zeroCell, unassignedCount: 3 })
    expect(report.headline.firstAttemptDecisionAccuracy.denominator).toBe(3)
    expect(report.headline.verifierFalsePassRate.denominator).toBe(1)
    expect(report.totalCost.totalTokens).toBe(45)
  })

  it('preserves legacy missing metadata as missing when reading historical JSON', () => {
    const legacy: Record<string, unknown> = { headline: { firstAttemptDecisionAccuracy: zeroRate }, recovery: {} }
    const bytes = JSON.stringify(legacy)
    const report = buildEvalReport([])
    expect(report).toHaveProperty('perSplit.natural.recovery.weightSum', 0)
    expect(legacy).not.toHaveProperty('perSplit')
    expect(legacy).not.toHaveProperty('calibration')
    expect(JSON.stringify(legacy)).toBe(bytes)
  })

  it.each([
    { split: 'natural' as const },
    { split: 'held-out' as const, heldOutVisibility: 'shared' as const },
    { split: 'held-out' as const, heldOutVisibility: 'private' as const },
    { split: 'adversarial' as const },
  ])('preserves raw, weighted, zero and legacy recovery in $split $heldOutVisibility', assignment => {
    const entries = [...metricPair('legacy', true), ...metricPair('failed', false, 1 / 3)]
      .map(entry => ({ ...entry, ...assignment }))
    const report = buildEvalReport(entries)
    const cell = assignment.split === 'held-out' ? report.perSplit['held-out'][assignment.heldOutVisibility!]
      : report.perSplit[assignment.split]
    expect(cell.recovery).toEqual({ selfHealPairCount: 2, eligiblePositiveCount: 2,
      recoveredPositiveCount: 1, recoveryAccuracy: 0.5, weightSum: 1,
      weightedAccuracy: 2 / 3, pairsWithoutWeight: 1,
      negativeDecisionCount: 2, negativeFullMatchCount: 2 })
    const zero = buildEvalReport(metricPair('zero', true, 0).map(entry => ({ ...entry, ...assignment })))
    const zeroSplit = assignment.split === 'held-out' ? zero.perSplit['held-out'][assignment.heldOutVisibility!]
      : zero.perSplit[assignment.split]
    expect(zeroSplit.recovery).toMatchObject({ weightSum: 0, pairsWithoutWeight: 0, recoveryAccuracy: 1 })
    expect(zeroSplit.recovery).not.toHaveProperty('weightedAccuracy')
  })

  it('folds procedure samples and excluded current/historical judge costs over actual decisions', () => {
    const first = metricEntry('first'), second = metricEntry('second'), excluded = metricEntry('excluded')
    if (!('granularity' in first.outcome) || first.outcome.granularity !== 'leaf'
      || !('granularity' in second.outcome) || second.outcome.granularity !== 'leaf'
      || excluded.score?.kind !== 'leaf' || excluded.score.entry.kind !== 'decision'
      || excluded.score.entry.score.kind !== 'scored') throw new Error('fixture shape')
    first.outcome.samples = [...first.outcome.samples, { ...first.outcome.samples[0]!, sampleIndex: 1 }]
    excluded.score.entry.score.judgeSettled = { cause: 'partial-identity', axis: 'element-identity',
      resolution: 'equivalent', judgeId: 'fixture', judgeVersion: 1, confidence: 'high',
      usage: { calls: 1, inputTokens: 7, outputTokens: 3 } }
    excluded.incurredJudgeScore = structuredClone(excluded.score)
    excluded.scoringExcluded = true
    const report = buildEvalReport([
      { ...excluded, split: 'adversarial' },
      { cassetteId: 'procedure', split: 'adversarial', outcome: {
        granularity: 'procedure', cassetteId: 'procedure',
        steps: [
          { kind: 'decision', stepIndex: 0, decisionOrdinal: 0, result: first.outcome },
          { kind: 'skipped', stepIndex: 1, reason: 'cache-served' },
          { kind: 'decision', stepIndex: 2, decisionOrdinal: 1, result: second.outcome },
        ], endState: { outcome: 'passed' }, totalDurationMs: 30,
      } },
    ])
    expect(report.perSplit.adversarial.firstAttemptDecisionAccuracy).toEqual(zeroRate)
    expect(report.perSplit.adversarial.perDecisionCost).toEqual({ decisionCount: 3,
      promptTokens: 54 / 3, completionTokens: 26 / 3, totalTokens: 80 / 3, durationMs: 40 / 3 })
    expect(report.headline.perDecisionCost).toEqual(report.perSplit.adversarial.perDecisionCost)
    expect(report.totalCost).toMatchObject({ sampleCount: 4, totalTokens: 60 })
  })
})
