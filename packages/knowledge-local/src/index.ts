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

export type LocalKnowledgeStore = KnowledgePort
export type LocalKnowledgeReader = KnowledgeHintReader
