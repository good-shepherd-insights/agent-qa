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

export {
  COMMITTED_CASSETTES_DIR,
  COMMITTED_CONTRACTS_DIR,
  COMMITTED_CORPUS_DIR,
  COMMITTED_GITIGNORE_TEXT,
  COMMITTED_LABELS_DIR,
  COMMITTED_ROOT_MARKER_FILE,
  COMMITTED_ROOT_SCHEMA_VERSION,
  FsCommittedRootStore,
  buildRootMarkerValue,
  committedBlobPath,
  committedCassettePath,
  committedContractPath,
  committedCorpusPath,
  committedLabelPath,
} from './committed-root-store.js'
export type {
  CommittedRootStoreConfig,
  CommittedWriteOutcome,
} from './committed-root-store.js'
