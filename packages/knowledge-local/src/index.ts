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
  INDEX_DB_FILE,
  INDEX_RENDERING_SCHEMA_VERSION,
  INDEX_SCHEMA_VERSION,
  indexDbPath,
  MIN_READABLE_INDEX_SCHEMA_VERSION,
  openIndexReaderConnection,
  openIndexWriter,
  probeIndexHealth,
  READER_BUSY_TIMEOUT_MS,
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
