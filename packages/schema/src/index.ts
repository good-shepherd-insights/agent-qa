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
export { ACTION_WIRE_SCHEMAS_BY_TYPE, actionWireSchema } from './action/wire-schema'
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
export { elementOrdinal, normalizeAccessibleName, distilledScreenStateDigest } from './screen/index'
export type { DistilledScreenStateInput } from './screen/index'
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
  EffectiveWorkersInput,
  IosPlatformConfig,
  McpStdioGrant,
  McpTokenEntry,
  RunServiceTokenEntry,
  PlatformBase,
  PlatformConfig,
  RemoteDeviceConfig,
  TimeoutConfig,
  Use,
  UseAndroid,
  UseConcurrency,
  UseIos,
  UseWeb,
  UseWebAuthState,
  WebAuthStateConfig,
  WebPlatformConfig,
} from './config/index'
export {
  appStateSchema,
  browserConfigSchema,
  DEFAULT_PARALLEL_WORKERS,
  deviceConfigSchema,
  McpStdioGrantSchema,
  McpTokenEntrySchema,
  RunServiceTokenEntrySchema,
  platformBase,
  platformConfigSchema,
  remoteDeviceSchema,
  resolveEffectiveWorkers,
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
  sha256hexBytes,
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
// 389 D-13: the exercised-anchors walk, promoted from the CLI curation tail so the agent
// cluster function, 390's recurrence window and the tail all consume ONE spelling.
export {
  actionRefs,
  classifySubActionRoute,
  elementAnchor,
  exercisedAnchors,
  resolvedElementEvidence,
  uniqueAnchors,
} from './identity/exercised-anchors'
export type {
  ClassifiedRoute,
  ResolvedElementEvidence,
} from './identity/exercised-anchors'
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
// 387 KREV-02 D-13/D-14: the serve-time retrieval trace, persisted beside ServedBrief.
export {
  RETRIEVAL_TRACE_LEGS,
  ServedRetrievalTraceV1Schema,
  TRACE_TRUNCATION_TOP_K,
  TraceLineSchema,
} from './brief/index'
// 407 TRST-01 D-13/D-17: the closed retrieval-rung vocabulary and its recorded form, plus the
// durable D-16 marker that says no knowledge reader was bound at all. One spelling for the
// runner that records, the banner that prints and the doctor row that grades.
export {
  NO_KNOWLEDGE_READER_TRUNCATION,
  RETRIEVAL_RUNGS,
  RETRIEVAL_RUNG_REASONS,
  RecordedRetrievalRungSchema,
} from './brief/index'
export { CURRENT_HANDOFF_SCHEMA_VERSION } from './handoff/index'
// 361 D-19: the one handoff version guard (SESSION-05 read-side discipline).
export { guardCompletedRunHandoff, HandoffVersionError, HANDOFF_MIGRATIONS } from './handoff/index'
// 388 D-09/D-11/D-14/D-15: the chain-terminal notification record and THE one chip-status
// vocabulary. Both are minted here rather than beside a consumer because each has several —
// the notification row is read by chat and by the dashboard, and the chip words are spoken by
// the bus, the read op and the CLI's summary line.
// 391 D-16/D-18: the per-run digest's read-time contract, minted beside the frozen row it
// deliberately does not widen. Nothing persists a digest — it is composed live, keyed by runId,
// which is what makes "exactly one digest per run" structural rather than throttled.
export {
  CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION,
  POST_PROCESSING_CHIP_STATUSES,
  RunDigestCandidateReportSchema,
  RunDigestChainOutcomesSchema,
  RunDigestProposalRowSchema,
  RunDigestQuarantineReportSchema,
  RunDigestSchema,
  RunNotificationSchemaError,
  RunsDigestInputSchema,
  guardRunNotification,
  isPostProcessingChipStatus,
} from './notification/index'
export type {
  PostProcessingChipStatus,
  PostProcessingChips,
  PostProcessingStatus,
  RunDigest,
  RunDigestCandidateReport,
  RunDigestChainOutcomes,
  RunDigestProposalRow,
  RunDigestQuarantineReport,
  RunNotification,
  RunNotificationOutcome,
  RunNotificationStageStatus,
  RunNotificationStages,
  RunNotificationVerdictSummary,
  RunsDigestInput,
} from './notification/index'
export type { RunStatus, ExecutionContext, RunId } from './run/index'
export type {
  ArtifactRef,
  BundleDiscriminant,
  BundleIdentityCore,
  BundleIdentityInput,
  EvidenceToken,
  RecordId,
} from './ids/index'
export type { Verdict, VerdictClass, VerdictEvidence } from './verdict/index'
export { VERDICT_CLASSES, isVerdictClass } from './verdict/index'
// 390 D-01/D-03/D-11/D-12: the committed quarantine ledger's event contract and the state
// vocabulary every quarantine surface speaks — the fold, the list verb, the entity card and the
// recurrence clause's ladder arms. `'expired'` is a COMPUTED state, never an event.
export {
  CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
  QUARANTINE_ENTRY_STATE_NAMES,
  QUARANTINE_EVENT_KINDS,
  QUARANTINE_LEDGER_MIGRATIONS,
  QUARANTINE_UNASSIGNED_OWNER,
  QuarantineLedgerVersionError,
  guardQuarantineLedgerEvent,
  hasQuarantineEventShape,
  isQuarantineEventKind,
  quarantineAppliesToTest,
} from './quarantine/index'
export type {
  QuarantineAppliedEntry,
  QuarantineEnteredEvent,
  QuarantineEntryState,
  QuarantineEntryStateName,
  QuarantineEventKind,
  QuarantineLadderState,
  QuarantineLedgerEvent,
  QuarantineOwner,
  QuarantineReleasedEvent,
  QuarantineRenewedEvent,
  QuarantineSnapshotMatch,
} from './quarantine/index'
// 390 D-12/D-13: the three verbs' wire contract and the port they dispatch through. Minted
// here rather than beside the op specs because two packages consume it and neither may import
// the other — `agent` declares the specs against these validators, knowledge-local implements
// the port over the committed ledger. `release`'s no-entry and `add`'s renewed are result
// ARMS, never throws.
export {
  QuarantineAddInputSchema,
  QuarantineAddOutputSchema,
  QuarantineEntrySchema,
  QuarantineListInputSchema,
  QuarantineListOutputSchema,
  QuarantineReleaseInputSchema,
  QuarantineReleaseOutputSchema,
} from './quarantine/index'
export type {
  QuarantineAddInput,
  QuarantineAddOutput,
  QuarantineListInput,
  QuarantineListOutput,
  QuarantineOperationsPort,
  QuarantineReleaseInput,
  QuarantineReleaseOutput,
} from './quarantine/index'
// 389 D-05/D-07/D-09/D-10: the verdict truth vocabulary — sentence parts joined to Verdict
// by perTest (beside, never inside the frozen §A9 union), the version-guarded run analysis
// artifact, and the ONE resolved-verdict accessor every consumer routes through. 390 FLAK-01
// adds the fingerprint's INPUT stage (`failingStepOf`/`errorTextOf`) beside the frozen recipe,
// hoisted out of agent so knowledge-local's recurrence windows can key the same way.
export {
  admitAnalysisArtifactForRun,
  ANALYSIS_FILE,
  ANALYSIS_MIGRATIONS,
  AnalysisVersionError,
  CURRENT_ANALYSIS_SCHEMA_VERSION,
  errorTextOf,
  failingStepOf,
  failureFingerprint,
  guardRunAnalysisArtifact,
  QUOTE_SEARCHED_STEP_FIELDS,
  QUOTE_SEARCHED_TEST_OUTCOME_FIELDS,
  resolveRunVerdicts,
  resolveVerdictMisdirection,
  searchedQuoteTexts,
  searchedTestOutcomeTexts,
  validateAnalysisAgainstHandoff,
  VerdictSentencePartsSchema,
  // 393 D-13: the sibling anchor-coverage recipe (gate 3), beside the frozen failure recipe.
  // `testFingerprintElements` is the ONE walk both sides of gate 3's comparison go through —
  // knowledge-local's suite fold and the agent's draft side alike (393-06).
  ACTION_ANCHOR_FINGERPRINT_VERSION,
  ASSERT_ACTION_TYPES,
  actionAnchorElement,
  actionAnchorSequence,
  testFingerprintElements,
} from './verdict/index'
export type {
  ActionAnchorElementInput,
  FingerprintEvidenceLike,
  AnalysisArtifactAdmission,
  AnalysisValidationOptions,
  AnalysisValidationReject,
  AnalysisValidationResult,
  FailureFingerprintInput,
  ResolvedMisdirection,
  RunAnalysisArtifact,
  VerdictGroundingQuote,
  VerdictSentenceParts,
} from './verdict/index'
// 422 D-17/D-19/D-20: the circularity guard's evidence vocabulary. `memoryOnPath` membership is
// derived by CODE from the run's own served briefs and the per-record cross-check is folded
// under one law, so a producer composing evidence and the validator checking it cannot drift.
export {
  aggregateMisdirectionEvidence,
  deriveMemoryOnPath,
  deriveMemoryOnPathSites,
  guardMisdirectionEvidence,
  MEMORY_ON_PATH_TRUSTS,
  MemoryOnPathEntrySchema,
  memoryOnPathTrustOf,
  MISDIRECTION_BACKINGS,
  MISDIRECTION_ROOT_POSTURES,
  misdirectionSourceDigest,
  MisdirectionEvidenceError,
  MisdirectionEvidenceSchema,
  MisdirectionRecordResultSchema,
} from './verdict/index'
export type {
  MemoryOnPathEntry,
  MemoryOnPathSite,
  MemoryOnPathTrust,
  MisdirectionAggregate,
  MisdirectionAggregationInput,
  MisdirectionBacking,
  MisdirectionEvidence,
  MisdirectionRecordResult,
  MisdirectionRootPosture,
  MisdirectionSamples,
} from './verdict/index'
export type {
  DeltaEnvelope,
  CompareAndSet,
  BundleDraft,
  CurationAuthorship,
  CurationAuthorshipPath,
  CurationFallbackReason,
  Delta,
  DeltaKind,
  DeltaOrigin,
} from './delta/index'
// 387 D-17: runtime projections of the §7.3 discriminant and origin vocabularies, so a
// proposal boundary can name what a delta is without re-declaring the union.
export { DELTA_KINDS, DELTA_ORIGINS } from './delta/index'
export type {
  BriefLine,
  CautionLine,
  LosslessServedBrief,
  LosslessServedBriefProofV1,
  ReadTrace,
  RecordedRetrievalRung,
  RetrievalRung,
  RetrievalRungReason,
  RetrievalTraceLeg,
  ServedAdmissionEvent,
  ServedAdmissionSurface,
  ServedBrief,
  ServedPromptTurn,
  ServedRetrievalTraceV1,
  TraceLine,
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
// 403 D-05/D-08: live-view frame vocabulary — frames as data, capability declared per handle.
export { LiveStreamDeclarationSchema } from './run/index'
// 403 D-01..D-04: the liveUrl capability-token vocabulary (types + refusal names only).
export { LIVE_URL_REFUSAL_REASONS, LIVE_URL_SCOPE } from './run/index'
export type { LiveUrlClaims, LiveUrlRefusalReason, LiveUrlSigner, LiveUrlVerdict } from './run/index'
export type {
  LiveFrame,
  LiveFrameMetadata,
  LiveFrameSubscription,
  LiveStreamDeclaration,
  LiveStreamKind,
} from './run/index'
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
// 405-06 D-10: the masked-marker vocabulary (DETL-02) — minted once here so the server display
// seam and the UI chip parser import one spelling instead of writing two.
export { MASKED_MARKER_DELIMITER, MASKED_MARKER_PATTERN, PLACEHOLDER_PATTERN, maskedMarker } from './run/index'
export type { MaskedCategory } from './run/index'
// 402-04 D-10/D-14: handle identity — the TOTAL event-scope classification, the one filter
// predicate, the composite id spelling and the additive runStarted roster reader.
export {
  HANDLE_ID_SEPARATOR,
  RUN_EVENT_SCOPE,
  RUN_EVENT_SCOPE_TYPES,
  handleId,
  handleRosterOf,
  memberIndexOf,
  parseHandleId,
  parseHandleParam,
  passesHandleFilter,
} from './run/index'
export type { HandleParamParse, RunEventScope } from './run/index'
export type {
  MemberTestOutcome,
  RunCompletion,
  RunEvent,
  RunEventEnvelope,
  RunEventPayload,
  RunEventType,
  RunStartedPayload,
  RunFinishedPayload,
  // 404-01 (D-09): the ratified post-processing posture union `runFinished.disposition` carries.
  PostProcessingDisposition,
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
export { asJobId, isJobKind, jobSchema } from './job/index'
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
  // 393 D-20 (WTST-06): the analyze-run payload mirror, validated producer-side at enqueue.
  AnalyzeRunPayloadSchema,
} from './job/index'
export type { AnalyzeRunPayload } from './job/index'
export type { Patch, FileChange, Hunk, PatchStatus, PatchId } from './patch/index'
export { asPatchId, patchSchema } from './patch/index'
// 395 D-01/D-17 · CFGM-01/03/04: the config editor's DTOs, and THE diff/digest primitive both
// halves of a config proposal call — construction in `agent`, apply in `cli`. The primitive is
// exported from here and from nowhere else for the reason its own header states: two recipes for
// one digest contract is 394's CR-02 defect class, and this phase's whole freshness guarantee is
// the two halves agreeing byte for byte.
export {
  CONFIG_BLOCKED_REASONS,
  CONFIG_DIFF_OUTCOMES,
  CONFIG_FILE_CHANGE_KINDS,
  CONFIG_HOOK_RUNTIMES,
  CONFIG_REFERENCE_KINDS,
  CONFIG_REFUSAL_REASONS,
  CONFIG_SET_DEFAULT_HOOKS_FILE,
  CONFIG_SET_GITIGNORE,
  CROSS_BOUNDARY_REASONS,
  CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION,
  ConfigApplyCommitSchema,
  ConfigApplyOutcomeSchema,
  ConfigApplyReceiptsSchema,
  ConfigAuthSetInputSchema,
  ConfigFieldSetInputSchema,
  ConfigHookAddInputSchema,
  ConfigProjectScaffoldInputSchema,
  ConfigProposalApplyInputSchema,
  ConfigProposalApplyableV1Schema,
  ConfigProposalBlockedV1Schema,
  ConfigProposalFileSchema,
  ConfigProposalV1Schema,
  ConfigProposeOutputSchema,
  ConfigScanFindingSchema,
  ConfigTargetCreateInputSchema,
  ConfigTargetEditInputSchema,
  ConfigUndoProposeInputSchema,
  EmptyConfigDiffFileError,
  MAX_CONFIG_REFERENCE_LENGTH,
  SECRET_ADJACENT_CONFIG_FIELDS,
  UnrenderableConfigDiffError,
  base64Decode,
  base64Encode,
  enumerateConfigFileSet,
  isLegalConfigReference,
  isSecretAdjacentConfigField,
  renderConfigDiff,
  utf8Decode,
  utf8Encode,
} from './config-mutation/index'
export type {
  ConfigApplyCommit,
  ConfigApplyOutcome,
  ConfigApplyReceipts,
  ConfigAuthSetInput,
  ConfigBlockedReason,
  ConfigDiffChanged,
  ConfigDiffFileInput,
  ConfigDiffOutcome,
  ConfigDiffResult,
  ConfigDiffUnchanged,
  ConfigFieldSetInput,
  ConfigFileChangeKind,
  ConfigFileDigest,
  ConfigHookAddInput,
  ConfigHookRuntime,
  ConfigProjectScaffoldInput,
  ConfigProposalApplyInput,
  ConfigProposalApplyableV1,
  ConfigProposalBlockedV1,
  ConfigProposalFile,
  ConfigProposalV1,
  ConfigProposeOutput,
  ConfigReferenceKind,
  ConfigRefusalReason,
  ConfigScanFinding,
  ConfigTargetCreateInput,
  ConfigTargetEditInput,
  ConfigUndoProposeInput,
  CrossBoundaryReason,
  SecretAdjacentConfigField,
} from './config-mutation/index'

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
export type { SearchOptions, ReadOptions, BuildRange, CanaryOutcome, CanaryAblationEvidence } from './reader/index'
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
export { guardTrustPriorTable } from './knowledge/trust-fold'
export type { TrustPriorTable } from './knowledge/trust-fold'
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
export { GATE_SET_VERDICT_WORDS, evaluatePromotionGate } from './knowledge/index'
export type {
  PromotionGateHoldReason,
  PromotionGateInput,
  PromotionGatePosture,
  ResolvedPromotionGatePosture,
  UnavailablePromotionGatePosture,
  GateSetVerdictWord,
  PromotionJudgePosture,
  PromotionCanaryPosture,
  PromotionPostureScope,
  PromotionGateSetCounts,
  PromotionGateObservation,
  PromotionGateVerdict,
} from './knowledge/index'
export {
  COLD_START_MAX_BUDGET_FRACTION,
  COLD_START_MAX_RECORDS,
  COLD_START_TRUST_DISCOUNT,
  LOWER_TRUST_PATH_DISCOUNT,
  GATE2_DEFAULT_STALE_CONFIRMATIONS,
  GATE2_DEFAULT_MAX_LOWER_TRUST_PER_SCOPE,
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

// 387 KREV-01 D-17/D-19: the propose+apply seam, the forget receipt, and the review-verb
// input/output contracts every 387-06/387-08 op imports rather than re-minting.
export {
  BRIEF_WHY_NO_TRACE_REASONS,
  BRIEF_WHY_RESULT_KINDS,
  BriefWhyInputSchema,
  BriefWhyResultSchema,
  ForgetPreviewSchema,
  ForgetReceiptV1Schema,
  ForgetTargetRefSchema,
  KNOWLEDGE_APPLY_OUTCOMES,
  KNOWLEDGE_PROJECTIONS,
  KNOWLEDGE_PROPOSAL_STATUSES,
  KNOWLEDGE_REVIEW_VERBS,
  KnowledgeAcceptInputSchema,
  KnowledgeAcceptProposeInputSchema,
  KnowledgeApplyOutcomeSchema,
  KnowledgeProposeOutcomeSchema,
  KnowledgeForgetInputSchema,
  KnowledgeForgetProposeInputSchema,
  KnowledgeProposalApplyInputSchema,
  KnowledgeProposalV1Schema,
  KnowledgeRecordShowInputSchema,
  KnowledgeRecordShowOutputSchema,
  KnowledgeRecordShowResultSchema,
  KnowledgeRecordsDiffInputSchema,
  KnowledgeRecordsDiffOutputSchema,
  KnowledgeRecordsInspectInputSchema,
  KnowledgeRecordsInspectOutputSchema,
  KnowledgeRejectInputSchema,
  KnowledgeRejectProposeInputSchema,
  KnowledgeTargetRefSchema,
  ProposalIdSchema,
  TombstonedRecordSchema,
} from './knowledge/index'
export type {
  BriefWhyInput,
  BriefWhyNoTraceReason,
  BriefWhyResult,
  BriefWhyResultKind,
  ForgetPreview,
  ForgetReceiptV1,
  ForgetTargetRef,
  KnowledgeAcceptInput,
  KnowledgeAcceptProposeInput,
  KnowledgeApplyOutcomeDto,
  KnowledgeApplyOutcomeKind,
  KnowledgeProposeOutcomeDto,
  KnowledgeForgetInput,
  KnowledgeForgetProposeInput,
  KnowledgeProjection,
  KnowledgeProposalApplyInput,
  KnowledgeProposalStatus,
  KnowledgeProposalV1,
  KnowledgeRecordShowInput,
  KnowledgeRecordShowOutput,
  KnowledgeRecordShowResult,
  KnowledgeRecordsDiffInput,
  KnowledgeRecordsDiffOutput,
  KnowledgeRecordsInspectInput,
  KnowledgeRecordsInspectOutput,
  KnowledgeRejectInput,
  KnowledgeRejectProposeInput,
  KnowledgeReviewVerb,
  KnowledgeTargetRef,
} from './knowledge/index'

// 381 procedure & guarded-replay contracts (D-03/D-04/D-06, Pitfall 6)
export { curatorTier } from './knowledge/curator-tier'
export type { CuratorTier, ProcedureParamType } from './knowledge/curator-tier'
export { plannerCapabilityTier } from './knowledge/planner-tier'
export type { PlannerCapability, PlannerCapabilityEvidence } from './knowledge/planner-tier'
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
  FUNCTION_CALLER_ORIGINS,
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
  // 403 D-03: the runs.liveurl mint op's two contracts.
  RunsLiveUrlInputSchema,
  RunsLiveUrlResultSchema,
  // 388 D-14: the chip-truth read op's two contracts, and the notification's wire shape.
  RunsPostProcessingInputSchema,
  RunNotificationSchema,
  PostProcessingStatusSchema,
  // 405 D-03: the run-detail read op's contracts.
  RunsDetailInputSchema,
  RunDetailMemberSchema,
  RunStepTokenUsageSchema,
  RunDetailStepSchema,
  RunDetailSubActionSchema,
  RunTokenTotalsSchema,
  RunDetailProjectionSchema,
  // 405-05 D-12/D-13: the artifact read op's two contracts.
  RunsArtifactInputSchema,
  RunsArtifactResultSchema,
  // 407 LERN-01/LERN-02 D-05: the `runs.knowledge` panel read's contracts.
  RunsKnowledgeInputSchema,
  RunKnowledgeBriefLineSchema,
  RunKnowledgeReadTraceSchema,
  RunKnowledgeCautionLineSchema,
  RunKnowledgeTraceSchema,
  RunKnowledgePlanSourceSchema,
  RunKnowledgeStepSchema,
  RunKnowledgeCanaryAttributionSchema,
  RunKnowledgeProjectionSchema,
  RUN_START_ACKNOWLEDGEMENT_SCHEMA_VERSION,
  RunStartAcknowledgementSchema,
  RUN_EVENT_ENVELOPE_SCHEMA_VERSION,
  RunEventEnvelopeSchema,
  // 389 D-11: the analysis.get op's contracts.
  AnalysisGetInputSchema,
  AnalysisGetOutputSchema,
  AnalysisCitedArtifactSchema,
  AnalysisVerdictEvidenceSchema,
  AnalysisResolvedVerdictSchema,
  AnalysisSentenceSchema,
  AnalysisClusterViewSchema,
  // 422 D-17/D-19/D-20: a resolved verdict's circularity evidence, as a surface reads it.
  ANALYSIS_MISDIRECTION_REASONS,
  AnalysisMisdirectionRecordSchema,
  AnalysisMemoryOnPathEntrySchema,
  AnalysisVerdictMisdirectionSchema,
  projectVerdictMisdirection,
  KNOWLEDGE_BUNDLE_SUMMARY_SCHEMA_VERSION,
  KnowledgeBundleSummarySchema,
  KnowledgeBundlesListInputSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  CONFIG_MASK_PLACEHOLDER,
  MaskedConfigEntrySchema,
  MaskedResolvedConfigSchema,
  ConfigGetInputSchema,
  // 393 D-01: the authoring.draft.verify op contracts (D-01 sketches the verb as
  // `verify_draft`; that spelling is unrepresentable — see functions/authoring.ts).
  AuthoringVerifyDraftInputSchema,
  AuthoringVerifyDraftOutputSchema,
  // 394 D-01: the authoring.draft.write op contracts and the closed loop-outcome vocabulary.
  AUTHORING_LOOP_OUTCOMES,
  AuthoringDraftWriteInputSchema,
  AuthoringDraftWriteOutputSchema,
  // 394 D-04: the stage-2 dedup refusal's payload and its two named continuations.
  AUTHORING_DEDUP_CONTINUATIONS,
  AuthoringDedupRefusalSchema,
  // 411 D-05..D-08: the stop payload a `stopped` invocation reports its verdict on.
  AUTHORING_REPAIR_ABANDONMENTS,
  AUTHORING_STOP_SIGNAL_CLASSES,
  AuthoringStopFailurePointSchema,
  AuthoringStopSchema,
  // 394-09 D-21: the authoring.draft.edit op contracts — the patch contract's second consumer.
  AuthoringDraftEditInputSchema,
  AuthoringDraftEditOutputSchema,
  // 394-07 D-12: the authoring.funnel.get op contracts and the closed window scope.
  AuthoringFunnelGetInputSchema,
  AuthoringFunnelGetOutputSchema,
  AuthoringFunnelWindowSchema,
  // 402-01 (D-06/D-13/D-15 · INVK-03): the authed run service's wire vocabulary.
  RUN_SERVICE_CONTRACT_VERSION,
  RUN_SERVICE_ERROR_CODES,
  RUN_SERVICE_REFUSED_REQUEST_FIELDS,
  RunServiceDenialBodySchema,
  RunServiceErrorBodySchema,
  RunServiceReadinessSchema,
  RunServiceReplayFloorBodySchema,
  RunServiceStartRequestSchema,
  SERVICE_BEARER_REFUSAL_REASONS,
} from './functions/index'
export type {
  FunctionCaller,
  FunctionCallerOrigin,
  FunctionScope,
  RunSummary,
  RunDetail,
  RunTestDetail,
  RunsListInput,
  RunsGetInput,
  RunsStartInput,
  RunsEventsInput,
  RunsLiveUrlInput,
  RunsLiveUrlResult,
  RunsPostProcessingInput,
  RunStartAcknowledgement,
  // 405 D-03: the run-detail shapes — the port's rows and the op's projection over them.
  RunsDetailInput,
  RunDetailMember,
  RunStepTokenUsage,
  RunDetailStep,
  RunDetailSubAction,
  RunTokenTotals,
  RunDetailRows,
  RunDetailProjection,
  // 405-05 D-12/D-13/D-15: the artifact read's shapes and the port's three-arm lookup answer.
  RunsArtifactInput,
  RunsArtifactResult,
  // 407 D-05: the panel projection's inferred shapes.
  RunsKnowledgeInput,
  RunKnowledgeProjection,
  RunKnowledgeStep,
  RunKnowledgeTrace,
  RunKnowledgePlanSource,
  RunKnowledgeCanaryAttribution,
  EvidenceBlobLookup,
  EvidenceBlobPresence,
  RunDetailArtifactRef,
  AnalysisGetInput,
  AnalysisGetOutput,
  AnalysisCitedArtifact,
  AnalysisVerdictEvidence,
  AnalysisResolvedVerdict,
  AnalysisSentence,
  AnalysisClusterMemberRef,
  AnalysisClusterView,
  AnalysisMisdirectionReason,
  AnalysisMisdirectionRecord,
  AnalysisMemoryOnPathEntry,
  AnalysisVerdictMisdirection,
  KnowledgeBundleSummary,
  KnowledgeBundlesListInput,
  ConfigValueSource,
  MaskedConfigEntry,
  MaskedResolvedConfig,
  ConfigGetInput,
  AuthoringVerifyDraftInput,
  AuthoringVerifyDraftOutput,
  AuthoringDraftWriteInput,
  AuthoringDraftWriteOutput,
  AuthoringLoopOutcomeKind,
  AuthoringDedupContinuation,
  AuthoringDedupRefusal,
  AuthoringRepairAbandonment,
  AuthoringStop,
  AuthoringStopFailurePoint,
  AuthoringStopSignalClass,
  AuthoringDraftEditInput,
  AuthoringDraftEditOutput,
  AuthoringFunnelGetInput,
  AuthoringFunnelGetOutput,
  AuthoringFunnelWindow,
  RunServiceDenialBody,
  RunServiceErrorBody,
  RunServiceErrorCode,
  RunServiceReadiness,
  RunServiceReplayFloorBody,
  RunServiceStartRequest,
  ServiceBearerRefusalReason,
  ServiceBearerVerdict,
} from './functions/index'

// 393 (WTST-02, D-18/D-19): the keep-gate authoring vocabulary. `computeDraftDisposition` is
// the ONE derivation of a draft's disposition — 394 consumes it and must not re-derive its own.
export {
  computeDraftDisposition,
  DRAFT_DISPOSITIONS,
  DRAFT_GATE_NAMES,
  DRAFT_STABILITY_RUNS_N,
  CURRENT_DRAFT_RECEIPT_SCHEMA_VERSION,
  AddsValueFindingSchema,
  DraftGateResultsSchema,
  DraftReceiptSchema,
  DraftRefSchema,
  GateRunRecordSchema,
  StepClassificationRowSchema,
} from './authoring/index'
export type {
  AddsValueFinding,
  DraftDisposition,
  DraftDispositionInput,
  DraftGateBooleans,
  DraftGateName,
  DraftGateResults,
  DraftReceipt,
  DraftRef,
  GateRunRecord,
  StepClassificationRow,
} from './authoring/index'

// 394 (WTST-07, D-20): the RFC-6902 `{thoughts, patches}` edit vocabulary and the pinned
// editable-region fence. The CST applier in `core` is its only mutating consumer.
export {
  EDITABLE_POINTER_ROOTS,
  PATCH_OP_KINDS,
  PatchOpSchema,
  TestEditPatchSetSchema,
  isEditablePointer,
  parseJsonPointer,
  pointerRootOf,
} from './authoring/index'
export type {
  EditablePointerRoot,
  PatchOp,
  PatchOpKind,
  TestEditPatchSet,
} from './authoring/index'

// 394-06 (WTST-01, D-05): the ONE envelope payload arm — a verified draft awaiting a human
// decision — plus the ONE run-evidence coordinate vocabulary the router builds and the stop arm
// carries.
export {
  AUTHORED_SUITE_SLUG_MAX_LENGTH,
  CURRENT_AUTHORING_PROPOSAL_SCHEMA_VERSION,
  RUN_EVIDENCE_CHANNELS,
  RunEvidenceRefSchema,
  TestDraftProposalV1Schema,
  authoredSuiteTargetPath,
} from './authoring/index'
export type {
  RunEvidenceChannel,
  RunEvidenceRef,
  TestDraftProposalV1,
} from './authoring/index'

// 394-07 (WTST-05, D-13/D-15): the honesty funnel. `computeAuthoringFunnel` is the ONE
// derivation of the four frozen stages, the keep rate and the acceptance-failure flag —
// every caller renders what it returns and derives nothing. Today that is `authoring.funnel.get`.
// `successFramingViolations` is the prohibition made mechanical: it is exported so a surface
// composing a BLOCK around the funnel's line screens its own wording through the same words.
export {
  AUTHORING_FUNNEL_STAGES,
  AuthoringFunnelSchema,
  FUNNEL_MIN_DRAFTS_FLOOR,
  FUNNEL_PHRASES,
  FUNNEL_SUCCESS_FRAMING_LEXICON,
  FunnelSuccessFramingError,
  KEEP_RATE_CEILING,
  computeAuthoringFunnel,
  renderFunnelLine,
  successFramingViolations,
} from './authoring/index'
export type {
  AuthoringAcceptance,
  AuthoringFunnel,
  AuthoringFunnelInput,
  AuthoringFunnelStage,
  FunnelRenderParts,
  FunnelSideCounters,
} from './authoring/index'

// 394-07 (WTST-05, D-14): the mixed-verdict suite-stability read. PURE and it starts zero runs —
// D-14 is read-side precisely so WTST-08's fan-out preview stays a number somebody can honour.
export {
  NEIGHBOUR_INSTABILITY_REASONS,
  SUITE_STABILITY_POSTURES,
  assessSuiteStability,
  suiteTestRef,
} from './authoring/index'
export type {
  FlakyNeighbour,
  NeighbourInstabilityReason,
  SuiteNeighbourRow,
  SuiteStabilityAssessment,
  SuiteStabilityInput,
  SuiteStabilityPosture,
} from './authoring/index'

// 394-08 (WTST-08, D-03/D-10): the ONE fan-out arithmetic. `computeFanOutBound` is the only place
// `initial N + K probes + final N` is added up — the dispatch confirm renders it and the finished
// proposal reports against it, so a preview that understated what the loop would spend cannot be
// produced by one surface disagreeing with the other.
export {
  ConsumedRunSchema,
  FAN_OUT_PHRASES,
  FAN_OUT_RUN_PURPOSES,
  FanOutBoundError,
  FanOutBoundInputSchema,
  FanOutBoundSchema,
  FanOutReportSchema,
  NO_RUNS_FAN_OUT_BOUND,
  buildFanOutReport,
  computeFanOutBound,
  renderFanOutPreview,
  renderFanOutReport,
} from './authoring/index'
export type {
  ConsumedRun,
  FanOutBound,
  FanOutBoundInput,
  FanOutReport,
  FanOutRunPurpose,
} from './authoring/index'

// 394-09 (WTST-01, D-17): procedure-by-reference. A served procedure reaches a compiled draft as
// an ordinary NL step written in the procedure's own anchor vocabulary, matched and replayed at run
// time against the LIVE record — so a later procedure fix propagates and the committed test carries
// no learned-shelf record id that supersession or collection could rot.
export { procedureStepVocabulary } from './authoring/index'

// 387 ENTY-01/ENTY-02 — entity addressing: short-IDs, the agentqa:// URI scheme, the one
// card shape and the two resolution unions.
export {
  ENTITY_CARD_MAX_ACTIONS,
  ENTITY_CARD_MAX_KEY_FACTS,
  ENTITY_DASHBOARD_ROUTES,
  ENTITY_DASHBOARD_ROUTE_GRAINS,
  ENTITY_EXACT_MATCH_SCORE,
  ENTITY_FIRST_ORDINAL,
  ENTITY_IDENTITY_FACT_LABELS,
  ENTITY_KINDS,
  ENTITY_NO_MATCH_REASONS,
  ENTITY_ORDINAL_MIN_DIGITS,
  ENTITY_RESOLUTION_MAX_CANDIDATES,
  ENTITY_STATUSES,
  ENTITY_URI_SCHEME,
  ENTITY_URI_SEGMENTS,
  ENTITY_URL_ROUTE,
  ENTITY_URL_ROUTE_PARAMS,
  ENTITY_URL_SLUG_MAX_LENGTH,
  SLUG_ADDRESSED_ENTITY_KINDS,
  ActionRefSchema,
  EntitiesGetInputSchema,
  EntitiesResolveInputSchema,
  EntityCardResolutionSchema,
  EntityCardSchema,
  EntityDescriptorSchema,
  EntityResolutionSchema,
  EntityUriSchema,
  KeyFactSchema,
  canonicalShortId,
  entityKindForUriSegment,
  entityTitleSlug,
  entityUriSegmentFor,
  formatEntityOrdinal,
  formatEntityUri,
  formatEntityUrl,
  formatOrdinalShortId,
  formatSlugShortId,
  isEntityKind,
  isEntityUri,
  isRoutedEntityKind,
  isSlugAddressedKind,
  parseEntityUri,
  parseShortId,
} from './entity/index'
export type {
  ActionRef,
  EntitiesGetInput,
  EntitiesResolveInput,
  EntityCard,
  EntityCardResolution,
  EntityDashboardRoute,
  EntityDashboardRouteGrain,
  EntityDescriptor,
  EntityKind,
  EntityNoMatchReason,
  EntityResolution,
  EntityStatus,
  EntityStatusFor,
  EntityUriSegment,
  EntityUrlInput,
  KeyFact,
  ParsedEntityUri,
  ParsedShortId,
} from './entity/index'

// 342 safety contracts
export { guardrailPolicySchema } from './safety/index'
// 391 D-04/D-11: the committed standing-grant ledger's event vocabulary, both guard legs, and the
// ONE canonical action scope the mint and the gate call-site both read (never re-spell).
export {
  CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
  GRANT_LEDGER_EVENT_KINDS,
  GRANT_LEDGER_MIGRATIONS,
  GrantLedgerVersionError,
  STANDING_APPROVAL_SCOPE,
  guardGrantLedgerEvent,
  hasGrantEventShape,
  isGrantLedgerEventKind,
} from './safety/index'
export type {
  ActiveStandingGrant,
  GrantLedgerEvent,
  GrantLedgerEventKind,
  GrantRecordedEvent,
  GrantRevokedEvent,
} from './safety/index'
// 391-11 (REVIEW WR-05): the scope key set, spelled ONCE. A test that wants a key OUTSIDE the set
// must compute it against this value rather than hard-code one that a later key addition could
// legalise.
export { TRUST_SCOPE_KEYS } from './safety/index'
// 401-15 (WR-01 / T-401-G5 / T-401-G6): the disclosure scrub, exported beside the field whose law
// it enforces. Every composition that fills `RiskActionDescriptor.disclosure` applies it — the two
// today are the run gate's preview and `invoke.ts`'s per-op `spec.disclose` result.
export {
  DISCLOSURE_FRAGMENT_MAX_LENGTH,
  DISCLOSURE_REPLACEMENT_CHARACTER,
  DISCLOSURE_TEXT_MAX_LENGTH,
  DISCLOSURE_TRUNCATION_MARK,
  scrubDisclosureFragment,
  scrubDisclosureText,
} from './safety/index'
// 391 D-05/D-07: the closed grant-ineligible action-class set and its membership predicate. One
// export, consulted by BOTH the grant mint and the grant read — a config-sourced protected list
// would be self-referentially mutable, which is the hole PROP-05 closes.
export { PROTECTED_ACTION_CLASSES, isProtectedActionClass } from './safety/index'
export type { ProtectedActionClass } from './safety/index'
// 400 D-15: the closed remedy vocabulary a denial carries beside its prose reason, and the ONE
// per-surface projection every render runs through. `remediesRenderableBy` is published rather
// than re-derived at each door, because a render that filtered for itself is how one surface ends
// up printing another surface's instructions — the defect this vocabulary closes.
export {
  GATE_REMEDY_KINDS,
  GATE_REMEDY_SURFACES,
  GATE_REMEDY_SURFACES_BY_KIND,
  remediesRenderableBy,
} from './safety/index'
export type {
  GateRemedy,
  GateRemedyKind,
  GateRemedySurface,
  RemedyKindFor,
} from './safety/index'
// 391 D-03/D-05: the grant verbs' contracts and the ONE standing-grants port. `record` is on the
// port and on no registry entry — a standing approval arises only from the accept escalation.
export {
  GrantRecordInputSchema,
  GrantRecordOutcomeSchema,
  GrantsListInputSchema,
  GrantsListOutputSchema,
  GrantsRevokeInputSchema,
  GrantsRevokeOutputSchema,
  StandingGrantSchema,
  TrustScopeSchema,
} from './safety/index'
export type {
  GrantRecordInput,
  GrantRecordOutcome,
  GrantsListInput,
  GrantsListOutput,
  GrantsRevokeInput,
  GrantsRevokeOutput,
  StandingGrantDto,
  StandingGrantsPort,
} from './safety/index'
// 391 D-08/D-12: the generic kind-discriminated proposal envelope. The durable record, the
// four-state lifecycle, the pinned expiry and the read-time DTO the inbox, the decision surfaces
// and the per-run digest all range over. `KnowledgeProposalV1` rides inside as the `knowledge`
// arm's payload, unforked.
export {
  CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION,
  PROPOSAL_DECISIONS,
  PROPOSAL_DURABLE_STATES,
  PROPOSAL_ENVELOPE_STATUSES,
  PROPOSAL_EVIDENCE_GRAINS,
  PROPOSAL_EXPIRY_MS,
  PROPOSAL_KINDS,
  ProposalDecisionRecordSchema,
  ProposalEnvelopeSchema,
  ProposalEvidenceRefSchema,
  ProposalInboxEntrySchema,
  ProposalOriginSchema,
  ProposalRecordSchema,
  ProposalsAcceptAppliedSchema,
  ProposalsAcceptGrantOutcomeSchema,
  ProposalsAcceptInputSchema,
  ProposalsAcceptOutcomeSchema,
  ProposalsAcceptOutputSchema,
  ProposalsListInputSchema,
  ProposalsListOutputSchema,
  ProposalsRejectInputSchema,
  ProposalsRejectOutputSchema,
  ProposalsShowInputSchema,
  ProposalsShowOutputSchema,
  computeProposalEnvelopeStatus,
  isProposalKind,
} from './proposal/index'
export type {
  ProposalDecision,
  ProposalDecisionRecord,
  ProposalDurableState,
  ProposalEnvelope,
  ProposalEnvelopeCommon,
  ProposalEnvelopeStatus,
  ProposalEvidenceGrain,
  ProposalEvidenceRef,
  ProposalInboxEntryDto,
  ProposalKind,
  ProposalOrigin,
  ProposalRecord,
  ProposalsAcceptApplied,
  ProposalsAcceptGrantOutcome,
  ProposalsAcceptInput,
  ProposalsAcceptOutcome,
  ProposalsAcceptOutput,
  ProposalsInboxPort,
  ProposalsListInput,
  ProposalsListOutput,
  ProposalsRejectInput,
  ProposalsRecordAppliedInput,
  ProposalsRecordAppliedOutput,
  ProposalsRejectOutput,
  ProposalsShowInput,
  ProposalsShowOutput,
} from './proposal/index'
export type {
  RiskActionDescriptor,
  RiskTier,
  PolicyVerdict,
  ExecutionPolicyResult,
  TrustCredential,
  TrustScope,
  TrustScopeKey,
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
// 392 CHAT-01/CHAT-05, D-14/D-18/D-24: the conversational surface's whole vocabulary — the session
// log's event grammar and header, the per-clause turn receipts, the `agent.ask` contracts, and the
// session-log port. Minted here rather than beside the turn engine because every one of them has
// several consumers that may not import each other: `agent` emits, `agent-local` persists, `cli`
// renders, and 396's MCP projection plus M5's dashboard read the same bytes (388 C13).
export {
  AgentAskInputSchema,
  AgentAskResultSchema,
  CHAT_SESSION_EVENT_KINDS,
  CHAT_STAGE_OUTCOMES,
  CHAT_TURN_STAGES,
  CHAT_TURN_STATUSES,
  CLAUSE_RECEIPT_STATUSES,
  CURRENT_CHAT_SESSION_SCHEMA_VERSION,
  ChatScenarioSchema,
  ChatSessionEventSchemaError,
  ClauseDenialSchema,
  ClauseReceiptSchema,
  ClauseResultSchema,
  SCENARIO_CLASSES,
  SCENARIO_EXPECTATIONS,
  SCENARIO_LANES,
  ScenarioExpectationSchema,
  clauseReachedCapability,
  guardChatSessionEvent,
  pinDenies,
} from './chat/index'
export type {
  AgentAskInput,
  AgentAskResult,
  ChatAbortedEvent,
  ChatActiveToolsChangeEvent,
  ChatApprovalDecisionEvent,
  ChatClauseReceiptEvent,
  ChatClauseResultEvent,
  ChatCompactionEvent,
  ChatMarkUnhandledEvent,
  ChatModelChangeEvent,
  ChatPinOverlay,
  ChatScenario,
  ChatSessionEvent,
  ChatSessionEventBase,
  ChatSessionEventKind,
  ChatSessionHandle,
  ChatSessionHeader,
  ChatStageOutcome,
  ChatStageOutcomeEvent,
  ChatTurnCompleteEvent,
  ChatTurnStage,
  ChatTurnStatus,
  ChatUserMessageEvent,
  ClauseDenial,
  ClauseReceipt,
  ClauseReceiptStatus,
  ClauseResult,
  OpenedChatSession,
  RefusedChatSessionLine,
  ScenarioClass,
  ScenarioExpectation,
  ScenarioExpectationKind,
  ScenarioLane,
  SessionLogPort,
} from './chat/index'

// 396-04 (D-01 / D-16 · MCPS-02): `runs.list`'s named output contract and the three declared fold
// contracts the MCP catalogue advertises. Published on the barrel because `packages/mcp` is their
// consumer and it reaches this package only through here.
export {
  RunsListOutputSchema,
  TOOL_FOLD_DISCRIMINANT,
  AuthoringRefineFoldInputSchema,
  AuthoringRefineFoldOutputSchema,
  ConfigChangeFoldInputSchema,
  ConfigChangeFoldOutputSchema,
  KnowledgeChangeFoldInputSchema,
  KnowledgeChangeFoldOutputSchema,
} from './functions/index'
export type {
  RunsListOutput,
  AuthoringRefineFoldInput,
  ConfigChangeFoldInput,
  KnowledgeChangeFoldInput,
} from './functions/index'

// 398-01 (D-05 / D-08 · XPLN-01): the capability-catalog row DTOs. Minted here per 384 D-16 —
// the artifact is produced in `packages/cli` and read back by the CLI's runtime loader, so the
// contract between the producer and every consumer belongs in the package neither of them owns.
// 398-08 (D-08 / D-14 · XPLN-03): the derived example call and the projected migration entry join
// the same block — one artifact, one contract, one place a consumer reads its shape from.
export {
  AgentManifestPostureSchema,
  AgentManifestSchema,
  AgentManifestTokenRefSchema,
  CapabilityCatalogSchema,
  CatalogAliasRowSchema,
  CatalogExampleCallSchema,
  CatalogMigrationArmSchema,
  CatalogMigrationEntrySchema,
  CatalogOpRowSchema,
  CatalogRowSchema,
  CatalogSkillRowSchema,
  CatalogSurfaceSchema,
  catalogRowKey,
} from './capability-catalog'
export type {
  AgentManifest,
  AgentManifestPosture,
  AgentManifestTokenRef,
  CapabilityCatalog,
  CatalogAliasRow,
  CatalogExampleCall,
  CatalogMigrationArm,
  CatalogMigrationEntry,
  CatalogOpRow,
  CatalogRow,
  CatalogSkillRow,
  CatalogSurface,
} from './capability-catalog'

// 398-04 (D-10 / D-11 · XPLN-02): the `explain` contract — the binary answer|abstention union with
// no confidence member, and the closed citation shape that is the whole of the model's output
// contract. Minted here per 384 D-16: the deterministic renderer lives in `packages/agent` and the
// op's host binding in `packages/agent-local`, so the shape they agree on belongs to neither.
export {
  ExplainAbstentionSchema,
  ExplainAnswerSchema,
  ExplainCitationSchema,
  ExplainCitedCapabilitySchema,
  ExplainCitedRowKindSchema,
  ExplainInputSchema,
  ExplainOutputSchema,
  ExplainProseSegmentSchema,
} from './explain'
export type {
  ExplainAbstention,
  ExplainAnswer,
  ExplainCitation,
  ExplainCitedCapability,
  ExplainCitedRowKind,
  ExplainInput,
  ExplainOutput,
  ExplainProseSegment,
} from './explain'
// 416 receipt vocabulary and the promotion result seam.
export { GATE_RECEIPT_SCHEMA_VERSION, GATE_NUMBERS, GATE_VERDICTS, GateReceiptSchema,
  PromotionReceiptSchema, GateLineSchema, receiptDigestOf, stampReceiptDigest,
  isPromotionReceipt, standingReceiptsByGate, strongestPromotionPath } from './knowledge/gate-receipt'
export type { GateNumber, GateVerdict, GateReceipt, PromotionReceipt, GateLine } from './knowledge/gate-receipt'
export { PROMOTION_PATHS, PROMOTION_PATH_STRENGTH, strongerPromotionPath } from './knowledge/promotion-path'
export type { PromotionPath } from './knowledge/promotion-path'
export type { PromotionOutcome, GateReceiptRecordOutcome, PromotionCandidateProvenance,
  PromotionPostureCandidate, ResolvePromotionPosture } from './knowledge/promotion-gate'
export { GATE_INCONSISTENCY_SHAPES, detectGateInconsistency } from './knowledge/promotion-gate'
export type { GateInconsistencyShape, GateInconsistency } from './knowledge/promotion-gate'
export { KnowledgeGatesListInputSchema, KnowledgeGatesListResultSchema,
  PromotionGateVerdictSchema } from './functions/knowledge'
export type { KnowledgeGatesListInput, KnowledgeGatesListResult } from './functions/knowledge'

export { PER_AXIS_SCORE_AXES, CROSS_CHECKS, DEGRADATIONS, BENEFITS, MARKS, STATE_VALIDITIES,
  axisScoreSchema, perAxisScoreSchema, corpusVersionSchema, samplesSchema, noiseFloorRefSchema,
  gate1ArmSchema, gate2ArmSchema, gate3ArmSchema, gate2SpendSchema } from './knowledge/gate-receipt'
export type { PerAxisScoreAxis, CrossCheck, Degradation, Benefit, Mark, StateValidity,
  Gate1Receipt, Gate2Receipt, Gate3Receipt } from './knowledge/gate-receipt'
// 2026-09-07, 417: neutral replay receipt and candidate DATA contracts.
export { GATE1_REASONS, GATE1_TARGET_SOURCES, GATE1_K_SOURCES, GATE1_HARM_ORIGINS,
  gate1CapSchema, gate1SpendSchema, gate1TargetSchema, gate1HarmedSchema } from './knowledge/gate-receipt'
export type { Gate1Reason, Gate1TargetSource, Gate1KSource, Gate1HarmOrigin } from './knowledge/gate-receipt'
export { CandidateInjectionSchema, KnowledgeCandidateInjectionResultSchema } from './knowledge/candidate-injection'
export type { CandidateInjection, KnowledgeCandidateInjectionResult } from './knowledge/candidate-injection'
export { RecordAnchorsSchema, RecordScopeSchema } from './knowledge/record-frontmatter'
export { BundleKindSchema, BundleStatusSchema } from './functions/knowledge'
export { BriefLineSchema } from './brief/guard-lossless-served-brief'

// 2026-09-08, 419 D-06: the Gate-3 feedback contracts
export {
  MARK_QUARANTINE_CLASSES, MARK_FIX_KINDS, MARK_DISPOSITIONS,
  MARK_RECEIPT_SCHEMA_VERSION, IMPROVEMENT_PLAN_SCHEMA_VERSION, COMMIT_RECEIPT_SCHEMA_VERSION,
  NoDraftableFixCheckedSchema, MarkDispositionSchema, MarkAddressSchema, MarkReceiptSchema,
  RunsMarkInputSchema, RunsMarkOutcomeSchema, ImprovementPlanKnowledgeSchema,
  ImprovementPlanSchema, CommitReceiptSchema, RunDetailMemberMarkSchema, deriveMarkStepId,
} from './functions/feedback'
export type {
  MarkQuarantineClass, MarkFixKind, MarkDisposition, NoDraftableFixChecked, MarkAddress,
  MarkReceipt, RunsMarkInput, RunsMarkOutcome, ImprovementPlanKnowledge, ImprovementPlan,
  CommitReceipt, RunDetailMemberMark, FeedbackPort,
} from './functions/feedback'
export { MarkProposalStampSchema } from './knowledge/proposal'
export type { MarkProposalStamp } from './knowledge/proposal'
export { KnowledgeMarkInputSchema } from './knowledge/review-verbs'
export type { KnowledgeMarkInput } from './knowledge/review-verbs'
export { OVERTURNED_EVENT_TYPE } from './knowledge/outcome-event'
