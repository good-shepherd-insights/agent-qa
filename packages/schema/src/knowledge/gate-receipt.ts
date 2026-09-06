import { z } from 'zod'
import { canonicalJson } from '../determinism/canonical-json'
import { sha256hex } from '../determinism/sha256'
import { PROMOTION_PATHS, strongerPromotionPath, type PromotionPath } from './promotion-path'

export const GATE_RECEIPT_SCHEMA_VERSION = 1
export type GateNumber = 1 | 2 | 3
export type GateVerdict = 'pass' | 'fail' | 'abstain'
export const GATE_NUMBERS = [1, 2, 3] as const satisfies readonly GateNumber[]
export const GATE_VERDICTS = ['pass', 'fail', 'abstain'] as const satisfies readonly GateVerdict[]
const sha256 = z.string().regex(/^[0-9a-f]{64}$/)
const receiptCoreShape = {
  schemaVersion: z.literal(1),
  candidateId: z.string().min(1),
  verdict: z.enum(GATE_VERDICTS),
  producedAtOrdinal: z.number().int().nonnegative(),
  producedBy: z.object({ jobId: z.string().optional(), opId: z.string().optional() }).strict(),
  receiptDigest: sha256,
}
// 416-01: the persisted core; Plan 02 supplies each gate's measured evidence fields.
export const GateReceiptSchema = z.discriminatedUnion('gate', [
  z.object({ ...receiptCoreShape, gate: z.literal(1) }).strict(),
  z.object({ ...receiptCoreShape, gate: z.literal(2) }).strict(),
  z.object({ ...receiptCoreShape, gate: z.literal(3) }).strict(),
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

