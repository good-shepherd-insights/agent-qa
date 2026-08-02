import type { KnowledgePort } from '@vostride/agent-qa-agent'
import type { KnowledgeHintReader } from '@vostride/agent-qa-runner'

// 387 ENTY-01 — entity addressing: the durable ledger and the tier-(a) resolver.
//
// The composition root is the only importer of this entry (the reader carve-out enforces
// that), so a surface reaching the resolver goes through composeLocalAgent and the function
// layer rather than around them.
export {
  ADDRESSING_LEDGER_BUSY_TIMEOUT_MS,
  ADDRESSING_LEDGER_DB_FILE,
  ADDRESSING_LEDGER_USER_VERSION,
  AddressingLedgerSchemaVersionError,
  BugAddressingNotAvailableError,
  openAddressingLedger,
} from './addressing/ledger.js'
export type {
  AddressingLedger,
  EntityAddress,
  OpenAddressingLedgerOptions,
  TargetRename,
} from './addressing/ledger.js'
export {
  describeAllEntities,
  getEntityDescriptor,
  resolveEntityRef,
  // 387 D-01: the sighting leg, published so the LIST-VERB sighting site mints through the
  // same mechanism the resolver's own hit does rather than through a second copy of it.
  sightEntity,
} from './resolver/resolve.js'
export {
  RESOLVER_CANDIDATE_K,
  RESOLVER_FUSED_SCORE_NORMALIZER,
  RESOLVER_LEG_WEIGHT_DENSE,
  RESOLVER_LEG_WEIGHT_LEXICAL,
  RESOLVER_LEXICAL_MIN_BM25,
  RESOLVER_STRONG_HIT_MARGIN,
  RESOLVER_STRONG_HIT_MIN_SCORE,
} from './resolver/constants.js'
export type {
  EntitySighting,
  EntitySightingSource,
  ResolveEntityRefDeps,
} from './resolver/resolve.js'
export { createMemorySightingSource } from './resolver/memory-source.js'
// The D-06 projection. Composed retrieval STAGES stay off this barrel (the D-13 rule the
// barrel-surface suite pins): what a composition root needs is the ability to open, maintain
// and rebuild the projection, never the legs the resolver runs over it.
export {
  ENTITY_INDEX_DB_FILE,
  ENTITY_INDEX_SWEEP_INTERVAL_MS,
  ENTITY_INDEX_USER_VERSION,
  EntityIndexSchemaVersionError,
  embedPendingEntities,
  entityIndexDbPath,
  openEntityIndex,
  rebuildEntityIndex,
  refreshEntity,
  sweepEntityIndex,
} from './entity-index/entity-index.js'
export type {
  EntityIndexHandle,
  EntityIndexSweepReport,
  OpenEntityIndexOptions,
} from './entity-index/entity-index.js'

export { KNOWLEDGE_BUNDLE_EGRESS_CHANNEL, checkpointCommittedParts } from './bundle-egress.js'
export type { BundleEgressOptions, BundleEgressOutcome } from './bundle-egress.js'
export {
  ARTIFACT_RUN_CAP_BYTES,
  ARTIFACT_STEP_CAP_BYTES,
  copyArtifacts,
} from './artifact-copy.js'
export type {
  ArtifactCopyInput,
  ArtifactCopyResult,
  CopiedArtifact,
  SkippedArtifact,
} from './artifact-copy.js'
export { renderBundleParts } from './bundle-parts.js'
export type {
  BundleProvenanceInput,
  RenderBundlePartsInput,
  RenderedBundlePart,
} from './bundle-parts.js'
export type {
  BundleStoreConfig,
  PublishBundleInput,
  PublishBundleOutcome,
} from './bundle-publish.js'
/** @internal Test-fixture seeding only; production mutation paths must use fenced commit APIs. */
export { publishBundle as publishBundleForTest } from './bundle-publish.test-helper.js'
export {
  MEASUREMENTS_REL_PATH,
  appendMeasurementObservation,
  appendOutcomeEvent,
  appendRelation,
  writeMeasurementBaseline,
} from './bundle-append.js'
export type { AppendOutcome } from './bundle-append.js'
export {
  deriveBundleTrust,
  loadBundle,
  readMeasurements,
  verifyBundleIntegrity,
} from './bundle-read.js'
export type {
  IntegrityReport,
  LoadedBundle,
  LoadBundleOutcome,
  Measurements,
} from './bundle-read.js'
export {
  enumerateBundleDirs,
  isServable,
  readCanonicalBundleAnchors,
  scanBundleById,
  scanBundles,
} from './bundle-scan.js'
export type {
  CanonicalBundleAnchorLookup,
  EnumeratedBundleDir,
  KnowledgeHit,
  ScanBundleByIdOptions,
  ScanBundlesOptions,
} from './bundle-scan.js'
export {
  CHECKPOINT_EVERY_N_BUNDLES,
  embeddingProfileKey,
  INDEX_DB_FILE,
  INDEX_RENDERING_SCHEMA_VERSION,
  INDEX_SCHEMA_VERSION,
  indexDbPath,
  MIN_READABLE_INDEX_SCHEMA_VERSION,
  openIndexReaderConnection,
  openIndexWriter,
  probeIndexHealth,
  READER_BUSY_TIMEOUT_MS,
  REQUIRED_INDEX_TABLES,
  resolveActiveProfile,
  resolveVecCapability,
  vecTableName,
  WRITER_BUSY_TIMEOUT_MS,
} from './index-open.js'
export type {
  IndexHealth,
  IndexReaderConnection,
  IndexWriterHandle,
  VecCapability,
} from './index-open.js'
export {
  KnowledgeRecordNotFoundError,
  openKnowledgeReader,
} from './serving/reader.js'
export type { OpenServingKnowledgeReaderConfig } from './serving/reader.js'
export {
  AUTHORING_BRIEF_DEFAULT_BUDGET,
  AUTHORING_DENSE_K,
  createAuthoringReader,
} from './serving/authoring-reader.js'
export type { AuthoringReaderDependencies } from './serving/authoring-reader.js'
export {
  assembleAuthoringBrief,
  AUTHORING_EXCERPT_CHAR_BUDGET,
  AUTHORING_EXEMPLAR_CAP,
  AUTHORING_PROCEDURE_CAP,
} from './serving/get-authoring-brief.js'
export type {
  AssembleAuthoringBriefInput,
  AssembledAuthoringBrief,
  AuthoringEntryCandidate,
  AuthoringExemplarRow,
  AuthoringTestRef,
} from './serving/get-authoring-brief.js'
export {
  CHANNEL_1_SERVING_LEG,
  CHANNEL_3_CAUTION_LEG,
  SERVING_TRACE_LEGS,
} from './serving/serve-trace.js'
export type {
  DenseHit,
  DenseSearchOptions,
  KnowledgeReader,
  KnowledgeSearchOptions,
  OpenKnowledgeReaderOptions,
} from './index-reader.js'
export { buildRetrievalQuery } from './query-helper.js'
export type { RetrievalQuery, RetrievalQueryInput } from './query-helper.js'
export { retrieve } from './retrieve.js'
export type { RetrieveOptions, RetrieveResult } from './retrieve.js'
export { rebuildIndex } from './index-rebuild.js'
export type {
  RebuildIndexHooks,
  RebuildIndexOptions,
  RebuildMutationFamily,
  RebuildReport,
} from './index-rebuild.js'
export { readLatestBuildOrdinal } from './build-ordinal-read.js'
export {
  applyRunOutcomes,
  foldRunOutcomes,
  LAST_OUTCOMES_LIMIT,
  projectRunOutcomes,
  QUARANTINE_FLAKE_THRESHOLD,
  rebuildRunOutcomes,
  RUN_OUTCOMES_PROJECTION_VERSION,
} from './projection/run-outcomes.js'
export type {
  ApplyRunOutcomesResult,
  ExtractStepAnchors,
  FoldRunOutcomesOptions,
  FoldRunOutcomesReport,
  ProjectRunOutcomesOptions,
  RebuildRunOutcomesOptions,
  RebuildRunOutcomesReport,
  RunOutcomesProjection,
  RunOutcomeTestDelta,
} from './projection/run-outcomes.js'
export { GC_SUPERSEDED_RETAIN_K, runKnowledgeGc } from './gc.js'
export type {
  GateHorizon,
  GcSummary,
  RunKnowledgeGcHooks,
  RunKnowledgeGcInput,
} from './gc.js'
export { setActiveEmbeddingProfile } from './profile-migration.js'
export type {
  MigrationOutcome,
  SetActiveEmbeddingProfileOptions,
} from './profile-migration.js'
export {
  dropEmbedCacheForModel,
  ensureEmbedCacheTable,
  getCachedEmbedding,
  putCachedEmbedding,
  wrapEmbedderWithCache,
} from './embed-cache.js'
export type {
  EmbedCacheLeg,
  EmbedCacheLookup,
  EmbedCacheMode,
  EmbedCachePut,
  EmbedCacheWrapperOptions,
} from './embed-cache.js'
export {
  createFloorEmbedder,
  FloorAssetLoadError,
  FloorEmbeddingError,
  loadFloorAssets,
} from './embedder-floor.js'
export type {
  FloorAssetLoadErrorCode,
  FloorAssetLoadOptions,
  FloorAssets,
  FloorEmbeddingErrorCode,
} from './embedder-floor.js'
export {
  createNativeEmbedder,
  NativeEmbeddingDimensionError,
  NativeEmbeddingModuleLoadError,
} from './embedder-native.js'
export {
  MODEL_CACHE_DIR_ENV_VAR,
  resolveModelCacheDir,
} from './model-cache-dir.js'
export {
  acquireEmbedder,
  discoverEmbedderWorker,
  EMBEDDER_MIN_AVAILABLE_BYTES,
  resetEmbedderCapability,
  resolveEmbedderCapability,
} from './embedder-acquire.js'
export type {
  AcquireEmbedderOptions,
  AcquireEmbedderOutcome,
  DeferReason,
  DiscoverEmbedderWorkerOptions,
  EmbedderProbes,
  EmbedderRung,
  EmbedderWorkerPolicy,
  ResolveEmbedderCapabilityOptions,
  WorkerDiscoveryResult,
} from './embedder-acquire.js'
export type { EmbedderPort } from './embedder-port.js'
export {
  EMBEDDER_WORKER_REQUEST_TIMEOUT_MS,
  EMBEDDER_WORKER_REGISTRATION_FILE,
  EMBEDDER_WORKER_REGISTRATION_SCHEMA_VERSION,
  EMBEDDER_WORKER_START_TIMEOUT_MS,
  EMBEDDER_WORKER_TERM_GRACE_MS,
  EMBEDDER_WORKER_UNVERIFIABLE_INCARNATION,
  EmbedderWorkerTimeoutError,
  embedderWorkerProcessIsAlive,
  embedderWorkerSocketPath,
  probeEmbedderWorkerSocket,
  readEmbedderWorkerRegistration,
  removeEmbedderWorkerRegistration,
  writeEmbedderWorkerRegistration,
} from './embedder-worker/worker-registration.js'
export { verifyEmbedderWorkerIncarnation } from './embedder-worker/worker-incarnation.js'
export type {
  EmbedderWorkerIncarnationVerdict,
  EmbedderWorkerTimeoutPhase,
  EmbedderWorkerRegistration,
  LegacyEmbedderWorkerRegistration,
  OwnedEmbedderWorkerRegistration,
  ReadEmbedderWorkerRegistrationOutcome,
} from './embedder-worker/worker-registration.js'
export {
  clearRebuildRequest,
  readRebuildRequest,
  REBUILD_MARKER_FILE,
  requestRebuild,
} from './rebuild-marker.js'
export type {
  ReadRebuildRequestOutcome,
  RebuildReason,
  RebuildRequest,
  RequestRebuildOptions,
} from './rebuild-marker.js'
export {
  CURATION_QUEUE_SCHEMA_VERSION,
  artifactFreeCaptureReceipt,
  buildCurationCandidateAddressFields,
  candidateContentAddress,
  curationArtifactDescriptorSchema,
  curationArtifactRoleSchema,
  curationCandidateOmissionSchema,
  curationCandidatePayloadSchema,
  curationCandidateProjectionSchema,
  curationCandidateRedactionSchema,
  curationCaptureReceiptSchema,
} from './queue/queue-payload.js'
export type {
  BuildCurationCandidateAddressFieldsInput,
  CurationArtifactDescriptor,
  CurationArtifactRole,
  CurationCandidateAddressFields,
  CurationCandidateArtifact,
  CurationCandidateOmission,
  CurationCandidatePayload,
  CurationCandidateProjection,
  CurationCandidateRedaction,
  CurationCaptureReceipt,
} from './queue/queue-payload.js'
export {
  CLAIMED_SUBDIR,
  claimedCandidateDir,
  claimedLeaseDir,
  claimedRoot,
  JOBS_SUBDIR,
  jobStatePath,
  jobsRoot,
  QUEUE_DIR,
  QUEUE_MAX_EMITS_PER_RUN,
  QUEUE_MAX_JOBS_PER_SCOPE,
  queueRoot,
  queueStagingRoot,
  QUEUED_SUBDIR,
  queuedCandidateDir,
  queuedRoot,
} from './queue/queue-layout.js'
export {
  claimNextJob,
  countPendingCurationJobs,
  countRemainingCurationWork,
  enqueueCurationCandidate,
  enqueueCurationCandidateProjection,
  inspectDrainableCurationWork,
  listClaimedLeases,
  listQueuedCandidates,
  readCurationCandidatePayload,
  quarantineClaimed,
  requeueClaimed,
} from './queue/curation-queue.js'
export type {
  ClaimedCurationJob,
  ClaimNextJobOptions,
  CountRemainingCurationWorkOptions,
  CurationQuarantineReason,
  CurationRemainingWork,
  ClaimNextJobOutcome,
  CurationEnqueueRefusalReason,
  CurationProjectionArtifactSource,
  DrainableCurationWork,
  EnqueueCurationCandidateProjectionOptions,
  EnqueueCurationCandidateProjectionOutcome,
  InspectDrainableCurationWorkOptions,
  MalformedClaimedCurationJob,
  ReadCurationCandidatePayloadOutcome,
  QuarantineClaimedOptions,
  RequeueClaimedOptions,
} from './queue/curation-queue.js'
export {
  CURATION_JOB_STATE_SCHEMA_VERSION,
  curationJobStateSchema,
  persistAuthoredCheckpoint,
  readJobState,
  writeJobState,
} from './queue/job-state.js'
export type {
  CurationJobLifecycle,
  CurationJobState,
  PersistAuthoredCheckpointOptions,
  PersistAuthoredCheckpointOutcome,
  ReadJobStateOutcome,
  WriteJobStateOptions,
} from './queue/job-state.js'
export { COMMIT_INTENT_SCHEMA_VERSION } from './journal/intent-journal.js'
export {
  AUTHORED_CHECKPOINT_SCHEMA_VERSION,
  authoredCheckpointSchema,
  parseAuthoredCheckpoint,
  resolveDispositionProfile,
  sliceAuthoredCheckpoint,
  widenAuthoredDeltaCheckpoint,
} from './curator/author-contract.js'
export type {
  AuthoredCheckpoint,
  AuthoredDeltaCheckpoint,
  AuthorOutcome,
  CurationJobView,
  CuratorAuthor,
  DispositionProfile,
  NeighborRecord,
} from './curator/author-contract.js'
export {
  applyIndexDeltaForBundle,
  commitCurationDelta,
  deriveIndexRowFromBundle,
} from './curator/commit.js'
export type {
  ApplyIndexDeltaForBundleInput,
  CommitCurationDependencies,
  CommitCurationJob,
  CommitCurationOutcome,
  EmptyDeltaCause,
} from './curator/commit.js'
export {
  BLAST_RADIUS_MAX_SUPERSEDES_PER_ANCHOR_PER_DRAIN,
  disposeDelta,
} from './curator/disposition.js'
export type {
  DisposeDeltaInput,
  DispositionCandidateContext,
  DispositionDrainState,
  DispositionOutcome,
  ProcedureDispositionEvidence,
  RelationIntent,
} from './curator/disposition.js'
export {
  DRAIN_BUDGET_MS,
  EMBED_CRASH_VECTORLESS_THRESHOLD,
  SEARCH_BEFORE_CREATE_MAX_QUERIES,
  drainQueue,
} from './curator/drain.js'
export type {
  CurationDrainLifecycleEvent,
  DrainFailure,
  DrainFailureStage,
  DrainNoop,
  DrainOptions,
  DrainReport,
  GcPassReport,
  WriterPassReport,
} from './curator/drain.js'
export { runMaintenanceTail } from './curator/maintenance.js'
export type {
  MaintenanceBudget,
  MaintenanceOperations,
  MaintenanceSkipReason,
  MaintenanceTailFailure,
  MaintenanceTailResult,
  RunMaintenanceTailOptions,
} from './curator/maintenance.js'
/**
 * IN-04: `ACQUIRE_WRITER_LEASE_DEADLINE_MS` and `WriterLeaseUnreclaimableError` are deliberately
 * NOT re-exported here. Nothing outside `lease/writer-lease.ts` imported either one, and the CLI —
 * the only surface that renders the refusal — reaches this package through `agent-local`'s
 * composition edge, so binding them would have meant widening a second package's surface to keep a
 * symbol company. The refusal is still fully legible to consumers: `AcquireWriterLeaseOutcome`
 * carries the error instance and its `reason` literal, which is what every call site renders.
 */
export {
  acquireWriterLease,
  CorruptEpochStateError,
  deriveWriterLeaseFreshness,
  EPOCH_FILE,
  heartbeatLease,
  isLeaseStale,
  LEASE_FILE,
  LEASE_HEARTBEAT_TTL_MS,
  MUTATION_LOCK_BUSY_TIMEOUT_MS,
  MUTATION_LOCK_TAKEOVER_MS,
  readWriterLease,
  refreshWriterLeaseAuthority,
  releaseLease,
  resolveProcessIncarnation,
  withCurrentWriterAuthority,
  WRITER_AUTHORITY_DB_FILE,
  WriterAuthorityLostError,
} from './lease/writer-lease.js'
export type {
  AcquireWriterLeaseOptions,
  AcquireWriterLeaseOutcome,
  UnreclaimableMutationLockOwner,
  CorruptEpochStateReason,
  CurrentWriterAuthority,
  CurrentWriterAuthorityHooks,
  HeartbeatLeaseOutcome,
  LeaseOperationOptions,
  ReadWriterLeaseOutcome,
  ReleaseLeaseOutcome,
  WriterLease,
  WriterAuthorityLostReason,
  WriterLeaseAuthority,
  WriterLeaseFreshness,
} from './lease/writer-lease.js'
export {
  guardPurgeReceipt,
  PurgeChronologyRequiredError,
  PurgeCompletionVerificationError,
  PurgeQueueIdentityError,
  PURGE_RECEIPT_SCHEMA_VERSION,
  PurgeReceiptSchema,
  PurgeTargetChangedError,
  PurgeTargetIntegrityError,
  purgeAffectedSetFingerprint,
  purgeReceiptSchema,
  purgeRecord,
  resolvePurgeAffectedSet,
} from './purge.js'
export type {
  PurgeAffectedSet,
  PurgeReceipt,
  PurgeRecordInput,
  PurgeRecordOutcome,
} from './purge.js'
export { inspectRecords, toInspectRecordView } from './inspect.js'
export type { InspectRecordsOptions } from './inspect.js'
export { diffSince } from './diff-since.js'
export type { DiffSinceOptions } from './diff-since.js'
export { showRecord } from './show-record.js'
export type { ShowRecordOptions } from './show-record.js'

// 387-08 KREV-01 D-17/D-18/D-19: the knowledge review write path. Published through the WRITER
// entry and deliberately not through `/reader` — proposing commits nothing, but the module it
// sits beside commits everything, and a read-only surface that could name this directory would
// be one import away from the one path bytes change through.
export {
  FORGET_SCRUBBED_PROJECTIONS,
  proposeReview,
} from './review/propose-review.js'
export type {
  ProposeReviewInput,
  ProposeReviewOutcome,
  ProposeReviewRequest,
  ResolveBundleShortId,
} from './review/propose-review.js'
export {
  APPLY_DELEGATE_TIMEOUT_MS,
  APPLY_IN_FLIGHT_POLL_MS,
  APPLY_IN_FLIGHT_WAIT_MS,
  ApplyDelegateTimeoutError,
  ApplyDelegateUnavailableError,
  // On the barrel because a surface has to be able to NAME the refusal it renders: "somebody
  // else is applying this right now" and "no such proposal" call for different words to a
  // person, and a surface that could only catch `Error` would have to guess from a message.
  ProposalApplyInFlightError,
  ProposalTargetVanishedError,
  applyReview,
} from './review/apply-review.js'
export type {
  ApplyDelegate,
  ApplyOutcomeKind,
  ApplyReviewInput,
  ApplyReviewResult,
} from './review/apply-review.js'
export {
  PROPOSALS_DIR_NAME,
  ProposalNotFoundError,
  proposalsDir,
  readAppliedProposal,
  readPendingProposal,
  readProposal,
} from './review/proposals-store.js'
export type { AppliedProposalRecord } from './review/proposals-store.js'
export { KnowledgeMaintenanceScanError } from './maintenance-scan.js'
export type { KnowledgeMaintenanceScanIssue } from './maintenance-scan.js'
export {
  resolveRollbackAffectedSet,
  rollbackAffectedSetFingerprint,
  rollbackCampaign,
  RollbackCausalityError,
  rollbackCurationJob,
  RollbackPlanChangedError,
  rollbackReceiptId,
} from './rollback.js'
export type {
  RollbackAffectedSet,
  RollbackCampaignInput,
  RollbackCounterEvent,
  RollbackCurationJobInput,
  RollbackKind,
  RollbackPlannedEffect,
  RollbackReport,
  ResolveRollbackAffectedSetInput,
} from './rollback.js'
export {
  createLocalKnowledgeStore,
  KnowledgeCommitError,
  KnowledgePromotionError,
  KnowledgeStoreNotImplementedError,
  KnowledgeUnsupportedDeltaError,
} from './curator/knowledge-store.js'
export type {
  CreateLocalKnowledgeStoreConfig,
  KnowledgePromotionErrorReason,
} from './curator/knowledge-store.js'

export type LocalKnowledgeStore = KnowledgePort
export type LocalKnowledgeReader = KnowledgeHintReader
