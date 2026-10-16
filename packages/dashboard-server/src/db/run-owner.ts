import { hostname } from 'node:os'

export interface RunOwner {
  readonly pid: number
  readonly incarnation: string | null
  readonly host: string
}

export interface RunOwnerProbe {
  isAlive(pid: number): boolean
  incarnationOf(pid: number): string | undefined
}

export interface RunOwnership {
  readonly self: RunOwner
  readonly probe: RunOwnerProbe
}

export type RunOwnerState = 'self' | 'alive' | 'gone' | 'unknown'

function incarnationFormat(token: string): string {
  const separator = token.indexOf(':')
  return separator < 0 ? '' : token.slice(0, separator)
}

// 2026-10-16 (442-01, D-02): gone only on proof (a dead pid or a changed start time); else unknown.
// 442-14 (GAP-D1): a start time stamped in another format is not proof.
export function classifyRunOwner(owner: RunOwner, ownership: RunOwnership): RunOwnerState {
  const { self, probe } = ownership
  if (owner.host !== self.host) return 'unknown'
  if (owner.pid === self.pid && owner.incarnation === self.incarnation) return 'self'
  let alive: boolean
  try {
    alive = probe.isAlive(owner.pid)
  } catch {
    return 'unknown'
  }
  if (!alive) return 'gone'
  if (owner.incarnation === null) return 'unknown'
  const current = probe.incarnationOf(owner.pid)
  if (current === undefined) return 'unknown'
  const stampedFormat = incarnationFormat(owner.incarnation)
  if (incarnationFormat(current) !== stampedFormat) return 'unknown'
  return current === owner.incarnation ? 'alive' : 'gone'
}

export const orphanSummary = (pid: number): string =>
  `The process running this run (pid ${pid}) ended before it finished.`

export const ownedElsewhere = (pid: number): string =>
  `This run belongs to another agent-qa process (pid ${pid}). Stop it there with Ctrl+C.`

function signalZeroIsAlive(pid: number): boolean {
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

// 2026-10-16 (442-01, D-02): with no incarnation reader, a live pid can only classify as unknown.
export function defaultRunOwnership(): RunOwnership {
  return {
    self: { pid: process.pid, incarnation: null, host: hostname() },
    probe: { isAlive: signalZeroIsAlive, incarnationOf: () => undefined },
  }
}
