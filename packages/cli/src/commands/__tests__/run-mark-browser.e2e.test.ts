/// <reference lib="dom" />
// Real Chromium, shipped UI and the composed mark/confirmation/detail routes. No provider calls.
// An absent browser or stale build fails, never skips. Each cell owns an independent ledger.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page, type Locator } from 'playwright-core'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { parse, stringify } from 'yaml'
import { DashboardDatabase, createConfirmRegistry, createDashboardRunDetailReader, startServer } from '@vostride/agent-qa-dashboard'
import { resolveWorkspacePaths } from '@vostride/agent-qa-core'
import { composeDashboardDoor } from '../dashboard.js'
import { markFixture } from '../../gates/__tests__/feedback-fixture.js'
import { DASHBOARD_ANCHORED_BUILDS, PACKAGES_ROOT, REBUILD_INSTRUCTION, buildFreshness } from '../../__tests__/conformance/spawned-chat.js'

const UI_DIR = join(PACKAGES_ROOT, 'dashboard-ui', 'dist')
// Only the home-path seam is isolated; confirmation, authority and ledger writes stay real.
const { scratchHome } = await vi.hoisted(async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  return { scratchHome: fs.mkdtempSync(`${os.tmpdir()}/419-mark-ui-auth-`) }
})
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), homedir: () => scratchHome }))
const RECHECK_DIR = process.env.AGENT_QA_MARK_UI_RECHECK_DIR
const MEMBER = '[data-member-mark]'
const STEP = '[data-step-id="0:0"] [data-step-mark]'
const ACTION = '{"type":"click","ref":"e-continue"}'
async function retainCapture(page: Page, name: string) {
  if (!RECHECK_DIR) return
  mkdirSync(RECHECK_DIR, { recursive: true })
  await page.mouse.move(1400, 100)
  await page.screenshot({ path: join(RECHECK_DIR, name), fullPage: true, animations: 'disabled' })
}
const closers: Array<() => Promise<void>> = []
let browser: Browser
beforeAll(async () => {
  expect(buildFreshness(DASHBOARD_ANCHORED_BUILDS), REBUILD_INSTRUCTION).toEqual({ missing: [], stale: [] })
  expect(existsSync(chromium.executablePath()), 'chromium present: false').toBe(true)
  browser = await chromium.launch({ headless: true })
}, 30_000)
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close() })
afterAll(async () => { await browser?.close(); rmSync(scratchHome, { recursive: true, force: true }) })

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
  const signals = ['SIGINT', 'SIGTERM'] as const
  const beforeListeners = signals.map(signal => new Set(process.listeners(signal)))
  const server = await startServer({ db, port: 0, uiDir: UI_DIR, configPath: fixture.configPath,
    workspacePaths: resolveWorkspacePaths({ config, configPath: fixture.configPath }), agentHost: door.agentHost })
  const ownedListeners = signals.map((signal, index) => process.listeners(signal).filter(listener => !beforeListeners[index].has(listener)))
  closers.push(async () => {
    server.close()
    await door.host.close()
    signals.forEach((signal, index) => ownedListeners[index].forEach(listener => process.removeListener(signal, listener)))
    rmSync(fixture.root, { recursive: true, force: true })
  })
  const address = server.server.address()
  if (!address || typeof address === 'string') throw new Error('dashboard did not bind a port')
  const context: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  closers.push(() => context.close())
  const outsideLoopback: string[] = []
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue()
    outsideLoopback.push(url.origin)
    return route.abort('blockedbyclient')
  })
  const page = await context.newPage()
  await recordWire(page, noChannel)
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}/runs/${handoff.runId}`)
  await page.locator('[data-verdict-block] [data-mark-kind="confirmed-bug"]').waitFor()
  const ledger = join(fixture.runDir, 'marks.jsonl')
  const rows = () => existsSync(ledger) ? readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
  return { page, pageErrors, rows, confirms, outsideLoopback, runId: handoff.runId }
}

async function waitChannel(page: Page) {
  await page.waitForFunction(() => (window as unknown as { markWire: Wire[] }).markWire.some(frame => frame.event === 'confirm_scope'))
}
async function fillDraft(page: Page, scope: string, kind = 'confirmed-bug') {
  const form = page.locator(scope)
  await form.locator(`[data-mark-kind="${kind}"]`).click()
  await form.locator('[data-mark-note]').fill('Retain this review note')
  await form.locator('[data-mark-correction] summary').click()
  await form.getByRole('textbox', { name: 'Corrected expectation', exact: true }).fill('Expected the intended target')
  await form.getByRole('textbox', { name: 'Corrected action JSON', exact: true }).fill(ACTION)
  return form
}
async function expectDraft(form: Locator) {
  expect(await form.locator('[data-mark-note]').inputValue()).toBe('Retain this review note')
  expect(await form.getByRole('textbox', { name: 'Corrected expectation', exact: true }).inputValue()).toBe('Expected the intended target')
  expect(await form.getByRole('textbox', { name: 'Corrected action JSON', exact: true }).inputValue()).toBe(ACTION)
  expect(await form.locator('[data-mark-kind="confirmed-bug"]').getAttribute('aria-pressed')).toBe('true')
}
async function settled(form: Locator, text: string) {
  await form.locator('[data-mark-status]').filter({ hasText: text }).waitFor()
}
async function tabTo(page: Page, selector: string) {
  for (let index = 0; index < 100; index++) {
    if (await page.locator(selector).evaluate(element => element === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error(`Keyboard could not reach ${selector}`)
}
function healthy(s: Awaited<ReturnType<typeof scene>>) {
  expect(s.pageErrors).toEqual([])
  expect(s.outsideLoopback).toEqual([])
  expect(new URL(s.page.url()).pathname).toBe(`/runs/${s.runId}`)
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

  for (const scope of [MEMBER, STEP]) {
    it.each(['deny', 'no-channel', 'transport', 'refetch'])('retains ' + scope + ' draft after %s with actual ledger accounting', async failure => {
      const s = await scene(failure === 'no-channel')
      if (failure !== 'no-channel') await waitChannel(s.page)
      const form = await fillDraft(s.page, scope)
      expect(s.rows()).toHaveLength(0)
      let accepted = false
      if (failure === 'transport') await s.page.route('**/mark', route => route.abort('failed'))
      if (failure === 'refetch') {
        s.page.on('response', response => { if (response.url().endsWith('/mark') && response.status() === 200) accepted = true })
        await s.page.route('**/detail', route => accepted ? route.abort('failed') : route.continue())
      }
      await tabTo(s.page, `${scope} [data-mark-submit]`)
      await s.page.keyboard.press('Enter')
      if (failure === 'deny' || failure === 'refetch') {
        await s.page.locator('[data-run-confirm-dialog]').waitFor()
        await expectDraft(form)
        expect(await form.locator('[data-mark-status]').textContent()).toBe('Mark submission pending.')
        await tabTo(s.page, `[data-confirm-answer="${failure === 'deny' ? 'deny' : 'accept'}"]`)
        await s.page.keyboard.press('Enter')
      }
      await settled(form, 'Draft retained.')
      await expectDraft(form)
      expect(await form.locator('[data-mark-denied]').getAttribute('role')).toBe('alert')
      expect(await form.locator('[data-mark-status]').textContent()).not.toContain('Mark saved.')
      expect(s.rows()).toHaveLength(failure === 'refetch' ? 1 : 0)
      if (failure === 'refetch') {
        expect(await form.locator('[data-mark-denied]').textContent()).toContain('Reload this run')
        expect(await form.locator('[data-mark-chip]').count()).toBe(0)
      }
      healthy(s)
      if (failure === 'transport' || failure === 'refetch') {
        await s.page.unroute(failure === 'transport' ? '**/mark' : '**/detail')
        // Explicit retry traverses real confirmation; already-marked remains one ledger row.
        await form.locator('[data-mark-submit]').click()
        await s.page.locator('[data-confirm-answer="accept"]').waitFor()
        await s.page.locator('[data-confirm-answer="accept"]').click()
        await settled(form, 'Mark saved. Receipt refreshed.')
        expect(s.rows()).toHaveLength(1)
        expect(await form.locator('[data-mark-note]').count()).toBe(0)
        healthy(s)
      }
    }, 45_000)
  }

  it('renders readable selected controls in both themes and retains requested captures', async () => {
    const s = await scene()
    const measurements: unknown[] = []
    await waitChannel(s.page)
    for (const theme of ['dark', 'light']) {
      await s.page.evaluate(theme => localStorage.setItem('vite-ui-theme', theme), theme)
      await s.page.reload()
      await waitChannel(s.page)
      for (const scope of [MEMBER, STEP]) {
        await tabTo(s.page, `${scope} [data-mark-kind="confirmed-bug"]`)
        await s.page.keyboard.press('Enter')
        const form = s.page.locator(scope)
        for (const kind of ['false-fail', 'false-pass', 'confirmed-bug']) {
          await form.locator(`[data-mark-kind="${kind}"]`).click()
          expect(await form.locator(`[data-mark-kind="${kind}"]`).getAttribute('aria-pressed')).toBe('true')
          expect(await form.locator('[aria-pressed="true"]').count()).toBe(1)
          expect(await form.locator('[data-mark-submit]').textContent()).toBe(`Record ${kind} mark`)
        }
        await form.locator('[data-mark-correction] summary').click()
        for (const label of ['Corrected expectation (optional)', 'Corrected action JSON (optional)']) {
          expect(await form.locator('label').filter({ hasText: label }).isVisible()).toBe(true)
        }
        expect(await form.locator('code').textContent()).toBe('{"type":"click","ref":"e1"}')
        await s.page.mouse.move(1400, 100)
        await form.evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))) })
        const measures = await form.locator('[data-mark-kind], [data-mark-submit], [data-mark-cancel]').evaluateAll(elements => elements.map(element => {
          const style = getComputedStyle(element), bounds = element.getBoundingClientRect()
          return { text: element.textContent, font: parseFloat(style.fontSize), width: bounds.width, height: bounds.height, pressed: element.getAttribute('aria-pressed'), border: style.borderColor, background: style.backgroundColor }
        }))
        expect(measures).toHaveLength(5)
        for (const measure of measures) {
          expect(measure.font).toBeGreaterThanOrEqual(12)
          expect(measure.width).toBeGreaterThanOrEqual(32)
          expect(measure.height).toBeGreaterThanOrEqual(32)
        }
        expect(measures.find(m => m.pressed === 'true')?.border).not.toBe(measures.find(m => m.pressed === 'false')?.border)
        measurements.push({ theme, scope, measures })
      }
      // Explicit output opt-in must retain this browser scene, without touching prior evidence.
      await retainCapture(s.page, `marks-${theme}.png`)
      if (RECHECK_DIR) expect(existsSync(join(RECHECK_DIR, `marks-${theme}.png`))).toBe(true)
    }
    expect(s.rows()).toHaveLength(0)
    const member = s.page.locator(MEMBER)
    const step = s.page.locator(STEP)
    await member.locator('[data-mark-kind="false-fail"]').click()
    await member.locator('[data-mark-submit]').click()
    await s.page.getByRole('dialog', { name: 'Approval needed to record this mark', exact: true }).waitFor()
    expect(await s.page.locator('[data-run-confirm-dialog]').textContent()).toContain('Approval needed to record this mark')
    await retainCapture(s.page, 'mark-confirmation.png')
    if (RECHECK_DIR) expect(existsSync(join(RECHECK_DIR, 'mark-confirmation.png'))).toBe(true)
    await tabTo(s.page, '[data-confirm-answer="accept"]')
    await s.page.keyboard.press('Enter')
    await settled(member, 'Mark saved. Receipt refreshed.')
    expect(s.rows()).toHaveLength(1)
    expect(await member.locator('[data-mark-note]').count()).toBe(0)
    expect(await step.locator('[data-mark-note]').count()).toBe(1)
    expect(await step.locator('[data-mark-status]').textContent()).toBe('')
    // 423 D-19: the drafted receipt's review control copies a runnable CLI command, never a chat route.
    const link = member.locator('[data-mark-review]')
    expect(await link.getAttribute('href')).toBeNull()
    expect(await link.getAttribute('data-review-command')).toMatch(/^agent-qa proposals (show prop_[a-z0-9-]+|list --status pending)$/)
    const linkSize = await link.boundingBox()
    expect(linkSize!.height).toBeGreaterThanOrEqual(32)
    await step.locator('[data-mark-submit]').click()
    await s.page.locator('[data-confirm-answer="accept"]').waitFor()
    await s.page.locator('[data-confirm-answer="accept"]').click()
    await settled(step, 'Mark saved. Receipt refreshed.')
    expect(s.rows()).toHaveLength(2)
    expect(s.rows().map(row => row.stepIndex)).toEqual([undefined, 0])
    expect(await member.locator('[data-mark-chip]').textContent()).toContain('· 1')
    expect(await step.locator('[data-mark-chip]').textContent()).toContain('· 2')
    healthy(s)
    const detailUrl = s.page.url()
    await link.click()
    await s.page.waitForFunction(() => document.querySelector('[data-member-mark] [data-mark-review]')?.getAttribute('data-copy-status') !== 'idle')
    expect(s.page.url()).toBe(detailUrl)
    expect(s.pageErrors).toEqual([])
    expect(s.outsideLoopback).toEqual([])
    if (RECHECK_DIR) writeFileSync(join(RECHECK_DIR, 'measurements.json'), JSON.stringify({
      captured: new Date().toISOString(), viewport: { width: 1440, height: 1100 },
      chromium: browser.version(), executable: chromium.executablePath(),
      freshness: buildFreshness(DASHBOARD_ANCHORED_BUILDS), measurements,
      pageErrors: s.pageErrors, outsideLoopback: s.outsideLoopback,
      keyboard: 'Tab and Enter reached both scopes and real accept/deny controls',
      finalMarks: s.rows().map(({ kind, ordinal, stepIndex }) => ({ kind, ordinal, stepIndex })),
      ownerPersonallyTested: false, assistiveTechnology: 'unverified',
    }, null, 2))
  }, 60_000)
})
