import { describe, expect, it } from 'vitest'

import { projectBaselinePointer } from '../../baseline/profile-key'
import { projectDecisionVectorsDocument } from '../../match/decision-vectors'
import { buildEvalReport } from '../../match/metrics'
import type { EvalBatchReport } from '../../match/metrics'
import type { DecisionCorrectnessVector } from '../../stats/decision-vector'
import { foldNoiseFloorArtefact } from '../floor-fold'
import { computeGateVerdict, renderGateLines } from '../release-gate'
import type { GateVerdict } from '../release-gate'

const ids = ['verifierFalsePassRate', 'recovery.raw', 'recovery.weighted',
  'perDecisionCost.promptTokens', 'perDecisionCost.completionTokens',
  'perDecisionCost.totalTokens', 'perDecisionCost.durationMs',
  'perSplit.natural', 'perSplit.held-out.shared', 'perSplit.held-out.private',
  'perSplit.adversarial'] as const

function measured(report: EvalBatchReport, n: number, rate: number) {
  report.headline.verifierFalsePassRate = { numerator: n * rate, denominator: n, rate }
  report.recovery = { ...report.recovery, recoveredPositiveCount: n * rate,
    eligiblePositiveCount: n, recoveryAccuracy: rate, weightSum: n / 2, weightedAccuracy: rate }
  report.totalCost = { ...report.totalCost, promptTokens: n * 10, completionTokens: n * 2,
    totalTokens: n * 12, durationMs: n * 5 }
  report.honesty.judge.cost = { calls: n, inputTokens: n * 3, outputTokens: n, outcomesMissingUsage: 0 }
  report.headline.perDecisionCost = { decisionCount: n, promptTokens: 13, completionTokens: 3,
    totalTokens: 16, durationMs: 5 }
  for (const split of [report.perSplit.natural, report.perSplit['held-out'].shared,
    report.perSplit['held-out'].private, report.perSplit.adversarial]) {
    split.firstAttemptDecisionAccuracy = { numerator: n * rate, denominator: n, rate }
  }
  report.calibration = { status: 'calibrated', n_gold: 20,
    verifierFalsePassRate: { numerator: 1, denominator: 20, rate: 0.05 } }
}

function fixture(exit: 0 | 1 | 2 = 0) {
  const baseline = buildEvalReport([], undefined, undefined, { declaredSeed: 11 })
  const current = buildEvalReport([], undefined, undefined, { declaredSeed: 29 })
  baseline.batchKey = 'baseline'
  current.batchKey = 'current'
  const pointer = projectBaselinePointer({ plannerModelId: 'fixture-planner', fingerprint: 'fp',
    corpusDigest: 'corpus', matcherVersion: baseline.matcherVersion, batchKey: baseline.batchKey })
  const vectors: DecisionCorrectnessVector[] = Array.from({ length: 10 }, (_, i) => ({
    key: `fixture-${i}#-#0`, cassetteId: `fixture-${i}`, decisionOrdinal: 0,
    product: 'fixture', briefSource: 'proof', axes: { headline: 'correct',
      elementIdentity: 'correct', value: 'correct', opClass: 'correct',
      sideEffect: 'correct', loop: 'not-applicable' },
  }))
  const floor = foldNoiseFloorArtefact({ profile: { profileKey: pointer.profileKey,
    fingerprint: pointer.fingerprint, plannerModelId: pointer.plannerModelId,
    matcherVersion: pointer.matcherVersion }, corpusDigest: 'corpus',
    partitionVersion: 1, seeds: [11, 29], repeats: 3, bootstrapSeed: 17,
    runs: [11, 11, 11, 29].map((seed, index) => ({ index, seed, report: baseline, vectors, wallClockMs: 0 })),
    splitByCassetteId: new Map(), censusByProduct: { fixture: { natural: 10, heldOutShared: 0, heldOutPrivate: 0 } },
  })
  const currentVectors = structuredClone(vectors)
  if (exit === 1) currentVectors.forEach(v => { v.axes.headline = 'incorrect' })
  if (exit === 2) floor.corpusDigest = 'stale'
  measured(baseline, 4, 0.5)
  measured(current, 8, 0.25)
  return { expectedProfileKey: pointer.profileKey, pointer: { kind: 'v2' as const, pointer }, floor,
    baseline: { report: baseline, vectors: projectDecisionVectorsDocument({ batchKey: baseline.batchKey,
      matcherVersion: baseline.matcherVersion, vectors }) },
    current: { report: current, vectors: currentVectors, fingerprint: 'fp', corpusDigest: 'corpus' } }
}

function oldVerdict(verdict: GateVerdict) {
  const { labelMetrics: _disclosure, ...original } = verdict
  return original
}

describe('same-profile label metric disclosure', () => {
  it('provides all eleven comparable rows with own denominators and calibration provenance', () => {
    const input = fixture()
    const before = structuredClone(input)
    const verdict = computeGateVerdict(input)
    expect(verdict.labelMetrics?.rows.map(row => row.metric)).toEqual(ids)
    expect(verdict.labelMetrics.rows.every(row => row.status === 'comparable')).toBe(true)
    expect(verdict.labelMetrics.rows[0]).toMatchObject({ status: 'comparable', delta: -0.25,
      baseline: { numerator: 2, denominator: 4, rate: 0.5 }, current: { numerator: 2, denominator: 8, rate: 0.25 } })
    expect(verdict.labelMetrics.rows[2]).toMatchObject({ baseline: { numerator: 1, denominator: 2, rate: 0.5 },
      current: { numerator: 1, denominator: 4, rate: 0.25 }, delta: -0.25 })
    for (const [i, rate, total] of [[3, 13, 52], [4, 3, 12], [5, 16, 64], [6, 5, 20]]) {
      expect(verdict.labelMetrics.rows[i!]).toMatchObject({ status: 'comparable', delta: 0,
        baseline: { numerator: total, denominator: 4, rate }, current: { numerator: total! * 2, denominator: 8, rate } })
    }
    expect(verdict.labelMetrics.calibration).toEqual({ baseline: input.baseline.report.calibration, current: input.current.report.calibration })
    expect(input).toEqual(before)
  })

  it.each([0, 1, 2] as const)('preserves every original verdict field at exit %s across every disclosure shift', exit => {
    const original = oldVerdict(computeGateVerdict(fixture(exit)))
    expect(original.exit).toBe(exit)
    for (const side of ['baseline', 'current'] as const) {
      for (const rate of [0, 1, undefined]) {
        const input = fixture(exit)
        if (rate === undefined) {
          Reflect.deleteProperty(input[side].report.headline, 'verifierFalsePassRate')
          Reflect.deleteProperty(input[side].report, 'recovery')
          Reflect.deleteProperty(input[side].report.headline, 'perDecisionCost')
          Reflect.deleteProperty(input[side].report, 'perSplit')
          Reflect.deleteProperty(input[side].report, 'calibration')
        } else {
          measured(input[side].report, 100, rate)
          for (const unit of ['promptTokens', 'completionTokens', 'totalTokens', 'durationMs'] as const) {
            input[side].report.totalCost[unit] = rate * 100000
          }
        }
        expect(oldVerdict(computeGateVerdict(input))).toEqual(original)
      }
    }
  })

  it.each(['baseline', 'current'] as const)('keeps %s zero numerators valid and zero denominators unavailable', side => {
    const input = fixture()
    measured(input[side].report, 4, 0)
    let verdict = computeGateVerdict(input)
    expect(verdict.labelMetrics.rows[0]).toMatchObject({ status: 'comparable', [side]: { rate: 0 } })
    input[side].report.headline.verifierFalsePassRate = { numerator: 0, denominator: 0 }
    input[side].report.recovery.weightSum = 0
    delete input[side].report.recovery.weightedAccuracy
    input[side].report.headline.perDecisionCost.decisionCount = 0
    verdict = computeGateVerdict(input)
    for (const index of [0, 2, 3, 4, 5, 6]) {
      expect(verdict.labelMetrics.rows[index]).toMatchObject({ status: 'not-comparable',
        reasons: expect.arrayContaining([expect.objectContaining({ side, reason: 'zero-denominator' })]) })
    }
    expect(verdict.labelMetrics.rows[0]).toMatchObject({ [side]: { numerator: 0, denominator: 0 } })
  })

  it.each(['natural', 'shared', 'private', 'adversarial'] as const)('discloses an independently absent %s split', split => {
    const input = fixture()
    Reflect.deleteProperty(split === 'shared' || split === 'private'
      ? input.baseline.report.perSplit['held-out'] : input.baseline.report.perSplit, split)
    const rows = computeGateVerdict(input).labelMetrics.rows
    expect(rows.filter(row => row.status === 'not-comparable')).toHaveLength(1)
    expect(rows.find(row => row.status === 'not-comparable')).toMatchObject({
      metric: `perSplit.${split === 'shared' || split === 'private' ? 'held-out.' : ''}${split}`,
      reasons: expect.arrayContaining([expect.objectContaining({ side: 'baseline', reason: 'missing-field' })]),
    })
  })

  it.each([undefined, null, -1, NaN, Infinity, '4', 0.5])('refuses invalid or missing decision denominator %s', value => {
    const input = fixture()
    Reflect.set(input.baseline.report.headline.perDecisionCost, 'decisionCount', value)
    expect(computeGateVerdict(input).labelMetrics.rows.slice(3, 7).every(row => row.status === 'not-comparable')).toBe(true)
  })

  it.each([undefined, null, -1, NaN, Infinity, 2, '0.5'])('preserves valid counts when the measured rate is absent or invalid: %s', value => {
    const input = fixture()
    Reflect.set(input.baseline.report.headline.verifierFalsePassRate, 'rate', value)
    expect(computeGateVerdict(input).labelMetrics.rows[0]).toMatchObject({ status: 'not-comparable',
      baseline: { numerator: 2, denominator: 4 }, reasons: expect.arrayContaining([
        expect.objectContaining({ side: 'baseline', reason: value === undefined ? 'missing-field' : 'invalid-field' }),
      ]) })
  })

  it.each(['pointer', 'fingerprint', 'matcher', 'judge', 'runIdentity'] as const)('never subtracts across a foreign %s identity', defect => {
    const input = fixture()
    if (defect === 'pointer') input.pointer.pointer.profileKey = 'foreign'
    if (defect === 'fingerprint') input.current.fingerprint = 'foreign'
    if (defect === 'matcher') input.baseline.report.matcherVersion += 1
    if (defect === 'judge') input.baseline.report.judge = { judgeModelId: 'foreign', judgeFamily: 'anthropic', judgeVersion: 1, confidenceThreshold: 'high' }
    if (defect === 'runIdentity') input.baseline.report.runIdentity = { fingerprint: 'foreign', corpusDigest: 'corpus' }
    expect(computeGateVerdict(input).labelMetrics.rows.every(row => row.status === 'not-comparable'
      && row.reasons.some(reason => reason.reason === 'profile-mismatch'))).toBe(true)
  })

  it('has explicit missing-baseline and missing-profile evidence without a fallback', () => {
    const input = fixture()
    const verdict = computeGateVerdict({ ...input, baseline: undefined, pointer: { kind: 'absent', others: [{ profileKey: 'foreign' }] } })
    expect(verdict.labelMetrics.rows).toHaveLength(11)
    expect(verdict.labelMetrics.rows.every(row => row.status === 'not-comparable'
      && row.reasons.some(reason => reason.reason === 'missing-baseline'))).toBe(true)
  })

  it('renders only copied comparison DTO values including explicit unavailability', () => {
    const verdict = computeGateVerdict(fixture())
    const row = verdict.labelMetrics.rows[0]!
    if (row.status !== 'comparable') throw new Error('expected comparable fixture')
    row.delta = 123.456
    const lines = renderGateLines(verdict)
    expect(lines.filter(line => line.startsWith('label-metric: '))).toHaveLength(11)
    expect(lines.find(line => line.startsWith('label-metric: verifierFalsePassRate '))).toContain('123.456')
    expect(lines.find(line => line.startsWith('label-calibration: '))).toContain('calibrated')
  })
})
