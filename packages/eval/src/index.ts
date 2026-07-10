export type { ArtifactSource, HandoffSource } from './ports'

export type { CassetteInputLeg } from './cassette/input-leg'
export type { CassetteSidecarLeg, GoldAnchorDescriptor } from './cassette/sidecar-leg'
export type {
  CassetteLabelLeg,
  ContrastivePairing,
  LabelSourceChannel,
  LabelTier,
  RecordedFailureContext,
} from './cassette/label-leg'
export type {
  CassetteJudgeReceipt,
  CassetteModelReceipt,
  CassetteReceipt,
  CassetteSamplingReceipt,
} from './cassette/receipt-leg'
export type { CassetteCompleteness, CompletenessStatus } from './cassette/completeness'
export { CASSETTE_SCHEMA_VERSION } from './cassette/cassette'
export type {
  Cassette,
  CassetteGranularity,
  DecisionRecord,
  LeafCassette,
  ProcedureCacheServedStepRecord,
  ProcedureCassette,
  ProcedureDecisionStepRecord,
  ProcedureEndState,
  ProcedureStepRecord,
  ProcedureSynthesizedStepRecord,
} from './cassette/cassette'
export { cassetteSchema } from './cassette/schema'
export {
  CASSETTE_MIGRATIONS,
  CassetteVersionError,
  guardCassette,
} from './cassette/guard'

export { classifySubAction, collectStepSelections } from './extract/select'
export type {
  CollectStepSelectionsInput,
  SelectionSkip,
  SelectionSkipReason,
  StepSelections,
  SubActionClassification,
  SubActionSelection,
} from './extract/select'
export { projectInputLeg } from './extract/input-leg'
export type { ProjectInputLegInput } from './extract/input-leg'
export { projectLabelLeg } from './extract/label-leg'
export type { ProjectLabelLegInput } from './extract/label-leg'
