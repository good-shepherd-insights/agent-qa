import { describe, expect, it } from 'vitest'
import { buildEvalReport } from '../metrics'
import { metricEntry, metricPair, passLabel } from './fixtures/label-metric-fixtures'

describe('420 calibrated batch metrics', () => {
  it('counts one false pass for a source and both gold clones in every order', () => {
    const entries = ['source', 'user', 'overturned'].map((id, index) => ({
      ...metricEntry(id), logicalSourceId: 'source',
      label: passLabel((['recorded-verdict', 'user-mark', 'overturned-verdict'] as const)[index]),
    }))
    for (const order of [entries, [...entries].reverse(), [entries[1]!, entries[2]!, entries[0]!]]) {
      const report = buildEvalReport(order)
      expect(report.headline).toHaveProperty('verifierFalsePassRate', { numerator: 1, denominator: 1, rate: 1 })
      expect(report.headline.firstAttemptDecisionAccuracy).toEqual({ numerator: 3, denominator: 3, rate: 1 })
      expect(report.totalCost.totalTokens).toBe(45)
    }
  })

  it('uses active representatives and excludes refused or quarantined signals', () => {
    const source = { ...metricEntry('source'), logicalSourceId: 'source', label: passLabel() }
    const inactive = { ...metricEntry('overturned'), logicalSourceId: 'source',
      label: passLabel('overturned-verdict'), scoringExcluded: true }
    const refused = { ...metricEntry('refused'), label: passLabel('overturned-verdict'),
      outcome: { kind: 'integrity-refusal' as const, cassetteId: 'refused', reason: 'guard-failed' as const, detail: 'fixture' } }
    const report = buildEvalReport([source, inactive, refused])
    expect(report.headline).toHaveProperty('verifierFalsePassRate', { numerator: 0, denominator: 1, rate: 0 })
    expect(report.headline.firstAttemptDecisionAccuracy).toEqual({ numerator: 1, denominator: 1, rate: 1 })
    expect(report.totalCost.totalTokens).toBe(30)
  })

  it('does not invent a PASS denominator for FAIL, missing labels or an empty batch', () => {
    const failed = { ...metricEntry('failed'), label: { ...passLabel(), verdict: { pass: false, reasoning: 'fail' } } }
    for (const entries of [[], [metricEntry('unlabeled'), failed]]) {
      const report = buildEvalReport(entries)
      expect(report.headline).toHaveProperty('verifierFalsePassRate', { numerator: 0, denominator: 0 })
      expect(report).toHaveProperty('calibration', { status: 'uncalibrated' })
    }
  })

  it('uses persisted positive weights while preserving raw recovery', () => {
    const entries = [...metricPair('success', true, 0.25), ...metricPair('failure', false, 0.75)]
    const before = structuredClone(entries)
    expect(buildEvalReport(entries).recovery).toEqual({ selfHealPairCount: 2,
      eligiblePositiveCount: 2, recoveredPositiveCount: 1, recoveryAccuracy: 0.5,
      weightSum: 1, weightedAccuracy: 0.25, pairsWithoutWeight: 0,
      negativeDecisionCount: 2, negativeFullMatchCount: 2 })
    expect(entries).toEqual(before)
  })

  it('discloses legacy weights from the agent-verified prior mean', () => {
    const report = buildEvalReport([...metricPair('legacy', true), ...metricPair('weighted', false, 1 / 3)])
    expect(report.recovery).toMatchObject({ weightSum: 1, weightedAccuracy: 2 / 3,
      recoveryAccuracy: 0.5, pairsWithoutWeight: 1 })
  })

  it('omits weighted accuracy at zero weight without dropping raw recovery', () => {
    const report = buildEvalReport(metricPair('zero', true, 0))
    expect(report.recovery).toMatchObject({ weightSum: 0, pairsWithoutWeight: 0, recoveryAccuracy: 1 })
    expect(report.recovery).not.toHaveProperty('weightedAccuracy')
  })

  it('does not weight missing, unscored or excluded partners', () => {
    const pair = metricPair('excluded', true, 1)
    Object.assign(pair[1]!, { scoringExcluded: true })
    const unscored = metricPair('unscored', true, 1)
    delete unscored[1]!.score
    const entries = [metricPair('missing', true, 1)[0]!, ...pair, ...unscored]
    expect(buildEvalReport(entries).recovery).toMatchObject({ selfHealPairCount: 0,
      eligiblePositiveCount: 0, recoveredPositiveCount: 0, weightSum: 0, pairsWithoutWeight: 0 })
    expect(buildEvalReport(entries).recovery).not.toHaveProperty('recoveryAccuracy')
  })

  it('copies only calibration summary numbers and never private correction content', () => {
    const calibration = { status: 'calibrated' as const, n_gold: 20,
      verifierFalsePassRate: { numerator: 2, denominator: 20, rate: 0.1 },
      correction: { correctedAction: 'PRIVATE' } }
    const report = buildEvalReport([], undefined, undefined, { calibration })
    expect(report).toHaveProperty('calibration', { status: 'calibrated', n_gold: 20,
      verifierFalsePassRate: { numerator: 2, denominator: 20, rate: 0.1 } })
    calibration.verifierFalsePassRate.numerator = 9
    expect(JSON.stringify(report)).not.toContain('PRIVATE')
    expect(report).toHaveProperty('calibration.verifierFalsePassRate.numerator', 2)
  })

  it('retains current and historical judge usage for a scoring-excluded replay', () => {
    const entry = metricEntry('excluded')
    if (entry.score?.kind !== 'leaf' || entry.score.entry.kind !== 'decision'
      || entry.score.entry.score.kind !== 'scored') throw new Error('fixture shape')
    entry.score.entry.score.judgeSettled = { cause: 'partial-identity',
      axis: 'element-identity', resolution: 'equivalent', judgeId: 'fixture',
      judgeVersion: 1, confidence: 'high',
      usage: { calls: 1, inputTokens: 7, outputTokens: 3 } }
    entry.incurredJudgeScore = structuredClone(entry.score)
    entry.scoringExcluded = true
    const report = buildEvalReport([entry])
    expect(report.headline.firstAttemptDecisionAccuracy).toEqual({ numerator: 0, denominator: 0 })
    expect(report.totalCost.totalTokens).toBe(15)
    expect(report.honesty.judge.cost).toEqual({ calls: 2, inputTokens: 14,
      outputTokens: 6, outcomesMissingUsage: 0 })
    expect(report.honesty.judge.settled['partial-identity']).toBe(0)
    expect(report.headline.perDecisionCost).toEqual({ decisionCount: 1,
      promptTokens: 24, completionTokens: 11, totalTokens: 35, durationMs: 10 })
  })

  it.each([-1, 1.01, NaN, Infinity])('refuses invalid persisted weight %s', value => {
    expect(() => buildEvalReport(metricPair('invalid', true, value))).toThrow(/weight/)
  })

  it('rejects inconsistent calibration numbers and preserves uncalibrated observed zeros', () => {
    expect(() => buildEvalReport([], undefined, undefined, { calibration: {
      status: 'calibrated', n_gold: 20,
      verifierFalsePassRate: { numerator: 2, denominator: 20, rate: 0.2 },
    } })).toThrow(/calibration/)
    expect(() => buildEvalReport([], undefined, undefined, { calibration: {
      status: 'uncalibrated', n_gold: -1,
    } })).toThrow(/calibration/)
    expect(buildEvalReport([], undefined, undefined, { calibration: {
      status: 'uncalibrated', n_gold: 0,
      verifierFalsePassRate: { numerator: 0, denominator: 0 },
    } }).calibration).toEqual({ status: 'uncalibrated', n_gold: 0,
      verifierFalsePassRate: { numerator: 0, denominator: 0 } })
  })
})
