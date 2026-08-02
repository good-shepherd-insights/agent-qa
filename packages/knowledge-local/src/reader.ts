export {
  KnowledgeRecordNotFoundError,
  hydrateRows,
  openKnowledgeReader,
  readIndexRows,
} from './serving/reader.js'
export type {
  HydratedEntry,
  IndexRow,
  OpenServingKnowledgeReaderConfig,
} from './serving/reader.js'
export {
  AUTHORING_BRIEF_DEFAULT_BUDGET,
  AUTHORING_DENSE_K,
  createAuthoringReader,
} from './serving/authoring-reader.js'
export type { AuthoringReaderDependencies } from './serving/authoring-reader.js'
export { inspectRecords } from './inspect.js'
export type { InspectRecordsOptions } from './inspect.js'
export { diffSince } from './diff-since.js'
export type { DiffSinceOptions } from './diff-since.js'
export { listBundles } from './list-bundles.js'
// 387 KREV-01: the show verb's read half. On the READER entry beside its three siblings
// because it opens nothing, writes nothing and holds no lease — it reads committed bundle
// files and projects them, which is the whole of what the read half of the review family is.
export { showRecord } from './show-record.js'
export type { ShowRecordOptions } from './show-record.js'
export { KnowledgeMaintenanceScanError } from './maintenance-scan.js'
export type { KnowledgeMaintenanceScanIssue } from './maintenance-scan.js'
export type { BuildRange, ReadOptions, SearchOptions } from '@vostride/agent-qa-schema'
