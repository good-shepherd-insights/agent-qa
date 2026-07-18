import { existsSync, readFileSync } from 'node:fs'

import {
  canonicalJson,
  asRecordId,
  type BundleKind,
  type CanaryOutcome,
  type ExecutionContext,
  type FactSubtype,
  type GuardrailPolicy,
  type IndexEntry,
} from '@vostride/agent-qa-schema'

import { openKnowledgeReader, type KnowledgeReader } from '../index-reader.js'
import {
  indexDbPath,
  openIndexReaderConnection,
  readIndexMaintenanceState,
  type IndexMaintenanceState,
} from '../index-open.js'
import {
  rebuildIndex,
  removeBundleProjectionRows,
  type RebuildReport,
} from '../index-rebuild.js'
import { acquireEmbedder } from '../embedder-acquire.js'
import { runKnowledgeGc, type GcSummary } from '../gc.js'
import {
  readRebuildRequest,
  type RebuildRequest,
} from '../rebuild-marker.js'
import { buildRetrievalQuery, type RetrievalQueryInput } from '../query-helper.js'
import { retrieve } from '../retrieve.js'
import {
  reconcileOnDrainStart,
  type ReconcileReport,
} from '../journal/reconcile.js'
import type { CommitIntent } from '../journal/intent-journal.js'
import {
  acquireWriterLease,
  heartbeatLease,
  releaseLease,
  type WriterLease,
} from '../lease/writer-lease.js'
import {
  claimNextJob,
  requeueClaimed,
  type ClaimedCurationJob,
  type MalformedClaimedCurationJob,
} from '../queue/curation-queue.js'
import {
  canaryOutcomeContentAddress,
  canaryOutcomePayloadSchema,
} from '../queue/canary-payload.js'
import {
  persistAuthoredCheckpoint,
  readJobState,
  writeJobState,
} from '../queue/job-state.js'
import type { CurationCandidatePayload } from '../queue/queue-payload.js'
import {
  AUTHORED_CHECKPOINT_SCHEMA_VERSION,
  parseAuthoredCheckpoint,
  resolveDispositionProfile,
  sliceAuthoredCheckpoint,
  type AuthoredCheckpoint,
  type CurationJobView,
  type CuratorAuthor,
  type NeighborRecord,
} from './author-contract.js'
import {
  applyIndexDeltaForBundle,
  commitCurationDelta,
  deriveIndexRowFromBundle,
  type CommitCurationOutcome,
} from './commit.js'
import type { DispositionDrainState } from './disposition.js'
import { constructFallbackDeltas } from './fallback.js'
import { createLocalKnowledgeStore } from './knowledge-store.js'

/** Ratified M2 one-shot budget. It gates job starts only, never an in-flight author request. */
export const DRAIN_BUDGET_MS = 60_000

/** Provisional §7.4 cap over distinct search-before-create query targets. */
export const SEARCH_BEFORE_CREATE_MAX_QUERIES = 5

/** Provisional 376 D-14 per-job breaker before a vector-deferred commit is forced. */
export const EMBED_CRASH_VECTORLESS_THRESHOLD = 2

const SEARCH_BEFORE_CREATE_RESULTS_PER_QUERY = 8
const SEARCH_BEFORE_CREATE_MAX_NEIGHBORS = 12

export type DrainFailureStage =
  | 'lease'
  | 'reconcile'
  | 'claim'
  | 'heartbeat'
  | 'job-state'
  | 'search'
  | 'author'
  | 'checkpoint'
  | 'commit'
  | 'requeue'
  | 'release'
  | 'writer-pass'
  | 'gc'

export interface DrainFailure {
  stage: DrainFailureStage
  message: string
  candidateId?: string
}

export type WriterPassReport =
  | { kind: 'not-requested' }
  | { kind: 'skipped'; reason: 'lease-held' | 'budget-exhausted' | 'aborted' }
  | {
      kind: 'rebuilt'
      request?: RebuildRequest
      rebuild: RebuildReport
    }
  | { kind: 'failed'; message: string }

export type GcPassReport =
  | { kind: 'not-run' }
  | { kind: 'skipped'; reason: 'lease-held' | 'budget-exhausted' | 'aborted' }
  | {
      kind: 'completed'
      summary: GcSummary
      /** WR-01: projection rows removed by the same-drain scoped cleanup; absent on zero-trim. */
      projectionRowsRemoved?: number
    }
  | { kind: 'failed'; message: string }

interface DrainReportBase {
  jobsProcessed: number
  committed: number
  downgraded: number
  withheld: number
  requeued: number
  failures: number
  failureDetails: DrainFailure[]
  reconcile: ReconcileReport | undefined
  writerPass: WriterPassReport
  gc: GcPassReport
}

export type DrainReport = DrainReportBase &
  (
    | { kind: 'drained' | 'aborted' }
    | { kind: 'handed-off'; holder: WriterLease }
  )

/**
 * Internal capability table used by focused fault-injection tests. Production callers omit it;
 * every default delegates directly to the shipped queue, lease, retrieval, commit, and rebuild
 * authorities.
 */
export interface DrainOperations {
  acquireWriterLease: typeof acquireWriterLease
  heartbeatLease: typeof heartbeatLease
  releaseLease: typeof releaseLease
  reconcileOnDrainStart: typeof reconcileOnDrainStart
  claimNextJob: typeof claimNextJob
  requeueClaimed: typeof requeueClaimed
  readJobState: typeof readJobState
  writeJobState: typeof writeJobState
  persistAuthoredCheckpoint: typeof persistAuthoredCheckpoint
  openKnowledgeReader: typeof openKnowledgeReader
  buildRetrievalQuery: typeof buildRetrievalQuery
  retrieve: typeof retrieve
  commitCurationDelta: typeof commitCurationDelta
  /** The canonical commit already projects dense work as pending; the breaker selects this seam. */
  commitCurationDeltaVectorless: typeof commitCurationDelta
  readRebuildRequest: typeof readRebuildRequest
  readIndexMaintenanceState: typeof readIndexMaintenanceState
  acquireEmbedder: typeof acquireEmbedder
  rebuildIndex: typeof rebuildIndex
  runKnowledgeGc: typeof runKnowledgeGc
  removeBundleProjectionRows: typeof removeBundleProjectionRows
  hasIndexRow(knowledgeRoot: string, bundleId: string): boolean
  applyIndexDeltaForBundle: typeof applyIndexDeltaForBundle
  deriveIndexRowFromBundle: typeof deriveIndexRowFromBundle
}

export interface DrainOptions {
  knowledgeRoot: string
  auditBaseDir: string
  budgetMs?: number
  author: CuratorAuthor
  executionContext: ExecutionContext
  policy: GuardrailPolicy
  signal?: AbortSignal
  /** D-06 test seam. Production uses the one wall clock only at drain boundaries. */
  now?: () => number
  /** Fault-injection seam; production callers must omit it. */
  operations?: Partial<DrainOperations>
}

const BUNDLE_KINDS = new Set<BundleKind>([
  'fact',
  'procedure',
  'caution',
  'unknown',
  'policy',
])
const FACT_SUBTYPES = new Set<FactSubtype>([
  'selector',
  'behavioral',
  'navigational',
  'measurement',
  'content',
])

function hasIndexRow(knowledgeRoot: string, bundleId: string): boolean {
  if (!existsSync(indexDbPath(knowledgeRoot))) return false
  let reader: ReturnType<typeof openIndexReaderConnection> | undefined
  try {
    reader = openIndexReaderConnection(knowledgeRoot)
    return reader.db.prepare('SELECT 1 FROM records WHERE bundle_id = ?').get(bundleId)
      !== undefined
  } catch {
    return false
  } finally {
    reader?.db.close()
  }
}

const DEFAULT_OPERATIONS: DrainOperations = {
  acquireWriterLease,
  heartbeatLease,
  releaseLease,
  reconcileOnDrainStart,
  claimNextJob,
  requeueClaimed,
  readJobState,
  writeJobState,
  persistAuthoredCheckpoint,
  openKnowledgeReader,
  buildRetrievalQuery,
  retrieve,
  commitCurationDelta,
  commitCurationDeltaVectorless: commitCurationDelta,
  readRebuildRequest,
  readIndexMaintenanceState,
  acquireEmbedder,
  rebuildIndex,
  runKnowledgeGc,
  removeBundleProjectionRows,
  hasIndexRow,
  applyIndexDeltaForBundle,
  deriveIndexRowFromBundle,
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function readClaimedCanaryOutcome(
  claimed: MalformedClaimedCurationJob,
): CanaryOutcome | undefined {
  try {
    const parsed = canaryOutcomePayloadSchema.safeParse(
      JSON.parse(readFileSync(claimed.payloadPath, 'utf8')),
    )
    if (
      !parsed.success
      || canaryOutcomeContentAddress(parsed.data) !== claimed.candidateId
    ) {
      return undefined
    }
    return {
      candidateId: asRecordId(parsed.data.candidateId),
      runOutcome: parsed.data.outcome,
      runId: parsed.data.runId,
      testId: parsed.data.testId,
      testIndex: parsed.data.testIndex,
      buildOrdinal: parsed.data.buildOrdinal,
      stepIndex: parsed.data.stepIndex,
      briefDigest: parsed.data.briefDigest,
      attribution: parsed.data.attribution,
      exercisedAnchor: parsed.data.exercisedAnchor,
    }
  } catch {
    return undefined
  }
}

function isEmbeddingCrash(error: unknown, seen = new Set<object>()): boolean {
  if (typeof error !== 'object' || error === null || seen.has(error)) return false
  seen.add(error)
  const value = error as { name?: unknown; message?: unknown; cause?: unknown }
  const attribution = `${String(value.name ?? '')} ${String(value.message ?? '')}`
  return /(?:embedder|embedding|embeddings|embedDocument|FloorEmbedding|NativeEmbedding)/i
    .test(attribution)
    || isEmbeddingCrash(value.cause, seen)
}

function emptyReport(): DrainReportBase {
  return {
    jobsProcessed: 0,
    committed: 0,
    downgraded: 0,
    withheld: 0,
    requeued: 0,
    failures: 0,
    failureDetails: [],
    reconcile: undefined,
    writerPass: { kind: 'not-requested' },
    gc: { kind: 'not-run' },
  }
}

function recordFailure(
  report: DrainReportBase,
  stage: DrainFailureStage,
  error: unknown,
  candidateId?: string,
): void {
  report.failures += 1
  report.failureDetails.push({
    stage,
    message: errorMessage(error),
    ...(candidateId === undefined ? {} : { candidateId }),
  })
}

function jobView(payload: CurationCandidatePayload): CurationJobView {
  return {
    candidateId: payload.candidateId,
    kind: payload.kind,
    ...(payload.subtype === undefined ? {} : { subtype: payload.subtype }),
    ...(payload.rootCauseClass === undefined
      ? {}
      : { rootCauseClass: payload.rootCauseClass }),
    anchors: payload.anchors,
    summarySeed: payload.summarySeed,
    bodySeed: payload.bodySeed,
    distilledObservations: payload.distilledObservations,
    scope: payload.scope,
    buildOrdinal: payload.buildOrdinal,
    attributingObservationId: payload.attributingObservationId,
    executionContext: payload.executionContext,
    secretFlagged: payload.secretFlagged,
    injectionFlagged: payload.injectionFlagged,
    captureReceipt: payload.captureReceipt,
  }
}

function addTargetedQuery(
  queries: RetrievalQueryInput[],
  seen: Set<string>,
  query: RetrievalQueryInput,
): void {
  if (queries.length >= SEARCH_BEFORE_CREATE_MAX_QUERIES) return
  const key = canonicalJson({ intent: query.intent, anchors: query.anchors })
  if (seen.has(key)) return
  seen.add(key)
  queries.push(query)
}

function targetedQueries(payload: CurationCandidatePayload): RetrievalQueryInput[] {
  const primary = payload.anchors[0]!
  const queries: RetrievalQueryInput[] = []
  const seen = new Set<string>()
  addTargetedQuery(queries, seen, {
    intent: payload.summarySeed,
    anchors: [primary],
  })

  for (const anchor of payload.anchors) {
    if (anchor.t === 'error') {
      addTargetedQuery(queries, seen, {
        intent: anchor.message,
        anchors: [primary, anchor],
      })
    } else if (anchor.t === 'flow') {
      addTargetedQuery(queries, seen, {
        intent: anchor.name,
        anchors: [primary, anchor],
      })
    }
  }
  for (const observation of payload.distilledObservations) {
    if (observation.error !== undefined) {
      addTargetedQuery(queries, seen, {
        intent: observation.error.naturalKey,
        anchors: [
          primary,
          { t: 'error', message: observation.error.naturalKey },
        ],
      })
    }
    if (observation.flow !== undefined) {
      addTargetedQuery(queries, seen, {
        intent: observation.flow.name,
        anchors: [primary, { t: 'flow', name: observation.flow.name }],
      })
    }
  }
  return queries
}

function retrievalOptions(payload: CurationCandidatePayload) {
  return {
    n: SEARCH_BEFORE_CREATE_RESULTS_PER_QUERY,
    product: payload.scope.key,
    ...(payload.scope.tier === 'test' ? { testKey: payload.scope.key } : {}),
    ...(payload.scope.tier === 'suite' ? { suiteKey: payload.scope.key } : {}),
    includeSuperseded: true,
  }
}

function neighborFromEntry(entry: IndexEntry, alias: number): NeighborRecord | undefined {
  if (!BUNDLE_KINDS.has(entry.kind as BundleKind) || entry.audit === undefined) return undefined
  const kind = entry.kind as BundleKind
  const observedOrdinal = entry.audit.closedAtOrdinal ?? entry.audit.openedAtOrdinal
  const base = {
    alias,
    recordId: entry.id,
    summary: entry.summary,
    anchors: entry.anchors,
    observedStatus: entry.audit.status,
    observedOrdinal,
  }
  if (kind === 'fact') {
    if (!FACT_SUBTYPES.has(entry.subtype as FactSubtype)) return undefined
    return { ...base, kind, subtype: entry.subtype as FactSubtype }
  }
  return { ...base, kind }
}

async function searchBeforeCreate(
  operations: DrainOperations,
  payload: CurationCandidatePayload,
  knowledgeRoot: string,
): Promise<NeighborRecord[]> {
  let reader: KnowledgeReader | undefined
  try {
    reader = operations.openKnowledgeReader(knowledgeRoot)
    const byRecordId = new Map<string, IndexEntry>()
    for (const query of targetedQueries(payload)) {
      // The explicit build call fixes normalization/query classification at this boundary; the
      // retrieve pipeline consumes the same structured input through its public entry point.
      operations.buildRetrievalQuery(query)
      const hits = await operations.retrieve(reader, query, retrievalOptions(payload))
      for (const hit of hits) {
        if (!byRecordId.has(hit.id)) byRecordId.set(hit.id, hit)
      }
    }

    const neighbors: NeighborRecord[] = []
    for (const hit of byRecordId.values()) {
      const neighbor = neighborFromEntry(hit, neighbors.length + 1)
      if (neighbor !== undefined) neighbors.push(neighbor)
      if (neighbors.length >= SEARCH_BEFORE_CREATE_MAX_NEIGHBORS) break
    }
    return neighbors
  } finally {
    reader?.close()
  }
}

function checkpointFromAuthored(
  deltas: AuthoredCheckpoint['deltas'],
  authorship: AuthoredCheckpoint['authorship'],
  neighbors: readonly NeighborRecord[],
): AuthoredCheckpoint {
  const seen = new Set<string>()
  const preconditions = deltas
    .flatMap((delta) => delta.precondition ?? [])
    .filter((cas) => {
      const key = canonicalJson(cas)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  return parseAuthoredCheckpoint({
    schemaVersion: AUTHORED_CHECKPOINT_SCHEMA_VERSION,
    deltas,
    neighborIds: neighbors.map(({ recordId }) => recordId),
    preconditions,
    authorship,
  })
}

async function authorCheckpoint(
  options: DrainOptions,
  operations: DrainOperations,
  job: ClaimedCurationJob,
): Promise<AuthoredCheckpoint> {
  const view = jobView(job.payload)
  const neighbors = await searchBeforeCreate(operations, job.payload, options.knowledgeRoot)
  const outcome = await options.author(view, neighbors)
  if (outcome.kind === 'authored') {
    if (outcome.deltas.length === 0) {
      throw new Error('authored outcome must carry at least one delta')
    }
    return checkpointFromAuthored(outcome.deltas, outcome.authorship, neighbors)
  }

  const fallback = constructFallbackDeltas(view, neighbors)
  if (fallback.length !== 1 || fallback[0] === undefined) {
    throw new Error('deterministic fallback must produce exactly one delta')
  }
  const authorship = fallback[0].authorship
  if (authorship === undefined || authorship.path !== 'deterministic-fallback') {
    throw new Error('deterministic fallback omitted its authorship stamp')
  }
  return checkpointFromAuthored(fallback, authorship, neighbors)
}

function persistCheckpoint(
  operations: DrainOperations,
  knowledgeRoot: string,
  candidateId: string,
  checkpoint: AuthoredCheckpoint,
): void {
  const persisted = operations.persistAuthoredCheckpoint({
    knowledgeRoot,
    candidateId,
    authored: checkpoint,
  })
  if (persisted.kind !== 'persisted') {
    throw new Error('cannot persist authored checkpoint over malformed job state')
  }
}

function clearCheckpointAndRequeue(
  operations: DrainOperations,
  knowledgeRoot: string,
  leaseId: string,
  job: ClaimedCurationJob,
): void {
  const state = operations.readJobState(knowledgeRoot, job.candidateId)
  operations.writeJobState({
    knowledgeRoot,
    candidateId: job.candidateId,
    lifecycle: 'queued',
    embedCrashCount: state.kind === 'parsed' ? state.state.embedCrashCount : 0,
  })
  operations.requeueClaimed({ knowledgeRoot, leaseId })
}

function preserveAuthoredCheckpointAndRequeue(
  operations: DrainOperations,
  knowledgeRoot: string,
  leaseId: string,
  job: ClaimedCurationJob,
  checkpoint: AuthoredCheckpoint,
  embedCrashCount: number,
  failureLabel: string,
): number {
  operations.writeJobState({
    knowledgeRoot,
    candidateId: job.candidateId,
    lifecycle: 'authored',
    embedCrashCount,
    authored: checkpoint,
  })
  const requeued = operations.requeueClaimed({ knowledgeRoot, leaseId })
  if (!requeued.includes(job.candidateId)) {
    throw new Error(`${failureLabel} candidate ${job.candidateId} was not requeued`)
  }
  return requeued.length
}

function incrementEmbedCrashAndRequeue(
  operations: DrainOperations,
  knowledgeRoot: string,
  leaseId: string,
  job: ClaimedCurationJob,
  checkpoint: AuthoredCheckpoint,
  embedCrashCount: number,
): number {
  return preserveAuthoredCheckpointAndRequeue(
    operations,
    knowledgeRoot,
    leaseId,
    job,
    checkpoint,
    embedCrashCount + 1,
    'embed-crashed',
  )
}

async function runWriterPass(
  operations: DrainOperations,
  knowledgeRoot: string,
): Promise<WriterPassReport> {
  const marker = operations.readRebuildRequest(knowledgeRoot)
  const maintenance = operations.readIndexMaintenanceState(knowledgeRoot)
  if (!marker.present && !hasIndexMaintenanceDebt(maintenance)) {
    return { kind: 'not-requested' }
  }

  const capability = await operations.acquireEmbedder({ allowDownload: false })
  const rebuild = await operations.rebuildIndex({
    knowledgeRoot,
    ...(capability.kind === 'ready' ? { embedder: capability.embedder } : {}),
  })
  return {
    kind: 'rebuilt',
    ...(marker.present && marker.request !== undefined ? { request: marker.request } : {}),
    rebuild,
  }
}

function hasIndexMaintenanceDebt(state: IndexMaintenanceState): boolean {
  return state.indexAbsent
    || state.pendingEmbeddings > 0
    || state.renderingEpochStale
    || state.vectorReconciliationOutstanding
}

function mapCommitOutcome(
  report: DrainReportBase,
  outcome: CommitCurationOutcome,
  job: ClaimedCurationJob,
  operations: DrainOperations,
  options: DrainOptions,
  leaseId: string,
): 'continue' | 'stop' {
  switch (outcome.kind) {
    case 'applied':
    case 'converted-confirm':
      report.committed += 1
      return 'continue'
    case 'downgraded':
      report.committed += 1
      report.downgraded += 1
      return 'continue'
    case 'withheld':
      report.withheld += 1
      return 'continue'
    case 'noop':
      return 'continue'
    case 'failed':
      recordFailure(report, 'commit', outcome.reason, job.candidateId)
      return 'continue'
    case 'abandoned-stale-epoch':
      recordFailure(
        report,
        'commit',
        `writer epoch became stale (observed ${outcome.observedEpoch})`,
        job.candidateId,
      )
      return 'stop'
    case 'requeue-resynthesis':
      try {
        clearCheckpointAndRequeue(
          operations,
          options.knowledgeRoot,
          leaseId,
          job,
        )
        report.requeued += 1
      } catch (error) {
        recordFailure(report, 'requeue', error, job.candidateId)
      }
      // Fresh neighbors belong to the next drain; reclaiming immediately could livelock on the
      // same lexicographically-first candidate.
      return 'stop'
  }
}

function reconcileDependencies(
  operations: DrainOperations,
  knowledgeRoot: string,
) {
  return {
    knowledgeRoot,
    hasIndexRow: (bundleId: string) => operations.hasIndexRow(knowledgeRoot, bundleId),
    applyIndexDelta: (intent: CommitIntent) => {
      operations.applyIndexDeltaForBundle({ knowledgeRoot, bundleId: intent.bundleId })
    },
    deriveIndexRowFromBundle: (bundleId: string) => {
      operations.deriveIndexRowFromBundle({ knowledgeRoot, bundleId })
    },
  }
}

function budgetMs(options: DrainOptions): number {
  const value = options.budgetMs ?? DRAIN_BUDGET_MS
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('budgetMs must be a finite non-negative number')
  }
  return value
}

/**
 * Lease-gated one-shot Curator drain. It owns no provider: authoring is injected, serialized, and
 * durably checkpointed before the deterministic commit tail. Abort and budget are checked only at
 * job boundaries, so an in-flight model request always finishes under its own model-layer policy.
 */
export async function drainQueue(options: DrainOptions): Promise<DrainReport> {
  const operations: DrainOperations = { ...DEFAULT_OPERATIONS, ...options.operations }
  const now = options.now ?? Date.now
  const startedAt = now()
  const limit = budgetMs(options)
  const report = emptyReport()
  const lease = operations.acquireWriterLease(options.knowledgeRoot)
  if (lease.kind === 'held') {
    report.writerPass = { kind: 'skipped', reason: 'lease-held' }
    report.gc = { kind: 'skipped', reason: 'lease-held' }
    return { ...report, kind: 'handed-off', holder: lease.holder }
  }

  const result: DrainReportBase & { kind: 'drained' | 'aborted' } = {
    ...report,
    kind: 'drained',
  }
  const drainState: DispositionDrainState = { supersedesSeenByAnchorKey: new Map() }
  try {
    try {
      result.reconcile = operations.reconcileOnDrainStart(
        reconcileDependencies(operations, options.knowledgeRoot),
      )
    } catch (error) {
      recordFailure(result, 'reconcile', error)
      return result
    }

    while (true) {
      if (now() - startedAt >= limit) break
      if (options.signal?.aborted === true) {
        result.kind = 'aborted'
        break
      }

      let claimed
      try {
        claimed = operations.claimNextJob({
          knowledgeRoot: options.knowledgeRoot,
          leaseId: lease.leaseId,
        })
      } catch (error) {
        recordFailure(result, 'claim', error)
        break
      }
      if (claimed === undefined) break
      result.jobsProcessed += 1

      const heartbeat = operations.heartbeatLease({
        knowledgeRoot: options.knowledgeRoot,
        leaseId: lease.leaseId,
      })
      if (heartbeat.kind === 'refused') {
        recordFailure(result, 'heartbeat', heartbeat.reason, claimed.candidateId)
        break
      }

      if (claimed.kind === 'malformed') {
        // D-22: the strict sibling payload branches before checkpoint lookup, retrieval, or
        // author construction. A canary job therefore has no control-flow path to an LLM and
        // consumes none of the search-before-create query budget.
        const canaryOutcome = readClaimedCanaryOutcome(claimed)
        if (canaryOutcome === undefined) {
          recordFailure(
            result,
            'job-state',
            'claimed candidate payload is malformed',
            claimed.candidateId,
          )
          continue
        }
        try {
          const store = createLocalKnowledgeStore({
            knowledgeRoot: options.knowledgeRoot,
            auditBaseDir: options.auditBaseDir,
            executionContext: options.executionContext,
            epoch: lease.epoch,
            sourceBuildOrdinal: canaryOutcome.buildOrdinal,
            sourceRunId: canaryOutcome.runId,
            policy: options.policy,
          })
          await store.recordCanaryOutcome(canaryOutcome)
          operations.writeJobState({
            knowledgeRoot: options.knowledgeRoot,
            candidateId: claimed.candidateId,
            lifecycle: 'done',
          })
          result.committed += 1
        } catch (error) {
          recordFailure(result, 'commit', error, claimed.candidateId)
        }
        continue
      }

      let checkpoint: AuthoredCheckpoint
      const state = operations.readJobState(options.knowledgeRoot, claimed.candidateId)
      if (state.kind === 'malformed') {
        recordFailure(result, 'job-state', 'job lifecycle state is malformed', claimed.candidateId)
        continue
      }
      const embedCrashCount = state.kind === 'parsed' ? state.state.embedCrashCount : 0
      if (state.kind === 'parsed' && state.state.authored !== undefined) {
        try {
          checkpoint = parseAuthoredCheckpoint(state.state.authored)
        } catch (error) {
          recordFailure(result, 'checkpoint', error, claimed.candidateId)
          continue
        }
      } else {
        try {
          checkpoint = await authorCheckpoint(options, operations, claimed)
        } catch (error) {
          recordFailure(result, 'author', error, claimed.candidateId)
          continue
        }
        try {
          persistCheckpoint(
            operations,
            options.knowledgeRoot,
            claimed.candidateId,
            checkpoint,
          )
        } catch (error) {
          recordFailure(result, 'checkpoint', error, claimed.candidateId)
          continue
        }
      }

      // D-02: dispose each authored delta independently through the one commit boundary.
      // Only the final delta completes the queue job so earlier disposals keep the claimed
      // candidate directory (and its artifacts) available.
      const vectorless = embedCrashCount >= EMBED_CRASH_VECTORLESS_THRESHOLD
      const slices = sliceAuthoredCheckpoint(checkpoint)
      let stopDrain = false
      /**
       * Sibling-failure invariant: no later slice may complete a job after any slice fails.
       * Preserve the whole authored checkpoint so successful siblings coalesce on retry while
       * the missing slice can land without re-invoking the author.
       */
      let anySliceFailed = false
      for (const [sliceIndex, slice] of slices.entries()) {
        const finalDelta = sliceIndex === slices.length - 1
        let outcome: CommitCurationOutcome
        try {
          const commit = vectorless
            ? operations.commitCurationDeltaVectorless
            : operations.commitCurationDelta
          outcome = commit(
            {
              knowledgeRoot: options.knowledgeRoot,
              auditBaseDir: options.auditBaseDir,
              epoch: lease.epoch,
              profile: resolveDispositionProfile(options.executionContext),
              drainState,
              policy: options.policy,
              ...(!finalDelta || anySliceFailed ? { deferCompletion: true } : {}),
            },
            claimed,
            slice,
          )
        } catch (error) {
          if (!vectorless && isEmbeddingCrash(error)) {
            recordFailure(result, 'commit', error, claimed.candidateId)
            try {
              result.requeued += incrementEmbedCrashAndRequeue(
                operations,
                options.knowledgeRoot,
                lease.leaseId,
                claimed,
                checkpoint,
                embedCrashCount,
              )
            } catch (requeueError) {
              recordFailure(result, 'requeue', requeueError, claimed.candidateId)
            }
            // A requeued crash is deliberately a next-drain retry. At the durable threshold that
            // retry uses the vectorless seam and lands the canonical bundle with dense work
            // pending. Already-committed sibling deltas coalesce as Confirm on the retry.
            stopDrain = true
            break
          }
          anySliceFailed = true
          recordFailure(result, 'commit', error, claimed.candidateId)
          continue
        }
        if (outcome.kind === 'failed') anySliceFailed = true
        if (
          mapCommitOutcome(
            result,
            outcome,
            claimed,
            operations,
            options,
            lease.leaseId,
          ) === 'stop'
        ) {
          stopDrain = true
          break
        }
      }
      if (anySliceFailed && !stopDrain) {
        try {
          result.requeued += preserveAuthoredCheckpointAndRequeue(
            operations,
            options.knowledgeRoot,
            lease.leaseId,
            claimed,
            checkpoint,
            embedCrashCount,
            'partially failed',
          )
        } catch (error) {
          recordFailure(result, 'requeue', error, claimed.candidateId)
        }
        // Reclaiming the same lexicographically-first candidate in this drain can livelock;
        // the durable checkpoint retry deliberately belongs to the next drain.
        stopDrain = true
      }
      if (stopDrain) break
    }

    if (result.kind === 'aborted') {
      result.writerPass = { kind: 'skipped', reason: 'aborted' }
      result.gc = { kind: 'skipped', reason: 'aborted' }
    } else if (now() - startedAt >= limit) {
      result.writerPass = { kind: 'skipped', reason: 'budget-exhausted' }
      result.gc = { kind: 'skipped', reason: 'budget-exhausted' }
    } else {
      try {
        result.writerPass = await runWriterPass(operations, options.knowledgeRoot)
      } catch (error) {
        recordFailure(result, 'writer-pass', error)
        result.writerPass = { kind: 'failed', message: errorMessage(error) }
      }
      if (now() - startedAt >= limit) {
        result.gc = { kind: 'skipped', reason: 'budget-exhausted' }
      } else {
        try {
          /**
           * D-13 M2 has no gate receipts. Phase 380 adds live canary-reference
           * exclusions; M3 supplies the real ordinal horizon through this seam.
           * Budget gates the start only and never interrupts whole-dir trims.
           */
          const summary = operations.runKnowledgeGc({
            knowledgeRoot: options.knowledgeRoot,
            horizon: { kind: 'none' },
          })
          const completed: Extract<GcPassReport, { kind: 'completed' }> = {
            kind: 'completed',
            summary,
          }
          result.gc = completed
          if (summary.trimmedRecordIds.length > 0) {
            // WR-01: the trim summary drives scoped projection cleanup in the same drain.
            try {
              completed.projectionRowsRemoved = operations.removeBundleProjectionRows(
                options.knowledgeRoot,
                summary.trimmedRecordIds,
              )
            } catch (error) {
              // Canonical truth was already trimmed; the failure names the projection debt.
              recordFailure(result, 'gc', error)
            }
          }
        } catch (error) {
          recordFailure(result, 'gc', error)
          result.gc = { kind: 'failed', message: errorMessage(error) }
        }
      }
    }
    return result
  } finally {
    try {
      const released = operations.releaseLease({
        knowledgeRoot: options.knowledgeRoot,
        leaseId: lease.leaseId,
      })
      if (released.kind === 'refused') recordFailure(result, 'release', released.reason)
    } catch (error) {
      recordFailure(result, 'release', error)
    }
  }
}
