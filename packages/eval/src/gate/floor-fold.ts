/** Pure floor fold: supplied runs, split membership, and cost evidence only. */
import { sha256hex } from '@vostride/agent-qa-schema'

import { canonicalJson } from '../canonical-json'
import type { EvalBatchReport } from '../match/metrics'
import { BOOTSTRAP_B, pairedBootstrapCI } from '../stats/bootstrap'
import { axisVectors } from '../stats/decision-vector'
import type { DecisionCorrectnessVector, FloorAxis } from '../stats/decision-vector'
import { MIN_LIFT_DECISIONS, generalizationRatio } from '../stats/generalization'
import { computeNoiseFloor } from '../stats/noise-floor'
import { mcnemarExactP, pairedDecisionDiff } from '../stats/paired'
import type { DecisionVector, PairedDecisionDiff } from '../stats/paired'
import { createSeededRng } from '../stats/prng'
import { wilsonInterval } from '../stats/wilson'
import {
  FLOOR_PROTOCOL_MINIMUM,
  FLOOR_SPLITS,
  NOISE_FLOOR_METHOD,
  NOISE_FLOOR_SCHEMA_VERSION,
  guardNoiseFloorArtefact,
} from './floor-artefact'
import type {
  AxisFloorRecord,
  AxisFloorSet,
  FloorRunRecord,
  FloorSplit,
  MinimumGateSetRecord,
  NoiseFloorArtefact,
  NullLiftRecord,
  ProductFloorRecord,
  RunCostRecord,
  SplitFloorRecord,
} from './floor-artefact'

export interface FloorRunInput {
  index: number
  seed: number
  report: EvalBatchReport
  vectors: readonly DecisionCorrectnessVector[]
  wallClockMs: number
  /** Observed provider calls, including judge calls and retries; never inferred from samples. */
  modelCalls?: number
}

export interface FoldNoiseFloorInput {
  profile: {
    profileKey: string
    fingerprint: string
    plannerModelId: string
    matcherVersion: number
    judgeModelId?: string
    judgeVersion?: number
  }
  corpusDigest: string
  partitionVersion: number
  seeds: readonly number[]
  repeats: number
  bootstrapSeed: number
  runs: readonly FloorRunInput[]
  splitByCassetteId: ReadonlyMap<string, FloorSplit>
  censusByProduct: Readonly<Record<string, { natural: number; heldOutShared: number; heldOutPrivate: number }>>
  baselineRate?: { correct: number; n: number; batchKey: string }
  classifierRepeatability?: unknown
  explanation?: string
}

export function deriveMinimumGateSet(
  input: { baselineRate: { correct: number; n: number }; floor?: number },
): Omit<MinimumGateSetRecord, 'baselineRateSource' | 'baselineBatchKey'> {
  const { baselineRate, floor } = input
  const { correct, n } = baselineRate
  if (
    !Number.isSafeInteger(correct) || !Number.isSafeInteger(n) ||
    correct < 0 || n < 0 || correct > n ||
    (floor !== undefined && (!Number.isFinite(floor) || floor < 0 || floor > 1))
  ) {
    throw new TypeError('minimum gate set requires valid baseline counts and a floor in [0, 1]')
  }
  const record: Omit<MinimumGateSetRecord, 'baselineRateSource' | 'baselineBatchKey'> = {
    lowerBound: MIN_LIFT_DECISIONS,
    baselineRate: { correct, n },
    ...(floor === undefined ? {} : { floor }),
    derivation: 'smallest n whose Wilson half-width at round(p*n)/n is <= floor, lower bound 3 decisions (MIN_LIFT_DECISIONS)',
    searchedUpTo: 100000,
  }
  if (floor === undefined) {
    return { ...record, derivation: `${record.derivation}; floor absent (no applicable axis decisions)` }
  }
  if (n === 0) {
    return { ...record, derivation: `${record.derivation}; baseline reference has no applicable decisions` }
  }
  const p = correct / n
  for (let candidate = 1; candidate <= record.searchedUpTo; candidate++) {
    if (wilsonInterval(Math.round(p * candidate), candidate)!.halfWidth <= floor) {
      return { ...record, value: Math.max(MIN_LIFT_DECISIONS, candidate) }
    }
  }
  return { ...record, derivation: `${record.derivation}; search exhausted at ${record.searchedUpTo}` }
}

function mapAxes<T>(project: (axis: FloorAxis) => T): Record<FloorAxis, T> {
  return {
    headline: project('headline'),
    elementIdentity: project('elementIdentity'),
    value: project('value'),
    opClass: project('opClass'),
    sideEffect: project('sideEffect'),
    loop: project('loop'),
  }
}

function correctness(vectors: readonly DecisionVector[]): { correct: number; n: number } {
  return { correct: vectors.filter(vector => vector.correct).length, n: vectors.length }
}

function foldAxes(
  populations: readonly (readonly DecisionCorrectnessVector[])[],
  repeats: number,
): AxisFloorSet {
  return mapAxes(axis => {
    const { pairs, ...floor } = computeNoiseFloor({
      sameSeed: populations.slice(0, repeats).map(vectors => axisVectors(vectors, axis)),
      otherSeed: populations.slice(repeats).map(vectors => axisVectors(vectors, axis)),
    })
    return {
      ...floor,
      pairs: pairs.map(({ a, b, kind, diff }) => ({
        a,
        // The primitive's other-seed index is local; the document indexes its runs array.
        b: kind === 'two-seed' ? repeats + b : b,
        kind,
        n: diff.n,
        aOnly: diff.aOnly,
        bOnly: diff.bOnly,
        ...(diff.deltaAcc === undefined ? {} : { deltaAcc: diff.deltaAcc }),
        ...(diff.flipRate === undefined ? {} : { flipRate: diff.flipRate }),
        mcnemarP: mcnemarExactP(diff.aOnly, diff.bOnly),
      })),
    }
  })
}

function referenceMinimum(headline: AxisFloorRecord): MinimumGateSetRecord {
  return {
    ...deriveMinimumGateSet({
      baselineRate: headline.reference ?? { correct: 0, n: 0 },
      ...(headline.aggregateFloor === undefined ? {} : { floor: headline.aggregateFloor }),
    }),
    baselineRateSource: 'reference-run',
  }
}

function lift(diff: PairedDecisionDiff): NullLiftRecord['heldOutLift'] {
  return { n: diff.n, ...(diff.deltaAcc === undefined ? {} : { deltaAcc: diff.deltaAcc }) }
}

function nullLifts(
  natural: readonly (readonly DecisionCorrectnessVector[])[],
  heldOut: readonly (readonly DecisionCorrectnessVector[])[],
  floor: number,
  bootstrapSeed: number,
): NullLiftRecord[] {
  const naturalA = axisVectors(natural[0]!, 'headline')
  const heldOutA = axisVectors(heldOut[0]!, 'headline')
  return heldOut.slice(1).map((vectors, index) => {
    const b = index + 1
    const optimizeDiff = pairedDecisionDiff(naturalA, axisVectors(natural[b]!, 'headline'))
    const heldOutB = axisVectors(vectors, 'headline')
    const heldOutDiff = pairedDecisionDiff(heldOutA, heldOutB)
    const bByKey = new Map(heldOutB.map(vector => [vector.key, vector.correct]))
    // Match identities before dropping them; only the sampled counts/rates leave this fold.
    const pairs = [...heldOutA]
      .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
      .flatMap(a => {
        const other = bByKey.get(a.key)
        return other === undefined ? [] : [{ a: a.correct, b: other }]
      })
    return {
      pair: { a: 0, b },
      optimizeLift: lift(optimizeDiff),
      heldOutLift: lift(heldOutDiff),
      ...generalizationRatio({
        optimizeLiftDecisions: optimizeDiff.n,
        optimizeLiftRate: Math.abs(optimizeDiff.deltaAcc ?? 0),
        heldOutLiftRate: Math.abs(heldOutDiff.deltaAcc ?? 0),
        floor,
      }),
      ...(pairs.length === 0 ? {} : {
        bootstrapCI: pairedBootstrapCI(
          pairs,
          sample => sample.reduce((sum, pair) => sum + Number(pair.b) - Number(pair.a), 0) / sample.length,
          createSeededRng(bootstrapSeed),
        ),
      }),
    }
  })
}

function assertRunProtocol(input: FoldNoiseFloorInput): void {
  if (
    !Number.isSafeInteger(input.repeats) || input.repeats < FLOOR_PROTOCOL_MINIMUM.repeats ||
    input.seeds.length < FLOOR_PROTOCOL_MINIMUM.seeds ||
    new Set(input.seeds).size !== input.seeds.length ||
    !input.seeds.every(Number.isSafeInteger) ||
    input.runs.length !== input.repeats + input.seeds.length - 1
  ) {
    throw new TypeError('floor run protocol requires repeated first seed then one run per distinct remaining seed')
  }
  for (const [index, run] of input.runs.entries()) {
    const seed = index < input.repeats ? input.seeds[0] : input.seeds[index - input.repeats + 1]
    if (run.index !== index || run.seed !== seed) {
      throw new TypeError(`floor run ${index} must have index ${index} and seed ${seed}`)
    }
  }
}

function sumCosts(costs: readonly RunCostRecord[]): RunCostRecord {
  const total: RunCostRecord = { wallClockMs: costs.reduce((sum, cost) => sum + cost.wallClockMs, 0) }
  for (const key of [
    'modelCalls', 'sampleCount', 'samplesMissingTokenUsage',
    'promptTokens', 'completionTokens', 'totalTokens', 'durationMs',
  ] as const) {
    // Partial observations must not masquerade as the cost of every repeat.
    if (costs.every(cost => cost[key] !== undefined)) {
      total[key] = costs.reduce((sum, cost) => sum + cost[key]!, 0)
    }
  }
  if (costs.every(cost => cost.judgeCost !== undefined)) {
    total.judgeCost = { calls: 0, inputTokens: 0, outputTokens: 0, outcomesMissingUsage: 0 }
    for (const key of ['calls', 'inputTokens', 'outputTokens', 'outcomesMissingUsage'] as const) {
      total.judgeCost[key] = costs.reduce((sum, cost) => sum + cost.judgeCost![key], 0)
    }
  }
  return total
}

export function foldNoiseFloorArtefact(input: FoldNoiseFloorInput): NoiseFloorArtefact {
  assertRunProtocol(input)
  const populations = input.runs.map(run => run.vectors.filter(
    vector => vector.briefSource === 'proof' || vector.briefSource === 'empty',
  ))
  const reference = populations[0]!
  const axes = foldAxes(populations, input.repeats)
  const products: Record<string, ProductFloorRecord> = Object.fromEntries(
    [...new Set([
      ...Object.keys(input.censusByProduct),
      ...input.runs.flatMap(run => run.vectors.map(vector => vector.product)),
    ])].sort().map(product => {
      const census = input.censusByProduct[product]
      if (census === undefined) throw new TypeError(`floor product ${product} has no corpus census`)
      const productAxes = foldAxes(
        populations.map(vectors => vectors.filter(vector => vector.product === product)),
        input.repeats,
      )
      return [product, {
        axes: productAxes,
        minimumGateSet: referenceMinimum(productAxes.headline),
        census: { ...census },
        populatedBriefs: input.runs[0]!.vectors.filter(vector =>
          vector.product === product &&
          (vector.briefSource === 'proof' || vector.briefSource === 'rendered'),
        ).length,
      }]
    }),
  )
  const splitPopulations = (split: FloorSplit) => populations.map(vectors => vectors.filter(
    vector => input.splitByCassetteId.get(vector.cassetteId) === split,
  ))
  const natural = splitPopulations('natural')
  const splits = Object.fromEntries(FLOOR_SPLITS.map(split => {
    const selected = split === 'natural' ? natural : splitPopulations(split)
    const record: SplitFloorRecord = {
      axes: foldAxes(selected, input.repeats),
      ...(split === 'natural' ? {} : {
        nullLift: nullLifts(natural, selected, axes.headline.aggregateFloor ?? 0, input.bootstrapSeed),
      }),
    }
    return [split, record]
  })) as Record<FloorSplit, SplitFloorRecord>
  const runs: FloorRunRecord[] = input.runs.map((run, i) => {
    const runAxes = mapAxes(axis => correctness(axisVectors(populations[i]!, axis)))
    return {
      index: run.index,
      seed: run.seed,
      ...(run.report.seedHonored === undefined ? {} : { seedHonored: run.report.seedHonored }),
      headline: { ...runAxes.headline },
      axes: runAxes,
      refusalCounts: { ...run.report.honesty.refusalCounts },
      briefSourceCounts: { ...run.report.briefSourceCounts },
      harnessErrorCount: run.report.honesty.harnessErrorCount,
      cost: {
        ...run.report.totalCost,
        judgeCost: { ...run.report.honesty.judge.cost },
        ...(run.modelCalls === undefined ? {} : { modelCalls: run.modelCalls }),
        wallClockMs: run.wallClockMs,
      },
      reportDigest: sha256hex(canonicalJson(run.report)),
    }
  })
  const minimumGateSet: MinimumGateSetRecord = input.baselineRate === undefined
    ? referenceMinimum(axes.headline)
    : {
      ...deriveMinimumGateSet({
        baselineRate: { correct: input.baselineRate.correct, n: input.baselineRate.n },
        ...(axes.headline.aggregateFloor === undefined ? {} : { floor: axes.headline.aggregateFloor }),
      }),
      baselineRateSource: 'designated-baseline',
      baselineBatchKey: input.baselineRate.batchKey,
    }
  const artefact: NoiseFloorArtefact = {
    schemaVersion: NOISE_FLOOR_SCHEMA_VERSION,
    method: NOISE_FLOOR_METHOD,
    ...input.profile,
    corpusDigest: input.corpusDigest,
    partitionVersion: input.partitionVersion,
    seeds: [...input.seeds],
    repeats: input.repeats,
    seedHonored: input.runs.every(run => run.report.seedHonored === true),
    bootstrap: { B: BOOTSTRAP_B, seed: input.bootstrapSeed },
    population: {
      included: {
        proof: reference.filter(vector => vector.briefSource === 'proof').length,
        empty: reference.filter(vector => vector.briefSource === 'empty').length,
      },
      excludedRendered: input.runs[0]!.vectors.filter(vector => vector.briefSource === 'rendered').length,
      refusals: { ...input.runs[0]!.report.honesty.refusalCounts },
      unpartitioned: reference.filter(vector => !input.splitByCassetteId.has(vector.cassetteId)).length,
    },
    axes,
    products,
    splits,
    minimumGateSet,
    runs,
    cost: sumCosts(runs.map(run => run.cost)),
    ...(input.classifierRepeatability === undefined ? {} : { classifierRepeatability: input.classifierRepeatability }),
    ...(input.explanation === undefined ? {} : { explanation: input.explanation }),
  }
  const guarded = guardNoiseFloorArtefact(artefact)
  if (guarded.kind === 'rejected') throw new TypeError(`floor fold rejected: ${guarded.reason}`)
  return guarded.artefact
}
