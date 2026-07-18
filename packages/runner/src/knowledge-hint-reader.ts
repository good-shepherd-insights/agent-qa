import type {
  Anchor,
  BriefBlock,
  CanaryOutcome,
  CautionBlock,
  IndexEntry,
  ProcedureMatch,
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
   * D-08 port evolution: binding NAMES cross here so the fillability fold can rank matches; no
   * value of any binding ever crosses the reader port in any form — value binding stays loop-side
   * at replay time. Absent bindingNames is treated as an empty set, so required-parameter
   * procedures downrank to hint (fail-conservative).
   */
  getProcedure(
    intent: string,
    screenState: ScreenState,
    bindingNames?: readonly string[],
  ): ProcedureMatch | undefined
  emitCanaryOutcome(payload: CanaryOutcome): void
}
