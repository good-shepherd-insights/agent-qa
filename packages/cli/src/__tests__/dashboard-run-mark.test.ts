// The real composition must preserve the route's asking frame through AgentHost.invokeFunction.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createConfirmRegistry, markRun, mintRunTriggerConfirmScope, type ChatConfirmChannelFrame } from '@vostride/agent-qa-dashboard'
import { RUNS_MARK_FUNCTION_ID } from '@vostride/agent-qa-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

describe('dashboard runs.mark confirmation through the composed host (419 D-13)', () => {
  it('binds the actual op id and denies absent/unwatched scope despite config trustMode', async () => {
    const f = fixture()
    expect(f.agentHost.runsMarkFunctionId).toBe(RUNS_MARK_FUNCTION_ID)
    for (const scope of [undefined, f.scope]) {
      expect(await f.invoke(scope)).toMatchObject({ status: 403, body: { error: 'mark_denied', remedies: [{ kind: 'answer-confirm' }] } })
    }
    expect(f.frames).toEqual([])
  })

  it.each(['accept', 'deny', 'disconnect'] as const)('parks on the named run channel and handles %s', async answer => {
    const f = fixture()
    f.open()
    const pending = f.invoke(f.scope)
    await vi.waitFor(() => expect(f.frames.some(row => row.frame.kind === 'confirm_request')).toBe(true))
    const request = f.frames.find(row => row.frame.kind === 'confirm_request')!
    expect(request.scope).toBe(f.scope)
    if (request.frame.kind !== 'confirm_request') throw new Error('missing request')
    expect(request.frame.request.actionClass).toBe(`fn:${RUNS_MARK_FUNCTION_ID}`)
    expect(f.confirms.pendingCount()).toBe(1)
    // A different watched scope cannot answer this request, and no frame means no authority
    // even while the first invocation is parked. This also checks AsyncLocalStorage isolation.
    const other = mintRunTriggerConfirmScope()
    const closeOther = f.confirms.openChannel(other)
    expect(f.confirms.answer({ scopeId: other, confirmId: request.frame.request.confirmId, answer: 'accept' })).toEqual({ kind: 'unknown-confirm' })
    expect(await f.invoke()).toMatchObject({ status: 403, body: { error: 'mark_denied' } })
    closeOther()
    if (answer === 'disconnect') f.channels[0]!()
    else f.confirms.answer({ scopeId: f.scope, confirmId: request.frame.request.confirmId, answer })
    const result = await pending
    if (answer === 'accept') {
      // Feedback is actually bound: after explicit approval it reports the absent fixture run.
      expect(result).toMatchObject({ kind: 'ok', body: { kind: 'run-not-found' } })
    } else expect(result).toMatchObject({ status: 403, body: { error: 'mark_denied' } })
    expect(f.confirms.pendingCount()).toBe(0)
    expect(f.confirms.answer({ scopeId: f.scope, confirmId: request.frame.request.confirmId, answer: 'accept' })).toEqual({ kind: 'unknown-confirm' })
  })
})
