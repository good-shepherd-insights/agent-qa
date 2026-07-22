import type { KnowledgePort } from '@vostride/agent-qa-agent'
import type { KnowledgeHintReader } from '@vostride/agent-qa-runner'

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
export { publishBundle } from './bundle-publish.js'
export type {
  BundleStoreConfig,
  PublishBundleInput,
  PublishBundleOutcome,
} from './bundle-publish.js'
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
  AuthoringEntryCandidate,
  AuthoringExemplarRow,
  AuthoringTestRef,
} from './serving/get-authoring-brief.js'
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
export type { RebuildIndexOptions, RebuildReport } from './index-rebuild.js'
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
  resolveEmbedderCapability,
} from './embedder-acquire.js'
export type {
  AcquireEmbedderOptions,
  AcquireEmbedderOutcome,
  DeferReason,
  EmbedderProbes,
  EmbedderRung,
  ResolveEmbedderCapabilityOptions,
  WorkerDiscoveryResult,
} from './embedder-acquire.js'
export type { EmbedderPort } from './embedder-port.js'
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
  enqueueCurationCandidate,
  enqueueCurationCandidateProjection,
  listClaimedLeases,
  listQueuedCandidates,
  readCurationCandidatePayload,
  requeueClaimed,
} from './queue/curation-queue.js'
export type {
  ClaimedCurationJob,
  ClaimNextJobOptions,
  ClaimNextJobOutcome,
  CurationEnqueueRefusalReason,
  CurationProjectionArtifactSource,
  EnqueueCurationCandidateProjectionOptions,
  EnqueueCurationCandidateProjectionOutcome,
  MalformedClaimedCurationJob,
  ReadCurationCandidatePayloadOutcome,
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
  DrainFailure,
  DrainFailureStage,
  DrainNoop,
  DrainOptions,
  DrainReport,
  GcPassReport,
  WriterPassReport,
} from './curator/drain.js'
export {
  acquireWriterLease,
  refreshWriterLeaseAuthority,
  releaseLease,
  WriterAuthorityLostError,
} from './lease/writer-lease.js'
export type {
  AcquireWriterLeaseOutcome,
  ReleaseLeaseOutcome,
  WriterAuthorityLostReason,
  WriterLeaseAuthority,
} from './lease/writer-lease.js'
export {
  guardPurgeReceipt,
  PURGE_RECEIPT_SCHEMA_VERSION,
  PurgeReceiptSchema,
  purgeReceiptSchema,
  purgeRecord,
} from './purge.js'
export type {
  PurgeReceipt,
  PurgeRecordInput,
  PurgeRecordOutcome,
} from './purge.js'
export { inspectRecords } from './inspect.js'
export type { InspectRecordsOptions } from './inspect.js'
export { diffSince } from './diff-since.js'
export type { DiffSinceOptions } from './diff-since.js'
export {
  resolveRollbackAffectedSet,
  rollbackCampaign,
  RollbackCausalityError,
  rollbackCurationJob,
  rollbackReceiptId,
} from './rollback.js'
export type {
  RollbackAffectedSet,
  RollbackCampaignInput,
  RollbackCounterEvent,
  RollbackCurationJobInput,
  RollbackKind,
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
