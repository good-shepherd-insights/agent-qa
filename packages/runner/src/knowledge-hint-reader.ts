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
  getProcedure(intent: string, screenState: ScreenState): ProcedureMatch | undefined
  emitCanaryOutcome(payload: CanaryOutcome): void
}
