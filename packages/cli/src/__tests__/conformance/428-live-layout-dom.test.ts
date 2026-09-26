/// <reference lib="dom" />
// The DOM lib is referenced here because this file's `page.evaluate` callbacks run in a browser.

// THE LIVE PAGE'S ROWS AND LAYOUT ON THE SHIPPED BUNDLE (428 SC4, D-06/D-19/D-20/D-22 · PXH-LIVE-04).
//
// jsdom proved the row and the layout contracts in `live-step-row.test.tsx` and `live-run.test.tsx`.
// jsdom paints nothing and lays nothing out, so these cells make the same claims again on the BUILT
// dashboard-ui bundle, served by the production `startServer` and driven by a real Chromium.
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
import type { LiveViewHarness, PlantedLiveRun } from './live-view-fixture.js'

const BROWSER_INSTALL_INSTRUCTION =
  'these cells drive the BUILT dashboard UI in a real Chromium: run '
  + '`pnpm exec playwright install chromium` and re-run. They must not be skipped when the browser '
  + 'is absent.'

const CAPTURE_DIR_ENV = 'AGENT_QA_428_CAPTURE_DIR'
const DESKTOP = { width: 1280, height: 800 }
const NARROW = { width: 400, height: 800 }

function publishedSentence(relativePath: string, name: string): string {
  const source = readFileSync(join(PACKAGES_ROOT, 'dashboard-ui', 'src', relativePath), 'utf8')
  const match = new RegExp(`${name}\\s*=\\s*'([^']+)'`, 'u').exec(source)
  if (match === null) throw new Error(`${name} is no longer an exported single-quoted literal in ${relativePath}`)
  return match[1] as string
}

function publishedTable(relativePath: string, table: string): Record<string, string> {
  const source = readFileSync(join(PACKAGES_ROOT, 'dashboard-ui', 'src', relativePath), 'utf8')
  const body = new RegExp(`${table}\\s*=\\s*\\{([^}]*)\\}`, 'u').exec(source)
  if (body === null) throw new Error(`${table} is no longer an exported object literal in ${relativePath}`)
  const entries = [...(body[1] as string).matchAll(/'?([A-Za-z]+)'?\s*:\s*'([^']+)'/gu)]
  if (entries.length === 0) throw new Error(`${table} has no single-quoted members in ${relativePath}`)
  return Object.fromEntries(entries.map((entry) => [entry[1] as string, entry[2] as string]))
}

const STATUS_NAMES = publishedTable('lib/live-step-row.ts', 'LIVE_STEP_STATUS_NAMES')
const MASKED_SECRET_LIVE_LABEL = publishedSentence('lib/run-detail-view.ts', 'MASKED_SECRET_LIVE_LABEL')

/** How long a row is watched for a clock or a count to appear: three ticks of any 1 s clock. */
const ROW_WATCH_MS = 3_000

const ROWS_RUN = 'r_428_rows'
const TITLE_RUN = 'r_428_title'
const SUITE_RUN = 'r_428_suite'
const SECRET_RUN = 'r_428_secret'
const OLD_PRODUCER_RUN = 'r_428_old_producer'
const LONG_RUN = 'r_428_long_label'

const SINGLE_TITLE = 'Checkout keeps the basket'
const SUITE_MEMBERS = ['the sign-in member', 'the basket member'] as const
const SECRET_STEP_TEXT = 'type <SECRET_1> into Password'
/** ROWS_RUN's three steps, as its testStarted carries them (428-30, G-428-2). */
const ROWS_STEP_TEXTS = ['open the search page', 'search for the blue kettle', 'add the kettle to the basket'] as const
/** The one step an old producer's run has started; its testStarted carries no stepTexts. */
const OLD_PRODUCER_STEP_TEXT = 'open the old checkout'
/**
 * The owner's own example from the 2026-09-26 review (G-428-1), which the one-line row cut off at
 * 'wait f…', extended so it is longer than the steps pane at any width, with one masked secret.
 */
const LONG_STEP_TEXT =
  'Select "Show" from the navbar, scroll to the end and click more, wait for the whole list to finish '
  + 'loading, then type <SECRET_1> into the search box and check that every card in the grid keeps its '
  + 'full title, its price and its supercalifragilisticexpialidocious caption visible without being cut off'
/** Every word the long label paints outside its placeholder. */
const LONG_STEP_WORDS = LONG_STEP_TEXT.replace(/<SECRET_\d+>/gu, ' ').split(/\s+/u).filter((word) => word !== '')

interface LayoutFixture {
  readonly harness: LiveViewHarness
  readonly browser: Browser
  readonly jpeg: Uint8Array
}

let fixture: LayoutFixture | undefined
const plantedRuns: PlantedLiveRun[] = []

function held(): LayoutFixture {
  if (fixture === undefined) throw new Error('the 428 live layout fixture never came up')
  return fixture
}

interface PlantedMember {
  readonly name: string
  readonly totalSteps: number
  /** Absent for an old producer, whose testStarted carries only the count. */
  readonly stepTexts?: readonly string[]
}

function plantRun(runId: string, members: readonly PlantedMember[]): PlantedLiveRun {
  const run = plantLiveRun({
    runId,
    heartbeatMs: 10_000,
    capability: { kind: 'cdp-screencast' },
    frameBytes: held().jpeg,
  })
  plantedRuns.push(run)
  held().harness.plant(run)
  publishTo(run, 'runStarted', { busSchemaVersion: 1, memberTestCount: members.length, handles: [0] })
  members.forEach((member, testIndex) => {
    publishTo(run, 'testStarted', {
      testId: `t${String(testIndex)}`,
      testIndex,
      name: member.name,
      totalSteps: member.totalSteps,
      ...(member.stepTexts === undefined ? {} : { stepTexts: [...member.stepTexts] }),
    })
  })
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

  const shotPage = await browser.newPage()
  await shotPage.setViewportSize({ width: 640, height: 400 })
  await shotPage.setContent('<body style="background:#123456"><h1 style="color:#fff">live</h1></body>')
  const jpeg = new Uint8Array(await shotPage.screenshot({ type: 'jpeg', quality: 40 }))
  await shotPage.close()

  const harness = await startLiveViewHarness({ label: '428-24-layout', uiDir: dashboardUiDist() })
  fixture = { harness, browser, jpeg }

  // Rows in all three states: step 1 finished after two sub-actions, step 2 running after one, and
  // step 3 planned and pending. The pending row is drawn because testStarted carried its text
  // (428-30, G-428-2).
  const rows = plantRun(ROWS_RUN, [{ name: 'the rows member', totalSteps: 3, stepTexts: ROWS_STEP_TEXTS }])
  harness.insertRunRow({ runId: ROWS_RUN, name: 'Search finds the blue kettle', status: 'running' })
  publishTo(rows, 'stepStarted', { testIndex: 0, stepIndex: 0, stepText: ROWS_STEP_TEXTS[0] })
  publishTo(rows, 'subActionRecorded', { testIndex: 0, stepIndex: 0, subActionIndex: 0 })
  publishTo(rows, 'subActionRecorded', { testIndex: 0, stepIndex: 0, subActionIndex: 1 })
  publishTo(rows, 'stepFinalized', { testIndex: 0, stepIndex: 0, status: 'passed', durationMs: 65_000 })
  publishTo(rows, 'stepStarted', { testIndex: 0, stepIndex: 1, stepText: ROWS_STEP_TEXTS[1] })
  publishTo(rows, 'subActionRecorded', { testIndex: 0, stepIndex: 1, subActionIndex: 0 })

  const single = plantRun(TITLE_RUN, [{ name: SINGLE_TITLE, totalSteps: 2 }])
  harness.insertRunRow({ runId: TITLE_RUN, name: SINGLE_TITLE, status: 'running' })
  publishTo(single, 'stepStarted', { testIndex: 0, stepIndex: 0, stepText: 'open the basket' })

  const suite = plantRun(SUITE_RUN, SUITE_MEMBERS.map((name) => ({ name, totalSteps: 1 })))
  harness.insertRunRow({ runId: SUITE_RUN, name: 'The shop suite', status: 'running' })
  publishTo(suite, 'stepStarted', { testIndex: 0, stepIndex: 0, stepText: 'sign in' })

  const secret = plantRun(SECRET_RUN, [{ name: 'the secret member', totalSteps: 1 }])
  publishTo(secret, 'stepStarted', { testIndex: 0, stepIndex: 0, stepText: SECRET_STEP_TEXT })

  // An old producer: three steps counted, no texts sent, and only step 1 started.
  const oldProducer = plantRun(OLD_PRODUCER_RUN, [{ name: 'the old producer member', totalSteps: 3 }])
  harness.insertRunRow({ runId: OLD_PRODUCER_RUN, name: 'The old checkout', status: 'running' })
  publishTo(oldProducer, 'stepStarted', { testIndex: 0, stepIndex: 0, stepText: OLD_PRODUCER_STEP_TEXT })

  // One running step whose label is longer than the steps pane (428-31, G-428-1).
  const long = plantRun(LONG_RUN, [{ name: 'the long member', totalSteps: 1, stepTexts: [LONG_STEP_TEXT] }])
  harness.insertRunRow({ runId: LONG_RUN, name: 'The long label', status: 'running' })
  publishTo(long, 'stepStarted', { testIndex: 0, stepIndex: 0, stepText: LONG_STEP_TEXT })
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

async function captureElement(page: Page, selector: string, name: string): Promise<void> {
  const directory = process.env[CAPTURE_DIR_ENV]
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  await page.locator(selector).first().screenshot({ path: join(directory, `${name}.png`), animations: 'disabled' })
}

async function capturePage(page: Page, name: string): Promise<void> {
  const directory = process.env[CAPTURE_DIR_ENV]
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  await page.screenshot({ path: join(directory, `${name}.png`), animations: 'disabled' })
}

async function waitForGreen(page: Page): Promise<void> {
  await page.locator('[data-preview-state="live"]').waitFor({ state: 'attached', timeout: 40_000 })
  await page.locator('[data-live-dot="green"]').waitFor({ state: 'attached', timeout: 10_000 })
}

interface Box { x: number; y: number; width: number; height: number }

interface PageLayout {
  viewport: number
  panes: number
  embeds: number
  dot: string | null
  preview: Box | null
  steps: Box | null
  frame: Box | null
  dotBox: Box | null
  dotInFrame: boolean
}

async function readLayout(page: Page): Promise<PageLayout> {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const node = document.querySelector(selector)
      if (node === null) return null
      const rect = node.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    const frame = document.querySelector('[data-preview-frame]')
    const dot = document.querySelector('[data-live-dot]')
    return {
      viewport: window.innerWidth,
      panes: document.querySelectorAll('[data-live-pane]').length,
      embeds: document.querySelectorAll('[data-live-embed]').length,
      dot: dot?.getAttribute('data-live-dot') ?? null,
      preview: box('[data-live-pane="preview"]'),
      steps: box('[data-live-pane="steps"]'),
      frame: box('[data-preview-frame]'),
      dotBox: box('[data-live-dot]'),
      dotInFrame: frame !== null && dot !== null && frame.contains(dot),
    }
  })
}

function previewAboveSteps(layout: PageLayout): boolean {
  const { preview, steps } = layout
  return preview !== null && steps !== null && preview.y + preview.height <= steps.y + 1
}

/** How many frames the embed document says it painted, or -1 while there is no embed document. */
async function embedFramesPainted(page: Page): Promise<number> {
  const frame = page.frames().find((one) => one.url().includes('/live/'))
  if (frame === undefined) return -1
  return frame.evaluate(() =>
    Number(document.querySelector('[data-embed-state]')?.getAttribute('data-embed-frames') ?? '-1'),
  ).catch(() => -1)
}

async function waitForRowsInAllStates(page: Page): Promise<void> {
  for (const status of ['passed', 'running', 'pending']) {
    await page.locator(`[data-live-pane="steps"] li[data-step-status="${status}"]`).first()
      .waitFor({ state: 'attached', timeout: 40_000 })
  }
}

interface RowReading {
  status: string | null
  elementChildren: number
  firstRole: string | null
  firstName: string | null
  text: string
}

async function readRows(page: Page): Promise<{ rows: RowReading[]; progressbars: number; paneText: string }> {
  return page.evaluate(() => {
    const pane = document.querySelector('[data-live-pane="steps"]')
    const rows = [...(pane?.querySelectorAll('li[data-step-status]') ?? [])].map((row) => ({
      status: row.getAttribute('data-step-status'),
      elementChildren: row.children.length,
      firstRole: row.children[0]?.getAttribute('role') ?? null,
      firstName: row.children[0]?.getAttribute('aria-label') ?? null,
      text: (row as HTMLElement).innerText,
    }))
    return {
      rows,
      progressbars: pane?.querySelectorAll('[role="progressbar"]').length ?? -1,
      paneText: (pane as HTMLElement | null)?.innerText ?? '',
    }
  })
}

interface LongLabelReading {
  viewport: number
  lineHeight: number
  row: Box
  label: Box
  glyph: Box
  chip: Box | null
  pane: Box | null
  chipScroll: { scrollWidth: number; clientWidth: number } | null
  /** Every element in the row, the row included, whose content is wider than its box. */
  overflowing: { tag: string; className: string; scrollWidth: number; clientWidth: number }[]
  /** Every element in the row whose computed text-overflow is ellipsis. */
  ellipsised: string[]
  labelTextOverflow: string
  labelWhiteSpace: string
  text: string
}

/** Measure the running row of LONG_RUN in the page as laid out (428-31, G-428-1). */
async function readLongLabel(page: Page): Promise<LongLabelReading> {
  const row = page.locator('[data-live-pane="steps"] li[data-step-status="running"]')
  await row.waitFor({ state: 'attached', timeout: 40_000 })
  return row.evaluate((node) => {
    const li = node as HTMLElement
    const box = (element: Element | null) => {
      if (element === null) return null
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    const glyph = li.children[0] as HTMLElement
    const label = li.children[1] as HTMLElement
    const chip = li.querySelector('[data-masked]') as HTMLElement | null
    const style = getComputedStyle(label)
    const all = [li, ...li.querySelectorAll('*')].filter((element): element is HTMLElement => element instanceof HTMLElement)
    return {
      viewport: window.innerWidth,
      lineHeight: Number.parseFloat(style.lineHeight),
      row: box(li) as Box,
      label: box(label) as Box,
      glyph: box(glyph) as Box,
      chip: box(chip),
      pane: box(document.querySelector('[data-live-pane="steps"]')),
      chipScroll: chip === null ? null : { scrollWidth: chip.scrollWidth, clientWidth: chip.clientWidth },
      overflowing: all
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        })),
      ellipsised: all
        .filter((element) => getComputedStyle(element).textOverflow === 'ellipsis')
        .map((element) => `${element.tagName}.${element.className}`),
      labelTextOverflow: style.textOverflow,
      labelWhiteSpace: style.whiteSpace,
      text: li.innerText,
    }
  })
}

function expectLongLabelFullyVisible(reading: LongLabelReading, viewport: { width: number }): void {
  const context = JSON.stringify(reading)
  expect(reading.viewport, context).toBe(viewport.width)
  expect(reading.overflowing, `${context} — nothing in the row is wider than its box`).toEqual([])
  expect(reading.ellipsised, `${context} — no element ellipsises`).toEqual([])
  expect(reading.labelTextOverflow, context).not.toBe('ellipsis')
  expect(reading.labelWhiteSpace, context).not.toBe('nowrap')
  expect(Number.isFinite(reading.lineHeight) && reading.lineHeight > 0, `${context} — a measurable line`).toBe(true)
  expect(reading.row.height, `${context} — the row spans more than one line`).toBeGreaterThan(1.5 * reading.lineHeight)
  expect(reading.label.height, `${context} — the label spans at least two lines`).toBeGreaterThan(1.5 * reading.lineHeight)
  for (const word of LONG_STEP_WORDS) {
    expect(reading.text, `${context} — the word ${JSON.stringify(word)} is painted`).toContain(word)
  }
  expect(reading.text, context).not.toContain('<SECRET_')
  const { chip, row, label, glyph, pane } = reading
  expect(chip, `${context} — the chip is in the row`).not.toBeNull()
  if (chip !== null) {
    expect(chip.x, `${context} — the chip starts inside the row`).toBeGreaterThanOrEqual(row.x - 1)
    expect(chip.y, context).toBeGreaterThanOrEqual(row.y - 1)
    expect(chip.x + chip.width, `${context} — the chip ends inside the row`).toBeLessThanOrEqual(row.x + row.width + 1)
    expect(chip.y + chip.height, context).toBeLessThanOrEqual(row.y + row.height + 1)
  }
  expect(reading.chipScroll, context).not.toBeNull()
  if (reading.chipScroll !== null) {
    expect(reading.chipScroll.scrollWidth, `${context} — the chip is not clipped`)
      .toBeLessThanOrEqual(reading.chipScroll.clientWidth + 1)
  }
  if (pane !== null) {
    expect(row.x + row.width, `${context} — the row stays inside the steps pane`).toBeLessThanOrEqual(pane.x + pane.width + 1)
  }
  expect(glyph.y + glyph.height / 2 - label.y, `${context} — the glyph sits on the label's first line`)
    .toBeLessThan(reading.lineHeight)
}

describe('the live step rows on the shipped bundle (428-24 Task 1)', () => {
  it('LONG-LABEL-FULLY-VISIBLE-SHIPPED: a label longer than the steps pane wraps in full with a whole chip at 1280 and 400', async () => {
    // 1280 is the docked page; 400 is the stacked one, where the steps pane is the page's width.
    for (const viewport of [DESKTOP, NARROW]) {
      await onLivePage(LONG_RUN, async (page) => {
        const reading = await readLongLabel(page)
        console.log(`LONG-LABEL-FULLY-VISIBLE-SHIPPED ${String(viewport.width)}: ${JSON.stringify(reading)}`)
        expectLongLabelFullyVisible(reading, viewport)
        await captureElement(page, '[data-live-pane="steps"]', `428-live-steps-long-${String(viewport.width)}`)
      }, viewport)
    }
  }, 120_000)

  it('NO-STEP-PLACEHOLDER-SHIPPED: an old producer\'s run draws only its running row at 1280 and 400, and no row reads step N', async () => {
    for (const viewport of [DESKTOP, NARROW]) {
      await onLivePage(OLD_PRODUCER_RUN, async (page) => {
        await page.locator('[data-live-pane="steps"] li[data-step-status="running"]')
          .waitFor({ state: 'attached', timeout: 40_000 })
        await page.waitForTimeout(ROW_WATCH_MS)
        const reading = await readRows(page)
        const context = `${String(viewport.width)} px: ${JSON.stringify(reading)}`
        expect(reading.rows.map((row) => [row.status, row.text]), context)
          .toEqual([['running', OLD_PRODUCER_STEP_TEXT]])
        expect(reading.rows.filter((row) => /^step \d+$/iu.test(row.text.trim())), context).toEqual([])
        expect(reading.paneText, context).not.toMatch(/(?:^|\n)\s*step \d+\s*(?:\n|$)/iu)
        await captureElement(page, '[data-live-pane="steps"]', `428-live-old-producer-${String(viewport.width)}`)
      }, viewport)
    }
  }, 120_000)

  it('ROWS-GLYPH-AND-LABEL-SHIPPED: every running, finished and pending row is one named glyph and the label', async () => {
    await onLivePage(ROWS_RUN, async (page) => {
      await waitForRowsInAllStates(page)
      await page.waitForTimeout(ROW_WATCH_MS)
      const reading = await readRows(page)
      const context = JSON.stringify(reading)

      expect(reading.rows.map((row) => row.status), context).toEqual(['passed', 'running', 'pending'])
      for (const row of reading.rows) {
        expect(row.elementChildren, `${context} — two children: the glyph and the label`).toBe(2)
        expect(row.firstRole, context).toBe('img')
        expect(row.firstName, `${context} — the glyph's name is the status's published name`)
          .toBe(STATUS_NAMES[row.status ?? ''])
        expect(row.text, `${context} — no clock`).not.toMatch(/\d+:\d{2}/u)
        expect(row.text, `${context} — no count`).not.toMatch(/action/iu)
        expect(row.text, `${context} — no duration`).not.toMatch(/\d\s*(?:ms|s|sec|m|min)\b/u)
      }
      // RE-SPELLED 2026-09-26 (428-30, owner decision 2026-09-26 (2), G-428-2). This line pinned the
      // pending row to the step-N placeholder. The owner removed it, so ROWS_RUN's testStarted now
      // carries its step texts and the pending row reads its planted third text.
      expect(reading.rows.map((row) => row.text), context).toEqual([...ROWS_STEP_TEXTS])
      expect(reading.paneText, `${context} — the pane`).not.toMatch(/\d+:\d{2}|action/iu)
      expect(reading.progressbars, context).toBe(0)
      await captureElement(page, '[data-live-pane="steps"]', '428-live-steps-1280')
    })
    await onLivePage(ROWS_RUN, async (page) => {
      await waitForRowsInAllStates(page)
      const reading = await readRows(page)
      expect(reading.rows.every((row) => row.elementChildren === 2), JSON.stringify(reading)).toBe(true)
      await captureElement(page, '[data-live-pane="steps"]', '428-live-steps-400')
    }, NARROW)
  }, 120_000)

  it('NO-REPEATED-SINGLE-MEMBER-TITLE-SHIPPED: a single member named like its run says the title once', async () => {
    await onLivePage(TITLE_RUN, async (page) => {
      await page.locator('h2', { hasText: SINGLE_TITLE }).waitFor({ state: 'attached', timeout: 30_000 })
      await page.locator('[data-live-pane="steps"] li[data-step-status="running"]')
        .waitFor({ state: 'attached', timeout: 40_000 })
      const reading = await page.evaluate((title) => ({
        occurrences: document.body.innerText.split(title).length - 1,
        memberHeaders: document.querySelectorAll('[data-member] h3').length,
        members: document.querySelectorAll('[data-member]').length,
      }), SINGLE_TITLE)
      const context = JSON.stringify(reading)
      expect(reading.members, `${context} — the control: the member is on the page`).toBe(1)
      expect(reading.occurrences, context).toBe(1)
      expect(reading.memberHeaders, context).toBe(0)
    })
  }, 120_000)

  it('MULTI-MEMBER-HEADER-SHIPPED: a two-member suite shows one compact header per member', async () => {
    await onLivePage(SUITE_RUN, async (page) => {
      await page.locator('[data-member="1"]').waitFor({ state: 'attached', timeout: 40_000 })
      await page.locator('[data-member="0"] li[data-step-status="running"]').waitFor({ state: 'attached', timeout: 40_000 })
      const headers = await page.evaluate(() =>
        [...document.querySelectorAll('[data-member]')].map((member) => ({
          member: member.getAttribute('data-member'),
          headers: [...member.querySelectorAll('h3')].map((header) => (header as HTMLElement).innerText),
        })))
      const context = JSON.stringify(headers)
      expect(headers.map((one) => one.member), context).toEqual(['0', '1'])
      SUITE_MEMBERS.forEach((name, index) => {
        expect(headers[index]?.headers, context).toHaveLength(1)
        expect(headers[index]?.headers[0], context).toContain(name)
      })
    })
  }, 120_000)

  it('SECRET-CHIP-SHIPPED: a <SECRET_1> in a live label is the masked chip, and the raw placeholder is nowhere', async () => {
    await onLivePage(SECRET_RUN, async (page) => {
      const row = page.locator('[data-live-pane="steps"] li[data-step-status="running"]')
      await row.waitFor({ state: 'attached', timeout: 40_000 })
      const reading = await row.evaluate((node) => ({
        chips: node.querySelectorAll('[data-masked="secret"]').length,
        chipText: (node.querySelector('[data-masked="secret"]') as HTMLElement | null)?.innerText ?? null,
        text: node.textContent ?? '',
        body: document.body.innerText,
        html: document.documentElement.outerHTML,
      }))
      const context = JSON.stringify({ ...reading, body: undefined, html: undefined })
      expect(reading.chips, context).toBe(1)
      expect(reading.chipText, context).toBe(MASKED_SECRET_LIVE_LABEL)
      expect(reading.text, `${context} — the rest of the label is painted`).toContain('into Password')
      expect(reading.text, context).not.toContain('<SECRET_')
      expect(reading.body).not.toContain('<SECRET_')
      expect(reading.html).not.toContain('&lt;SECRET_')
    })
  }, 120_000)
})

/** D-06: a flip may reload the moved iframe, and the embed must reconnect by itself within this. */
const FLIP_TO_GREEN_BUDGET_MS = 8_000

describe('the live page layout on the shipped bundle (428-24 Task 2)', () => {
  it('STACKED-AT-400: the preview is on top at full width with its dot on the picture, over two panes', async () => {
    await onLivePage(ROWS_RUN, async (page) => {
      await waitForRowsInAllStates(page)
      await waitForGreen(page)
      const layout = await readLayout(page)
      const context = JSON.stringify(layout)
      console.log(`STACKED-AT-400: ${context}`)
      expect(layout.viewport, context).toBe(NARROW.width)
      expect(layout.panes, context).toBe(2)
      expect(previewAboveSteps(layout), `${context} — the preview is above the steps`).toBe(true)
      expect(layout.preview?.width ?? 0, `${context} — the preview spans the page`).toBeGreaterThanOrEqual(380)
      expect(layout.dotInFrame, `${context} — the dot is inside the picture`).toBe(true)
      const { frame, dotBox } = layout
      expect(frame !== null && dotBox !== null, context).toBe(true)
      if (frame !== null && dotBox !== null) {
        expect(dotBox.x + dotBox.width, context).toBeLessThanOrEqual(frame.x + frame.width)
        expect(dotBox.y, context).toBeGreaterThanOrEqual(frame.y)
      }
      await capturePage(page, '428-live-page-400')
    }, NARROW)
  }, 120_000)

  it('DOCKED-AT-1280: the steps sit left of the preview, over two panes', async () => {
    await onLivePage(ROWS_RUN, async (page) => {
      await waitForRowsInAllStates(page)
      await waitForGreen(page)
      const layout = await readLayout(page)
      const context = JSON.stringify(layout)
      console.log(`DOCKED-AT-1280: ${context}`)
      expect(layout.viewport, context).toBe(DESKTOP.width)
      expect(layout.panes, context).toBe(2)
      const { preview, steps } = layout
      expect(preview !== null && steps !== null, context).toBe(true)
      if (preview !== null && steps !== null) {
        expect(steps.x + steps.width, `${context} — the steps are left of the preview`).toBeLessThanOrEqual(preview.x + 1)
        expect(Math.abs(steps.y - preview.y), `${context} — side by side`).toBeLessThanOrEqual(1)
      }
      expect(layout.dotInFrame, context).toBe(true)
      await capturePage(page, '428-live-page-1280')
    })
  }, 120_000)

  it('FLIP-RECOVERS: crossing from 1280 to 400 px returns to a green dot and one embed within 8 s', async () => {
    await onLivePage(ROWS_RUN, async (page) => {
      const watch = watchEmbed(page)
      await waitForRowsInAllStates(page)
      await waitForGreen(page)
      expect(previewAboveSteps(await readLayout(page)), 'the control: the page starts docked').toBe(false)

      const down = await flipAndWatch(page, NARROW, watch)
      console.log(`FLIP-RECOVERS 1280->400: ${JSON.stringify(down)}`)
      expectRecovered(down, true)

      // The way back moves the preview panel's node (React keeps the steps panel in place and moves
      // the others), which is where a real browser reloads the iframe (428-16's note).
      const up = await flipAndWatch(page, DESKTOP, watch)
      console.log(`FLIP-RECOVERS 400->1280: ${JSON.stringify(up)}`)
      expectRecovered(up, false)
    })
  }, 120_000)
})

interface EmbedWatch { loads(): number; mints(): number }

function watchEmbed(page: Page): EmbedWatch {
  let loads = 0
  let mints = 0
  page.on('request', (request) => {
    if (request.url().includes('/live-url')) mints += 1
  })
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame() && frame.url().includes('/live/')) loads += 1
  })
  return { loads: () => loads, mints: () => mints }
}

interface FlipReading {
  to: number
  /** When the page last stopped being unhealthy: green, one embed, painting, in the new arrangement. */
  recoveredAfterMs: number
  dots: string[]
  embedReloads: number
  reMints: number
  paintedAtEnd: number
  end: PageLayout
}

/** Flip the viewport and watch the whole budget, so a late reload cannot hide behind an early green. */
async function flipAndWatch(page: Page, viewport: { width: number; height: number }, watch: EmbedWatch): Promise<FlipReading> {
  const loadsBefore = watch.loads()
  const mintsBefore = watch.mints()
  const wantStacked = viewport.width < 768
  const flippedAt = Date.now()
  await page.setViewportSize(viewport)
  const dots: string[] = []
  let lastUnhealthyAt = flippedAt
  let end = await readLayout(page)
  let painted = -1
  while (Date.now() - flippedAt < FLIP_TO_GREEN_BUDGET_MS) {
    end = await readLayout(page)
    painted = await embedFramesPainted(page)
    const dot = end.dot ?? 'none'
    if (dots[dots.length - 1] !== dot) dots.push(dot)
    const healthy = previewAboveSteps(end) === wantStacked && end.dot === 'green' && end.embeds === 1 && painted >= 1
    if (!healthy) lastUnhealthyAt = Date.now()
    await page.waitForTimeout(100)
  }
  return {
    to: viewport.width,
    recoveredAfterMs: lastUnhealthyAt - flippedAt,
    dots,
    embedReloads: watch.loads() - loadsBefore,
    reMints: watch.mints() - mintsBefore,
    paintedAtEnd: painted,
    end,
  }
}

function expectRecovered(reading: FlipReading, stacked: boolean): void {
  const context = JSON.stringify(reading)
  expect(previewAboveSteps(reading.end), `${context} — the arrangement followed the width`).toBe(stacked)
  expect(reading.end.panes, context).toBe(2)
  expect(reading.end.embeds, context).toBe(1)
  expect(reading.end.dot, context).toBe('green')
  expect(reading.end.dotInFrame, context).toBe(true)
  expect(reading.paintedAtEnd, `${context} — the embed is painting`).toBeGreaterThanOrEqual(1)
  expect(reading.recoveredAfterMs, `${context} — healthy again within the budget, and stayed so`)
    .toBeLessThan(FLIP_TO_GREEN_BUDGET_MS - 500)
}
