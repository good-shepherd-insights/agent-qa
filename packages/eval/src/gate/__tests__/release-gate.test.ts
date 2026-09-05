import { describe, expect, it } from 'vitest'

import { projectBaselinePointer } from '../../baseline/profile-key'
import { assertBaselineComparator, renderBaselineComparatorRefusal } from '../../baseline/comparator'
import { projectDecisionVectorsDocument } from '../../match/decision-vectors'
import { buildEvalReport } from '../../match/metrics'
import { REPLAY_REFUSAL_REASONS } from '../../replay/result'
import type { DecisionCorrectnessVector } from '../../stats/decision-vector'
import { foldNoiseFloorArtefact } from '../floor-fold'
import { computeGateVerdict, renderGateLines } from '../release-gate'
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

function comparisonFixture() {
  const input = fixture()
  input.floor.axes.headline.aggregateFloor = 0.0996
  input.floor.axes.opClass.aggregateFloor = 0.0996
  return input
}

describe('release gate paired regressions', () => {
  it('returns exit 0 for identical 48-decision headline vectors', () => {
    const verdict = computeGateVerdict(comparisonFixture())
    expect(verdict.exit).toBe(0)
    expect(verdict.regressions).toEqual([])
    expect(verdict.pairing).toMatchObject({ n: 48, discordant: 0 })
  })

  it('returns exit 1 with current-minus-baseline headline delta beyond its floor', () => {
    const input = comparisonFixture()
    input.current.vectors.slice(0, 6).forEach(v => { v.axes.headline = 'incorrect' })
    // Deliberately unrelated aggregates: only shared correctness vectors supply the rates.
    input.baseline.report.headline.firstAttemptDecisionAccuracy = { numerator: 1, denominator: 100 }
    input.current.report.headline.firstAttemptDecisionAccuracy = { numerator: 100, denominator: 100 }
    const verdict = computeGateVerdict(input)
    expect(verdict.exit).toBe(1)
    expect(verdict.regressions).toEqual([
      { axis: 'headline', baseline: 41 / 48, current: 35 / 48, delta: -6 / 48, floor: 0.0996, n: 48 },
    ])
    expect(verdict.pairing).toMatchObject({ n: 48, discordant: 6 })
  })

  it('returns exit 0 for a one-decision worsening within the floor', () => {
    const input = comparisonFixture()
    input.current.vectors[0]!.axes.headline = 'incorrect'
    expect(computeGateVerdict(input)).toMatchObject({ exit: 0, regressions: [] })
  })

  it('does not trip exactly at the floor because raw discordant counts avoid cancellation error', () => {
    const input = comparisonFixture()
    input.floor.axes.headline.aggregateFloor = 1 / 48
    input.current.vectors[0]!.axes.headline = 'incorrect'
    expect(computeGateVerdict(input)).toMatchObject({ exit: 0, regressions: [] })
  })

  it('returns exit 1 for opClass alone while headline remains within its floor', () => {
    const input = comparisonFixture()
    input.current.vectors.slice(0, 6).forEach(v => { v.axes.opClass = 'incorrect' })
    input.current.vectors[0]!.axes.headline = 'incorrect'
    const verdict = computeGateVerdict(input)
    expect(verdict.exit).toBe(1)
    expect(verdict.regressions).toEqual([
      { axis: 'opClass', baseline: 1, current: 42 / 48, delta: -6 / 48, floor: 0.0996, n: 48 },
    ])
  })

  it('lists every tripped axis in declaration order', () => {
    const input = comparisonFixture()
    for (const v of input.current.vectors.slice(0, 6)) {
      v.axes.headline = 'incorrect'
      v.axes.opClass = 'incorrect'
      v.axes.value = 'incorrect'
    }
    expect(computeGateVerdict(input).regressions.map(entry => entry.axis)).toEqual(['headline', 'value', 'opClass'])
  })

  it('returns exit 0 when the current run improves by 10/48 (one-sided gate)', () => {
    const input = comparisonFixture()
    input.baseline.vectors.vectors.slice(0, 10).forEach(v => { v.axes.headline = 'incorrect' })
    expect(computeGateVerdict(input)).toMatchObject({ exit: 0, regressions: [], pairing: { n: 48, discordant: 10 } })
  })

  it('excludes current rendered vectors and counts both one-sided key populations without averaging', () => {
    const input = comparisonFixture()
    input.current.vectors.shift()
    input.current.vectors[0]!.briefSource = 'rendered'
    input.current.vectors.push(vector(48))
    const verdict = computeGateVerdict(input)
    expect(verdict).toMatchObject({
      exit: 0, regressions: [],
      pairing: { n: 46, discordant: 0, baselineOnly: 2, currentOnly: 1, renderedExcluded: 1 },
    })
  })

  it('excludes baseline rendered vectors and still includes empty-brief vectors', () => {
    const input = comparisonFixture()
    input.baseline.vectors.vectors[0]!.briefSource = 'rendered'
    input.current.vectors[0]!.axes.headline = 'incorrect'
    expect(computeGateVerdict(input)).toMatchObject({
      exit: 0, pairing: { n: 47, currentOnly: 1, baselineOnly: 0, renderedExcluded: 0 },
    })
  })

  it('skips an axis with no floor and a non-headline axis with no paired decisions', () => {
    const input = comparisonFixture()
    input.floor.axes.value = { n: 0, pairs: [] }
    input.current.vectors.forEach(v => {
      v.axes.value = 'incorrect'
      v.axes.elementIdentity = 'not-applicable'
    })
    const verdict = computeGateVerdict(input)
    expect(verdict.exit).toBe(0)
    expect(verdict.skippedAxes).toEqual([
      { axis: 'elementIdentity', reason: 'no paired decisions' },
      { axis: 'value', reason: 'no applicable decisions in the floor' },
      { axis: 'loop', reason: 'no applicable decisions in the floor' },
    ])
  })

  it('keeps each axis denominator restricted to decisions applicable on both sides', () => {
    const input = comparisonFixture()
    input.current.vectors.forEach((v, i) => { v.axes.opClass = i < 4 ? 'incorrect' : 'not-applicable' })
    const regression = computeGateVerdict(input).regressions.find(entry => entry.axis === 'opClass')
    expect(regression).toEqual({ axis: 'opClass', baseline: 1, current: 0, delta: -1, floor: 0.0996, n: 4 })
  })

  it.each(['current', 'baseline', 'disjoint', 'rendered', 'both', 'non-applicable'] as const)(
    'returns one no-decision-vector reason for %s empty headline pairing', kind => {
      const input = comparisonFixture()
      if (kind === 'current' || kind === 'both') input.current.vectors = []
      if (kind === 'baseline' || kind === 'both') input.baseline.vectors.vectors = []
      if (kind === 'disjoint') input.current.vectors.forEach(v => { v.key += '-other' })
      if (kind === 'rendered') input.current.vectors.forEach(v => { v.briefSource = 'rendered' })
      if (kind === 'non-applicable') input.current.vectors.forEach(v => { v.axes.headline = 'not-applicable' })
      const verdict = computeGateVerdict(input)
      expect(verdict.exit).toBe(2)
      expect(verdict.regressions).toEqual([])
      expect(verdict.pairing.n).toBe(0)
      expect(verdict.inconclusive).toHaveLength(1)
      const detail = verdict.inconclusive[0]!.detail
      expect(verdict.inconclusive[0]!.reason).toBe('no-decision-vector')
      if (kind === 'baseline' || kind === 'both') {
        expect(detail).toMatch(/^baseline: zero decision vectors/)
        expect(detail).toContain(`current has ${kind === 'both' ? 0 : 48}`)
        if (kind === 'both') expect(detail).toContain('current: zero decision vectors')
      } else if (kind === 'current' || kind === 'rendered') {
        expect(detail).toMatch(/^current: zero decision vectors/)
        expect(detail).toContain('baseline has 48')
        expect(detail).toContain(`rendered excluded: ${kind === 'rendered' ? 48 : 0}`)
      } else {
        expect(detail).toMatch(/^no paired keys:/)
        expect(detail).toContain('baseline 48')
        expect(detail).toContain('current 48')
        expect(detail).toContain('shared 0')
      }
    },
  )

  it('collects all applicable reasons even when stale inputs coincide with an empty pairing', () => {
    const input = comparisonFixture()
    input.pointer.pointer.fingerprint = 'old-fingerprint'
    input.pointer.pointer.corpusDigest = 'old-baseline-corpus'
    input.floor.corpusDigest = 'old-floor-corpus'
    input.current.report.seedHonored = false
    input.current.report.honesty.harnessErrorCount = 1
    input.current.report.honesty.neverScoredCounts['all-samples-harness-error'] = 1
    input.current.report.honesty.refusalCounts['missing-blob'] = 2
    input.current.vectors = []
    const verdict = computeGateVerdict(input)
    expect(verdict.exit).toBe(2)
    expect(verdict.inconclusive.map(entry => entry.reason)).toEqual([
      'incomparable-baseline', 'stale-baseline', 'stale-floor', 'seed-regime-mismatch',
      'harness-errors', 'never-scored', 'refusal-population-differs', 'no-decision-vector',
    ])
    expect(verdict.regressions).toEqual([])
  })

  it('collects both empty sides when baseline decisions.json and current vectors are absent', () => {
    const input = comparisonFixture()
    input.current.vectors = []
    const detail = reason({ ...input, baseline: { report: input.baseline.report } }, 'no-decision-vector')
    expect(detail).toMatch(/^baseline:/)
    expect(detail).toContain('current: zero decision vectors')
  })

  it.each(['baseline', 'current'] as const)('turns duplicate %s vector keys into inconclusive evidence without deduplicating', side => {
    const input = comparisonFixture()
    if (side === 'baseline') input.baseline.vectors.vectors = [...input.baseline.vectors.vectors, input.baseline.vectors.vectors[0]!]
    else input.current.vectors.push(input.current.vectors[0]!)
    input.floor.corpusDigest = 'stale-corpus'
    expect(reason(input, 'no-decision-vector')).toContain(`${side}: duplicate decision key`)
    const verdict = computeGateVerdict(input)
    expect(verdict.inconclusive.map(entry => entry.reason)).toEqual(['stale-floor', 'no-decision-vector'])
    expect(verdict).toMatchObject({
      regressions: [], pairing: { n: 0 }, population: { proof: 24, empty: 24, rendered: 0 },
    })
  })

  it.each(['baseline', 'current'] as const)('refuses missing or malformed %s harness and never-scored evidence', side => {
    for (const invalid of [undefined, null, '0', -1, NaN]) {
      const input = comparisonFixture()
      Reflect.set(input[side].report.honesty, 'harnessErrorCount', invalid)
      expect(reason(input, 'harness-errors')).toContain(`${side}=`)
    }
    for (const invalid of [undefined, null, [], {}, { 'all-samples-harness-error': 0 }, { bad: '0' }]) {
      const input = comparisonFixture()
      Reflect.set(input[side].report.honesty, 'neverScoredCounts', invalid)
      expect(reason(input, 'never-scored')).toContain(side)
    }
    const input = comparisonFixture()
    input[side].report.honesty.neverScoredCounts['all-samples-harness-error'] = -1
    expect(reason(input, 'never-scored')).toContain(side)
  })

  it.each(['baseline', 'current'] as const)('refuses absent %s honesty and keeps collecting empty-pairing evidence', side => {
    const input = comparisonFixture()
    Reflect.deleteProperty(input[side].report, 'honesty')
    input.current.vectors = []
    const verdict = computeGateVerdict(input)
    expect(verdict.exit).toBe(2)
    expect(verdict.inconclusive.map(entry => entry.reason)).toEqual([
      'harness-errors', 'never-scored', 'refusal-population-differs', 'no-decision-vector',
    ])
    expect(verdict.refusals[side]).toEqual({})
  })

  it('refuses invalid refusal counts while retaining the historical missing-key exemption', () => {
    const input = comparisonFixture()
    Reflect.set(input.current.report.honesty.refusalCounts, 'missing-blob', '0')
    expect(reason(input, 'refusal-population-differs')).toContain('current')
  })

  it('refuses current mixed judge identity even when both reports omit a single judge block', () => {
    const input = comparisonFixture()
    input.current.report.judgeIdentity = 'mixed'
    input.current.report.mixedJudgeModelIds = ['current-judge-a', 'current-judge-b']
    const detail = reason(input, 'incomparable-baseline')
    expect(detail).toContain('current:')
    expect(detail).toContain('mixed-judge-identity')
    expect(detail).toContain('current-judge-a')
    expect(detail).toContain('current-judge-b')
  })

  it('does not mutate reports, vectors, pointers, or floors', () => {
    const input = comparisonFixture()
    const before = structuredClone(input)
    computeGateVerdict(input)
    expect(input).toEqual(before)
  })
})

describe('release gate lines', () => {
  it.each([0, 1, 2] as const)('prints both refusal populations and all disclosures for exit %s', exit => {
    const input = comparisonFixture()
    input.current.report.honesty.refusalCounts['missing-blob'] = 24
    input.baseline.report.honesty.refusalCounts['missing-blob'] = 24
    if (exit === 1) input.current.vectors.slice(0, 6).forEach(v => { v.axes.opClass = 'incorrect' })
    if (exit === 2) {
      input.floor.corpusDigest = 'stale-corpus'
      input.current.vectors = []
    }
    const verdict = computeGateVerdict(input)
    const lines = renderGateLines(verdict)
    expect(lines[0]).toBe(`release-gate: exit ${exit} — ${[
      'no regression beyond the floor', 'regression beyond the floor', 'inconclusive',
    ][exit]}`)
    for (const prefix of ['refusals: baseline ', 'refusals: current ', 'pairing: ', 'seed: ', 'population: ']) {
      expect(lines.filter(line => line.startsWith(prefix))).toHaveLength(1)
    }
    expect(lines.filter(line => line.startsWith('inconclusive: '))).toEqual(
      verdict.inconclusive.map(entry => `inconclusive: ${entry.reason}: ${entry.detail}`),
    )
    const b = lines.findIndex(line => line.startsWith('refusals: baseline '))
    expect(lines[b + 1]).toMatch(/^refusals: current /)
    expect(lines[b + 2]).toMatch(/^pairing: n=\d+ discordant=\d+ baselineOnly=\d+ currentOnly=\d+ renderedExcluded=\d+$/)
    expect(lines[b + 3]).toBe('seed: current=true floor=true regime=match')
    expect(lines[b + 4]).toBe('population: proof=24 empty=24 rendered=0')
    expect(lines.filter(line => line.startsWith('regression: ')).some(line => line.includes('missing-blob'))).toBe(false)
    const refusalJson = JSON.parse(lines[b]!.slice('refusals: baseline '.length)) as Record<string, number>
    expect(Object.keys(refusalJson)).toEqual([...REPLAY_REFUSAL_REASONS].sort())
    expect(refusalJson['missing-blob']).toBe(24)
    if (exit === 1) expect(lines).toContain('regression: opClass baseline=1 current=0.875 delta=-0.125 floor=0.0996 n=48')
    if (exit === 0) expect(lines).toContain('skipped: loop: no applicable decisions in the floor')
  })

  it('prints raw regression doubles without rounding', () => {
    const input = comparisonFixture()
    input.floor.axes.headline.aggregateFloor = 0.001
    input.current.vectors[0]!.axes.headline = 'incorrect'
    expect(renderGateLines(computeGateVerdict(input))).toContain(
      `regression: headline baseline=${41 / 48} current=${40 / 48} delta=${-1 / 48} floor=0.001 n=48`,
    )
  })

  it('prints absent seed evidence as absent and unknown', () => {
    const input = comparisonFixture()
    input.current.report.seedHonored = undefined
    expect(renderGateLines(computeGateVerdict({ ...input, floor: undefined }))).toContain(
      'seed: current=absent floor=absent regime=unknown',
    )
  })
})
