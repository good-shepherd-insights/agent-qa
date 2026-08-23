/// <reference lib="dom" />
// The DOM lib is referenced because the `addInitScript` / `evaluate` callbacks below are compiled
// as TypeScript here and EXECUTED in a browser — `EventSource`, `MutationObserver` and `Element`
// are otherwise unresolved names under `tsc --noEmit` while running perfectly under vitest.
// `conformance/dashboard-dom.test.ts` carries the same reference for the same reason.

// THE RUN TRIGGER'S CONFIRM LOOP, CLOSED THROUGH A REAL BROWSER (Phase 401, UAT item 15 / Truth 6).
//
// WHAT WAS UNVERIFIED, AND WHY IT STAYED THAT WAY. 401-09 built both halves of this loop and could
// measure neither end against the other: the SERVER end is driven end-to-end by
// `run-trigger-confirm.test.ts` over `fetch`-parsed SSE, and the DIALOG's render is driven in jsdom
// — which has no `EventSource`, so every shell suite mounts `RunConfirmHost` and takes its early
// return. 401-14 drove the host through `openRunConfirmChannel`'s own callbacks with a stub
// constructor, which made a real defect measurable, and still did not put a byte on an SSE socket.
// The wire itself — `new EventSource('/api/run-confirm/channel')` in a browser, the `confirm_scope`
// frame, `setRunConfirmScope`, and a trigger that carries the scope back — was source-pinned.
//
// SO THIS FILE PUTS A REAL CHROMIUM IN FRONT OF A REALLY-RUNNING DASHBOARD. The server is
// `startServer` with the shipped `uiDir`, so what the browser downloads is `dashboard-ui`'s own
// `vite build` output — the bundle a person installs. The door is `composeDashboardDoor` /
// `createDashboardRunDoor`, the same composers `agent-qa dashboard` calls, which is why this file
// lives in `packages/cli` beside its server-side sibling (`dashboard-server` may not name
// `@vostride/agent-qa-agent*`; validate:arch).
//
// NOTHING BELOW SUBSTITUTES FOR THE TRANSPORT. The page's `EventSource` is REPLACED BY A SUBCLASS
// OF THE NATIVE ONE, which calls `super(url)` and then adds its own listeners. The bytes still
// arrive over a real HTTP connection parsed by Chromium's own SSE implementation; the subclass only
// keeps a copy of what arrived. A stub constructor here would put this file back where 401-14
// stopped, which is the whole reason it exists.
//
// AND THE RUN IS STARTED BY CLICKING THE PRODUCT'S OWN BUTTON. The scope lives in a module-level
// box inside `api.ts` and reaches the wire only through `triggerRun`; a cell that POSTed
// `/api/runs/trigger` itself would have to spell the scope by hand and would therefore never
// measure whether `setRunConfirmScope` ran at all. So the cells below select a row on the tests
// page and walk the real Run → Run → Run Local path, and the confirm arriving AT ALL is the proof
// that the browser's own trigger carried its own scope (a trigger with no scope is `local-headless`
// and denies without parking — `run-trigger-confirm.test.ts`'s NO LIVE CHANNEL cell).
//
// A DENIAL AND A NEVER-GOT-THERE MUST NOT READ ALIKE. Every assertion below about what a person
// saw is preceded by an assertion that the frame it depends on ARRIVED, read off the recorder — so
// "the dialog said nothing" can never be reported for a question that was never asked.
//
// A BROWSER THAT CANNOT LAUNCH IS A RED, NEVER A SKIP, and a stale `dist` is a red before that:
// `dashboard-dom.test.ts`'s two rules, inherited verbatim. There is no environment predicate in
// this file.

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from 'playwright-core'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

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
  IN_PROCESS_TARGET_NAME,
  auditRows,
  buildOrdinalsExist,
  createInProcessFixture,
  eventTypes,
} from '../../composition/__tests__/in-process-run-fixture.js'
import type { AuditRow } from '../../composition/__tests__/in-process-run-fixture.js'
import {
  DASHBOARD_ANCHORED_BUILDS,
  PACKAGES_ROOT,
  REBUILD_INSTRUCTION,
  buildFreshness,
} from '../../__tests__/conformance/spawned-chat.js'

type Fixture = ReturnType<typeof createInProcessFixture>

/** The built UI the server hands the browser — the thing `agent-qa dashboard` serves. */
const UI_DIR = join(PACKAGES_ROOT, 'dashboard-ui', 'dist')

/**
 * The machine's OWN browsers root, read at module load.
 *
 * READ HERE AND NOWHERE ELSE, because `openScene` below overwrites `PLAYWRIGHT_BROWSERS_PATH` with
 * an empty directory — deliberately, so an approved run cannot launch a browser and knock on the
 * counting target a second time. This file needs a REAL chromium for its own driving, so the value
 * is captured before any scene has run and restored around the one launch.
 */
const BROWSERS_PATH_AT_LOAD = process.env.PLAYWRIGHT_BROWSERS_PATH

/**
 * The sentence the person is asked to approve, SPELLED OUT rather than derived.
 *
 * The target NAME comes from the fixture's own one definition (401-14's rule: an assertion that
 * spelled the name itself would assert a string nothing produces the day somebody renames it), and
 * the rest is a literal — because deriving it from `buildRunDisclosure` would be an expectation
 * that changes with the producer, and mutation 1 in this file's ledger would then red nothing.
 */
const EXPECTED_PREVIEW =
  `Start a run against target "${IN_PROCESS_TARGET_NAME}" (declared: at least one target shared).`

// ---- the recorder the page carries -------------------------------------------------------------

interface WireFrame {
  readonly event: string
  readonly url: string
  readonly data: string
  readonly at: number
}

/** One rendered state of the confirm dialog, as the DOM held it. */
interface DialogShot {
  readonly present: boolean
  readonly confirmId?: string | null
  readonly resolution?: string | null
  readonly resolvedBy?: string | null
  readonly preview?: string | null
  readonly outcome?: string | null
  readonly answers?: readonly (string | null)[]
  readonly text?: string
}

interface PageWire {
  readonly frames: readonly WireFrame[]
  readonly dialogs: readonly DialogShot[]
}

/**
 * Install the two instruments, before any of the app's own script runs.
 *
 * `EventSource` IS SUBCLASSED, NOT REPLACED — see this file's header. `MutationObserver` records
 * every DISTINCT rendered state of the dialog, which is what makes "the person was never told"
 * an assertion over what the DOM actually held rather than over one lucky snapshot.
 */
async function installWireRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const wire = { frames: [] as unknown[], dialogs: [] as unknown[] }
    ;(window as unknown as { __wire: typeof wire }).__wire = wire

    const NativeEventSource = window.EventSource
    class RecordingEventSource extends NativeEventSource {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init)
        for (const kind of ['confirm_scope', 'confirm_request', 'confirm_resolved']) {
          this.addEventListener(kind, (event) => {
            wire.frames.push({
              event: kind,
              url: String(url),
              data: (event as MessageEvent<string>).data,
              at: Date.now(),
            })
          })
        }
      }
    }
    ;(window as unknown as { EventSource: unknown }).EventSource = RecordingEventSource

    const shoot = (): void => {
      const el = document.querySelector('[data-run-confirm-dialog]')
      const shot = el === null
        ? { present: false }
        : {
            present: true,
            confirmId: el.getAttribute('data-confirm-id'),
            resolution: el.getAttribute('data-confirm-resolution'),
            resolvedBy: el.getAttribute('data-confirm-resolved-by'),
            preview: el.querySelector('[data-confirm-preview]')?.textContent ?? null,
            outcome: el.querySelector('[data-confirm-outcome]')?.textContent ?? null,
            answers: Array.from(el.querySelectorAll('[data-confirm-answer]'))
              .map((button) => button.getAttribute('data-confirm-answer')),
            text: el.textContent ?? '',
          }
      const last = wire.dialogs[wire.dialogs.length - 1]
      if (last === undefined || JSON.stringify(last) !== JSON.stringify(shot)) {
        wire.dialogs.push(shot)
      }
    }
    // OBSERVED ON `document`, NOT ON `documentElement`. This script runs at document-start, before
    // the parser has created `<html>` — `observe(document.documentElement, …)` throws there, which
    // is a page error and (correctly) failed this file's own first run.
    new MutationObserver(shoot).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    })
  })
}

async function readWire(page: Page): Promise<PageWire> {
  return await page.evaluate(
    () => (window as unknown as { __wire: PageWire }).__wire,
  ) as PageWire
}

function confirmRequests(wire: PageWire): { confirmId: string; actionClass: string; preview?: string }[] {
  return wire.frames
    .filter((frame) => frame.event === 'confirm_request')
    .map((frame) => JSON.parse(frame.data) as { confirmId: string; actionClass: string; preview?: string })
}

function confirmResolutions(wire: PageWire): { confirmId: string; answer: string; by: string }[] {
  return wire.frames
    .filter((frame) => frame.event === 'confirm_resolved')
    .map((frame) => JSON.parse(frame.data) as { confirmId: string; answer: string; by: string })
}

/** Wait until the page's own recorder holds a frame satisfying the predicate. No sleeps. */
async function waitForFrame(
  page: Page,
  predicate: (frame: WireFrame) => boolean,
  budgetMs = 90_000,
): Promise<WireFrame> {
  const deadline = Date.now() + budgetMs
  for (;;) {
    const wire = await readWire(page)
    const hit = wire.frames.find((frame) => predicate(frame))
    if (hit !== undefined) return hit
    if (Date.now() >= deadline) {
      throw new Error(
        `no SSE frame satisfied the predicate within ${String(budgetMs)}ms; the page saw `
        + JSON.stringify(wire.frames.map((frame) => frame.event)),
      )
    }
    await page.waitForTimeout(50)
  }
}

/**
 * Wait until the page's own recorder satisfies a predicate over the WHOLE wire. No sleeps.
 *
 * `waitForFrame` answers "did one frame like this arrive"; this answers "is the page's history in
 * this state yet" — which is what a claim about two questions coexisting needs, since neither of
 * the two frames alone says anything about the other.
 */
async function waitForWire(
  page: Page,
  predicate: (wire: PageWire) => boolean,
  budgetMs = 90_000,
): Promise<PageWire> {
  const deadline = Date.now() + budgetMs
  for (;;) {
    const wire = await readWire(page)
    if (predicate(wire)) return wire
    if (Date.now() >= deadline) {
      throw new Error(
        `the page's wire never reached the expected state within ${String(budgetMs)}ms; it saw `
        + JSON.stringify(wire.frames.map((frame) => frame.event)),
      )
    }
    await page.waitForTimeout(50)
  }
}

// ---- the scene ---------------------------------------------------------------------------------

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
const openContexts: BrowserContext[] = []
let browser: Browser | undefined

/**
 * The dashboard as the shipped command starts it, WITH ITS BUILT UI ATTACHED.
 *
 * This is `run-trigger-confirm.test.ts`'s `openScene` plus `uiDir` — the one thing that turns an
 * API-only server into something a browser can be pointed at. Everything else is that file's
 * recipe, deliberately: two answers to "how is this dashboard composed" would be two dashboards.
 */
async function openScene(input: { fixture: Fixture; timeoutMs: number }): Promise<Scene> {
  const { fixture } = input
  // AN EMPTY BROWSERS ROOT, kept for parity with `run-trigger-confirm.test.ts` — AND MEASURED
  // NOT TO WORK HERE, which is worth stating rather than leaving as a comment that lies.
  // `playwright-core` resolves its browsers root ONCE, at first use, and caches it: this file
  // launches a real chromium in `beforeAll`, so by the time this line runs the registry has
  // already memoised the machine's own cache and the RUN's own `chromium.launch()` succeeds.
  // (Verified directly: `chromium.executablePath()` returns the same path after
  // `PLAYWRIGHT_BROWSERS_PATH` is reassigned.) The consequence is deliberate and named: an
  // approved run in this file drives a REAL browser at the counting target, so `target.hits` is a
  // membership assertion here, never a count. The five-artifact set below is what carries the
  // "the run started" claim, exactly as it does in the sibling.
  const browsersRoot = join(fixture.project, 'no-browsers')
  if (!existsSync(browsersRoot)) mkdirSync(browsersRoot, { recursive: true })
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersRoot

  const db = new DashboardDatabase({ dbPath: ':memory:' })
  const confirms = createConfirmRegistry({ timeoutMs: input.timeoutMs })
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
    uiDir: UI_DIR,
    configPath: fixture.configPath,
    workspacePaths: resolveWorkspacePaths({
      config: parseYaml(readFileSync(fixture.configPath, 'utf8')) as never,
      configPath: fixture.configPath,
    }),
    executionBackend: runDoor.backend,
    agentHost: door.agentHost,
  })
  // `startServer` echoes the port it was ASKED for, so an ephemeral bind is read off the socket.
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

/** Every `run:start` decision the project recorded, in the order they were taken. */
function runStartRows(fixture: Fixture): AuditRow[] {
  return (auditRows(fixture) as AuditRow[])
    .filter((row) => row.action === 'run:start')
    .sort((left, right) => String(left.ts).localeCompare(String(right.ts)))
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

// ---- the person at the keyboard -----------------------------------------------------------------

/**
 * Open the dashboard, become askable, and dismiss the first-visit tour.
 *
 * THE SCOPE FRAME IS AWAITED, NOT ASSUMED. A page whose channel has not yet been minted is a page
 * whose next trigger is `local-headless`, so every cell waits for the frame the server writes
 * FIRST — and asserts it arrived — before it clicks anything.
 */
async function openDashboard(scene: Scene): Promise<{ page: Page; scopeId: string }> {
  const context = await browser!.newContext()
  openContexts.push(context)
  const page = await context.newPage()
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  await installWireRecorder(page)
  await page.goto(`${scene.origin}/tests`, { waitUntil: 'domcontentloaded' })

  const scopeFrame = await waitForFrame(page, (frame) => frame.event === 'confirm_scope', 60_000)
  expect(
    pageErrors,
    'the built dashboard threw before it could hold a confirm channel',
  ).toEqual([])
  expect(
    scopeFrame.url,
    'the scope frame did not arrive on the run-confirm channel',
  ).toContain('/api/run-confirm/channel')
  const scopeId = (JSON.parse(scopeFrame.data) as { scopeId: string }).scopeId
  expect(
    scopeId,
    'the channel announced no scope, so nothing in this browser can name itself as askable',
  ).toMatch(/^run-trigger:/)

  const skip = page.getByRole('button', { name: 'Skip' })
  if (await skip.isVisible()) await skip.click()
  return { page, scopeId }
}

/** Select one test by its file name — the row a person clicks. */
async function selectTest(page: Page, fileName: string): Promise<void> {
  const row = page.locator('tr', { hasText: fileName })
  await row.locator('button[aria-label="Select row"]').click()
}

/**
 * Click Run → Run → Run Local, which is the product's own three-step path to a local run.
 *
 * THE INNER BUTTON IS SCOPED TO THE POPOVER rather than picked positionally: both are labelled
 * "Run", and a positional pick resolved before the popover rendered would click the trigger again
 * and close it — a flake, and exactly the kind this file must not ship.
 */
async function clickRunLocal(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Run', exact: true }).first().click()
  const popover = page.locator('[data-slot="popover-content"]')
  await popover.waitFor({ state: 'visible' })
  await popover.getByRole('button', { name: 'Run', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Run Local' }).click()
}

// ---- the file's own preconditions ----------------------------------------------------------------

beforeAll(async () => {
  const freshness = buildFreshness(DASHBOARD_ANCHORED_BUILDS)
  if (freshness.missing.length > 0 || freshness.stale.length > 0) {
    throw new Error(
      `${REBUILD_INSTRUCTION}\nmissing: ${JSON.stringify(freshness.missing)}\n`
      + `stale: ${JSON.stringify(freshness.stale)}`,
    )
  }
  if (!existsSync(join(UI_DIR, 'index.html'))) {
    throw new Error(`no built dashboard UI at ${UI_DIR} — ${REBUILD_INSTRUCTION}`)
  }
  // Restore the machine's own browsers root for the ONE launch: a previous file in this worker may
  // have pointed it at an empty fixture directory, and this cell needs a real chromium.
  if (BROWSERS_PATH_AT_LOAD === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH
  else process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_PATH_AT_LOAD
  browser = await chromium.launch()
}, 120_000)

afterAll(async () => {
  await browser?.close()
})

afterEach(async () => {
  while (openContexts.length > 0) await openContexts.pop()!.close()
  while (openScenes.length > 0) await openScenes.pop()!.close()
})

describe('the run trigger confirm loop, closed through a real browser (UAT item 15, Truth 6)', () => {
  it('SINGLE CONFIRM — the EventSource carries the scope, the dialog names the target and the environment class, and answering it starts the run', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      // `environment: shared` — the DECLARED shared case, so the sentence a person reads is the
      // one UAT item 15 quotes. (The undeclared case reads "undeclared, which classifies as
      // shared", which is a different, equally deliberate sentence.)
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'shared' })
      // 45s: long enough that nothing here races a person's click (the answer lands in ~2s),
      // short enough that a build in which the answer never arrives resolves inside this cell.
      const scene = await openScene({ fixture, timeoutMs: 45_000 })
      const { page, scopeId } = await openDashboard(scene)

      await selectTest(page, 'direct.yaml')
      await clickRunLocal(page)

      // THE FRAME FIRST. If no question ever reached this browser there is nothing downstream to
      // read, and a dialog assertion here would report "empty" for a question never asked.
      await waitForFrame(page, (frame) => frame.event === 'confirm_request')
      const raised = confirmRequests(await readWire(page))
      expect(raised, 'exactly one question should have reached this browser').toHaveLength(1)
      expect(
        raised[0]!.preview,
        'the question the SERVER pushed carried no disclosure',
      ).toBe(EXPECTED_PREVIEW)
      expect(raised[0]!.actionClass).toBe('run:start')

      // WHAT THE PERSON SEES, read back off the rendered DOM.
      const dialog = page.locator('[data-run-confirm-dialog]')
      await dialog.waitFor({ state: 'visible', timeout: 60_000 })
      expect(await dialog.getAttribute('data-confirm-id')).toBe(raised[0]!.confirmId)
      const preview = dialog.locator('[data-confirm-preview]')
      await preview.waitFor({ state: 'visible' })
      expect(
        (await preview.textContent())?.trim(),
        'the dialog did not tell the person which target, or how shared it is',
      ).toBe(EXPECTED_PREVIEW)
      expect(await dialog.locator('[data-confirm-answer]').count()).toBe(3)

      await dialog.locator('[data-confirm-answer="accept"]').click()

      // A RESOLUTION ARRIVED — asserted as ARRIVAL first and read for its CONTENT last, which is
      // this file's rule everywhere: a question that resolved and a question that never came back
      // must not produce the same failure, and the run's own artifacts below are only meaningful
      // once something closed the question.
      await waitForFrame(page, (frame) => frame.event === 'confirm_resolved')

      // AND THE RUN REALLY STARTED — read off the run's own artifacts, never the UI's optimism.
      await waitFor(() => { expect(scene.settled()).toHaveLength(1) })
      const rows = runStartRows(fixture)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.outcome).toBe('prompted-approved')
      // The honest interactive claim: this row says a browser really was holding the channel the
      // trigger named, which is only true because `setRunConfirmScope` ran in the page.
      expect(rows[0]!.executionContext).toBe('local-interactive')
      // RECORDED, NOT ENDORSED: the trust the row attributes the approval to is `tty-prompt`, and
      // there was no TTY anywhere near this decision — a person clicked a button in Chromium. The
      // decision is right and its provenance is mislabelled on the record a person audits.
      expect(rows[0]!.trustSource).toBe('tty-prompt')
      expect(eventTypes(fixture)).toContain('runStarted')
      expect(buildOrdinalsExist(fixture)).toBe(true)
      expect(target.hits, 'the approved run never touched the target').toContain('/in-process-thing')
      expect(scopeId).toMatch(/^run-trigger:/)

      // ONLY NOW, the resolution's CONTENT: it was this question, answered by a person, accepted.
      const resolved = confirmResolutions(await readWire(page))
      expect(resolved).toHaveLength(1)
      expect(resolved[0]).toMatchObject({
        confirmId: raised[0]!.confirmId,
        answer: 'accept',
        by: 'answer',
      })

      // The person is told it was approved, before the dialog clears.
      const shots = (await readWire(page)).dialogs.filter((shot) => shot.present)
      expect(
        shots.some((shot) => shot.confirmId === raised[0]!.confirmId && shot.resolution === 'accept'),
        'the dialog never rendered the approval the server sent back',
      ).toBe(true)
    } finally {
      await target.close()
    }
  }, 300_000)

  it('OVERLAPPING CONFIRMS — the arriving question WAITS, the one on screen resolves on itself, and the waiting one is raised afterwards and dies visibly (G-401-15)', async () => {
    // THE RULING THIS CELL MEASURES (UAT test 1, 2026-08-23): QUEUE overlapping confirms — B waits
    // behind A; A stays answerable and resolves normally. Before 401-16 this cell measured the
    // DEFECT: within about a second the dialog's `data-confirm-id` became B, A's confirmId was
    // nowhere in `document.body.innerHTML`, and when A's `confirm_resolved` arrived thirty seconds
    // later on this very socket 401-14's keyed guard correctly dropped it, so NOTHING RENDERED. The
    // person clicked Run twice, answered once, got one run, and was never told the other was
    // refused. That is gap G-401-15, and the assertions below are the repaired shape of it.
    //
    // `parallelRuns` IS WHAT MAKES OVERLAP REACHABLE AT ALL, and finding that out was half the
    // original measurement: `JobQueue.findNextEligible` gives a NON-parallel web run exclusive
    // access to every slot, so two default-configured dashboard runs reach their gates strictly one
    // after the other and their questions never coexist. With `use.parallel` — the config's own
    // shipped knob — both runs are eligible at once and both gates ask.
    //
    // WHY THE *SECOND* QUESTION IS THE ONE LEFT UNANSWERED, stated because it looks like a
    // softening of the gap and is not. Both windows start when their own question is parked, about
    // a second apart, so a question that waits behind another is raised one linger AFTER the first
    // one closes — which under the queued behaviour makes the FIRST question the one a person can
    // still answer and the SECOND the one that can run out of window while they read the outcome.
    // The claim the gap was filed for is "a question that resolves unanswered is SEEN to have been
    // refused", and it is asserted here on the question that actually dies that way.
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({
        origin: target.origin,
        environment: 'shared',
        parallelRuns: true,
      })
      // 30s: long enough that the SECOND question provably arrives inside the FIRST one's window
      // (the gap measured between the two triggers is ~1s) and still has most of its own window
      // left when the queue drains it one linger later; short enough that this cell pays for the
      // second question's death in seconds rather than the two-minute default.
      const scene = await openScene({ fixture, timeoutMs: 30_000 })
      const { page } = await openDashboard(scene)

      // WHICH RUN IS WHICH, read off the trigger route's own responses in the order the browser
      // made them. Without this the cell could say "one run died" but not "the run whose question
      // was never answered is the one that died", which is the whole of what a person loses here.
      const triggeredRunIds: string[] = []
      page.on('response', (response) => {
        if (!response.url().endsWith('/api/runs/trigger')) return
        void response.json().then(
          (body: unknown) => {
            const runId = (body as { runId?: string }).runId
            if (typeof runId === 'string') triggeredRunIds.push(runId)
          },
          () => undefined,
        )
      })

      await selectTest(page, 'direct.yaml')
      await clickRunLocal(page)

      const dialog = page.locator('[data-run-confirm-dialog]')
      await dialog.waitFor({ state: 'visible', timeout: 60_000 })
      const firstId = await dialog.getAttribute('data-confirm-id')
      expect(firstId, 'the first question never reached the browser').toBeTruthy()
      expect(await dialog.locator('[data-confirm-answer]').count()).toBe(3)
      expect(await dialog.getAttribute('data-confirm-resolution')).toBeNull()

      // ... and now a second ask-tier run is started while the first is still on screen. The SAME
      // selection is run again, which is the shortest true story: a person clicked Run twice.
      await clickRunLocal(page)

      // ARRIVAL FIRST, ALWAYS. The second question's identity is read off the WIRE and not off the
      // DOM, because under the ruled behaviour it is never rendered at this point — and a cell that
      // waited for the DOM to change would be waiting for the defect.
      const afterSecond = await waitForWire(
        page,
        (wire) => confirmRequests(wire).length >= 2,
        90_000,
      )
      const asked = confirmRequests(afterSecond)
      expect(asked, 'the second question never reached this browser').toHaveLength(2)
      expect(asked[0]!.confirmId).toBe(firstId)
      const secondId = asked[1]!.confirmId
      expect(
        confirmResolutions(afterSecond).map((frame) => frame.confirmId),
        'the first question had already resolved before the second arrived, so these two never '
        + 'overlapped in the browser and nothing below is about overlapping confirms',
      ).not.toContain(firstId)

      // WHAT THE PERSON SEES: still exactly one dialog, still the FIRST question, still answerable.
      // This is the assertion the shipped code failed — it rendered the second question here.
      expect(await dialog.count()).toBe(1)
      expect(
        await dialog.getAttribute('data-confirm-id'),
        'the arriving question replaced the one being asked',
      ).toBe(firstId)
      expect(
        await dialog.locator('[data-confirm-answer]').count(),
        'the question on screen stopped being answerable when the next one arrived',
      ).toBe(3)
      expect(await dialog.getAttribute('data-confirm-resolution')).toBeNull()
      expect(
        await page.evaluate((id) => document.body.innerHTML.includes(id), secondId),
        'the waiting question was rendered — it is meant to be waiting, not stacked',
      ).toBe(false)

      // The person answers the question they were asked FIRST, which they still can.
      await dialog.locator('[data-confirm-answer="accept"]').click()
      await waitForFrame(page, (frame) => {
        if (frame.event !== 'confirm_resolved') return false
        return (JSON.parse(frame.data) as { confirmId: string }).confirmId === firstId
      }, 90_000)

      // AND THE WAITING QUESTION IS RAISED ONLY AFTERWARDS, under its OWN confirmId, answerable.
      await page.waitForFunction(
        (id) => {
          const el = document.querySelector('[data-run-confirm-dialog]')
          return el !== null && el.getAttribute('data-confirm-id') === id
        },
        secondId,
        { timeout: 60_000 },
      )
      expect(
        await dialog.locator('[data-confirm-answer]').count(),
        'the question that had been waiting was raised without its answers',
      ).toBe(3)
      expect(await dialog.getAttribute('data-confirm-resolution')).toBeNull()

      // THE ORDER, read off the whole render history rather than off the two snapshots above: the
      // first state carrying the second question came AFTER a state that carried the first
      // question's own answer. A queue that raised the next question early would satisfy every
      // assertion so far and fail this one.
      const historyAtDrain = (await readWire(page)).dialogs.filter((shot) => shot.present)
      const approvedAt = historyAtDrain
        .findIndex((shot) => shot.confirmId === firstId && shot.resolution === 'accept')
      const raisedAt = historyAtDrain.findIndex((shot) => shot.confirmId === secondId)
      expect(approvedAt, 'the first question never rendered the approval the server sent back')
        .toBeGreaterThanOrEqual(0)
      expect(raisedAt, 'the waiting question was never rendered at all').toBeGreaterThanOrEqual(0)
      expect(raisedAt, 'the waiting question was raised before the first one had been answered')
        .toBeGreaterThan(approvedAt)

      // NOBODY ANSWERS THE SECOND QUESTION. It dies at its own window, the server says so on this
      // very socket — and THE PERSON IS TOLD, which is the exact thing that never happened in the
      // measured failure.
      const secondDeath = await waitForFrame(page, (frame) => {
        if (frame.event !== 'confirm_resolved') return false
        return (JSON.parse(frame.data) as { confirmId: string }).confirmId === secondId
      }, 90_000)
      expect(JSON.parse(secondDeath.data)).toMatchObject({
        confirmId: secondId,
        answer: 'deny',
        by: 'timeout',
      })
      await page.waitForFunction(
        (id) => {
          const el = document.querySelector('[data-run-confirm-dialog]')
          return el !== null
            && el.getAttribute('data-confirm-id') === id
            && el.getAttribute('data-confirm-resolution') !== null
        },
        secondId,
        { timeout: 60_000 },
      )
      // The product's own timeout sentence, on the page, while the resolved dialog lingers.
      expect(
        await page.evaluate(() => document.body.innerText),
        'the page never told the person the second run was denied on silence',
      ).toContain('denied — nobody answered before the window closed')

      // AND OVER THE WHOLE RENDER HISTORY, not one snapshot, because "the person was told" is a
      // claim about everything the DOM ever held.
      const rendered = (await readWire(page)).dialogs.filter((shot) => shot.present)
      const toldAbout = rendered
        .filter((shot) => shot.confirmId === secondId && shot.resolution != null)
      expect(
        toldAbout,
        'no rendered state carried the unanswered question together with its resolution',
      ).not.toEqual([])
      expect(toldAbout.map((shot) => shot.resolvedBy)).toContain('timeout')
      expect(
        toldAbout.map((shot) => shot.outcome),
      ).toContain('denied — nobody answered before the window closed')
      expect(
        toldAbout.every((shot) => shot.answers?.length === 0),
        'a question the server had already refused was still offering answers',
      ).toBe(true)

      // THE TWO RUNS' FINAL OUTCOMES, mapped to the two triggers. One person, one "Yes", two runs:
      // the one they answered ran, and the one whose window ran out while they read the answer was
      // refused — and, unlike before, refused where they could see it.
      await waitFor(() => { expect(triggeredRunIds).toHaveLength(2) })
      const [runA, runB] = triggeredRunIds as [string, string]
      await waitFor(() => { expect(scene.settled()).toHaveLength(2) })
      expect(
        scene.buffered(runA).map((event) => event['type']),
        'the run whose question the person answered never started',
      ).toContain('runStarted')
      expect(
        scene.buffered(runB).map((event) => event['type']),
        'the run whose question was never answered started anyway',
      ).not.toContain('runStarted')
      const deniedSettle = scene.settled().find((entry) => entry.runId === runB)
      expect(deniedSettle, 'the refused run never settled').toBeDefined()
      expect(
        deniedSettle!.details['remedies'],
        'the refused run carried no way forward',
      ).toEqual([{ kind: 'answer-confirm' }])
      // WHAT THE REFUSED RUN'S RECORD SAYS. Pinned VERBATIM because two of these strings are
      // findings in their own right, and a cell that only asserted "it failed" would hide both:
      //
      //   * `failureSummary` — the line a runs list shows — says a PROCESS EXITED. No process
      //     exited. The gate refused before anything started, and the true reason is one field
      //     further away in `errorLog`.
      //   * the reason offers `--trust-session`, a CLI flag, to somebody who was sitting in a
      //     browser. 401-09's mutation 4 guarded exactly this leak on the TYPED remedies (which
      //     are correctly `answer-confirm` above); the prose channel still carries it.
      //
      // RECORDED, NOT ENDORSED. If either is repaired this assertion reds, which is the point.
      const deniedRun = scene.db.getRun(runB)
      expect(deniedRun?.status).toBe('failed')
      expect(
        deniedRun?.failureSummary,
        'the refused run is summarised as a process that exited',
      ).toBe('Process exited before test completed')
      expect(
        deniedRun?.errorLog,
        'the only record of WHY the run never happened',
      ).toContain('prompted-denied')
      expect(
        deniedRun?.errorLog,
        'a CLI flag is offered as the way forward to somebody in a browser',
      ).toContain('--trust-session')

      // AND THE APPROVED RUN REALLY STARTED — read off the run's own artifacts, never the UI's
      // optimism. `target.hits` is a MEMBERSHIP assertion and never a count: `playwright-core`
      // caches its browsers root, so `openScene`'s empty-browsers pin is inert here and an
      // approved run drives a real browser at the counting target.
      expect(eventTypes(fixture)).toContain('runStarted')
      expect(buildOrdinalsExist(fixture)).toBe(true)
      expect(target.hits, 'the approved run never touched the target').toContain('/in-process-thing')
      const outcomes = runStartRows(fixture).map((row) => row.outcome).sort()
      expect(outcomes).toEqual(['prompted-approved', 'prompted-denied'])
    } finally {
      await target.close()
    }
  }, 300_000)
})
