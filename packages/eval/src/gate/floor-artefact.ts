/** Pure committed evidence: no wall-clock identity field; repeat folds must remain byte-stable. */
import { z } from 'zod'

import type { FloorAxis } from '../stats/decision-vector'
import type { GeneralizationVerdict } from '../stats/generalization'

export const NOISE_FLOOR_SCHEMA_VERSION = 1 as const
export const NOISE_FLOOR_METHOD = 'aa-repeat-spread-plus-wilson' as const
export type FloorSplit = 'natural' | 'held-out-shared' | 'held-out-private'
// prettier-ignore
export const FLOOR_SPLITS = ['natural', 'held-out-shared', 'held-out-private'] as const satisfies readonly FloorSplit[]
export const FLOOR_PROTOCOL_MINIMUM = { repeats: 3, seeds: 2 } as const

export interface RunCostRecord {
  modelCalls?: number
  promptTokens?: number
  completionTokens?: number
  wallClockMs: number
}

export interface AxisFloorRecord {
  n: number
  reference?: { correct: number; n: number }
  sameSeedSpread?: number
  twoSeedSpread?: number
  wilsonHalfWidth?: number
  aggregateFloor?: number
  pairs: readonly {
    a: number
    b: number
    kind: 'same-seed' | 'two-seed'
    n: number
    aOnly: number
    bOnly: number
    deltaAcc?: number
    flipRate?: number
    mcnemarP: number
  }[]
}
export type AxisFloorSet = Record<FloorAxis, AxisFloorRecord>

export interface MinimumGateSetRecord {
  lowerBound: 3
  baselineRate: { correct: number; n: number }
  baselineRateSource: 'designated-baseline' | 'reference-run'
  baselineBatchKey?: string
  floor?: number
  value?: number
  derivation: string
  searchedUpTo: number
}

export interface NullLiftRecord {
  pair: { a: number; b: number }
  optimizeLift: { n: number; deltaAcc?: number }
  heldOutLift: { n: number; deltaAcc?: number }
  verdict: GeneralizationVerdict
  ratio?: number
  bootstrapCI?: { lower: number; upper: number; B: number }
}

export interface ProductFloorRecord {
  axes: AxisFloorSet
  minimumGateSet: MinimumGateSetRecord
  census: { natural: number; heldOutShared: number; heldOutPrivate: number }
  populatedBriefs: number
}

export interface SplitFloorRecord {
  axes: AxisFloorSet
  nullLift?: readonly NullLiftRecord[]
}

export interface FloorRunRecord {
  index: number
  seed: number
  seedHonored?: boolean
  headline: { correct: number; n: number }
  axes: Record<FloorAxis, { correct: number; n: number }>
  refusalCounts: Record<string, number>
  briefSourceCounts: Record<string, number>
  harnessErrorCount: number
  cost: RunCostRecord
  reportDigest: string
}

export interface NoiseFloorArtefact {
  schemaVersion: typeof NOISE_FLOOR_SCHEMA_VERSION
  method: typeof NOISE_FLOOR_METHOD
  profileKey: string
  fingerprint: string
  plannerModelId: string
  matcherVersion: number
  judgeModelId?: string
  judgeVersion?: number
  corpusDigest: string
  partitionVersion: number
  seeds: readonly number[]
  repeats: number
  seedHonored: boolean
  bootstrap: { B: number; seed: number }
  population: {
    included: { proof: number; empty: number }
    excludedRendered: number
    refusals: Record<string, number>
    unpartitioned: number
  }
  axes: AxisFloorSet
  products: Record<string, ProductFloorRecord>
  splits: Record<FloorSplit, SplitFloorRecord>
  minimumGateSet: MinimumGateSetRecord
  runs: readonly FloorRunRecord[]
  cost: RunCostRecord
  classifierRepeatability?: unknown
  explanation?: string
}

export type FloorRefusal =
  | { kind: 'zero-floor-without-explanation'; axes: readonly string[] }
  | { kind: 'below-protocol-minimum'; repeats: number; seeds: number }

export const noiseFloorArtefactSchema = z.object({}).strict()

export function guardNoiseFloorArtefact(
  _value: unknown,
): { kind: 'ok'; artefact: NoiseFloorArtefact } | { kind: 'rejected'; reason: string } {
  return { kind: 'rejected', reason: 'RED contract skeleton' }
}

export function assertFloorArtefactCommittable(
  _artefact: NoiseFloorArtefact,
): { ok: true } | { ok: false; refusal: FloorRefusal } {
  return { ok: true }
}

export function renderFloorRefusal(_refusal: FloorRefusal): string {
  return 'RED contract skeleton'
}
