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

/** Locked §9.2 evidence and drift thresholds; these are laws, not knobs. */
export const MEASUREMENT_MIN_N = 5
export const DRIFT_SIGMA_K = 3
export const DRIFT_RELATIVE_THRESHOLD = 0.5

/**
 * PROVISIONAL D-04 confidence and kind-variance prior values. Measurement
 * metrics have no common absolute scale, so the kind prior is coefficient-of-
 * variation based. M3 owns calibration; these are never config keys.
 */
export const CI_SEPARATION_Z = 1.96
export const KIND_DEFAULT_CV = 0.3
export const KIND_CV_FLOOR = 1
export const SHRINKAGE_PSEUDO_N = 5

/** PROVISIONAL D-04 revisit window for the stable-multimodal discriminator. */
export const MULTIMODAL_TRAILING_BUILDS = 5

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

export type MeasurementDriftDecision =
  | {
      decision: 'widen'
      reason: 'below-min-n' | 'ci-overlap' | 'within-threshold' | 'stable-multimodal'
    }
  | {
      decision: 'supersede'
      reason: 'threshold' | 'relative' | 'cusum' | 'regime-walk'
    }

export interface MeasurementDriftWindowBuilds {
  /** Ordered source lines used to distinguish revisited modes from a regime walk. */
  observations?: readonly MeasurementObservation[]
  /** Inclusive trailing build-ordinal width; defaults to the provisional M2 value. */
  trailingBuilds?: number
  /** Reserved for Plan 379-07's lineage/thrash fold without changing this seam. */
  lastSupersessionGapBuilds?: number
}

export interface DecideMeasurementDriftInput {
  baseline: MeasurementBaseline
  state: DerivedMeasurementState
  windowBuilds?: MeasurementDriftWindowBuilds
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

/**
 * Ratified D-04 weak variance prior. A scale-free kind CV is necessary because
 * measurement values are generic string-sourced metrics with no shared unit.
 */
export function shrunkSigma(sampleSigma: number, n: number, mu0: number): number {
  const evidenceN = Math.max(0, n)
  const kindSigma = KIND_DEFAULT_CV * Math.max(Math.abs(mu0), KIND_CV_FLOOR)
  const variance = (
    evidenceN * sampleSigma * sampleSigma
    + SHRINKAGE_PSEUDO_N * kindSigma * kindSigma
  ) / (evidenceN + SHRINKAGE_PSEUDO_N)

  return Math.sqrt(variance)
}

function trailingModeVisits(
  bands: readonly MeasurementBand[],
  windowBuilds: MeasurementDriftWindowBuilds | undefined,
): { hasChronology: boolean; stable: boolean } {
  const observations = windowBuilds?.observations ?? []
  if (bands.length < 2 || observations.length === 0) {
    return { hasChronology: false, stable: false }
  }

  let latestBuildOrdinal = observations[0]!.buildOrdinal
  for (const line of observations) {
    latestBuildOrdinal = Math.max(latestBuildOrdinal, line.buildOrdinal)
  }

  const requestedWidth = windowBuilds?.trailingBuilds ?? MULTIMODAL_TRAILING_BUILDS
  const trailingBuilds = Math.max(1, Math.trunc(requestedWidth))
  const earliestBuildOrdinal = latestBuildOrdinal - trailingBuilds + 1
  const recent = observations.filter((line) => line.buildOrdinal >= earliestBuildOrdinal)
  const insideAnyBand = recent.every((line) =>
    bands.some((candidate) => line.value >= candidate.lo && line.value <= candidate.hi),
  )
  const everyBandRevisited = bands.every((candidate) =>
    recent.some((line) => line.value >= candidate.lo && line.value <= candidate.hi),
  )

  return {
    hasChronology: recent.length > 0,
    stable: insideAnyBand && everyBandRevisited,
  }
}

/**
 * The D-04 decision order is intentionally linear and locked: minimum evidence,
 * confidence separation, absolute/relative thresholds, fixed-baseline CUSUM,
 * then the multimodal discriminator before any supersession is minted. Widen
 * decisions append evidence only and must never count toward thrash depth.
 */
export function decideMeasurementDrift(
  input: Readonly<DecideMeasurementDriftInput>,
): MeasurementDriftDecision {
  const { baseline, state } = input

  // Step 1: young distributions can only widen, regardless of poisoned outliers.
  if (state.n < MEASUREMENT_MIN_N) {
    return { decision: 'widen', reason: 'below-min-n' }
  }

  const baselineSigma = shrunkSigma(baseline.sigma0, baseline.n0, baseline.mu0)
  const windowSigma = shrunkSigma(state.sigma, state.n, baseline.mu0)
  const difference = Math.abs(state.mean - baseline.mu0)

  // Step 2: no downstream arm bypasses confidence-interval separation.
  const separation = CI_SEPARATION_Z * Math.sqrt(
    baselineSigma * baselineSigma / baseline.n0
    + windowSigma * windowSigma / state.n,
  )
  if (difference <= separation) {
    return { decision: 'widen', reason: 'ci-overlap' }
  }

  // Steps 3 and 4 arm supersession independently; reason precedence follows D-04.
  const sigmaThresholdPassed = difference > DRIFT_SIGMA_K * baselineSigma
  const relativeThresholdPassed = (
    difference > DRIFT_RELATIVE_THRESHOLD * Math.abs(baseline.mu0)
  )
  const cusumPassed = (
    state.cusumPos > CUSUM_DECISION_H * baselineSigma
    || state.cusumNeg > CUSUM_DECISION_H * baselineSigma
  )

  if (!sigmaThresholdPassed && !relativeThresholdPassed && !cusumPassed) {
    return { decision: 'widen', reason: 'within-threshold' }
  }

  // Step 5: revisiting both significant bands widens; abandoning one is a walk.
  const modeVisits = trailingModeVisits(state.bands, input.windowBuilds)
  if (modeVisits.stable) {
    return { decision: 'widen', reason: 'stable-multimodal' }
  }
  if (state.bands.length > 1 && modeVisits.hasChronology) {
    return { decision: 'supersede', reason: 'regime-walk' }
  }

  if (sigmaThresholdPassed) return { decision: 'supersede', reason: 'threshold' }
  if (relativeThresholdPassed) return { decision: 'supersede', reason: 'relative' }
  return { decision: 'supersede', reason: 'cusum' }
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
  const baselineSigma = shrunkSigma(baseline.sigma0, baseline.n0, baseline.mu0)
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
      baselineSigma,
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
