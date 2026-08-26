// The durable chip-truth read (Phase 388, D-14 / RESEARCH Pitfall 4).
//
// A status query must be able to answer "what became of that run's analysis" from a cold
// process with no socket held, and it must be able to do so WITHOUT changing anything —
// including whether a queue exists at all.
//
// That second half is the whole reason this module exists rather than the read going through
// `host.jobs()`. Opening the store CREATES `agent-jobs.db` and the checkpoint directory; that
// is why `jobs()` is deferred in the first place. Routing a status read through it would mean
// a project that has never enqueued anything grows a queue database the moment somebody asks
// whether it has one — an observation that changes what it observes. So the file is checked for
// existence FIRST, and opened READ-ONLY when it is there: two independent reasons the read
// cannot bring state into being, because one of them is a check somebody could later move.
//
// Reads are fence-free by design. Reading claims no authority, so this neither adopts an epoch
// nor competes with whichever process holds one — a status query beside a live daemon drain is
// an ordinary concurrent reader on a WAL database, which is exactly what WAL is for.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { guardRunNotification } from '@vostride/agent-qa-schema'
import type { JobStatus, RunNotification } from '@vostride/agent-qa-schema'
import type {
  ChainJobIds,
  JobIdSource,
  PostProcessingChainState,
  PostProcessingJobRow,
  PostProcessingReaderPort,
} from '@vostride/agent-qa-agent'

import {
  AGENT_JOB_STORE_BUSY_TIMEOUT_MS,
  AGENT_JOB_STORE_DB_FILE,
  AGENT_JOB_STORE_USER_VERSION,
} from './sqlite-job-store.js'
import { JobStoreSchemaVersionError } from './store-errors.js'

export interface CreatePostProcessingReaderOptions {
  /** The project's runtime root, i.e. `<configDir>/.agent-qa`. Absolute. */
  readonly agentQaRoot: string
  /**
   * The id source THIS host's queue enqueues through.
   *
   * REQUIRED rather than defaulted to the production digest source, and the requirement is the
   * guarantee: the composition hands the reader the very source it built the queue with, so the
   * ids projected and the ids enqueued cannot be two different derivations. A reader that
   * defaulted would silently address other rows in any composition that configured its own
   * source, and would report `pending` about a chain that had already finished.
   */
  readonly idSource: JobIdSource
}

function toNumber(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : Number(value)
}

function toRow(row: Record<string, unknown> | undefined): PostProcessingJobRow | undefined {
  if (row === undefined) return undefined
  return { status: String(row.status) as JobStatus, claimed: row.claimed_at !== null }
}

/**
 * Bind the `runs.postprocessing` port over this project's queue database.
 *
 * The port's own contract forbids materializing anything, and this implementation honours it
 * structurally rather than carefully: `existsSync` short-circuits before a handle is
 * constructed, and the handle that would be constructed is read-only, which refuses to create
 * a file even if the check were removed.
 */
export function createPostProcessingReader(
  options: CreatePostProcessingReaderOptions,
): PostProcessingReaderPort {
  const path = join(options.agentQaRoot, AGENT_JOB_STORE_DB_FILE)

  return {
    idSource: options.idSource,

    async readChain(
      ids: ChainJobIds,
      runId: string,
    ): Promise<PostProcessingChainState | undefined> {
      // Pitfall 4, stated as the first line of the read: no database, no chain, nothing
      // created. `undefined` rather than an empty state, because the two are different facts
      // and the projection is entitled to know which one it is looking at.
      if (!existsSync(path)) return undefined

      const db = new DatabaseSync(path, {
        readOnly: true,
        timeout: AGENT_JOB_STORE_BUSY_TIMEOUT_MS,
      })
      try {
        // The same stamp-and-refuse gate the writer applies (385 D-04). A database another
        // build wrote is bytes this one cannot read, and answering `pending` from it would be
        // indistinguishable from a run that was never enqueued — which is the silent widening
        // the version stamp exists to refuse. A fresh, never-stamped file reads 0 and is
        // treated as readable-but-empty rather than refused: it holds no rows to misread.
        const stamped = toNumber(db.prepare('PRAGMA user_version').get()?.user_version)
        if (stamped !== 0 && stamped !== AGENT_JOB_STORE_USER_VERSION) {
          throw new JobStoreSchemaVersionError(path, AGENT_JOB_STORE_USER_VERSION, stamped)
        }

        const selectJob = db.prepare('SELECT status, claimed_at FROM jobs WHERE id = ?')
        const notificationRow = db
          .prepare('SELECT payload FROM notifications WHERE run_id = ?')
          .get(runId) as Record<string, unknown> | undefined

        const analyzeRun = toRow(
          selectJob.get(String(ids.analyzeRun)) as Record<string, unknown> | undefined,
        )
        const curateMemory = toRow(
          selectJob.get(String(ids.curateMemory)) as Record<string, unknown> | undefined,
        )
        // Parsed through the schema guard on the way out, like `listNotifications`: the column
        // is bytes another process wrote, and a record that lost a stage must not travel as a
        // `RunNotification` to a surface that renders it.
        const notification: RunNotification | undefined =
          notificationRow === undefined
            ? undefined
            : guardRunNotification(JSON.parse(String(notificationRow.payload)) as unknown)

        // Absent members are OMITTED rather than set undefined, so the state a projection reads
        // says the same thing whether it was built here or by a test's literal.
        return {
          ...(analyzeRun === undefined ? {} : { analyzeRun }),
          ...(curateMemory === undefined ? {} : { curateMemory }),
          ...(notification === undefined ? {} : { notification }),
        }
      } finally {
        db.close()
      }
    },
  }
}
