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

const SINGLE_TITLE = 'Checkout keeps the basket'
const SUITE_MEMBERS = ['the sign-in member', 'the basket member'] as const
const SECRET_STEP_TEXT = 'type <SECRET_1> into Password'

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

function plantRun(runId: string, members: readonly { name: string; totalSteps: number }[]): PlantedLiveRun {
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
    publishTo(run, 'testStarted', { testId: `t${String(testIndex)}`, testIndex, name: member.name, totalSteps: member.totalSteps })
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
  // step 3 planned and pending.
  const rows = plantRun(ROWS_RUN, [{ name: 'the rows member', totalSteps: 3 }])
  harness.insertRunRow({ runId: ROWS_RUN, name: 'Search finds the blue kettle', status: 'running' })
  publishTo(rows, 'stepStarted', { testIndex: 0, stepIndex: 0, stepText: 'open the search page' })
  publishTo(rows, 'subActionRecorded', { testIndex: 0, stepIndex: 0, subActionIndex: 0 })
  publishTo(rows, 'subActionRecorded', { testIndex: 0, stepIndex: 0, subActionIndex: 1 })
  publishTo(rows, 'stepFinalized', { testIndex: 0, stepIndex: 0, status: 'passed', durationMs: 65_000 })
  publishTo(rows, 'stepStarted', { testIndex: 0, stepIndex: 1, stepText: 'search for the blue kettle' })
  publishTo(rows, 'subActionRecorded', { testIndex: 0, stepIndex: 1, subActionIndex: 0 })

  const single = plantRun(TITLE_RUN, [{ name: SINGLE_TITLE, totalSteps: 2 }])
  harness.insertRunRow({ runId: TITLE_RUN, name: SINGLE_TITLE, status: 'running' })
  publishTo(single, 'stepStarted', { testIndex: 0, stepIndex: 0, stepText: 'open the basket' })

  const suite = plantRun(SUITE_RUN, SUITE_MEMBERS.map((name) => ({ name, totalSteps: 1 })))
  harness.insertRunRow({ runId: SUITE_RUN, name: 'The shop suite', status: 'running' })
  publishTo(suite, 'stepStarted', { testIndex: 0, stepIndex: 0, stepText: 'sign in' })

  const secret = plantRun(SECRET_RUN, [{ name: 'the secret member', totalSteps: 1 }])
  publishTo(secret, 'stepStarted', { testIndex: 0, stepIndex: 0, stepText: SECRET_STEP_TEXT })
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

describe('the live step rows on the shipped bundle (428-24 Task 1)', () => {
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
      expect(reading.rows[2]?.text, context).toBe('step 3')
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
