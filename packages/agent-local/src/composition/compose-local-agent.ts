// The one local composition root (Phase 385 plan 09 — D-15).
//
// `packages/agent` is storageNeutral — it may not touch `node:*`. Every host capability the
// function ops and the job queue need is built HERE over the concrete local storage and handed in
// as an injected port. This is the file `packages/cli/src/composition/function-registry.ts` named
// as its own successor in its header, moved down to where the local implementations already live.
//
// Why it is here and not in a surface: 386's daemon composes the same host. A composition that
// lives inside one surface is a composition every other host re-derives, and two hosts deriving the
// same registry differently is the host-divergence bug class the dual-host proof exists to exclude.
// So there is one function, and both hosts call it.
//
// Heavy first-party dependencies are legal in this subtree and nowhere else in this package; the
// arch rule named composition-carveout enforces that, so the job store proper stays lean.

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  createAgentJobQueue,
  createFunctionRegistry,
  createRealJobKindRegistry,
} from '@vostride/agent-qa-agent'
import type {
  AgentJobQueue,
  ClockPort,
  ConfigReaderPort,
  FunctionRegistry,
  JobIdSource,
  JobKindRegistry,
  JobModelCapability,
  KnowledgeReaderPort,
  RunInvocationPort,
  RunsReaderPort,
  StartedRun,
} from '@vostride/agent-qa-agent'
import {
  acquireWriterLease,
  countPendingCurationJobs,
  drainQueue,
  enqueueCurationCandidateProjection,
  foldRunOutcomes,
  heartbeatLease,
  listQueuedCandidates,
  openKnowledgeReader,
  purgeAffectedSetFingerprint,
  purgeRecord,
  readCanonicalBundleAnchors,
  readWriterLease,
  rebuildIndex,
  refreshWriterLeaseAuthority,
  releaseLease,
  resolvePurgeAffectedSet,
  resolveRollbackAffectedSet,
  rollbackAffectedSetFingerprint,
  rollbackCampaign,
  rollbackCurationJob,
  runMaintenanceTail,
  RUN_OUTCOMES_PROJECTION_VERSION,
} from '@vostride/agent-qa-knowledge-local'
import { listBundles } from '@vostride/agent-qa-knowledge-local/reader'
import { ReplayIncompleteError } from '@vostride/agent-qa-runner'
import { setActiveExecutionContextResolver } from '@vostride/agent-qa-safety'
import {
  FsEventLog,
  HANDOFF_FILE,
  RUNS_SUBDIR,
  loadCompletedRunHandoff,
} from '@vostride/agent-qa-runner-local'
import { JsonlAuditSink } from '@vostride/agent-qa-safety-local'
import { asJobId, sha256hex16 } from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  RunEventEnvelope,
  RunId,
  RunsStartInput,
} from '@vostride/agent-qa-schema'

import { buildRunPorts } from './run-composition.js'
import { createJobCheckpointStore } from '../store/job-checkpoint-store.js'
import { AGENT_JOB_STORE_DB_FILE, createSqliteJobStore } from '../store/sqlite-job-store.js'
import type { SqliteJobStore } from '../store/sqlite-job-store.js'

// ---- the knowledge-writer capabilities (D-14, SC5) --------------------------------------------
//
// This file is the ONE place the knowledge package's writer-gated main entry is named, and the arch
// rule named reader-carveout enforces both halves of that: a second file naming it fails, and zero
// files naming it fails too — an allowance nothing uses is a rule that passes forever while
// checking nothing.
//
// What this is NOT: a per-host binding. Every function below takes the roots and options it works
// against as arguments, so there is nothing for a composition to close over and every host would
// bind the identical object. Saying that plainly matters, because the value of gathering them here
// is not parameterisation — it is that "which writer powers does the local host grant?" has one
// answer, in one type, reachable through one edge, instead of being the union of whatever six
// surface files happened to import.
//
// Consequence for a caller: a module that needs one of these at MODULE scope takes it from
// `LOCAL_CURATION_CAPABILITIES` directly; a host that has a handle takes it from `host.curation`,
// which is the same frozen object. Threading a handle through the curation tail's call graph would
// have been a signature change to code D-14 requires this phase to leave semantically untouched.

export type {
  AcquireWriterLeaseOutcome,
  AuthorOutcome,
  AuthoringTestRef,
  CurationCandidateProjection,
  CurationJobView,
  CurationProjectionArtifactSource,
  CuratorAuthor,
  EnqueueCurationCandidateProjectionOutcome,
  HeartbeatLeaseOutcome,
  LeaseOperationOptions,
  NeighborRecord,
  OpenServingKnowledgeReaderConfig,
  PurgeAffectedSet,
  PurgeReceipt,
  RebuildReport,
  ReadWriterLeaseOutcome,
  ReleaseLeaseOutcome,
  RollbackAffectedSet,
  RollbackCampaignInput,
  RollbackCurationJobInput,
  RollbackReport,
  WriterLease,
  WriterLeaseAuthority,
} from '@vostride/agent-qa-knowledge-local'

/**
 * The standing daemon's writer-authority substrate, published through the same one composition
 * edge as every other local writer capability. Surface packages may import agent-local, but the
 * architecture firewall deliberately forbids them from naming knowledge-local or safety
 * directly; keeping this frozen table here preserves that boundary without duplicating lease
 * behavior in the CLI host.
 */
export interface LocalDaemonCapabilities {
  readonly acquireWriterLease: typeof acquireWriterLease
  readonly heartbeatLease: typeof heartbeatLease
  readonly releaseLease: typeof releaseLease
  readonly readWriterLease: typeof readWriterLease
  readonly countPendingCurationJobs: typeof countPendingCurationJobs
  readonly listQueuedCandidates: typeof listQueuedCandidates
  readonly drainQueue: typeof drainQueue
  readonly runMaintenanceTail: typeof runMaintenanceTail
  readonly pinLocalHeadlessExecutionContext: () => void
}

export const LOCAL_DAEMON_CAPABILITIES: LocalDaemonCapabilities = Object.freeze({
  acquireWriterLease,
  heartbeatLease,
  releaseLease,
  readWriterLease,
  countPendingCurationJobs,
  listQueuedCandidates,
  drainQueue,
  runMaintenanceTail,
  pinLocalHeadlessExecutionContext: () => {
    setActiveExecutionContextResolver(() => 'local-headless')
  },
})

/**
 * Index maintenance and the campaign/job rollback verbs, plus the lease every one of them is only
 * legal to hold under. Grouped rather than flattened because they share that precondition: a host
 * reaching for `purgeRecord` without a lease is the mistake the grouping makes visible.
 */
export interface LocalKnowledgeMaintenanceCapabilities {
  readonly acquireWriterLease: typeof acquireWriterLease
  readonly refreshWriterLeaseAuthority: typeof refreshWriterLeaseAuthority
  readonly releaseLease: typeof releaseLease
  readonly rebuildIndex: typeof rebuildIndex
  readonly purgeRecord: typeof purgeRecord
  readonly resolvePurgeAffectedSet: typeof resolvePurgeAffectedSet
  readonly purgeAffectedSetFingerprint: typeof purgeAffectedSetFingerprint
  readonly rollbackCampaign: typeof rollbackCampaign
  readonly rollbackCurationJob: typeof rollbackCurationJob
  readonly resolveRollbackAffectedSet: typeof resolveRollbackAffectedSet
  readonly rollbackAffectedSetFingerprint: typeof rollbackAffectedSetFingerprint
}

export interface LocalCurationCapabilities {
  /** Serving-side reader the tail folds against; read-only despite arriving on the writer edge. */
  readonly openKnowledgeReader: typeof openKnowledgeReader
  readonly drainQueue: typeof drainQueue
  readonly foldRunOutcomes: typeof foldRunOutcomes
  readonly enqueueCurationCandidateProjection: typeof enqueueCurationCandidateProjection
  readonly readCanonicalBundleAnchors: typeof readCanonicalBundleAnchors
  /** Component of the tail's receipt: a bump refolds runs already receipted at the old version. */
  readonly runOutcomesProjectionVersion: typeof RUN_OUTCOMES_PROJECTION_VERSION
  readonly maintenance: LocalKnowledgeMaintenanceCapabilities
}

export const LOCAL_CURATION_CAPABILITIES: LocalCurationCapabilities = Object.freeze({
  openKnowledgeReader,
  drainQueue,
  foldRunOutcomes,
  enqueueCurationCandidateProjection,
  readCanonicalBundleAnchors,
  runOutcomesProjectionVersion: RUN_OUTCOMES_PROJECTION_VERSION,
  maintenance: Object.freeze({
    acquireWriterLease,
    refreshWriterLeaseAuthority,
    releaseLease,
    rebuildIndex,
    purgeRecord,
    resolvePurgeAffectedSet,
    purgeAffectedSetFingerprint,
    rollbackCampaign,
    rollbackCurationJob,
    resolveRollbackAffectedSet,
    rollbackAffectedSetFingerprint,
  }),
})

/**
 * Enumerate `<agentQaRoot>/runs/<slug>/handoff.json`. A project with no runs directory is an
 * ordinary empty result, not an error; an individual unreadable or version-rejected document is
 * skipped so one bad run never hides every other run.
 */
export function createRunsReader(agentQaRoot: string): RunsReaderPort {
  function enumerate(): CompletedRunHandoff[] {
    const runsDir = join(agentQaRoot, RUNS_SUBDIR)
    if (!existsSync(runsDir)) return []

    const documents: CompletedRunHandoff[] = []
    for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const handoffPath = join(runsDir, entry.name, HANDOFF_FILE)
      if (!existsSync(handoffPath)) continue
      try {
        documents.push(loadCompletedRunHandoff(handoffPath))
      } catch {
        continue
      }
    }
    return documents
  }

  return {
    list(): Promise<readonly CompletedRunHandoff[]> {
      return Promise.resolve(enumerate())
    },
    /**
     * Resolution runs over the ENUMERATED run documents and matches on the recorded `runId`,
     * never by joining the caller's string onto a path (T-384-08): a `runId` of `../../etc` can
     * therefore address nothing outside the runs directory, because it is never used to build a
     * path at all.
     */
    get(runId: RunId): Promise<CompletedRunHandoff | undefined> {
      return Promise.resolve(enumerate().find((document) => document.runId === runId))
    },
    /**
     * Deep replay of one run's `events.jsonl` through the SAME concrete store the v49 bus appends
     * with, so a replayed stream is byte-for-byte what the run emitted.
     *
     * Two cases are deliberately distinct. An absent or empty log is an ordinary empty replay —
     * nothing was recorded, so nothing was lost. A log whose earliest surviving seq is ABOVE the
     * requested resume point means events the caller asked for existed and are gone; that is
     * reported with the bus's own `ReplayIncompleteError` carrying the floor, never papered over
     * by returning the surviving suffix (D-07/D-08).
     */
    readEvents(runId: RunId, fromSeq: number): Promise<readonly RunEventEnvelope[]> {
      const recorded = [...new FsEventLog({ root: agentQaRoot, runId }).read(0)]
        .sort((left, right) => left.seq - right.seq)
      if (recorded.length === 0) return Promise.resolve([])

      const earliestAvailableSeq = recorded[0]!.seq
      if (fromSeq < earliestAvailableSeq) {
        return Promise.reject(new ReplayIncompleteError(fromSeq, earliestAvailableSeq))
      }
      return Promise.resolve(recorded.filter((event) => event.seq >= fromSeq))
    },
  }
}

/**
 * The knowledge listing is served through the PHYSICALLY read-only `/reader` package entry. The
 * writer-gated main entry is not reachable from this binding, and the arch reader-carve-out rule
 * enforces that rather than leaving it to discipline.
 *
 * The knowledge ROOT arrives as a host-supplied resolver rather than being derived here: deciding
 * which configuration file is in force, layering an environment over it and choosing whether to
 * load and execute auth plugins are three decisions a daemon makes differently from a terminal,
 * and by the plan-08 dissection rule a thing a headless host would substitute is a port.
 */
export function createKnowledgeReader(
  resolveKnowledgeRoot: () => Promise<string> | string,
): KnowledgeReaderPort {
  return {
    async listBundles() {
      return listBundles(await resolveKnowledgeRoot())
    },
  }
}

// ---- runs.start: the composition's binding (D-16) ---------------------------------------------

/**
 * The host's run-execution capability: run this request to completion, and say which run it was.
 *
 * A PORT rather than shared code, by the plan-08 dissection rule. Would a headless drainer
 * execute a suite the way a terminal host does? It would substitute — the process model
 * (in-process, a child, a worker pool), the signal handling, the reporters and the exit
 * discipline are all decisions the host owns and answers differently. What crosses into the
 * composition is the type; what stays with the host is the orchestration.
 *
 * The verb resolves the IDENTITY of the run and nothing else. Anything richer would be the
 * host telling the composition what happened, and the whole point of the binding below is
 * that the composition does not take the host's word for it.
 */
export interface RunExecutionPort {
  execute(request: RunsStartInput): Promise<StartedRun>
}

/**
 * The run this host reported did not leave a durable event log behind.
 *
 * The composition's evidence check, and the reason `runs.start` cannot be satisfied by a host
 * that returns a plausible run id without running anything. The v49 bus writes `runStarted`
 * before anything else can happen, so a run that began at all has a non-empty log; an empty
 * one means no run took place under that id. Read through {@link buildRunPorts} — the same
 * `FsEventLog` family the runner appends with — so what is inspected is the run's own record
 * rather than a path this file re-derives.
 */
export class RunProducedNoEventsError extends Error {
  constructor(readonly runId: string) {
    super(
      `The host reported run ${runId}, but no run events were recorded for it. ` +
        'A run that started at all writes runStarted before anything else, so an empty ' +
        'event log means no run took place under that id.',
    )
    this.name = 'RunProducedNoEventsError'
  }
}

/**
 * Bind `runs.start` over a host's run execution.
 *
 * The composition contributes the half a host must not be trusted with: after the host says a
 * run happened, the run's own durable event log is read back and an empty one is refused. The
 * op then builds its acknowledgment from the completed-run record through the SAME reader
 * `runs.get` answers from, so "the run is real" and "the run is addressable" are one fact.
 */
export function createLocalRunInvocation(input: {
  readonly agentQaRoot: string
  readonly execution: RunExecutionPort
}): RunInvocationPort {
  return {
    async start(request: RunsStartInput): Promise<StartedRun> {
      const started = await input.execution.execute(request)
      const { eventLog } = buildRunPorts({
        configDir: dirname(input.agentQaRoot),
        runId: String(started.runId),
      })
      if (eventLog.read(0).length === 0) {
        throw new RunProducedNoEventsError(String(started.runId))
      }
      return started
    },
  }
}

/** Wall-clock in the one format every store column and dump row is written in. */
export const SYSTEM_CLOCK: ClockPort = Object.freeze({
  now: (): string => new Date().toISOString(),
})

/**
 * Job ids are derived from `(kind, idempotencyKey)` rather than minted at random, so two hosts
 * enqueuing the same logical work address the same row and the store's unique index has something
 * stable to deduplicate on.
 */
const digestJobIdSource: JobIdSource = {
  jobIdFor: (kind, idempotencyKey) =>
    asJobId(`job_${sha256hex16(`${kind} ${idempotencyKey}`)}`),
}
export const DIGEST_JOB_ID_SOURCE: JobIdSource = Object.freeze(digestJobIdSource)

/**
 * The durable half of the host, opened on demand.
 *
 * `store` is the concrete sqlite store rather than the neutral port: the host that opened the
 * database is the one entitled to close it and to take the D-03 logical dump, and both verbs live
 * on the implementation. Nothing else in the package publishes it.
 */
export interface LocalAgentJobs {
  readonly queue: AgentJobQueue
  readonly store: SqliteJobStore
  readonly kinds: JobKindRegistry
  /** The capability the queue was constructed with, exposed so a host can assert what it bound. */
  readonly model: JobModelCapability
}

export interface LocalAgentHost {
  /** The 384 function registry with every seed capability bound over local storage. */
  readonly registry: FunctionRegistry
  /** The knowledge-writer powers this host grants — the same frozen object for every host. */
  readonly curation: LocalCurationCapabilities
  /** The clock every store column, dump row and audit stamp in this host is written against. */
  readonly clock: ClockPort
  /**
   * Open (once) the durable job queue and its sqlite store over this host's runtime root.
   *
   * A method rather than an eager member, and the reason is a behaviour rather than a taste:
   * constructing the store CREATES `<agentQaRoot>/agent-jobs.db` and the checkpoint directory. A
   * host that only lists the registry — `agent-qa fn --list` is exactly that — would otherwise
   * bring a queue database into existence in a project that has never enqueued anything. Repeated
   * calls return the same instance, so "opened once" is a property of the handle and not of the
   * caller's discipline.
   */
  jobs(): Promise<LocalAgentJobs>
  /** Close whatever was opened. A no-op on a host that never called `jobs()`. */
  close(): void
}

export interface ComposeLocalAgentInput {
  /** The project's runtime root, i.e. `<configDir>/.agent-qa`. Absolute. */
  readonly agentQaRoot: string
  /**
   * Masked configuration reads. Injected because flattening and masking a resolved configuration
   * needs the host's own loader — its file layering, its environment, its plugin policy — and the
   * masking decision is a disclosure boundary the host owns (T-384-07 / T-384-17).
   */
  readonly config: ConfigReaderPort
  /** Resolves the knowledge root this invocation serves from. See `createKnowledgeReader`. */
  readonly knowledgeRoot: () => Promise<string> | string
  /**
   * The model a job may author with (D-10, plan 05).
   *
   * A required factory. REQUIRED because the queue's own `model` option is required and not
   * defaultable — an optional capability means a queue can be built with none, and the only place
   * to discover that is inside an author callback far from the composition that forgot it. A
   * FACTORY because `jobs()` is deferred, and resolving a provider handle costs a configuration
   * read and an auth resolution that a host listing the registry must not pay.
   *
   * It is called at most once, when the queue is opened. `agent-local` never constructs a model:
   * its ownership contract forbids provider invocation, so the handle arrives already built and no
   * provider name is named here.
   */
  readonly model: () => JobModelCapability | Promise<JobModelCapability>
  /**
   * How this host executes a run (D-16). OPTIONAL, and the optionality is the reporting
   * mechanism rather than a convenience: a host that supplies it lists `runs.start` as
   * `bound` and can run it; a host that does not lists the same capability as `unbound` and
   * refuses it by name. Not every composition can start a run — a listing, a read-only
   * surface, 386's daemon before it wires an executor — and D-09 requires that to be a
   * visible state rather than a call that fails somewhere far from the composition.
   */
  readonly runExecution?: RunExecutionPort
  readonly clock?: ClockPort
  readonly idSource?: JobIdSource
  /** The kind registry the queue dispatches through. Defaults to the six real declarations. */
  readonly jobKinds?: JobKindRegistry
}

/**
 * Compose the local agent host.
 *
 * Function-layer invocations audit at the PROJECT root (`<agentQaRoot>/execution_audit.jsonl`), not
 * inside a per-run directory: a capability call is not scoped to any run, and several of them
 * (config reads, registry listings) happen with no run in existence. This follows the v48
 * `execution_audit.jsonl` conventions — same row shape, same sink, project-level file.
 */
export function composeLocalAgent(input: ComposeLocalAgentInput): LocalAgentHost {
  const clock = input.clock ?? SYSTEM_CLOCK

  const registry = createFunctionRegistry({
    deps: {
      runs: createRunsReader(input.agentQaRoot),
      knowledge: createKnowledgeReader(input.knowledgeRoot),
      config: input.config,
      // Present iff this host can execute a run. The registry reads the SAME record to
      // decide what `runs.start` lists as, so the declaration and the dispatch cannot
      // disagree about whether this composition can run it (D-16).
      ...(input.runExecution === undefined ? {} : {
        runInvocation: createLocalRunInvocation({
          agentQaRoot: input.agentQaRoot,
          execution: input.runExecution,
        }),
      }),
    },
    auditSink: new JsonlAuditSink(input.agentQaRoot),
  })

  let opened: LocalAgentJobs | undefined
  let opening: Promise<LocalAgentJobs> | undefined

  async function openJobs(): Promise<LocalAgentJobs> {
    const model = await input.model()
    const store = createSqliteJobStore({
      path: join(input.agentQaRoot, AGENT_JOB_STORE_DB_FILE),
      clock,
      checkpoints: createJobCheckpointStore({ root: input.agentQaRoot }),
    })
    const kinds = input.jobKinds ?? createRealJobKindRegistry()
    const jobs: LocalAgentJobs = {
      queue: createAgentJobQueue({
        store,
        registry: kinds,
        clock,
        idSource: input.idSource ?? DIGEST_JOB_ID_SOURCE,
        model,
      }),
      store,
      kinds,
      model,
    }
    opened = jobs
    return jobs
  }

  return {
    registry,
    curation: LOCAL_CURATION_CAPABILITIES,
    clock,
    jobs(): Promise<LocalAgentJobs> {
      // Memoized on the PROMISE, not on the resolved value: two concurrent callers awaiting a
      // value-memoized opener would each run the factory and each open the database.
      opening ??= openJobs()
      return opening
    },
    close(): void {
      opened?.store.close()
      opened = undefined
      opening = undefined
    },
  }
}
