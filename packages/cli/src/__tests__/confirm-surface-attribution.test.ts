// The answering surface survives the two places it can be lost (G-401-17).
//
// SINCE 432-13 (D-14/D-15) neither place exists on a shipped road: run composition no longer reads
// the presentation confirm, and no door hands the op gate a port because there is no op gate. Both
// describes were re-spelled to measure that absence the same way — by driving the seam and reading
// what landed on disk — with a port that records being asked. The history below is kept as written.
//
// The gate now records the surface the composition DECLARED rather than the mechanism rung (e) used
// to hardcode. Declaring it is a compile obligation — `packages/safety/src/ports/__tests__/
// confirm-surface.test-d.ts` pins that half — but two things can still carry an honest declaration
// and land a dishonest row, and neither is a type error, because both still satisfy `ConfirmPort`:
//
//   (1) A DECORATOR that names a surface of its own instead of forwarding the one it wraps. There
//       are three over this port today (`timedConfirm`, `decorateConfirmForHuman`'s unmasking
//       implementation, and the dashboard's run-gate forwarder) and each is an independent chance
//       to drop the value.
//   (2) THE TWO-PORT SEAM in `compose-local-agent.ts` — `chatConfirmPort ?? input.confirm` — where
//       two ports meet and one wins at call time. A surface resolved anywhere but ON the winning
//       port is a second fact free to disagree with it.
//
// Both are measured here by DRIVING them and reading the row a person audits off disk, never by
// inspecting the port object: an assertion on `port.surface` would pass on a decorator that
// forwards the field and then delegates to something else entirely.

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { invokeFunction } from '@vostride/agent-qa-agent'
import { buildRunAuditSink } from '@vostride/agent-qa-agent-local'
import { RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import type { ConfirmPort, ExecutionAuditRow } from '@vostride/agent-qa-safety'
import { runSafetyScope } from '@vostride/agent-qa-safety-local'
import { describe, expect, it } from 'vitest'

import {
  CLI_FUNCTION_CALLER,
  composeCliLocalAgent,
} from '../composition/local-agent-host.js'
import { buildRunSafetyHooks } from '../run-session-composition.js'

const ASK_TIER_ACTION = { name: 'delete_record', recognized: true } as const

function auditRowsAt(dir: string): ExecutionAuditRow[] {
  return readFileSync(join(dir, 'execution_audit.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as ExecutionAuditRow)
}

/** A confirm binding that records being asked, declaring the surface it stands in for. */
function recording(surface: 'tty-prompt' | 'browser-click', calls: string[]): ConfirmPort {
  return { surface, ask: (action) => { calls.push(`${surface}:${action.name}`); return true } }
}

function auditRowsIfAny(dir: string): ExecutionAuditRow[] {
  try {
    return auditRowsAt(dir)
  } catch {
    return []
  }
}

// RE-SPELLED 2026-09-30 (432-13). Was 'a %s port behind two decorators still lands its own surface
// on the row': `buildRunSessionSafetyHooks` no longer reads `presentation.confirm`, so no decorator
// stack is built over the port and the port is never asked. The in-run hook still classifies the
// action and records its own decision; what it cannot do any more is reach a person.
describe('a decorator forwards the surface of the port it wraps', () => {
  it.each(['tty-prompt', 'browser-click'] as const)(
    'a %s port handed to the run hooks is never asked, and no prompted row lands',
    async (surface) => {
      const configDir = mkdtempSync(join(tmpdir(), 'confirm-surface-'))
      const runId = `r_decorated-${surface}`
      const auditSink = buildRunAuditSink({
        configDir,
        runId,
        executionContext: 'local-interactive',
      })
      const calls: string[] = []

      const { safetyHooks, confirmPausedMs } = buildRunSafetyHooks({
        auditSink,
        executionContext: 'local-interactive',
        trustMode: false,
        confirm: recording(surface, calls),
        maskingContext: createMaskingContext(),
      })

      await safetyHooks.runToolCallAsync({ ...ASK_TIER_ACTION })

      expect(calls).toEqual([])
      expect(confirmPausedMs()).toBe(0)
      const rows = auditRowsIfAny(join(resolve(configDir, '.agent-qa'), RUNS_SUBDIR, slugBranch(runId)))
      expect(rows.filter((row) => row.outcome === 'prompted-approved')).toEqual([])
      expect(rows.map((row) => row.trustSource)).not.toContain(surface)
    },
  )
})

describe('the two-port seam names the port that actually answered', () => {
  // `compose-local-agent.ts` resolves `chatConfirmPort ?? input.confirm` once, at composition time,
  // and hands the winner to the op-level gate. Both arms are driven here over the SAME workspace and
  // the SAME ask-tier op, with the two ports declaring DIFFERENT surfaces — so the row is the only
  // thing that can tell them apart, and a surface resolved beside the `??` rather than on the port
  // would answer the same way in both.
  function workspace(): { configPath: string; agentQaRoot: string } {
    const root = mkdtempSync(join(tmpdir(), 'confirm-seam-'))
    const configPath = join(root, 'agent-qa.config.yaml')
    const agentQaRoot = join(root, '.agent-qa')
    writeFileSync(configPath, 'workspace:\n  testMatch:\n    - tests/**/*.yaml\n')
    mkdirSync(agentQaRoot, { recursive: true })
    return { configPath, agentQaRoot }
  }

  async function revokeThrough(input: {
    readonly chat?: ConfirmPort
    readonly door: ConfirmPort
  }): Promise<ExecutionAuditRow[]> {
    const ws = workspace()
    const chat = input.chat
    const host = composeCliLocalAgent({
      agentQaRoot: ws.agentQaRoot,
      configPath: ws.configPath,
      confirm: input.door,
      ...(chat === undefined ? {} : { chatConfirm: () => chat }),
    })
    try {
      await runSafetyScope({ executionContext: 'local-interactive' }, async () => {
        // The op itself fails — there is no such grant — and that is fine and deliberate: the gate
        // decision is taken BEFORE dispatch, so the row exists either way, and a cell that needed a
        // real grant would be measuring the grants ledger rather than the confirm seam.
        await invokeFunction(
          host.registry,
          'grants.revoke',
          { grantId: 'grant_0123456789abcdef' },
          CLI_FUNCTION_CALLER,
        ).catch(() => undefined)
      })
    } finally {
      await host.close()
    }
    return auditRowsIfAny(ws.agentQaRoot)
  }

  // RE-SPELLED 2026-09-30 (432-13): the `??` seam is gone. `composeCliLocalAgent` forwards neither
  // port and `invokeFunction` asks nobody, so neither arm is consulted and the op writes no row.
  it('asks NEITHER port, whichever is bound, and writes no prompted row', async () => {
    const calls: string[] = []
    const withChat = await revokeThrough({
      chat: recording('browser-click', calls),
      door: recording('tty-prompt', calls),
    })
    const doorOnly = await revokeThrough({ door: recording('tty-prompt', calls) })

    expect(calls).toEqual([])
    expect(withChat.filter((row) => row.outcome === 'prompted-approved')).toEqual([])
    expect(doorOnly.filter((row) => row.outcome === 'prompted-approved')).toEqual([])
  })
})
