// The agent job queue's durable lifecycle store (Phase 385, D-01 / D-02 / D-04 / D-08).
//
// Built on Node's own sqlite binding, so the queue adds ZERO runtime dependencies (JOBQ-02)
// while still getting real transactions and a real unique index. Every compound verb of
// `JobStorePort` is exactly one `BEGIN IMMEDIATE ... COMMIT` here: the binding is
// synchronous, so a verb cannot interleave with another verb in this process, and
// `BEGIN IMMEDIATE` plus a busy timeout covers the writer in the next process (D-02).
// There is no transaction helper in the binding, so every one of them is written out and
// the catch-block rollback is guarded on `isTransaction` — rolling back when no transaction
// is open throws, which would replace the real error with a confusing one.
//
// One thing this file deliberately does NOT do is invent a claim STATUS. `JobStatus` is a
// shipped kernel vocabulary that the C6 break extended by exactly two terminal members, and
// a job in flight is not a new public state — it is a fact about who holds it. So the claim
// lives in a `claimed_at` column the store owns, and the row's published status stays the
// one the contract already names.

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  MissingIdempotencyKeyError,
  StaleJobStoreEpochError,
} from '@vostride/agent-qa-agent'
import type {
  ClockPort,
  JobCheckpointReadOutcome,
  JobClaimOutcome,
  JobCompleteOutcome,
  JobEnqueueOutcome,
  JobFailureDisposition,
  JobInsert,
  JobStoreDump,
  JobStoreDumpRow,
  JobStoreFence,
  JobStorePort,
} from '@vostride/agent-qa-agent'
import { jobSchema } from '@vostride/agent-qa-schema'
import type { Job, JobId } from '@vostride/agent-qa-schema'

import type { JobCheckpointStore } from './job-checkpoint-store.js'
import { canonicalLogicalDump, createLogicalDump, selectOrderedRows } from './logical-dump.js'
import type { LogicalDump } from './logical-dump.js'
import { JobStoreSchemaVersionError, UnknownJobRowError } from './store-errors.js'

/**
 * Stamped into `PRAGMA user_version` at creation and checked on every open (D-04).
 *
 * Stamp and hard-fail, never migrate. The milestone ships nothing between its releases, so a
 * database written by another build is a development artifact rather than a user's history,
 * and migration machinery for it would be code with no user that everything afterwards has
 * to keep working.
 */
export const AGENT_JOB_STORE_USER_VERSION = 1

/**
 * Busy timeout for every connection to the job database.
 *
 * D-02's whole cross-process story is "several processes write small transactions and
 * sqlite arbitrates", which only works if a writer waiting on the write lock retries rather
 * than failing immediately. The binding's constructor `timeout` option is that retry
 * window.
 */
export const AGENT_JOB_STORE_BUSY_TIMEOUT_MS = 2000

/** The store's own file name under the agent-qa root, per the D-21 naming. */
export const AGENT_JOB_STORE_DB_FILE = 'agent-jobs.db'

export interface CreateSqliteJobStoreOptions {
  /** Absolute path to the database file, typically `<root>/agent-jobs.db`. */
  readonly path: string
  readonly clock: ClockPort
  readonly checkpoints: JobCheckpointStore
  readonly timeoutMs?: number
}

export interface SqliteJobStore extends JobStorePort {
  close(): void

  /**
   * The D-03 comparison basis, in full: every table this database holds plus a digest per
   * checkpoint file.
   *
   * Kept beside `dumpState()` rather than replacing it, because the two answer different
   * questions and collapsing them would weaken both. `dumpState()` is the typed, engine-facing
   * projection of the job rows and it is part of the neutral port. This one is the storage
   * implementation's own full-state instrument: it knows about the checkpoint directory and
   * about tables the port has no vocabulary for, and it is the thing a crash comparison holds
   * up against another run.
   */
  logicalDump(): Promise<LogicalDump>

  /** The same dump as one comparable string. Byte equality here is state equality. */
  dumpLogicalState(): Promise<string>
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS jobs (
     id              TEXT PRIMARY KEY,
     kind            TEXT NOT NULL,
     idempotency_key TEXT NOT NULL,
     status          TEXT NOT NULL,
     summary         TEXT NOT NULL,
     payload         TEXT NOT NULL,
     attempts        INTEGER NOT NULL,
     claimed_at      TEXT,
     created_at      TEXT NOT NULL,
     updated_at      TEXT NOT NULL,
     -- The disposition the engine DECIDED, recorded so a failed job says why it failed.
     -- Nullable because most rows never fail; written only by recordFailure.
     last_failure_kind   TEXT,
     last_failure_reason TEXT
   )`,
  // D-08's dedupe is THIS line. Making it a store-level constraint rather than a check the
  // caller performs is what turns "two enqueues of the same work produce one job" from a
  // convention into something no caller, in any process, can get wrong.
  `CREATE UNIQUE INDEX IF NOT EXISTS jobs_kind_idempotency_key
     ON jobs (kind, idempotency_key)`,
  `CREATE TABLE IF NOT EXISTS job_store_fence (
     id    INTEGER PRIMARY KEY CHECK (id = 1),
     epoch INTEGER NOT NULL
   )`,
] as const

function toNumber(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : Number(value)
}

export function createSqliteJobStore(options: CreateSqliteJobStoreOptions): SqliteJobStore {
  const { clock, checkpoints } = options

  mkdirSync(dirname(options.path), { recursive: true })
  const db = new DatabaseSync(options.path, {
    timeout: options.timeoutMs ?? AGENT_JOB_STORE_BUSY_TIMEOUT_MS,
  })
  db.exec('PRAGMA journal_mode=WAL')

  // The version is read BEFORE a single schema statement runs, so a database this build
  // cannot read is not touched on the way to being refused. A hard fail that had already
  // created a table, or re-stamped the header, would be a migration nobody wrote.
  const stampedVersion = toNumber(db.prepare('PRAGMA user_version').get()?.user_version)
  if (stampedVersion !== 0 && stampedVersion !== AGENT_JOB_STORE_USER_VERSION) {
    db.close()
    throw new JobStoreSchemaVersionError(
      options.path,
      AGENT_JOB_STORE_USER_VERSION,
      stampedVersion,
    )
  }
  for (const statement of SCHEMA_STATEMENTS) db.exec(statement)
  if (stampedVersion === 0) {
    db.exec(`PRAGMA user_version=${AGENT_JOB_STORE_USER_VERSION}`)
  }

  const insertJob = db.prepare(
    `INSERT INTO jobs
       (id, kind, idempotency_key, status, summary, payload, attempts, claimed_at,
        created_at, updated_at, last_failure_kind, last_failure_reason)
     VALUES (?, ?, ?, 'queued', ?, ?, 0, NULL, ?, ?, NULL, NULL)
     ON CONFLICT (kind, idempotency_key) DO NOTHING`,
  )
  const selectByKey = db.prepare('SELECT * FROM jobs WHERE kind = ? AND idempotency_key = ?')
  const selectById = db.prepare('SELECT * FROM jobs WHERE id = ?')
  const selectClaimable = db.prepare(
    `SELECT * FROM jobs
     WHERE status = 'queued' AND claimed_at IS NULL
     ORDER BY created_at ASC, id ASC
     LIMIT 1`,
  )
  const markClaimed = db.prepare(
    'UPDATE jobs SET claimed_at = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?',
  )
  const markDone = db.prepare(
    "UPDATE jobs SET status = 'done', claimed_at = NULL, updated_at = ? WHERE id = ?",
  )
  const touchJob = db.prepare('UPDATE jobs SET updated_at = ? WHERE id = ?')
  // Two statements, because the two dispositions are two different outcomes: a retryable
  // failure releases the claim and leaves the row queued for the next attempt, while a
  // permanent one is terminal. Whether a retryable REPORT becomes a retry disposition at all
  // is the engine's call under D-18's bound — the store records the decision, never makes it.
  const markRetryable = db.prepare(
    `UPDATE jobs
     SET claimed_at = NULL, last_failure_kind = 'retry', last_failure_reason = ?,
         updated_at = ?
     WHERE id = ?`,
  )
  const markFailed = db.prepare(
    `UPDATE jobs
     SET status = 'failed', claimed_at = NULL, last_failure_kind = 'permanent',
         last_failure_reason = ?, updated_at = ?
     WHERE id = ?`,
  )
  const selectFence = db.prepare('SELECT epoch FROM job_store_fence WHERE id = 1')
  const upsertFence = db.prepare(
    `INSERT INTO job_store_fence (id, epoch) VALUES (1, ?)
     ON CONFLICT (id) DO UPDATE SET epoch = excluded.epoch`,
  )

  function inTransaction<T>(body: () => T): T {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = body()
      db.exec('COMMIT')
      return result
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK')
      throw error
    }
  }

  /** No epoch adopted yet reads as epoch 0, so an un-adopted store refuses every drain. */
  function currentEpoch(): number {
    const row = selectFence.get()
    return row === undefined ? 0 : toNumber(row.epoch)
  }

  /**
   * The fence check, called from INSIDE each drain-side verb's transaction.
   *
   * Inside is the whole point: checking before `BEGIN IMMEDIATE` would leave a window in
   * which another writer adopts a newer epoch between the check and the mutation, which is
   * precisely the split-brain the fence exists to exclude. The epoch is re-read every time
   * and never cached (the v51 lease discipline).
   */
  function requireFence(fence: JobStoreFence): void {
    const observed = currentEpoch()
    if (observed !== fence.epoch) {
      throw new StaleJobStoreEpochError(fence.epoch, observed)
    }
  }

  /**
   * Every row leaves this store through the shipped zod contract.
   *
   * That is a boundary check, not ceremony: the payload column is opaque text a second
   * process wrote, and the columns around it are only as trustworthy as whatever produced
   * them. Parsing means a row that lost its attempt count or its timestamps cannot travel
   * as a `Job` — which is exactly the class of row the C6 break exists to forbid.
   */
  function rowToJob(row: Record<string, unknown> | undefined): Job {
    if (row === undefined) {
      throw new UnknownJobRowError('<missing>')
    }
    return jobSchema.parse({
      id: String(row.id),
      kind: String(row.kind),
      status: String(row.status),
      summary: String(row.summary),
      attempts: toNumber(row.attempts),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    })
  }

  function requireRow(jobId: string): Record<string, unknown> {
    const row = selectById.get(jobId)
    if (row === undefined) {
      throw new UnknownJobRowError(jobId)
    }
    return row
  }

  function insertOrGet(request: JobInsert, now: string): JobEnqueueOutcome {
    // Checked HERE and not only in the engine. D-02 lets any process open this database, so
    // the store is where dedupe is guaranteed, and an empty key satisfies the unique index
    // while collapsing every job of a kind onto one slot — the failure the guarantee exists
    // to prevent. The engine's error is reused rather than reprinted: one condition, one name.
    if (request.idempotencyKey.trim() === '') {
      throw new MissingIdempotencyKeyError(request.kind)
    }
    const changes = insertJob.run(
      String(request.id),
      request.kind,
      request.idempotencyKey,
      request.summary,
      JSON.stringify(request.payload ?? null),
      now,
      now,
    ).changes
    return {
      job: rowToJob(selectByKey.get(request.kind, request.idempotencyKey)),
      deduped: toNumber(changes) === 0,
    }
  }

  function dumpRow(row: Record<string, unknown>): JobStoreDumpRow {
    return {
      id: String(row.id),
      kind: String(row.kind),
      idempotencyKey: String(row.idempotency_key),
      status: String(row.status),
      summary: String(row.summary),
      payload: JSON.parse(String(row.payload)) as unknown,
      attempts: toNumber(row.attempts),
      claimed: row.claimed_at !== null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }
  }

  return {
    close() {
      db.close()
    },

    async adoptEpoch(epoch: number): Promise<JobStoreFence> {
      return inTransaction(() => {
        const observed = currentEpoch()
        // Authority only ever moves forward. A store that accepted a lower epoch would let
        // a writer that already lost its lease re-arm itself simply by asking again.
        if (epoch < observed) {
          throw new StaleJobStoreEpochError(epoch, observed)
        }
        upsertFence.run(epoch)
        return { epoch }
      })
    },

    async enqueue(request: JobInsert): Promise<JobEnqueueOutcome> {
      const now = clock.now()
      return inTransaction(() => insertOrGet(request, now))
    },

    async claimNext(fence: JobStoreFence): Promise<JobClaimOutcome> {
      const now = clock.now()
      return inTransaction(() => {
        requireFence(fence)
        const row = selectClaimable.get()
        if (row === undefined) {
          return { claimed: false }
        }
        // D-18: the attempt is counted HERE, at the claim, not when a failure is recorded.
        // A job that kills its host on every attempt records no failures at all, so a
        // failure-time counter would let it retry forever.
        markClaimed.run(now, now, String(row.id))
        const claimed = requireRow(String(row.id))
        // The payload travels with the claim, not on the job row's DTO: it is the opaque
        // input this kind's handler reads, and the handler is the only thing that can.
        return {
          claimed: true,
          job: rowToJob(claimed),
          payload: JSON.parse(String(claimed.payload)) as unknown,
        }
      })
    },

    async completeAndChain(
      jobId: JobId,
      next: readonly JobInsert[],
      fence: JobStoreFence,
    ): Promise<JobCompleteOutcome> {
      const now = clock.now()
      return inTransaction(() => {
        requireFence(fence)
        requireRow(String(jobId))
        markDone.run(now, String(jobId))
        // Same transaction as the completion: two transactions would leave a window where a
        // crash loses the chain while the predecessor already reads as done, and nothing
        // downstream would ever notice the successor never existed.
        const chained = next.map((request) => insertOrGet(request, now))
        return { job: rowToJob(requireRow(String(jobId))), chained }
      })
    },

    async recordFailure(
      jobId: JobId,
      disposition: JobFailureDisposition,
      fence: JobStoreFence,
    ): Promise<void> {
      const now = clock.now()
      inTransaction(() => {
        requireFence(fence)
        requireRow(String(jobId))
        // The attempt count is NOT touched here. D-18 spends it at the claim, so a job that
        // kills its host before it can report anything still exhausts its bound; incrementing
        // again on the way out would charge a reported failure twice and an unreported one
        // never.
        if (disposition.kind === 'retry') {
          markRetryable.run(disposition.reason, now, String(jobId))
        } else {
          markFailed.run(disposition.reason, now, String(jobId))
        }
      })
    },

    async publishCheckpoint(
      jobId: JobId,
      checkpointId: string,
      payload: unknown,
      fence: JobStoreFence,
    ): Promise<void> {
      const now = clock.now()
      inTransaction(() => {
        requireFence(fence)
        requireRow(String(jobId))
        touchJob.run(now, String(jobId))
      })
      // File AFTER the row transaction commits: the checkpoint records that the guarded
      // work is durable, so publishing it first would let a crash leave a checkpoint
      // asserting progress the store never made.
      checkpoints.publish(String(jobId), checkpointId, payload)
    },

    async readCheckpoint(
      jobId: JobId,
      checkpointId: string,
    ): Promise<JobCheckpointReadOutcome> {
      return checkpoints.read(String(jobId), checkpointId)
    },

    async dumpState(): Promise<JobStoreDump> {
      return {
        schemaVersion: AGENT_JOB_STORE_USER_VERSION,
        epoch: currentEpoch(),
        // The same ordered read the logical dump uses, so the typed projection and the
        // equality instrument cannot disagree about which rows exist or in what order.
        jobs: selectOrderedRows(db, 'jobs').rows.map(dumpRow),
      }
    },

    async logicalDump(): Promise<LogicalDump> {
      return createLogicalDump({
        db,
        schemaVersion: AGENT_JOB_STORE_USER_VERSION,
        checkpointsRoot: checkpoints.checkpointsRoot,
      })
    },

    async dumpLogicalState(): Promise<string> {
      return canonicalLogicalDump(
        createLogicalDump({
          db,
          schemaVersion: AGENT_JOB_STORE_USER_VERSION,
          checkpointsRoot: checkpoints.checkpointsRoot,
        }),
      )
    },
  }
}
