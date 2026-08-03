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
import { createRequire } from 'node:module'
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
  EntityDirectoryPort,
  FunctionRegistry,
  JobIdSource,
  JobKindRegistry,
  JobModelCapability,
  KnowledgeReaderPort,
  PostRunJobCapabilities,
  RunInvocationPort,
  RunsReaderPort,
  StartedRun,
  StepEvidenceAddress,
  StepEvidenceLookup,
} from '@vostride/agent-qa-agent'
import {
  ADDRESSING_LEDGER_DB_FILE,
  acquireEmbedder,
  acquireWriterLease,
  countPendingCurationJobs,
  createMemorySightingSource,
  describeAllEntities,
  embedPendingEntities,
  countRemainingCurationWork,
  deriveWriterLeaseFreshness,
  drainQueue,
  EMBEDDER_WORKER_START_TIMEOUT_MS,
  EMBEDDER_WORKER_TERM_GRACE_MS,
  EmbedderWorkerTimeoutError,
  embedderWorkerProcessIsAlive,
  embedderWorkerSocketPath,
  enqueueCurationCandidateProjection,
  foldRunOutcomes,
  getEntityDescriptor,
  heartbeatLease,
  inspectDrainableCurationWork,
  isLeaseStale,
  listQueuedCandidates,
  openAddressingLedger,
  openEntityIndex,
  openKnowledgeReader,
  purgeAffectedSetFingerprint,
  probeEmbedderWorkerSocket,
  purgeRecord,
  readCanonicalBundleAnchors,
  readEmbedderWorkerRegistration,
  readWriterLease,
  rebuildIndex,
  entityIndexDbPath,
  resolveEntityRef,
  sightEntity,
  refreshWriterLeaseAuthority,
  releaseLease,
  removeEmbedderWorkerRegistration,
  resetEmbedderCapability,
  verifyEmbedderWorkerIncarnation,
  resolvePurgeAffectedSet,
  resolveRollbackAffectedSet,
  rollbackAffectedSetFingerprint,
  rollbackCampaign,
  rollbackCurationJob,
  runMaintenanceTail,
  sweepEntityIndex,
  RUN_OUTCOMES_PROJECTION_VERSION,
  ENTITY_INDEX_SWEEP_INTERVAL_MS,
  type OwnedEmbedderWorkerRegistration,
  type EntityIndexSweepReport,
  type ResolveEntityRefDeps,
  applyReview,
  openAddressingLedger as openAddressingLedgerForReview,
  proposeReview,
} from '@vostride/agent-qa-knowledge-local'
import type {
  ApplyDelegate,
  ProposeReviewRequest,
} from '@vostride/agent-qa-knowledge-local'
import type { KnowledgeReviewPort } from '@vostride/agent-qa-agent'
import { ReplayIncompleteError } from '@vostride/agent-qa-runner'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
  setActiveExecutionContextResolver,
} from '@vostride/agent-qa-safety'
import {
  FsEventLog,
  HANDOFF_FILE,
  RUNS_SUBDIR,
  loadCompletedRunHandoff,
  slugBranch,
} from '@vostride/agent-qa-runner-local'
import { JsonlAuditSink } from '@vostride/agent-qa-safety-local'
import {
  asJobId,
  DEFAULT_EMBEDDING_PROFILE,
  sha256hex16,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  RunEventEnvelope,
  RunId,
  RunsStartInput,
} from '@vostride/agent-qa-schema'

import { createKnowledgeReaderPort } from './knowledge-review-reader.js'
import type { SightMemoryEntities } from './knowledge-review-reader.js'
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

// 387-08 D-18: the delegate transport's own vocabulary, re-exported through the one edge that
// names the writer entry — a surface builds an `ApplyDelegate` closure and returns an
// `ApplyReviewResult`, and neither is a handle on anything.
export type {
  ApplyDelegate,
  ApplyReviewResult,
} from '@vostride/agent-qa-knowledge-local'

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
  WriterLeaseFreshness,
} from '@vostride/agent-qa-knowledge-local'

// Surface hosts reach worker lifecycle vocabulary through this one legal composition edge.
export {
  EMBEDDER_WORKER_START_TIMEOUT_MS,
  EMBEDDER_WORKER_TERM_GRACE_MS,
  EmbedderWorkerTimeoutError,
  // The projection's maintenance cadence reaches the daemon host through the same one edge.
  ENTITY_INDEX_SWEEP_INTERVAL_MS,
}

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
  readonly isLeaseStale: typeof isLeaseStale
  /**
   * CR-01/CR-08: the one three-valued freshness verdict — fresh, reclaimable, or unknown.
   *
   * Any surface that classifies a holder as recoverable must read this and not the lease file
   * alone, and must name what it does with `unknown` rather than inheriting a boolean it never
   * chose. An authority state that cannot be read is not evidence that nobody holds it.
   */
  readonly deriveWriterLeaseFreshness: typeof deriveWriterLeaseFreshness
  readonly countPendingCurationJobs: typeof countPendingCurationJobs
  readonly countRemainingCurationWork: typeof countRemainingCurationWork
  readonly inspectDrainableCurationWork: typeof inspectDrainableCurationWork
  readonly listQueuedCandidates: typeof listQueuedCandidates
  readonly acquireEmbedder: typeof acquireEmbedder
  readonly drainQueue: typeof drainQueue
  readonly runMaintenanceTail: typeof runMaintenanceTail
  readonly resolveEmbedderWorkerEntryPath: () => string
  readonly readEmbedderWorkerRegistration: typeof readEmbedderWorkerRegistration
  readonly embedderWorkerProcessIsAlive: typeof embedderWorkerProcessIsAlive
  readonly embedderWorkerSocketPath: typeof embedderWorkerSocketPath
  readonly probeEmbedderWorkerSocket: typeof probeEmbedderWorkerSocket
  /** CR-05: no surface may signal a registered worker pid without this verdict returning 'match'. */
  readonly verifyEmbedderWorkerIncarnation: typeof verifyEmbedderWorkerIncarnation
  readonly removeEmbedderWorkerRegistration: (
    agentQaRoot: string,
    expected: OwnedEmbedderWorkerRegistration,
  ) => ReturnType<typeof removeEmbedderWorkerRegistration>
  readonly resetEmbedderCapability: () => void
  readonly loadDefaultGuardrailPolicy: () => ReturnType<typeof loadGuardrailPolicy>
  readonly pinLocalHeadlessExecutionContext: () => void
}

function resolveEmbedderWorkerEntryPath(): string {
  const requireBase = typeof __filename === 'string'
    ? __filename
    : (process.argv[1] ?? join(process.cwd(), 'package.json'))
  const knowledgeEntry = createRequire(requireBase).resolve('@vostride/agent-qa-knowledge-local')
  return join(dirname(knowledgeEntry), 'embedder-worker', 'worker-entry.js')
}

export const LOCAL_DAEMON_CAPABILITIES: LocalDaemonCapabilities = Object.freeze({
  acquireWriterLease,
  heartbeatLease,
  releaseLease,
  readWriterLease,
  deriveWriterLeaseFreshness,
  isLeaseStale,
  countPendingCurationJobs,
  countRemainingCurationWork,
  inspectDrainableCurationWork,
  listQueuedCandidates,
  acquireEmbedder,
  drainQueue,
  runMaintenanceTail,
  resolveEmbedderWorkerEntryPath,
  readEmbedderWorkerRegistration,
  embedderWorkerProcessIsAlive,
  embedderWorkerSocketPath,
  probeEmbedderWorkerSocket,
  verifyEmbedderWorkerIncarnation,
  removeEmbedderWorkerRegistration,
  resetEmbedderCapability: () => resetEmbedderCapability(DEFAULT_EMBEDDING_PROFILE),
  loadDefaultGuardrailPolicy: () => loadGuardrailPolicy(defaultGuardrailPolicyInput),
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
    /**
     * One step's persisted evidence, read back out of the run's own handoff document
     * (387 KREV-02 / D-15).
     *
     * Through `loadCompletedRunHandoff` — the version guard — and NOT through a raw JSON read,
     * which is the load-bearing half. 387-02 gave the guard a present-implies-valid clause for
     * the retrieval trace, so a document whose trace is present but malformed is refused here
     * rather than reaching the why-verb looking well-formed. A v4 document loads through the
     * registered identity migration and simply carries no trace at all: that is the honest
     * pre-387 absence, and it is exactly what the guard's version stamp exists to make
     * distinguishable from a run that captured nothing.
     *
     * The ambiguity check is the never-guess law at this seam. `stepIndex` numbers steps per
     * MEMBER TEST, so a run with two tests has two step 0s; when the address does not name a
     * test and more than one candidate answers to it, this reports the candidates rather than
     * picking whichever test the document happened to list first. Picking would have produced a
     * confident, wrong answer to a question that was never asked — and a why-verb that does
     * that is worse than one that refuses, because its answer looks exactly like a right one.
     */
    readStepEvidence(runId: RunId, address: StepEvidenceAddress): Promise<StepEvidenceLookup> {
      const document = enumerate().find((candidate) => candidate.runId === runId)
      if (document === undefined) return Promise.resolve({ kind: 'run-not-recorded' })

      const candidates = document.tests.filter((test) => (
        (address.testId === undefined || test.testId === address.testId)
        && test.steps.some((step) => step.stepIndex === address.stepIndex)
      ))
      if (candidates.length === 0) return Promise.resolve({ kind: 'step-not-found' })
      if (candidates.length > 1) {
        return Promise.resolve({
          kind: 'ambiguous-step-address',
          // Sorted, so the refusal a surface prints is the same list twice running.
          testIds: candidates.map((test) => test.testId).sort(),
        })
      }

      const evidence = candidates[0]!.steps.find((step) => step.stepIndex === address.stepIndex)
      return Promise.resolve(
        evidence === undefined
          ? { kind: 'step-not-found' }
          : { kind: 'found', evidence },
      )
    },
  }
}

/**
 * The knowledge READ port, served through the PHYSICALLY read-only `/reader` package entry.
 *
 * The five read verbs live in `knowledge-review-reader.ts`, which is registered in the arch
 * reader carve-out's pinned file list and therefore CANNOT name the writer-gated entry. This
 * file can (it also binds the curator), so keeping the verbs here would have put them in the
 * one place in the workspace where a write import is legal — separation by discipline instead
 * of by rule. What stays here is the half that genuinely belongs to a composition root: the
 * D-01 sighting site, which mints into the durable addressing ledger and so must live where
 * the writer entry may be named.
 *
 * The knowledge ROOT arrives as a host-supplied resolver rather than being derived here: deciding
 * which configuration file is in force, layering an environment over it and choosing whether to
 * load and execute auth plugins are three decisions a daemon makes differently from a terminal,
 * and by the plan-08 dissection rule a thing a headless host would substitute is a port.
 */
export function createKnowledgeReader(
  resolveKnowledgeRoot: () => Promise<string> | string,
  sightMemoryEntities?: SightMemoryEntities,
): KnowledgeReaderPort {
  return createKnowledgeReaderPort({
    resolveKnowledgeRoot,
    ...(sightMemoryEntities === undefined ? {} : { sightMemoryEntities }),
  })
}

// ---- knowledge review: the WRITE half of the verb family (387 KREV-01 / D-17 · D-18) --------

export interface CreateKnowledgeReviewInput {
  readonly agentQaRoot: string
  readonly resolveKnowledgeRoot: () => Promise<string> | string
  /**
   * How this host reaches the writer-lease holder when one is alive (D-18). OPTIONAL, and the
   * optionality is the whole routing rule rather than a convenience: a host that supplies it
   * delegates an apply the leaseholder must perform, and a host that does not REFUSES by name.
   * Neither ever takes a held lease. The daemon supplies none, which is why its own applies
   * cannot recurse — it holds the lease, so it always takes the in-process branch.
   */
  readonly applyDelegate?: ApplyDelegate
  /**
   * The writer lease this host ALREADY holds, when it is the holder (D-18).
   *
   * The daemon's half of the routing rule. A holder cannot acquire its own lease a second time, so
   * it hands the authority it owns to the apply; supplying this is mutually exclusive with
   * supplying a delegate, and a host that supplies both is a host claiming to be two places.
   */
  readonly resolveWriterAuthority?: () => { readonly leaseId: string; readonly epoch: number } | undefined
}

/**
 * Bind the mutating review verbs over the review modules and the Curator's one commit path.
 *
 * A SEPARATE factory from `createKnowledgeReader`, mirroring the port split it implements: this
 * is the object whose presence makes accept/reject/forget report `bound`, and a host that wants
 * only the read verbs simply does not build one. The `MEM-` short-ID leg resolves through the
 * addressing ledger, opened per call and closed again on exactly the reasoning the entity
 * directory uses — a durable file the composition root owns, never a handle a review module holds.
 */
export function createKnowledgeReview(input: CreateKnowledgeReviewInput): KnowledgeReviewPort {
  async function roots(): Promise<{ knowledgeRoot: string }> {
    return { knowledgeRoot: await input.resolveKnowledgeRoot() }
  }

  return {
    async propose(request) {
      const { knowledgeRoot } = await roots()
      const ledger = openAddressingLedgerForReview({
        path: join(input.agentQaRoot, ADDRESSING_LEDGER_DB_FILE),
      })
      try {
        return proposeReview({
          agentQaRoot: input.agentQaRoot,
          knowledgeRoot,
          request: request as ProposeReviewRequest,
          // READS the ledger and never mints: an apply is not a sighting, and minting an address
          // for an id nobody surfaced would make every review call a write to the one durable
          // store this system never rebuilds (D-01/D-02).
          resolveBundleShortId: (shortId) => ledger.lookupByShortId(shortId)?.machineId,
        })
      } finally {
        ledger.close()
      }
    },
    async apply(proposalId) {
      const { knowledgeRoot } = await roots()
      const result = await applyReview({
        agentQaRoot: input.agentQaRoot,
        knowledgeRoot,
        proposalId,
        ...(input.applyDelegate === undefined ? {} : { delegate: input.applyDelegate }),
        ...(() => {
          const authority = input.resolveWriterAuthority?.()
          return authority === undefined ? {} : { writerAuthority: authority }
        })(),
      })
      return {
        outcome: result.outcome,
        proposal: result.proposal,
        ...(result.forgetReceipt === undefined ? {} : { forgetReceipt: result.forgetReceipt }),
      }
    },
  }
}

// ---- entities: the addressing ledger and the tier-(a) resolver (387 D-01/D-02/D-09) ----------

export interface CreateEntityDirectoryInput {
  readonly agentQaRoot: string
  readonly resolveKnowledgeRoot: () => Promise<string> | string
}

/**
 * Bind the entity directory over this host's durable addressing ledger.
 *
 * The ledger file is opened PER CALL and closed again, and both halves of that are deliberate.
 *
 * Opened per call, because the ledger is a durable file under the agent-qa root: opening it
 * eagerly at composition time would bring an `entity-addresses.db` into existence in a project
 * that has never resolved anything, and `agent-qa fn --list` is exactly such a caller. This is
 * the same law the job store's deferred `jobs()` handle carries, expressed for a port that has
 * no handle to defer.
 *
 * Closed again, because minting is LEASE-FREE by design (D-02) — the CLI must mint with no
 * daemon running, so several processes hold this file at once and sqlite arbitrates through
 * WAL and the busy timeout. A connection kept open for the life of a composition would hold a
 * reader open across a caller's whole session for no gain; the transactions here are single
 * statements at a human-paced grain.
 *
 * The path is resolved HERE rather than inside `knowledge-local`, beside `agent-jobs.db`, so
 * the package that owns the runtime root is the package that names its files.
 */
export function createEntityDirectory(input: CreateEntityDirectoryInput): EntityDirectoryPort {
  return {
    resolve(ref) {
      return withEntityResolutionDeps(input, (deps) => resolveEntityRef(ref, deps))
    },
    get(ref) {
      return withEntityResolutionDeps(input, (deps) => getEntityDescriptor(ref, deps))
    },
  }
}

/**
 * The D-01 LIST-VERB sighting site (387 plan 06).
 *
 * Lives beside the entity directory rather than inside the read port, because minting reaches
 * the durable addressing ledger through the writer-gated package entry, and the file that
 * binds the read verbs is held to the reader subpath by the arch carve-out. So the read port
 * is handed this callback and never a ledger.
 *
 * It goes through `sightEntity` — the resolver's OWN sighting leg — and not through a local
 * mint. D-01 names four sighting sites and a second minting path written for the fourth is a
 * second place where "first sighting mints, idempotently, and projects into the entity index"
 * could stop being true with nothing comparing the two. `resolveEntityRef` is deliberately NOT
 * what is called here: it would fall through to the hybrid tiers on an id no source recognises
 * (a purged record's id, say), running a retrieval to answer a question nobody asked.
 *
 * One ledger span for the whole batch. A listing surfaces every bundle at once, and opening the
 * two databases per row would turn a human-paced review verb into N open/close cycles.
 */
export function createMemorySightingHook(
  input: CreateEntityDirectoryInput,
): SightMemoryEntities {
  return (bundleIds) => withEntityResolutionDeps(input, (deps) => {
    for (const bundleId of bundleIds) sightEntity(bundleId, deps)
  })
}

/**
 * Open the addressing ledger and the entity-index projection for ONE span, run `body`, close.
 *
 * Shared by the directory port and the list-verb sighting hook so both obey the same open/close
 * law rather than two copies of it.
 */
async function withEntityResolutionDeps<T>(
  input: CreateEntityDirectoryInput,
  body: (deps: ResolveEntityRefDeps) => T | Promise<T>,
): Promise<T> {
  const knowledgeRoot = await input.resolveKnowledgeRoot()
  const ledger = openAddressingLedger({
    path: join(input.agentQaRoot, ADDRESSING_LEDGER_DB_FILE),
  })
  // The D-06 projection is opened beside the ledger and for the same span. It lives under
  // the KNOWLEDGE root rather than the agent-qa root because it is derived from knowledge
  // the same way the memidex index is, and it is disposable in exactly that sense — while
  // the ledger, one directory tree away, is the thing that must never be rebuilt.
  const entityIndex = openEntityIndex({ path: entityIndexDbPath(knowledgeRoot) })
  try {
    // AWAITED inside the try, not returned from it: tier (b)'s dense leg is asynchronous, so
    // returning the promise would close both databases while the resolution was still using
    // them. The bug is invisible while every caller is synchronous, which is exactly why it
    // is worth the word.
    return await body({
      ledger,
      entityIndex,
      // One kind is wired by the tracer. 387-03 registers the remaining sources here and
      // neither the resolver nor the ops change — which is the property the tracer exists
      // to establish before anything expands.
      sources: [createMemorySightingSource(() => knowledgeRoot)],
    })
  } finally {
    entityIndex.close()
    ledger.close()
  }
}

export interface SweepEntityIndexInput extends CreateEntityDirectoryInput {
  /**
   * Test seam ONLY. Production omission runs the real acquisition ladder, which is what makes
   * the dense rung appear on hosts that have a model and stay absent on hosts that do not.
   */
  readonly acquireEmbedderCapability?: typeof acquireEmbedder
}

export interface SweepEntityIndexOutcome extends EntityIndexSweepReport {
  /** How many renderings gained a vector this sweep. Zero on a floor host, by design. */
  readonly embedded: number
}

/**
 * The daemon's maintenance-cadence sweep over the D-06 projection.
 *
 * Three properties, and each is a deliberate refusal rather than an omission:
 *
 *  - it takes NO writer lease. Everything it writes lives in the entity index's own file, and
 *    a projection that needed the lease could not be maintained by a host that does not hold
 *    one — which is every one-shot CLI process.
 *  - it never writes the addressing ledger. It READS the ledger to know what exists (D-02: the
 *    ledger is the durable truth, not a projection) and writes only the rendering of it.
 *  - it embeds only what a host can already embed. `acquireEmbedder` with no download is the
 *    same ladder the retrieval legs ride: ready means the dense rung joins the resolver on this
 *    host, and anything else leaves the projection lexical-only rather than blocking the sweep.
 */
export async function sweepEntityIndexProjection(
  input: SweepEntityIndexInput,
): Promise<SweepEntityIndexOutcome> {
  const knowledgeRoot = await input.resolveKnowledgeRoot()
  const ledger = openAddressingLedger({
    path: join(input.agentQaRoot, ADDRESSING_LEDGER_DB_FILE),
  })
  const entityIndex = openEntityIndex({ path: entityIndexDbPath(knowledgeRoot) })
  try {
    const report = sweepEntityIndex(entityIndex, describeAllEntities({
      ledger,
      sources: [createMemorySightingSource(() => knowledgeRoot)],
    }))

    let embedded = 0
    const acquire = input.acquireEmbedderCapability ?? acquireEmbedder
    const capability = await acquire({
      preferredProfile: DEFAULT_EMBEDDING_PROFILE,
      allowDownload: false,
      agentQaRoot: input.agentQaRoot,
    })
    if (capability.kind === 'ready') {
      embedded = await embedPendingEntities(
        entityIndex,
        capability.embedder,
        capability.profile,
      )
    }
    return { ...report, embedded }
  } finally {
    entityIndex.close()
    ledger.close()
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

/** Refusal returned when durable capabilities are requested after their composition was closed. */
export class LocalAgentClosedError extends Error {
  override readonly name = 'LocalAgentClosedError'

  constructor(readonly agentQaRoot: string) {
    super(
      `The local agent composition for ${agentQaRoot} is closed. A closed composition cannot `
      + 'reopen its job store; create a new composition with fresh lifecycle ownership instead.',
    )
  }
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
  /** Close whatever was opened and join an open already in flight. Idempotent. */
  close(): Promise<void>
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
  /**
   * How an apply reaches the writer-lease holder when one is alive (387-08 D-18).
   *
   * An OPTIONAL operation on the input bag rather than a new production seam (the 386-41 D-2
   * idiom). `agent-local` cannot name a socket and does not: the CLI host injects a closure over
   * `invokeViaDaemon`, and the daemon's own composition injects nothing.
   */
  readonly applyDelegate?: ApplyDelegate
  /** The writer lease a leaseholding host already owns (387-08 D-18). See `createKnowledgeReview`. */
  readonly resolveWriterAuthority?: () => { readonly leaseId: string; readonly epoch: number } | undefined
  readonly clock?: ClockPort
  readonly idSource?: JobIdSource
  /** The kind registry the queue dispatches through. Defaults to the six real declarations. */
  readonly jobKinds?: JobKindRegistry
  /**
   * What the post-run chain's real handlers may do (388 D-01), on the optional-operation
   * idiom `runExecution` and `applyDelegate` already use.
   *
   * OPTIONAL, and the optionality is the report rather than a convenience: a host that
   * supplies it dispatches the REAL analyze-run and curate-memory bodies, and a host that
   * does not keeps the scripted stand-ins. Only `curateRun` is asked for — the handoff read
   * is built here, from `agentQaRoot`, because it is a path derivation this package already
   * owns and a caller-supplied one would be a second layout to keep in step with the writer's.
   *
   * `curateRun` is the caller's because it is not a local concern at all: it needs the writer
   * lease, a knowledge root and the v51 drain, and the CLI's run tail is where all three
   * already meet (plan 02 binds it).
   */
  readonly postRun?: {
    readonly curateRun: PostRunJobCapabilities['curateRun']
  }
}

/**
 * The post-run handlers' capabilities, or nothing at all (388 D-01 / D-06).
 *
 * The handoff read is DERIVED from `runId` through the same `runs/<slug>/handoff.json` layout
 * `FsHandoffStore` writes and `createRunsReader` enumerates — never a path carried on the job
 * payload, which would be a stored fact free to go stale between the enqueue and the claim,
 * and a caller-controlled string on the way to `join`. `slugBranch` is what makes a runId of
 * `../../etc` address nothing outside the runs directory (T-361-01 precedent).
 *
 * `loadCompletedRunHandoff` already hard-fails typed on a missing file or an unreadable
 * schema version, which is exactly the posture the handler wants: both are permanent
 * conditions of that run, not transient ones worth a retry.
 */
function postRunCapabilities(
  input: ComposeLocalAgentInput,
): PostRunJobCapabilities | undefined {
  const postRun = input.postRun
  if (postRun === undefined) return undefined
  return {
    loadCompletedRunHandoff: (runId: string) =>
      loadCompletedRunHandoff(
        join(input.agentQaRoot, RUNS_SUBDIR, slugBranch(runId), HANDOFF_FILE),
      ),
    curateRun: postRun.curateRun,
  }
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

  const entityResolutionInput = {
    agentQaRoot: input.agentQaRoot,
    resolveKnowledgeRoot: input.knowledgeRoot,
  }

  const registry = createFunctionRegistry({
    deps: {
      runs: createRunsReader(input.agentQaRoot),
      // 387 D-01: this host's list verbs are live sighting sites. Every entity a listing,
      // an inspect, a diff or a show surfaces gets its permanent address the first time it
      // is surfaced — which is what "pre-existing entities get IDs the day they are first
      // referenced" means in practice, and it costs the creation paths nothing.
      knowledge: createKnowledgeReader(
        input.knowledgeRoot,
        createMemorySightingHook(entityResolutionInput),
      ),
      config: input.config,
      entities: createEntityDirectory(entityResolutionInput),
      // 387-08 KREV-01: the WRITE half, and it is present in every local composition because a
      // local host owns the knowledge root it serves from. It stays an OPTIONAL dep so a host
      // that is genuinely read-only — a listing, a remote surface — reports the four mutating
      // verbs as `unbound` BY NAME rather than as a hole in the catalogue.
      knowledgeReview: createKnowledgeReview({
        agentQaRoot: input.agentQaRoot,
        resolveKnowledgeRoot: input.knowledgeRoot,
        ...(input.applyDelegate === undefined ? {} : { applyDelegate: input.applyDelegate }),
        ...(input.resolveWriterAuthority === undefined
          ? {}
          : { resolveWriterAuthority: input.resolveWriterAuthority }),
      }),
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
  let closing: Promise<void> | undefined
  let lifecycleGeneration = 0
  let closed = false

  async function openJobs(openGeneration: number): Promise<LocalAgentJobs> {
    const model = await input.model()
    const store = createSqliteJobStore({
      path: join(input.agentQaRoot, AGENT_JOB_STORE_DB_FILE),
      clock,
      checkpoints: createJobCheckpointStore({ root: input.agentQaRoot }),
    })
    let jobs: LocalAgentJobs
    try {
      const kinds = input.jobKinds ?? createRealJobKindRegistry(postRunCapabilities(input))
      jobs = {
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
    } catch (error) {
      store.close()
      throw error
    }
    if (closed || openGeneration !== lifecycleGeneration) {
      // The model can resolve after close. Constructing then invalidating here keeps the open
      // transactional: the late store proves it can initialize, but it never becomes reachable.
      store.close()
      throw new LocalAgentClosedError(input.agentQaRoot)
    }
    opened = jobs
    return jobs
  }

  return {
    registry,
    curation: LOCAL_CURATION_CAPABILITIES,
    clock,
    jobs(): Promise<LocalAgentJobs> {
      if (closed) return Promise.reject(new LocalAgentClosedError(input.agentQaRoot))
      // Memoized on the PROMISE, not on the resolved value: two concurrent callers awaiting a
      // value-memoized opener would each run the factory and each open the database.
      opening ??= openJobs(lifecycleGeneration)
      return opening
    },
    close(): Promise<void> {
      if (closing !== undefined) return closing
      closed = true
      lifecycleGeneration += 1
      const pending = opening
      const current = opened
      opened = undefined
      // Preserve the existing synchronous-close property for a fully opened composition. Callers
      // that historically did not await close still release the handle before returning.
      current?.store.close()
      closing = (async () => {
        if (pending !== undefined) {
          try {
            const late = await pending
            if (late !== current) late.store.close()
          } catch {
            // A superseded opener closes its own store; a model/open failure owns no live handle.
          }
        }
        opening = undefined
      })()
      return closing
    },
  }
}
