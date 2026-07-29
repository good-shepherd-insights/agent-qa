// The six real agent job kinds (Phase 385, D-09 / D-17 / D-18 / D-20).
//
// The kind set is closed and shipped, and this module declares every member of it. The
// declarations are the CONTRACT this phase ships; the handler bodies are deterministic
// stand-ins, and the two are not the same kind of thing. Real semantics for analyze-run and
// curate-memory arrive with the phases that own them — what has to exist now is a complete,
// registry-driven description of how each kind checkpoints, chains, retries and gives up,
// because the crash matrix iterates THAT rather than a list of its own.
//
// The stand-ins are scripted by payload, in the style of the v51 drain fixture's scripted
// author: a handler publishes its own declared schedule with its own bytes and then does
// exactly what the payload asked for. That matters for two separate reasons. Distinguishable
// bytes mean a matrix comparing six recovered histories is comparing six different things
// rather than six copies of one. Scriptable outcomes mean the adversarial legs — a chain, a
// retryable report, a permanent one — can be driven through the REAL kinds instead of through
// a synthetic stand-in that a later refactor could leave behind.
//
// Deliberately absent from every published byte: the attempt number and any timestamp. A
// checkpoint whose bytes changed with the attempt that wrote it would make an interrupted
// history differ from an uninterrupted one for a reason that has nothing to do with recovery,
// and the usual repair for a failing equality assertion is to loosen it.

import type { ChainedJobRequest, JobKind } from '@vostride/agent-qa-schema'

import { createJobKindRegistry } from './kind-registry.js'
import type {
  FallbackContinuationInput,
  JobHandler,
  JobKindDeclaration,
  JobKindRegistry,
} from './kind-registry.js'

/**
 * What a stand-in handler will do, as read off the payload it was handed.
 *
 * Every field is optional and an absent field means the ordinary path, so a caller that knows
 * nothing about this module gets a job that publishes its schedule and completes.
 */
export interface StandInJobScript {
  /** Chain to every successor the kind declares. */
  readonly chain?: boolean
  /** Report a failure instead of completing. */
  readonly fail?: 'retryable' | 'permanent'
  readonly reason?: string
}

function readScript(payload: unknown): StandInJobScript {
  if (typeof payload !== 'object' || payload === null) return {}
  const record = payload as Record<string, unknown>
  const fail = record.fail === 'retryable' || record.fail === 'permanent' ? record.fail : undefined
  return {
    chain: record.chain === true,
    fail,
    reason: typeof record.reason === 'string' ? record.reason : undefined,
  }
}

/**
 * The successor instances a kind produces, derived from the predecessor's id.
 *
 * The key is derived rather than minted so the same logical continuation carries the same key
 * in every process and on every replay — which is what makes re-running a chain after a crash
 * a dedupe instead of a second job.
 */
function successorsOf(
  declaration: Pick<JobKindDeclaration, 'kind' | 'allowedSuccessors'>,
  jobId: string,
  extra: Record<string, unknown> = {},
): readonly ChainedJobRequest[] {
  return declaration.allowedSuccessors.map((successor) => ({
    kind: successor,
    payload: { from: declaration.kind, predecessor: jobId, ...extra },
    idempotencyKey: `${jobId}->${successor}`,
  }))
}

function standInHandler(
  kind: JobKind,
  checkpointSchedule: readonly string[],
  allowedSuccessors: readonly JobKind[],
): JobHandler {
  return async (context) => {
    const script = readScript(context.payload)
    let step = 0
    for (const checkpointId of checkpointSchedule) {
      await context.publishCheckpoint(checkpointId, {
        kind,
        checkpointId,
        step,
        jobId: String(context.job.id),
      })
      step += 1
    }
    if (script.fail !== undefined) {
      return { status: script.fail, reason: script.reason ?? `${kind} stand-in scripted failure` }
    }
    return {
      status: 'complete',
      next: script.chain === true ? [...successorsOf({ kind, allowedSuccessors }, String(context.job.id))] : [],
    }
  }
}

/**
 * analyze-run's ratified disposition: the chain proceeds with unknown verdicts (spec §1.2).
 *
 * Its downstream jobs must never wait on a dead head, so a permanently failed analysis hands
 * them the same successors a successful one would, marked as carrying no verdicts. Nothing
 * here reaches a model, and nothing here can: what it is given is the failed job, the payload
 * that job was handed, and the reason.
 */
function analyzeRunFallback(input: FallbackContinuationInput): readonly ChainedJobRequest[] {
  return successorsOf(
    { kind: 'analyze-run', allowedSuccessors: ANALYZE_RUN_SUCCESSORS },
    String(input.job.id),
    { verdicts: 'unknown', failureReason: input.reason },
  )
}

const ANALYZE_RUN_SUCCESSORS: readonly JobKind[] = ['curate-memory', 'triage-issues']

/**
 * Every kind, keyed by itself.
 *
 * `satisfies Record<JobKind, JobKindDeclaration>` is the compile-time half of D-09's
 * completeness: a seventh kind added to the shipped vocabulary fails to typecheck here until
 * it is declared. The registry-driven conformance test is the runtime half, and the two catch
 * different drifts — a missing entry versus an entry whose own `kind` field disagrees with
 * the slot it sits in.
 */
const DECLARATIONS = {
  // JOBQ-04 / C9. Chat is NOT a checkpointed job and never becomes one: its state of record
  // is the append-only session log, and the queue's checkpoint discipline covers background
  // work only. One attempt, because there is no durable progress for a second one to resume.
  chat: {
    kind: 'chat',
    checkpointed: false,
    checkpointSchedule: [],
    allowedSuccessors: [],
    maxAttempts: 1,
    backoff: { kind: 'none' },
    onPermanentFailure: 'halt-chain',
    handler: standInHandler('chat', [], []),
  },

  // The chain's head. Its verdicts feed curate-memory and triage-issues in parallel, so both
  // are declared successors, and its permanent failure proceeds with unknown verdicts.
  'analyze-run': {
    kind: 'analyze-run',
    checkpointed: true,
    checkpointSchedule: ['verdicts-authored'],
    allowedSuccessors: ANALYZE_RUN_SUCCESSORS,
    maxAttempts: 3,
    backoff: { kind: 'exponential', initialDelayMs: 1_000, factor: 2, maxDelayMs: 30_000 },
    onPermanentFailure: analyzeRunFallback,
    handler: standInHandler('analyze-run', ['verdicts-authored'], ANALYZE_RUN_SUCCESSORS),
  },

  // Two checkpoints, mirroring the v51 curation lifecycle: candidates are authored, then the
  // bundle is committed. The second is the one whose recovery actually matters.
  'curate-memory': {
    kind: 'curate-memory',
    checkpointed: true,
    checkpointSchedule: ['candidates-authored', 'bundle-committed'],
    allowedSuccessors: [],
    maxAttempts: 3,
    backoff: { kind: 'exponential', initialDelayMs: 1_000, factor: 2, maxDelayMs: 30_000 },
    onPermanentFailure: 'halt-chain',
    handler: standInHandler('curate-memory', ['candidates-authored', 'bundle-committed'], []),
  },

  'triage-issues': {
    kind: 'triage-issues',
    checkpointed: true,
    checkpointSchedule: ['issues-drafted'],
    allowedSuccessors: [],
    maxAttempts: 2,
    backoff: { kind: 'fixed', delayMs: 5_000 },
    onPermanentFailure: 'halt-chain',
    handler: standInHandler('triage-issues', ['issues-drafted'], []),
  },

  consolidate: {
    kind: 'consolidate',
    checkpointed: true,
    checkpointSchedule: ['consolidation-authored'],
    allowedSuccessors: [],
    maxAttempts: 2,
    backoff: { kind: 'fixed', delayMs: 5_000 },
    onPermanentFailure: 'halt-chain',
    handler: standInHandler('consolidate', ['consolidation-authored'], []),
  },

  'propose-improvements': {
    kind: 'propose-improvements',
    checkpointed: true,
    checkpointSchedule: ['proposals-authored'],
    allowedSuccessors: [],
    maxAttempts: 2,
    backoff: { kind: 'fixed', delayMs: 5_000 },
    onPermanentFailure: 'halt-chain',
    handler: standInHandler('propose-improvements', ['proposals-authored'], []),
  },
} satisfies Record<JobKind, JobKindDeclaration>

/** The six declarations as a list, in the order the kind vocabulary declares them. */
export const REAL_JOB_KIND_DECLARATIONS: readonly JobKindDeclaration[] = Object.freeze(
  Object.values(DECLARATIONS) as readonly JobKindDeclaration[],
)

/**
 * A registry over exactly the six real kinds.
 *
 * A fresh registry per call rather than a module-level singleton: a registry is a small,
 * cheap value, and one shared instance is how a test that registers something extra ends up
 * changing what every other test in the process sees.
 */
export function createRealJobKindRegistry(): JobKindRegistry {
  return createJobKindRegistry(REAL_JOB_KIND_DECLARATIONS)
}
