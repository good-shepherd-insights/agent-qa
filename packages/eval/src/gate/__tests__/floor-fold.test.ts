import { sha256hex } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { canonicalJson } from '../../canonical-json'
import { buildEvalReport } from '../../match/metrics'
import { FLOOR_AXES, axisVectors } from '../../stats/decision-vector'
import type { DecisionCorrectnessVector, FloorAxis } from '../../stats/decision-vector'
import { wilsonInterval } from '../../stats/wilson'
import { FLOOR_SPLITS, assertFloorArtefactCommittable, guardNoiseFloorArtefact } from '../floor-artefact'
import { deriveMinimumGateSet, foldNoiseFloorArtefact } from '../floor-fold'
import type { FoldNoiseFloorInput } from '../floor-fold'

function vector(i: number): DecisionCorrectnessVector {
  return {
    key: `synthetic-cassette-${i}#-#0`,
    cassetteId: `synthetic-cassette-${i}`,
    decisionOrdinal: 0,
    product: i < 6 || i === 10 ? 'example-web' : 'bare-maps',
    briefSource: i === 10 ? 'rendered' : i < 6 ? 'proof' : 'empty',
    axes: {
      headline: i === 9 ? 'incorrect' : 'correct',
      elementIdentity: 'correct',
      value: i === 0 || i === 6 || i === 10 ? 'correct' : 'not-applicable',
      opClass: 'correct',
      sideEffect: 'correct',
      loop: 'not-applicable',
    },
  }
}

function inputFixture(): FoldNoiseFloorInput {
  return {
    profile: {
      profileKey: 'synthetic-profile',
      fingerprint: 'synthetic-fingerprint',
      plannerModelId: 'synthetic-planner',
      matcherVersion: 1,
      judgeModelId: 'synthetic-judge',
      judgeVersion: 2,
    },
    corpusDigest: 'synthetic-corpus-digest',
    partitionVersion: 1,
    seeds: [11, 29],
    repeats: 3,
    bootstrapSeed: 19,
    runs: [11, 11, 11, 29].map((seed, index) => {
      const report = buildEvalReport([], undefined, undefined, { declaredSeed: seed })
      report.headline.firstAttemptDecisionAccuracy = { numerator: 12, denominator: 13 }
      report.totalCost = {
        sampleCount: 11 + index,
        samplesMissingTokenUsage: index,
        promptTokens: 101 + index,
        completionTokens: 31 + index,
        totalTokens: 132 + index * 2,
        durationMs: 500 + index,
      }
      report.honesty.refusalCounts['unrenderable-brief'] = index + 1
      report.honesty.harnessErrorCount = index
      report.honesty.judge.cost = {
        calls: index + 1,
        inputTokens: 10 + index,
        outputTokens: 2 + index,
        outcomesMissingUsage: index,
      }
      report.briefSourceCounts = { proof: 6, empty: 4, rendered: 1 }
      return {
        index,
        seed,
        report,
        vectors: Array.from({ length: 11 }, (_, i) => vector(i)),
        wallClockMs: 700 + index,
      }
    }),
    splitByCassetteId: new Map([
      ['synthetic-cassette-0', 'natural'],
      ['synthetic-cassette-1', 'natural'],
      ['synthetic-cassette-6', 'natural'],
      ['synthetic-cassette-2', 'held-out-shared'],
      ['synthetic-cassette-3', 'held-out-shared'],
      ['synthetic-cassette-7', 'held-out-shared'],
      ['synthetic-cassette-4', 'held-out-private'],
      ['synthetic-cassette-5', 'held-out-private'],
      ['synthetic-cassette-8', 'held-out-private'],
      ['synthetic-cassette-10', 'held-out-private'],
    ]),
    censusByProduct: {
      'example-web': { natural: 2, heldOutShared: 2, heldOutPrivate: 3 },
      'bare-maps': { natural: 1, heldOutShared: 1, heldOutPrivate: 1 },
    },
  }
}

function flip(input: FoldNoiseFloorInput, run: number, key: number, axis: FloorAxis): void {
  input.runs[run]!.vectors[key]!.axes[axis] = 'incorrect'
}

describe('derived minimum gate set', () => {
  it.each([[0.05, 192], [0.10, 48], [0.15, 21], [0.20, 10], [0.9, 3]])(
    'inverts Wilson at 41/48 for floor %s to %s decisions',
    (floor, value) => {
      expect(deriveMinimumGateSet({ baselineRate: { correct: 41, n: 48 }, floor })).toEqual({
        lowerBound: 3,
        baselineRate: { correct: 41, n: 48 },
        floor,
        value,
        derivation: 'smallest n whose Wilson half-width at round(p*n)/n is <= floor, lower bound 3 decisions (MIN_LIFT_DECISIONS)',
        searchedUpTo: 100000,
      })
    },
  )

  it('discloses an absent floor, empty reference and exhausted search without a value', () => {
    const absent = deriveMinimumGateSet({ baselineRate: { correct: 0, n: 0 } })
    expect(absent).not.toHaveProperty('floor')
    expect(absent).not.toHaveProperty('value')
    expect(absent.derivation).toMatch(/absent|no applicable/i)
    const noReference = deriveMinimumGateSet({ baselineRate: { correct: 0, n: 0 }, floor: 0.1 })
    expect(noReference).not.toHaveProperty('value')
    expect(noReference.derivation).toMatch(/reference|baseline/i)
    const exhausted = deriveMinimumGateSet({ baselineRate: { correct: 41, n: 48 }, floor: 1e-10 })
    expect(exhausted).toMatchObject({ searchedUpTo: 100000, floor: 1e-10 })
    expect(exhausted).not.toHaveProperty('value')
    expect(exhausted.derivation).toContain('exhausted')
  })

  it.each([
    { baselineRate: { correct: 2, n: 1 }, floor: 0.1 },
    { baselineRate: { correct: -1, n: 1 }, floor: 0.1 },
    { baselineRate: { correct: 1, n: 1.5 }, floor: 0.1 },
    { baselineRate: { correct: 1, n: 2 }, floor: -0.1 },
    { baselineRate: { correct: 1, n: 2 }, floor: NaN },
  ])('rejects invalid derivation inputs %j', input => {
    expect(() => deriveMinimumGateSet(input)).toThrow(TypeError)
  })
})

describe('pure noise-floor fold', () => {
  it.each(['empty-reference', 'all-errors'] as const)(
    'refuses admission of a folded %s measurement', kind => {
      const input = inputFixture()
      for (const run of input.runs) run.report.honesty.harnessErrorCount = 0
      input.runs[0]!.vectors = []
      if (kind === 'all-errors') {
        for (const run of input.runs) {
          run.vectors = []
          run.report.honesty.harnessErrorCount = 11
        }
      }
      const floor = foldNoiseFloorArtefact(input)
      expect(guardNoiseFloorArtefact(floor).kind).toBe('ok')
      expect(assertFloorArtefactCommittable(floor)).toMatchObject({
        ok: false, refusal: { kind: 'unusable-measurement' },
      })
    },
  )

  it('measures only proof + empty, retains per-axis n, and counts rendered exclusions once', () => {
    const input = inputFixture()
    const artefact = foldNoiseFloorArtefact(input)
    expect(artefact.population).toEqual({
      included: { proof: 6, empty: 4 },
      excludedRendered: 1,
      refusals: input.runs[0]!.report.honesty.refusalCounts,
      unpartitioned: 1,
    })
    const eligible = input.runs[0]!.vectors.filter(v => v.briefSource !== 'rendered')
    for (const axis of FLOOR_AXES) {
      const projected = axisVectors(eligible, axis)
      expect(artefact.axes[axis].n, axis).toBe(projected.length)
      if (projected.length > 0) {
        expect(artefact.axes[axis].aggregateFloor).toBe(artefact.axes[axis].wilsonHalfWidth)
        expect(artefact.axes[axis]).toMatchObject({ sameSeedSpread: 0, twoSeedSpread: 0 })
      } else {
        expect(artefact.axes[axis]).toEqual({ n: 0, pairs: [] })
      }
    }
    expect(artefact.axes.value.n).toBe(2)
    expect(artefact.runs.map(run => run.headline)).toEqual(Array(4).fill({ correct: 9, n: 10 }))
    expect(artefact.runs.map(run => run.seed)).toEqual([11, 11, 11, 29])
    expect(artefact.seeds).toEqual([11, 29])
    expect(artefact.repeats).toBe(3)
    expect(artefact.seedHonored).toBe(true)
    expect(guardNoiseFloorArtefact(JSON.parse(JSON.stringify(artefact))).kind).toBe('ok')
  })

  it('retains every repeat pair with global run indices and exact McNemar evidence', () => {
    const input = inputFixture()
    flip(input, 3, 0, 'headline')
    const { pairs } = foldNoiseFloorArtefact(input).axes.headline
    expect(pairs.map(({ a, b, kind }) => ({ a, b, kind }))).toEqual([
      { a: 0, b: 1, kind: 'same-seed' },
      { a: 0, b: 2, kind: 'same-seed' },
      { a: 1, b: 2, kind: 'same-seed' },
      { a: 0, b: 3, kind: 'two-seed' },
      { a: 1, b: 3, kind: 'two-seed' },
      { a: 2, b: 3, kind: 'two-seed' },
    ])
    expect(pairs[3]).toMatchObject({ n: 10, aOnly: 1, bOnly: 0, deltaAcc: 1 / 10, flipRate: 1 / 10, mcnemarP: 1 })
  })

  it('derives every product minimum from its own floor and rate, and copies its census', () => {
    const input = inputFixture()
    input.baselineRate = { correct: 41, n: 48, batchKey: 'synthetic-baseline-batch' }
    const artefact = foldNoiseFloorArtefact(input)
    for (const [product, record] of Object.entries(artefact.products)) {
      const baselineRate = record.axes.headline.reference!
      expect(record.minimumGateSet).toEqual({
        ...deriveMinimumGateSet({ baselineRate, floor: record.axes.headline.aggregateFloor }),
        baselineRateSource: 'reference-run',
      })
      expect(record.census).toEqual(input.censusByProduct[product])
    }
    expect(artefact.products['example-web']).toMatchObject({ populatedBriefs: 7, axes: { headline: { n: 6 } } })
    expect(artefact.products['bare-maps']).toMatchObject({ populatedBriefs: 0, axes: { headline: { n: 4 } } })
    expect(artefact.minimumGateSet).toEqual({
      ...deriveMinimumGateSet({ baselineRate: { correct: 41, n: 48 }, floor: artefact.axes.headline.aggregateFloor }),
      baselineRateSource: 'designated-baseline',
      baselineBatchKey: 'synthetic-baseline-batch',
    })
    delete input.baselineRate
    expect(foldNoiseFloorArtefact(input).minimumGateSet).toMatchObject({
      baselineRateSource: 'reference-run',
      baselineRate: { correct: 9, n: 10 },
    })
  })

  it('discloses census-only products with no applicable floor or invented minimum', () => {
    const input = inputFixture()
    input.censusByProduct = { ...input.censusByProduct, 'empty-product': { natural: 1, heldOutShared: 2, heldOutPrivate: 3 } }
    const product = foldNoiseFloorArtefact(input).products['empty-product']!
    expect(product.axes.headline).toEqual({ n: 0, pairs: [] })
    expect(product.populatedBriefs).toBe(0)
    expect(product.minimumGateSet).not.toHaveProperty('value')
    expect(product.census).toEqual({ natural: 1, heldOutShared: 2, heldOutPrivate: 3 })
  })

  it('records per-split in-floor null lifts and deterministic bootstrap without private identities', () => {
    const input = inputFixture()
    const first = foldNoiseFloorArtefact(input)
    const second = foldNoiseFloorArtefact(input)
    expect(first.bootstrap).toEqual({ B: 2000, seed: 19 })
    expect(first.splits.natural).not.toHaveProperty('nullLift')
    for (const split of FLOOR_SPLITS) {
      expect(first.splits[split].axes.headline.n).toBe(3)
      if (split === 'natural') continue
      expect(first.splits[split].nullLift).toEqual([1, 2, 3].map(b => ({
        pair: { a: 0, b },
        optimizeLift: { n: 3, deltaAcc: 0 },
        heldOutLift: { n: 3, deltaAcc: 0 },
        verdict: 'in-floor',
        bootstrapCI: { lower: 0, upper: 0, B: 2000 },
      })))
      expect(first.splits[split]).toEqual(second.splits[split])
    }
    expect(JSON.stringify(first.splits)).not.toContain('synthetic-cassette')
  })

  it('joins bootstrap pairs by decision key even when another run is reordered', () => {
    const input = inputFixture()
    flip(input, 1, 4, 'headline')
    const expected = foldNoiseFloorArtefact(input)
    input.runs[1]!.vectors = [...input.runs[1]!.vectors].reverse()
    expect(foldNoiseFloorArtefact(input).splits).toEqual(expected.splits)
    expect(expected.splits['held-out-private'].nullLift![0]).toMatchObject({
      heldOutLift: { n: 3, deltaAcc: 1 / 3 },
      bootstrapCI: { lower: -1, upper: 0, B: 2000 },
    })
  })

  it('omits a CI for an empty held-out population without bootstrapping an empty array', () => {
    const input = inputFixture()
    input.splitByCassetteId = new Map()
    const artefact = foldNoiseFloorArtefact(input)
    expect(artefact.population.unpartitioned).toBe(10)
    for (const record of artefact.splits['held-out-private'].nullLift!) {
      expect(record).toEqual({ pair: { a: 0, b: record.pair.b }, optimizeLift: { n: 0 }, heldOutLift: { n: 0 }, verdict: 'in-floor' })
    }
  })

  it('preserves exact 1/n spread and the larger Wilson term without rounding', () => {
    const input = inputFixture()
    for (const run of input.runs) run.vectors = run.vectors.slice(0, 3)
    flip(input, 3, 0, 'headline')
    const artefact = foldNoiseFloorArtefact(input)
    expect(artefact.axes.headline.aggregateFloor).toBe(Math.max(1 / 3, wilsonInterval(3, 3)!.halfWidth))
    expect(artefact.axes.headline.twoSeedSpread).toBe(1 / 3)
    expect(artefact.axes.elementIdentity.aggregateFloor).toBe(wilsonInterval(3, 3)!.halfWidth)
  })

  it.each([false, undefined])('discloses seed support %s without fabricating a run stamp', seedHonored => {
    const input = inputFixture()
    if (seedHonored === undefined) delete input.runs[2]!.report.seedHonored
    else input.runs[2]!.report.seedHonored = seedHonored
    const artefact = foldNoiseFloorArtefact(input)
    expect(artefact.seedHonored).toBe(false)
    if (seedHonored === undefined) expect(artefact.runs[2]).not.toHaveProperty('seedHonored')
    else expect(artefact.runs[2]!.seedHonored).toBe(false)
  })

  it('sums actual report cost fields, preserves missing-usage disclosure, and hashes each report', () => {
    const input = inputFixture()
    const artefact = foldNoiseFloorArtefact(input)
    expect(artefact.cost).toEqual({
      sampleCount: 50,
      samplesMissingTokenUsage: 6,
      promptTokens: 410,
      completionTokens: 130,
      totalTokens: 540,
      durationMs: 2006,
      wallClockMs: 2806,
      judgeCost: { calls: 10, inputTokens: 46, outputTokens: 14, outcomesMissingUsage: 6 },
    })
    for (const [i, run] of artefact.runs.entries()) {
      expect(run.cost).toEqual({
        ...input.runs[i]!.report.totalCost,
        judgeCost: input.runs[i]!.report.honesty.judge.cost,
        wallClockMs: 700 + i,
      })
      expect(run.cost).not.toHaveProperty('modelCalls')
      expect(run.reportDigest).toBe(sha256hex(canonicalJson(input.runs[i]!.report)))
      expect(run.harnessErrorCount).toBe(i)
      expect(run.briefSourceCounts).toEqual(input.runs[i]!.report.briefSourceCounts)
      expect(run.refusalCounts).toEqual(input.runs[i]!.report.honesty.refusalCounts)
    }
  })

  it('copies observed model calls including zero and sums only fully observed repeats', () => {
    const input = inputFixture()
    for (const [i, run] of input.runs.entries()) run.modelCalls = i
    const complete = foldNoiseFloorArtefact(input)
    expect(complete.runs.map(run => run.cost.modelCalls)).toEqual([0, 1, 2, 3])
    expect(complete.cost.modelCalls).toBe(6)
    delete input.runs[3]!.modelCalls
    const partial = foldNoiseFloorArtefact(input)
    expect(partial.runs[0]!.cost.modelCalls).toBe(0)
    expect(partial.runs[3]!.cost).not.toHaveProperty('modelCalls')
    expect(partial.cost).not.toHaveProperty('modelCalls')
  })

  it('does not mutate or retain mutable input records', () => {
    const input = inputFixture()
    const before = structuredClone(input)
    const artefact = foldNoiseFloorArtefact(input)
    expect(input).toEqual(before)
    artefact.population.refusals['unrenderable-brief'] = 999
    artefact.products['example-web']!.census.natural = 999
    artefact.minimumGateSet.baselineRate.correct = 999
    expect(input).toEqual(before)
  })

  it.each([
    (input: FoldNoiseFloorInput) => { input.runs[0]!.seed = 29 },
    (input: FoldNoiseFloorInput) => { input.runs[3]!.seed = 11 },
    (input: FoldNoiseFloorInput) => { input.runs = input.runs.slice(0, 3) },
    (input: FoldNoiseFloorInput) => { input.runs[1]!.index = 5 },
    (input: FoldNoiseFloorInput) => { input.seeds = [11, 11] },
    (input: FoldNoiseFloorInput) => { input.repeats = 2 },
  ])('refuses an inconsistent run protocol before folding', change => {
    const input = inputFixture()
    change(input)
    expect(() => foldNoiseFloorArtefact(input)).toThrow(TypeError)
  })
})
