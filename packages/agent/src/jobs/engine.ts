// The agent job queue engine (Phase 385, D-05 / D-08 / D-17 / D-18 / D-20).
//
// Pure semantics. This package is storageNeutral, so nothing here touches a host API: every
// byte the engine causes to exist crosses `JobStorePort`. The driver is a PUMPABLE function
// — `runNextJob` does one job and returns — never a loop with timers. Phase 385 ships no
// production dispatcher at all; the first real host arrives with the daemon, and a driver
// that owned its own scheduling would have to be taken apart again to let that host own it.
//
// All engine-visible time comes from the injected clock. A single ambient timestamp here
// would make the deterministic dump the crash matrix compares differ for reasons that have
// nothing to do with correctness (D-03), and the usual repair for a flaky equality
// assertion is to loosen it — which would quietly retire the proof.

import type { ChainedJobRequest, Job, JobId, JobKind } from '@vostride/agent-qa-schema'

import type { ClockPort } from '../ports/clock.js'
import type {
  JobEnqueueOutcome,
  JobInsert,
  JobStoreFence,
  JobStorePort,
} from '../ports/job-store.js'
import type {
  JobBackoffPolicy,
  JobKindDeclaration,
  JobKindRegistry,
} from './kind-registry.js'
import { recordLlmAuthorship } from './record-llm-authorship.js'
import type {
  JobAuthorCallback,
  JobCheckpointContext,
  JobModelCapability,
} from './record-llm-authorship.js'

/**
 * Where job ids come from.
 *
 * Injected rather than generated, and derived from `(kind, idempotencyKey)` rather than
 * random, so the same logical job carries the same id in every process and across a replay.
 * A random id would make two dumps of the same history unequal by construction.
 */
export interface JobIdSource {
  jobIdFor(kind: JobKind, idempotencyKey: string): JobId
}

/**
 * The semantic unit a checkpoint records. The engine owns THIS; the store owns the bytes
 * and their durability envelope. Splitting the two is what keeps "what a checkpoint means"
 * out of the storage implementation and "how it survives a crash" out of the engine.
 */
export interface JobCheckpointRecord {
  readonly checkpointId: string
  readonly jobId: JobId
  readonly attempt: number
  readonly recordedAt: string
  readonly value: unknown
}

/**
 * Thrown when an enqueue arrives without a usable idempotency key (D-08).
 *
 * The type already requires the argument; this covers the empty string, which types cannot
 * exclude and which would silently collapse every keyless caller onto one queue slot.
 */
export class MissingIdempotencyKeyError extends Error {
  override readonly name = 'MissingIdempotencyKeyError'

  constructor(readonly jobKind: JobKind) {
    super(
      `An agent job of kind ${jobKind} was enqueued without an idempotency key. Every ` +
        'enqueue needs one: dedupe is a store guarantee resting on the (kind, key) unique ' +
        'index, and an empty key would collapse unrelated jobs onto a single slot.',
    )
  }
}

/** Thrown when a handler asks to chain to a successor its kind never declared (D-17). */
export class UndeclaredJobSuccessorError extends Error {
  override readonly name = 'UndeclaredJobSuccessorError'

  constructor(
    readonly jobKind: JobKind,
    readonly successorKind: JobKind,
  ) {
    super(
      `Agent job kind ${jobKind} may not chain to ${successorKind}: the successor is not ` +
        'in its declared topology. The declared set is the auditable one, so a chain that ' +
        'only exists inside a handler body must not be reachable.',
    )
  }
}

/** Thrown when a handler publishes a checkpoint its kind never declared. */
export class UndeclaredJobCheckpointError extends Error {
  override readonly name = 'UndeclaredJobCheckpointError'

  constructor(
    readonly jobKind: JobKind,
    readonly checkpointId: string,
  ) {
    super(
      `Agent job kind ${jobKind} may not publish checkpoint ${checkpointId}: it is not on ` +
        "the kind's declared checkpoint schedule. Recovery is planned from the declared " +
        'schedule, so a checkpoint outside it is state nothing would ever resume from.',
    )
  }
}

export interface CreateAgentJobQueueOptions {
  readonly store: JobStorePort
  readonly registry: JobKindRegistry
  readonly clock: ClockPort
  readonly idSource: JobIdSource
  /**
   * The model a job may author with, bound by the composition root (D-10).
   *
   * REQUIRED, and deliberately not defaultable. An optional capability would mean a queue
   * could be built with none, and the only sensible behaviour for an author callback that
   * cannot reach a model is to fail somewhere far from the composition that forgot it. Making
   * it an argument of construction puts that decision where the binding is made. The engine
   * never calls it: the only thing that happens to this value is that the authorship
   * primitive hands it to an author callback.
   */
  readonly model: JobModelCapability
}

export interface RunNextJobInput {
  readonly fence: JobStoreFence
}

/** Facts every ran outcome carries, whatever the job's disposition turned out to be. */
export interface RanJobOutcomeBase {
  readonly ran: true
  /** The job AS CLAIMED. The store owns what its row says afterwards. */
  readonly job: Job
  readonly checkpointsPublished: readonly string[]
  /**
   * `false` in exactly one case: the attempt bound was already spent when the job was
   * claimed, so the driver failed it without handing it to its handler (D-18).
   */
  readonly handlerInvoked: boolean
}

export type RunNextJobOutcome =
  | { readonly ran: false; readonly reason: 'no-job' }
  | (RanJobOutcomeBase & {
      readonly disposition: 'completed'
      readonly chained: readonly JobEnqueueOutcome[]
    })
  | (RanJobOutcomeBase & {
      readonly disposition: 'retry-scheduled'
      readonly reason: string
      /**
       * How long a host should wait before pumping this job again, computed from the kind's
       * declared backoff policy and the attempt just spent.
       *
       * Returned rather than applied: 385 ships no dispatcher, and a driver that slept on its
       * own would be the timer loop this engine deliberately is not. It is also why no
       * not-before TIMESTAMP is computed — that would mean doing arithmetic on the injected
       * clock's string and storing a scheduling column no store has, and a value nothing
       * reads is a value nothing keeps honest.
       */
      readonly retryDelayMs: number
      readonly attemptsRemaining: number
    })
  | (RanJobOutcomeBase & {
      readonly disposition: 'failed'
      readonly reason: string
      /** What the kind's declared disposition enqueued — empty for a halt-chain kind. */
      readonly continuation: readonly JobEnqueueOutcome[]
    })

export interface RecoverAbandonedClaimsInput {
  readonly fence: JobStoreFence
}

export interface RecoverAbandonedClaimsOutcome {
  readonly released: readonly JobId[]
}

export interface AgentJobQueue {
  /**
   * Enqueue one job. The key is MANDATORY and there is no keyless overload — dedupe has to
   * be impossible to opt out of, or "running the tail twice produces one job" degrades from
   * a guarantee into a habit.
   */
  enqueue(kind: JobKind, payload: unknown, idempotencyKey: string): Promise<JobEnqueueOutcome>

  /** Claim, run, checkpoint and dispose of exactly one job. Returns when that job is done. */
  runNextJob(input: RunNextJobInput): Promise<RunNextJobOutcome>

  /**
   * Return every outstanding claim to the queue, keeping the attempt each one spent.
   *
   * A host that dies while holding a job leaves its row claimed and nothing reaps it, so
   * without this the bound above is unreachable for exactly the job it exists to stop: a
   * poison job would sit claimed forever instead of exhausting its attempts and failing. The
   * attempt is deliberately NOT refunded — that is what makes the bound survive a crash.
   *
   * Call it after adopting authority and BEFORE pumping. Only one process may drain under a
   * given fence, so at that moment every outstanding claim belongs to a host that is gone;
   * calling it beside a live pump would take a job away from the handler still running it.
   */
  recoverAbandonedClaims(
    input: RecoverAbandonedClaimsInput,
  ): Promise<RecoverAbandonedClaimsOutcome>
}

/**
 * The delay a host should wait after spending `attempt`, per the kind's declared policy.
 *
 * A pure function of the policy and the attempt number — no clock is read here and none can
 * be, which is what keeps a kind's retry behaviour describable without running it.
 */
function retryDelayMs(policy: JobBackoffPolicy, attempt: number): number {
  if (policy.kind === 'none') return 0
  if (policy.kind === 'fixed') return policy.delayMs
  const grown = policy.initialDelayMs * policy.factor ** Math.max(0, attempt - 1)
  return Math.min(grown, policy.maxDelayMs)
}

/** The summary a job carries when its caller supplied none. Deterministic on purpose. */
function defaultSummary(kind: JobKind, idempotencyKey: string): string {
  return `agent job ${kind} (${idempotencyKey})`
}

/**
 * The VALUE inside a checkpoint the engine wrote, or the payload itself if something else
 * wrote it.
 *
 * The engine wraps every checkpoint in its own envelope, so the authorship primitive would
 * otherwise return an envelope on resume and a bare value on the first pass — the same call
 * answering two different shapes depending on whether the process had crashed. The envelope is
 * recognised by carrying both of the fields only the engine puts there, so an authored value
 * that happens to have a `value` key of its own is not mistaken for one.
 */
function recordedValueOf(payload: unknown): unknown {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'checkpointId' in payload &&
    'value' in payload
  ) {
    return (payload as JobCheckpointRecord).value
  }
  return payload
}

export function createAgentJobQueue(options: CreateAgentJobQueueOptions): AgentJobQueue {
  const { store, registry, clock, idSource, model } = options

  function requestFor(kind: JobKind, payload: unknown, idempotencyKey: string): JobInsert {
    // An undeclared kind is refused before anything is written: the store would happily
    // hold a row no handler can ever pick up, and that row is indistinguishable from a
    // stuck job forever after.
    registry.require(kind)
    if (idempotencyKey.trim() === '') {
      throw new MissingIdempotencyKeyError(kind)
    }
    return {
      id: idSource.jobIdFor(kind, idempotencyKey),
      kind,
      idempotencyKey,
      summary: defaultSummary(kind, idempotencyKey),
      payload,
    }
  }

  function successorRequests(
    declaration: JobKindDeclaration,
    next: readonly ChainedJobRequest[],
  ): JobInsert[] {
    return next.map((successor) => {
      if (!declaration.allowedSuccessors.includes(successor.kind)) {
        throw new UndeclaredJobSuccessorError(declaration.kind, successor.kind)
      }
      return requestFor(successor.kind, successor.payload, successor.idempotencyKey)
    })
  }

  /**
   * Land one job permanently, running whatever continuation its kind declared (D-20).
   *
   * ORDER MATTERS, and it is continuation-then-record on purpose. A host that dies between
   * the two leaves the job claimed rather than failed, so a later attempt re-runs the
   * disposition — and the second run of the producer enqueues the same instances under the
   * same keys, which the store merges into the rows already there. Recording the failure
   * first would make the job terminal with its continuation half-written and nothing left to
   * finish it, which is precisely the dead head this disposition exists to prevent.
   */
  async function failPermanently(input: {
    readonly job: Job
    readonly payload: unknown
    readonly declaration: JobKindDeclaration
    readonly reason: string
    readonly handlerInvoked: boolean
    readonly published: readonly string[]
    readonly fence: JobStoreFence
  }): Promise<RunNextJobOutcome> {
    const { job, declaration, reason, fence } = input
    const requests =
      declaration.onPermanentFailure === 'halt-chain'
        ? []
        : declaration.onPermanentFailure({ job, payload: input.payload, reason })

    // Validated before a single store call: an undeclared continuation is a wrong
    // declaration, and half of one already enqueued is worse than none.
    const inserts = successorRequests(declaration, requests)

    const continuation: JobEnqueueOutcome[] = []
    for (const insert of inserts) {
      continuation.push(await store.enqueue(insert))
    }
    await store.recordFailure(job.id, { kind: 'permanent', reason }, fence)

    return {
      ran: true,
      disposition: 'failed',
      job,
      checkpointsPublished: input.published,
      handlerInvoked: input.handlerInvoked,
      reason,
      continuation,
    }
  }

  return {
    async enqueue(kind, payload, idempotencyKey) {
      return store.enqueue(requestFor(kind, payload, idempotencyKey))
    },

    async recoverAbandonedClaims({ fence }) {
      const dump = await store.dumpState()
      const released: JobId[] = []
      for (const row of dump.jobs) {
        if (!row.claimed) continue
        const jobId = row.id as JobId
        await store.recordFailure(
          jobId,
          { kind: 'retry', reason: 'the claim was abandoned by a host that did not finish it' },
          fence,
        )
        released.push(jobId)
      }
      return { released }
    },

    async runNextJob({ fence }) {
      const claim = await store.claimNext(fence)
      if (!claim.claimed) {
        return { ran: false, reason: 'no-job' }
      }

      const job = claim.job
      const declaration = registry.require(job.kind)
      const published: string[] = []

      // D-18's bound, enforced HERE — on the claim, which is the one point a job that kills
      // its host cannot skip. Checked only when recording a failure it would never fire for a
      // handler that never returns, and that handler is exactly the one the bound is for. The
      // attempt was already spent by the claim, so a job arriving with more attempts than its
      // kind permits has had every attempt it was owed.
      if (job.attempts > declaration.maxAttempts) {
        return failPermanently({
          job,
          payload: claim.payload,
          declaration,
          reason:
            `the attempt bound of ${declaration.maxAttempts} is spent (this claim is attempt ` +
            `${job.attempts}), so this job is given up on without being run again`,
          handlerInvoked: false,
          published,
          fence,
        })
      }

      // One gate for both directions. Recovery is planned from the declared schedule, so an
      // id outside it is state nothing would ever resume from — whether a handler is writing
      // it or an authorship primitive is looking for it.
      const requireDeclaredCheckpoint = (checkpointId: string): void => {
        if (!declaration.checkpointed || !declaration.checkpointSchedule.includes(checkpointId)) {
          throw new UndeclaredJobCheckpointError(job.kind, checkpointId)
        }
      }

      const publish = async (checkpointId: string, value: unknown): Promise<void> => {
        requireDeclaredCheckpoint(checkpointId)
        const record: JobCheckpointRecord = {
          checkpointId,
          jobId: job.id,
          attempt: job.attempts,
          recordedAt: clock.now(),
          value,
        }
        await store.publishCheckpoint(job.id, checkpointId, record, fence)
        published.push(checkpointId)
      }

      // The context that carries the model. It is built here and handed to the authorship
      // primitive; it is NOT part of what the handler receives, which is the structural half
      // of "a job has no ambient model accessor" (D-11 layer 2).
      const checkpointContext: JobCheckpointContext = {
        jobId: job.id,
        model,
        async readRecordedValue(checkpointId) {
          requireDeclaredCheckpoint(checkpointId)
          const recorded = await store.readCheckpoint(job.id, checkpointId)
          return recorded.found
            ? { recorded: true, value: recordedValueOf(recorded.payload) }
            : { recorded: false }
        },
        publishCheckpoint: publish,
      }

      const outcome = await declaration.handler({
        job,
        payload: claim.payload,
        publishCheckpoint: publish,
        recordLlmAuthorship: async <T>(
          checkpointId: string,
          author: JobAuthorCallback<T>,
        ): Promise<T> => recordLlmAuthorship(checkpointContext, checkpointId, author),
      })

      // The discriminant is READ, not merely accepted. A driver that ignored it and reached
      // for `next` would complete a job whose handler had just said it failed, and the row
      // would read `done` forever after with nothing recording that anything went wrong.
      if (outcome.status === 'complete') {
        const completed = await store.completeAndChain(
          job.id,
          successorRequests(declaration, outcome.next),
          fence,
        )
        return {
          ran: true,
          disposition: 'completed',
          job: completed.job,
          checkpointsPublished: published,
          handlerInvoked: true,
          chained: completed.chained,
        }
      }

      // A retryable REPORT on the last permitted attempt becomes a permanent DECISION: the
      // handler says the thing that went wrong could go right next time, and only the engine
      // knows there is no next time. That asymmetry is why the report and the decision are
      // two types rather than one.
      if (outcome.status === 'retryable' && job.attempts < declaration.maxAttempts) {
        await store.recordFailure(job.id, { kind: 'retry', reason: outcome.reason }, fence)
        return {
          ran: true,
          disposition: 'retry-scheduled',
          job,
          checkpointsPublished: published,
          handlerInvoked: true,
          reason: outcome.reason,
          retryDelayMs: retryDelayMs(declaration.backoff, job.attempts),
          attemptsRemaining: declaration.maxAttempts - job.attempts,
        }
      }

      // Either the handler said the failure is permanent — which skips every remaining
      // attempt, because retrying something that cannot succeed only spends the bound — or it
      // said retryable on the attempt that used the bound up.
      return failPermanently({
        job,
        payload: claim.payload,
        declaration,
        reason: outcome.reason,
        handlerInvoked: true,
        published,
        fence,
      })
    },
  }
}
