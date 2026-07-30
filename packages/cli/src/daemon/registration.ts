import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import { z } from 'zod'

export const DAEMON_REGISTRATION_FILE = 'daemon.json'
export const DAEMON_REGISTRATION_SCHEMA_VERSION = 2

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

export function readDaemonRegistration(agentQaRoot: string): ReadDaemonRegistrationOutcome {
  const file = daemonRegistrationPath(agentQaRoot)
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

export function removeDaemonRegistration(agentQaRoot: string): void {
  const file = daemonRegistrationPath(agentQaRoot)
  const existed = existsSync(file)
  rmSync(file, { force: true })
  if (existed) bestEffortFsyncDirectory(dirname(file))
}

/** Remove a registration only when it still belongs to this exact daemon generation. */
export function removeRegistrationIfOwned(agentQaRoot: string, instanceId: string): boolean {
  const outcome = readDaemonRegistration(agentQaRoot)
  if (outcome.kind !== 'parsed' || outcome.registration.instanceId !== instanceId) return false
  removeDaemonRegistration(agentQaRoot)
  return true
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
