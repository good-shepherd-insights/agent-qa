import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { resolveKnowledgeRoot } from '@vostride/agent-qa-core'
import {
  LOCAL_CURATION_CAPABILITIES,
  type LocalCurationCapabilities,
  type OpenServingKnowledgeReaderConfig,
} from '@vostride/agent-qa-agent-local'
import type { KnowledgeHintReader } from '@vostride/agent-qa-runner'
import {
  EVENTS_FILE,
  HANDOFF_FILE,
  RUNS_SUBDIR,
  loadCompletedRunHandoff,
  slugBranch,
} from '@vostride/agent-qa-runner-local'
import type { AuditSink } from '@vostride/agent-qa-safety'
import { JsonlAuditSink, runSafetyScope } from '@vostride/agent-qa-safety-local'
import type {
  GuardrailPolicy,
  MaskingContext,
} from '@vostride/agent-qa-schema'
import { canonicalJson, sha256hex } from '@vostride/agent-qa-schema'

import { nudgeDaemon } from '../daemon/client.js'
import {
  buildCuratorAuthor,
  type BuildCuratorAuthorDependencies,
} from './curator-author.js'
import { emitCanaryOutcomes } from './emit-canary-outcomes.js'
import { emitCurationCandidates, type EmitReport } from './emit-candidates.js'
import { exercisedAnchors } from './handoff-anchors.js'

export const CURATION_TAIL_RECEIPT_FILE = 'curation-tail-receipt.json'
/**
 * v3 (386-02): the receipt gained the final drain disposition, handoff holder, and sorted
 * candidate ids. v2 receipts fail validation, so already-drained runs refold once — safe
 * because every tail fold is idempotent per runId. Never a second marker file (PATTERNS mandate).
 */
export const CURATION_TAIL_RECEIPT_SCHEMA_VERSION = 3

export interface CurationTailReceipt {
  schemaVersion: typeof CURATION_TAIL_RECEIPT_SCHEMA_VERSION
  runId: string
  handoffDigest: string
  /** Run-outcome projection component: a version bump refolds already-receipted runs. */
  projectionVersion: number
  drainKind: 'drained' | 'handed-off'
  /** The standing writer that accepted the handoff; null when this run drained inline. */
  handoffHolderPid: number | null
  /** Stable run-side provenance, ordered before the receipt bytes are committed. */
  candidateIds: string[]
}

export type CurationTailModelDeps = Pick<
  BuildCuratorAuthorDependencies,
  'profile' | 'auth'
>

export interface CurationTailLogger {
  warn(message: string): void
  /** 381-50: carries the per-run candidate summary line — diagnosis, never control flow. */
  info?(message: string): void
}

export interface CurationTailOperations {
  loadCompletedRunHandoff: typeof loadCompletedRunHandoff
  resolveKnowledgeRoot: typeof resolveKnowledgeRoot
  runSafetyScope: typeof runSafetyScope
  emitCurationCandidates: typeof emitCurationCandidates
  openKnowledgeReader(config: OpenServingKnowledgeReaderConfig): KnowledgeHintReader
  emitCanaryOutcomes: typeof emitCanaryOutcomes
  foldRunOutcomes: LocalCurationCapabilities['foldRunOutcomes']
  buildCuratorAuthor: typeof buildCuratorAuthor
  drainQueue: LocalCurationCapabilities['drainQueue']
  listCompletedRunDirs(agentQaRoot: string): string[]
  readCurationTailReceipt(runDir: string): CurationTailReceipt | undefined
  writeCurationTailReceipt(runDir: string, receipt: CurationTailReceipt): void
  nudgeDaemon: typeof nudgeDaemon
}

/**
 * Writer authority the CALLER already holds (388-02, Pitfall 7).
 *
 * The fold acquires no lease of its own when this is present. That is not an optimisation: a
 * process holding the writer lease that calls `acquireWriterLease` again is told `held` — by
 * itself — and would hand its own work off to nobody (the 387-08 D-18 shape).
 */
export interface CurationWriterAuthority {
  leaseId: string
  epoch: number
}

export interface RunCurationTailOptions {
  runId: string
  /** Absolute `.agent-qa` runtime root shared by the run handoff and curation audit. */
  agentQaRoot: string
  knowledgeConfig: { dir: string }
  configDir: string
  auditSink: AuditSink
  maskingContext?: MaskingContext
  /** The exact already-resolved planner profile and auth used by the run. */
  modelDeps?: CurationTailModelDeps
  policy: GuardrailPolicy
  signal?: AbortSignal
  log: CurationTailLogger
  /** 388-02: the sweep runs under the post-run tail's held lease when there is one. */
  authority?: CurationWriterAuthority
  /** 388-02 (D-03): absolute wall-clock stop point shared with the one post-run budget. */
  deadlineMs?: number
  /** Focused test seam. Production callers omit it. */
  operations?: Partial<CurationTailOperations>
}

function defaultOperations(): CurationTailOperations {
  return {
    loadCompletedRunHandoff,
    resolveKnowledgeRoot,
    runSafetyScope,
    emitCurationCandidates,
    openKnowledgeReader: LOCAL_CURATION_CAPABILITIES.openKnowledgeReader,
    emitCanaryOutcomes,
    foldRunOutcomes: LOCAL_CURATION_CAPABILITIES.foldRunOutcomes,
    buildCuratorAuthor,
    drainQueue: LOCAL_CURATION_CAPABILITIES.drainQueue,
    listCompletedRunDirs,
    readCurationTailReceipt,
    writeCurationTailReceipt,
    nudgeDaemon,
  }
}

/**
 * The shipped operation table, for callers that drive the PER-RUN fold directly (388-02).
 *
 * `curate-memory`'s handler reaches this fold through a capability bound at a composition
 * root, and a composition root has no test seam to thread — so the defaults have to be
 * nameable from outside this module rather than only reachable through `runCurationTail`.
 */
export function defaultCurationTailOperations(): CurationTailOperations {
  return defaultOperations()
}

/**
 * The one runs-dir derivation, published (388-02).
 *
 * `slugBranch` is what makes a runId of `../../etc` address nothing outside the runs directory
 * (T-361-01), and a second site spelling this join would be a second thing to keep traversal-safe.
 * Published from HERE rather than re-imported at each caller because the FUNC-02 surface firewall
 * forbids new CLI files from naming `@vostride/agent-qa-runner-local` at all — so one derivation
 * is not merely tidier, it is the only shape the boundary permits.
 */
export function completedRunDir(agentQaRoot: string, runId: string): string {
  return join(agentQaRoot, RUNS_SUBDIR, slugBranch(runId))
}

export function completedRunHandoffPath(agentQaRoot: string, runId: string): string {
  return join(completedRunDir(agentQaRoot, runId), HANDOFF_FILE)
}

/**
 * The run's own event log, published for the same reason and on the same terms (388-04).
 *
 * `EVENTS_FILE` is the runner-local constant the writer that CREATED this file used, so the
 * post-run chip emitter appends to the file the run wrote rather than to a name that merely
 * matches it today.
 */
export function completedRunEventsPath(agentQaRoot: string, runId: string): string {
  return join(completedRunDir(agentQaRoot, runId), EVENTS_FILE)
}

/** The project-level audit sink a fold outside a run's own tail records against. */
export function createCurationAuditSink(agentQaRoot: string): AuditSink {
  return new JsonlAuditSink(agentQaRoot)
}

function listCompletedRunDirs(agentQaRoot: string): string[] {
  const runsRoot = join(agentQaRoot, RUNS_SUBDIR)
  if (!existsSync(runsRoot)) return []
  return readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(runsRoot, entry.name))
    .filter((runDir) => existsSync(join(runDir, HANDOFF_FILE)))
    .sort()
}

function isSortedCandidateIds(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false
  if (!value.every((candidateId): candidateId is string => typeof candidateId === 'string')) {
    return false
  }
  return value.every((candidateId, index) => index === 0 || value[index - 1]! <= candidateId)
}

function isCurationTailReceipt(value: unknown): value is CurationTailReceipt {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).sort().join(',')
    === 'candidateIds,drainKind,handoffDigest,handoffHolderPid,projectionVersion,runId,schemaVersion'
    && record.schemaVersion === CURATION_TAIL_RECEIPT_SCHEMA_VERSION
    && typeof record.runId === 'string'
    && record.runId.length > 0
    && typeof record.handoffDigest === 'string'
    && /^[0-9a-f]{64}$/u.test(record.handoffDigest)
    && typeof record.projectionVersion === 'number'
    && Number.isInteger(record.projectionVersion)
    && record.projectionVersion > 0
    && (record.drainKind === 'drained' || record.drainKind === 'handed-off')
    && (
      (record.drainKind === 'drained' && record.handoffHolderPid === null)
      || (
        record.drainKind === 'handed-off'
        && typeof record.handoffHolderPid === 'number'
        && Number.isInteger(record.handoffHolderPid)
        && record.handoffHolderPid > 0
      )
    )
    && isSortedCandidateIds(record.candidateIds)
}

export function readCurationTailReceipt(runDir: string): CurationTailReceipt | undefined {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(runDir, CURATION_TAIL_RECEIPT_FILE), 'utf8'),
    )
    return isCurationTailReceipt(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function fsyncFile(file: string): void {
  const fd = openSync(file, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function writeCurationTailReceipt(runDir: string, receipt: CurationTailReceipt): void {
  const file = join(runDir, CURATION_TAIL_RECEIPT_FILE)
  const staged = join(runDir, `.${CURATION_TAIL_RECEIPT_FILE}.${randomUUID()}.tmp`)
  try {
    writeFileSync(staged, `${canonicalJson(receipt)}\n`, { encoding: 'utf8', mode: 0o600 })
    fsyncFile(staged)
    renameSync(staged, file)
    fsyncFile(runDir)
  } finally {
    rmSync(staged, { force: true })
  }
}

export function curationTailHandoffDigest(handoff: unknown): string {
  return sha256hex(canonicalJson(handoff))
}

type CurationTailReceiptIdentity = Pick<
  CurationTailReceipt,
  'schemaVersion' | 'runId' | 'handoffDigest' | 'projectionVersion'
>

function receiptIdentityForHandoff(handoff: { runId: unknown }): CurationTailReceiptIdentity {
  return {
    schemaVersion: CURATION_TAIL_RECEIPT_SCHEMA_VERSION,
    runId: String(handoff.runId),
    handoffDigest: curationTailHandoffDigest(handoff),
    projectionVersion: LOCAL_CURATION_CAPABILITIES.runOutcomesProjectionVersion,
  }
}

function receiptMatches(
  receipt: CurationTailReceipt | undefined,
  expected: CurationTailReceiptIdentity,
): boolean {
  return receipt?.schemaVersion === expected.schemaVersion
    && receipt.runId === expected.runId
    && receipt.handoffDigest === expected.handoffDigest
    && receipt.projectionVersion === expected.projectionVersion
}

function sortedCandidateIds(report: EmitReport): string[] {
  return report.details
    .flatMap((detail) => detail.candidateId === undefined ? [] : [detail.candidateId])
    .sort()
}

const CANDIDATE_LINE_KINDS = ['fact', 'measurement', 'caution', 'procedure'] as const
const CANDIDATE_LINE_OUTCOMES = ['enqueued', 'coalesced', 'cap-exceeded', 'refused'] as const

/**
 * 381-50 (F-381-48-1): one additive, value-free line per swept run naming every kind's
 * projected count and outcome split — kinds, counts, and candidate content-address ids
 * only, never seed/observation/provenance content. The procedure kind always renders,
 * even at zero projected, so "nothing projected" reads from the line alone. Ids are
 * listed only for non-enqueued (queue-silent) outcomes to keep the line bounded.
 */
function candidateSummaryLine(runId: string, report: EmitReport): string {
  const segments = CANDIDATE_LINE_KINDS.flatMap((kind) => {
    const details = report.details.filter((detail) => detail.kind === kind)
    if (details.length === 0) return kind === 'procedure' ? ['procedure 0 projected'] : []
    const split = CANDIDATE_LINE_OUTCOMES.flatMap((outcomeKind) => {
      const rows = details.filter((detail) => detail.outcome.kind === outcomeKind)
      if (rows.length === 0) return []
      const ids = outcomeKind === 'enqueued'
        ? []
        : rows.flatMap((row) => (row.candidateId === undefined ? [] : [row.candidateId]))
      return [`${rows.length} ${outcomeKind}${ids.length === 0 ? '' : `: ${ids.join(', ')}`}`]
    }).join(', ')
    return [`${kind} ${details.length} projected (${split})`]
  })
  return `Knowledge curation candidates for ${runId}: ${segments.join('; ')}.`
}

function incompleteWarning(runId: string, details?: string): string {
  const diagnostic = details === undefined ? '' : ` (${details})`
  return `Post-verdict knowledge curation incomplete for ${runId}${diagnostic}; it will resume on the next run.`
}

/** The author `drainQueue` accepts, named off the capability so no second import declares it. */
type CurationAuthorCapability =
  Parameters<LocalCurationCapabilities['drainQueue']>[0]['author']

export interface CurateCompletedRunInput {
  /** The run's own directory (`<agentQaRoot>/runs/<slug>`), derived by the caller. */
  runDir: string
  /** The already-loaded, already-guarded handoff for THAT directory. */
  handoff: ReturnType<typeof loadCompletedRunHandoff>
  knowledgeRoot: string
  agentQaRoot: string
  auditSink: AuditSink
  maskingContext?: MaskingContext
  policy: GuardrailPolicy
  modelDeps?: CurationTailModelDeps
  /** An already-resolved author wins over `modelDeps`; a standing host holds one per process. */
  author?: CurationAuthorCapability
  authority?: CurationWriterAuthority
  deadlineMs?: number
  signal?: AbortSignal
  log: CurationTailLogger
  operations?: Partial<CurationTailOperations>
}

export interface CurateCompletedRunReport {
  /** Bundles this fold committed — the `curated` half of the D-11 notification counts. */
  curated: number
  /** Committed `Deprecate` deltas — the `deprecated` half. */
  deprecated: number
  /** Whether the receipt was written, i.e. whether this run needs folding again. */
  complete: boolean
  drainKind: 'drained' | 'handed-off' | 'aborted'
  /** The same field list the incomplete warning renders; present only when incomplete. */
  incompleteDetails?: string
}

/**
 * Fold ONE completed run (388-02 D-01).
 *
 * Extracted verbatim from the sweep's inner body so `curate-memory`'s handler and the tail's
 * prior-run janitor drive the same code rather than two spellings of it. The split is
 * per-run/multi-run and nothing else (Pitfall 11): everything about a single run — the safety
 * scope, candidates, canaries, the outcome fold, the drain and the receipt — is here; the
 * enumeration of which runs still need it stays in `runCurationTail`.
 *
 * `authority` is what makes the extraction correct rather than merely tidy. The post-run tail
 * holds the writer lease while it pumps the chain, so the fold running INSIDE a claimed job
 * must borrow that authority; a fold that acquired its own would be told `held` by the very
 * process asking.
 */
export async function curateCompletedRun(
  input: CurateCompletedRunInput,
): Promise<CurateCompletedRunReport> {
  const operations: CurationTailOperations = {
    ...defaultOperations(),
    ...input.operations,
  }
  const receiptIdentity = receiptIdentityForHandoff(input.handoff)
  let curated = 0
  let deprecated = 0
  let drainKind: CurateCompletedRunReport['drainKind'] = 'aborted'
  let complete = false
  let completedReceipt: CurationTailReceipt | undefined
  let incompleteDetails: string | undefined
  let projectionFailed = false
  const tailStartedAtMs = Date.now()
  // D-03: one budget for the whole post-run tail. A caller that already spent part of it hands
  // in its absolute deadline and the drain gets what is LEFT — never a second knob's worth.
  const budgetMs = input.deadlineMs === undefined
    ? undefined
    : Math.max(0, input.deadlineMs - tailStartedAtMs)
  await operations.runSafetyScope(
    {
      maskingContext: input.maskingContext,
      auditSink: input.auditSink,
      // SAFE-01: posture is persisted run truth, never an ambient re-detection.
      executionContext: input.handoff.executionContext,
    },
    async () => {
      const candidates = operations.emitCurationCandidates({
        handoff: input.handoff,
        runDir: input.runDir,
        knowledgeRoot: input.knowledgeRoot,
        policy: input.policy,
      })
      // 381-50: visibility never gates — the summary line is additive diagnosis
      // beside (never inside) the noop warn and the complete predicate below.
      input.log.info?.(candidateSummaryLine(receiptIdentity.runId, candidates))
      // D-20: candidate and canary drops share this scope and crash boundary.
      const reader = operations.openKnowledgeReader({ knowledgeRoot: input.knowledgeRoot })
      const canaries = operations.emitCanaryOutcomes({
        handoff: input.handoff,
        knowledgeRoot: input.knowledgeRoot,
        runDir: input.runDir,
        emit: reader.emitCanaryOutcome.bind(reader),
      })
      // D-14: the run-outcome fold shares this crash boundary and the SAME extended
      // receipt as candidate/canary emit — never a second marker file. The durable
      // handoff marker is the sole exclusion authority for current and sibling runs.
      // A fold failure is isolated (counted below) and never blocks the drain; the
      // withheld receipt refolds it on the next run, safe because the fold is idempotent.
      try {
        operations.foldRunOutcomes({
          knowledgeRoot: input.knowledgeRoot,
          handoff: input.handoff,
          extractAnchors: exercisedAnchors,
        })
      } catch {
        projectionFailed = true
      }
      const author = input.author
        ?? (input.modelDeps === undefined
          ? async () => ({
              kind: 'fallback-required' as const,
              reason: 'no-model' as const,
            })
          : operations.buildCuratorAuthor(input.modelDeps))
      const drain = await operations.drainQueue({
        knowledgeRoot: input.knowledgeRoot,
        auditBaseDir: input.agentQaRoot,
        author,
        executionContext: input.handoff.executionContext,
        policy: input.policy,
        ...(input.authority === undefined ? {} : { lease: input.authority }),
        ...(budgetMs === undefined ? {} : { budgetMs }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      })
      curated = drain.committed
      deprecated = drain.deprecated ?? 0
      if (drain.kind === 'handed-off') {
        drainKind = 'handed-off'
        input.log.info?.(`curation: handed to daemon (pid ${drain.holder.pid})`)
      } else if (drain.kind === 'drained') {
        drainKind = 'drained'
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - tailStartedAtMs) / 1_000))
        input.log.info?.(`curation: drained inline (${elapsedSeconds}s)`)
      }
      // A commit noop is visible but never fatal (G-381-1): legitimate reasons such as
      // evidence-token dedup would otherwise wedge a healthy tail into the retry loop.
      // The complete predicate below is deliberately unchanged.
      if (drain.noops > 0) {
        // 381-47: the empty-delta cause renders inside the existing parenthetical;
        // the count-anchored prefix stays byte-identical for the ladder extractor.
        input.log.warn(
          `Knowledge curation drain produced ${drain.noops} commit noop(s) for ${receiptIdentity.runId}: ${drain.noopDetails
            .map((noop) =>
              `${noop.candidateId} (${noop.reason}${
                noop.emptyDeltaCause === undefined ? '' : `: ${noop.emptyDeltaCause}`
              })`)
            .join(', ')}.`,
        )
      }
      complete = candidates.refused === 0
        && candidates.capExceeded === 0
        && canaries.refused === 0
        && canaries.unresolved === 0
        && !projectionFailed
        && (drain.kind === 'drained' || drain.kind === 'handed-off')
        && drain.failures === 0
        && drain.requeued === 0
      if (complete && (drain.kind === 'drained' || drain.kind === 'handed-off')) {
        completedReceipt = {
          ...receiptIdentity,
          drainKind: drain.kind,
          handoffHolderPid: drain.kind === 'handed-off' ? drain.holder.pid : null,
          candidateIds: sortedCandidateIds(candidates),
        }
      }
      if (!complete) {
        incompleteDetails = [
          `candidate-refused=${candidates.refused}`,
          `candidate-cap-exceeded=${candidates.capExceeded}`,
          `canary-refused=${canaries.refused}`,
          `canary-unresolved=${canaries.unresolved}`,
          `projection-failed=${projectionFailed ? 1 : 0}`,
          `drain-kind=${drain.kind}`,
          `drain-failures=${drain.failures}`,
          `drain-requeued=${drain.requeued}`,
          `drain-noops=${drain.noops}`,
        ].join(', ')
      }
    },
  )

  if (!complete || completedReceipt === undefined) {
    input.log.warn(incompleteWarning(receiptIdentity.runId, incompleteDetails))
    return {
      curated,
      deprecated,
      complete: false,
      drainKind,
      ...(incompleteDetails === undefined ? {} : { incompleteDetails }),
    }
  }
  operations.writeCurationTailReceipt(input.runDir, completedReceipt)
  if (completedReceipt.drainKind === 'handed-off') {
    void operations.nudgeDaemon(
      input.agentQaRoot,
      { knowledgeRoot: input.knowledgeRoot },
    ).catch(() => undefined)
  }
  return { curated, deprecated, complete: true, drainKind }
}

/**
 * Run the post-verdict curation fold. The caller fixes its exit code before awaiting this function;
 * every failure is logged here and intentionally resolves so learning can never change the verdict.
 */
export async function runCurationTail(opts: RunCurationTailOptions): Promise<void> {
  const operations: CurationTailOperations = {
    ...defaultOperations(),
    ...opts.operations,
  }
  const currentRunDir = completedRunDir(opts.agentQaRoot, opts.runId)
  let currentHandoff: ReturnType<typeof loadCompletedRunHandoff>
  try {
    currentHandoff = operations.loadCompletedRunHandoff(
      join(currentRunDir, HANDOFF_FILE),
    )
  } catch {
    opts.log.warn(
      'Skipping post-verdict knowledge curation: the completed run handoff is missing or malformed.',
    )
    return
  }

  let knowledgeRoot: string
  let runDirs: string[]
  try {
    // Phase 374 deliberately left this composition seam unwired. The Curator tail is its first
    // runtime caller and resolves the validated repo-relative root exactly once at the boundary.
    knowledgeRoot = operations.resolveKnowledgeRoot(
      opts.knowledgeConfig,
      opts.configDir,
    )
    runDirs = [...new Set([
      ...operations.listCompletedRunDirs(opts.agentQaRoot),
      currentRunDir,
    ])].sort()
  } catch {
    opts.log.warn(incompleteWarning(String(currentHandoff.runId)))
    return
  }

  for (const runDir of runDirs) {
    let handoff: ReturnType<typeof loadCompletedRunHandoff>
    try {
      handoff = runDir === currentRunDir
        ? currentHandoff
        : operations.loadCompletedRunHandoff(join(runDir, HANDOFF_FILE))
    } catch {
      opts.log.warn(`Skipping post-verdict knowledge curation for ${runDir}: handoff is malformed.`)
      continue
    }

    const receiptIdentity = receiptIdentityForHandoff(handoff)
    try {
      if (receiptMatches(operations.readCurationTailReceipt(runDir), receiptIdentity)) continue
      const folded = await curateCompletedRun({
        runDir,
        handoff,
        knowledgeRoot,
        agentQaRoot: opts.agentQaRoot,
        auditSink: opts.auditSink,
        ...(opts.maskingContext === undefined ? {} : { maskingContext: opts.maskingContext }),
        policy: opts.policy,
        ...(opts.modelDeps === undefined ? {} : { modelDeps: opts.modelDeps }),
        ...(opts.authority === undefined ? {} : { authority: opts.authority }),
        ...(opts.deadlineMs === undefined ? {} : { deadlineMs: opts.deadlineMs }),
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
        log: opts.log,
        operations,
      })
      if (!folded.complete) {
        if (opts.signal?.aborted === true) return
        continue
      }
    } catch {
      opts.log.warn(incompleteWarning(receiptIdentity.runId))
      if (opts.signal?.aborted === true) return
    }
  }
}

export interface RunVerdictFirstCurationTailOptions {
  /** The complete verdict-derived process code, fixed before the tail begins. */
  exitCode: number
  detach: boolean
  /**
   * The durable hand-off, run BEFORE the detach short-circuit (388-02, D-03 / Pitfall 3).
   *
   * `--detach` means "do not spend this process on the work", not "do not record that the
   * work exists". The enqueue is the record; the drain is the spending. Putting it inside
   * `runTail` would have made a detached run the one posture that silently loses its
   * analysis, which is the opposite of what detaching asks for.
   */
  enqueue?(): Promise<void>
  runTail(): Promise<void>
  /** Defensive call-site boundary; runCurationTail itself already never rejects. */
  onUnexpectedError?(error: unknown): void
}

/** Await the optional tail without permitting it to replace the already-fixed verdict code. */
export async function runVerdictFirstCurationTail(
  opts: RunVerdictFirstCurationTailOptions,
): Promise<number> {
  if (opts.enqueue !== undefined) {
    try {
      await opts.enqueue()
    } catch (error) {
      opts.onUnexpectedError?.(error)
    }
  }
  if (opts.detach) return opts.exitCode
  try {
    await opts.runTail()
  } catch (error) {
    opts.onUnexpectedError?.(error)
  }
  return opts.exitCode
}
