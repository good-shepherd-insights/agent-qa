/** Pure committed evidence: no wall-clock identity field; repeat folds must remain byte-stable. */
import { z } from 'zod'

import { FLOOR_AXES, type FloorAxis } from '../stats/decision-vector'
import { GENERALIZATION_VERDICTS, type GeneralizationVerdict } from '../stats/generalization'

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

const count = z.number().int().nonnegative()
const rate = z.number().min(0).max(1)
const delta = z.number().min(-1).max(1)
const counts = z.record(z.string(), count)
const correctness = z
  .object({ correct: count, n: count })
  .strict()
  .refine(value => value.correct <= value.n, {
    path: ['correct'],
    message: 'correct must not exceed n',
  })

const runCostRecordSchema = z
  .object({
    modelCalls: count.optional(),
    promptTokens: count.optional(),
    completionTokens: count.optional(),
    wallClockMs: z.number().nonnegative(),
  })
  .strict()

const axisFloorRecordSchema = z
  .object({
    n: count,
    reference: correctness.optional(),
    sameSeedSpread: rate.optional(),
    twoSeedSpread: rate.optional(),
    wilsonHalfWidth: rate.optional(),
    aggregateFloor: rate.optional(),
    pairs: z.array(
      z
        .object({
          a: count,
          b: count,
          kind: z.enum(['same-seed', 'two-seed']),
          n: count,
          aOnly: count,
          bOnly: count,
          deltaAcc: delta.optional(),
          flipRate: rate.optional(),
          mcnemarP: rate,
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.n !== 0) return
    for (const key of [
      'reference',
      'sameSeedSpread',
      'twoSeedSpread',
      'wilsonHalfWidth',
      'aggregateFloor',
    ] as const) {
      if (value[key] !== undefined) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'must be absent when n is 0' })
      }
    }
  })

const axisFloorSetSchema = z.record(z.enum(FLOOR_AXES), axisFloorRecordSchema)
const minimumGateSetSchema = z
  .object({
    lowerBound: z.literal(3),
    baselineRate: correctness,
    baselineRateSource: z.enum(['designated-baseline', 'reference-run']),
    baselineBatchKey: z.string().min(1).optional(),
    floor: rate.optional(),
    value: z.number().int().min(3).optional(),
    derivation: z.string().min(1),
    searchedUpTo: count,
  })
  .strict()

const liftSchema = z.object({ n: count, deltaAcc: delta.optional() }).strict()
const nullLiftSchema = z
  .object({
    pair: z.object({ a: count, b: count }).strict(),
    optimizeLift: liftSchema,
    heldOutLift: liftSchema,
    verdict: z.enum(GENERALIZATION_VERDICTS),
    ratio: z.number().nonnegative().optional(),
    bootstrapCI: z
      .object({ lower: delta, upper: delta, B: z.number().int().positive() })
      .strict()
      .optional(),
  })
  .strict()

export const noiseFloorArtefactSchema = z
  .object({
    schemaVersion: z.literal(NOISE_FLOOR_SCHEMA_VERSION),
    method: z.literal(NOISE_FLOOR_METHOD),
    profileKey: z.string().min(1),
    fingerprint: z.string().min(1),
    plannerModelId: z.string().min(1),
    matcherVersion: count,
    judgeModelId: z.string().min(1).optional(),
    judgeVersion: count.optional(),
    corpusDigest: z.string().min(1),
    partitionVersion: count,
    seeds: z.array(z.number().int()),
    repeats: count,
    seedHonored: z.boolean(),
    bootstrap: z.object({ B: z.number().int().positive(), seed: z.number().int() }).strict(),
    population: z
      .object({
        included: z.object({ proof: count, empty: count }).strict(),
        excludedRendered: count,
        refusals: counts,
        unpartitioned: count,
      })
      .strict(),
    axes: axisFloorSetSchema,
    products: z.record(
      z.string(),
      z
        .object({
          axes: axisFloorSetSchema,
          minimumGateSet: minimumGateSetSchema,
          census: z
            .object({ natural: count, heldOutShared: count, heldOutPrivate: count })
            .strict(),
          populatedBriefs: count,
        })
        .strict(),
    ),
    splits: z.record(
      z.enum(FLOOR_SPLITS),
      z.object({ axes: axisFloorSetSchema, nullLift: z.array(nullLiftSchema).optional() }).strict(),
    ),
    minimumGateSet: minimumGateSetSchema,
    runs: z.array(
      z
        .object({
          index: count,
          seed: z.number().int(),
          seedHonored: z.boolean().optional(),
          headline: correctness,
          axes: z.record(z.enum(FLOOR_AXES), correctness),
          refusalCounts: counts,
          briefSourceCounts: counts,
          harnessErrorCount: count,
          cost: runCostRecordSchema,
          reportDigest: z.string().min(1),
        })
        .strict(),
    ),
    cost: runCostRecordSchema,
    classifierRepeatability: z.unknown().optional(),
    explanation: z.string().optional(),
  })
  .strict()

export function guardNoiseFloorArtefact(
  value: unknown,
): { kind: 'ok'; artefact: NoiseFloorArtefact } | { kind: 'rejected'; reason: string } {
  const parsed = noiseFloorArtefactSchema.safeParse(value)
  if (!parsed.success) {
    return {
      kind: 'rejected',
      reason: parsed.error.issues
        .map(issue => `${issue.path.length ? issue.path.map(String).join('.') : '<root>'}: ${issue.message}`)
        .join('; '),
    }
  }
  return { kind: 'ok', artefact: parsed.data }
}

export function assertFloorArtefactCommittable(
  artefact: NoiseFloorArtefact,
): { ok: true } | { ok: false; refusal: FloorRefusal } {
  const seeds = new Set(artefact.seeds).size
  if (
    artefact.repeats < FLOOR_PROTOCOL_MINIMUM.repeats ||
    seeds < FLOOR_PROTOCOL_MINIMUM.seeds
  ) {
    return {
      ok: false,
      refusal: { kind: 'below-protocol-minimum', repeats: artefact.repeats, seeds },
    }
  }
  const axes: string[] = []
  function collect(set: AxisFloorSet, prefix = ''): void {
    for (const axis of FLOOR_AXES) {
      if (set[axis].aggregateFloor === 0) axes.push(`${prefix}${axis}`)
    }
  }
  collect(artefact.axes)
  for (const product of Object.keys(artefact.products).sort()) {
    collect(artefact.products[product]!.axes, `products.${product}.`)
  }
  for (const split of FLOOR_SPLITS) collect(artefact.splits[split].axes, `splits.${split}.`)
  if (axes.length > 0 && !artefact.explanation?.trim()) {
    return { ok: false, refusal: { kind: 'zero-floor-without-explanation', axes } }
  }
  return { ok: true }
}

export function renderFloorRefusal(refusal: FloorRefusal): string {
  if (refusal.kind === 'zero-floor-without-explanation') {
    return `noise floor refused: ${refusal.kind} — ${refusal.axes.join(', ')}`
  }
  return (
    `noise floor refused: ${refusal.kind} — repeats ${refusal.repeats}, distinct seeds ` +
    `${refusal.seeds}; require ${FLOOR_PROTOCOL_MINIMUM.repeats} repeats and ` +
    `${FLOOR_PROTOCOL_MINIMUM.seeds} distinct seeds`
  )
}
