import type { BaselinePointerLoad } from '../baseline/profile-key'
import type { DecisionVectorsDocument } from '../match/decision-vectors'
import type { EvalBatchReport } from '../match/metrics'
import type { DecisionCorrectnessVector, FloorAxis } from '../stats/decision-vector'
import type { NoiseFloorArtefact } from './floor-artefact'

// prettier-ignore
export const GATE_INCONCLUSIVE_REASONS = ['missing-baseline', 'incomparable-baseline', 'missing-floor', 'stale-baseline', 'stale-floor', 'seed-regime-mismatch', 'harness-errors', 'never-scored', 'refusal-population-differs', 'no-decision-vector'] as const
export type GateInconclusiveReason = (typeof GATE_INCONCLUSIVE_REASONS)[number]
export type GateExit = 0 | 1 | 2

export interface GateRegression {
  axis: FloorAxis
  baseline: number
  current: number
  delta: number
  floor: number
  n: number
}

export interface GateVerdict {
  exit: GateExit
  inconclusive: readonly { reason: GateInconclusiveReason; detail: string }[]
  regressions: readonly GateRegression[]
  skippedAxes: readonly { axis: FloorAxis; reason: string }[]
  refusals: { baseline: Record<string, number>; current: Record<string, number> }
  pairing: { n: number; discordant: number; baselineOnly: number; currentOnly: number; renderedExcluded: number }
  seed: { current?: boolean; floor?: boolean; regime: 'match' | 'mismatch' | 'unknown' }
  population: { proof: number; empty: number; rendered: number }
}

export interface ComputeGateVerdictInput {
  expectedProfileKey: string
  pointer: { kind: 'absent'; others: readonly { profileKey: string }[] } | BaselinePointerLoad
  floor?: NoiseFloorArtefact
  baseline?: { report: EvalBatchReport; vectors?: DecisionVectorsDocument }
  current: {
    report: EvalBatchReport
    vectors: readonly DecisionCorrectnessVector[]
    fingerprint: string
    corpusDigest: string
  }
}

export function computeGateVerdict(_input: ComputeGateVerdictInput): GateVerdict {
  throw new TypeError('release gate contract not implemented')
}
