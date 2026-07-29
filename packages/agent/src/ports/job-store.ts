// The agent job queue's store port (Phase 385, D-05 / D-06 / D-07).
//
// This port is deliberately NOT generic CRUD. `PersistencePort`'s `saveJob`/`getJob` shape
// let a caller express any interleaving it liked and left atomicity to review; here every
// verb is ONE store transaction with a name for what it means, so a wrong interleaving is
// not a bug the reviewer has to catch — it is a sentence the type surface cannot form
// (D-05). The engine keeps policy (what may chain, how many attempts); the store keeps
// atomicity. Every verb is promise-returning so a store may be asynchronous, even though
// the phase-385 implementation happens to be synchronous underneath.
//
// FENCING (D-07). Every DRAIN-side verb — the ones only the process currently entitled to
// drain the queue may call — takes a `JobStoreFence` and the store re-reads the recorded
// epoch INSIDE the same transaction before mutating. The fence is present from birth rather
// than added when the second writer arrives in 386, because retrofitting it onto a live
// unfenced port means redesigning the commit boundary while split-brain is already possible.
//
// `enqueue` is fence-FREE, and that is the resolution of the D-02/D-07 tension rather than
// an oversight: D-02 says any process may enqueue directly against the database, so an
// enqueue fence would be a token no enqueuer could hold. Enqueue needs no authority because
// it arbitrates on data instead — the `(kind, idempotencyKey)` unique index makes a losing
// concurrent enqueue a dedupe, not a conflict (D-08). Authority is only ever needed to
// CLAIM or ADVANCE work, which is exactly the set of verbs that carries the fence.

import type { Job, JobEnqueueRequest, JobId } from '@vostride/agent-qa-schema'

/**
 * The authority token a drain-side verb must present.
 *
 * Deliberately a plain epoch record, not an opaque handle: 386 binds the v51 writer lease
 * as its source, and that lease's authority already IS an integer epoch on disk.
 */
export interface JobStoreFence {
  readonly epoch: number
}

/**
 * Refusal at the mutation boundary, mirroring v51's `WriterAuthorityLostError` shape: a
 * named class carrying both the epoch the caller held and the epoch the store observed, so
 * a log line says which writer was behind and by how much.
 */
export class StaleJobStoreEpochError extends Error {
  override readonly name = 'StaleJobStoreEpochError'

  constructor(
    readonly heldEpoch: number,
    readonly observedEpoch: number,
  ) {
    super(
      `agent job store authority lost; held epoch ${heldEpoch}, observed ${observedEpoch}`,
    )
  }
}

/**
 * One job row to insert: a caller's `JobEnqueueRequest` plus what the engine resolved for it.
 *
 * 385 plan 02 split this from the request DTO rather than duplicating it. The request is the
 * three facts a CALLER knows; the two fields added here are derived at the engine boundary
 * and belong to nobody else. The id is derived from `(kind, idempotencyKey)` through an
 * injected id source, so the same logical job carries the same id in every process and in
 * every replay (D-03 corollary) — a store that minted its own would break that, and a caller
 * that supplied its own could break it twice. Timestamps are absent on purpose: the store
 * stamps them from ITS injected clock, so no SQL-side default can leak host time into a dump.
 *
 * There is no separate "chained enqueue" type. A successor differs from a root job in who
 * asked for it, not in what it is, and the difference that does matter — a successor is
 * inserted inside its predecessor's transaction — is expressed by the verb it arrives at.
 */
export interface JobInsert extends JobEnqueueRequest {
  readonly id: JobId
  readonly summary: string
}

/**
 * The result of an enqueue.
 *
 * `deduped` reports that the unique index already held this `(kind, idempotencyKey)` pair
 * and `job` is the pre-existing row. A duplicate enqueue is a SUCCESS, never an error —
 * that is what makes "run the tail twice, get one job" a store guarantee rather than a
 * convention every caller has to remember (D-08).
 */
export interface JobEnqueueOutcome {
  readonly job: Job
  readonly deduped: boolean
}

/** An empty queue is an ordinary outcome, not an exception. */
export type JobClaimOutcome =
  | { readonly claimed: false }
  | { readonly claimed: true; readonly job: Job }

export interface JobCompleteOutcome {
  readonly job: Job
  readonly chained: readonly JobEnqueueOutcome[]
}

/**
 * How a failed attempt should be disposed of. Behaviour lands with the retry plan.
 *
 * This is NOT a second spelling of the handler's `JobHandlerOutcome`, and the two are kept
 * apart deliberately (385 plan 02). The handler REPORTS whether the thing that went wrong
 * could go right next time; the engine DECIDES what to record, and only the engine knows how
 * many attempts remain. A retryable report on the last permitted attempt becomes a permanent
 * disposition here — which is exactly the bound D-18 puts on retries, and it would have
 * nowhere to live if the report and the decision were one type.
 */
export type JobFailureDisposition =
  | { readonly kind: 'retry'; readonly reason: string }
  | { readonly kind: 'permanent'; readonly reason: string }

export type JobCheckpointReadOutcome =
  | { readonly found: false }
  | { readonly found: true; readonly payload: unknown }

/** One row of the deterministic logical dump (D-03). Column names, not the DTO shape. */
export interface JobStoreDumpRow {
  readonly id: string
  readonly kind: string
  readonly idempotencyKey: string
  readonly status: string
  readonly summary: string
  readonly payload: unknown
  readonly attempts: number
  readonly claimed: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * A deterministic, ordered, canonical-JSON-comparable projection of everything the store
 * holds. The kill matrix compares THIS across an interrupted and an uninterrupted history —
 * never raw database bytes, whose page layout is not deterministic (D-03).
 */
export interface JobStoreDump {
  readonly schemaVersion: number
  readonly epoch: number
  readonly jobs: readonly JobStoreDumpRow[]
}

export interface JobStorePort {
  /**
   * Record `epoch` as the authority that may now drain, and hand back the fence proving it.
   * Adopting an epoch BELOW the recorded one is refused: authority only moves forward.
   */
  adoptEpoch(epoch: number): Promise<JobStoreFence>

  /** Fence-free by design — see the D-02/D-07 note at the top of this module. */
  enqueue(request: JobInsert): Promise<JobEnqueueOutcome>

  claimNext(fence: JobStoreFence): Promise<JobClaimOutcome>

  /**
   * Terminate one job and enqueue its declared successors in the SAME transaction. Two
   * verbs would leave a window where a crash loses the chain; one verb has no window.
   */
  completeAndChain(
    jobId: JobId,
    next: readonly JobInsert[],
    fence: JobStoreFence,
  ): Promise<JobCompleteOutcome>

  recordFailure(
    jobId: JobId,
    disposition: JobFailureDisposition,
    fence: JobStoreFence,
  ): Promise<void>

  /**
   * Durably publish one checkpoint. Under the hybrid split (D-01) the lifecycle row lives
   * in sqlite and the checkpoint body is a file, so this verb is the seam where the two
   * media meet and the only place their ordering is decided.
   */
  publishCheckpoint(
    jobId: JobId,
    checkpointId: string,
    payload: unknown,
    fence: JobStoreFence,
  ): Promise<void>

  /** Read-side: no fence, because reading claims no authority. */
  readCheckpoint(jobId: JobId, checkpointId: string): Promise<JobCheckpointReadOutcome>

  dumpState(): Promise<JobStoreDump>
}
