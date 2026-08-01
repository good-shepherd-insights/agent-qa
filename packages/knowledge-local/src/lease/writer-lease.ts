/**
 * Epoch-fenced writer-role primitives for the gitignored knowledge root.
 *
 * This module never touches the curation queue. Plan 378-05 composes stale-holder requeue and
 * journal reconciliation around these lease decisions. Lease and epoch replacements are each
 * file-fsync'd and atomically renamed so a process kill can expose only old or new bytes.
 */
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import type { Dirent } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { z } from 'zod'

export const LEASE_FILE = '.lease'
export const EPOCH_FILE = '.epoch'

/**
 * Lock-free renewal sidecar for the current holder (CR-03).
 *
 * Renewal must not queue behind the governed mutation it exists to protect: `heartbeatLease`
 * enters the same `withMutationLock` primitive as every fenced write, so a long valid mutation
 * would otherwise starve its own heartbeat, cross the TTL, and become takeover-eligible. When
 * renewal loses that race it publishes freshness here instead, without the lock.
 *
 * The file is safe unserialized because it carries no authority: it is honoured only when its
 * `leaseId` equals the CURRENT on-disk lease's id and it is itself within the heartbeat TTL. A
 * superseded holder's sidecar therefore extends nothing, and a stopped process writes none at all.
 */
export const LEASE_RENEWAL_FILE = '.lease-renewal'

/** Provisional writer-heartbeat TTL; retune from operational evidence without adding config. */
export const LEASE_HEARTBEAT_TTL_MS = 30_000

/** Bounded mutation-lock takeover; retune from operational evidence without adding config. */
export const MUTATION_LOCK_TAKEOVER_MS = 45_000

/** Authority-store filename is pinned; retune only through a data-migration plan. */
export const WRITER_AUTHORITY_DB_FILE = '.writer-authority.sqlite'

/**
 * Provisional SQLite contention window; retune from operational evidence without adding config.
 *
 * The takeover deadline remains separate: this short timeout makes each failed write attempt
 * observable so the contender can apply the lease and verified-termination policy.
 */
export const MUTATION_LOCK_BUSY_TIMEOUT_MS = 2_000

/**
 * Provisional acquisition deadline; retune from operational evidence without adding config.
 *
 * V-02: the retry loop's only exits used to be facts about the lease and the lock, and a state the
 * phase itself models — an epoch-invalid lease kept fresh by a renewal sidecar while a live owner
 * holds the authority transaction — satisfies none of them. A contender then spins on the caller's
 * main thread forever, which is what `agent-qa daemon` startup and `agent-qa knowledge drain` do.
 *
 * The bound is therefore anchored OUTSIDE that vocabulary: a monotonic clock reading taken at loop
 * entry plus an attempt counter, neither of which any on-disk value can influence. Deliberately
 * greater than MUTATION_LOCK_TAKEOVER_MS so a legitimate escalated takeover still fits inside the
 * budget and the deadline never pre-empts a reclaim that was going to succeed.
 */
export const ACQUIRE_WRITER_LEASE_DEADLINE_MS = 60_000

const MUTATION_LOCK_TERMINATION_POLL_MS = 10
const MUTATION_LOCK_TERMINATION_TIMEOUT_MS = 5_000
const MUTATION_LOCK_TERMINATION_WAIT = new Int32Array(
  new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
)

const writerLeaseSchema = z
  .object({
    leaseId: z.string().uuid(),
    pid: z.number().int().positive(),
    epoch: z.number().int().positive(),
    heartbeatAtMs: z.number().int().nonnegative(),
  })
  .strict()

export type WriterLease = z.infer<typeof writerLeaseSchema>

const leaseRenewalSchema = z
  .object({
    leaseId: z.string().uuid(),
    heartbeatAtMs: z.number().int().nonnegative(),
  })
  .strict()

/** Advisory freshness for one exact lease id; never epoch or identity authority. */
export type LeaseRenewal = z.infer<typeof leaseRenewalSchema>

export type ReadLeaseRenewalOutcome =
  | { kind: 'absent' }
  | { kind: 'malformed' }
  | { kind: 'parsed'; renewal: LeaseRenewal }

/** What the contender could observe about the owner it gave up on; never an authority claim. */
export interface UnreclaimableMutationLockOwner {
  pid: number
  acquiredAtMs: number
  generationToken: string
  /** False when the row carries no incarnation, which is why escalation could never fire. */
  incarnationAttributed: boolean
}

export type AcquireWriterLeaseOutcome =
  | { kind: 'held'; holder: WriterLease }
  | { kind: 'acquired'; leaseId: string; epoch: number; reclaimed?: WriterLease }
  | {
      kind: 'refused'
      reason: 'corrupt-epoch-state'
      error: CorruptEpochStateError
    }
  | {
      kind: 'refused'
      reason: 'mutation-lock-unreclaimable'
      /**
       * Both refusal arms carry a thrown-shaped `error` ON PURPOSE.
       *
       * Every caller of this union already renders `refused` as `[reason]: error.message` or
       * rethrows it, so a new arm that also carries one is surfaced by name at every entry point —
       * including any added later — without a list of call sites to keep in step. Naming the
       * refusal is the requirement; enumerating the callers who must name it is the failure mode
       * this phase keeps rediscovering.
       */
      error: WriterLeaseUnreclaimableError
      attempts: number
      waitedMs: number
      observedOwner?: UnreclaimableMutationLockOwner
      observedLease?: WriterLease
    }

export interface LeaseOperationOptions {
  knowledgeRoot: string
  leaseId: string
}

export type HeartbeatLeaseOutcome =
  | { kind: 'heartbeated'; holder: WriterLease }
  | { kind: 'deferred'; reason: 'mutation-lock-busy' }
  | {
      kind: 'refused'
      reason:
        | 'lease-missing'
        | 'lease-malformed'
        | 'lease-id-mismatch'
        | 'stale-epoch'
        | 'corrupt-epoch-state'
      holder?: WriterLease
      observedEpoch?: number
      error?: CorruptEpochStateError
    }

export type ReleaseLeaseOutcome =
  | { kind: 'released' }
  | {
      kind: 'refused'
      reason: 'lease-missing' | 'lease-malformed' | 'lease-id-mismatch'
      holder?: WriterLease
    }

export interface AssertEpochCurrentOptions {
  knowledgeRoot: string
  epoch: number
}

export type AssertEpochCurrentOutcome =
  | { current: true }
  | { current: false; observedEpoch: number }

/** Exact writer identity carried by governed maintenance mutators. */
export interface WriterLeaseAuthority extends LeaseOperationOptions {
  epoch: number
}

export type WriterAuthorityLostReason =
  | Extract<HeartbeatLeaseOutcome, { kind: 'refused' }>['reason']
  | 'epoch-mismatch-before-heartbeat'
  | 'epoch-mismatch-after-heartbeat'
  | 'mutation-lock-generation-lost'

/** Fail-closed maintenance refusal with the holder and fresh disk epoch attached. */
export class WriterAuthorityLostError extends Error {
  override readonly name = 'WriterAuthorityLostError'
  readonly authority: WriterLeaseAuthority
  readonly reason: WriterAuthorityLostReason
  readonly observedEpoch: number

  constructor(
    authority: WriterLeaseAuthority,
    reason: WriterAuthorityLostReason,
    observedEpoch: number,
  ) {
    super(
      `writer authority lost (${reason}); held epoch ${authority.epoch}, observed ${observedEpoch}`,
    )
    this.authority = authority
    this.reason = reason
    this.observedEpoch = observedEpoch
  }
}

export type CorruptEpochStateReason = 'unreadable' | 'malformed' | 'overflow'

/** Fail-closed authority-state error; callers must never substitute epoch zero for this state. */
export class CorruptEpochStateError extends Error {
  override readonly name = 'CorruptEpochStateError'
  readonly path: string
  readonly reason: CorruptEpochStateReason
  readonly rawPreview: string

  constructor(path: string, reason: CorruptEpochStateReason, rawPreview: string) {
    super(`writer epoch state is corrupt (${reason}) at ${path}`)
    this.path = path
    this.reason = reason
    this.rawPreview = rawPreview
  }
}

/**
 * Fail-closed acquisition refusal after the deadline; carries why the wait could not end well.
 *
 * A contender that gives up is reporting a fact about the SYSTEM, not about itself, so the
 * diagnostics travel with the error: the owner it kept losing to, whether that owner was even
 * attributable (an unattributed row can never be escalated against, which is usually the whole
 * story), and the lease it kept reading. `agent-qa daemon` prints this and exits non-zero where it
 * previously hung with no output at all.
 */
export class WriterLeaseUnreclaimableError extends Error {
  override readonly name = 'WriterLeaseUnreclaimableError'
  readonly reason = 'mutation-lock-unreclaimable' as const
  readonly attempts: number
  readonly waitedMs: number
  readonly observedOwner?: UnreclaimableMutationLockOwner
  readonly observedLease?: WriterLease

  constructor(
    attempts: number,
    waitedMs: number,
    observedOwner?: UnreclaimableMutationLockOwner,
    observedLease?: WriterLease,
  ) {
    super(
      `writer lease acquisition refused (mutation-lock-unreclaimable) after ${attempts} `
      + `attempts over ${Math.round(waitedMs)}ms; `
      + (observedOwner === undefined
        ? 'no mutation-lock owner was readable'
        : `mutation lock held by pid ${observedOwner.pid} (generation `
          + `${observedOwner.generationToken}, incarnation `
          + `${observedOwner.incarnationAttributed ? 'attributed' : 'unattributed'})`)
      + '; '
      + (observedLease === undefined
        ? 'no parseable lease on disk'
        : `lease ${observedLease.leaseId} at epoch ${observedLease.epoch} held by pid `
          + `${observedLease.pid}`),
    )
    this.attempts = attempts
    this.waitedMs = waitedMs
    if (observedOwner !== undefined) this.observedOwner = observedOwner
    if (observedLease !== undefined) this.observedLease = observedLease
  }
}

export type ReadWriterLeaseOutcome =
  | { kind: 'absent' }
  | { kind: 'malformed' }
  | { kind: 'parsed'; lease: WriterLease }

function assertAbsoluteKnowledgeRoot(knowledgeRoot: string): void {
  if (!isAbsolute(knowledgeRoot)) {
    throw new TypeError('knowledgeRoot must be absolute')
  }
}

function leasePath(knowledgeRoot: string): string {
  return join(knowledgeRoot, LEASE_FILE)
}

function epochPath(knowledgeRoot: string): string {
  return join(knowledgeRoot, EPOCH_FILE)
}

function leaseRenewalPath(knowledgeRoot: string): string {
  return join(knowledgeRoot, LEASE_RENEWAL_FILE)
}

function writerAuthorityDbPath(knowledgeRoot: string): string {
  return join(knowledgeRoot, WRITER_AUTHORITY_DB_FILE)
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

interface MutationLockOwner {
  pid: number
  acquiredAtMs: number
  generationToken: string
  /** OS-reported start-time token of the process that created this row; absent when unresolvable. */
  incarnation?: string
}

/**
 * Opaque process-incarnation token for one pid, anchored OUTSIDE any value this module writes.
 *
 * CR-04: a durable row's pid is not an identity. Once the recorded process dies, the kernel is
 * free to hand that number to a stranger, and every later decision keyed on the number alone
 * (above all `SIGKILL`) targets whoever holds it now. The one fact that distinguishes them is
 * assigned by the OS and cannot be forged from inside the store: when the process at that pid
 * started.
 *
 * Linux reads field 22 (`starttime`) of `/proc/<pid>/stat`, counted from the LAST `)` because the
 * `comm` field is parenthesised and may itself contain spaces and parentheses. Other POSIX hosts
 * read `ps -p <pid> -o lstart=`. Windows has no equivalent builtin, so it resolves to `undefined`
 * and every incarnation check there fails closed.
 *
 * Returns `undefined` — never throws — whenever the pid cannot be attributed. `undefined` means
 * "do not signal", never "safe to signal".
 *
 * 386-32 consumes this same helper for the embedder-worker signal path, so both kill paths speak
 * one incarnation vocabulary.
 */
export function resolveProcessIncarnation(pid: number): string | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined
  try {
    if (process.platform === 'win32') return undefined
    return process.platform === 'linux'
      ? resolveLinuxProcessIncarnation(pid)
      : resolvePosixProcessIncarnation(pid)
  } catch {
    return undefined
  }
}

function resolveLinuxProcessIncarnation(pid: number): string | undefined {
  let raw: string
  try {
    raw = readFileSync(`/proc/${pid}/stat`, 'utf8')
  } catch {
    return undefined
  }
  const commEnd = raw.lastIndexOf(')')
  if (commEnd < 0) return undefined
  // The first field after `comm` is `state` (field 3), so `starttime` (field 22) sits at index 19.
  const startTime = raw.slice(commEnd + 1).trim().split(/\s+/)[19]
  return startTime !== undefined && /^\d+$/.test(startTime)
    ? `proc-starttime:${startTime}`
    : undefined
}

function resolvePosixProcessIncarnation(pid: number): string | undefined {
  const observed = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (observed.error !== undefined || observed.status !== 0) return undefined
  const lstart = (observed.stdout ?? '').trim()
  return lstart === '' ? undefined : `ps-lstart:${lstart}`
}

const OWN_INCARNATION_UNRESOLVED = Symbol('own-incarnation-unresolved')
let ownIncarnation: string | undefined | typeof OWN_INCARNATION_UNRESOLVED =
  OWN_INCARNATION_UNRESOLVED

/**
 * This process's own incarnation, resolved once.
 *
 * A pid's start time is fixed for the life of the process, and this process is alive by
 * definition, so the value cannot go stale. Memoising it keeps the per-claim cost off the hot
 * mutation path (the POSIX arm shells out to `ps`).
 */
function ownProcessIncarnation(): string | undefined {
  if (ownIncarnation === OWN_INCARNATION_UNRESOLVED) {
    ownIncarnation = resolveProcessIncarnation(process.pid)
  }
  return ownIncarnation
}

export interface MutationLockOptions {
  /** Test/chaos seam after the claim is committed and before the held transaction begins. */
  afterMutationLockClaimed?: (generationToken: string) => void
  afterMutationLockAcquired?: () => void
  /** Test/chaos seam inside acquisition, after the epoch rewrite and before lease publication. */
  afterEpochRewrite?: () => void
  mutationLockTakeoverMs?: number
}

export interface AcquireWriterLeaseOptions extends MutationLockOptions {
  /**
   * Test/chaos seam for the pinned acquisition deadline; production never sets it.
   *
   * The same shape as `mutationLockTakeoverMs` and the heartbeat supervisor's `stopTimeoutMs`: a
   * real unreclaimable wait is 60 s, which no test can afford to sit through, and shortening the
   * window is the only way to reach the refusal branch (D-15 — a seam, never a config key).
   */
  acquireDeadlineMs?: number
}

export interface CurrentWriterAuthority {
  leaseId: string
  epoch: number
}

export interface CurrentWriterAuthorityHooks extends MutationLockOptions {
  /** Test/chaos seam after the lock-held epoch comparison and before mutation. */
  afterFinalAuthorityCompare?: () => void
}

class MutationLockBusyError extends Error {
  override readonly name = 'MutationLockBusyError'
  readonly owner?: MutationLockOwner

  constructor(owner?: MutationLockOwner) {
    super('writer lease mutation lock is busy')
    this.owner = owner
  }
}

class MutationLockGenerationLostError extends Error {
  override readonly name = 'MutationLockGenerationLostError'
}

function mutationLockNowMs(): number {
  return new Date().getTime()
}

/**
 * Elapsed milliseconds from a `process.hrtime.bigint()` reading, immune to wall-clock movement.
 *
 * The acquisition deadline must not be extendable by anything the contended state can influence,
 * and a wall clock can be stepped backwards by NTP or by a test's own `Date.now` stub. This is the
 * external anchor the bound is measured against.
 */
function monotonicElapsedMs(startedAtNs: bigint): number {
  return Number(process.hrtime.bigint() - startedAtNs) / 1e6
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    if (code === 'EPERM') return true
    throw error
  }
}

function isSqliteBusy(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ERR_SQLITE_ERROR'
    && /database is (?:locked|busy)/i.test((error as Error).message)
}

function openWriterAuthorityDb(knowledgeRoot: string): DatabaseSync {
  mkdirSync(knowledgeRoot, { recursive: true })
  const db = new DatabaseSync(writerAuthorityDbPath(knowledgeRoot), {
    timeout: MUTATION_LOCK_BUSY_TIMEOUT_MS,
  })
  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec(`PRAGMA busy_timeout = ${MUTATION_LOCK_BUSY_TIMEOUT_MS}`)
    db.exec(`
      CREATE TABLE IF NOT EXISTS mutation_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        generation_token TEXT NOT NULL,
        pid INTEGER NOT NULL CHECK (pid > 0),
        acquired_at_ms INTEGER NOT NULL CHECK (acquired_at_ms >= 0),
        incarnation TEXT
      ) STRICT
    `)
    upgradeMutationLockSchema(db)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

/**
 * Add the incarnation column to a store created before CR-04 shipped.
 *
 * The authority database is transient lock state, not knowledge, so this needs no data-migration
 * plan: an inherited row keeps a NULL incarnation and is therefore unattributed, which fails the
 * signal check closed. That is the correct reading — nothing on disk can say which process wrote
 * a row that predates the column.
 */
function upgradeMutationLockSchema(db: DatabaseSync): void {
  const columns = db.prepare(`
    SELECT name FROM pragma_table_info('mutation_lock')
  `).all() as { name: string }[]
  if (columns.some((column) => column.name === 'incarnation')) return
  db.exec('ALTER TABLE mutation_lock ADD COLUMN incarnation TEXT')
}

function parseMutationLockOwner(value: unknown): MutationLockOwner | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  return typeof row.pid === 'number'
    && Number.isSafeInteger(row.pid)
    && row.pid > 0
    && typeof row.acquired_at_ms === 'number'
    && Number.isSafeInteger(row.acquired_at_ms)
    && row.acquired_at_ms >= 0
    && typeof row.generation_token === 'string'
    && row.generation_token !== ''
    ? {
        pid: row.pid,
        acquiredAtMs: row.acquired_at_ms,
        generationToken: row.generation_token,
        // A row written before the incarnation column existed, or by a claimant that could not
        // resolve its own start time, is deliberately left unattributed rather than guessed at.
        ...(typeof row.incarnation === 'string' && row.incarnation !== ''
          ? { incarnation: row.incarnation }
          : {}),
      }
    : undefined
}

function readMutationLockOwner(db: DatabaseSync): MutationLockOwner | undefined {
  // `SELECT *` so a store that predates the incarnation column still reads through a read-only
  // connection, which has no opportunity to upgrade the schema.
  return parseMutationLockOwner(db.prepare(`
    SELECT * FROM mutation_lock WHERE id = 1
  `).get())
}

function readCommittedMutationLockOwner(
  knowledgeRoot: string,
): MutationLockOwner | undefined {
  try {
    const db = new DatabaseSync(writerAuthorityDbPath(knowledgeRoot), {
      readOnly: true,
      timeout: 0,
    })
    try {
      return readMutationLockOwner(db)
    } finally {
      db.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    // A store file whose `mutation_lock` table does not exist yet reads exactly like an absent
    // store: nobody has committed a claim. This is reachable — `openWriterAuthorityDb` creates
    // the store file before `CREATE TABLE`, so a contender that loses the write lock in that
    // window arrives here and used to crash the daemon with a raw SQL logic error instead of
    // reporting contention.
    if (isMissingMutationLockTable(error)) return undefined
    throw error
  }
}

function isMissingMutationLockTable(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ERR_SQLITE_ERROR'
    && /no such table: mutation_lock/i.test((error as Error).message)
}

function mutationLockGenerationIsCurrent(
  db: DatabaseSync,
  generationToken: string,
): boolean {
  return readMutationLockOwner(db)?.generationToken === generationToken
}

function compareAndSwapMutationLock(
  db: DatabaseSync,
  expected: MutationLockOwner,
  replacement: MutationLockOwner,
): boolean {
  const result = db.prepare(`
    UPDATE mutation_lock
    SET generation_token = ?, pid = ?, acquired_at_ms = ?, incarnation = ?
    WHERE id = 1 AND generation_token = ?
  `).run(
    replacement.generationToken,
    replacement.pid,
    replacement.acquiredAtMs,
    replacement.incarnation ?? null,
    expected.generationToken,
  )
  return result.changes === 1
}

function waitForVerifiedProcessExit(pid: number): boolean {
  const deadline = mutationLockNowMs() + MUTATION_LOCK_TERMINATION_TIMEOUT_MS
  while (processIsAlive(pid)) {
    if (mutationLockNowMs() >= deadline) return false
    Atomics.wait(
      MUTATION_LOCK_TERMINATION_WAIT,
      0,
      0,
      MUTATION_LOCK_TERMINATION_POLL_MS,
    )
  }
  return true
}

type MutationLockOwnerIdentity = 'match' | 'mismatch' | 'unverifiable'

/**
 * Compare the row's recorded incarnation against the pid's CURRENT occupant.
 *
 * An unattributed row (legacy bytes, or a claimant that could not resolve its own start time) and
 * an unresolvable pid both answer `unverifiable`, which is a refusal to signal — never a licence.
 */
function verifyMutationLockOwnerIdentity(owner: MutationLockOwner): MutationLockOwnerIdentity {
  if (owner.incarnation === undefined) return 'unverifiable'
  const occupant = resolveProcessIncarnation(owner.pid)
  if (occupant === undefined) return 'unverifiable'
  return occupant === owner.incarnation ? 'match' : 'mismatch'
}

/**
 * CR-04: the generation token authenticates the ROW, not the process now occupying its pid.
 *
 * The pid's current incarnation is therefore re-resolved immediately before the signal, and the
 * three answers are genuinely different outcomes:
 *
 *   match        the process that created this row is still there — SIGKILL and confirm ESRCH,
 *                exactly the Plan 20 verified-termination semantics.
 *   mismatch     the recorded process is gone and a stranger inherited its pid. A reused pid is
 *                EVIDENCE OF DEATH, not a target: report success so the caller's generation
 *                re-read and CAS reclaim the row with no signal delivered at all.
 *   unverifiable fail closed. Refusing escalation can wedge a contender until the occupant really
 *                exits (T-386-31-02); signalling an unattributable pid is local arbitrary-process
 *                termination. Only one of those is recoverable.
 */
function terminateExactMutationLockOwner(owner: MutationLockOwner): boolean {
  if (owner.pid === process.pid) return false
  const identity = verifyMutationLockOwnerIdentity(owner)
  if (identity === 'unverifiable') return false
  if (identity === 'mismatch') return true
  try {
    process.kill(owner.pid, 'SIGKILL')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ESRCH') {
      if (code === 'EPERM') return false
      throw error
    }
  }
  return waitForVerifiedProcessExit(owner.pid)
}

function leasePermitsEscalation(knowledgeRoot: string, owner: MutationLockOwner): boolean {
  if (!processIsAlive(owner.pid)) return true
  const lease = readWriterLease(knowledgeRoot)
  // CR-03: a holder still renewing through the sidecar is healthy, not wedged. Escalation here
  // ends in SIGKILL, so a renewing holder must never reach it just because the mutation it is
  // performing is the reason its lease file cannot be rewritten.
  return lease.kind !== 'parsed'
    || !isWriterLeaseFresh(knowledgeRoot, lease.lease, mutationLockNowMs())
}

function tryEscalatedMutationLockTakeover(
  db: DatabaseSync,
  knowledgeRoot: string,
  expected: MutationLockOwner,
  replacement: MutationLockOwner,
  takeoverMs: number,
): boolean {
  if (mutationLockNowMs() - expected.acquiredAtMs < takeoverMs) return false
  if (!leasePermitsEscalation(knowledgeRoot, expected)) return false
  if (processIsAlive(expected.pid) && !terminateExactMutationLockOwner(expected)) return false

  const observedAfterTermination = readMutationLockOwner(db)
  if (observedAfterTermination?.generationToken !== expected.generationToken) return false
  try {
    return compareAndSwapMutationLock(db, expected, replacement)
  } catch (error) {
    // A mismatched incarnation reclaims without killing anything, so the write lock can still be
    // held by whoever made the store busy. That is an ordinary retry, not a failure to surface.
    if (isSqliteBusy(error)) return false
    throw error
  }
}

function claimMutationLock(
  db: DatabaseSync,
  knowledgeRoot: string,
  owner: MutationLockOwner,
  takeoverMs: number,
): void {
  try {
    const inserted = db.prepare(`
      INSERT INTO mutation_lock (id, generation_token, pid, acquired_at_ms, incarnation)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      owner.generationToken,
      owner.pid,
      owner.acquiredAtMs,
      owner.incarnation ?? null,
    )
    if (inserted.changes === 1) return
  } catch (error) {
    if (!isSqliteBusy(error)) throw error
    const current = readMutationLockOwner(db)
    if (
      current !== undefined
      && tryEscalatedMutationLockTakeover(
        db,
        knowledgeRoot,
        current,
        owner,
        takeoverMs,
      )
    ) {
      return
    }
    throw new MutationLockBusyError(current)
  }

  const current = readMutationLockOwner(db)
  if (current === undefined) {
    throw new MutationLockBusyError()
  }

  const ownerIsDead = !processIsAlive(current.pid)
  const ownerPastDeadline =
    mutationLockNowMs() - current.acquiredAtMs >= takeoverMs
  if (!ownerIsDead && !ownerPastDeadline) {
    throw new MutationLockBusyError(current)
  }

  try {
    if (compareAndSwapMutationLock(db, current, owner)) return
  } catch (error) {
    if (!isSqliteBusy(error)) throw error
    if (
      tryEscalatedMutationLockTakeover(
        db,
        knowledgeRoot,
        current,
        owner,
        takeoverMs,
      )
    ) {
      return
    }
    throw new MutationLockBusyError(current)
  }
  throw new MutationLockBusyError(readMutationLockOwner(db))
}

function releaseMutationLock(db: DatabaseSync, generationToken: string): void {
  db.prepare(`
    DELETE FROM mutation_lock
    WHERE id = 1 AND generation_token = ?
  `).run(generationToken)
}

function withMutationLock<T>(
  knowledgeRoot: string,
  mutate: (generationToken: string, db: DatabaseSync) => T,
  options: MutationLockOptions = {},
): T {
  let db: DatabaseSync
  try {
    db = openWriterAuthorityDb(knowledgeRoot)
  } catch (error) {
    if (isSqliteBusy(error)) {
      throw new MutationLockBusyError(
        readCommittedMutationLockOwner(knowledgeRoot),
      )
    }
    throw error
  }
  const claimantIncarnation = ownProcessIncarnation()
  const owner: MutationLockOwner = {
    pid: process.pid,
    acquiredAtMs: mutationLockNowMs(),
    generationToken: randomUUID(),
    // A claimant that cannot prove its own incarnation records none, accepting that its row may
    // then only ever be reclaimed after it really dies. Never a fabricated token.
    ...(claimantIncarnation === undefined ? {} : { incarnation: claimantIncarnation }),
  }
  const takeoverMs = options.mutationLockTakeoverMs ?? MUTATION_LOCK_TAKEOVER_MS
  let claimed = false
  let transactionOpen = false
  try {
    claimMutationLock(db, knowledgeRoot, owner, takeoverMs)
    claimed = true
    options.afterMutationLockClaimed?.(owner.generationToken)
    try {
      db.exec('BEGIN IMMEDIATE')
      transactionOpen = true
    } catch (error) {
      if (isSqliteBusy(error)) throw new MutationLockBusyError(readMutationLockOwner(db))
      throw error
    }

    if (!mutationLockGenerationIsCurrent(db, owner.generationToken)) {
      throw new MutationLockGenerationLostError()
    }
    options.afterMutationLockAcquired?.()
    const result = mutate(owner.generationToken, db)
    db.exec('COMMIT')
    transactionOpen = false
    return result
  } finally {
    if (transactionOpen) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // The original failure is authoritative.
      }
    }
    if (claimed) {
      try {
        releaseMutationLock(db, owner.generationToken)
      } catch {
        // A crashed/contended cleanup leaves a CAS-recoverable row.
      }
    }
    db.close()
  }
}

function sweepStagedEpochsBefore(knowledgeRoot: string, epoch: number): void {
  const memoryRoot = join(knowledgeRoot, 'memory')
  let products: Dirent<string>[]
  try {
    products = readdirSync(memoryRoot, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  for (const product of products) {
    if (!product.isDirectory()) continue
    const bundlesDir = join(memoryRoot, product.name, 'bundles')
    const stagingRoot = join(bundlesDir, '.staging')
    let staged: Dirent<string>[]
    try {
      staged = readdirSync(stagingRoot, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    for (const entry of staged) {
      if (!entry.isDirectory()) continue
      const match = /^\.staged-epoch-(\d+)-[A-Za-z0-9._-]+$/.exec(entry.name)
      if (match === null) continue
      const stagedEpoch = Number(match[1])
      if (!Number.isSafeInteger(stagedEpoch) || stagedEpoch >= epoch) continue
      rmSync(join(stagingRoot, entry.name), { recursive: true, force: true })
    }
    if (existsSync(stagingRoot)) bestEffortFsyncDirectory(stagingRoot)
    try {
      rmdirSync(stagingRoot)
      bestEffortFsyncDirectory(bundlesDir)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error
    }
  }
}

function atomicRewrite(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${randomUUID()}`
  let fd: number | undefined
  try {
    fd = openSync(temporary, 'wx')
    writeFileSync(fd, text, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(temporary, file)
    bestEffortFsyncDirectory(dirname(file))
  } finally {
    if (fd !== undefined) closeSync(fd)
    rmSync(temporary, { force: true })
  }
}

/** Read and strictly validate current writer authority without acquiring or refreshing it. */
export function readWriterLease(knowledgeRoot: string): ReadWriterLeaseOutcome {
  const file = leasePath(knowledgeRoot)
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return existsSync(file) ? { kind: 'malformed' } : { kind: 'absent' }
  }

  try {
    const parsed = writerLeaseSchema.safeParse(JSON.parse(raw))
    return parsed.success ? { kind: 'parsed', lease: parsed.data } : { kind: 'malformed' }
  } catch {
    return { kind: 'malformed' }
  }
}

/** Read the advisory renewal sidecar; an unreadable or invalid file is simply no renewal. */
export function readLeaseRenewal(knowledgeRoot: string): ReadLeaseRenewalOutcome {
  const file = leaseRenewalPath(knowledgeRoot)
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return existsSync(file) ? { kind: 'malformed' } : { kind: 'absent' }
  }

  try {
    const parsed = leaseRenewalSchema.safeParse(JSON.parse(raw))
    return parsed.success ? { kind: 'parsed', renewal: parsed.data } : { kind: 'malformed' }
  } catch {
    return { kind: 'malformed' }
  }
}

/**
 * Publish freshness for one lease id without entering the mutation lock.
 *
 * The caller has already verified that `leaseId` is the current on-disk holder; this write is
 * deliberately unserialized because a torn or lost sidecar can only ever make a live holder look
 * older than it is, never younger.
 */
function writeLeaseRenewal(knowledgeRoot: string, renewal: LeaseRenewal): void {
  atomicRewrite(
    leaseRenewalPath(knowledgeRoot),
    `${JSON.stringify(leaseRenewalSchema.parse(renewal))}\n`,
  )
}

function clearLeaseRenewal(knowledgeRoot: string): void {
  rmSync(leaseRenewalPath(knowledgeRoot), { force: true })
}

function previewEpochState(raw: string): string {
  const preview = raw.slice(0, 64).replaceAll('\r', '\\r').replaceAll('\n', '\\n')
  return preview === '' ? '<empty>' : preview
}

function readEpoch(knowledgeRoot: string): number {
  const file = epochPath(knowledgeRoot)
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return 0
    throw new CorruptEpochStateError(file, 'unreadable', code ?? 'unknown-read-error')
  }
  const canonical = raw.endsWith('\n') ? raw.slice(0, -1) : raw
  if (!/^(0|[1-9][0-9]*)$/.test(canonical)) {
    throw new CorruptEpochStateError(file, 'malformed', previewEpochState(raw))
  }
  const epoch = Number(canonical)
  if (!Number.isSafeInteger(epoch)) {
    throw new CorruptEpochStateError(file, 'overflow', previewEpochState(raw))
  }
  return epoch
}

/** Fresh-read the monotonic disk epoch; only an absent file is pre-acquire epoch zero. */
export function readCurrentEpoch(knowledgeRoot: string): number {
  assertAbsoluteKnowledgeRoot(knowledgeRoot)
  return readEpoch(knowledgeRoot)
}

/**
 * An epoch-stale write is refused AT THE MUTATION BOUNDARY. Plan 378-10 calls this immediately
 * before the intent-journal write and again immediately before the publish rename; a stale result
 * abandons the in-flight job without mutation. Every call re-reads disk and never caches the epoch.
 */
export function assertEpochCurrent(
  opts: AssertEpochCurrentOptions,
): AssertEpochCurrentOutcome {
  const observedEpoch = readCurrentEpoch(opts.knowledgeRoot)
  return observedEpoch === opts.epoch
    ? { current: true }
    : { current: false, observedEpoch }
}

function nextEpoch(current: number): number {
  if (current === Number.MAX_SAFE_INTEGER) {
    throw new RangeError('writer lease epoch exhausted')
  }
  return current + 1
}

/** Purely classify a guarded or untrusted lease value against one explicit wall-clock instant. */
export function isLeaseStale(lease: unknown, nowMs: number): boolean {
  const parsed = writerLeaseSchema.safeParse(lease)
  if (!parsed.success || !Number.isFinite(nowMs)) return true
  return nowMs - parsed.data.heartbeatAtMs >= LEASE_HEARTBEAT_TTL_MS
}

/**
 * Composite freshness: the lease file itself, OR a renewal sidecar bound to this exact holder.
 *
 * CR-03: a holder inside a long governed mutation cannot refresh `.lease`, because publishing it
 * requires the very transaction the mutation is holding. Its renewal lands in the sidecar instead,
 * so takeover classification must read both. The sidecar is honoured only when it names THIS
 * lease's id — a superseded holder's leftover sidecar extends nothing — and only while it is
 * itself within `LEASE_HEARTBEAT_TTL_MS`, so a stopped process (which writes no sidecar at all)
 * still ages out and remains legitimately reclaimable.
 */
export function isWriterLeaseFresh(
  knowledgeRoot: string,
  lease: WriterLease,
  nowMs: number,
): boolean {
  if (!isLeaseStale(lease, nowMs)) return true
  if (!Number.isFinite(nowMs)) return false
  const renewal = readLeaseRenewal(knowledgeRoot)
  if (renewal.kind !== 'parsed' || renewal.renewal.leaseId !== lease.leaseId) return false
  return nowMs - renewal.renewal.heartbeatAtMs < LEASE_HEARTBEAT_TTL_MS
}

/**
 * A published holder counts as current only when its recorded epoch still equals the disk epoch.
 *
 * WR-04: a crash between the epoch rewrite and the lease rewrite leaves a lease naming the previous
 * epoch. Reporting that lease as `held` manufactures a phantom holder no TTL sweep ever reclaims,
 * so an epoch-invalid lease is recovery input rather than an answer.
 */
function leaseEpochIsCurrent(knowledgeRoot: string, lease: WriterLease): boolean {
  try {
    return lease.epoch === readEpoch(knowledgeRoot)
  } catch (error) {
    // Corrupt epoch bytes are never an answer; the in-lock read returns the typed refusal.
    if (error instanceof CorruptEpochStateError) return false
    throw error
  }
}

function isCurrentHolder(
  knowledgeRoot: string,
  lease: WriterLease,
  nowMs: number,
): boolean {
  return isWriterLeaseFresh(knowledgeRoot, lease, nowMs)
    && leaseEpochIsCurrent(knowledgeRoot, lease)
}

/** Return a live holder or atomically mint a new, monotonically fenced writer identity. */
export function acquireWriterLease(
  knowledgeRoot: string,
  hooks?: AcquireWriterLeaseOptions,
): AcquireWriterLeaseOutcome {
  assertAbsoluteKnowledgeRoot(knowledgeRoot)
  try {
    readEpoch(knowledgeRoot)
  } catch (error) {
    if (error instanceof CorruptEpochStateError) {
      return { kind: 'refused', reason: 'corrupt-epoch-state', error }
    }
    throw error
  }
  const beforeLock = readWriterLease(knowledgeRoot)
  if (
    beforeLock.kind === 'parsed'
    && isCurrentHolder(knowledgeRoot, beforeLock.lease, mutationLockNowMs())
  ) {
    return { kind: 'held', holder: beforeLock.lease }
  }

  const deadlineMs = hooks?.acquireDeadlineMs ?? ACQUIRE_WRITER_LEASE_DEADLINE_MS
  const startedAtNs = process.hrtime.bigint()
  let attempts = 0

  while (true) {
    attempts += 1
    try {
      return withMutationLock(knowledgeRoot, () => {
        let observedEpoch: number
        try {
          observedEpoch = readEpoch(knowledgeRoot)
        } catch (error) {
          if (error instanceof CorruptEpochStateError) {
            return { kind: 'refused' as const, reason: 'corrupt-epoch-state' as const, error }
          }
          throw error
        }
        const current = readWriterLease(knowledgeRoot)
        const nowMs = Date.now()
        if (
          current.kind === 'parsed'
          && isWriterLeaseFresh(knowledgeRoot, current.lease, nowMs)
          && current.lease.epoch === observedEpoch
        ) {
          return { kind: 'held', holder: current.lease }
        }
        const reclaimed = current.kind === 'parsed' ? current.lease : undefined

        const epoch = nextEpoch(observedEpoch)
        const holder = writerLeaseSchema.parse({
          leaseId: randomUUID(),
          pid: process.pid,
          epoch,
          heartbeatAtMs: nowMs,
        })
        atomicRewrite(epochPath(knowledgeRoot), `${epoch}\n`)
        hooks?.afterEpochRewrite?.()
        sweepStagedEpochsBefore(knowledgeRoot, epoch)
        // The reclaimed holder's renewal can no longer speak for this root.
        clearLeaseRenewal(knowledgeRoot)
        atomicRewrite(leasePath(knowledgeRoot), `${JSON.stringify(holder)}\n`)
        return {
          kind: 'acquired',
          leaseId: holder.leaseId,
          epoch: holder.epoch,
          ...(reclaimed === undefined ? {} : { reclaimed }),
        }
      }, hooks)
    } catch (error) {
      if (!(error instanceof MutationLockBusyError)) throw error
      /**
       * Contention answers 'held' only for an epoch-valid lease. Staleness deliberately does NOT
       * disqualify a holder here: the lock is busy, so the published holder is inside its own
       * serialized section and a stale heartbeat is exactly the fencing case DAEM-09 protects
       * (a paused drainer must be reported as holding, not stolen from). An epoch-mismatched
       * lease is different in kind — nobody can still be inside a transaction for a superseded
       * epoch — so it is recovery input and the loop keeps waiting for the lock.
       */
      const current = readWriterLease(knowledgeRoot)
      if (current.kind === 'parsed' && leaseEpochIsCurrent(knowledgeRoot, current.lease)) {
        return { kind: 'held', holder: current.lease }
      }
      /**
       * The outermost exit, and the only one anchored outside this module's own vocabulary.
       *
       * It is checked AFTER the `held` narrow above, so a contender that could have answered
       * `held` always does; the deadline never converts a good answer into a refusal. It is also
       * strictly larger than MUTATION_LOCK_TAKEOVER_MS, so a reclaim that was going to happen has
       * already had its chance by the time this fires.
       */
      const waitedMs = monotonicElapsedMs(startedAtNs)
      if (waitedMs >= deadlineMs) {
        const observedOwner = readCommittedMutationLockOwner(knowledgeRoot)
        const error = new WriterLeaseUnreclaimableError(
          attempts,
          waitedMs,
          observedOwner === undefined ? undefined : {
            pid: observedOwner.pid,
            acquiredAtMs: observedOwner.acquiredAtMs,
            generationToken: observedOwner.generationToken,
            incarnationAttributed: observedOwner.incarnation !== undefined,
          },
          current.kind === 'parsed' ? current.lease : undefined,
        )
        return {
          kind: 'refused',
          reason: 'mutation-lock-unreclaimable',
          error,
          attempts,
          waitedMs,
          ...(error.observedOwner === undefined ? {} : { observedOwner: error.observedOwner }),
          ...(error.observedLease === undefined ? {} : { observedLease: error.observedLease }),
        }
      }
      Atomics.wait(
        MUTATION_LOCK_TERMINATION_WAIT,
        0,
        0,
        MUTATION_LOCK_TERMINATION_POLL_MS,
      )
    }
  }
}

/**
 * Compare one exact writer authority and run its mutation under the same generation lock.
 * The generation check after the failpoint prevents an expired owner from resuming after a
 * bounded takeover. Mutation implementations must keep irreversible work inside `mutate`.
 */
export function withCurrentWriterAuthority<T>(
  knowledgeRoot: string,
  authority: CurrentWriterAuthority,
  mutate: () => T,
  hooks: CurrentWriterAuthorityHooks = {},
): T {
  assertAbsoluteKnowledgeRoot(knowledgeRoot)
  const fullAuthority: WriterLeaseAuthority = { knowledgeRoot, ...authority }
  try {
    return withMutationLock(knowledgeRoot, (generationToken, db) => {
      const observedEpoch = readCurrentEpoch(knowledgeRoot)
      if (observedEpoch !== authority.epoch) {
        throw new WriterAuthorityLostError(
          fullAuthority,
          'epoch-mismatch-before-heartbeat',
          observedEpoch,
        )
      }
      /**
       * CR-01: the epoch alone is guessable, and release deliberately never advances it, so an
       * epoch-only guard admits both a fabricated identity and a holder that already released.
       * The lease is therefore read INSIDE the held transaction — the same serialization boundary
       * as the epoch and generation checks — and must match the supplied authority exactly. This
       * is heartbeatLease's presence/id/epoch ladder, applied where mutation actually happens.
       */
      const current = readWriterLease(knowledgeRoot)
      if (current.kind === 'absent') {
        throw new WriterAuthorityLostError(fullAuthority, 'lease-missing', observedEpoch)
      }
      if (current.kind === 'malformed') {
        throw new WriterAuthorityLostError(fullAuthority, 'lease-malformed', observedEpoch)
      }
      if (current.lease.leaseId !== authority.leaseId) {
        throw new WriterAuthorityLostError(fullAuthority, 'lease-id-mismatch', observedEpoch)
      }
      if (current.lease.epoch !== authority.epoch) {
        throw new WriterAuthorityLostError(fullAuthority, 'stale-epoch', observedEpoch)
      }
      hooks.afterFinalAuthorityCompare?.()
      if (!mutationLockGenerationIsCurrent(db, generationToken)) {
        throw new WriterAuthorityLostError(
          fullAuthority,
          'mutation-lock-generation-lost',
          readCurrentEpoch(knowledgeRoot),
        )
      }
      return mutate()
    }, hooks)
  } catch (error) {
    if (
      error instanceof MutationLockBusyError
      || error instanceof MutationLockGenerationLostError
    ) {
      throw new WriterAuthorityLostError(
        fullAuthority,
        'mutation-lock-generation-lost',
        readCurrentEpoch(knowledgeRoot),
      )
    }
    throw error
  }
}

/**
 * Refresh the matching current-epoch holder; reclaim races return a typed refusal.
 *
 * CR-03: renewal shares `withMutationLock` with every governed mutation, so the holder's own
 * long-running write can lock it out of its own heartbeat. Contention is therefore not a failure
 * — it falls back to the lock-free renewal sidecar and reports `deferred`. Identity is still
 * proven first: only a lease file that parses AND names this exact holder may be extended.
 */
export function heartbeatLease(opts: LeaseOperationOptions): HeartbeatLeaseOutcome {
  assertAbsoluteKnowledgeRoot(opts.knowledgeRoot)
  try {
    return heartbeatLeaseUnderMutationLock(opts)
  } catch (error) {
    if (!(error instanceof MutationLockBusyError)) throw error
    const current = readWriterLease(opts.knowledgeRoot)
    if (current.kind === 'absent') return { kind: 'refused', reason: 'lease-missing' }
    if (current.kind === 'malformed') return { kind: 'refused', reason: 'lease-malformed' }
    if (current.lease.leaseId !== opts.leaseId) {
      return { kind: 'refused', reason: 'lease-id-mismatch', holder: current.lease }
    }
    writeLeaseRenewal(opts.knowledgeRoot, {
      leaseId: opts.leaseId,
      heartbeatAtMs: Date.now(),
    })
    return { kind: 'deferred', reason: 'mutation-lock-busy' }
  }
}

function heartbeatLeaseUnderMutationLock(opts: LeaseOperationOptions): HeartbeatLeaseOutcome {
  return withMutationLock(opts.knowledgeRoot, () => {
    const current = readWriterLease(opts.knowledgeRoot)
    if (current.kind === 'absent') return { kind: 'refused', reason: 'lease-missing' }
    if (current.kind === 'malformed') return { kind: 'refused', reason: 'lease-malformed' }
    if (current.lease.leaseId !== opts.leaseId) {
      return { kind: 'refused', reason: 'lease-id-mismatch', holder: current.lease }
    }
    let observedEpoch: number
    try {
      observedEpoch = readEpoch(opts.knowledgeRoot)
    } catch (error) {
      if (error instanceof CorruptEpochStateError) {
        return {
          kind: 'refused',
          reason: 'corrupt-epoch-state',
          holder: current.lease,
          error,
        }
      }
      throw error
    }
    if (current.lease.epoch !== observedEpoch) {
      return {
        kind: 'refused',
        reason: 'stale-epoch',
        holder: current.lease,
        observedEpoch,
      }
    }

    const holder = writerLeaseSchema.parse({
      ...current.lease,
      heartbeatAtMs: Date.now(),
    })
    atomicRewrite(leasePath(opts.knowledgeRoot), `${JSON.stringify(holder)}\n`)
    return { kind: 'heartbeated', holder }
  })
}

/**
 * Refresh one exact maintenance writer at a non-mutating boundary.
 *
 * The epoch reads deliberately bracket the heartbeat: the first rejects an already-reclaimed
 * holder, while the second detects a reclaim race after the lease rewrite. The authority-store
 * transaction is released before this function returns, so this is NOT a mutation fence. Any
 * irreversible mutation must instead run inside `withCurrentWriterAuthority`.
 */
export function refreshWriterLeaseAuthority(
  authority: WriterLeaseAuthority,
): WriterLeaseAuthority {
  const beforeHeartbeat = assertEpochCurrent(authority)
  if (!beforeHeartbeat.current) {
    throw new WriterAuthorityLostError(
      authority,
      'epoch-mismatch-before-heartbeat',
      beforeHeartbeat.observedEpoch,
    )
  }

  const heartbeat = heartbeatLease(authority)
  if (heartbeat.kind === 'refused') {
    if (heartbeat.reason === 'corrupt-epoch-state' && heartbeat.error !== undefined) {
      throw heartbeat.error
    }
    throw new WriterAuthorityLostError(
      authority,
      heartbeat.reason,
      readCurrentEpoch(authority.knowledgeRoot),
    )
  }

  const afterHeartbeat = assertEpochCurrent(authority)
  if (!afterHeartbeat.current) {
    throw new WriterAuthorityLostError(
      authority,
      'epoch-mismatch-after-heartbeat',
      afterHeartbeat.observedEpoch,
    )
  }

  return authority
}

/** Remove only the matching lease file; the monotonic epoch is deliberately retained forever. */
export function releaseLease(opts: LeaseOperationOptions): ReleaseLeaseOutcome {
  assertAbsoluteKnowledgeRoot(opts.knowledgeRoot)
  return withMutationLock(opts.knowledgeRoot, () => {
    const current = readWriterLease(opts.knowledgeRoot)
    if (current.kind === 'absent') return { kind: 'refused', reason: 'lease-missing' }
    if (current.kind === 'malformed') return { kind: 'refused', reason: 'lease-malformed' }
    if (current.lease.leaseId !== opts.leaseId) {
      return { kind: 'refused', reason: 'lease-id-mismatch', holder: current.lease }
    }

    rmSync(leasePath(opts.knowledgeRoot), { force: true })
    // A released holder must not keep extending its own freshness through the sidecar.
    clearLeaseRenewal(opts.knowledgeRoot)
    bestEffortFsyncDirectory(opts.knowledgeRoot)
    return { kind: 'released' }
  })
}
