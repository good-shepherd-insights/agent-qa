// Neutral port type re-exports anchor the eval workspace dependency declared by this package.
export type { ArtifactSource, HandoffSource } from '@vostride/agent-qa-eval'

export { FsHandoffSource } from './handoff-source.js'
export type { FsHandoffSourceConfig } from './handoff-source.js'

export { DirArtifactSource, FsRunArtifactSource, absentArtifactSource } from './artifact-source.js'
export type { DirArtifactSourceConfig, FsRunArtifactSourceConfig } from './artifact-source.js'

export {
  BLOBS_SUBDIR,
  CASSETTE_FILE,
  DEFAULT_EVAL_CASSETTES_SUBDIR,
  FsCassetteStore,
} from './cassette-store.js'
export type { FsCassetteStoreConfig, WrittenCassette } from './cassette-store.js'

export { loadCassetteBundle } from './cassette-loader.js'
export type { CassetteBundleLoad } from './cassette-loader.js'

export {
  listCassetteBundleDirs,
  listReplayRecordDirs,
  loadReplayRecord,
  loadScoreRecord,
} from './replay-read.js'
export type { ReplayRecordLoad, ScoreRecordLoad } from './replay-read.js'

export { runCassetteReplay } from './replay-composition.js'
export type { RunCassetteReplayInput } from './replay-composition.js'

export { bindJudgePort } from './judge-binding.js'
export type { JudgeBindingInput } from './judge-binding.js'

export {
  DEFAULT_EVAL_REPLAYS_SUBDIR,
  FsReplayRecordStore,
  REPLAY_RECORD_FILE,
} from './replay-record-store.js'
export type {
  FsReplayRecordStoreConfig,
  WrittenReplayRecord,
} from './replay-record-store.js'

export { FsScoreStore, SCORE_FILE } from './score-store.js'
export type { FsScoreStoreConfig, ScoreRecord, WrittenScoreRecord } from './score-store.js'

export { DEFAULT_EVAL_REPORTS_SUBDIR, FsReportStore } from './report-store.js'
export type { FsReportStoreConfig, WrittenReport } from './report-store.js'

export { SEEDING_EGRESS_CHANNEL, seedCommittedCorpus } from './seeding-composition.js'
export type {
  SeedCommittedCorpusInput,
  SeedingRefusal,
  SeedingReport,
} from './seeding-composition.js'

export {
  REPORT_EGRESS_CHANNEL,
  COMMITTED_REPORT_JSON_FILE,
  COMMITTED_REPORT_MARKDOWN_FILE,
  commitEvalReport,
} from './report-committing.js'
export type {
  CommitEvalReportInput,
  CommitEvalReportOutcome,
} from './report-committing.js'

export { writeBaselinePointer } from './baseline-pointer.js'
export type {
  WriteBaselinePointerInput,
  WriteBaselinePointerOutcome,
} from './baseline-pointer.js'

export {
  COMMITTED_CENSUS_JSON_FILE,
  COMMITTED_CENSUS_MARKDOWN_FILE,
  commitCensus,
} from './census-committing.js'
export type { CommitCensusInput, CommitCensusOutcome } from './census-committing.js'

export {
  COMMITTED_BASELINES_SUBDIR,
  COMMITTED_CASSETTES_DIR,
  COMMITTED_CENSUS_SUBDIR,
  COMMITTED_CONTRACTS_DIR,
  COMMITTED_CORPUS_DIR,
  COMMITTED_EXCLUSIONS_DIR,
  COMMITTED_GITIGNORE_TEXT,
  COMMITTED_LABELS_DIR,
  COMMITTED_REPORTS_DIR,
  COMMITTED_ROOT_MARKER_FILE,
  COMMITTED_ROOT_SCHEMA_VERSION,
  FsCommittedRootStore,
  PARTITION_MANIFEST_FILE_PREFIX,
  buildRootMarkerValue,
  committedBlobPath,
  committedCassettePath,
  committedContractPath,
  committedBaselinePointerPath,
  committedCensusPath,
  committedCorpusPath,
  committedExclusionPath,
  committedLabelPath,
  committedPartitionManifestPath,
  committedReportPath,
} from './committed-root-store.js'
export type {
  CommittedRootStoreConfig,
  CommittedWriteOutcome,
} from './committed-root-store.js'

export {
  listBaselinePointers,
  listCommittedReports,
  readCommittedCorpus,
  readPartitionManifests,
  readRunExclusions,
} from './committed-corpus-source.js'
export type {
  BaselinePointerEntry,
  CommittedCorpusRead,
  CommittedReadRefusal,
  CommittedReportEntry,
  PartitionManifestRead,
  RunExclusionRead,
} from './committed-corpus-source.js'
