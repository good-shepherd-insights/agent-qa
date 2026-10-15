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
