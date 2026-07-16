import { z } from 'zod'

/**
 * PROVISIONAL D-04 CUSUM allowance and decision interval in baseline-sigma
 * units. M3 owns calibration; these are internal constitution values, never
 * config keys.
 */
export const CUSUM_SLACK_K = 0.5
export const CUSUM_DECISION_H = 5

/**
 * PROVISIONAL D-04 weighted-gap significance and minimum mode size. M3 owns
 * calibration; these are internal constitution values, never config keys.
 */
export const BIMODAL_GAP_THRESHOLD = 2.25
export const BIMODAL_MIN_MODE_N = 3

const finiteNumberSchema = z.number().refine(Number.isFinite, 'Expected a finite number')

/**
 * D-03's only stored detector input. The snapshot is written once when the
 * validity window opens; all current distribution and detector state is folded.
 */
export const measurementBaselineSchema = z.object({
  mu0: finiteNumberSchema,
  sigma0: finiteNumberSchema.nonnegative(),
  n0: z.number().int().positive(),
  openedAtOrdinal: z.number().int().nonnegative(),
}).strict()

export type MeasurementBaseline = z.infer<typeof measurementBaselineSchema>

/** Append-only numeric evidence line; ordinals replace wall-clock decisions. */
export const measurementObservationSchema = z.object({
  value: finiteNumberSchema,
  buildOrdinal: z.number().int().nonnegative(),
  evidenceToken: z.string(),
  curationJobId: z.string(),
}).strict()

export type MeasurementObservation = z.infer<typeof measurementObservationSchema>

export interface MeasurementFoldState {
  n: number
  mean: number
  /** Welford sum of squared deviations. */
  m2: number
  values: number[]
  cusumPos: number
  cusumNeg: number
}

export interface MeasurementBand {
  lo: number
  hi: number
  n: number
  mean: number
}

export interface DerivedMeasurementState {
  n: number
  mean: number
  /** Population sigma over the fresh observation window. */
  sigma: number
  /** Nearest-rank pooled quantile; absent when the fresh window is empty. */
  p50: number | undefined
  /**
   * Nearest-rank pooled timeout ceiling consumed by Phase 380. Pooling all
   * modes makes a bimodal distribution safe by construction.
   */
  p95: number | undefined
  bands: MeasurementBand[]
  cusumPos: number
  cusumNeg: number
}

export interface CusumState {
  pos: number
  neg: number
}

export interface CusumStepResult extends CusumState {
  tripped: boolean
}

/**
 * Ratified D-04 change-point step. Two-sided CUSUM references the fixed stored
 * baseline; Page-Hinkley is deliberately excluded because its running-mean
 * reference reintroduces the self-updating-reference failure banned by §9.2.
 */
export function cusumStep(
  state: Readonly<CusumState>,
  value: number,
  mu0: number,
  sigma0: number,
): CusumStepResult {
  const pos = Math.max(0, state.pos + (value - mu0 - CUSUM_SLACK_K * sigma0))
  const neg = Math.max(0, state.neg - (value - mu0 + CUSUM_SLACK_K * sigma0))
  const decisionInterval = CUSUM_DECISION_H * sigma0

  return {
    pos,
    neg,
    tripped: pos > decisionInterval || neg > decisionInterval,
  }
}

export interface BimodalSplit {
  /** Number of sorted values in the lower band. */
  splitIndex: number
  bands: [MeasurementBand, MeasurementBand]
}

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]!
  return (sorted[middle - 1]! + sorted[middle]!) / 2
}

function band(values: readonly number[]): MeasurementBand {
  let sum = 0
  for (const value of values) sum += value

  return {
    lo: values[0]!,
    hi: values[values.length - 1]!,
    n: values.length,
    mean: sum / values.length,
  }
}

/**
 * Ratified D-04 bimodality detector: a deterministic weighted largest-gap split
 * over an already sorted one-dimensional sample. At most two bands are emitted
 * in M2; recursive k-modal splitting is deferred.
 */
export function bimodalSplit(sorted: readonly number[]): BimodalSplit | undefined {
  const n = sorted.length
  if (n < 2 * BIMODAL_MIN_MODE_N) return undefined

  const weightedGaps: number[] = []
  for (let splitIndex = 1; splitIndex < n; splitIndex += 1) {
    const gap = sorted[splitIndex]! - sorted[splitIndex - 1]!
    weightedGaps.push(gap * Math.sqrt(splitIndex * (n - splitIndex)))
  }

  const scale = median([...weightedGaps].sort((left, right) => left - right))
  let best: { splitIndex: number; weightedGap: number } | undefined

  for (
    let splitIndex = BIMODAL_MIN_MODE_N;
    splitIndex <= n - BIMODAL_MIN_MODE_N;
    splitIndex += 1
  ) {
    const weightedGap = weightedGaps[splitIndex - 1]!
    if (best === undefined || weightedGap > best.weightedGap) {
      best = { splitIndex, weightedGap }
    }
  }

  if (best === undefined || best.weightedGap <= 0) return undefined
  if (scale > 0 && best.weightedGap / scale <= BIMODAL_GAP_THRESHOLD) return undefined

  const lower = sorted.slice(0, best.splitIndex)
  const upper = sorted.slice(best.splitIndex)
  return {
    splitIndex: best.splitIndex,
    bands: [band(lower), band(upper)],
  }
}

function nearestRank(sorted: readonly number[], quantile: number): number | undefined {
  if (sorted.length === 0) return undefined
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1)
  return sorted[Math.min(index, sorted.length - 1)]
}

/**
 * Pure D-03 derivation over the append order supplied by measurements.json.
 * Welford and fixed-baseline CUSUM advance in one pass; values are then sorted
 * only for deterministic quantiles and the weighted-gap projection. No detector
 * state beyond the immutable baseline snapshot is persisted.
 */
export function foldMeasurements(
  baseline: MeasurementBaseline,
  lines: readonly MeasurementObservation[],
): DerivedMeasurementState {
  const state: MeasurementFoldState = {
    n: 0,
    mean: 0,
    m2: 0,
    values: [],
    cusumPos: 0,
    cusumNeg: 0,
  }

  for (const line of lines) {
    state.n += 1
    const delta = line.value - state.mean
    state.mean += delta / state.n
    state.m2 += delta * (line.value - state.mean)
    state.values.push(line.value)

    const cusum = cusumStep(
      { pos: state.cusumPos, neg: state.cusumNeg },
      line.value,
      baseline.mu0,
      baseline.sigma0,
    )
    state.cusumPos = cusum.pos
    state.cusumNeg = cusum.neg
  }

  const sorted = [...state.values].sort((left, right) => left - right)
  const split = bimodalSplit(sorted)
  const sigma = state.n === 0 ? 0 : Math.sqrt(state.m2 / state.n)

  return {
    n: state.n,
    mean: state.mean,
    sigma,
    p50: nearestRank(sorted, 0.5),
    p95: nearestRank(sorted, 0.95),
    bands: split?.bands ?? (sorted.length === 0 ? [] : [band(sorted)]),
    cusumPos: state.cusumPos,
    cusumNeg: state.cusumNeg,
  }
}
