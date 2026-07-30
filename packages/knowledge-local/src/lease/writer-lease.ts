/**
 * Epoch-fenced writer-role primitives for the gitignored knowledge root.
 *
 * This module never touches the curation queue. Plan 378-05 composes stale-holder requeue and
 * journal reconciliation around these lease decisions. Lease and epoch replacements are each
 * file-fsync'd and atomically renamed so a process kill can expose only old or new bytes.
 */
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
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

import { z } from 'zod'

export const LEASE_FILE = '.lease'
export const EPOCH_FILE = '.epoch'

/** Provisional writer-heartbeat TTL; retune from operational evidence without adding config. */
export const LEASE_HEARTBEAT_TTL_MS = 30_000

/** Bounded mutation-lock takeover; retune from operational evidence without adding config. */
export const MUTATION_LOCK_TAKEOVER_MS = 45_000

const MUTATION_LOCK_FILE = '.writer-lease-mutation-lock'
const MUTATION_LOCK_POLL_MS = 5
const MUTATION_LOCK_WAIT = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))

const writerLeaseSchema = z
  .object({
    leaseId: z.string().uuid(),
    pid: z.number().int().positive(),
    epoch: z.number().int().positive(),
    heartbeatAtMs: z.number().int().nonnegative(),
  })
  .strict()

export type WriterLease = z.infer<typeof writerLeaseSchema>

export type AcquireWriterLeaseOutcome =
  | { kind: 'held'; holder: WriterLease }
  | { kind: 'acquired'; leaseId: string; epoch: number; reclaimed?: WriterLease }
  | {
      kind: 'refused'
      reason: 'corrupt-epoch-state'
      error: CorruptEpochStateError
    }

export interface LeaseOperationOptions {
  knowledgeRoot: string
  leaseId: string
}

export type HeartbeatLeaseOutcome =
  | { kind: 'heartbeated'; holder: WriterLease }
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

function mutationLockPath(knowledgeRoot: string): string {
  return join(knowledgeRoot, 'memory', 'index', MUTATION_LOCK_FILE)
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
}

interface MutationLockOptions {
  afterMutationLockAcquired?: () => void
  mutationLockTakeoverMs?: number
}

export interface CurrentWriterAuthority {
  leaseId: string
  epoch: number
}

export interface CurrentWriterAuthorityHooks extends MutationLockOptions {
  /** Test/chaos seam after the lock-held epoch comparison and before mutation. */
  afterFinalAuthorityCompare?: () => void
}

function readMutationLockOwner(lockFile: string): MutationLockOwner | undefined {
  try {
    const parsed = JSON.parse(readFileSync(lockFile, 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const value = parsed as Record<string, unknown>
    return typeof value.pid === 'number'
      && Number.isSafeInteger(value.pid)
      && value.pid > 0
      && typeof value.acquiredAtMs === 'number'
      && Number.isSafeInteger(value.acquiredAtMs)
      && value.acquiredAtMs >= 0
      && typeof value.generationToken === 'string'
      && value.generationToken !== ''
      ? {
          pid: value.pid,
          acquiredAtMs: value.acquiredAtMs,
          generationToken: value.generationToken,
        }
      : undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function waitForMutationLock(): void {
  Atomics.wait(MUTATION_LOCK_WAIT, 0, 0, MUTATION_LOCK_POLL_MS)
}

function mutationLockNowMs(): number {
  return new Date().getTime()
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

function writeMutationLockOwner(file: string, owner: MutationLockOwner): void {
  const fd = openSync(file, 'wx')
  try {
    writeFileSync(fd, `${JSON.stringify(owner)}\n`, 'utf8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function mutationLockGenerationIsCurrent(
  lockFile: string,
  generationToken: string,
): boolean {
  return readMutationLockOwner(lockFile)?.generationToken === generationToken
}

function takeOverMutationLock(
  lockFile: string,
  lockParent: string,
  expected: MutationLockOwner,
): boolean {
  const quarantine = `${lockFile}.reclaimed-${expected.generationToken}-${randomUUID()}`
  try {
    renameSync(lockFile, quarantine)
    bestEffortFsyncDirectory(lockParent)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }

  const reclaimed = readMutationLockOwner(quarantine)
  if (reclaimed?.generationToken !== expected.generationToken) {
    try {
      renameSync(quarantine, lockFile)
      bestEffortFsyncDirectory(lockParent)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      rmSync(quarantine, { force: true })
    }
    return false
  }

  rmSync(quarantine, { force: true })
  bestEffortFsyncDirectory(lockParent)
  return true
}

function withMutationLock<T>(
  knowledgeRoot: string,
  mutate: (generationToken: string) => T,
  options: MutationLockOptions = {},
): T {
  const lockFile = mutationLockPath(knowledgeRoot)
  const lockParent = dirname(lockFile)
  mkdirSync(lockParent, { recursive: true })
  const owner: MutationLockOwner = {
    pid: process.pid,
    acquiredAtMs: mutationLockNowMs(),
    generationToken: randomUUID(),
  }
  const ownerFile = `${lockFile}.owner-${owner.generationToken}`
  writeMutationLockOwner(ownerFile, owner)

  let acquired = false
  try {
    while (!acquired) {
      try {
        linkSync(ownerFile, lockFile)
        bestEffortFsyncDirectory(lockParent)
        acquired = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const current = readMutationLockOwner(lockFile)
        if (current === undefined) {
          if (!existsSync(lockFile)) continue
          throw new Error('writer lease mutation lock owner is malformed')
        }
        const takeoverMs = options.mutationLockTakeoverMs ?? MUTATION_LOCK_TAKEOVER_MS
        if (
          !processIsAlive(current.pid)
          || mutationLockNowMs() - current.acquiredAtMs >= takeoverMs
        ) {
          takeOverMutationLock(lockFile, lockParent, current)
          continue
        }
        waitForMutationLock()
      }
    }

    options.afterMutationLockAcquired?.()
    return mutate(owner.generationToken)
  } finally {
    if (
      acquired
      && mutationLockGenerationIsCurrent(lockFile, owner.generationToken)
    ) {
      rmSync(lockFile, { force: true })
      bestEffortFsyncDirectory(lockParent)
    }
    rmSync(ownerFile, { force: true })
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

/** Return a live holder or atomically mint a new, monotonically fenced writer identity. */
export function acquireWriterLease(
  knowledgeRoot: string,
  hooks?: MutationLockOptions,
): AcquireWriterLeaseOutcome {
  assertAbsoluteKnowledgeRoot(knowledgeRoot)
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
    if (current.kind === 'parsed' && !isLeaseStale(current.lease, nowMs)) {
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
    sweepStagedEpochsBefore(knowledgeRoot, epoch)
    atomicRewrite(leasePath(knowledgeRoot), `${JSON.stringify(holder)}\n`)
    return {
      kind: 'acquired',
      leaseId: holder.leaseId,
      epoch: holder.epoch,
      ...(reclaimed === undefined ? {} : { reclaimed }),
    }
  }, hooks)
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
  return withMutationLock(knowledgeRoot, (generationToken) => {
    const observedEpoch = readCurrentEpoch(knowledgeRoot)
    if (observedEpoch !== authority.epoch) {
      throw new WriterAuthorityLostError(
        fullAuthority,
        'epoch-mismatch-before-heartbeat',
        observedEpoch,
      )
    }
    hooks.afterFinalAuthorityCompare?.()
    if (
      !mutationLockGenerationIsCurrent(
        mutationLockPath(knowledgeRoot),
        generationToken,
      )
    ) {
      throw new WriterAuthorityLostError(
        fullAuthority,
        'mutation-lock-generation-lost',
        readCurrentEpoch(knowledgeRoot),
      )
    }
    return mutate()
  }, hooks)
}

/** Refresh the matching current-epoch holder; reclaim races return a typed refusal. */
export function heartbeatLease(opts: LeaseOperationOptions): HeartbeatLeaseOutcome {
  assertAbsoluteKnowledgeRoot(opts.knowledgeRoot)
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
 * Refresh one exact maintenance writer immediately before a mutation boundary.
 *
 * The epoch reads deliberately bracket the heartbeat: the first rejects an already-reclaimed
 * holder, while the second closes a reclaim race after the lease rewrite. Callers may mutate only
 * after this function returns.
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
    bestEffortFsyncDirectory(opts.knowledgeRoot)
    return { kind: 'released' }
  })
}
