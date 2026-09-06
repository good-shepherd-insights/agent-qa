import type { CanaryOutcome, Delta, GateReceipt, GateReceiptRecordOutcome, PromotionOutcome, RecordId } from '@vostride/agent-qa-schema'

export interface KnowledgePort {
  proposeDeltas(deltas: Delta[]): Promise<void>
  commit(deltas: Delta[]): Promise<void>
  recordCanaryOutcome(outcome: CanaryOutcome): Promise<void>
  promote(candidateId: RecordId, receipts?: readonly GateReceipt[]): Promise<PromotionOutcome>
  recordGateReceipt(receipt: GateReceipt): Promise<GateReceiptRecordOutcome>
}
