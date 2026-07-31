import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import type {
  ReadWriterLeaseOutcome,
  WriterLease,
} from '@vostride/agent-qa-agent-local'
import { LOCAL_DAEMON_CAPABILITIES } from '@vostride/agent-qa-agent-local'
import { z } from 'zod'

import { fetchDaemonIdentity } from './server.js'
import type { DaemonIdentity } from './server.js'

export const DAEMON_REGISTRATION_FILE = 'daemon.json'
export const DAEMON_REGISTRATION_SCHEMA_VERSION = 2

/** Pinned identity-probe bound; retune from daemon evidence without adding config. */
export const DAEMON_IDENTITY_HANDSHAKE_TIMEOUT_MS = 1_000

const legacyDaemonRegistrationSchema = z
  .object({
    schemaVersion: z.literal(1),
    pid: z.number().int().positive(),
    socketPath: z.string().min(1),
    startedAtMs: z.number().int().nonnegative(),
  })
  .strict()

export const daemonRegistrationSchema = z
  .object({
    schemaVersion: z.literal(DAEMON_REGISTRATION_SCHEMA_VERSION),
    instanceId: z.string().uuid(),
    pid: z.number().int().positive(),
    socketPath: z.string().min(1),
    startedAtMs: z.number().int().nonnegative(),
  })
  .strict()

export type DaemonRegistration = z.infer<typeof daemonRegistrationSchema>
export type LegacyDaemonRegistration = z.infer<typeof legacyDaemonRegistrationSchema>
export type StaleDaemonRegistration = DaemonRegistration | LegacyDaemonRegistration

export type ReadDaemonRegistrationOutcome =
  | { kind: 'absent' }
  | { kind: 'malformed' }
  | { kind: 'obsolete'; registration: LegacyDaemonRegistration }
  | { kind: 'parsed'; registration: DaemonRegistration }

export type InspectDaemonRegistrationOutcome =
  | { kind: 'absent' }
  | { kind: 'malformed' }
  | { kind: 'live'; registration: DaemonRegistration }
  | { kind: 'stale'; registration: StaleDaemonRegistration }

export type RecoverDaemonRegistrationOutcome =
  | Exclude<InspectDaemonRegistrationOutcome, { kind: 'stale' }>
  | { kind: 'recovered'; registration: StaleDaemonRegistration }

export type ClassifyDaemonRegistrationOutcome =
  | { kind: 'absent' }
  | { kind: 'malformed' }
  | { kind: 'obsolete'; registration: LegacyDaemonRegistration }
  | { kind: 'live-confirmed'; registration: DaemonRegistration }
  | {
      kind: 'unreachable-lease-fresh'
      registration: DaemonRegistration
      holder: WriterLease
      identityFailure: 'mismatch' | 'timeout' | 'unreachable'
    }
  | {
      kind: 'unreachable-lease-stale'
      registration: DaemonRegistration
      lease: ReadWriterLeaseOutcome
      identityFailure: 'mismatch' | 'timeout' | 'unreachable'
    }

export interface DaemonRegistrationClassificationOperations {
  fetchIdentity(registration: DaemonRegistration): Promise<DaemonIdentity>
  readWriterLease(knowledgeRoot: string): ReadWriterLeaseOutcome
  isLeaseStale(lease: unknown, nowMs: number): boolean
  now(): number
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>
  clearTimeout(timer: ReturnType<typeof setTimeout>): void
}

export interface ClassifyDaemonRegistrationInput {
  readonly agentQaRoot: string
  readonly knowledgeRoot: string
  /** Focused test seam. Production callers omit it. */
  readonly operations?: Partial<DaemonRegistrationClassificationOperations>
}

export type ProcessIsAlive = (pid: number) => boolean

/** Legacy project-local default used by status fixtures; live hosts record the server's actual path. */
export function daemonRegistrationSocketPath(agentQaRoot: string): string {
  return join(agentQaRoot, 'daemon.sock')
}

export function daemonRegistrationPath(agentQaRoot: string): string {
  return join(agentQaRoot, DAEMON_REGISTRATION_FILE)
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

function atomicRewrite(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${randomUUID()}`
  let fd: number | undefined
  try {
    fd = openSync(temporary, 'wx', 0o600)
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

export function writeDaemonRegistration(
  agentQaRoot: string,
  registration: DaemonRegistration,
): void {
  const validated = daemonRegistrationSchema.parse(registration)
  atomicRewrite(daemonRegistrationPath(agentQaRoot), `${JSON.stringify(validated)}\n`)
}

function readDaemonRegistrationFile(file: string): ReadDaemonRegistrationOutcome {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return existsSync(file) ? { kind: 'malformed' } : { kind: 'absent' }
  }

  try {
    const parsedJson = JSON.parse(raw) as unknown
    const parsed = daemonRegistrationSchema.safeParse(parsedJson)
    if (parsed.success) return { kind: 'parsed', registration: parsed.data }
    const legacy = legacyDaemonRegistrationSchema.safeParse(parsedJson)
    return legacy.success
      ? { kind: 'obsolete', registration: legacy.data }
      : { kind: 'malformed' }
  } catch {
    return { kind: 'malformed' }
  }
}

export function readDaemonRegistration(agentQaRoot: string): ReadDaemonRegistrationOutcome {
  return readDaemonRegistrationFile(daemonRegistrationPath(agentQaRoot))
}

/** Signal-zero liveness probe: EPERM proves existence; only ESRCH proves a stale pid. */
export function processIsAlive(pid: number): boolean {
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

export function inspectDaemonRegistration(
  agentQaRoot: string,
  isAlive: ProcessIsAlive = processIsAlive,
): InspectDaemonRegistrationOutcome {
  const outcome = readDaemonRegistration(agentQaRoot)
  if (outcome.kind === 'obsolete') {
    return { kind: 'stale', registration: outcome.registration }
  }
  if (outcome.kind !== 'parsed') return outcome
  return isAlive(outcome.registration.pid)
    ? { kind: 'live', registration: outcome.registration }
    : { kind: 'stale', registration: outcome.registration }
}

class DaemonIdentityHandshakeTimeoutError extends Error {
  constructor() {
    super(`Daemon identity handshake exceeded ${DAEMON_IDENTITY_HANDSHAKE_TIMEOUT_MS}ms`)
    this.name = 'DaemonIdentityHandshakeTimeoutError'
  }
}

const DEFAULT_CLASSIFICATION_OPERATIONS: DaemonRegistrationClassificationOperations = {
  fetchIdentity: (registration) => fetchDaemonIdentity(registration.socketPath),
  readWriterLease: LOCAL_DAEMON_CAPABILITIES.readWriterLease,
  isLeaseStale: LOCAL_DAEMON_CAPABILITIES.isLeaseStale,
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
}

async function fetchIdentityWithinBound(
  registration: DaemonRegistration,
  operations: DaemonRegistrationClassificationOperations,
): Promise<DaemonIdentity> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operations.fetchIdentity(registration),
      new Promise<never>((_resolve, reject) => {
        timeout = operations.setTimeout(
          () => reject(new DaemonIdentityHandshakeTimeoutError()),
          DAEMON_IDENTITY_HANDSHAKE_TIMEOUT_MS,
        )
        timeout.unref?.()
      }),
    ])
  } finally {
    if (timeout !== undefined) operations.clearTimeout(timeout)
  }
}

/**
 * Classify daemon authority from its nonce-authenticated socket identity and current writer lease.
 *
 * PID signal-zero is deliberately absent: an alive, stopped, or reused PID is not daemon proof.
 */
export async function classifyDaemonRegistration(
  input: ClassifyDaemonRegistrationInput,
): Promise<ClassifyDaemonRegistrationOutcome> {
  const outcome = readDaemonRegistration(input.agentQaRoot)
  if (outcome.kind !== 'parsed') return outcome

  const operations = {
    ...DEFAULT_CLASSIFICATION_OPERATIONS,
    ...input.operations,
  }
  let identityFailure: 'mismatch' | 'timeout' | 'unreachable'
  try {
    const identity = await fetchIdentityWithinBound(outcome.registration, operations)
    if (
      identity.instanceId === outcome.registration.instanceId
      && identity.pid === outcome.registration.pid
    ) {
      return { kind: 'live-confirmed', registration: outcome.registration }
    }
    identityFailure = 'mismatch'
  } catch (error) {
    identityFailure = error instanceof DaemonIdentityHandshakeTimeoutError
      ? 'timeout'
      : 'unreachable'
  }

  const lease = operations.readWriterLease(input.knowledgeRoot)
  if (
    lease.kind === 'parsed'
    && !operations.isLeaseStale(lease.lease, operations.now())
  ) {
    return {
      kind: 'unreachable-lease-fresh',
      registration: outcome.registration,
      holder: lease.lease,
      identityFailure,
    }
  }
  return {
    kind: 'unreachable-lease-stale',
    registration: outcome.registration,
    lease,
    identityFailure,
  }
}

export function removeDaemonRegistration(agentQaRoot: string): void {
  const file = daemonRegistrationPath(agentQaRoot)
  const existed = existsSync(file)
  rmSync(file, { force: true })
  if (existed) bestEffortFsyncDirectory(dirname(file))
}

export interface RemoveRegistrationIfOwnedOptions {
  /** Test-only barrier immediately before the atomic quarantine rename. */
  readonly beforeQuarantineRename?: () => void
  /** Test-only barrier after quarantine publication and before ownership verification. */
  readonly afterQuarantine?: (quarantinePath: string) => void
  /** Focused durability seam; production uses the best-effort platform fsync helper. */
  readonly fsyncDirectory?: (directory: string) => void
}

/**
 * Atomically quarantine, verify, and remove only this exact daemon generation.
 *
 * A mismatched quarantine is restored with a hard link so an EEXIST successor can never be
 * overwritten by an obsolete host's cleanup.
 */
export function removeRegistrationIfOwned(
  agentQaRoot: string,
  instanceId: string,
  options: RemoveRegistrationIfOwnedOptions = {},
): boolean {
  const file = daemonRegistrationPath(agentQaRoot)
  const parent = dirname(file)
  const quarantine = `${file}.remove-${instanceId}-${randomUUID()}`
  const fsyncDirectory = options.fsyncDirectory ?? bestEffortFsyncDirectory

  options.beforeQuarantineRename?.()
  try {
    renameSync(file, quarantine)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  fsyncDirectory(parent)
  options.afterQuarantine?.(quarantine)

  const outcome = readDaemonRegistrationFile(quarantine)
  if (
    outcome.kind === 'parsed'
    && outcome.registration.instanceId === instanceId
  ) {
    unlinkSync(quarantine)
    fsyncDirectory(parent)
    return true
  }

  try {
    linkSync(quarantine, file)
    fsyncDirectory(parent)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  unlinkSync(quarantine)
  fsyncDirectory(parent)
  return false
}

/** Remove only a schema-valid registration whose pid has been proven dead. */
export function recoverStaleDaemonRegistration(
  agentQaRoot: string,
  isAlive: ProcessIsAlive = processIsAlive,
): RecoverDaemonRegistrationOutcome {
  const outcome = inspectDaemonRegistration(agentQaRoot, isAlive)
  if (outcome.kind !== 'stale') return outcome
  removeDaemonRegistration(agentQaRoot)
  return { kind: 'recovered', registration: outcome.registration }
}
