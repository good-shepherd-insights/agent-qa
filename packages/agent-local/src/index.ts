import type { PersistencePort } from '@vostride/agent-qa-agent'

/**
 * The local implementation of the neutral persistence port.
 *
 * 2026-07-29 (Phase 385 plan 02, D-06): this alias now covers approvals and patches ONLY.
 * Job rows and checkpoints left the port for the agent job queue's own store, whose verbs are
 * compound and transactional rather than generic CRUD, and the conversation surface left it
 * entirely. The alias is deliberately narrower than the package's name suggests, and saying
 * so here is cheaper than letting a later reader infer that anything job-shaped belongs
 * behind it.
 *
 * The job store itself is not on this barrel. It is reachable by relative path within the
 * package and is published, if at all, by the composition root — a store that any importer
 * can construct is a second way to open the database beside the one the host owns.
 */
export type LocalPersistenceStore = PersistencePort

// 2026-07-29 (Phase 385 plan 08, D-13): the host-neutral run composition. Unlike the job store,
// this IS published — it is the thing every host is supposed to share, and a host that cannot
// reach it re-derives it, which is the divergence the one-composition-root decision exists to
// prevent. What stays unpublished is unchanged: the store, because a second way to open the
// database is a second writer nobody arbitrated.
export {
  buildMemberRunConfig,
  buildRunAuditSink,
  buildRunMaskingContext,
  buildRunPorts,
  buildRunSessionSafetyHooks,
  buildScreenshotCompressor,
  buildSuiteMemberExecutor,
  computeRunConfigDigests,
  createSuiteLifecycle,
  extractAuthStateSensitiveStrings,
  openRunKnowledgeComposition,
  resolveBuildTagSetting,
  resolveRunBuildOrdinal,
  resolveRunExecutionContext,
  sensitiveEnvSlice,
  stampAuditSink,
  toMemberTest,
} from './composition/run-composition.js'
export type {
  BuildMemberRunConfigInput,
  BuildRunSessionSafetyHooksInput,
  OpenRunKnowledgeCompositionInput,
  RunConfigDigests,
  RunDigestMemberInput,
  RunExecutionContext,
  RunKnowledgeComposition,
  RunMaskingContext,
  RunPersistencePorts,
  SuiteLifecycle,
  SuiteLifecycleHooks,
  SuiteMemberBinding,
} from './composition/run-composition.js'

export type {
  AttachableRunSession,
  LivePauseController,
  RunPresentationPorts,
  RunSubscriberHandle,
} from './composition/presentation-ports.js'

export {
  BRIEF_CEILING,
  BRIEF_FRACTION,
  CAUTION_FRACTION,
  computeKnowledgeBudgets,
  GLOBAL_RECORD_CAP,
  MIN_BRIEF,
  MIN_CAUTION,
  MIN_MEMORY_TOOL_CONTEXT_WINDOW,
  memoryToolGate,
  READ_BODY_FRACTION,
  scaledRecordCap,
  WEAK_MODEL_CAP_SCALE,
} from './composition/knowledge-budgets.js'
export type {
  ComputeKnowledgeBudgetsInput,
  KnowledgeBudgets,
} from './composition/knowledge-budgets.js'

export {
  constructKnowledgeReader,
  createFrozenKnowledgeReader,
} from './composition/knowledge-reader.js'
export type { ConstructKnowledgeReaderInput } from './composition/knowledge-reader.js'

// 2026-07-29 (Phase 385 plan 09, D-15): the one local composition root. `composeLocalAgent` is
// what a host calls instead of wiring a registry of its own, so it is published for the same
// reason the run composition is: a host that cannot reach it re-derives it.
//
// The store rule above is unchanged and this does not bend it. No store CONSTRUCTOR joins the
// barrel; `host.jobs()` hands back the store the host itself opened, which is the one arbitrated
// opening rather than a second one.
export {
  composeLocalAgent,
  createKnowledgeReader,
  createKnowledgeReview,
  createLocalRunInvocation,
  createRunsReader,
  DIGEST_JOB_ID_SOURCE,
  DRAIN_BUDGET_MS,
  EMBEDDER_WORKER_START_TIMEOUT_MS,
  EMBEDDER_WORKER_TERM_GRACE_MS,
  EmbedderWorkerTimeoutError,
  ENTITY_INDEX_SWEEP_INTERVAL_MS,
  LOCAL_CURATION_CAPABILITIES,
  LOCAL_DAEMON_CAPABILITIES,
  LocalAgentClosedError,
  RunProducedNoEventsError,
  SYSTEM_CLOCK,
  sweepEntityIndexProjection,
} from './composition/compose-local-agent.js'
export type {
  ApplyDelegate,
  ApplyReviewResult,
  ComposeLocalAgentInput,
  CreateKnowledgeReviewInput,
  LocalAgentHost,
  LocalAgentJobs,
  LocalCurationCapabilities,
  LocalDaemonCapabilities,
  LocalKnowledgeMaintenanceCapabilities,
  RunExecutionPort,
  SweepEntityIndexInput,
  SweepEntityIndexOutcome,
} from './composition/compose-local-agent.js'
// The knowledge vocabulary the curation surfaces are typed against, re-exported through the one
// edge that names the writer entry (D-14). Types are erased, so this hands a caller no power it
// could not already ask the capabilities above for.
export type {
  AuthoringTestRef,
  AuthorOutcome,
  CurationCandidateProjection,
  CurationJobView,
  CurationProjectionArtifactSource,
  CuratorAuthor,
  EnqueueCurationCandidateProjectionOutcome,
  NeighborRecord,
  OpenServingKnowledgeReaderConfig,
  PurgeAffectedSet,
  PurgeReceipt,
  RebuildReport,
  RollbackAffectedSet,
  RollbackCampaignInput,
  RollbackCurationJobInput,
  RollbackReport,
  WriterLeaseAuthority,
  AcquireWriterLeaseOutcome,
  HeartbeatLeaseOutcome,
  LeaseOperationOptions,
  ReadWriterLeaseOutcome,
  ReleaseLeaseOutcome,
  WriterLease,
  WriterLeaseFreshness,
} from './composition/compose-local-agent.js'

// 2026-08-02 (Phase 387 plan 09, D-20): the build-ordinal edge. Published for the same reason
// the composition root is — a surface that cannot reach it names `runner-local` itself, which is
// the firewall leak this phase clears. See composition/build-ordinals.ts for why these are
// re-exports rather than wrappers.
export {
  BuildOrdinalReservationError,
  reserveBuildOrdinalForProducts,
  resolveBuildTag,
} from './composition/build-ordinals.js'

// A standing host adopts the durable queue through this recovery entry before it opens the
// ordinary local-agent composition. Publishing the entry keeps that ordering shared instead of
// making each surface reach into agent-local's private source tree and re-create the recovery law.
export {
  composeJobRecovery,
  JOB_RECOVERY_MAX_RESUMED_JOBS,
} from './composition/compose-job-recovery.js'
export type {
  ComposeJobRecoveryInput,
  JobRecoveryHost,
} from './composition/compose-job-recovery.js'
