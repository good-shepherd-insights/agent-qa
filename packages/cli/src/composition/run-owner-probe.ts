import { hostname } from 'node:os'
import { LOCAL_DAEMON_CAPABILITIES } from '@vostride/agent-qa-agent-local'

import { processIsAlive } from '../daemon/registration.js'

// 2026-10-16 (442-02, D-20): the dashboard's RunOwnership, injected so dashboard-server gains no
// dependency; typed here and read via agent-local, as the FUNC-02 firewall bars naming either.
export interface CliRunOwnership {
  readonly self: {
    readonly pid: number
    readonly incarnation: string | null
    readonly host: string
  }
  readonly probe: {
    isAlive(pid: number): boolean
    incarnationOf(pid: number): string | undefined
  }
}

let composed: CliRunOwnership | undefined

export function composeRunOwnership(): CliRunOwnership {
  if (composed !== undefined) return composed
  const { resolveProcessIncarnation } = LOCAL_DAEMON_CAPABILITIES
  composed = {
    self: {
      pid: process.pid,
      incarnation: resolveProcessIncarnation(process.pid) ?? null,
      host: hostname(),
    },
    probe: { isAlive: processIsAlive, incarnationOf: (pid) => resolveProcessIncarnation(pid) },
  }
  return composed
}
