export { asRef, type Ref, type Point, type BoundingBox, type Viewport } from './primitives/index'

export type {
  Action,
  AndroidAction,
  CommonAction,
  IosAction,
  MobileAction,
  Platform,
  RefTargeted,
  Surface,
  TabSelector,
  WebAction,
} from './action/index'
export type { ActionExecutor, ActionsFor } from './action/adapter'
export type {
  EmittedTargetDescriptor,
  Fill,
  PlannedFill,
  PlannedScroll,
  Scroll,
  SwipeByDirection,
  SwipeByPath,
  WaitFor,
  WithEmittedRef,
  WithEmittedTarget,
} from './action/params'
export type { ActionAnnotation, ActionResult } from './result/index'
export { elementOrdinal, normalizeAccessibleName } from './screen/index'
export type { ElementBounds, ScrollContext } from './screen/index'
export type { ElementInfo, ElementState, ElementLabels, ElementHierarchy } from './screen/index'
export type { ScreenState } from './screen/index'
export type { ScreenStateMetadata, ScreenStateMetadataBase } from './screen/index'
export type { TargetDescriptor, GroundingAttempt, GroundingEvidence } from './screen/index'
export type { ModelCapabilities } from './capability/index'
export type { ModelProfile, ModelProviderId, ModelAuthDeclaration } from './model-profile/index'
export type { EmbeddingProfile } from './embedding-profile/index'
export {
  DEFAULT_EMBEDDING_PROFILE,
  STATIC_FLOOR_EMBEDDING_PROFILE,
} from './embedding-profile/index'
export type {
  AndroidPlatformConfig,
  BrowserConfig,
  DeviceConfig,
  IosPlatformConfig,
  PlatformBase,
  PlatformConfig,
  RemoteDeviceConfig,
  TimeoutConfig,
  Use,
  UseAndroid,
  UseIos,
  UseWeb,
  UseWebAuthState,
  WebAuthStateConfig,
  WebPlatformConfig,
} from './config/index'
export {
  appStateSchema,
  browserConfigSchema,
  deviceConfigSchema,
  platformBase,
  platformConfigSchema,
  remoteDeviceSchema,
  timeoutConfigSchema,
  useSchema,
  viewportSchema,
} from './config/index'
export {
  canonicalJson,
  canonicalValue,
  committedFileText,
  sha256hex,
  sha256hex16,
} from './determinism/index'
export type {
  ScopeKey,
  ScopeTier,
  Anchor,
  GraphNodeType,
  GraphEdgeType,
  GraphNodeNaturalKey,
} from './identity/index'
export {
  normalizeAnchor,
  identityTupleKey,
  graphNodeId,
  anchorGraphNode,
  recordGraphNode,
} from './identity/index'
export { supersessionKey } from './identity/supersession-key'
export {
  screenIdentityHash,
  screenStateHash,
  relevantEnvDigest,
  computeCacheKey,
  computeToolSchemaDigest,
} from './determinism/index'
export type {
  CacheKey,
  CacheableStepInput,
  NonCacheableStepInput,
  RedactedEnvVar,
  ToolSurfaceEntry,
} from './determinism/index'

// 367 D-13: one shared version-guard rule for every versioned document contract.
export { createVersionGuard, VersionGuardError } from './versioning/create-version-guard'
export type {
  MigrationRegistry,
  VersionGuardConfig,
} from './versioning/create-version-guard'

// 314 async-seam
export { asRunId } from './run/index'
export {
  BUNDLE_ID_HASH_SUFFIX_LENGTH,
  BUNDLE_SLUG_MAX_LENGTH,
  asRecordId,
  asIssueId,
  asEvidenceToken,
  bundleSlug,
  computeBundleIdentityHash,
  computeStepSequenceSignature,
  deriveDiscriminantKey,
  mintBundleId,
  slugBranch,
} from './ids/index'
export {
  LosslessServedBriefError,
  LosslessServedBriefSchema,
  computeBriefDigest,
  guardLosslessServedBrief,
} from './brief/index'
export { CURRENT_HANDOFF_SCHEMA_VERSION } from './handoff/index'
// 361 D-19: the one handoff version guard (SESSION-05 read-side discipline).
export { guardCompletedRunHandoff, HandoffVersionError, HANDOFF_MIGRATIONS } from './handoff/index'
export type { RunStatus, ExecutionContext, RunId } from './run/index'
export type {
  ArtifactRef,
  BundleDiscriminant,
  BundleIdentityCore,
  BundleIdentityInput,
  EvidenceToken,
  IssueId,
  RecordId,
} from './ids/index'
export type { Verdict, VerdictEvidence } from './verdict/index'
export type {
  DeltaEnvelope,
  CompareAndSet,
  BundleDraft,
  CurationAuthorship,
  CurationAuthorshipPath,
  CurationFallbackReason,
  Delta,
  IssueDelta,
} from './delta/index'
export type {
  BriefLine,
  CautionLine,
  LosslessServedBrief,
  LosslessServedBriefProofV1,
  ReadTrace,
  ServedAdmissionEvent,
  ServedAdmissionSurface,
  ServedBrief,
  ServedPromptTurn,
} from './brief/index'
export type {
  CompletedRunHandoff,
  CycleEvidence,
  DeclaredModelProfile,
  LocalEffectEvidence,
  InterpolatedVariable,
  ModelCallRecord,
  ModelIdentity,
  PerTestOutcome,
  PlanningFailureEvidence,
  SamplingParams,
  StagnationClass,
  StagnationEvidence,
  StepEvidence,
  StepPlanSource,
  SubActionEvidence,
  ToolExchangeEvidence,
} from './handoff/index'
// 360 termination-verb & AI-assertion evidence vocabulary (EXEC-05/EXEC-07)
export type {
  AiJudgmentEvidence,
  AssertValueEvidence,
  AssertValueOp,
  ReportedValueEvidence,
  TerminationEvidence,
  VerdictSource,
} from './handoff/index'

// 358 working-memory vocabulary (WM-01)
export type { WorkingMemoryEntry } from './memory/index'
export { workingMemoryEntrySchema } from './memory/index'

// 315 run+agent DTOs
export type { RunSession } from './run/index'
// 363 D-08: run-artifact payload type family (relocated from core/src/artifacts).
export { RUN_ARTIFACT_SCHEMA_VERSION } from './run/index'
export type {
  ArtifactRecord,
  JsonArray,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  RunArtifactConfigSnapshot,
  RunArtifactFinalizeInput,
  RunArtifactKind,
  RunArtifactMemoryDelta,
  RunArtifactMemoryDeltaAction,
  RunArtifactMemoryObservationSnapshot,
  RunArtifactMemorySnapshot,
  RunArtifactMetadata,
  RunArtifactPayload,
  RunArtifactReporterContext,
  RunArtifactRuntimeSnapshot,
  RunArtifactStageInput,
  RunArtifactSuiteMemberSnapshot,
  RunArtifactSuiteSourceSnapshot,
  RunArtifactTerminalError,
  RunArtifactTestSourceSnapshot,
} from './run/index'
// 361 bus schema v1 + M1-lite session vocabulary (SESSION-01/02/03, D-05/D-13/D-15)
export { CURRENT_BUS_SCHEMA_VERSION, RUN_EVENT_TYPES } from './run/index'
// 361 D-10/D-09: pure masked payload projections (SESSION-03 projection layer).
export {
  maskPayloadStrings,
  projectStepFinalized,
  projectSubActionRecorded,
  projectTestFinished,
  // 363 D-01 parity appends: hook lifecycle + retry projections (masked at the sink).
  projectHookStarted,
  projectHookFinished,
  projectTestRetryScheduled,
} from './run/index'
export type { MaskFn } from './run/index'
export type {
  MemberTestOutcome,
  RunCompletion,
  RunEvent,
  RunEventEnvelope,
  RunEventPayload,
  RunEventType,
  RunStartedPayload,
  RunFinishedPayload,
  VerdictPayload,
  RunWarningPayload,
  RunErrorPayload,
  HeartbeatPayload,
  TestStartedPayload,
  TestFinishedPayload,
  StepStartedPayload,
  StepFinalizedPayload,
  SubActionRecordedPayload,
  ChipEventPayload,
  // 363 D-01 parity appends: hook lifecycle + retry payloads.
  HookStartedPayload,
  HookFinishedPayload,
  TestRetryScheduledPayload,
} from './run/index'
export type { Job, JobKind, JobStatus, JobConclusionKind, JobId } from './job/index'
export { asJobId, jobSchema } from './job/index'
// 385 plan 02 (JOBQ-01/JOBQ-02/JOBQ-05): the agent job queue's DTO vocabulary.
export type {
  ChainedJobRequest,
  JobCheckpointEnvelope,
  JobEnqueueRequest,
  JobHandlerOutcome,
} from './job/index'
export {
  JOB_CHECKPOINT_SCHEMA_VERSION,
  chainedJobRequestSchema,
  jobCheckpointEnvelopeSchema,
  jobEnqueueRequestSchema,
  jobHandlerOutcomeSchema,
} from './job/index'
export type {
  Approval,
  ActionProposal,
  QaProposalKind,
  ProposalStatus,
  ApprovalPolicy,
  ApprovalDecision,
  ApprovalId,
  ProposalId,
} from './approval/index'
export {
  asApprovalId,
  asProposalId,
  approvalSchema,
  actionProposalSchema,
} from './approval/index'
export type { Patch, FileChange, Hunk, PatchStatus, PatchId } from './patch/index'
export { asPatchId, patchSchema } from './patch/index'

// 316 seam helpers
export type { RecordedActionResult } from './result/index'
export type { VerifierVerdict, Decision } from './handoff/index'
export type { BundleKind, FactSubtype, OriginStage } from './delta/index'
export { toRecordedActionResult } from './result/index'
export { computeEvidenceToken } from './ids/index'

// 338 reader DTOs (PORT-03)
export type { IndexEntry, RecordBody, BriefBlock, CautionBlock, ProcedureMatch } from './reader/index'
// 381 authoring-brief contracts (D-13/D-16/ABRF-01)
export type { AuthoringBrief, CoverageMap, ExemplarTest } from './reader/index'
export type { SearchOptions, ReadOptions, BuildRange, CanaryOutcome } from './reader/index'
export {
  createServingAdmissionState,
  inspectServingRecord,
  servingClusterKey,
  servingRecordMetadata,
  tryAdmitServingRecord,
} from './reader/index'
export type {
  ServingAdmissionDecision,
  ServingAdmissionInput,
  ServingAdmissionRejectionReason,
  ServingAdmissionState,
  ServingRecordMetadata,
} from './reader/index'

// 374 D-03/BNDL-03: pure event vocabulary and derivations stay storage-neutral.
export {
  BundleOutcomeEventSchema,
  dedupeEvents,
  eventDedupKey,
  survivingOutcomeEvents,
} from './knowledge/index'
export type { BundleOutcomeEvent, OriginClass } from './knowledge/index'
export {
  EVIDENCE_INCOMPLETE_ALPHA_DISCOUNT,
  ORIGIN_PRIORS,
  SERVING_ATTRIBUTION_WEIGHT,
  foldBundleTrust,
} from './knowledge/index'
export type { BundleStatus, DerivedTrustState } from './knowledge/index'
export {
  INSPECT_RECORD_VIEW_SCHEMA_VERSION,
  RECORD_CHANGE_SCHEMA_VERSION,
  InspectFilterSchema,
  InspectRecordViewSchema,
  RecordChangeSchema,
  guardInspectRecordView,
  guardRecordChange,
} from './knowledge/index'
export type {
  InspectFilter,
  InspectRecordView,
  RecordChange,
} from './knowledge/index'
export {
  BIMODAL_GAP_THRESHOLD,
  BIMODAL_MIN_MODE_N,
  CI_SEPARATION_Z,
  CUSUM_DECISION_H,
  CUSUM_SLACK_K,
  DRIFT_RELATIVE_THRESHOLD,
  DRIFT_SIGMA_K,
  KIND_CV_FLOOR,
  KIND_DEFAULT_CV,
  MEASUREMENT_MIN_N,
  MULTIMODAL_TRAILING_BUILDS,
  SHRINKAGE_PSEUDO_N,
  decideMeasurementDrift,
  foldMeasurements,
  measurementBaselineSchema,
  measurementObservationSchema,
  shrunkSigma,
} from './knowledge/index'
export type {
  MeasurementBaseline,
  MeasurementObservation,
} from './knowledge/index'
export { evaluatePromotionGate } from './knowledge/index'
export type {
  PromotionGateHoldReason,
  PromotionGateInput,
  PromotionGateObservation,
  PromotionGateVerdict,
} from './knowledge/index'
export {
  COLD_START_MAX_BUDGET_FRACTION,
  COLD_START_MAX_RECORDS,
  COLD_START_TRUST_DISCOUNT,
  applyColdStartSubCap,
  isVettedCandidate,
} from './knowledge/index'
export type {
  ColdStartBudgetEntry,
  VettedCandidateInput,
} from './knowledge/index'
export {
  cautionRootCauseClassSchema,
  DISTILLED_OBSERVATION_SCHEMA_VERSION,
  distilledObservationSchema,
  guardDistilledObservation,
} from './knowledge/distilled-observation'
export type {
  CautionRootCauseClass,
  DistilledObservation,
} from './knowledge/distilled-observation'
export {
  ArtifactsIndexSchema,
  BUNDLE_SCHEMA_VERSION,
  BundleManifestSchema,
  BundleProvenanceSchema,
  BundleRelationsSchema,
  computeMutableStateHash,
  deriveEvidenceToken,
  guardArtifactsIndex,
  guardBundleManifest,
  guardBundleProvenance,
  guardBundleRelations,
  verifyManifestIdentity,
} from './knowledge/index'
export type {
  ArtifactsIndex,
  BundleManifest,
  BundleProvenance,
  BundleRelation,
  BundleRelations,
  MutableStateHashInput,
} from './knowledge/index'
export {
  emitRecordMarkdown,
  parseRecordMarkdown,
  renderEmbeddingInput,
  screenStateSnapshotRelPath,
} from './knowledge/index'
export type { RecordFrontmatter } from './knowledge/index'

// 381 procedure & guarded-replay contracts (D-03/D-04/D-06, Pitfall 6)
export { curatorTier } from './knowledge/curator-tier'
export type { CuratorTier, ProcedureParamType } from './knowledge/curator-tier'
export {
  parseProcedureBody,
  procedureJsonValueSchema,
  procedureStepKeys,
  serializeProcedureBody,
} from './knowledge/procedure-steps'
export type {
  ProcedureBodyPayload,
  ProcedureGuardDescriptor,
  ProcedureGuardTarget,
  ProcedureJsonValue,
  ProcedureParameterSpec,
  ProcedureStepSpec,
  ProcedureValueSlot,
} from './knowledge/procedure-steps'
export {
  EMPTY_PROCEDURE_BINDING_AVAILABILITY,
  procedureParameterFillability,
} from './knowledge/procedure-fillability'
export type { ProcedureBindingAvailability } from './knowledge/procedure-fillability'
export {
  coerceProcedureBindingValue,
  procedureSourceBinding,
} from './knowledge/procedure-binding-coercion'
export type { ProcedureSourceBinding } from './knowledge/procedure-binding-coercion'
export {
  COORDINATE_ACTION_KEYS,
  NON_REPLAYABLE_ACTION_TYPES,
  isReplayableActionShape,
} from './action/replayability'
export {
  CREDENTIAL_VALUE_FIELDS,
  isCredentialValueField,
} from './action/credential-fields'

// 384 function-layer contract vocabulary (D-13/D-16): capability scopes, the caller
// record, and the seed op DTOs surfaces type against under the import firewall.
export {
  FunctionScopeSchema,
  RUN_SUMMARY_SCHEMA_VERSION,
  RUN_DETAIL_SCHEMA_VERSION,
  RunSummarySchema,
  RunDetailSchema,
  RunTestDetailSchema,
  RunsListInputSchema,
  RunsGetInputSchema,
  RunsStartInputSchema,
  RunsEventsInputSchema,
  RUN_START_ACKNOWLEDGEMENT_SCHEMA_VERSION,
  RunStartAcknowledgementSchema,
  RUN_EVENT_ENVELOPE_SCHEMA_VERSION,
  RunEventEnvelopeSchema,
  KNOWLEDGE_BUNDLE_SUMMARY_SCHEMA_VERSION,
  KnowledgeBundleSummarySchema,
  KnowledgeBundlesListInputSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  CONFIG_MASK_PLACEHOLDER,
  MaskedConfigEntrySchema,
  MaskedResolvedConfigSchema,
  ConfigGetInputSchema,
} from './functions/index'
export type {
  FunctionCaller,
  FunctionScope,
  RunSummary,
  RunDetail,
  RunTestDetail,
  RunsListInput,
  RunsGetInput,
  RunsStartInput,
  RunsEventsInput,
  RunStartAcknowledgement,
  KnowledgeBundleSummary,
  KnowledgeBundlesListInput,
  ConfigValueSource,
  MaskedConfigEntry,
  MaskedResolvedConfig,
  ConfigGetInput,
} from './functions/index'

// 342 safety contracts
export { guardrailPolicySchema } from './safety/index'
export type {
  RiskActionDescriptor,
  RiskTier,
  PolicyVerdict,
  ExecutionPolicyResult,
  TrustCredential,
  TrustScope,
  StandingApprovalGrant,
  ScanAction,
  ScanResult,
  ContentOrigin,
  MaskingContext,
  GuardrailPolicy,
  GuardrailDetectorFamily,
  ToolCallHookAllowResult,
  ToolCallHookMutateResult,
  ToolCallHookDenyResult,
  ToolCallHookResult,
  ToolResultHookResult,
  ContextHookResult,
} from './safety/index'
