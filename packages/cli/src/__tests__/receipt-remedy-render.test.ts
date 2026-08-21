// The CLI's half of D-15: this door renders the remedies IT can take, and nothing else (400-02).
//
// WHAT THE TODO MEASURED, AND WHAT THIS FILE HOLDS. `399-friction-refusal-remedies-unreachable`
// chased the fail-closed denial's two remedies from the surface that issued them and found the
// flag declared on a different command and the confirm port unnamed. The repair is structural:
// the gate mints typed remedies, and each surface projects them through `remediesRenderableBy`.
// The projection is the security-relevant half (T-400-06), so both directions are measured here —
// the CLI DOES render what it can take, and it renders NOTHING when the projection is empty.
//
// HONEST ABSENCE IS THE HARDER HALF and it is why the empty case is a cell rather than an
// assumption. A render that reached for a line when it had nothing to offer would be the defect
// re-minted: the reader spends time on a way forward that is not there. `[reason]` and nothing
// appended is the whole assertion.
//
// DRIVEN THROUGH THE SHIPPED PRODUCERS. The remedy fixtures come from `evaluate()` — the real
// gate, on real actions — rather than from hand-built literals, so a cell cannot pass against a
// remedy shape the gate never mints (the produced-not-literal corpus law).

import { describe, expect, it } from 'vitest'

import { evaluate } from '@vostride/agent-qa-safety'
import {
  remediesRenderableBy,
  type GateRemedy,
  type RiskActionDescriptor,
} from '@vostride/agent-qa-schema'

import { denialDetailLines } from '../commands/receipt-line.js'

const REASON = 'Denied authoring.draft.write: fail-closed: ask in local-headless without trust'

const mutatingSharedAction: RiskActionDescriptor = {
  name: 'push_to_remote',
  recognized: true,
  declaredTier: 'mutating-shared',
}

const restrictedAction: RiskActionDescriptor = {
  name: 'run_shell',
  recognized: true,
  command: 'rm -rf /',
}

async function remediesFor(
  action: RiskActionDescriptor,
  ctx: 'local-headless' | 'local-interactive',
): Promise<readonly GateRemedy[]> {
  return (await evaluate(action, ctx)).remedies
}

describe('a refused receipt whose remedies project non-empty', () => {
  it('renders the CLI affordance AFTER the canonical reason, reason first and unedited', async () => {
    const remedies = await remediesFor(mutatingSharedAction, 'local-headless')
    expect(remediesRenderableBy('cli', remedies).length).toBeGreaterThan(0)

    const lines = denialDetailLines(REASON, remedies)

    expect(lines[0]).toBe(REASON)
    expect(lines.length).toBeGreaterThan(1)
    // The flag is named, and named WITH the command it is declared on — the half of the finding a
    // bare flag name could not have carried.
    expect(lines.join('\n')).toContain('--trust-session')
    expect(lines.join('\n')).toContain('agent-qa run')
  })

  it('renders one line per CLI-renderable remedy and no line for the others', async () => {
    const remedies = await remediesFor(mutatingSharedAction, 'local-headless')
    const projected = remediesRenderableBy('cli', remedies)

    const lines = denialDetailLines(REASON, remedies)

    expect(lines).toHaveLength(1 + projected.length)
  })

  it('renders nothing a CLI reader cannot take, even when the gate minted it', async () => {
    // The session-pin remedy is a chat/dashboard affordance: a pin ends with the session, and the
    // one-shot CLI door has none. It must reach this render and produce no line.
    const pinned = await evaluate(mutatingSharedAction, 'local-interactive', {}, {
      deny: () => true,
    })
    expect(pinned.remedies.length).toBeGreaterThan(0)
    expect(remediesRenderableBy('cli', pinned.remedies)).toEqual([])

    expect(denialDetailLines(REASON, pinned.remedies)).toEqual([REASON])
  })
})

describe('a refused receipt whose projection is empty', () => {
  it('renders the reason with nothing appended — honest absence', async () => {
    const remedies = await remediesFor(restrictedAction, 'local-interactive')
    expect(remedies).toEqual([])

    expect(denialDetailLines(REASON, remedies)).toEqual([REASON])
  })

  it('appends nothing for an empty remedy list', () => {
    expect(denialDetailLines(REASON, [])).toEqual([REASON])
  })
})
