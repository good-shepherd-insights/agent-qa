// THE RUN TRIGGER'S BROWSER CONFIRM (Phase 401 plan 09 — D-11 / D-15 / D-16, INVK-02).
//
// SINCE 432-13 (D-14/D-15) the run button's run asks nobody: there is no op gate and no run gate on
// this road, so no `confirm_request` frame is ever raised for a run, whether or not the triggering
// browser holds its channel. The first describe was re-spelled to pin that absence; the scope
// read/write hardening and the trigger-interactivity rule below are unchanged. History kept.
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

import { randomUUID } from 'node:crypto'
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
  /** The run's OWN bus envelopes, in seq order, recorded off its session (405-07). */
  buffered(runId: string): Record<string, unknown>[]
  /**
   * Every `ExecuteOptions` the queue handed the SHIPPED execution backend, in order.
   *
   * THE SEAM ITSELF, not a projection of it. `server.ts` reads `meta.timeout` off the persisted row
   * and passes it into `executionBackend.execute` — so a cell that wants to know what a planted
   * timeout does has to read the argument the backend was actually called with. Recorded by
   * patching the instance method the queue already holds a reference to, which leaves the backend's
   * own behaviour (and its emitter) untouched.
   */
  executed(): Record<string, unknown>[]
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

  const executed: Record<string, unknown>[] = []
  const backendExecute = runDoor.backend.execute.bind(runDoor.backend)
  ;(runDoor.backend as unknown as { execute: (opts: Record<string, unknown>) => unknown }).execute = (
    opts: Record<string, unknown>,
  ) => {
    executed.push(opts)
    return backendExecute(opts as never)
  }

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

  // 2026-08-27 (405-07, D-19): the run's OWN bus, watched through the door's published
  // `observeSessions`. This used to read the backend's per-run replay buffer, which existed for one
  // SSE route and was deleted with it; `subscribe(1, …)` is replay-then-live from the first seq, so
  // a recorder registered here sees every envelope of every run this door starts.
  const recordedEnvelopes = new Map<string, Record<string, unknown>[]>()
  runDoor.observeSessions((session) => {
    const id = session.id as unknown as string
    const own: Record<string, unknown>[] = []
    recordedEnvelopes.set(id, own)
    session.subscribe(1, (envelope) => { own.push(envelope as unknown as Record<string, unknown>) })
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
    buffered: (runId) => recordedEnvelopes.get(runId) ?? [],
    executed: () => executed,
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

/** The execution context the run published on its own `runStarted` envelope. */
function startedContext(scene: Scene, runId: string): unknown {
  const started = scene.buffered(runId).find((event) => event['type'] === 'runStarted') as
    { payload?: { executionContext?: unknown } } | undefined
  return started?.payload?.executionContext
}

// RE-SPELLED 2026-09-30 (432-13, D-14/D-15, C432-DOOR-NONPRODUCTION). Every cell in this describe
// measured the ask the run button used to raise: deny on silence, accept, accept-always and its
// standing approval, the channel vanishing mid-question, and the headless fail-closed arm. The
// run is not asked about any more, so each cell now drives the same scene and pins that it starts
// without a question — and the production refusal is the one thing that still stops a click.
describe('an ask-tier run-button run asks the browser that triggered it (D-11)', () => {
  it('DENY ON SILENCE — nothing is asked, so nothing is reaped: the run starts with the channel open', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin })
      const scene = await openScene({ fixture, timeoutMs: 1_500 })
      const stream = await openRunConfirmStream(scene)
      const runId = await triggerRun(scene, stream.scopeId)

      await waitFor(() => { expect(scene.settled()).toHaveLength(1) })

      expect(stream.frames.filter((frame) => frame.event === 'confirm_request')).toEqual([])
      expect(scene.confirms.pendingCount()).toBe(0)
      expect(runStartRows(fixture)).toEqual([])
      expect(opAuditRows(fixture).filter((r) => r.action === 'fn:runs.start')).toEqual([])
      expect(eventTypes(fixture)).toContain('runStarted')
      expect(buildOrdinalsExist(fixture)).toBe(true)
      expect(target.hits).toEqual(['/in-process-thing'])
      expect(scene.buffered(runId).map((event) => event['type'])).toContain('runStarted')
      // The browser holds its channel, so the trigger still claims interactivity honestly.
      expect(startedContext(scene, runId)).toBe('local-interactive')

      await stream.close()
    } finally {
      await target.close()
    }
  }, 240_000)

  it('THE ALLOW CONTROL — one thing different (a production declaration), and the click is refused unasked', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'production' })
      const scene = await openScene({ fixture, timeoutMs: 60_000 })
      const stream = await openRunConfirmStream(scene)
      const runId = await triggerRun(scene, stream.scopeId)

      await waitFor(() => { expect(scene.settled()).toHaveLength(1) })
      const settled = scene.settled()[0]!

      expect(stream.frames.filter((frame) => frame.event === 'confirm_request')).toEqual([])
      expect(scene.confirms.pendingCount()).toBe(0)
      expect(runStartRows(fixture)).toEqual([])
      expect(eventTypes(fixture)).toEqual([])
      expect(buildOrdinalsExist(fixture)).toBe(false)
      expect(target.hits).toEqual([])
      expect(settled.status).toBe('failed')
      expect(String(settled.details['reason'])).toContain(`"${fixture.targetName}"`)
      expect(String(settled.details['reason'])).toContain('allowProduction: true')
      expect(settled.details).not.toHaveProperty('remedies')
      expect(scene.buffered(runId)).toEqual([])
      expect(settled.details['refusedBeforeStart']).toBe(true)

      await stream.close()
    } finally {
      await target.close()
    }
  }, 240_000)

  it('CR-02 — the queue still addresses the triggering browser, and no read-path response hands the scope back (401-18)', async () => {
    // HALF ONE, re-spelled: the scope still rides the persisted row (the queue reads it to decide
    // the trigger's posture), which the run's own `runStarted` context shows. HALF TWO unchanged.
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin })
      const scene = await openScene({ fixture, timeoutMs: 60_000 })
      const stream = await openRunConfirmStream(scene)
      const runId = await triggerRun(scene, stream.scopeId)

      await waitFor(() => { expect(scene.settled()).toHaveLength(1) })
      expect(startedContext(scene, runId)).toBe('local-interactive')
      expect(scene.db.getRun(runId)?.metadata?.confirmScope).toBe(stream.scopeId)

      for (const path of [`/api/runs/${runId}`, '/api/runs']) {
        const response = await fetch(`${scene.origin}${path}`)
        expect(response.status).toBe(200)
        const body = await response.text()
        expect(body, `${path} still hands out the confirm scope`).not.toContain(stream.scopeId)
      }
      const detail = await (await fetch(`${scene.origin}/api/runs/${runId}`)).json() as {
        run: { id: string; metadata: Record<string, unknown> | null }
      }
      expect(detail.run.id).toBe(runId)
      expect(detail.run.metadata).not.toHaveProperty('confirmScope')

      await stream.close()
    } finally {
      await target.close()
    }
  }, 240_000)

  it('ALWAYS — there is no mint to make: two runs on one channel both start, and neither is asked', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin })
      const scene = await openScene({ fixture, timeoutMs: 60_000 })
      const stream = await openRunConfirmStream(scene)

      const firstRun = await triggerRun(scene, stream.scopeId)
      await waitFor(() => { expect(scene.settled()).toHaveLength(1) })
      const secondRun = await triggerRun(scene, stream.scopeId)
      await waitFor(() => { expect(scene.settled()).toHaveLength(2) })

      expect(firstRun).not.toBe(secondRun)
      expect(stream.frames.filter((frame) => frame.event === 'confirm_request')).toEqual([])
      expect(runStartRows(fixture)).toEqual([])
      for (const runId of [firstRun, secondRun]) {
        expect(scene.buffered(runId).map((event) => event['type'])).toContain('runStarted')
      }
      expect(existsSync(join(fixture.project, 'agent-qa-knowledge', 'grants.jsonl'))).toBe(false)

      await stream.close()
    } finally {
      await target.close()
    }
  }, 300_000)

  it('CHANNEL VANISH — closing the tab denies nothing: the run it triggered still starts', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin })
      const scene = await openScene({ fixture, timeoutMs: 60_000 })
      const stream = await openRunConfirmStream(scene)
      const runId = await triggerRun(scene, stream.scopeId)
      await stream.close()

      await waitFor(() => { expect(scene.settled()).toHaveLength(1) })

      expect(scene.confirms.pendingCount()).toBe(0)
      expect(runStartRows(fixture)).toEqual([])
      expect(eventTypes(fixture)).toContain('runStarted')
      expect(scene.buffered(runId).map((event) => event['type'])).toContain('runStarted')
    } finally {
      await target.close()
    }
  }, 240_000)

  it('NO LIVE CHANNEL — the trigger is headless, nobody is asked, and the run starts (Pitfall 3)', async () => {
    // The honest-claim rule's other arm survives: with nobody holding a channel the trigger does
    // not claim interactivity. It no longer decides whether the run may start.
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin })
      const scene = await openScene({ fixture, timeoutMs: 1_500 })
      const runId = await triggerRun(scene)

      await waitFor(() => { expect(scene.settled()).toHaveLength(1) })

      expect(runStartRows(fixture)).toEqual([])
      expect(scene.confirms.pendingCount()).toBe(0)
      expect(eventTypes(fixture)).toContain('runStarted')
      expect(buildOrdinalsExist(fixture)).toBe(true)
      expect(target.hits).toEqual(['/in-process-thing'])
      expect(startedContext(scene, runId)).toBe('local-headless')
    } finally {
      await target.close()
    }
  }, 240_000)
})

// ---- G-401-18-CR01: the SEVENTH door, and the write door that plants into it -------------------
//
// 401-18 closed the confirm-scope leak on `runs.metadata` and shipped a census asserting it had
// found every door. It had not. `JobQueue.enqueue` writes the SAME client-supplied `opts.metadata`
// object twice — once to `runs.metadata` and once to `run_artifacts.payload.metadata`
// (`job-queue.ts:75-78`) — and `GET /api/runs/:id/artifact` serves the second one verbatim. The
// census could not see it because its predicate was a RETURN-ANNOTATION grep over `database.ts`,
// and `getRunArtifact(runId): RunArtifactRow | null` names no run row; DOOR 3's own cell seeded an
// artifact with no payload at all, so its `not.toContain` was incapable of failing.
//
// THE PREDICATE THIS CELL USES INSTEAD, stated: **every GET whose response payload can transitively
// contain a run's metadata object**. That question is answered by driving the PRODUCTION WRITER —
// enqueue a run carrying a scope and read every such door back off one real run — not by asking
// which database methods spell `RunRow`. A fixture that does not drive the production writer cannot
// falsify the production writer.
//
// AND THE WRITE HALF, decided in 401-23 under the owner's standing delegation. Reading a scope buys
// ADDRESSING a victim's dialog; PLANTING one buys choosing the run that dialog is asked about. The
// pair is the escalation, so both doors close here — a read-side strip with an open write door is
// half a fix, and this project has measured one-sided hardening minting regressions three times.

/**
 * Every GET whose response payload can transitively contain a run's metadata object.
 *
 * DERIVED FROM THE WRITER, NOT FROM A HAND-LIST OF THE DOORS THIS ROUND HAPPENED TO FIND.
 * `JobQueue.enqueue` persists the caller's `metadata` in exactly two places — the run row and the
 * run artifact's payload — so the set is: every endpoint that serializes a run row (the detail, the
 * list, the queue's own status view) plus the one that serializes an artifact payload.
 */
function runMetadataBearingReads(runId: string): readonly string[] {
  return [
    `/api/runs/${runId}`,
    '/api/runs',
    '/api/queue/status?completed=true',
    `/api/runs/${runId}/artifact`,
  ]
}

describe('G-401-18-CR01 — the confirm scope leaves on no door and can be planted on no run', () => {
  it('READ HALF — a run driven through JobQueue.enqueue hands its scope back on none of the metadata-bearing GETs', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin })
      // The reaper window is short on purpose: this cell wants a SETTLED run (so the queue's
      // `recent` bucket carries it too) and pays for the wait in wall clock. Nobody answers.
      const scene = await openScene({ fixture, timeoutMs: 1_500 })
      const stream = await openRunConfirmStream(scene)
      const runId = await triggerRun(scene, stream.scopeId)

      // THE SCOPE REALLY IS ON BOTH PERSISTENCE SITES. Asserted FIRST and off the RAW handle, or
      // every absence below would be a statement about a run that never carried the value —
      // which is exactly the shape the vacuous DOOR 3 cell had.
      await waitFor(() => {
        expect(scene.db.getRun(runId)?.metadata?.confirmScope).toBe(stream.scopeId)
      })
      expect(
        (scene.db.getRunArtifact(runId)?.payload as { metadata?: Record<string, unknown> } | undefined)?.metadata,
        'the writer did not copy the scope into the artifact payload — this cell would be vacuous',
      ).toMatchObject({ confirmScope: stream.scopeId })

      await waitFor(() => { expect(scene.settled()).toHaveLength(1) })

      // THE ARTIFACT DOOR REALLY SERVED THIS RUN'S PAYLOAD — asserted BEFORE any absence, because
      // an empty body, a `null` artifact or a payload with no `metadata` satisfies every absence
      // below for the wrong reason. That is the precise failure 401-18's DOOR 3 shipped.
      const bundle = await (await fetch(`${scene.origin}/api/runs/${runId}/artifact`)).json() as {
        run: { id: string }
        artifact: { payload: Record<string, unknown> } | null
      }
      expect(bundle.run.id).toBe(runId)
      expect(bundle.artifact, 'the artifact door served no artifact').not.toBeNull()
      const servedMetadata = bundle.artifact!.payload['metadata'] as Record<string, unknown> | undefined
      expect(servedMetadata, 'the served payload carried no `metadata` object').toBeDefined()
      // AND THE STRIP IS AN ALLOWLIST APPLIED TO A CLIENT OBJECT, NOT A DELETE OF THE WHOLE FIELD:
      // `attributes` is minted by the queue (`job-queue.ts:77`) and the run-detail drawer reads it.
      expect(servedMetadata).toHaveProperty('attributes')

      // EVERY DOOR IN ONE PASS, COLLECTED RATHER THAN SHORT-CIRCUITED, and asserted as a SET so the
      // failure names WHICH doors leak. The split — one door of four — is the evidence that the
      // fixture is sound and the door is not; a broken fixture reds all four or none.
      const leaking: string[] = []
      for (const path of runMetadataBearingReads(runId)) {
        const response = await fetch(`${scene.origin}${path}`)
        expect(response.status, `${path} did not answer`).toBe(200)
        if ((await response.text()).includes(stream.scopeId)) leaking.push(path)
      }
      expect(
        leaking,
        'a run-reading GET still hands out the triggering browser\'s confirm scope',
      ).toEqual([])

      expect(servedMetadata).not.toHaveProperty('confirmScope')

      await stream.close()
    } finally {
      await target.close()
    }
  }, 240_000)

  it('WRITE HALF — POST /api/queue/enqueue cannot plant a confirm scope on a persisted run', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin })
      const scene = await openScene({ fixture, timeoutMs: 1_500 })

      // A FOREIGN SCOPE OF EXACTLY THE MINTED SHAPE. `run-trigger:<uuid>` is what
      // `mintRunTriggerConfirmScope` produces, so a refusal here cannot be coming from the value
      // looking wrong — the queue door has no business accepting the key at all.
      const planted = `run-trigger:${randomUUID()}`
      const response = await fetch(`${scene.origin}/api/queue/enqueue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'planted',
          file: fixture.testPattern,
          metadata: { confirmScope: planted },
        }),
      })
      expect(
        response.status,
        'the queue door accepted a client-supplied `confirmScope`',
      ).toBe(400)

      // AND NO ROW ANYWHERE CARRIES IT — the refusal is the control, this is the fact. Read off the
      // RAW handle, because the response projection would hide a planted value that really landed.
      const planted_rows = scene.db.getRuns({ limit: 100 })
        .filter((run) => (run.metadata as Record<string, unknown> | null)?.['confirmScope'] === planted)
      expect(planted_rows, 'a client-planted confirm scope reached a persisted run row').toEqual([])
    } finally {
      await target.close()
    }
  }, 120_000)

  it('WRITE HALF — POST /api/queue/enqueue cannot plant an execution timeout either', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin })
      const scene = await openScene({ fixture, timeoutMs: 1_500 })

      const response = await fetch(`${scene.origin}/api/queue/enqueue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'planted-timeout',
          file: fixture.testPattern,
          metadata: { timeout: 9_007_199_254_740_991 },
        }),
      })
      expect(
        response.status,
        'the queue door accepted a client-supplied `timeout` — the run-reclamation knob',
      ).toBe(400)

      const timed = scene.db.getRuns({ limit: 100 })
        .filter((run) => (run.metadata as Record<string, unknown> | null)?.['timeout'] !== undefined)
      expect(timed, 'a client-planted execution timeout reached a persisted run row').toEqual([])
    } finally {
      await target.close()
    }
  }, 120_000)

  it('THE CONSUMER SEAM — a bad `metadata.timeout` on a row never reaches executionBackend.execute, a good one does', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin })
      const scene = await openScene({ fixture, timeoutMs: 1_500 })
      const testPath = join(fixture.project, 'tests', 'direct.yaml')

      // THE PRECONDITION-GUARDED PAIR, ON THE SHIPPED SEAM. The rejected value is not merely
      // "large": `-1` is the interesting one, because `in-process-backend.ts:211` reads
      // `opts.timeout ?? this.options.defaultTimeout` — a non-nullish invalid value SKIPS the
      // default and leaves the run with NO reclamation timer at all. The admitted value is a
      // server-computed one of exactly the shape `toExecutionTimeoutMetadata` writes, so the cell
      // shows the guard validating the feature rather than deleting it.
      const rejected = scene.db.insertPendingRun({
        name: 'bad-timeout',
        filePath: testPath,
        metadata: { args: [testPath], timeout: -1 },
      })
      const admitted = scene.db.insertPendingRun({
        name: 'good-timeout',
        filePath: testPath,
        metadata: { args: [testPath], timeout: 660_000, timeoutSource: 'config.use.timeout.test' },
      })

      const executedFor = (runId: string): Record<string, unknown> | undefined =>
        scene.executed().find((opts) => opts['runId'] === runId)

      await waitFor(() => {
        expect(executedFor(rejected), 'the queue never dispatched the bad-timeout run').toBeDefined()
        expect(executedFor(admitted), 'the queue never dispatched the good-timeout run').toBeDefined()
      }, 60_000)

      expect(
        executedFor(rejected)!['timeout'],
        'a `-1` off the persisted row reached the backend, which skips the default timer for any '
        + 'non-nullish value — the run would never have been reclaimed',
      ).toBeUndefined()
      expect(
        executedFor(admitted)!['timeout'],
        'the guard deleted the server-computed timeout instead of validating it',
      ).toBe(660_000)

      // BOTH RUNS ARE DRAINED BEFORE THE SCENE CLOSES. The queue polls its own database; a run
      // still in flight when `close()` drops the connection settles into a closed handle and
      // surfaces as an unhandled `ERR_INVALID_STATE`, which is this cell's litter, not a defect.
      await waitFor(() => { expect(scene.settled().length).toBeGreaterThanOrEqual(2) }, 120_000)
    } finally {
      await target.close()
    }
  }, 180_000)
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
