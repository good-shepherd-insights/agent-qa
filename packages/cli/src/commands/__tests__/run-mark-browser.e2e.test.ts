/// <reference lib="dom" />
// Real Chromium, shipped UI and the composed mark/confirmation/detail routes. No provider calls.
// An absent browser or stale build fails, never skips. Each cell owns an independent ledger.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { DashboardDatabase, createConfirmRegistry, createDashboardRunDetailReader, startServer } from '@vostride/agent-qa-dashboard'
import { resolveWorkspacePaths } from '@vostride/agent-qa-core'
import { composeDashboardDoor } from '../dashboard.js'
import { markFixture } from '../../gates/__tests__/feedback-fixture.js'
import { DASHBOARD_ANCHORED_BUILDS, PACKAGES_ROOT, REBUILD_INSTRUCTION, buildFreshness } from '../../__tests__/conformance/spawned-chat.js'

const UI_DIR = join(PACKAGES_ROOT, 'dashboard-ui', 'dist')
const closers: Array<() => Promise<void>> = []
let browser: Browser
beforeAll(async () => {
  expect(buildFreshness(DASHBOARD_ANCHORED_BUILDS), REBUILD_INSTRUCTION).toEqual({ missing: [], stale: [] })
  expect(existsSync(chromium.executablePath()), 'chromium present: false').toBe(true)
  browser = await chromium.launch({ headless: true })
}, 30_000)
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close() })
afterAll(async () => { await browser?.close() })

interface Wire { event: string; url: string; data: string }
async function recordWire(page: Page, noChannel: boolean) {
  await page.addInitScript((blocked) => {
    const frames: Wire[] = []
    ;(window as unknown as { markWire: Wire[] }).markWire = frames
    const Native = window.EventSource
    class Recorded extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        if (blocked && String(url).includes('/api/run-confirm/channel')) throw new Error('confirm channel unavailable')
        super(url, init)
        for (const event of ['confirm_scope', 'confirm_request', 'confirm_resolved']) {
          this.addEventListener(event, frame => frames.push({ event, url: String(url), data: (frame as MessageEvent<string>).data }))
        }
      }
    }
    window.EventSource = Recorded
  }, noChannel)
}

async function scene(noChannel = false) {
  const fixture = markFixture()
  const config = parse(readFileSync(fixture.configPath, 'utf8'))
  delete config.safety.trustMode
  writeFileSync(fixture.configPath, stringify(config))
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  const { handoff } = fixture
  const member = handoff.tests[0]!
  db.insertRun({ id: handoff.runId, name: member.testName, filePath: member.filePath, status: 'failed',
    duration: 1000, startedAt: '2026-09-08T00:00:00.000Z', endedAt: '2026-09-08T00:00:01.000Z' })
  db.upsertRunMember({ runId: handoff.runId, testIndex: 0, testId: member.testId, name: member.testName,
    filePath: member.filePath, outcome: 'failed', totalSteps: member.steps.length })
  member.steps.forEach((step, stepIndex) => db.insertRunStep({ runId: handoff.runId, testIndex: 0, stepIndex,
    stepText: step.stepText, cacheStatus: 'miss', verifierVerdict: step.verifierVerdict,
    selfHealOccurred: false, briefDigest: 'fixture-brief', status: 'failed' }))
  const confirms = createConfirmRegistry({ timeoutMs: 20_000 })
  const door = composeDashboardDoor({ agentQaRoot: fixture.agentQaRoot, configPath: fixture.configPath,
    boundOrigin: () => undefined, confirms, runDetail: createDashboardRunDetailReader(db) })
  const server = await startServer({ db, port: 0, uiDir: UI_DIR, configPath: fixture.configPath,
    workspacePaths: resolveWorkspacePaths({ config, configPath: fixture.configPath }), agentHost: door.agentHost })
  closers.push(async () => { server.close(); await door.host.close(); rmSync(fixture.root, { recursive: true, force: true }) })
  const address = server.server.address()
  if (!address || typeof address === 'string') throw new Error('dashboard did not bind a port')
  const context: BrowserContext = await browser.newContext()
  closers.push(() => context.close())
  const page = await context.newPage()
  await recordWire(page, noChannel)
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}/runs/${handoff.runId}`)
  await page.locator('[data-verdict-block] [data-mark-kind="confirmed-bug"]').waitFor()
  const ledger = join(fixture.runDir, 'marks.jsonl')
  const rows = () => existsSync(ledger) ? readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
  return { page, pageErrors, rows, confirms }
}

async function submit(page: Page) {
  await page.locator('[data-verdict-block] [data-mark-kind="confirmed-bug"]').click()
  await page.locator('[data-verdict-block] [data-mark-submit]').click()
}

describe('419 real browser mark confirmation', () => {
  it('asks on /api/run-confirm/channel; accept appends one receipt and refetches its chip', async () => {
    const s = await scene()
    await s.page.waitForFunction(() => (window as unknown as { markWire: Wire[] }).markWire.some(frame => frame.event === 'confirm_scope' && frame.url === '/api/run-confirm/channel'))
    expect(s.rows()).toHaveLength(0)
    await submit(s.page)
    await s.page.locator('[data-run-confirm-dialog]').waitFor()
    expect(await s.page.locator('[data-run-confirm-dialog]').textContent()).toContain('runs.mark')
    expect(s.rows()).toHaveLength(0)
    expect(await s.page.evaluate(() => (window as unknown as { markWire: Wire[] }).markWire.some(frame => frame.event === 'confirm_request' && frame.data.includes('fn:runs.mark')))).toBe(true)
    await s.page.locator('[data-confirm-answer="accept"]').click()
    await s.page.locator('[data-verdict-block] [data-mark-chip]').waitFor()
    expect(await s.page.locator('[data-verdict-block] [data-mark-chip]').textContent()).toBe('marked confirmed-bug by user · 1')
    expect(s.rows()).toHaveLength(1)
    expect(s.rows()[0]).toMatchObject({ kind: 'confirmed-bug', origin: 'user', ordinal: 1 })
    expect(s.pageErrors).toEqual([])
  }, 45_000)

  it('without a confirm channel renders answer-confirm and appends no ledger line', async () => {
    const s = await scene(true)
    const response = s.page.waitForResponse(response => response.url().endsWith('/mark') && response.request().method() === 'POST')
    await submit(s.page)
    expect((await response).status()).toBe(403)
    await s.page.locator('[data-mark-denied]').waitFor()
    expect(await s.page.locator('[data-mark-denied]').textContent()).toContain('an ask-tier op raises a confirm here that you can answer')
    expect(await s.page.locator('[data-mark-chip]').count()).toBe(0)
    expect(s.rows()).toHaveLength(0)
    expect(s.confirms.pendingCount()).toBe(0)
    expect(s.pageErrors).toEqual([])
  }, 45_000)

  it('deny renders the typed denial and appends no ledger line', async () => {
    const s = await scene()
    await s.page.waitForFunction(() => (window as unknown as { markWire: Wire[] }).markWire.some(frame => frame.event === 'confirm_scope'))
    await submit(s.page)
    await s.page.locator('[data-run-confirm-dialog]').waitFor()
    await s.page.locator('[data-confirm-answer="deny"]').click()
    await s.page.locator('[data-mark-denied]').waitFor()
    expect(await s.page.locator('[data-mark-denied]').textContent()).toContain('The safety gate denied this mark.')
    expect(await s.page.locator('[data-mark-chip]').count()).toBe(0)
    expect(s.rows()).toHaveLength(0)
    expect(s.confirms.pendingCount()).toBe(0)
    expect(s.pageErrors).toEqual([])
  }, 45_000)
})
