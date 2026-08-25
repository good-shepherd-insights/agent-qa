/// <reference lib="dom" />
// The DOM lib is referenced HERE because this file's `page.evaluate` callbacks are compiled as
// TypeScript and EXECUTED in a browser — `dashboard-dom.test.ts`'s reasoning, unchanged.

// THE HONEST LIVE SURFACE, IN A REAL BROWSER (403-06 Task 1 · HNST-01/02/03, LIVE-01/LIVE-04,
// D-09..D-12).
//
// WHY THIS FILE EXISTS. 403-05 proved the live page's contract in jsdom: 27 cells over a doubled
// EventSource, five mutation controls, a sentinel asserted on serialised HTML. That is the right
// instrument for a contract and the wrong one for a claim about PIXELS A PERSON LOOKS AT. jsdom
// runs no bundler output, paints no canvas, opens no socket and decodes no JPEG. Every claim below
// is about the BUILT `dashboard-ui` bundle, served by the production `startServer` frame with its
// real `uiDir`, driven by a real headless Chromium — the artifact a person is actually handed.
//
// A BROWSER THAT CANNOT LAUNCH IS A RED, NEVER A SKIP. No `skipIf`, no environment predicate, no
// try/catch that swallows the launch. A skipped visual suite exits 0 having measured nothing,
// which is the exact shape of vacuous green this repository has been bitten by before.
//
// THE RUN IS PLANTED AND THE SERVER IS NOT. See `live-view-fixture.ts` for what that trade buys
// and what it costs: the bus, the server, the mint, the validator, the registry and the bundle are
// all the shipped ones; the RunSession's three seams are held so a cell can hold a run mid-step
// and measure a twenty-one-second silence without sleeping and hoping.
//
// THE TIMING CELLS RUN IN REAL TIME, DELIBERATELY. 403-05's k=5 liveness cells run on fake timers,
// which measures the reducer's arithmetic. What has never been measured is whether the SHIPPED
// page, over a real socket, against a real bus heartbeat, still says the true word after eleven
// seconds — and whether it says `lost` after twenty-one on a socket that is STILL OPEN. Fake
// timers cannot answer either question, so these are wall-clock arms and every arm is reported.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from 'playwright-core'
import type { Browser, Frame, Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  DASHBOARD_ANCHORED_BUILDS,
  PACKAGES_ROOT,
  REBUILD_INSTRUCTION,
  buildFreshness,
  cleanupTempRoots,
  dashboardUiDist,
} from './spawned-chat.js'
import {
  plantLiveRun,
  publishTo,
  readOneStream,
  startLiveViewHarness,
} from './live-view-fixture.js'
import type { LiveViewHarness, PlantedLiveRun } from './live-view-fixture.js'

const BROWSER_INSTALL_INSTRUCTION =
  'these cells drive the BUILT dashboard UI in a real Chromium: run '
  + '`pnpm exec playwright install chromium` and re-run. THEY MUST NOT BE SKIPPED WHEN THE BROWSER '
  + 'IS ABSENT — they are the only cells in this repository that measure the live surface in the '
  + 'medium a person actually sees.'

/**
 * THE SENTINELS. One constant each, fed through the producer and asserted absent on the SERIALISED
 * document — 403-04's law, applied at the surface. Two spellings because they ride two different
 * payload fields, and a single spelling could not tell which one leaked.
 */
const SENTINEL_REASONING = 'SENTINEL-REASONING-7f3a'
const SENTINEL_ACTION = 'SENTINEL-ACTION-9c1e'

/**
 * A published sentence, read out of the component that publishes it.
 *
 * SPELLED ONCE, AND THAT PLACE IS THE SOURCE. 403-05 exported these as constants so this file
 * could bind to them rather than retype them; importing a `.tsx` into a Node test would drag a
 * renderer in, so the literal is EXTRACTED instead. Either way this cell fails when the sentence
 * moves, which is the whole point — a hardcoded copy would go on passing against a page that says
 * something else.
 */
function publishedSentence(relativePath: string, name: string): string {
  const source = readFileSync(join(PACKAGES_ROOT, 'dashboard-ui', 'src', relativePath), 'utf8')
  const match = new RegExp(`${name}\\s*=\\s*'([^']+)'`, 'u').exec(source)
  if (match === null) throw new Error(`${name} is no longer an exported single-quoted literal in ${relativePath}`)
  return match[1] as string
}

const NO_STREAM_TEXT = publishedSentence('components/live-run/preview-pane.tsx', 'NO_STREAM_TEXT')
const DID_NOT_RUN_NOTE = publishedSentence('lib/run-stream-reducer.ts', 'DID_NOT_RUN_NOTE')

interface DomFixture {
  readonly harness: LiveViewHarness
  readonly browser: Browser
  readonly dom: PlantedLiveRun
  readonly none: PlantedLiveRun
}

let fixture: DomFixture | undefined
const plantedRuns: PlantedLiveRun[] = []

function held(): DomFixture {
  if (fixture === undefined) throw new Error('the live-view DOM fixture never came up')
  return fixture
}

/** Every `/api/run-stream/` request one page made — one entry per ATTACH, so a reconnect shows. */
function trackAttaches(page: Page): string[] {
  const attaches: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/run-stream/')) attaches.push(request.url())
  })
  return attaches
}

/** Open a page on the live surface for one run and hand it to the body, closing it afterwards. */
async function onLivePage<T>(runId: string, body: (page: Page, attaches: string[]) => Promise<T>): Promise<T> {
  const page = await held().browser.newPage()
  const attaches = trackAttaches(page)
  try {
    await page.goto(`${held().harness.origin}/runs/${encodeURIComponent(runId)}/live`)
    return await body(page, attaches)
  } finally {
    await page.close()
  }
}

/**
 * The embed document's own frame, as a real `Frame` rather than a `FrameLocator`.
 *
 * THE IFRAME IS CROSS-ORIGIN BY CONSTRUCTION — `sandbox="allow-scripts"` withholds
 * `allow-same-origin`, so the embedded document sits in an opaque origin the parent cannot read.
 * Playwright reaches it through the page's frame list, which is what lets a cell assert on a
 * document the dashboard itself is deliberately unable to see.
 */
async function liveEmbedFrame(page: Page, budgetMs = 30_000): Promise<Frame> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    const found = page.frames().find((frame) => frame.url().includes('/live/'))
    if (found !== undefined) return found
    await page.waitForTimeout(100)
  }
  throw new Error(`no embed frame appeared within ${String(budgetMs)}ms; frames: ${JSON.stringify(page.frames().map((f) => f.url()))}`)
}

beforeAll(async () => {
  // FIRST, AND BEFORE ANYTHING IS SERVED. `uiDir` points at `dashboard-ui/dist`; a stale bundle
  // passes every cell below while certifying the previous revision.
  expect(buildFreshness(DASHBOARD_ANCHORED_BUILDS), REBUILD_INSTRUCTION)
    .toEqual({ missing: [], stale: [] })

  let browser: Browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (error) {
    throw new Error(
      `${BROWSER_INSTALL_INSTRUCTION} underlying error: `
      + `${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // REAL, DECODABLE JPEG BYTES, produced by the browser itself. A literal or a hand-built buffer
  // would fail `createImageBitmap` in the embed page and `data-embed-frames` would stay at 0 while
  // the socket looked perfectly healthy — a red that reads like a transport defect and is a
  // fixture defect.
  const shotPage = await browser.newPage()
  await shotPage.setViewportSize({ width: 640, height: 400 })
  await shotPage.setContent('<body style="background:#123456"><h1>live</h1></body>')
  const shot = await shotPage.screenshot({ type: 'jpeg', quality: 40 })
  await shotPage.close()
  const jpeg = new Uint8Array(shot)

  const harness = await startLiveViewHarness({ label: 'dom', uiDir: dashboardUiDist() })

  const dom = plantLiveRun({
    runId: 'r_dom',
    heartbeatMs: 10_000,
    capability: { kind: 'cdp-screencast' },
    frameBytes: jpeg,
    frameWidth: 640,
    frameHeight: 400,
  })
  const none = plantLiveRun({ runId: 'r_none', heartbeatMs: 10_000, capability: { kind: 'none' } })
  plantedRuns.push(dom, none)
  harness.plant(dom)
  harness.plant(none)

  publishTo(dom, 'runStarted', { busSchemaVersion: 1, memberTestCount: 1, handles: [0] })
  publishTo(dom, 'testStarted', { testId: 't0', testIndex: 0, name: 'the surface member', totalSteps: 2 })
  publishTo(none, 'runStarted', { busSchemaVersion: 1, memberTestCount: 1, handles: [0] })
  publishTo(none, 'testStarted', { testId: 't0', testIndex: 0, name: 'the browserless member', totalSteps: 1 })

  fixture = { harness, browser, dom, none }
}, 180_000)

afterAll(async () => {
  const open = fixture
  fixture = undefined
  if (open !== undefined) {
    await open.harness.close()
    await open.browser.close()
  }
  for (const run of plantedRuns) run.close()
  plantedRuns.length = 0
  cleanupTempRoots()
})

/** The harness's own source — cell (0) asserts the frame these cells run behind, where it exists. */
const HARNESS_SOURCE = join(
  PACKAGES_ROOT, 'cli', 'src', '__tests__', 'conformance', 'live-view-fixture.ts',
)

describe('the built live surface, in a real browser (403-06 Task 1)', () => {
  it('(0) THE FRAME: these cells run behind the production server, not a router in a fixture', () => {
    // A CELL CANNOT SEE ITS OWN FRAME BEHAVIOURALLY, which is the tracer's Pitfall-10 argument in
    // a different key. Every assertion below would read identically against a bare router mounted
    // in this file — and a process-level truth proven on a router is not proven. So the frame is
    // asserted where it exists: in the harness's source, by name, with every anchor required
    // present so the cell cannot pass by matching nothing.
    const source = readFileSync(HARNESS_SOURCE, 'utf8')
    for (const anchor of [
      'startServer(',
      'uiDir',
      'runServiceAttach',
      'composeDashboardDoor(',
      'composeLiveView(',
      'mintLiveUrlThrough(',
      'createRunEventBus(',
      'createRunServiceSessionRegistry(',
    ]) {
      expect(source.includes(anchor), `${anchor} must be how the harness composes this surface`).toBe(true)
    }
    // AND THE BUNDLE IS THE SHIPPED ONE. `uiDir` resolves to `dashboard-ui/dist`, whose freshness
    // `beforeAll` already refused to proceed without.
    expect(dashboardUiDist().endsWith(join('dashboard-ui', 'dist'))).toBe(true)
  })

  it('(1) is exactly two panes, and neither of them is an image', async () => {
    await onLivePage('r_dom', async (page) => {
      await page.locator('[data-live-pane="steps"]').waitFor({ state: 'attached', timeout: 20_000 })
      expect(
        await page.locator('[data-live-pane]').count(),
        'D-09: two panes and nothing else — a third pane is a surface this phase deleted coming back',
      ).toBe(2)
      expect(await page.locator('[data-live-pane="steps"]').isVisible()).toBe(true)
      expect(await page.locator('[data-live-pane="preview"]').isVisible()).toBe(true)
      // NO STILLS ANYWHERE. The retired preview polled per-step screenshots and painted them as
      // though they were the browser; an `img` in either pane is that approach returning.
      expect(await page.locator('[data-live-pane] img').count()).toBe(0)
    })
  }, 60_000)

  it('(2) HNST-01: a payload carrying a half-finished thought reaches the row and NOT the document', async () => {
    const f = held()
    publishTo(f.dom, 'stepStarted', { testIndex: 0, stepIndex: 0, stepText: 'open the page' })
    publishTo(f.dom, 'subActionRecorded', {
      testIndex: 0,
      stepIndex: 0,
      subActionIndex: 0,
      // THE FIVE FIELDS D-10 REFUSES, every one carrying a sentinel. The reducer reads two
      // coordinates out of this payload and nothing else; this cell proves that at the surface
      // rather than at the type.
      plan: SENTINEL_REASONING,
      plannedAction: { type: SENTINEL_ACTION, to: SENTINEL_REASONING },
      grounding: { rationale: SENTINEL_REASONING },
      result: { ok: true, detail: SENTINEL_REASONING },
      screenStateHash: SENTINEL_REASONING,
    })

    // THE NON-VACUITY CONTROL, AND IT COMES FIRST. The absence below is only a claim about the
    // PAGE if the sentinel actually crossed the wire to it. The door serves the envelope's own
    // JSON verbatim, so the sentinel is in the bytes the browser was handed — which is what makes
    // "it is not in the document" a fact about what the page does with a payload rather than a
    // fact about a payload it never received.
    const served = await readOneStream(
      `${held().harness.origin}/api/run-stream/r_dom`,
      (body) => body.includes('event: subActionRecorded'),
    )
    expect(served, 'the door served the forbidden fields — the page is what drops them')
      .toContain(SENTINEL_REASONING)

    await onLivePage('r_dom', async (page) => {
      await page.locator('[data-step-status="running"]').waitFor({ state: 'attached', timeout: 20_000 })
      await page.locator('[data-step-ticks="1"]').waitFor({ state: 'attached', timeout: 20_000 })

      // ON THE SERIALISED DOCUMENT, never on a query for visible text. 403-05's M1 mutation leaks
      // the payload through a `title=` attribute: a visible-text assertion stays green under it and
      // this one does not.
      const html = await page.evaluate(() => document.documentElement.outerHTML)
      expect(html.length, 'the positive control — a document was actually read').toBeGreaterThan(500)
      expect(html, 'the half-finished reasoning is not reachable while the step runs')
        .not.toContain(SENTINEL_REASONING)
      expect(html, 'nor is the action that has not been taken yet').not.toContain(SENTINEL_ACTION)

      // AND THE PAGE DID RECEIVE IT. Without this the assertion above would pass on a page that
      // never got the envelope at all, which measures nothing.
      expect(await page.locator('[data-step-motion]').count()).toBeGreaterThanOrEqual(1)
      expect(await page.locator('[data-step-ticks-label]').first().textContent()).toBe('1 actions')

      // D-09's inertness, measured rather than asserted about the props: there is nothing in the
      // steps pane a person can click to open the thing that is not there.
      expect(
        await page.locator('[data-live-pane="steps"] a, [data-live-pane="steps"] button, '
          + '[data-live-pane="steps"] [role="button"], [data-live-pane="steps"] [onclick]').count(),
        'the step list is inert: everything a click could open is provisional until the step ends',
      ).toBe(0)
    })
  }, 90_000)

  it('(3) LIVE-01/LIVE-04: the preview pane embeds a minted liveUrl and the embed PAINTS', async () => {
    const f = held()
    const ackedBefore = f.dom.ackedFrameIds().length
    await onLivePage('r_dom', async (page) => {
      await page.locator('[data-preview-state="embedded"]').waitFor({ state: 'attached', timeout: 40_000 })
      const embed = page.locator('[data-live-embed]')
      await embed.waitFor({ state: 'attached', timeout: 10_000 })
      // The sandbox is the reason the token may ride the fragment at all (T-403-09).
      expect(await embed.getAttribute('sandbox')).toBe('allow-scripts')

      const frame = await liveEmbedFrame(page)
      await frame.locator('[data-embed-state="live"]').waitFor({ state: 'attached', timeout: 40_000 })
      await frame.waitForFunction(
        () => Number(document.querySelector('[data-embed-state]')?.getAttribute('data-embed-frames') ?? '0') >= 2,
        undefined,
        { timeout: 30_000 },
      )
      const width = await frame.locator('[data-embed-canvas]')
        .evaluate((node) => (node as HTMLCanvasElement).width)
      expect(width, 'a painted canvas carries the frame\'s own geometry').toBe(640)
    })

    // THE ACK IS THE FLOW CONTROL, so a painting viewer must have acked. Without it the producer
    // would never be asked for frame N+1 and `data-embed-frames` could not have reached 2.
    const acked = f.dom.ackedFrameIds()
    expect(acked.length, 'the embed acked every frame it painted').toBeGreaterThan(ackedBefore)
    for (const id of acked) expect(f.dom.deliveredFrameIds()).toContain(id)
  }, 120_000)

  it('(4) LIVE-04: a handle that declares `none` gets a sentence, never a frame that never arrives', async () => {
    await onLivePage('r_none', async (page) => {
      await page.locator('[data-preview-state="no-stream"]').waitFor({ state: 'attached', timeout: 40_000 })
      expect(await page.locator('[data-preview-state="no-stream"]').textContent()).toContain(NO_STREAM_TEXT)
      expect(
        await page.locator('[data-live-embed]').count(),
        'a declared absence embeds nothing — an iframe here would spin forever over no stream',
      ).toBe(0)
      // The steps pane keeps working, which is the other half of the sentence's promise.
      expect(await page.locator('[data-live-pane="steps"]').isVisible()).toBe(true)
    })
  }, 60_000)

  it('(5a) HNST-03: k=5 — the pill reads `live` across 11 s of heartbeat-only traffic', async () => {
    const f = held()
    const arms: { arm: number; liveness: string | null; lastActivity: string | null; attaches: number }[] = []
    for (let k = 0; k < 5; k += 1) {
      // A FRESH PAGE PER ARM, so each arm is an independent attach over an independent socket
      // rather than five readings of one page's single subscription.
      const reading = await onLivePage('r_dom', async (page, attaches) => {
        const pill = page.locator('[data-liveness]')
        await pill.waitFor({ state: 'attached', timeout: 20_000 })
        // NOTHING IS PUBLISHED HERE. The only traffic in this window is the bus's own 10 s
        // heartbeat, which is exactly the claim: a heartbeat is an ENVELOPE and it counts, while
        // the transport's own 15 s comment does not.
        await page.waitForTimeout(11_000)
        return {
          liveness: await pill.getAttribute('data-liveness'),
          lastActivity: await pill.getAttribute('data-last-activity'),
          attaches: attaches.length,
        }
      })
      arms.push({ arm: k + 1, ...reading })
    }
    for (const arm of arms) {
      const context = `arm ${String(arm.arm)} of 5: ${JSON.stringify(arms)}`
      expect(arm.liveness, context).toBe('live')
      expect(Number(arm.lastActivity), context).toBeLessThanOrEqual(10)
      expect(arm.attaches, `${context} — one continuous socket, not a reconnect loop`).toBe(1)
    }
    expect(f.dom.cancelCalls(), 'watching a run never cancels it').toBe(0)
    console.log(`(5a) k=5 heartbeat arms: ${JSON.stringify(arms)}`)
  }, 180_000)

  it('(5b) HNST-03: k=2 — an OPEN socket that has heard nothing for 21 s reads `lost`', async () => {
    const arms: {
      arm: number
      liveness: string | null
      lastActivity: string | null
      attaches: number
      afterPublish: string | null
    }[] = []
    for (let k = 0; k < 2; k += 1) {
      // A FRESH RUN PER ARM, ON A 60 s HEARTBEAT. The window has to be genuinely silent: a run
      // planted once in `beforeAll` would have heartbeated during the cells above, and the arm
      // would be measuring an arbitrary point in the bus's cadence rather than silence.
      const quiet = plantLiveRun({
        runId: `r_quiet_${String(k)}`,
        heartbeatMs: 60_000,
        capability: { kind: 'cdp-screencast' },
      })
      plantedRuns.push(quiet)
      held().harness.plant(quiet)
      publishTo(quiet, 'runStarted', { busSchemaVersion: 1, memberTestCount: 1, handles: [0] })

      const reading = await onLivePage(quiet.runId, async (page, attaches) => {
        const pill = page.locator('[data-liveness]')
        await pill.waitFor({ state: 'attached', timeout: 20_000 })
        await page.waitForTimeout(21_000)
        const silent = {
          liveness: await pill.getAttribute('data-liveness'),
          lastActivity: await pill.getAttribute('data-last-activity'),
          attaches: attaches.length,
        }
        // THE DISCRIMINATOR, AND THE REASON THIS CELL IS NOT SATISFIED BY A CLOSED SOCKET.
        // `lost` is ALSO what a CLOSED source reads, so "it says lost" on its own would be the
        // right word for the wrong reason. Publishing one envelope into the SAME socket and
        // watching the pill go back to `live` with the attach count UNCHANGED proves the channel
        // was open and delivering the whole time — which is exactly the open-socket lie HNST-03
        // refuses to tell.
        publishTo(quiet, 'heartbeat', {})
        await page.locator('[data-liveness="live"]').waitFor({ state: 'attached', timeout: 20_000 })
        expect(attaches.length, 'the socket was never re-opened — it was open all along').toBe(silent.attaches)
        return { ...silent, afterPublish: await pill.getAttribute('data-liveness') }
      })
      arms.push({ arm: k + 1, ...reading })
      expect(quiet.cancelCalls(), 'a viewer that stopped hearing anything did not end the run').toBe(0)
      expect(quiet.isDone(), 'and the run is still going').toBe(false)
    }
    for (const arm of arms) {
      const context = `arm ${String(arm.arm)} of 2: ${JSON.stringify(arms)}`
      expect(arm.liveness, context).toBe('lost')
      expect(Number(arm.lastActivity), context).toBeGreaterThanOrEqual(20)
      expect(arm.attaches, `${context} — ONE attach, so the socket never closed`).toBe(1)
      expect(arm.afterPublish, `${context} — and it recovers on the next envelope`).toBe('live')
    }
    console.log(`(5b) k=2 open-and-silent arms: ${JSON.stringify(arms)}`)
  }, 180_000)

  it('(5c) HNST-03: a dropped socket reads `reconnecting`, and `live` again once it is back', async () => {
    const f = held()
    await onLivePage('r_dom', async (page) => {
      await page.locator('[data-liveness="live"]').waitFor({ state: 'attached', timeout: 40_000 })

      // THE SERVER DROPS THE SOCKET. Not a client-side close and not a doubled error: the Node
      // server ends every open connection, which is what a restarted dashboard or a dropped
      // network link looks like from the page's side.
      f.harness.server.closeAllConnections()

      await page.locator('[data-liveness="reconnecting"]').waitFor({ state: 'attached', timeout: 20_000 })
      // AND IT RECOVERS. A page stuck on `reconnecting` forever is its own dishonesty.
      await page.locator('[data-liveness="live"]').waitFor({ state: 'attached', timeout: 60_000 })
    })
    expect(f.dom.cancelCalls()).toBe(0)
  }, 180_000)

  it('(6) D-12: the run ends, the page freezes, and it does not go anywhere', async () => {
    const f = held()
    await onLivePage('r_dom', async (page, attaches) => {
      await page.locator('[data-live-pane="steps"]').waitFor({ state: 'attached', timeout: 20_000 })
      await page.locator('[data-liveness="live"]').waitFor({ state: 'attached', timeout: 40_000 })

      publishTo(f.dom, 'stepFinalized', { testIndex: 0, stepIndex: 0, status: 'passed', durationMs: 1200 })
      publishTo(f.dom, 'testFinished', { testId: 't0', testIndex: 0, outcome: 'passed', durationMs: 1400 })
      publishTo(f.dom, 'verdict', { verdict: 'passed' })
      publishTo(f.dom, 'runFinished', { aggregateVerdict: 'passed', disposition: 'detached', finalSeq: f.dom.bus.currentSeq + 1 })
      f.dom.finish('passed')

      await page.locator('[data-terminal-state="passed"]').waitFor({ state: 'attached', timeout: 30_000 })
      await page.locator('[data-preview-state="ended"]').waitFor({ state: 'attached', timeout: 30_000 })
      // 403-05 D-2: the pill is a claim about a CHANNEL, so it goes away with the channel. A
      // finished run has no liveness to report, and `lost` over a clean `runFinished` would slander
      // the delivery that just completed.
      expect(
        await page.locator('[data-liveness]').count(),
        'the liveness pill is absent once the run is over (403-05 D-2)',
      ).toBe(0)
      // The embed comes down with the run: a token minted now would outlive the thing it addresses.
      // (The plan text expected `data-embed-state="ended"` INSIDE a surviving iframe; the shipped
      // pane unmounts the frame at `ended`, so the honest assertion is that there is no iframe.)
      expect(await page.locator('[data-live-embed]').count()).toBe(0)
      expect(await page.locator('[data-run-detail-link]').count()).toBe(1)
      expect(
        page.url().endsWith('/live'),
        'the page does NOT redirect on the verdict — that decision belongs to the person watching',
      ).toBe(true)

      // NO RECONNECT LOOP against a run the door has finished with. A page that kept re-opening
      // the stream would hammer a door that has already given its final answer.
      const settled = attaches.length
      await page.waitForTimeout(5_000)
      expect(attaches.length, `attaches: ${JSON.stringify(attaches)}`).toBe(settled)
    })
    expect(f.dom.cancelCalls(), 'D-16: no viewer ever cancelled this run').toBe(0)
  }, 150_000)

  it('(7) a member that never started a step says so, rather than showing blank rows', async () => {
    const f = held()
    publishTo(f.none, 'testFinished', { testId: 't0', testIndex: 0, outcome: 'skipped', durationMs: 5 })
    publishTo(f.none, 'verdict', { verdict: 'failed' })
    publishTo(f.none, 'runFinished', { aggregateVerdict: 'failed', disposition: 'detached', finalSeq: f.none.bus.currentSeq + 1 })
    f.none.finish('failed')

    await onLivePage('r_none', async (page) => {
      await page.locator('[data-member-note]').waitFor({ state: 'attached', timeout: 30_000 })
      expect(await page.locator('[data-member-note]').textContent()).toBe(DID_NOT_RUN_NOTE)
      expect(await page.locator('[data-member-outcome]').getAttribute('data-member-outcome')).toBe('skipped')
      await page.locator('[data-terminal-state="failed"]').waitFor({ state: 'attached', timeout: 20_000 })
    })
    expect(f.none.cancelCalls()).toBe(0)
  }, 90_000)
})
