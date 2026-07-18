import type {
  Anchor,
  BriefBlock,
  CanaryOutcome,
  CautionBlock,
  IndexEntry,
  ProcedureMatch,
  ProcedureBindingAvailability,
  ReadOptions,
  RecordBody,
  RecordId,
  ScopeKey,
  ScreenState,
  SearchOptions,
} from '@vostride/agent-qa-schema'

export interface KnowledgeHintReader {
  getRunBrief(scope: ScopeKey, budget: number): BriefBlock
  search(query: string, options: SearchOptions): IndexEntry[]
  read(id: RecordId, options?: ReadOptions): RecordBody | undefined
  getCautions(anchors: Anchor[], budget: number): CautionBlock
  /**
   * D-08 port evolution: source-tagged binding NAMES cross here (variables, memory, secrets) so
   * matcher fillability mirrors loop binding; no value ever crosses the reader port in any form.
   * Value binding stays loop-side at replay time. Absent availability is treated as empty, so a
   * referenced-parameter procedure downranks to hint (fail-conservative).
   */
  getProcedure(
    intent: string,
    screenState: ScreenState,
    availability?: ProcedureBindingAvailability,
  ): ProcedureMatch | undefined
  emitCanaryOutcome(payload: CanaryOutcome): void
}
