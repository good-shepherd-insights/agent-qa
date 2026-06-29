import type { CanaryOutcome, Delta, RecordId } from '@vostride/agent-qa-schema'

export interface KnowledgePort {
  proposeDeltas(deltas: Delta[]): Promise<void>
  commit(deltas: Delta[]): Promise<void>
  recordCanaryOutcome(outcome: CanaryOutcome): Promise<void>
  promote(candidateId: RecordId): Promise<void>
}
