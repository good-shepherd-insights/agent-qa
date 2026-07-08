import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import type { RiskActionDescriptor } from '@vostride/agent-qa-schema'
import type { RunEventEnvelope } from '@vostride/agent-qa-schema'
import {
  attachRunSubscribers,
  buildUnmaskingConfirm,
  createLivePauseController,
  type RunSubscriberHandle,
} from '../run-session-composition.js'

// 363-09 Task 2 / Task 1 — the composition swap seam: the D-11 unmasking confirm decorator and the
// shared `attachRunSubscribers` helper both startRun sites use (Pitfall 8). Reporter RENDERING is
// unit-tested in reporters/*.test.ts; here we pin the composition contract.

describe('buildUnmaskingConfirm (D-11 / Pitfall 4)', () => {
  it('delivers the UNMASKED prompt to the readline confirm while the deny record stays MASKED', async () => {
    const secret = 'sk-live-CONFIRM-1234567890'
    const ctx = createMaskingContext()
    ctx.register(secret)
    const maskedName = ctx.mask(`git push with token ${secret}`)
    // sanity: the action the gate holds is masked (the placeholder replaced the original)
    expect(maskedName).not.toContain(secret)
    expect(maskedName).toContain('<')

    const seen: RiskActionDescriptor[] = []
    const base = vi.fn(async (action: RiskActionDescriptor) => {
      seen.push(action)
      return false // deny
    })

    const events: string[] = []
    const live = createLivePauseController()
    live.bind({
      pauseLive: () => events.push('pause'),
      resumeLive: () => events.push('resume'),
    })

    const confirm = buildUnmaskingConfirm({ base, maskingContext: ctx, live })
    const maskedAction: RiskActionDescriptor = { name: maskedName, recognized: true }
    const answer = await confirm(maskedAction)

    // (1) the human-facing prompt (delivered to the stubbed readline) shows the ORIGINAL value
    expect(seen).toHaveLength(1)
    expect(seen[0].name).toContain(secret)
    // (2) the console reporter's pause/resume seam wrapped the question (Pitfall 4)
    expect(events).toEqual(['pause', 'resume'])
    // (3) the caller's masked action is never mutated — the gate's deny/audit record stays MASKED
    expect(maskedAction.name).toBe(maskedName)
    expect(maskedAction.name).not.toContain(secret)
    // (4) the deny answer is preserved verbatim
    expect(answer).toBe(false)
  })

  it('resumes the live line even when the base confirm throws (no wedged TTY)', async () => {
    const ctx = createMaskingContext()
    const events: string[] = []
    const live = createLivePauseController()
    live.bind({ pauseLive: () => events.push('pause'), resumeLive: () => events.push('resume') })
    const confirm = buildUnmaskingConfirm({
      base: async () => { throw new Error('readline blew up') },
      maskingContext: ctx,
      live,
    })

    await expect(confirm({ name: 'plain action', recognized: true })).rejects.toThrow('readline blew up')
    expect(events).toEqual(['pause', 'resume'])
  })
})

describe('attachRunSubscribers (bus composition swap, 363-09)', () => {
  function fakeSession(): { subscribe: ReturnType<typeof vi.fn> } {
    return { subscribe: vi.fn((_from: number | undefined, _h: (e: RunEventEnvelope) => void) => () => {}) }
  }

  it('subscribes console + junit + wire + extra subscribers all from the replay-then-live floor (seq 1)', async () => {
    const ctx = createMaskingContext()
    const session = fakeSession()
    const extraFlush = vi.fn().mockResolvedValue(undefined)
    const extra: RunSubscriberHandle = { handler: vi.fn(), flush: extraFlush }

    const live = createLivePauseController()
    const { flush } = attachRunSubscribers({
      session: session as never,
      maskingContext: ctx,
      console: { verbose: false, write: () => {} },
      junitOutputPath: join(tmpdir(), `agent-qa-junit-${Date.now()}.xml`),
      extraSubscribers: [extra],
      live,
    })

    // console + junit + wire + one extra = 4 subscriptions, every one from seq 1 (D-04 full replay).
    expect(session.subscribe).toHaveBeenCalledTimes(4)
    for (const call of session.subscribe.mock.calls) {
      expect(call[0]).toBe(1)
    }

    await flush()
    expect(extraFlush).toHaveBeenCalledTimes(1)
  })

  it('skips the console subscriber and unbinds the live seam when console is false', async () => {
    const ctx = createMaskingContext()
    const session = fakeSession()
    const live = createLivePauseController()
    const bindSpy = vi.spyOn(live, 'bind')

    attachRunSubscribers({
      session: session as never,
      maskingContext: ctx,
      console: false,
      live,
    })

    // only the wire subscriber attaches (console skipped, no junit, no extras).
    expect(session.subscribe).toHaveBeenCalledTimes(1)
    // the live seam is cleared (no console handle to bind) so the confirm decorator no-ops safely.
    expect(bindSpy).toHaveBeenCalledWith(undefined)
    // pause/resume through an unbound controller must not throw.
    expect(() => { live.pauseLive(); live.resumeLive() }).not.toThrow()
  })

  it('best-effort flush: a rejecting subscriber flush never rejects the combined flush (RUNX-03)', async () => {
    const ctx = createMaskingContext()
    const session = fakeSession()
    const rejecting: RunSubscriberHandle = {
      handler: vi.fn(),
      flush: vi.fn().mockRejectedValue(new Error('posthog down')),
    }
    const settling: RunSubscriberHandle = { handler: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) }

    const { flush } = attachRunSubscribers({
      session: session as never,
      maskingContext: ctx,
      console: false,
      extraSubscribers: [rejecting, settling],
    })

    await expect(flush()).resolves.toBeUndefined()
    // every subscriber's flush still ran despite the rejection (allSettled).
    expect(rejecting.flush).toHaveBeenCalledTimes(1)
    expect(settling.flush).toHaveBeenCalledTimes(1)
  })
})
