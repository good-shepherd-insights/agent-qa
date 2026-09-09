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
})
