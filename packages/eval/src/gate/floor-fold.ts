/** Pure floor fold: supplied runs, split membership, and cost evidence only. */
import type { EvalBatchReport } from '../match/metrics'
import type { DecisionCorrectnessVector } from '../stats/decision-vector'
import type { FloorSplit, MinimumGateSetRecord, NoiseFloorArtefact } from './floor-artefact'

export interface FloorRunInput {
  index: number
  seed: number
  report: EvalBatchReport
  vectors: readonly DecisionCorrectnessVector[]
  wallClockMs: number
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
  _input: { baselineRate: { correct: number; n: number }; floor?: number },
): Omit<MinimumGateSetRecord, 'baselineRateSource' | 'baselineBatchKey'> {
  throw new TypeError('RED contract skeleton')
}

export function foldNoiseFloorArtefact(_input: FoldNoiseFloorInput): NoiseFloorArtefact {
  throw new TypeError('RED contract skeleton')
}
