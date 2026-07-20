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
  drainQueue,
  foldRunOutcomes,
  openKnowledgeReader,
  RUN_OUTCOMES_PROJECTION_VERSION,
  type OpenServingKnowledgeReaderConfig,
} from '@vostride/agent-qa-knowledge-local'
import type { KnowledgeHintReader } from '@vostride/agent-qa-runner'
import {
  HANDOFF_FILE,
  RUNS_SUBDIR,
  loadCompletedRunHandoff,
  slugBranch,
} from '@vostride/agent-qa-runner-local'
import type { AuditSink } from '@vostride/agent-qa-safety'
import { runSafetyScope } from '@vostride/agent-qa-safety-local'
import type {
  GuardrailPolicy,
  MaskingContext,
} from '@vostride/agent-qa-schema'
import { canonicalJson, sha256hex } from '@vostride/agent-qa-schema'

import {
  buildCuratorAuthor,
  type BuildCuratorAuthorDependencies,
} from './curator-author.js'
import { emitCanaryOutcomes } from './emit-canary-outcomes.js'
import { emitCurationCandidates } from './emit-candidates.js'
import { exercisedAnchors } from './handoff-anchors.js'

export const CURATION_TAIL_RECEIPT_FILE = 'curation-tail-receipt.json'
/**
 * v2 (381-05): the receipt gained the run-outcome projection component. v1 receipts fail
 * validation, so already-drained runs refold once — safe because every tail fold is
 * idempotent per runId. Never a second marker file (PATTERNS mandate).
 */
export const CURATION_TAIL_RECEIPT_SCHEMA_VERSION = 2

export interface CurationTailReceipt {
  schemaVersion: typeof CURATION_TAIL_RECEIPT_SCHEMA_VERSION
  runId: string
  handoffDigest: string
  /** Run-outcome projection component: a version bump refolds already-receipted runs. */
  projectionVersion: number
}

export type CurationTailModelDeps = Pick<
  BuildCuratorAuthorDependencies,
  'profile' | 'auth'
>

export interface CurationTailLogger {
  warn(message: string): void
}

export interface CurationTailOperations {
  loadCompletedRunHandoff: typeof loadCompletedRunHandoff
  resolveKnowledgeRoot: typeof resolveKnowledgeRoot
  runSafetyScope: typeof runSafetyScope
  emitCurationCandidates: typeof emitCurationCandidates
  openKnowledgeReader(config: OpenServingKnowledgeReaderConfig): KnowledgeHintReader
  emitCanaryOutcomes: typeof emitCanaryOutcomes
  foldRunOutcomes: typeof foldRunOutcomes
  buildCuratorAuthor: typeof buildCuratorAuthor
  drainQueue: typeof drainQueue
  listCompletedRunDirs(agentQaRoot: string): string[]
  readCurationTailReceipt(runDir: string): CurationTailReceipt | undefined
  writeCurationTailReceipt(runDir: string, receipt: CurationTailReceipt): void
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
  /** Focused test seam. Production callers omit it. */
  operations?: Partial<CurationTailOperations>
}

function defaultOperations(): CurationTailOperations {
  return {
    loadCompletedRunHandoff,
    resolveKnowledgeRoot,
    runSafetyScope,
    emitCurationCandidates,
    openKnowledgeReader,
    emitCanaryOutcomes,
    foldRunOutcomes,
    buildCuratorAuthor,
    drainQueue,
    listCompletedRunDirs,
    readCurationTailReceipt,
    writeCurationTailReceipt,
  }
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

function isCurationTailReceipt(value: unknown): value is CurationTailReceipt {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).sort().join(',')
    === 'handoffDigest,projectionVersion,runId,schemaVersion'
    && record.schemaVersion === CURATION_TAIL_RECEIPT_SCHEMA_VERSION
    && typeof record.runId === 'string'
    && record.runId.length > 0
    && typeof record.handoffDigest === 'string'
    && /^[0-9a-f]{64}$/u.test(record.handoffDigest)
    && typeof record.projectionVersion === 'number'
    && Number.isInteger(record.projectionVersion)
    && record.projectionVersion > 0
}

function readCurationTailReceipt(runDir: string): CurationTailReceipt | undefined {
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

function receiptForHandoff(handoff: { runId: unknown }): CurationTailReceipt {
  return {
    schemaVersion: CURATION_TAIL_RECEIPT_SCHEMA_VERSION,
    runId: String(handoff.runId),
    handoffDigest: curationTailHandoffDigest(handoff),
    projectionVersion: RUN_OUTCOMES_PROJECTION_VERSION,
  }
}

function receiptMatches(
  receipt: CurationTailReceipt | undefined,
  expected: CurationTailReceipt,
): boolean {
  return receipt?.schemaVersion === expected.schemaVersion
    && receipt.runId === expected.runId
    && receipt.handoffDigest === expected.handoffDigest
    && receipt.projectionVersion === expected.projectionVersion
}

function incompleteWarning(runId: string, details?: string): string {
  const diagnostic = details === undefined ? '' : ` (${details})`
  return `Post-verdict knowledge curation incomplete for ${runId}${diagnostic}; it will resume on the next run.`
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
  const currentRunDir = join(opts.agentQaRoot, RUNS_SUBDIR, slugBranch(opts.runId))
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

    const expectedReceipt = receiptForHandoff(handoff)
    try {
      if (receiptMatches(operations.readCurationTailReceipt(runDir), expectedReceipt)) continue
      let complete = false
      let incompleteDetails: string | undefined
      let projectionFailed = false
      await operations.runSafetyScope(
        {
          maskingContext: opts.maskingContext,
          auditSink: opts.auditSink,
          // SAFE-01: posture is persisted run truth, never an ambient re-detection.
          executionContext: handoff.executionContext,
        },
        async () => {
          const candidates = operations.emitCurationCandidates({
            handoff,
            runDir,
            knowledgeRoot,
            policy: opts.policy,
          })
          // D-20: candidate and canary drops share this scope and crash boundary.
          const reader = operations.openKnowledgeReader({ knowledgeRoot })
          const canaries = operations.emitCanaryOutcomes({
            handoff,
            knowledgeRoot,
            runDir,
            emit: reader.emitCanaryOutcome.bind(reader),
          })
          // D-14: the run-outcome fold shares this crash boundary and the SAME extended
          // receipt as candidate/canary emit — never a second marker file. The durable
          // handoff marker is the sole exclusion authority for current and sibling runs.
          // A fold failure is isolated (counted below) and never blocks the drain; the
          // withheld receipt refolds it on the next run, safe because the fold is idempotent.
          try {
            operations.foldRunOutcomes({
              knowledgeRoot,
              handoff,
              extractAnchors: exercisedAnchors,
            })
          } catch {
            projectionFailed = true
          }
          const author =
            opts.modelDeps === undefined
              ? async () => ({
                  kind: 'fallback-required' as const,
                  reason: 'no-model' as const,
                })
              : operations.buildCuratorAuthor(opts.modelDeps)
          const drain = await operations.drainQueue({
            knowledgeRoot,
            auditBaseDir: opts.agentQaRoot,
            author,
            executionContext: handoff.executionContext,
            policy: opts.policy,
            ...(opts.signal === undefined ? {} : { signal: opts.signal }),
          })
          // A commit noop is visible but never fatal (G-381-1): legitimate reasons such as
          // evidence-token dedup would otherwise wedge a healthy tail into the retry loop.
          // The complete predicate below is deliberately unchanged.
          if (drain.noops > 0) {
            opts.log.warn(
              `Knowledge curation drain produced ${drain.noops} commit noop(s) for ${expectedReceipt.runId}: ${drain.noopDetails
                .map((noop) => `${noop.candidateId} (${noop.reason})`)
                .join(', ')}.`,
            )
          }
          complete = candidates.refused === 0
            && candidates.capExceeded === 0
            && canaries.refused === 0
            && canaries.unresolved === 0
            && !projectionFailed
            && drain.kind === 'drained'
            && drain.failures === 0
            && drain.requeued === 0
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

      if (!complete) {
        opts.log.warn(incompleteWarning(expectedReceipt.runId, incompleteDetails))
        if (opts.signal?.aborted === true) return
        continue
      }
      operations.writeCurationTailReceipt(runDir, expectedReceipt)
    } catch {
      opts.log.warn(incompleteWarning(expectedReceipt.runId))
      if (opts.signal?.aborted === true) return
    }
  }
}

export interface RunVerdictFirstCurationTailOptions {
  /** The complete verdict-derived process code, fixed before the tail begins. */
  exitCode: number
  detach: boolean
  runTail(): Promise<void>
  /** Defensive call-site boundary; runCurationTail itself already never rejects. */
  onUnexpectedError?(error: unknown): void
}

/** Await the optional tail without permitting it to replace the already-fixed verdict code. */
export async function runVerdictFirstCurationTail(
  opts: RunVerdictFirstCurationTailOptions,
): Promise<number> {
  if (opts.detach) return opts.exitCode
  try {
    await opts.runTail()
  } catch (error) {
    opts.onUnexpectedError?.(error)
  }
  return opts.exitCode
}
