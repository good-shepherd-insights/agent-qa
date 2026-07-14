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
export { appendOutcomeEvent, appendRelation } from './bundle-append.js'
export type { AppendOutcome } from './bundle-append.js'
export { deriveBundleTrust, loadBundle, verifyBundleIntegrity } from './bundle-read.js'
export type { IntegrityReport, LoadedBundle, LoadBundleOutcome } from './bundle-read.js'
export {
  enumerateBundleDirs,
  isServable,
  scanBundleById,
  scanBundles,
} from './bundle-scan.js'
export type {
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
export { openKnowledgeReader } from './index-reader.js'
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

export type LocalKnowledgeStore = KnowledgePort
export type LocalKnowledgeReader = KnowledgeHintReader
