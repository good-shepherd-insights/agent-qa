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

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

/** `packages/cli/src/commands/__tests__` → the `agent-qa` repo root, five levels up. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')

/** The OP-level gate's rows, which land in the host's own sink rather than the run's. */
function opAuditRows(fixture: Fixture): AuditRow[] {
  const path = join(fixture.agentQaRoot, 'execution_audit.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as AuditRow)
}

/**
 * Every `run:start` decision this project recorded, IN THE ORDER THEY WERE TAKEN.
 *
 * SORTED, AND THE SORT IS LOAD-BEARING. Each run writes to its OWN run-scoped sink, so
 * `auditRows` concatenates one file per run directory in whatever order the directory listing
 * yields — which is not chronological, and is stable enough to look chronological in a one-run
 * cell. A two-run cell that indexed positionally would read the second run's verdict off the first
 * run's row roughly half the time; measured, in the always-arm cell below, before this existed.
 */
function runStartRows(fixture: Fixture): AuditRow[] {
  return (auditRows(fixture) as AuditRow[])
    .filter((row) => row.action === 'run:start')
    .sort((left, right) => String(left.ts).localeCompare(String(right.ts)))
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
  // AN EMPTY BROWSERS ROOT, so a member's failure is a property of the fixture rather than of the
  // machine — `dashboard-run-door.test.ts`'s own pin, for its own reason. Without it an APPROVED
  // run launches a real browser and knocks on the counting target a second time, and every
  // "nobody knocked" / "knocked once" assertion starts measuring what is installed here.
  const browsersRoot = join(fixture.project, 'no-browsers')
  if (!existsSync(browsersRoot)) mkdirSync(browsersRoot, { recursive: true })
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersRoot
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
  runDoor.bindTriggerScope(door.enterRunTriggerScope)

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
async function triggerRun(scene: Scene, confirmScope?: string): Promise<string> {
  const response = await fetch(`${scene.origin}/api/runs/trigger`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      file: scene.fixture.testPattern,
      ...(confirmScope === undefined ? {} : { confirmScope }),
    }),
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
  /** The scope this connection was minted, read off its own first frame. */
  readonly scopeId: string
  waitFor(predicate: (frame: SseFrame) => boolean, budgetMs?: number): Promise<SseFrame>
  close(): Promise<void>
}

/**
 * Become askable — the way a browser about to click Run does (401-09).
 *
 * BEFORE THE RUN EXISTS, AND THAT ORDER IS THE PRODUCT'S, not the cell's convenience. The queue
 * dispatches on its own `enqueued` event in the same tick the trigger route enqueues, so a channel
 * opened after the trigger's response would be racing the run's own gate. The channel is opened
 * first, the server mints the scope on it, and the trigger names that scope.
 *
 * IT ASSERTS THE STATUS FIRST. A stream that 404s is a channel that was never registered, and a
 * cell that went on to wait for a frame would report "no frame arrived" — true, and two steps away
 * from the fact that matters.
 */
async function openRunConfirmStream(scene: Scene): Promise<LiveStream> {
  const controller = new AbortController()
  const response = await fetch(
    `${scene.origin}/api/run-confirm/channel`,
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
  const scopeFrame = await (async () => {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const hit = frames.find((frame) => frame.event === 'confirm_scope')
      if (hit !== undefined) return hit
      await new Promise<void>((settled) => setTimeout(settled, 5))
    }
    throw new Error('the channel announced no scope')
  })()
  const scopeId = (JSON.parse(scopeFrame.data) as { scopeId: string }).scopeId
  expect(scopeId, 'the channel minted no scope, so nothing could name this browser').toBeTruthy()

  return {
    frames,
    scopeId,
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
  input: { scopeId: string; confirmId: string; answer: string },
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
      // THE BROWSER BECOMES ASKABLE FIRST, then clicks Run naming itself.
      const stream = await openRunConfirmStream(scene)
      const runId = await triggerRun(scene, stream.scopeId)

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

  it('THE ALLOW CONTROL — one thing different (the answer), and the run happens', async () => {
    // THE DENY-ON-SILENCE CELL'S PAIR, and it differs in EXACTLY ONE thing: somebody clicked Yes.
    // Same undeclared target, same tier, same scope, same channel. Without this control a fix that
    // denied every trigger — or a confirm port that could only ever say no — would satisfy every
    // assertion in the cell above.
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin })
      const scene = await openScene({ fixture, timeoutMs: 60_000 })
      const stream = await openRunConfirmStream(scene)
      const runId = await triggerRun(scene, stream.scopeId)

      const raised = confirmRequestOf(
        await stream.waitFor((frame) => frame.event === 'confirm_request'),
      )
      const answered = await answerRunConfirm(scene, {
        scopeId: stream.scopeId,
        confirmId: raised.confirmId,
        answer: 'accept',
      })
      expect(answered.status).toBe(200)
      // SINGLE USE: the id is spent by the answer that spent it, so a leaked id cannot be replayed
      // onto whatever question is outstanding next.
      expect((await answerRunConfirm(scene, {
        scopeId: stream.scopeId,
        confirmId: raised.confirmId,
        answer: 'accept',
      })).status).toBe(404)

      await waitFor(() => { expect(scene.settled()).toHaveLength(1) })

      const rows = runStartRows(fixture)
      expect(rows).toHaveLength(1)
      // THE ROW A PERSON READS: an ask that really was put in front of somebody, and answered.
      expect(rows[0]!.outcome).toBe('prompted-approved')
      expect(rows[0]!.executionContext).toBe('local-interactive')
      // And all five artifacts of a run that HAPPENED, each the negation of the denial cell's.
      expect(eventTypes(fixture)).toContain('runStarted')
      expect(buildOrdinalsExist(fixture)).toBe(true)
      expect(target.hits).toEqual(['/in-process-thing'])
      expect(scene.buffered(runId).map((event) => event['type'])).toContain('runStarted')
      expect(scene.db.getRun(runId)?.status).not.toBe('pending')

      await stream.close()
    } finally {
      await target.close()
    }
  }, 240_000)

  it('ALWAYS — the one mint records a standing approval, and the NEXT run is not asked', async () => {
    // THE `a` ARM, END TO END. What makes this cell worth its wall clock is the SECOND run: a
    // ledger line proves a write happened, and only a second ask proves the write is what the gate
    // reads. The grant is minted through the composition's own `standingGrants.record` — the same
    // instance `proposals.accept --always` mints through, with its protected-class refusal and its
    // committed ledger — because this door contributes three answers and a socket, never a mint.
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin })
      const scene = await openScene({ fixture, timeoutMs: 60_000 })
      const stream = await openRunConfirmStream(scene)

      const firstRun = await triggerRun(scene, stream.scopeId)
      const raised = confirmRequestOf(
        await stream.waitFor((frame) => frame.event === 'confirm_request'),
      )
      expect(raised.actionClass).toBe('run:start')
      expect((await answerRunConfirm(scene, {
        scopeId: stream.scopeId,
        confirmId: raised.confirmId,
        answer: 'accept-always',
      })).status).toBe(200)
      await waitFor(() => { expect(scene.settled()).toHaveLength(1) })
      expect(runStartRows(fixture).map((row) => row.outcome)).toEqual(['prompted-approved'])

      // THE SECOND RUN, ON THE SAME CHANNEL. The channel stays open deliberately: if the grant were
      // not in force this run WOULD be asked, and a cell that closed the channel first would
      // instead be measuring the fail-closed arm and calling it a standing approval.
      const secondRun = await triggerRun(scene, stream.scopeId)
      await waitFor(() => { expect(scene.settled()).toHaveLength(2) })

      const rows = runStartRows(fixture)
      expect(rows).toHaveLength(2)
      // The first run is the one that was asked; the second is the one the grant covered.
      expect(rows[0]!.outcome).toBe('prompted-approved')
      // SATISFIED BY THE GATE'S OWN STANDING-APPROVAL READ PATH, which is the assertion a ledger
      // line cannot make: `trustSource` is written by `resolveAsk`, three rungs above the confirm.
      expect(rows[1]!.outcome).toBe('proceeded')
      expect(rows[1]!.trustSource).toBe('standing-approval')
      // AND NOBODY WAS ASKED A SECOND TIME. One question on this channel, ever.
      expect(
        stream.frames.filter((frame) => frame.event === 'confirm_request'),
        'the standing approval did not stop the ask recurring',
      ).toHaveLength(1)
      expect(scene.confirms.pendingCount()).toBe(0)

      expect(firstRun).not.toBe(secondRun)
      await stream.close()
    } finally {
      await target.close()
    }
  }, 300_000)

  it('CHANNEL VANISH — closing the tab denies at once, not at the window', async () => {
    // A SIXTY-SECOND WINDOW, far past this cell's own budget for the assertions after the close. If
    // the disconnect reaper were removed the cell could only pass by waiting out the timer, which
    // it does not have time to do — so a green here is the reaper and cannot be the timeout. That
    // is the difference between this cell and the deny-on-silence one, which is the whole reason
    // both exist.
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin })
      const scene = await openScene({ fixture, timeoutMs: 60_000 })
      const stream = await openRunConfirmStream(scene)
      await triggerRun(scene, stream.scopeId)

      await stream.waitFor((frame) => frame.event === 'confirm_request')
      expect(scene.confirms.pendingCount()).toBe(1)

      const closedAt = Date.now()
      await stream.close()

      await waitFor(() => { expect(scene.settled()).toHaveLength(1) }, 15_000)
      expect(
        Date.now() - closedAt,
        'the denial arrived on the window rather than on the close',
      ).toBeLessThan(30_000)

      const rows = runStartRows(fixture)
      expect(rows.map((row) => row.outcome)).toEqual(['prompted-denied'])
      expect(scene.confirms.pendingCount()).toBe(0)
      expect(eventTypes(fixture)).toEqual([])
      expect(target.hits).toEqual([])
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

// ---- The honest-claim rule, both ways (401-09, Pitfall 3 / D-07) -------------------------------
//
// THE CELLS ABOVE MEASURE IT THROUGH A REAL RUN's AUDIT ROW, which is the surface a person reads.
// These measure PRODUCTION'S OWN PREDICATE, named per scope, so the rule can be driven across the
// transition — no channel, channel, channel gone — inside one execution and without paying for a
// run at each step. Both are the same `postureFor`; there is no second copy of the rule to disagree.

describe('the trigger claims interactivity only while a browser is holding its channel', () => {
  it('THE TRIGGER RULE — no channel is headless, a live channel is interactive, and back again', async () => {
    const fixture = createInProcessFixture({ origin: 'http://127.0.0.1:1' })
    const confirms = createConfirmRegistry()
    const door = composeDashboardDoor({
      agentQaRoot: fixture.agentQaRoot,
      configPath: fixture.configPath,
      boundOrigin: () => undefined,
      confirms,
    })
    try {
      const scope = 'run-trigger:401-09-posture'

      // NO CHANNEL, NO CLAIM. A queued run nobody is watching is exactly as headless as a piped
      // CLI, and saying otherwise is the dishonesty this seam exists to prevent.
      expect(door.resolveExecutionContext(scope, { reachableByChannelAlone: true }))
        .toBe('local-headless')

      const close = confirms.openChannel(scope)
      // A CHANNEL IS THE WHOLE QUESTION FOR A TRIGGER, and this line is what a rule copied from the
      // conversation's would red on: there is no turn in flight and there never will be, so a
      // trigger under `watchedAndInFlight` could never be interactive at all.
      expect(door.resolveExecutionContext(scope, { reachableByChannelAlone: true }))
        .toBe('local-interactive')

      close()
      expect(door.resolveExecutionContext(scope, { reachableByChannelAlone: true }))
        .toBe('local-headless')
    } finally {
      await door.host.close()
    }
  })

  it('THE CONVERSATION RULE IS UNTOUCHED — a watched, idle conversation is still headless', async () => {
    // THE CONTROL FOR THE WIDENING. The trigger's rule is weaker than the conversation's by one
    // conjunct, and the whole risk of generalizing the axis is that the weaker rule leaks onto the
    // stronger one. Same registry, same door, same open channel — and a conversation with no turn
    // in flight must still be `local-headless`, which is 400-13's own measured tightening.
    const fixture = createInProcessFixture({ origin: 'http://127.0.0.1:1' })
    const confirms = createConfirmRegistry()
    const door = composeDashboardDoor({
      agentQaRoot: fixture.agentQaRoot,
      configPath: fixture.configPath,
      boundOrigin: () => undefined,
      confirms,
    })
    try {
      const conversation = 'chat-20260823-000000-0000'
      const close = confirms.openChannel(conversation)
      expect(door.resolveExecutionContext(conversation)).toBe('local-headless')
      close()
    } finally {
      await door.host.close()
    }
  })
})

// ---- ONE PARKING LOT (401-09, D-11's prohibition) ---------------------------------------------
//
// THE PRIMARY PROOF IS BEHAVIOURAL AND IT IS IN THE CELL ABOVE: the deny-on-silence scene watches
// `confirms.pendingCount()` go 0 → 1 → 0 on the registry the CHAT door parks in, which is a fact a
// source scan cannot give and a second lot could not fake.
//
// WHAT THIS ADDS IS THE COMPLETE-SET HALF, and it is TWO INDEPENDENTLY-SHAPED predicates reconciled
// against each other, because 401-08 measured that a single self-checked predicate silently drops
// the members its own known set does not name. One ranges the FACTORY (who builds a registry); the
// other ranges the SUBSTRATE (which module can turn silence into a denial) and shares no vocabulary
// with the first — a hand-rolled lot with no `createConfirmRegistry` in it is invisible to the
// first predicate and cannot hide from the second.

describe('there is one parking lot, and the run trigger uses it', () => {
  const FIRST_PARTY = ['packages/cli/src', 'packages/dashboard-server/src']

  function sourceFiles(): string[] {
    const roots = FIRST_PARTY.map((dir) => resolve(REPO_ROOT, dir))
    const found: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist') continue
          walk(full)
          continue
        }
        if (entry.name.endsWith('.ts')) found.push(full)
      }
    }
    for (const root of roots) walk(root)
    return found
  }

  it('PREDICATE 1 (the factory) — exactly one call site builds a confirm registry', () => {
    const files = sourceFiles()
    // THE DISCOVERY PREDICATE'S OWN FLOOR. A walker that found nothing would make every claim below
    // vacuously true, which is the shape a wrong path constant produces (401's own scar).
    // 118 at the time of writing; the floor is a floor, not a pin — a pin would red on every new
    // module, and what this line is defending against is a walker that found nothing.
    expect(files.length).toBeGreaterThan(100)
    expect(files.some((file) => file.endsWith('commands/dashboard.ts'))).toBe(true)

    const callers = files.filter((file) => {
      const text = readFileSync(file, 'utf8')
      // The declaration site is not a call site — it is where the one lot is DEFINED.
      if (text.includes('export function createConfirmRegistry')) return false
      return text.includes('createConfirmRegistry(')
    })
    expect(
      callers.map((file) => file.slice(REPO_ROOT.length + 1)),
      'a second composition builds its own registry — a question parked in one lot cannot be '
      + 'answered on the route that serves the other',
    ).toEqual(['packages/cli/src/commands/dashboard.ts'])
  })

  it('PREDICATE 2 (the substrate) — exactly one module can turn silence into a denial', () => {
    // SHARES NO VOCABULARY WITH PREDICATE 1. It asks which modules hold a timer AND can answer
    // `deny` — the mechanical shape of a reaper — so a parking lot written by hand, with no factory
    // to name, is found here even though predicate 1 cannot see it.
    const reapers = sourceFiles().filter((file) => {
      const text = readFileSync(file, 'utf8')
      return text.includes('setTimeout') && text.includes("'deny'")
    })
    expect(
      reapers.map((file) => file.slice(REPO_ROOT.length + 1)),
      'a second module reaps a question into a denial — "silence is consent" now has two readings',
    ).toEqual(['packages/dashboard-server/src/chat/confirm-registry.ts'])
  })
})
