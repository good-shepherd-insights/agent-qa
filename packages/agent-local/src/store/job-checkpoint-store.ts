// Per-job checkpoint files for the agent job queue (Phase 385, D-01 / JOBQ-05).
//
// Under the hybrid split, sqlite owns the job LIFECYCLE and each checkpoint is its own file
// under `.agent-qa/agent-jobs/checkpoints/<jobId>/<checkpointId>.json`. Three reasons, in
// order of weight: JOBQ-05 asks literally for a rename with a parent-directory fsync;
// authored model output can be large and does not belong in a row a claim transaction has
// to move past; and a checkpoint that guards a filesystem side effect should be durable in
// the same medium as the thing it guards, or the two can disagree after a crash.
//
// The publish sequence and its error allowlist are generalized verbatim from v51's
// per-candidate intent journal (knowledge-local, journal/intent-journal.ts). It is not
// reinvented here: the allowlist below encodes platform quirks already debugged once, and
// re-deriving it by hand is how a directory fsync silently becomes best-effort everywhere.

import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

import {
  canonicalJson,
  asJobId,
  JOB_CHECKPOINT_SCHEMA_VERSION,
  jobCheckpointEnvelopeSchema,
} from '@vostride/agent-qa-schema'
import type { JobCheckpointEnvelope } from '@vostride/agent-qa-schema'

/** Directory segments under the agent-qa root, per the D-21 "agent job queue" naming. */
export const JOB_CHECKPOINT_SUBDIR = ['agent-jobs', 'checkpoints'] as const

/**
 * Ids that are safe as a single path segment.
 *
 * Validated BEFORE any join, following the v51 candidate-id precedent: a job id and a
 * checkpoint id both become directory and file names, and an id validated after joining has
 * already escaped. Leading dots are excluded, so `..` cannot be an id at all, and the class
 * admits no separator on any platform.
 */
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export class InvalidJobCheckpointIdError extends Error {
  override readonly name = 'InvalidJobCheckpointIdError'

  constructor(
    readonly field: 'jobId' | 'checkpointId',
    readonly value: string,
  ) {
    super(
      `Unusable ${field} for a checkpoint path: ${JSON.stringify(value)}. A checkpoint id ` +
        'becomes a path segment, so it is validated before the path is built rather than ' +
        'after.',
    )
  }
}

export class JobCheckpointSchemaVersionError extends Error {
  override readonly name = 'JobCheckpointSchemaVersionError'

  constructor(
    readonly path: string,
    readonly observedVersion: unknown,
  ) {
    super(
      `Checkpoint ${path} was written at schema version ${String(observedVersion)}, but ` +
        `this build reads version ${JOB_CHECKPOINT_SCHEMA_VERSION}. There is no migration ` +
        'machinery by design — clear the agent job queue state and re-enqueue.',
    )
  }
}

export interface JobCheckpointStore {
  publish(jobId: string, checkpointId: string, payload: unknown): void
  read(jobId: string, checkpointId: string): { found: false } | { found: true; payload: unknown }
  /** Exposed so a test can assert on the real file, not on a reader that could agree. */
  checkpointPath(jobId: string, checkpointId: string): string
}

export interface CreateJobCheckpointStoreOptions {
  /** Absolute path to the agent-qa runtime root, typically `<project>/.agent-qa`. */
  readonly root: string
}

function requireSegment(field: 'jobId' | 'checkpointId', value: string): string {
  if (!SAFE_PATH_SEGMENT.test(value)) {
    throw new InvalidJobCheckpointIdError(field, value)
  }
  return value
}

function bestEffortFsyncDirectory(dir: string): void {
  let fd: number | undefined
  try {
    fd = openSync(dir, 'r')
    fsyncSync(fd)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (
      code !== 'ENOENT' &&
      code !== 'EINVAL' &&
      code !== 'EISDIR' &&
      code !== 'EPERM' &&
      code !== 'ENOTSUP'
    ) {
      throw error
    }
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export function createJobCheckpointStore(
  options: CreateJobCheckpointStoreOptions,
): JobCheckpointStore {
  if (!isAbsolute(options.root)) {
    throw new TypeError('agent job checkpoint root must be absolute')
  }

  function pathFor(jobId: string, checkpointId: string): string {
    return join(
      options.root,
      ...JOB_CHECKPOINT_SUBDIR,
      requireSegment('jobId', jobId),
      `${requireSegment('checkpointId', checkpointId)}.json`,
    )
  }

  return {
    checkpointPath: pathFor,

    publish(jobId, checkpointId, payload) {
      const file = pathFor(jobId, checkpointId)
      // Typed as the shipped envelope contract rather than as an ad-hoc literal (385 plan
      // 02): the bytes this writes are the bytes the contract describes, so a field added on
      // one side and forgotten on the other stops compiling instead of shipping.
      const envelope: JobCheckpointEnvelope = {
        schemaVersion: JOB_CHECKPOINT_SCHEMA_VERSION,
        jobId: asJobId(jobId),
        checkpointId,
        payload,
      }
      mkdirSync(dirname(file), { recursive: true })
      const temporary = `${file}.tmp-${randomUUID()}`
      let fd: number | undefined
      try {
        // Exclusive create, so a torn temporary from an earlier crash can never be mistaken
        // for this one's; then fsync the fd BEFORE the rename, so the rename can only
        // publish bytes that are already on the device.
        fd = openSync(temporary, 'wx')
        writeFileSync(fd, `${canonicalJson(envelope)}\n`, 'utf8')
        fsyncSync(fd)
        closeSync(fd)
        fd = undefined
        renameSync(temporary, file)
        // The rename itself is a directory mutation, and a directory entry is not durable
        // until its parent is synced — this is the line JOBQ-05 names.
        bestEffortFsyncDirectory(dirname(file))
      } finally {
        if (fd !== undefined) closeSync(fd)
        rmSync(temporary, { force: true })
      }
    },

    read(jobId, checkpointId) {
      const file = pathFor(jobId, checkpointId)
      let text: string
      try {
        text = readFileSync(file, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { found: false }
        throw error
      }
      const raw = JSON.parse(text) as { schemaVersion?: unknown }
      // The version is checked BEFORE the schema parse, and the order is deliberate. D-04
      // asks for a named refusal that tells the operator what to do, and a generic parse
      // failure on a literal mismatch is not that — it reports a field, not a remedy. Once
      // the version is right, the parse covers everything else the contract requires.
      if (raw.schemaVersion !== JOB_CHECKPOINT_SCHEMA_VERSION) {
        throw new JobCheckpointSchemaVersionError(file, raw.schemaVersion)
      }
      return { found: true, payload: jobCheckpointEnvelopeSchema.parse(raw).payload }
    },
  }
}
