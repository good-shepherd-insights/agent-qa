import { z } from 'zod'
import { canonicalJson } from '../determinism/canonical-json'
import { sha256hex } from '../determinism/sha256'
import { PROMOTION_PATHS, strongerPromotionPath, type PromotionPath } from './promotion-path'

export const GATE_RECEIPT_SCHEMA_VERSION = 1
export type GateNumber = 1 | 2 | 3
export type GateVerdict = 'pass' | 'fail' | 'abstain'
// prettier-ignore
export const GATE_NUMBERS = [1, 2, 3] as const satisfies readonly GateNumber[]
// prettier-ignore
export const GATE_VERDICTS = ['pass', 'fail', 'abstain'] as const satisfies readonly GateVerdict[]
export type PerAxisScoreAxis = 'headline' | 'elementIdentity' | 'value' | 'opClass' | 'sideEffect' | 'loop'
// 416 D-02: mirror the neutral axis names; schema never depends on eval.
// prettier-ignore
export const PER_AXIS_SCORE_AXES = ['headline', 'elementIdentity', 'value', 'opClass', 'sideEffect', 'loop'] as const satisfies readonly PerAxisScoreAxis[]
export type CrossCheck = 'flipped' | 'held' | 'inconclusive' | 'not-run'
// prettier-ignore
export const CROSS_CHECKS = ['flipped', 'held', 'inconclusive', 'not-run'] as const satisfies readonly CrossCheck[]
export type Degradation = 'replay-diff' | 'tier-not-implemented'
// prettier-ignore
export const DEGRADATIONS = ['replay-diff', 'tier-not-implemented'] as const satisfies readonly Degradation[]
export type Benefit = 'exercised-benefited' | 'rode-along' | 'exercised-harmed'
// prettier-ignore
export const BENEFITS = ['exercised-benefited', 'rode-along', 'exercised-harmed'] as const satisfies readonly Benefit[]
export type Mark = 'false-fail' | 'false-pass' | 'confirmed-bug'
// prettier-ignore
export const MARKS = ['false-fail', 'false-pass', 'confirmed-bug'] as const satisfies readonly Mark[]
export type StateValidity = 'valid' | 'stale' | 'unknown'
// prettier-ignore
export const STATE_VALIDITIES = ['valid', 'stale', 'unknown'] as const satisfies readonly StateValidity[]
const sha256 = z.string().regex(/^[0-9a-f]{64}$/)
export const axisScoreSchema = z.object({
  baseline: z.number(), candidate: z.number(), delta: z.number(), floor: z.number(),
  n: z.number().int().nonnegative(),
}).strict()
export const perAxisScoreSchema = z.object({
  headline: axisScoreSchema, elementIdentity: axisScoreSchema, value: axisScoreSchema,
  opClass: axisScoreSchema, sideEffect: axisScoreSchema, loop: axisScoreSchema,
}).strict()
export const corpusVersionSchema = z.object({
  corpusDigest: sha256,
  partitionVersion: z.number().int().nonnegative(),
  gateSetSize: z.number().int().nonnegative(),
  excludedCount: z.number().int().nonnegative(),
  minimumGateSet: z.number().int().min(1),
}).strict()
export const samplesSchema = z.object({
  k: z.number().int().min(1), seeds: z.array(z.number().int()), seedHonored: z.boolean(),
  modelCalls: z.number().int().nonnegative(),
}).strict()
export const noiseFloorRefSchema = z.object({
  profileKey: z.string().min(1), corpusDigest: sha256,
}).strict()
const receiptCoreShape = {
  schemaVersion: z.literal(1),
  candidateId: z.string().min(1),
  verdict: z.enum(GATE_VERDICTS),
  producedAtOrdinal: z.number().int().nonnegative(),
  producedBy: z.object({ jobId: z.string().optional(), opId: z.string().optional() }).strict(),
  receiptDigest: sha256,
}
// 416 D-01/D-02: each strict arm only accepts evidence that its gate measures.
export const gate1ArmSchema = z.object({
  ...receiptCoreShape, gate: z.literal(1), perAxisScore: perAxisScoreSchema,
  corpusVersion: corpusVersionSchema, samples: samplesSchema, crossCheck: z.enum(CROSS_CHECKS),
  judgeId: z.string().optional(), degradation: z.enum(DEGRADATIONS).optional(),
  noiseFloorRef: noiseFloorRefSchema.optional(),
}).strict()
export const gate2ArmSchema = z.object({
  ...receiptCoreShape, gate: z.literal(2), attributedObservationId: z.string().min(1),
  benefit: z.enum(BENEFITS), stateValidity: z.enum(STATE_VALIDITIES),
}).strict()
export const gate3ArmSchema = z.object({
  ...receiptCoreShape, gate: z.literal(3), runId: z.string().min(1),
  stepId: z.string().optional(), mark: z.enum(MARKS),
}).strict()
export const GateReceiptSchema = z.discriminatedUnion('gate', [
  gate1ArmSchema, gate2ArmSchema, gate3ArmSchema,
])
export const PromotionReceiptSchema = z.object({
  schemaVersion: receiptCoreShape.schemaVersion,
  kind: z.literal('promotion'),
  candidateId: receiptCoreShape.candidateId,
  promotionPath: z.enum(PROMOTION_PATHS),
  citedReceiptDigests: z.array(sha256),
  producedAtOrdinal: receiptCoreShape.producedAtOrdinal,
  producedBy: receiptCoreShape.producedBy,
  receiptDigest: sha256,
}).strict()
export const GateLineSchema = z.union([GateReceiptSchema, PromotionReceiptSchema])
export type GateReceipt = z.infer<typeof GateReceiptSchema>
export type Gate1Receipt = Extract<GateReceipt, { gate: 1 }>
export type Gate2Receipt = Extract<GateReceipt, { gate: 2 }>
export type Gate3Receipt = Extract<GateReceipt, { gate: 3 }>
export type PromotionReceipt = z.infer<typeof PromotionReceiptSchema>
export type GateLine = z.infer<typeof GateLineSchema>
type WithoutDigest<T> = T extends unknown ? Omit<T, 'receiptDigest'> : never

export function receiptDigestOf(line: GateLine): string {
  const { receiptDigest: _receiptDigest, ...rest } = line
  return sha256hex(canonicalJson(rest))
}
export function stampReceiptDigest<T extends WithoutDigest<GateLine>>(line: T): T & { receiptDigest: string } {
  return { ...line, receiptDigest: sha256hex(canonicalJson(line)) }
}
export function isPromotionReceipt(line: GateLine): line is PromotionReceipt {
  return 'kind' in line && line.kind === 'promotion'
}
export function standingReceiptsByGate(receipts: readonly GateReceipt[]): GateReceipt[] {
  const standing = new Map<GateNumber, GateReceipt>()
  for (const receipt of receipts) {
    const previous = standing.get(receipt.gate)
    if (previous === undefined || receipt.producedAtOrdinal >= previous.producedAtOrdinal) {
      standing.set(receipt.gate, receipt)
    }
  }
  return GATE_NUMBERS.flatMap(gate => {
    const receipt = standing.get(gate)
    return receipt === undefined ? [] : [receipt]
  })
}
export function strongestPromotionPath(lines: readonly GateLine[]): PromotionPath | undefined {
  let strongest: PromotionPath | undefined
  for (const line of lines) {
    if (isPromotionReceipt(line)) {
      strongest = strongest === undefined ? line.promotionPath
        : strongerPromotionPath(strongest, line.promotionPath)
    }
  }
  return strongest
}
