import { getAgentQaVersion } from '@vostride/agent-qa-core'

export * from '@vostride/agent-qa-core'
export const VERSION = getAgentQaVersion()
export * from './config.js'
export * from './targets.js'
export { purgeTest, purgeAll } from './commands/cache.js'
export {
  buildCuratorAuthor,
  CURATOR_MAX_NEIGHBORS,
  CURATOR_RETRY_CAP,
} from './curation/curator-author.js'
export type { BuildCuratorAuthorDependencies } from './curation/curator-author.js'
export {
  runCurationTail,
  runVerdictFirstCurationTail,
} from './curation/curation-tail.js'
export type {
  CurationTailLogger,
  CurationTailModelDeps,
  CurationTailOperations,
  RunCurationTailOptions,
  RunVerdictFirstCurationTailOptions,
} from './curation/curation-tail.js'
export {
  emitCanaryOutcomes,
  projectCanaryOutcomes,
} from './curation/emit-canary-outcomes.js'
export type {
  EmitCanaryOutcomeDetail,
  EmitCanaryOutcomeReport,
  EmitCanaryOutcomeResult,
  EmitCanaryOutcomesOptions,
  ProjectCanaryOutcomesInput,
} from './curation/emit-canary-outcomes.js'
