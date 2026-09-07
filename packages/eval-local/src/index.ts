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

export { computeReplayProfileFingerprintFor, runCassetteReplay } from './replay-composition.js'
export type { RunCassetteReplayInput } from './replay-composition.js'

export { resolveBaselineCache, listBaselineRunRoots } from './baseline-cache-read.js'
export type { BaselineCacheRow, BaselineCacheResolution } from './baseline-cache-read.js'
export { runReplayGate, removalFlipsOutcome, serializeReplayGateReceipt, GATE1_AUDIT_SUBDIR } from './replay-gate-composition.js'
export type { RunReplayGateInput, RunReplayGateResult, RemovalFlipsOutcomeInput, RemovalFlipsOutcomeResult } from './replay-gate-composition.js'

export { ablateCanaryStep, readCommittedCorpusDigest, GATE2_AUDIT_SUBDIR, GATE2_TARGET_SUBDIR } from './gate2-composition.js'
export type { AblateCanaryStepInput, AblateCanaryStepResult, CommittedCorpusDigestRead } from './gate2-composition.js'
export { FEEDBACK_STAGING_SUBDIR, FEEDBACK_EGRESS_CHANNEL, isNovelState, stageFeedbackEntry, listStagedFeedback, admitStagedFeedback } from './gate2-composition.js'
export type { FeedbackStateInput, StageFeedbackEntryInput, StageFeedbackEntryResult, StagedFeedbackEntry, AdmitStagedFeedbackResult } from './gate2-composition.js'

export { loadCassetteBundles, sweepCassetteReplays } from './replay-sweep.js'
export type {
  LoadedCassetteBundle,
  SweepCassetteReplaysInput,
  SweepCassetteReplaysResult,
} from './replay-sweep.js'

export { assembleScoredBatch, cassetteProductPartition } from './replay-batch-assembly.js'

export { FloorProtocolError, replayCorpusOnce, runNoiseFloorMeasurement } from './aa-floor-composition.js'
export type {
  ReplayCorpusOnceInput,
  ReplayCorpusOnceResult,
  RunNoiseFloorMeasurementInput,
  RunNoiseFloorMeasurementResult,
} from './aa-floor-composition.js'

export { runReleaseGate } from './release-gate-composition.js'
export type { ReleaseGateMode, RunReleaseGateInput, RunReleaseGateResult } from './release-gate-composition.js'

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

export { DEFAULT_EVAL_REPORTS_SUBDIR, FsReportStore, loadStagedReport } from './report-store.js'
export type { FsReportStoreConfig, StagedReportLoad, WrittenReport } from './report-store.js'

export {
  SEEDING_EGRESS_CHANNEL,
  seedCommittedCorpus,
  writePartitionManifest,
  writeRunExclusion,
} from './seeding-composition.js'
export type {
  SeedCommittedCorpusInput,
  SeedingRefusal,
  SeedingReport,
  WritePartitionManifestInput,
  WritePartitionManifestOutcome,
  WriteRunExclusionInput,
  WriteRunExclusionOutcome,
} from './seeding-composition.js'

export {
  REPORT_EGRESS_CHANNEL,
  COMMITTED_REPORT_DECISIONS_FILE,
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

export { writeNoiseFloorArtefact } from './noise-floor-writer.js'
export type {
  WriteNoiseFloorArtefactInput,
  WriteNoiseFloorArtefactOutcome,
} from './noise-floor-writer.js'

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
  COMMITTED_NOISE_FLOOR_SUBDIR,
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
  committedNoiseFloorPath,
  committedPartitionManifestPath,
  committedReportPath,
} from './committed-root-store.js'
export type {
  CommittedRootStoreConfig,
  CommittedWriteOutcome,
} from './committed-root-store.js'

export { readGatePostureFor } from './gate-posture-composition.js'
export type {
  ReadGatePostureForInput,
  ReadGatePostureForResult,
} from './gate-posture-composition.js'

export {
  listBaselinePointers,
  listCommittedReports,
  listNoiseFloorArtefacts,
  readCommittedCorpus,
  readCommittedDecisionVectors,
  readPartitionManifests,
  readRunExclusions,
  resolveMinimumGateSet,
} from './committed-corpus-source.js'
export type {
  BaselinePointerEntry,
  CommittedCorpusRead,
  CommittedDecisionVectorsLoad,
  CommittedReadRefusal,
  CommittedReportEntry,
  NoiseFloorArtefactEntry,
  PartitionManifestRead,
  ResolveMinimumGateSetOutcome,
  RunExclusionRead,
} from './committed-corpus-source.js'
