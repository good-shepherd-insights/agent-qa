export type { ArtifactSource, HandoffSource } from './ports'

export { canonicalJson, canonicalValue } from './canonical-json'

export { computeReplayDrift } from './replay/drift'
export type { ReplayDrift } from './replay/drift'

export {
  computeDecisionIdentity,
  decisionIdentityKey,
  normalizeIdentityValue,
} from './replay/identity'
export type { DecisionIdentity } from './replay/identity'

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
export type {
  CassetteCompleteness,
  CompletenessStatus,
  MissingCassetteEvidence,
  MissingCassetteEvidenceKind,
} from './cassette/completeness'
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
export { ACTION_WIRE_SCHEMAS_BY_TYPE, actionWireSchema } from './cassette/action-wire-schema'
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
export { projectSidecarLeg } from './extract/sidecar-leg'
export type {
  ProjectSidecarLegInput,
  ProjectSidecarLegResult,
} from './extract/sidecar-leg'
export { assembleReceipt, canonicalizeInputLeg } from './extract/receipt'
export type { AssembleReceiptInput } from './extract/receipt'
export {
  deriveLeafCassetteId,
  deriveProcedureCassetteId,
  deriveRunSlug,
} from './extract/ids'
export type {
  DeriveLeafCassetteIdInput,
  DeriveProcedureCassetteIdInput,
} from './extract/ids'
export {
  buildCompleteness,
  collectBlobShas,
  missingRequiredEvidence,
  resolveBlobClosure,
} from './extract/blob-closure'
export type {
  BuildCompletenessInput,
  ExtractedBlob,
  ResolvedBlobClosure,
} from './extract/blob-closure'
export { buildProcedureCassette } from './extract/procedure'
export type {
  BuildProcedureCassetteInput,
  BuiltProcedureCassette,
  ProcedureDecisionInput,
} from './extract/procedure'
export { extractRunCassettes } from './extract/extract-run'
export type {
  EmittedCassetteSummary,
  ExtractedCassette,
  ExtractionReport,
  ExtractionResult,
  ExtractRunCassettesInput,
} from './extract/extract-run'
