import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, vi } from 'vitest'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import type { RiskActionDescriptor } from '@vostride/agent-qa-schema'
import type { RunEventEnvelope } from '@vostride/agent-qa-schema'
import type { RunSubscriberHandle } from '@vostride/agent-qa-agent-local'
import {
  attachRunSubscribers,
  buildRunSafetyHooks,
  buildUnmaskingConfirm,
  createLivePauseController,
} from '../run-session-composition.js'
import { QUARANTINE_TEST_ANNOTATION } from '../reporters/console-reporter.js'
import { JUNIT_QUARANTINE_MARKER_BLOCK } from '../reporters/junit-reporter.js'
import { QUARANTINED_CHECKOUT, buildReporterFixture, createCapture } from './reporters/fixtures.js'

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

// ---- 390 D-15/D-16: the run-start snapshot reaches BOTH reporters from ONE input --------------
//
// `attachRunSubscribers` is the single place either reporter is constructed (Pitfall 8), so it is
// the single place the disposition can be dropped. Pinned by OBSERVING both surfaces render it from
// one `quarantined` argument — a wiring test that only asserted the argument was accepted would
// stay green while a reporter silently ignored it.

describe('attachRunSubscribers threads the quarantine snapshot to both reporters (390 D-15/D-16)', () => {
  it('renders the disposition on the console AND in the JUnit document from one input', async () => {
    const fixture = buildReporterFixture()
    const capture = createCapture()
    const junitPath = join(mkdtempSync(join(tmpdir(), 'agent-qa-390-07-')), 'junit.xml')
    const handlers: ((envelope: RunEventEnvelope) => void)[] = []
    const session = {
      subscribe: vi.fn((_from: number | undefined, handler: (e: RunEventEnvelope) => void) => {
        handlers.push(handler)
        return () => {}
      }),
    }

    const { flush } = attachRunSubscribers({
      session: session as never,
      // A fresh run context: this test is about the disposition reaching both surfaces, and the
      // fixture's masked prose is exercised by the reporter suites themselves.
      maskingContext: createMaskingContext(),
      console: { plain: true, colorize: false, isTTY: false, write: capture.write },
      junitOutputPath: junitPath,
      quarantined: [QUARANTINED_CHECKOUT],
    })

    for (const envelope of fixture.envelopes) for (const handler of handlers) handler(envelope)
    await flush()

    expect(capture.output()).toContain(QUARANTINE_TEST_ANNOTATION)
    expect(readFileSync(junitPath, 'utf8')).toContain(JUNIT_QUARANTINE_MARKER_BLOCK)
  })

  it('BOTH startRun sites in run.ts pass the run-start snapshot (Pitfall 8)', () => {
    const runSource = readFileSync(
      fileURLToPath(new URL('../commands/run.ts', import.meta.url)),
      'utf8',
    )
    const calls = runSource.split('attachRunSubscribers({').slice(1)
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      // the argument object ends at the first line that closes it at the call's indentation
      // shorthand (`quarantined,`) or explicit (`quarantined: singleQuarantined`)
      expect(call.slice(0, call.indexOf('})'))).toMatch(/\bquarantined[,:]/)
    }
  })
})

// ---- 385-08 (D-13): the dissection's two load-bearing controls ------------------------------

// Control 1 — the anti-shim pin. The dissection is only real if the moved symbols stopped being
// reachable through this path. A module that re-published them would leave every call site
// spelled exactly as before, which reads like a completed move and is not one: the subtree
// carve-out would then be scoping a file whose contents had gone somewhere else. So the export
// set of the CLI-side module is pinned by exact equality, and any re-export statement at all is
// an offender regardless of what it names.
describe('the CLI run-session module exports presentation ONLY (385-08 / D-13)', () => {
  const moduleSource = readFileSync(
    fileURLToPath(new URL('../run-session-composition.ts', import.meta.url)),
    'utf8',
  )

  it('exports exactly the four presentation symbols and nothing else', () => {
    const declared = [...moduleSource.matchAll(/^export (?:async )?(?:function|const|interface|type|class)\s+(\w+)/gm)]
      .map(match => match[1])
      .sort()

    expect(declared).toEqual([
      'AttachRunSubscribersInput',
      'attachRunSubscribers',
      'buildRunSafetyHooks',
      'buildUnmaskingConfirm',
      'createLivePauseController',
    ].sort())
  })

  it('carries no re-export of any kind — a compatibility shim would defeat the move', () => {
    expect(moduleSource).not.toMatch(/^export\s+\*/m)
    expect(moduleSource).not.toMatch(/^export\s*(?:type\s*)?\{[^}]*\}\s*from/m)
  })
})

// Control 2 — the confirm nesting the dissection had to re-plumb. Before the move, the human
// unmasking decorator wrapped the timing decorator, so the interval `confirmPausedMs()` reports is
// the person's deliberation and not the host's rendering of the question. The composition now owns
// the timing and the host hands its decoration in, which is precisely the seam where that order can
// invert without anything failing to compile. Pinned observably: the live seam burns wall-clock in
// `pauseLive`, so if the decoration ever ends up INSIDE the timing, that burn lands in the total.
describe('human decoration composes OUTSIDE the pause timing (385-08 / D-10 / D-11)', () => {
  it('does not count the host prompt rendering against the measured human pause', async () => {
    const PAUSE_BURN_MS = 60
    const ctx = createMaskingContext()
    ctx.register('sk-live-NESTING-0987654321')

    const live = createLivePauseController()
    live.bind({
      pauseLive() {
        const until = Date.now() + PAUSE_BURN_MS
        while (Date.now() < until) { /* deliberate synchronous burn inside the host decoration */ }
      },
      resumeLive() { /* no-op */ },
    })

    const auditSink = {
      appendExecutionAudit() { /* no-op */ },
      appendGuardrailAudit() { /* no-op */ },
    }

    const { safetyHooks, confirmPausedMs } = buildRunSafetyHooks({
      auditSink,
      executionContext: 'local-interactive',
      trustMode: false,
      confirm: async () => true,
      maskingContext: ctx,
      live,
    })

    const result = await safetyHooks.runToolCallAsync({ name: 'delete_record', recognized: true })
    expect(result.action).toBe('allow')

    // The burn happened — the decoration really did run — but it is not in the measured total.
    expect(confirmPausedMs()).toBeLessThan(PAUSE_BURN_MS / 2)
  })
})
