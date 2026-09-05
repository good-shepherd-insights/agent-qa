import { describe, expect, it } from 'vitest'

import { projectBaselinePointer } from '../../baseline/profile-key'
import { assertBaselineComparator, renderBaselineComparatorRefusal } from '../../baseline/comparator'
import { projectDecisionVectorsDocument } from '../../match/decision-vectors'
import { buildEvalReport } from '../../match/metrics'
import { REPLAY_REFUSAL_REASONS } from '../../replay/result'
import type { DecisionCorrectnessVector } from '../../stats/decision-vector'
import { foldNoiseFloorArtefact } from '../floor-fold'
import { computeGateVerdict } from '../release-gate'
import type { ComputeGateVerdictInput, GateInconclusiveReason } from '../release-gate'

function vector(i: number): DecisionCorrectnessVector {
  return {
    key: `synthetic-cassette-${i}#-#0`,
    cassetteId: `synthetic-cassette-${i}`,
    decisionOrdinal: 0,
    product: 'example-web',
    briefSource: i % 2 === 0 ? 'proof' : 'empty',
    axes: {
      headline: i < 41 ? 'correct' : 'incorrect',
      elementIdentity: 'correct',
      value: 'correct',
      opClass: 'correct',
      sideEffect: 'correct',
      loop: 'not-applicable',
    },
  }
}

function fixture() {
  const baselineReport = buildEvalReport([], undefined, undefined, { declaredSeed: 11 })
  const currentReport = buildEvalReport([], undefined, undefined, { declaredSeed: 29 })
  baselineReport.batchKey = 'baseline-batch'
  currentReport.batchKey = 'current-batch'
  baselineReport.briefSourceCounts = { proof: 24, empty: 24, rendered: 0 }
  currentReport.briefSourceCounts = { proof: 24, empty: 24, rendered: 0 }
  const pointer = projectBaselinePointer({
    plannerModelId: 'synthetic-planner',
    fingerprint: 'synthetic-fingerprint',
    corpusDigest: 'synthetic-corpus',
    matcherVersion: baselineReport.matcherVersion,
    batchKey: baselineReport.batchKey,
  })
  const vectors = Array.from({ length: 48 }, (_, i) => vector(i))
  const floor = foldNoiseFloorArtefact({
    profile: {
      profileKey: pointer.profileKey,
      fingerprint: pointer.fingerprint,
      plannerModelId: pointer.plannerModelId,
      matcherVersion: pointer.matcherVersion,
    },
    corpusDigest: pointer.corpusDigest,
    partitionVersion: 1,
    seeds: [11, 29],
    repeats: 3,
    bootstrapSeed: 17,
    runs: [11, 11, 11, 29].map((seed, index) => ({
      index, seed, report: baselineReport, vectors, wallClockMs: 0,
    })),
    splitByCassetteId: new Map(),
    censusByProduct: { 'example-web': { natural: 48, heldOutShared: 0, heldOutPrivate: 0 } },
  })
  return {
    expectedProfileKey: pointer.profileKey,
    pointer: { kind: 'v2' as const, pointer },
    floor,
    baseline: {
      report: baselineReport,
      vectors: projectDecisionVectorsDocument({
        batchKey: baselineReport.batchKey,
        matcherVersion: baselineReport.matcherVersion,
        vectors,
      }),
    },
    current: {
      report: currentReport,
      vectors: structuredClone(vectors),
      fingerprint: pointer.fingerprint,
      corpusDigest: pointer.corpusDigest,
    },
  } satisfies ComputeGateVerdictInput
}

function reason(input: ComputeGateVerdictInput, name: GateInconclusiveReason): string {
  const verdict = computeGateVerdict(input)
  expect(verdict.exit).toBe(2)
  const matches = verdict.inconclusive.filter(entry => entry.reason === name)
  expect(matches).toHaveLength(1)
  return matches[0]!.detail
}

describe('release gate inconclusive evidence', () => {
  it('compares a non-empty shared population with matching profile and seed regime', () => {
    const verdict = computeGateVerdict(fixture())
    expect(verdict).toMatchObject({
      exit: 0, inconclusive: [], regressions: [],
      pairing: { n: 48, discordant: 0, baselineOnly: 0, currentOnly: 0, renderedExcluded: 0 },
      seed: { current: true, floor: true, regime: 'match' },
      population: { proof: 24, empty: 24, rendered: 0 },
    })
  })

  it('names absent baseline profile alternatives and the re-designation command', () => {
    const input = fixture()
    const detail = reason({ ...input, pointer: {
      kind: 'absent', others: [{ profileKey: 'same-planner-seed-none' }, { profileKey: 'same-planner-seed-declared' }],
    } }, 'missing-baseline')
    for (const text of [input.expectedProfileKey, 'same-planner-seed-none', 'same-planner-seed-declared', 'eval report --baseline --from-committed']) {
      expect(detail).toContain(text)
    }
  })

  it('names the missing baseline batch report without throwing', () => {
    const input = fixture()
    expect(reason({ ...input, baseline: undefined }, 'missing-baseline')).toContain('baseline-batch')
  })

  it('refuses a rejected pointer with its disk-reader reason', () => {
    expect(reason({ ...fixture(), pointer: { kind: 'rejected', reason: 'schemaVersion: invalid' } }, 'incomparable-baseline'))
      .toContain('schemaVersion: invalid')
  })

  it('refuses a v1 pointer as no-fingerprint with a re-designation fix', () => {
    const input = fixture()
    const detail = reason({ ...input, pointer: { kind: 'v1', pointer: input.pointer.pointer } }, 'incomparable-baseline')
    expect(detail).toContain('no-fingerprint')
    expect(detail).toContain('eval report --baseline --from-committed')
  })

  it('names both fingerprints and the fix on a v2 mismatch', () => {
    const input = fixture()
    input.pointer.pointer.fingerprint = 'old-fingerprint'
    const detail = reason(input, 'incomparable-baseline')
    expect(detail).toContain('old-fingerprint')
    expect(detail).toContain('synthetic-fingerprint')
    expect(detail).toContain('eval report --baseline --from-committed')
  })

  it.each(['same-family-override', 'mixed-judge-identity'] as const)(
    'reuses the unchanged comparator text for %s', kind => {
      const input = fixture()
      if (kind === 'same-family-override') {
        input.baseline.report.judge = {
          judgeModelId: 'synthetic-judge', judgeFamily: 'openai', judgeVersion: 1,
          familyOverride: 'same-family-allowed', confidenceThreshold: 'high',
        }
      } else {
        input.baseline.report.judgeIdentity = 'mixed'
        input.baseline.report.mixedJudgeModelIds = ['synthetic-judge-a', 'synthetic-judge-b']
      }
      const expected = assertBaselineComparator(input.baseline.report)
      expect(expected.ok).toBe(false)
      if (!expected.ok) expect(reason(input, 'incomparable-baseline'))
        .toContain(renderBaselineComparatorRefusal(expected.refusal))
    },
  )

  it('names a missing floor and its measurement command', () => {
    expect(reason({ ...fixture(), floor: undefined }, 'missing-floor')).toContain('eval floor --commit')
  })

  it('names both corpus digests for stale-baseline and stale-floor', () => {
    const input = fixture()
    input.pointer.pointer.corpusDigest = 'old-baseline-corpus'
    input.floor.corpusDigest = 'old-floor-corpus'
    expect(reason(input, 'stale-baseline')).toContain('old-baseline-corpus')
    expect(reason(input, 'stale-baseline')).toContain('synthetic-corpus')
    expect(reason(input, 'stale-floor')).toContain('old-floor-corpus')
    expect(reason(input, 'stale-floor')).toContain('synthetic-corpus')
  })

  it.each([[true, false], [false, true], [true, undefined], [false, undefined]] as const)(
    'discloses floor seedHonored %s against current %s without inventing missing evidence', (floor, current) => {
      const input = fixture()
      input.floor.seedHonored = floor
      input.current.report.seedHonored = current
      const detail = reason(input, 'seed-regime-mismatch')
      expect(detail).toContain(`floor seedHonored=${floor}`)
      expect(detail).toContain(`current seedHonored=${current ?? 'absent'}`)
      expect(detail).toContain('eval floor --commit')
      expect(computeGateVerdict(input).seed.regime).toBe(current === undefined ? 'unknown' : 'mismatch')
    },
  )

  it('allows both false seedHonored values while disclosing that regime', () => {
    const input = fixture()
    input.floor.seedHonored = false
    input.current.report.seedHonored = false
    expect(computeGateVerdict(input)).toMatchObject({ exit: 0, seed: { current: false, floor: false, regime: 'match' } })
  })

  it('keeps an absent floor seed unknown', () => {
    expect(computeGateVerdict({ ...fixture(), floor: undefined }).seed).toEqual({ current: true, regime: 'unknown' })
  })

  it('collects harness errors with both counts', () => {
    const input = fixture()
    input.baseline.report.honesty.harnessErrorCount = 2
    input.current.report.honesty.harnessErrorCount = 3
    const detail = reason(input, 'harness-errors')
    expect(detail).toContain('baseline=2')
    expect(detail).toContain('current=3')
  })

  it.each(['baseline', 'current'] as const)('refuses never-scored decisions on %s', side => {
    const input = fixture()
    input[side].report.honesty.neverScoredCounts['all-samples-harness-error'] = 2
    const detail = reason(input, 'never-scored')
    expect(detail).toContain(side)
    expect(detail).toContain('all-samples-harness-error')
    expect(detail).toContain('2')
  })

  it('reports every differing refusal reason with both counts in one entry', () => {
    const input = fixture()
    input.baseline.report.honesty.refusalCounts['missing-blob'] = 24
    input.current.report.honesty.refusalCounts['missing-blob'] = 25
    input.baseline.report.honesty.refusalCounts['unsupported-brief'] = 63
    const detail = reason(input, 'refusal-population-differs')
    expect(detail).toContain('missing-blob: baseline=24 current=25')
    expect(detail).toContain('unsupported-brief: baseline=63 current=0')
    expect(computeGateVerdict(input).regressions).toEqual([])
  })

  it('Pitfall 5: treats a historical missing key as zero in both directions', () => {
    for (const side of ['baseline', 'current'] as const) {
      const input = fixture()
      Reflect.deleteProperty(input[side].report.honesty.refusalCounts, 'unrenderable-brief')
      input.baseline.report.honesty.refusalCounts['missing-blob'] = 24
      input.current.report.honesty.refusalCounts['missing-blob'] = 24
      const verdict = computeGateVerdict(input)
      expect(verdict.exit).toBe(0)
      expect(verdict.inconclusive).toEqual([])
      expect(verdict.refusals.baseline['missing-blob']).toBe(24)
      expect(verdict.refusals.current['missing-blob']).toBe(24)
      expect(Object.keys(verdict.refusals.baseline)).toEqual(REPLAY_REFUSAL_REASONS)
    }
  })

  it('names the baseline decisions.json fix for absent baseline vectors', () => {
    const input = fixture()
    const detail = reason({ ...input, baseline: { report: input.baseline.report } }, 'no-decision-vector')
    expect(detail).toMatch(/^baseline:/)
    expect(detail).toContain('eval report --commit')
    expect(detail).toContain('baseline-batch')
    expect(detail).toContain('decisions.json')
  })

  it('collects stale-floor plus no-decision-vector together, with all disclosure blocks', () => {
    const input = fixture()
    input.floor.corpusDigest = 'stale-corpus'
    const verdict = computeGateVerdict({ ...input, baseline: { report: input.baseline.report } })
    expect(verdict.exit).toBe(2)
    expect(verdict.inconclusive.map(entry => entry.reason)).toEqual(['stale-floor', 'no-decision-vector'])
    expect(verdict).toMatchObject({
      regressions: [], refusals: { baseline: {}, current: {} },
      pairing: { n: 0, discordant: 0, baselineOnly: 0, currentOnly: 0, renderedExcluded: 0 },
      population: { proof: 24, empty: 24, rendered: 0 },
    })
  })

  it('computes pairing even when multiple evidence reasons make the verdict inconclusive', () => {
    const input = fixture()
    input.floor.corpusDigest = 'stale-corpus'
    input.current.report.honesty.harnessErrorCount = 1
    input.current.vectors[0]!.axes.headline = 'incorrect'
    const verdict = computeGateVerdict(input)
    expect(verdict.inconclusive.map(entry => entry.reason)).toEqual(['stale-floor', 'harness-errors'])
    expect(verdict.pairing).toMatchObject({ n: 48, discordant: 1 })
  })

  it.each([
    ['pointer profileKey', (input: ReturnType<typeof fixture>) => { input.pointer.pointer.profileKey = 'wrong-profile' }, 'wrong-profile'],
    ['floor profileKey', (input: ReturnType<typeof fixture>) => { input.floor.profileKey = 'wrong-floor-profile' }, 'wrong-floor-profile'],
    ['floor fingerprint', (input: ReturnType<typeof fixture>) => { input.floor.fingerprint = 'wrong-floor-fingerprint' }, 'wrong-floor-fingerprint'],
    ['baseline report batchKey', (input: ReturnType<typeof fixture>) => { input.baseline.report.batchKey = 'wrong-report-batch' }, 'wrong-report-batch'],
    ['baseline vectors batchKey', (input: ReturnType<typeof fixture>) => { input.baseline.vectors.batchKey = 'wrong-vectors-batch' }, 'wrong-vectors-batch'],
    ['baseline report matcherVersion', (input: ReturnType<typeof fixture>) => { input.baseline.report.matcherVersion = 91 }, '91'],
    ['baseline vectors matcherVersion', (input: ReturnType<typeof fixture>) => { input.baseline.vectors.matcherVersion = 92 }, '92'],
    ['pointer matcherVersion', (input: ReturnType<typeof fixture>) => { input.pointer.pointer.matcherVersion = 93 }, '93'],
    ['floor matcherVersion', (input: ReturnType<typeof fixture>) => { input.floor.matcherVersion = 94 }, '94'],
    ['floor plannerModelId', (input: ReturnType<typeof fixture>) => { input.floor.plannerModelId = 'wrong-planner' }, 'wrong-planner'],
    ['pointer judgeVersion', (input: ReturnType<typeof fixture>) => { input.pointer.pointer.judgeVersion = 95 }, '95'],
    ['floor judgeModelId', (input: ReturnType<typeof fixture>) => { input.floor.judgeModelId = 'wrong-judge' }, 'wrong-judge'],
  ] as const)('refuses inconsistent %s without throwing or widening the ten reasons', (_field, change, value) => {
    const input = fixture()
    change(input)
    expect(reason(input, 'incomparable-baseline')).toContain(value)
  })

  it('rejects report judge identities differing across baseline and current', () => {
    const input = fixture()
    input.current.report.judge = { judgeModelId: 'other-judge', judgeFamily: 'anthropic', judgeVersion: 1, confidenceThreshold: 'high' }
    const detail = reason(input, 'incomparable-baseline')
    expect(detail).toContain('other-judge')
    expect(detail).toContain('absent')
  })

  it('throws only for the named caller-contract failures', () => {
    expect(() => computeGateVerdict({ ...fixture(), expectedProfileKey: 42 as unknown as string })).toThrow(TypeError)
    const input = fixture()
    Reflect.deleteProperty(input.current.report, 'batchKey')
    expect(() => computeGateVerdict(input)).toThrow(TypeError)
  })
})
