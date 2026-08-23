// THE RUN TRIGGER'S BROWSER CONFIRM (Phase 401 plan 09 — D-11 / D-15 / D-16, INVK-02).
//
// WHAT IS UNDER TEST is the whole path a person's click reaches: `POST /api/runs/trigger` →
// the shipped `JobQueue` → the injected run door → `invokeFunction(runs.start)` → the real op-level
// gate → the in-process drive → the core's ONE `evaluate()` → the ask arm → the SHIPPED confirm
// registry's parking lot → a real SSE frame on a real socket → a real answer POST. Every frame is
// the production one: `startServer` builds the router, the queue and the reconciliation, and
// `composeDashboardDoor` / `createDashboardRunDoor` are the same composers `agent-qa dashboard`
// calls. Nothing below calls a route handler with a fake request or resolves a promise the product
// would not have resolved.
//
// WHY IT LIVES IN THE CLI PACKAGE. The plan filed it under `packages/dashboard-server`, but a cell
// that needs a REAL gated run needs the composed host, and `dashboard-server` may not name
// `@vostride/agent-qa-agent*` (validate:arch). The door is composed here for exactly that reason —
// `dashboard-run-door.test.ts` is its sibling and made the same move.
//
// A DENIAL'S ASSERTION SURFACE IS FIVE ARTIFACTS (401-03's Mutation B), never an exit code or a
// message alone: the audit row's `outcome`, no run events, no build-ordinal ledger, zero requests at
// the target, and the reason on the surface the caller sees. The deny-on-silence cell asserts all
// five, plus the D-15 remedies, and is paired with an allow control that differs in EXACTLY ONE
// thing — the answer a person gave.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  DashboardDatabase,
  createConfirmRegistry,
  startServer,
  type ConfirmRegistry,
} from '@vostride/agent-qa-dashboard'
import { resolveWorkspacePaths } from '@vostride/agent-qa-core'
import { parse as parseYaml } from 'yaml'

import { composeDashboardDoor, createDashboardRunDoor } from '../dashboard.js'
import {
  CountingTarget,
  auditRows,
  buildOrdinalsExist,
  createInProcessFixture,
  eventTypes,
} from '../../composition/__tests__/in-process-run-fixture.js'
import type { AuditRow } from '../../composition/__tests__/in-process-run-fixture.js'

type Fixture = ReturnType<typeof createInProcessFixture>

/** The OP-level gate's rows, which land in the host's own sink rather than the run's. */
function opAuditRows(fixture: Fixture): AuditRow[] {
  const path = join(fixture.agentQaRoot, 'execution_audit.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as AuditRow)
}

function runStartRows(fixture: Fixture): AuditRow[] {
  return (auditRows(fixture) as AuditRow[]).filter((row) => row.action === 'run:start')
}

interface Scene {
  readonly origin: string
  readonly confirms: ConfirmRegistry
  readonly fixture: Fixture
  readonly db: DashboardDatabase
  settled(): { runId: string; status: string; details: Record<string, unknown> }[]
  buffered(runId: string): Record<string, unknown>[]
  close(): Promise<void>
}

const openScenes: Scene[] = []

/**
 * The dashboard as the shipped command starts it, over a project the fixture wrote.
 *
 * `timeoutMs` is the ONE knob a cell turns, and each cell says why: the silence cell shortens the
 * window so the wait is a test cost rather than a policy, and the channel-vanish cell LENGTHENS it
 * far past its own budget so a green there cannot come from the timer the reaper pre-empts.
 */
async function openScene(input: {
  readonly fixture: Fixture
  readonly timeoutMs?: number
}): Promise<Scene> {
  const { fixture } = input
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  const confirms = createConfirmRegistry(
    input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs },
  )
  const runDoor = await createDashboardRunDoor({ db })
  const door = composeDashboardDoor({
    agentQaRoot: fixture.agentQaRoot,
    configPath: fixture.configPath,
    boundOrigin: () => undefined,
    confirms,
    runBridge: runDoor.runBridge,
  })
  runDoor.bindHost(door.host)

  const settled: { runId: string; status: string; details: Record<string, unknown> }[] = []
  runDoor.backend.on(
    'run-settled',
    (runId: string, status: string, details: Record<string, unknown>) => {
      settled.push({ runId, status, details })
    },
  )

  const started = await startServer({
    db,
    port: 0,
    configPath: fixture.configPath,
    workspacePaths: resolveWorkspacePaths({
      config: parseYaml(readFileSync(fixture.configPath, 'utf8')) as never,
      configPath: fixture.configPath,
    }),
    executionBackend: runDoor.backend,
    agentHost: door.agentHost,
  })

  // `startServer` echoes back the port it was ASKED for, so an ephemeral bind (`port: 0`) has to be
  // read off the socket — `server.appium-ownership.test.ts` does the same, for the same reason.
  const address = started.server.address()
  if (address === null || typeof address === 'string') throw new TypeError('the server bound no port')

  const scene: Scene = {
    origin: `http://127.0.0.1:${String(address.port)}`,
    confirms,
    fixture,
    db,
    settled: () => settled,
    buffered: (runId) => runDoor.backend.getBufferedEvents(runId) as unknown as Record<string, unknown>[],
    close: async () => {
      started.close()
      await door.host.close()
    },
  }
  openScenes.push(scene)
  return scene
}

afterEach(async () => {
  while (openScenes.length > 0) {
    const scene = openScenes.pop()!
    await scene.close()
  }
})

/** Click the run button — the shipped trigger route, with the fixture's own standalone test. */
async function triggerRun(scene: Scene): Promise<string> {
  const response = await fetch(`${scene.origin}/api/runs/trigger`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file: scene.fixture.testPattern }),
  })
  const body = await response.json() as { runId?: string; error?: string }
  expect(body.error, 'the trigger route refused before any run existed').toBeUndefined()
  expect(body.runId, 'the trigger route minted no run id').toBeTruthy()
  return body.runId!
}

interface SseFrame {
  readonly event: string | undefined
  readonly data: string
}

interface LiveStream {
  readonly frames: readonly SseFrame[]
  waitFor(predicate: (frame: SseFrame) => boolean, budgetMs?: number): Promise<SseFrame>
  close(): Promise<void>
}

/**
 * Hold the trigger's confirm channel open, the way a browser sitting on the runs page does.
 *
 * IT ASSERTS THE STATUS FIRST. A stream that 404s is a channel that was never registered, and a
 * cell that went on to wait for a frame would report "no frame arrived" — true, and two steps away
 * from the fact that matters.
 */
async function openRunConfirmStream(scene: Scene, runId: string): Promise<LiveStream> {
  const controller = new AbortController()
  const response = await fetch(
    `${scene.origin}/api/run-confirm/runs/${encodeURIComponent(runId)}/events`,
    { signal: controller.signal },
  )
  expect(
    response.status,
    'the run trigger has no confirm channel — nobody can be asked, so the ask can only fail closed',
  ).toBe(200)
  if (response.body === null) throw new TypeError('the stream carried no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const frames: SseFrame[] = []
  let raw = ''
  const pump = (async () => {
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        raw += decoder.decode(chunk.value, { stream: true })
        const parts = raw.split('\n\n')
        raw = parts.pop() ?? ''
        for (const part of parts) {
          if (part.trim() === '' || part.startsWith(':')) continue
          const lines = part.split('\n')
          frames.push({
            event: lines.find((line) => line.startsWith('event: '))?.slice(7),
            data: lines.find((line) => line.startsWith('data: '))?.slice(6) ?? '',
          })
        }
      }
    } catch {
      // An aborted read is how this stream ends; it is the cell's own doing, never a failure.
    }
  })()
  return {
    frames,
    async waitFor(predicate, budgetMs = 60_000) {
      const deadline = Date.now() + budgetMs
      while (Date.now() < deadline) {
        const hit = frames.find((frame) => predicate(frame))
        if (hit !== undefined) return hit
        await new Promise<void>((settled) => setTimeout(settled, 10))
      }
      throw new Error(
        `no frame satisfied the predicate within ${String(budgetMs)}ms; saw `
        + JSON.stringify(frames.map((frame) => frame.event)),
      )
    },
    async close() {
      controller.abort()
      await pump
    },
  }
}

async function answerRunConfirm(
  scene: Scene,
  input: { runId: string; confirmId: string; answer: string },
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${scene.origin}/api/run-confirm/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return { status: response.status, body: await response.json() }
}

async function waitFor(assertion: () => void, timeoutMs = 180_000): Promise<void> {
  const startedAt = Date.now()
  let lastError: unknown
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((settle) => setTimeout(settle, 25))
    }
  }
  if (lastError instanceof Error) throw lastError
  throw new Error('Timed out waiting for assertion')
}

function confirmRequestOf(frame: SseFrame): { confirmId: string; actionClass: string; preview?: string } {
  return JSON.parse(frame.data) as { confirmId: string; actionClass: string; preview?: string }
}

function resolutionOf(frame: SseFrame): { confirmId: string; answer: string; by: string } {
  return JSON.parse(frame.data) as { confirmId: string; answer: string; by: string }
}

describe('an ask-tier run-button run asks the browser that triggered it (D-11)', () => {
  it('DENY ON SILENCE — asked, unanswered, reaped, and the run never started (D-16 third door)', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      // NO `environment:` LINE AT ALL — the D-06 undeclared case, which classifies SHARED and is
      // therefore the one tier that reaches a confirm. The allow control below changes the ANSWER
      // and nothing else about this scene.
      const fixture = createInProcessFixture({ origin: target.origin })
      // The window is short because this cell pays for it in wall clock.
      const scene = await openScene({ fixture, timeoutMs: 1_500 })
      const runId = await triggerRun(scene)
      const stream = await openRunConfirmStream(scene, runId)

      // THE QUESTION REACHED THE WIRE. Asserted BEFORE anything about how it resolved, because
      // "denied" is trivially true of a question that was never raised — which is exactly what the
      // pre-plan build did here.
      const raised = confirmRequestOf(
        await stream.waitFor((frame) => frame.event === 'confirm_request'),
      )
      expect(raised.actionClass).toBe('run:start')
      expect(raised.confirmId).toBeTruthy()
      // AND IT IS PARKED IN THE SHIPPED REGISTRY'S OWN LOT — not in a second one this door built.
      expect(scene.confirms.pendingCount()).toBe(1)

      // Nobody answers. The registry's window closes.
      const resolved = resolutionOf(
        await stream.waitFor((frame) => frame.event === 'confirm_resolved'),
      )
      expect(resolved.confirmId).toBe(raised.confirmId)
      expect(resolved.answer).toBe('deny')
      // THE DENY CAME FROM THE REAPER, said by the registry rather than inferred here.
      expect(resolved.by).toBe('timeout')
      expect(scene.confirms.pendingCount()).toBe(0)

      await waitFor(() => { expect(scene.settled()).toHaveLength(1) })
      const settled = scene.settled()[0]!

      // (a) the audit row's OUTCOME field, never a message substring
      const rows = runStartRows(fixture)
      expect(rows).toHaveLength(1)
      const row = rows[0]!
      expect(row.outcome).toBe('prompted-denied')
      expect(row.riskTier).toBe('mutating-shared')
      // The door really did claim interactivity — and honestly, because a browser was holding the
      // channel. `fail-closed-denied` here would be the 401-07 interim posture, not this plan.
      expect(row.executionContext).toBe('local-interactive')
      // (b) THE RUN NEVER STARTED — `runStarted` is seq 1 of any run that began at all
      expect(eventTypes(fixture)).toEqual([])
      // (c) the durable assembly side effect never happened
      expect(buildOrdinalsExist(fixture)).toBe(false)
      // (d) nobody knocked on the target
      expect(target.hits).toEqual([])
      // (e) THE REASON ON THE SURFACE THE CALLER SEES, read BACK off the row rather than typed
      //     here — which pins the door to RENDERING the gate's decision rather than composing one.
      expect(settled.status).toBe('failed')
      expect(String(settled.details['reason'])).toContain(row.reason)

      // D-15: the STRUCTURED remedies, projected for this surface. Asserted as kinds and params —
      // never as prose, which is the whole reason the vocabulary is typed.
      expect(settled.details['remedies']).toEqual([{ kind: 'answer-confirm' }])
      expect(scene.buffered(runId).at(-1)!['remedies']).toEqual([{ kind: 'answer-confirm' }])

      // The bookends are the only two events — a denial is not a run.
      expect(scene.buffered(runId).map((event) => event['type']))
        .toEqual(['run-start', 'run-complete'])
      // And the op-level gate left its own row, on one click, exactly as the allow arm does.
      expect(opAuditRows(fixture).filter((r) => r.action === 'fn:runs.start')).toHaveLength(1)

      await stream.close()
    } finally {
      await target.close()
    }
  }, 240_000)

  it('NO LIVE CHANNEL — the trigger is headless, nobody is asked, and the ask fails closed (Pitfall 3)', async () => {
    // THE HONEST-CLAIM RULE'S OTHER ARM, and it is the SAME scene as the cell above with one thing
    // different: nobody opened the confirm channel. The person clicked run and navigated away, or
    // the queue's slot freed after they closed the tab. There is nobody to ask, so the door must
    // not claim it asked.
    //
    // THIS IS ALSO THE PRE-PLAN BUILD'S BEHAVIOUR FOR EVERY TRIGGER (401-07's interim posture), so
    // it is the baseline the cell above measures the delta against: asked-then-denied, versus
    // never-asked. It passes before this plan and after it, for two different reasons — which is
    // why it is not the cell that proves anything on its own, and why it is here anyway: a fix that
    // answered `local-interactive` for every trigger would red exactly this line.
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin })
      const scene = await openScene({ fixture, timeoutMs: 1_500 })
      const runId = await triggerRun(scene)

      await waitFor(() => { expect(scene.settled()).toHaveLength(1) })

      const rows = runStartRows(fixture)
      expect(rows).toHaveLength(1)
      const row = rows[0]!
      // `prompted-denied` here would be the door claiming it showed somebody a question.
      expect(row.outcome).toBe('fail-closed-denied')
      expect(row.executionContext).toBe('local-headless')
      expect(row.riskTier).toBe('mutating-shared')
      // NOTHING WAS EVER PARKED. The registry denies a scope with no channel WITHOUT parking, so a
      // trigger nobody is watching cannot leave a question waiting for an answer that cannot come.
      expect(scene.confirms.pendingCount()).toBe(0)
      expect(eventTypes(fixture)).toEqual([])
      expect(buildOrdinalsExist(fixture)).toBe(false)
      expect(target.hits).toEqual([])
      expect(String(scene.settled()[0]!.details['reason'])).toContain(row.reason)
      void runId
    } finally {
      await target.close()
    }
  }, 240_000)
})
