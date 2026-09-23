/// <reference lib="dom" />
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import { MARKS, MarkReceiptSchema, RunsMarkOutcomeSchema, RunsMarkPreviewResultSchema } from '@vostride/agent-qa-schema'
import type { Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { recordingFixture, type RecordingFixture } from './recording-dom-fixture.js'
import { populatedRunSpawnEnv, POPULATED_SECRET_ENV_VAR } from './populated-run-fixture.js'
import { cleanupTempRoots, reserveEphemeralPort, spawnDashboard } from './spawned-chat.js'

// Real producer + shipped bundle: the run is recorded by the shipped runner and every door, draft
// and copy below is the built dashboard's own. Nothing is mocked or skipped. Captures go only where
// AGENT_QA_426_CAPTURE_DIR points, never into 424's or 425's directories.
const DESKTOP = { width: 1280, height: 800 }
const MODAL = '[role="dialog"],[aria-modal]'
const NOTE = 'The notice closed before the evidence settled'
// Literal equal to dashboard-ui's approval title (it publishes no library entry).
const APPROVAL_TITLE = 'Approval needed to record this mark'

type Settled = { detailStatus: number; marks: unknown; stepCount: number; previewStatus: number; previewKind?: string; previewParsed: boolean }
type Triggers = { loaded: number; kinds: string[]; afterEscape: number; selectedAfterEscape: number }
type Pills = { label: string; markKinds: number; leaked: string[] }
type Inspecting = {
  opened: string | null
  selectedAfter: string | null
  pinnedVisible: boolean
  pinnedAfterCopy: boolean
  targetAfterSelect: string | null
  tab: 'network'
  copied: string[]
  composerOpen: boolean
  note: string
  modalCounts: Record<string, number>
}
type Frame = { event: string; data: string }
type MarkPath = {
  gate: { safety: unknown; trustModeRemoved: boolean }
  frames: Frame[]
  dialogs: number
  hostDialogs: number
  approvalInComposer: number
  rowsAtApproval: number
  status?: number
  outcome?: { kind: string; markId?: string }
  rows: Array<{ markId: string; kind: string; origin: string; testIndex: number; stepIndex?: number; disposition: string; gold: string[] }>
  newEntryMarkId: string | null
  newEntryFirst: boolean
  dialogsAfter: number
}

const failures: Record<string, string> = {}
let fixture: RecordingFixture | undefined
let reader: Awaited<ReturnType<typeof spawnDashboard>> | undefined
let settled: Settled | undefined
let triggers: Triggers | undefined
const pills: Pills[] = []
let inspecting: Inspecting | undefined
let markPath: MarkPath | undefined

async function captureTo(page: Page, name: string) {
  const directory = process.env.AGENT_QA_426_CAPTURE_DIR
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true, animations: 'disabled' })
}

async function frames(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function scanPills(page: Page, label: string) {
  const observed = await page.evaluate(marks => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const leaked: string[] = []
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node.parentElement?.closest('[data-feedback-technical]')) continue
      const text = node.textContent ?? ''
      if (marks.some(kind => text.includes(kind))) leaked.push(text)
    }
    return { markKinds: document.querySelectorAll('[data-mark-kind]').length, leaked }
  }, [...MARKS])
  pills.push({ label, ...observed })
}

async function modalCount(page: Page) {
  return await page.evaluate(selector => document.querySelectorAll(selector).length, MODAL)
}

/** Open the Network tab and copy the first response body its rows offer. */
async function copyFromNetwork(page: Page) {
  await page.getByRole('tab', { name: /^Network/ }).click()
  const panel = page.locator('[role="tabpanel"][data-state="active"]')
  const rows = panel.locator('tbody > tr.cursor-pointer')
  await rows.first().waitFor({ timeout: 10_000 })
  for (let index = 0; index < await rows.count(); index++) {
    await rows.nth(index).click()
    const copy = panel.locator('h4', { hasText: 'Response Body' }).locator('xpath=following-sibling::button')
    if (await copy.count() > 0) {
      await copy.first().click()
      return true
    }
    await rows.nth(index).click()
  }
  return false
}

describe('contextual feedback on the shipped bundle (426-16)', () => {
  beforeAll(async () => {
    try {
      // The layout recipe records six steps for member 0, so a second step exists to select while
      // composing, and the first step's page load leaves a response body to copy.
      fixture = await recordingFixture('feedback-layout', false, true)
      await fixture.dashboard.stop()
      // The ask tier for fn:runs.mark is the default gate. failure-view-dom's fixture carries no
      // safety block and asks; run-mark-browser's scene deletes safety.trustMode. Mirror both: the
      // config must reach the cold reader with no trustMode, and what it held is recorded.
      const config = JSON.parse(readFileSync(fixture.project.configPath, 'utf8')) as { safety?: { trustMode?: unknown } }
      const gate = { safety: config.safety ?? null, trustModeRemoved: config.safety?.trustMode !== undefined }
      if (gate.trustModeRemoved) {
        delete config.safety!.trustMode
        writeFileSync(fixture.project.configPath, JSON.stringify(config))
      }
      const env = populatedRunSpawnEnv()
      // A cold reader without the planted credential environment: the fixture's synthetic values
      // stay masked, so the captures carry nothing this repository did not invent.
      delete env[POPULATED_SECRET_ENV_VAR]
      const port = await reserveEphemeralPort()
      reader = await spawnDashboard(fixture.project.root, fixture.project.configPath, port, 60_000, env)
      if (!reader.ready) throw new Error(reader.stderr())
      const runId = fixture.drive.runId
      const url = `${reader.origin}/runs/${encodeURIComponent(runId)}`

      const context = await fixture.browser.newContext({ viewport: DESKTOP })
      // Observe what the shipped button writes without depending on desktop clipboard permissions.
      await context.addInitScript(() => {
        const copied: string[] = []
        ;(window as unknown as { copied: string[] }).copied = copied
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: async (text: string) => { copied.push(text) } },
        })
      })
      const page = await context.newPage()
      await page.goto(url)
      await page.locator('[data-feedback-entry="step"]').waitFor({ timeout: 15_000 })
      await frames(page)

      // Open Question 4, observed rather than assumed: the host binds feedback, so member 0
      // carries a marks array, and the consequences read answers for it on this run.
      settled = await page.evaluate(async runId => {
        const detail = await fetch(`/api/runs/${encodeURIComponent(runId)}/detail`)
        const body = await detail.json() as { members?: Array<{ testIndex: number; testId?: string; marks?: unknown }>; steps?: Array<{ testIndex?: number }> }
        const member = body.members?.find(entry => entry.testIndex === 0)
        // The layout recipe is a two-member suite, so an unaddressed read is the ambiguous arm.
        const preview = await fetch(`/api/runs/${encodeURIComponent(runId)}/mark-preview`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId, kind: 'false-fail', ...(member?.testId === undefined ? {} : { testId: member.testId }) }),
        })
        return { detailStatus: detail.status, marks: member?.marks,
          stepCount: (body.steps ?? []).filter(step => step.testIndex === 0).length,
          previewStatus: preview.status, previewBody: await preview.json() as unknown }
      }, runId).then(({ previewBody, ...rest }) => {
        const parsed = RunsMarkPreviewResultSchema.safeParse(previewBody)
        return { ...rest, previewParsed: parsed.success, previewKind: parsed.success ? parsed.data.kind : undefined }
      })

      const doors = page.locator('[data-feedback-entry]')
      const loaded = await doors.count()
      const kinds = await doors.evaluateAll(elements => elements.map(element => element.getAttribute('data-feedback-entry') ?? ''))
      await scanPills(page, 'loaded')
      await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur() })
      await page.keyboard.press('Escape')
      await page.locator('[role="treeitem"][aria-selected="true"]').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined)
      await frames(page)
      triggers = { loaded, kinds, afterEscape: await doors.count(),
        selectedAfterEscape: await page.locator('[role="treeitem"][aria-selected="true"]').count() }

      // SC4: compose on one step, then select a different step, open an evidence tab and copy a
      // value. Only the first step's network record carries a response body (the page load); the
      // later steps' failing fetch is recorded without one, so its panel offers nothing to copy.
      // The draft therefore sits on step 2 and the inspection happens on step 1.
      const modalCounts: Record<string, number> = {}
      const composed = page.locator('[data-step-id="0:1"]')
      const inspected = page.locator('[data-step-id="0:0"]')
      await composed.locator(':scope > button').click()
      await composed.locator('[data-feedback-entry="step"]').click()
      const composer = page.locator('[data-feedback-composer]')
      await composer.waitFor()
      const opened = await composer.getAttribute('data-feedback-target')
      modalCounts.composerOpen = await modalCount(page)
      await composer.locator('[data-feedback-choice] [role="radio"]').first().click()
      await composer.locator('[data-feedback-note]').fill(NOTE)
      await composer.locator('[data-feedback-preview][data-preview-current="true"]').waitFor({ timeout: 15_000 })
      modalCounts.drafted = await modalCount(page)
      await scanPills(page, 'composer-open-preview-current')

      await inspected.locator(':scope > button').click()
      const pinned = composer.locator('[data-feedback-pinned]')
      await pinned.waitFor({ timeout: 5_000 })
      const pinnedVisible = await pinned.isVisible()
      const targetAfterSelect = await composer.getAttribute('data-feedback-target')
      const selectedAfter = await page.locator('[role="treeitem"][aria-selected="true"]').getAttribute('data-step-id')
      modalCounts.otherStepSelected = await modalCount(page)

      if (!await copyFromNetwork(page)) {
        // The plan's named fallback does not exist on the shipped page: the Variables tab renders
        // no copy control and the masked chip is presentational by design (405-11 D-10).
        throw new Error('The inspected step\'s Network panel offered no copy control, and the Variables tab renders none')
      }
      await page.waitForFunction(() => (window as unknown as { copied: string[] }).copied.length > 0, undefined, { timeout: 5_000 })
      modalCounts.copied = await modalCount(page)
      const copied = await page.evaluate(() => (window as unknown as { copied: string[] }).copied)
      const composerOpen = await composer.isVisible()
      const note = await composer.locator('[data-feedback-note]').inputValue()
      const pinnedAfterCopy = await pinned.isVisible()
      await frames(page)
      await captureTo(page, 'compose-while-inspecting')
      modalCounts.captured = await modalCount(page)
      inspecting = { opened, selectedAfter, pinnedVisible, pinnedAfterCopy, targetAfterSelect, tab: 'network',
        copied, composerOpen, note, modalCounts }
      await context.close()

      // SC4 through approval (D-20): a real mark from the header entry, approved inline.
      const ledger = join(fixture.project.agentQaRoot, RUNS_SUBDIR, slugBranch(runId), 'marks.jsonl')
      const rows = () => existsSync(ledger)
        ? readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map(line => MarkReceiptSchema.parse(JSON.parse(line)))
        : []
      const markContext = await fixture.browser.newContext({ viewport: DESKTOP })
      await markContext.addInitScript(() => {
        const frames: Array<{ event: string; data: string }> = []
        ;(window as unknown as { markFrames: typeof frames }).markFrames = frames
        const Native = window.EventSource
        class RecordedChannel extends Native {
          constructor(url: string | URL, init?: EventSourceInit) {
            super(url, init)
            if (String(url).includes('/api/run-confirm/channel')) {
              for (const event of ['confirm_scope', 'confirm_request', 'confirm_resolved']) {
                this.addEventListener(event, frame => frames.push({ event, data: (frame as MessageEvent<string>).data }))
              }
            }
          }
        }
        window.EventSource = RecordedChannel
      })
      const markPage = await markContext.newPage()
      const recordedFrames = async () => await markPage.evaluate(() =>
        (window as unknown as { markFrames: Array<{ event: string; data: string }> }).markFrames)
      await markPage.goto(url)
      await markPage.waitForFunction(() => (window as unknown as { markFrames: Array<{ event: string }> }).markFrames
        .some(frame => frame.event === 'confirm_scope'), undefined, { timeout: 10_000 })
      await markPage.locator('[data-feedback-entry="test"]').click()
      const markComposer = markPage.locator('[data-feedback-composer]')
      await markComposer.locator('[data-feedback-choice] [role="radio"]').first().click()
      await markComposer.locator('[data-feedback-preview][data-preview-current="true"]').waitFor({ timeout: 15_000 })
      const response = markPage.waitForResponse(reply => reply.url().endsWith('/mark') && reply.request().method() === 'POST')
      await markComposer.locator('[data-feedback-submit]').click()
      const approval = markPage.getByRole('group', { name: APPROVAL_TITLE })
      await approval.waitFor({ timeout: 10_000 })
      const dialogs = await modalCount(markPage)
      const hostDialogs = await markPage.evaluate(() => document.querySelectorAll('[data-run-confirm-dialog]').length)
      const approvalInComposer = await markComposer.locator('[data-feedback-approval]').count()
      const rowsAtApproval = rows().length
      await markPage.locator('[data-feedback-approval] [data-confirm-answer="accept"]').click()
      const reply = await response
      const parsed = RunsMarkOutcomeSchema.parse(await reply.json())
      const entries = markComposer.locator('[data-feedback-history="target"] [data-history-entry]')
      await markComposer.locator('[data-feedback-history="target"] [data-history-entry][data-history-new]').waitFor({ timeout: 15_000 })
      const newEntryMarkId = await markComposer.locator('[data-feedback-history="target"] [data-history-entry][data-history-new]').getAttribute('data-mark-id')
      const newEntryFirst = await entries.first().getAttribute('data-history-new') === 'true'
      markPath = { gate, frames: await recordedFrames(), dialogs, hostDialogs, approvalInComposer, rowsAtApproval,
        status: reply.status(),
        outcome: { kind: parsed.kind, ...('receipt' in parsed ? { markId: parsed.receipt.markId } : {}) },
        rows: rows().map(({ markId, kind, origin, testIndex, stepIndex, disposition, gold }) =>
          ({ markId, kind, origin, testIndex, stepIndex, disposition: disposition.kind, gold: gold.map(entry => entry.channel) })),
        newEntryMarkId, newEntryFirst, dialogsAfter: await modalCount(markPage) }
      await markContext.close()

      if (process.env.AGENT_QA_426_CAPTURE_DIR) {
        writeFileSync(join(process.env.AGENT_QA_426_CAPTURE_DIR, 'feedback-observation.json'),
          JSON.stringify({ runId, settled, triggers, pills, inspecting, markPath }, null, 2))
      }
    } catch (error) { failures.drive = String(error) }
    process.stderr.write(`426-16 feedback drive: ${JSON.stringify({ failures, settled, triggers, pills, inspecting, markPath })}\n`)
  }, 360_000)

  afterAll(async () => { await reader?.stop(); await fixture?.close(); cleanupTempRoots() })

  it('FEEDBACK-FIXTURE-SETTLED', () => {
    expect(failures.drive, 'the drive threw before every observation was recorded').toBeUndefined()
    expect(settled?.detailStatus, JSON.stringify(settled)).toBe(200)
    expect(Array.isArray(settled!.marks), `member 0 carries no marks array: ${JSON.stringify(settled)}`).toBe(true)
    expect(settled!.stepCount, 'member 0 needs a second step to select while composing').toBeGreaterThanOrEqual(2)
    expect(settled!.previewStatus).toBe(200)
    expect(settled!.previewParsed, `mark-preview body failed RunsMarkPreviewResultSchema: ${JSON.stringify(settled)}`).toBe(true)
    expect(['consequences', 'quarantined'], JSON.stringify(settled)).toContain(settled!.previewKind)
  })

  it('TRIGGER-COUNT-ON-BINARY', () => {
    expect(triggers, JSON.stringify(failures)).toBeDefined()
    expect(triggers!.loaded, JSON.stringify(triggers)).toBe(2)
    expect([...triggers!.kinds].sort()).toEqual(['step', 'test'])
    expect(triggers!.selectedAfterEscape, JSON.stringify(triggers)).toBe(0)
    expect(triggers!.afterEscape, JSON.stringify(triggers)).toBe(1)
  })

  it('NO-PILL-ON-BINARY', () => {
    expect(pills.map(scan => scan.label), JSON.stringify(failures)).toEqual(['loaded', 'composer-open-preview-current'])
    for (const scan of pills) {
      expect(scan.markKinds, scan.label).toBe(0)
      expect(scan.leaked, scan.label).toEqual([])
    }
  })

  it('SC4-COMPOSE-WHILE-INSPECTING', () => {
    expect(inspecting, JSON.stringify(failures)).toBeDefined()
    const where = JSON.stringify(inspecting)
    expect(inspecting!.opened, where).toBe('0:1')
    expect(inspecting!.selectedAfter, where).toBe('0:0')
    expect(inspecting!.pinnedVisible, where).toBe(true)
    expect(inspecting!.pinnedAfterCopy, where).toBe(true)
    expect(inspecting!.targetAfterSelect, where).toBe(inspecting!.opened)
    expect(inspecting!.copied.length, where).toBeGreaterThan(0)
    expect(inspecting!.copied.every(text => text.length > 0), where).toBe(true)
    expect(inspecting!.composerOpen, where).toBe(true)
    expect(inspecting!.note, where).toBe(NOTE)
    expect(Object.keys(inspecting!.modalCounts), where).toEqual(['composerOpen', 'drafted', 'otherStepSelected', 'copied', 'captured'])
    for (const [moment, count] of Object.entries(inspecting!.modalCounts)) expect(count, `${moment}: ${where}`).toBe(0)
  })

  it('NO-DIALOG-ON-MARK-PATH', () => {
    expect(markPath, JSON.stringify(failures)).toBeDefined()
    const where = JSON.stringify(markPath)
    expect(markPath!.gate.safety, `the fixture config must not pre-approve the mark: ${where}`).toBeNull()
    expect(markPath!.frames.some(frame => frame.event === 'confirm_request' && frame.data.includes('fn:runs.mark')), where).toBe(true)
    // T-426-16-01: the approval was asked before any ledger row existed.
    expect(markPath!.rowsAtApproval, where).toBe(0)
    expect(markPath!.dialogs, where).toBe(0)
    // RESEARCH A1: the page's own mark confirm renders in the composer, never in the app-wide host.
    expect(markPath!.hostDialogs, where).toBe(0)
    expect(markPath!.approvalInComposer, where).toBe(1)
    expect(markPath!.status, where).toBe(200)
    expect(markPath!.outcome?.kind, where).toBe('marked')
    expect(markPath!.rows, where).toHaveLength(1)
    expect(markPath!.rows[0]!.markId, where).toBe(markPath!.outcome!.markId)
    expect(markPath!.rows[0]!.origin, where).toBe('user')
    expect(markPath!.newEntryMarkId, where).toBe(markPath!.outcome!.markId)
    expect(markPath!.newEntryFirst, where).toBe(true)
    expect(markPath!.dialogsAfter, where).toBe(0)
  })
})
