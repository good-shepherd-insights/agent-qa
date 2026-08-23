// The answering surface survives the two places it can be lost (G-401-17).
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

/** A confirm binding that approves, declaring the surface it is standing in for. */
function approving(surface: 'tty-prompt' | 'browser-click'): ConfirmPort {
  return { surface, ask: () => true }
}

function auditRowsAt(dir: string): ExecutionAuditRow[] {
  return readFileSync(join(dir, 'execution_audit.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as ExecutionAuditRow)
}

describe('a decorator forwards the surface of the port it wraps', () => {
  // DRIVEN END TO END through the CLI's own `buildRunSafetyHooks`, which is the assembly both
  // `startRun` sites call. That composition stacks BOTH shipped run-path decorators over whatever
  // port it is handed — the pause-timing one in `run-composition.ts` and, because a masking context
  // is supplied, the unmasking one in this package — and hands the result to the gate. So the row
  // read off disk below has been through two wrappers, and either dropping the surface reds it.
  it.each(['tty-prompt', 'browser-click'] as const)(
    'a %s port behind two decorators still lands its own surface on the row',
    async (surface) => {
      const configDir = mkdtempSync(join(tmpdir(), 'confirm-surface-'))
      const runId = `r_decorated-${surface}`
      const auditSink = buildRunAuditSink({
        configDir,
        runId,
        executionContext: 'local-interactive',
      })

      const { safetyHooks, confirmPausedMs } = buildRunSafetyHooks({
        auditSink,
        executionContext: 'local-interactive',
        trustMode: false,
        confirm: approving(surface),
        // Supplied so the SECOND decorator is in the stack. Without it `decorateConfirmForHuman` is
        // absent and only the timing wrapper runs, which would measure one of the two chances.
        maskingContext: createMaskingContext(),
      })

      const result = await safetyHooks.runToolCallAsync({ ...ASK_TIER_ACTION })
      expect(result.action).toBe('allow')

      // THE DECORATORS REALLY RAN. A stack that had been bypassed would leave this at zero, and the
      // cell would then be asserting the surface of an undecorated port.
      expect(confirmPausedMs()).toBeGreaterThan(0)

      const rows = auditRowsAt(join(resolve(configDir, '.agent-qa'), RUNS_SUBDIR, slugBranch(runId)))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ outcome: 'prompted-approved', trustSource: surface })
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
    return auditRowsAt(ws.agentQaRoot)
  }

  it('records the CHAT port when a chat confirm is bound — it wins the ??', async () => {
    const rows = await revokeThrough({
      chat: approving('browser-click'),
      door: approving('tty-prompt'),
    })

    const asked = rows.filter((row) => row.outcome === 'prompted-approved')
    expect(asked).toHaveLength(1)
    expect(asked[0]!.trustSource).toBe('browser-click')
  })

  it('records the DOOR port when no chat confirm is bound — the other arm of the same ??', async () => {
    const rows = await revokeThrough({ door: approving('tty-prompt') })

    const asked = rows.filter((row) => row.outcome === 'prompted-approved')
    expect(asked).toHaveLength(1)
    expect(asked[0]!.trustSource).toBe('tty-prompt')
  })
})
