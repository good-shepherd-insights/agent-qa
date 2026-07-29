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
export const DAEMON_REGISTRATION_SCHEMA_VERSION = 1

export const daemonRegistrationSchema = z
  .object({
    schemaVersion: z.literal(DAEMON_REGISTRATION_SCHEMA_VERSION),
    pid: z.number().int().positive(),
    socketPath: z.string().min(1),
    startedAtMs: z.number().int().nonnegative(),
  })
  .strict()

export type DaemonRegistration = z.infer<typeof daemonRegistrationSchema>

export type ReadDaemonRegistrationOutcome =
  | { kind: 'absent' }
  | { kind: 'malformed' }
  | { kind: 'parsed'; registration: DaemonRegistration }

/** Plan 05 binds a listener here; this plan records the deterministic project-local address. */
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
    const parsed = daemonRegistrationSchema.safeParse(JSON.parse(raw))
    return parsed.success
      ? { kind: 'parsed', registration: parsed.data }
      : { kind: 'malformed' }
  } catch {
    return { kind: 'malformed' }
  }
}

export function removeDaemonRegistration(agentQaRoot: string): void {
  const file = daemonRegistrationPath(agentQaRoot)
  const existed = existsSync(file)
  rmSync(file, { force: true })
  if (existed) bestEffortFsyncDirectory(dirname(file))
}
