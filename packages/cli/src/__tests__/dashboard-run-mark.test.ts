// The real composition must preserve the route's asking frame through AgentHost.invokeFunction.
// 432-13: there is no asking frame left to preserve; the cells below pin that the route dispatches.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createConfirmRegistry, markRun, mintRunTriggerConfirmScope, type ChatConfirmChannelFrame } from '@vostride/agent-qa-dashboard'
import { RUNS_MARK_FUNCTION_ID } from '@vostride/agent-qa-agent'
import { afterEach, describe, expect, it } from 'vitest'

import { composeDashboardDoor } from '../commands/dashboard.js'

const closers: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of closers.splice(0)) await close() })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-419-mark-door-'))
  const configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(configPath, JSON.stringify({
    workspace: { testMatch: ['tests/**/*.test.yaml'], suiteMatch: ['suites/**/*.suite.yaml'], hooksFile: 'hooks.yaml', envFile: '.env', secretsFile: '.env.secrets.local' },
    use: { mobile: { appState: 'reset' } },
    registry: { targets: { conformance: { platform: 'web', url: 'https://conformance.invalid' } } },
    safety: { trustMode: true },
  }))
  const confirms = createConfirmRegistry({ timeoutMs: 3000 })
  const door = composeDashboardDoor({ agentQaRoot: join(root, '.agent-qa'), configPath, boundOrigin: () => undefined, confirms })
  const frames: Array<{ scope: string; frame: ChatConfirmChannelFrame }> = []
  const unsubscribe = confirms.subscribe((scope, frame) => { frames.push({ scope, frame }) })
  const channels: Array<() => void> = []
  closers.push(async () => { for (const close of channels) close(); unsubscribe(); await door.host.close(); rmSync(root, { recursive: true, force: true }) })
  const scope = mintRunTriggerConfirmScope()
  const open = () => { channels.push(confirms.openChannel(scope)) }
  const invoke = (confirmScope?: string) => markRun(door.agentHost, 'run-mark-absent', { kind: 'false-fail', note: 'private note' }, {
    ...(confirmScope === undefined ? {} : { confirmScope }), enter: door.agentHost.enterRunTriggerScope,
  })
  return { ...door, confirms, frames, channels, scope, open, invoke }
}

// RE-SPELLED 2026-09-30 (432-13, D-14/D-15). The route used to park on the named run channel and
// deny an absent or unwatched scope, even under config trustMode. The composed host asks nobody now:
// the mark dispatches with or without a scope, with or without a watched channel, and no confirm
// frame is ever raised. The absent fixture run is what answers, which proves the op was reached.
describe('dashboard runs.mark confirmation through the composed host (419 D-13)', () => {
  it('binds the actual op id and dispatches with an absent or unwatched scope, raising no frame', async () => {
    const f = fixture()
    expect(f.agentHost.runsMarkFunctionId).toBe(RUNS_MARK_FUNCTION_ID)
    for (const scope of [undefined, f.scope]) {
      expect(await f.invoke(scope)).toMatchObject({ kind: 'ok', body: { kind: 'run-not-found' } })
    }
    expect(f.frames).toEqual([])
    expect(f.confirms.pendingCount()).toBe(0)
  })

  it('dispatches on a WATCHED run channel too, and never parks on it', async () => {
    const f = fixture()
    f.open()
    expect(await f.invoke(f.scope)).toMatchObject({ kind: 'ok', body: { kind: 'run-not-found' } })
    expect(f.frames.filter(row => row.frame.kind === 'confirm_request')).toEqual([])
    expect(f.confirms.pendingCount()).toBe(0)
  })
})
