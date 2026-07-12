import type { KnowledgePort } from '@vostride/agent-qa-agent'
import type { KnowledgeHintReader } from '@vostride/agent-qa-runner'

export { KNOWLEDGE_BUNDLE_EGRESS_CHANNEL, checkpointCommittedParts } from './bundle-egress.js'
export type { BundleEgressOptions, BundleEgressOutcome } from './bundle-egress.js'

export type LocalKnowledgeStore = KnowledgePort
export type LocalKnowledgeReader = KnowledgeHintReader
