import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { hostname } from 'node:os'

import { classifyRunOwner } from '@vostride/agent-qa-dashboard'
import type { RunOwner, RunOwnership } from '@vostride/agent-qa-dashboard'
import { resolveProcessIncarnation } from '@vostride/agent-qa-knowledge-local'
import { describe, expect, it } from 'vitest'

import { composeRunOwnership } from '../run-owner-probe.js'

function requirePosix(): void {
  if (process.platform === 'win32') throw new Error('POSIX run lifecycle required; never skip')
}

function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => child.once('exit', () => resolve()))
}

function requirePid(child: ChildProcess): number {
  if (child.pid === undefined) throw new Error('the child process did not start')
  return child.pid
}

describe('C442-OWNER-STAMP', () => {
  it('the CLI composes its own pid, start time and host', () => {
    const ownership: RunOwnership = composeRunOwnership()
    expect(ownership.self).toEqual({
      pid: process.pid,
      incarnation: resolveProcessIncarnation(process.pid) ?? null,
      host: hostname(),
    })
    expect(composeRunOwnership()).toBe(ownership)
  })
})

describe('C442-OWNER-CLASSIFY', () => {
  it('the composed probe reads real processes', async () => {
    requirePosix()
    const ownership = composeRunOwnership()
    expect(typeof ownership.self.incarnation).toBe('string')
    const host = hostname()

    const finished = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    const finishedPid = requirePid(finished)
    await exited(finished)
    expect(classifyRunOwner({ pid: finishedPid, incarnation: null, host }, ownership)).toBe('gone')

    const waiting = spawn(process.execPath, ['-e', 'process.stdin.resume()'], {
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    try {
      const waitingPid = requirePid(waiting)
      const incarnation = resolveProcessIncarnation(waitingPid)
      expect(incarnation).toEqual(expect.any(String))
      const live: RunOwner = { pid: waitingPid, incarnation: incarnation ?? null, host }
      expect(classifyRunOwner(live, ownership)).toBe('alive')
      waiting.stdin?.end()
      await exited(waiting)
      expect(classifyRunOwner(live, ownership)).toBe('gone')
    } finally {
      waiting.stdin?.end()
      await exited(waiting)
    }

    expect(
      classifyRunOwner({ pid: process.pid, incarnation: 'ps-lstart:never', host }, ownership),
    ).toBe('gone')
    expect(classifyRunOwner(ownership.self, ownership)).toBe('self')
  })
})
