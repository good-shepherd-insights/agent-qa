// The agent job queue engine (Phase 385, D-05 / D-08 / D-17).
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
import type { JobKindDeclaration, JobKindRegistry } from './kind-registry.js'

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

/**
 * Thrown when a handler reports an outcome this build's driver does not yet dispatch.
 *
 * The handler contract is complete as of 385 plan 02 — a handler may already report
 * `retryable` or `permanent` — but what the driver DOES with such a report is bounded retry,
 * and that is the retry plan's to build. Refusing loudly here follows the same rule the store
 * follows for its declared-but-unimplemented verb: a driver that quietly treated a failure
 * report as a completion would mark the job `done`, and a job wrongly marked done is worse
 * than one that stops with a name attached.
 */
export class UndispatchedJobOutcomeError extends Error {
  override readonly name = 'UndispatchedJobOutcomeError'

  constructor(
    readonly jobKind: JobKind,
    readonly outcomeStatus: string,
  ) {
    super(
      `Agent job kind ${jobKind} reported outcome '${outcomeStatus}', which the phase-385 ` +
        'driver does not dispatch yet; the retry plan owns bounded retry and permanent ' +
        'failure. The report is legal — only its handling is unbuilt.',
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
}

export interface RunNextJobInput {
  readonly fence: JobStoreFence
}

export type RunNextJobOutcome =
  | { readonly ran: false; readonly reason: 'no-job' }
  | {
      readonly ran: true
      readonly job: Job
      readonly checkpointsPublished: readonly string[]
    }

export interface AgentJobQueue {
  /**
   * Enqueue one job. The key is MANDATORY and there is no keyless overload — dedupe has to
   * be impossible to opt out of, or "running the tail twice produces one job" degrades from
   * a guarantee into a habit.
   */
  enqueue(kind: JobKind, payload: unknown, idempotencyKey: string): Promise<JobEnqueueOutcome>

  /** Claim, run, checkpoint and complete exactly one job. Returns when that job is done. */
  runNextJob(input: RunNextJobInput): Promise<RunNextJobOutcome>
}

/** The summary a job carries when its caller supplied none. Deterministic on purpose. */
function defaultSummary(kind: JobKind, idempotencyKey: string): string {
  return `agent job ${kind} (${idempotencyKey})`
}

export function createAgentJobQueue(options: CreateAgentJobQueueOptions): AgentJobQueue {
  const { store, registry, clock, idSource } = options

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

  return {
    async enqueue(kind, payload, idempotencyKey) {
      return store.enqueue(requestFor(kind, payload, idempotencyKey))
    },

    async runNextJob({ fence }) {
      const claim = await store.claimNext(fence)
      if (!claim.claimed) {
        return { ran: false, reason: 'no-job' }
      }

      const job = claim.job
      const declaration = registry.require(job.kind)
      const published: string[] = []

      const outcome = await declaration.handler({
        job,
        publishCheckpoint: async (checkpointId, value) => {
          if (!declaration.checkpointed) {
            throw new UndeclaredJobCheckpointError(job.kind, checkpointId)
          }
          if (!declaration.checkpointSchedule.includes(checkpointId)) {
            throw new UndeclaredJobCheckpointError(job.kind, checkpointId)
          }
          const record: JobCheckpointRecord = {
            checkpointId,
            jobId: job.id,
            attempt: job.attempts,
            recordedAt: clock.now(),
            value,
          }
          await store.publishCheckpoint(job.id, checkpointId, record, fence)
          published.push(checkpointId)
        },
      })

      // The discriminant is READ, not merely accepted. A driver that ignored it and reached
      // for `next` would complete a job whose handler had just said it failed, and the row
      // would read `done` forever after with nothing recording that anything went wrong.
      if (outcome.status !== 'complete') {
        throw new UndispatchedJobOutcomeError(job.kind, outcome.status)
      }

      const completed = await store.completeAndChain(
        job.id,
        successorRequests(declaration, outcome.next),
        fence,
      )

      return { ran: true, job: completed.job, checkpointsPublished: published }
    },
  }
}
