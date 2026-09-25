/// <reference lib="dom" />
// The DOM lib is referenced here because this file's `page.evaluate` callbacks run in a browser.

// THE LIVE PREVIEW'S CORNER ON THE SHIPPED PAGE (428 SC2/SC3, D-02/D-13/D-15/D-16 · PXH-LIVE-02/03).
//
// jsdom proved the corner's contract in `live-preview.test.tsx`: one dot, its name, its tooltip,
// the snapshot label, the reduced-motion rule. jsdom computes no animation and lays nothing out, so
// every claim here is made again on the BUILT dashboard-ui bundle, served by the production
// `startServer` and driven by a real headless Chromium: one pulsing green element on the whole
// page, a dot that sits on the picture's top-right corner, amber when frames stop while the bus
// keeps heartbeating, and the literal snapshot label when the frames are snapshots.
//
// THE RUN IS PLANTED AND THE SERVER IS NOT (see `live-view-fixture.ts`). Every word a cell expects
// is read out of `lib/live-preview.ts`, so a copy change that forgets these cells turns them red.
//
// A BROWSER THAT CANNOT LAUNCH IS A RED, NEVER A SKIP. Captures go only where
// AGENT_QA_428_CAPTURE_DIR points.

import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from 'playwright-core'
import type { Browser, Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  DASHBOARD_ANCHORED_BUILDS,
  PACKAGES_ROOT,
  REBUILD_INSTRUCTION,
  buildFreshness,
  cleanupTempRoots,
  dashboardUiDist,
} from './spawned-chat.js'
import { plantLiveRun, publishTo, startLiveViewHarness } from './live-view-fixture.js'
import type { LiveViewHarness, PlantLiveRunInput, PlantedLiveRun } from './live-view-fixture.js'

const BROWSER_INSTALL_INSTRUCTION =
  'these cells drive the BUILT dashboard UI in a real Chromium: run '
  + '`pnpm exec playwright install chromium` and re-run. They must not be skipped when the browser '
  + 'is absent.'

const CAPTURE_DIR_ENV = 'AGENT_QA_428_CAPTURE_DIR'
const DESKTOP = { width: 1280, height: 800 }
const NARROW = { width: 400, height: 800 }

/** A published sentence, read out of the dashboard-ui source that publishes it. */
function publishedSentence(relativePath: string, name: string): string {
  const source = readFileSync(join(PACKAGES_ROOT, 'dashboard-ui', 'src', relativePath), 'utf8')
  const match = new RegExp(`${name}\\s*=\\s*'([^']+)'`, 'u').exec(source)
  if (match === null) throw new Error(`${name} is no longer an exported single-quoted literal in ${relativePath}`)
  return match[1] as string
}

/** One member of a published `{ key: '...' }` table, read the same way. */
function publishedMember(relativePath: string, table: string, key: string): string {
  const source = readFileSync(join(PACKAGES_ROOT, 'dashboard-ui', 'src', relativePath), 'utf8')
  const body = new RegExp(`${table}\\s*=\\s*\\{([^}]*)\\}`, 'u').exec(source)
  if (body === null) throw new Error(`${table} is no longer an exported object literal in ${relativePath}`)
  const match = new RegExp(`(?:^|[\\s,{])'?${key}'?\\s*:\\s*'([^']+)'`, 'u').exec(body[1] as string)
  if (match === null) throw new Error(`${table}.${key} is no longer a single-quoted literal in ${relativePath}`)
  return match[1] as string
}

const SNAPSHOT_PREVIEW_LABEL = publishedSentence('lib/live-preview.ts', 'SNAPSHOT_PREVIEW_LABEL')
const PREVIEW_DELAYED_TEXT = publishedSentence('lib/live-preview.ts', 'PREVIEW_DELAYED_TEXT')
const GREEN_NAME = publishedMember('lib/live-preview.ts', 'LIVE_DOT_NAMES', 'green')
const GREEN_MEANING = publishedMember('lib/live-preview.ts', 'LIVE_DOT_MEANINGS', 'green')
const AMBER_NAME = publishedMember('lib/live-preview.ts', 'LIVE_DOT_NAMES', 'amber')

/** SC3: the freshness window (5 s) plus the corner's 1 s clock and one 500 ms report, with margin. */
const STALL_TO_AMBER_BUDGET_MS = 7_000
const RESUME_TO_GREEN_BUDGET_MS = 3_000
const STALL_HEARTBEAT_MS = 1_000

const DOT_RUN = 'r_428_dot'
const SNAPSHOT_RUN = 'r_428_snapshot'
const FALLBACK_RUN = 'r_428_fallback'

interface PreviewFixture {
  readonly harness: LiveViewHarness
  readonly browser: Browser
  readonly jpeg: Uint8Array
  readonly png: Uint8Array
}

let fixture: PreviewFixture | undefined
const plantedRuns: PlantedLiveRun[] = []

function held(): PreviewFixture {
  if (fixture === undefined) throw new Error('the 428 live preview fixture never came up')
  return fixture
}

/** Plant a one-member run whose member has started a step, so its row breathes. */
function plantStreamingRun(input: PlantLiveRunInput): PlantedLiveRun {
  const run = plantLiveRun(input)
  plantedRuns.push(run)
  held().harness.plant(run)
  publishTo(run, 'runStarted', { busSchemaVersion: 1, memberTestCount: 1, handles: [0] })
  publishTo(run, 'testStarted', { testId: 't0', testIndex: 0, name: 'the preview member', totalSteps: 2 })
  publishTo(run, 'stepStarted', { testIndex: 0, stepIndex: 0, stepText: 'open the page' })
  return run
}

beforeAll(async () => {
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

  // Real, decodable bytes from the browser itself: a literal would paint nothing.
  const shotPage = await browser.newPage()
  await shotPage.setViewportSize({ width: 640, height: 400 })
  await shotPage.setContent('<body style="background:#123456"><h1>live</h1></body>')
  const jpeg = new Uint8Array(await shotPage.screenshot({ type: 'jpeg', quality: 40 }))
  const png = new Uint8Array(await shotPage.screenshot({ type: 'png' }))
  await shotPage.close()

  const harness = await startLiveViewHarness({ label: '428-23-preview', uiDir: dashboardUiDist() })
  fixture = { harness, browser, jpeg, png }

  plantStreamingRun({
    runId: DOT_RUN,
    heartbeatMs: 10_000,
    capability: { kind: 'cdp-screencast' },
    frameBytes: jpeg,
  })
  plantStreamingRun({
    runId: SNAPSHOT_RUN,
    heartbeatMs: 10_000,
    capability: { kind: 'snapshot' },
    frameBytes: png,
    frameKind: 'snapshot',
  })
  // The hub's fallback seat (428-04): a screencast is declared, and the frames that arrive are
  // snapshots. The label must follow the frames, not the declaration.
  plantStreamingRun({
    runId: FALLBACK_RUN,
    heartbeatMs: 10_000,
    capability: { kind: 'cdp-screencast' },
    frameBytes: png,
    frameKind: 'snapshot',
  })
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

/** Open the live page for one run in a fresh context, and close it afterwards. */
async function onLivePage<T>(
  runId: string,
  body: (page: Page) => Promise<T>,
  viewport: { width: number; height: number } = DESKTOP,
): Promise<T> {
  const context = await held().browser.newContext({ viewport })
  try {
    const page = await context.newPage()
    await page.goto(`${held().harness.origin}/runs/${encodeURIComponent(runId)}/live`)
    return await body(page)
  } finally {
    await context.close()
  }
}

async function waitForGreen(page: Page): Promise<void> {
  await page.locator('[data-preview-state="live"]').waitFor({ state: 'attached', timeout: 40_000 })
  await page.locator('[data-live-dot="green"]').waitFor({ state: 'attached', timeout: 10_000 })
}

/** The corner's reading at this instant, without Playwright's implicit waits. */
async function cornerReading(page: Page): Promise<{ state: string | null; dot: string | null; words: string | null; label: string | null }> {
  return page.evaluate(() => ({
    state: document.querySelector('[data-preview-state]')?.getAttribute('data-preview-state') ?? null,
    dot: document.querySelector('[data-live-dot]')?.getAttribute('data-live-dot') ?? null,
    words: document.querySelector('[data-preview-words]')?.textContent ?? null,
    label: document.querySelector('[data-snapshot-label]')?.textContent ?? null,
  }))
}

async function capture(page: Page, name: string): Promise<void> {
  const directory = process.env[CAPTURE_DIR_ENV]
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  await page.locator('[data-preview-frame]').first()
    .screenshot({ path: join(directory, `${name}.png`), animations: 'disabled' })
}

interface Box { x: number; y: number; width: number; height: number }

async function cornerGeometry(page: Page): Promise<{ frame: Box; dot: Box }> {
  const frame = await page.locator('[data-preview-frame]').boundingBox()
  const dot = await page.locator('[data-live-dot]').boundingBox()
  if (frame === null || dot === null) throw new Error(`no box: frame=${JSON.stringify(frame)} dot=${JSON.stringify(dot)}`)
  return { frame, dot }
}

function expectDotOnTopRight(geometry: { frame: Box; dot: Box }, label: string): void {
  const { frame, dot } = geometry
  const context = `${label}: ${JSON.stringify(geometry)}`
  expect(frame.width, `${context} — the picture has a size`).toBeGreaterThan(40)
  expect(dot.x, context).toBeGreaterThanOrEqual(frame.x)
  expect(dot.y, context).toBeGreaterThanOrEqual(frame.y)
  expect(dot.x + dot.width, context).toBeLessThanOrEqual(frame.x + frame.width)
  expect(dot.y + dot.height, context).toBeLessThanOrEqual(frame.y + frame.height)
  expect(dot.x, `${context} — right half`).toBeGreaterThanOrEqual(frame.x + frame.width / 2)
  expect(dot.y + dot.height, `${context} — top half`).toBeLessThanOrEqual(frame.y + frame.height / 2)
}

describe('the live preview corner on the shipped bundle (428-23 Task 1)', () => {
  it('ONE-PULSING-GREEN-DOT: exactly one element on the page pulses, and it is the green dot', async () => {
    await onLivePage(DOT_RUN, async (page) => {
      await waitForGreen(page)
      // The control: a running step breathes, and that animation is not the dot's.
      await page.locator('[data-step-motion]').first().waitFor({ state: 'attached', timeout: 20_000 })
      const census = await page.evaluate(() => {
        const probe = document.createElement('span')
        probe.style.backgroundColor = 'var(--color-emerald-500)'
        document.body.append(probe)
        const greenToken = getComputedStyle(probe).backgroundColor
        probe.remove()
        const all = [...document.querySelectorAll('*')]
        const pulsing = all
          .filter((node) => getComputedStyle(node).animationName === 'live-dot-pulse')
          .map((node) => ({
            tag: node.tagName,
            background: getComputedStyle(node).backgroundColor,
            inGreenDot: node.closest('[data-live-dot="green"]') !== null,
          }))
        const others = all
          .map((node) => getComputedStyle(node).animationName)
          .filter((name) => name !== 'none' && name !== 'live-dot-pulse')
        return { greenToken, pulsing, otherAnimations: [...new Set(others)] }
      })
      const context = JSON.stringify(census)
      expect(census.pulsing, context).toHaveLength(1)
      expect(census.pulsing[0]?.inGreenDot, context).toBe(true)
      expect(census.greenToken, `${context} — the green token resolved`).not.toBe('rgba(0, 0, 0, 0)')
      expect(census.pulsing[0]?.background, context).toBe(census.greenToken)
      expect(census.otherAnimations, `${context} — the breathing glyph animates and was not counted`)
        .toContain('live-step-breathe')
    })
  }, 120_000)

  it('DOT-NAME-AND-FOCUSABLE-TOOLTIP: the dot is a named button, Tab reaches it, and focus shows its meaning', async () => {
    await onLivePage(DOT_RUN, async (page) => {
      await waitForGreen(page)
      const named = page.getByRole('button', { name: GREEN_NAME })
      expect(await named.count()).toBe(1)
      expect(await named.getAttribute('data-live-dot')).toBe('green')

      const walked: string[] = []
      let focused = false
      for (let press = 0; press < 80 && !focused; press += 1) {
        await page.keyboard.press('Tab')
        const active = await page.evaluate(() => {
          const node = document.activeElement
          return {
            dot: node?.hasAttribute('data-live-dot') ?? false,
            name: node === null ? 'null' : `${node.tagName}${node.getAttribute('aria-label') === null ? '' : `[${node.getAttribute('aria-label') ?? ''}]`}`,
          }
        })
        walked.push(active.name)
        focused = active.dot
      }
      expect(focused, `Tab never reached the dot; focus walked ${JSON.stringify(walked)}`).toBe(true)

      const tooltip = page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')
      await tooltip.first().waitFor({ state: 'visible', timeout: 5_000 })
      expect(await tooltip.first().textContent()).toContain(GREEN_MEANING)
    })
  }, 120_000)

  it('CORNER-ON-PICTURE: the dot sits inside the picture\'s box, in its top-right quarter', async () => {
    await onLivePage(DOT_RUN, async (page) => {
      await waitForGreen(page)
      expectDotOnTopRight(await cornerGeometry(page), '1280')
      await capture(page, '428-corner-healthy-1280')
    })
    await onLivePage(DOT_RUN, async (page) => {
      await waitForGreen(page)
      expectDotOnTopRight(await cornerGeometry(page), '400')
      await capture(page, '428-corner-healthy-400')
    }, NARROW)
  }, 120_000)

  it('STALL-TURNS-AMBER-WHILE-HEARTBEAT-CONTINUES: frames stop, the bus heartbeats, the dot goes amber', async () => {
    const run = plantStreamingRun({
      runId: 'r_428_stall',
      heartbeatMs: STALL_HEARTBEAT_MS,
      capability: { kind: 'cdp-screencast' },
      frameBytes: held().jpeg,
    })
    await onLivePage(run.runId, async (page) => {
      await waitForGreen(page)

      const beatsBefore = run.heartbeatsSeen()
      const framesBefore = run.deliveredFrameIds().length
      const stalledAt = Date.now()
      run.stall()
      let amber = await cornerReading(page)
      while (Date.now() - stalledAt < STALL_TO_AMBER_BUDGET_MS) {
        amber = await cornerReading(page)
        if (amber.dot === 'amber' && amber.words === PREVIEW_DELAYED_TEXT) break
        await page.waitForTimeout(100)
      }
      const amberAfterMs = Date.now() - stalledAt
      const beatsDuring = run.heartbeatsSeen() - beatsBefore
      const framesDuring = run.deliveredFrameIds().length - framesBefore
      const context = JSON.stringify({ amber, amberAfterMs, beatsDuring, framesDuring })
      console.log(`STALL-TURNS-AMBER: ${context}`)

      expect(amber.dot, context).toBe('amber')
      expect(amber.state, context).toBe('delayed')
      expect(amber.words, context).toBe(PREVIEW_DELAYED_TEXT)
      expect(await page.getByRole('button', { name: AMBER_NAME }).count(), context).toBe(1)
      expect(beatsDuring, `${context} — the bus kept heartbeating through the stall`).toBeGreaterThan(0)
      expect(framesDuring, `${context} — no frame was produced while stalled`).toBe(0)
      await capture(page, '428-corner-delayed-1280')

      const resumedAt = Date.now()
      run.resume()
      let green = await cornerReading(page)
      while (Date.now() - resumedAt < RESUME_TO_GREEN_BUDGET_MS) {
        green = await cornerReading(page)
        if (green.dot === 'green') break
        await page.waitForTimeout(100)
      }
      const greenAfterMs = Date.now() - resumedAt
      console.log(`STALL-TURNS-AMBER resume: ${JSON.stringify({ green, greenAfterMs })}`)
      expect(green.dot, JSON.stringify({ green, greenAfterMs })).toBe('green')
      expect(green.state).toBe('live')
    })
  }, 120_000)

  it('SNAPSHOT-LABEL-ON-SNAPSHOT-FRAMES: snapshot frames carry the literal label beside the dot', async () => {
    expect(SNAPSHOT_PREVIEW_LABEL).toBe('Snapshot preview · updates every 1s')
    await onLivePage(SNAPSHOT_RUN, async (page) => {
      await waitForGreen(page)
      const label = page.locator('[data-preview-corner] [data-snapshot-label]')
      await label.waitFor({ state: 'attached', timeout: 10_000 })
      expect(await label.textContent()).toBe(SNAPSHOT_PREVIEW_LABEL)
      await capture(page, '428-corner-snapshot-1280')
    })
    await onLivePage(SNAPSHOT_RUN, async (page) => {
      await waitForGreen(page)
      const label = page.locator('[data-preview-corner] [data-snapshot-label]')
      await label.waitFor({ state: 'attached', timeout: 10_000 })
      expect(await label.textContent()).toBe(SNAPSHOT_PREVIEW_LABEL)
      await capture(page, '428-corner-snapshot-400')
    }, NARROW)
  }, 120_000)

  it('SNAPSHOT-LABEL-ON-FALLBACK-FRAMES: a declared screencast whose frames are snapshots is labelled', async () => {
    await onLivePage(FALLBACK_RUN, async (page) => {
      await waitForGreen(page)
      let reading = await cornerReading(page)
      const deadline = Date.now() + 5_000
      while (Date.now() < deadline && reading.label === null) {
        await page.waitForTimeout(100)
        reading = await cornerReading(page)
      }
      expect(reading.label, JSON.stringify(reading)).toBe(SNAPSHOT_PREVIEW_LABEL)
    })
  }, 120_000)

  it('NO-LABEL-ON-SCREENCAST: screencast frames show the green dot and no snapshot label', async () => {
    await onLivePage(DOT_RUN, async (page) => {
      await waitForGreen(page)
      const readings: Awaited<ReturnType<typeof cornerReading>>[] = []
      for (let sample = 0; sample < 10; sample += 1) {
        readings.push(await cornerReading(page))
        await page.waitForTimeout(200)
      }
      const context = JSON.stringify(readings)
      for (const reading of readings) {
        expect(reading.dot, context).toBe('green')
        expect(reading.label, context).toBeNull()
      }
      expect(await page.locator('[data-snapshot-label]').count(), context).toBe(0)
    })
  }, 120_000)

  it('REDUCED-MOTION-DOT-STILL: under prefers-reduced-motion the green dot does not animate', async () => {
    await onLivePage(DOT_RUN, async (page) => {
      await waitForGreen(page)
      const mark = page.locator('[data-live-dot="green"] [data-live-dot-mark]')
      const before = await mark.evaluate((node) => getComputedStyle(node).animationName)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const after = await mark.evaluate((node) => getComputedStyle(node).animationName)
      expect(before, 'the control: the same dot pulses without the preference').toBe('live-dot-pulse')
      expect(after).toBe('none')
    })
  }, 120_000)
})
