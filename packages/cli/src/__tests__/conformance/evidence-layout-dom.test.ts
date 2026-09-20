/// <reference lib="dom" />
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { guardRunAnalysisArtifact, slugBranch, type RunDetailProjection } from '@vostride/agent-qa-schema'
import type { Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { capture, recordingFixture, type RecordingFixture } from './recording-dom-fixture.js'
import { populatedRunSpawnEnv, POPULATED_SECRET_ENV_VAR, POPULATED_SECRET_VALUE } from './populated-run-fixture.js'
import { cleanupTempRoots, reserveEphemeralPort, spawnDashboard } from './spawned-chat.js'

// Real producer + shipped bundle. Only historical/orphan test arrangements edit the temporary
// durable fixture, explicitly below; no route mocks, fake media, skips or user-workspace captures.
type Box = { x: number; y: number; right: number; bottom: number; width: number; height: number }
const overlaps = (a: Box, b: Box) => a.x < b.right - 0.5 && b.x < a.right - 0.5 && a.y < b.bottom - 0.5 && b.y < a.bottom - 0.5
const inside = (a: Box, b: Box) => a.x >= b.x - 0.5 && a.right <= b.right + 0.5 && a.y >= b.y - 0.5 && a.bottom <= b.bottom + 0.5
const failures: Record<string, string> = {}
let fixture: RecordingFixture | undefined
let reader: Awaited<ReturnType<typeof spawnDashboard>> | undefined
let timeline: { numbers: number; badges: Box[]; readout: string; member: Box; first: Box; trackViewport: Box; steps: number } | undefined
const tabs: Array<{ width: number; document: number; viewport: number; scroll: number; client: number; moved: number; triggers: Array<{ box: Box; count?: Box; contentFits: boolean }> }> = []
const lightboxes: Array<{ width: number; document: number; viewport: number; image: Box; dialog: Box; loaded: boolean }> = []
let notice: { dismiss: Box; viewport: number; explanation: Box; pane: Box; lines: number } | undefined
let chips: Array<{ chip: Box; row: Box; clip: Box; text: string; visible: boolean }> = []

async function measureChips(page: Page) {
  const fill = page.locator('[data-sub-action] [data-action-family="input"]').first()
  await fill.scrollIntoViewIfNeeded()
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  chips.push(...await page.locator('[data-sub-action] [data-masked]').evaluateAll(elements => {
    const box = (element: Element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
    return elements.map(chip => ({ chip: box(chip), row: box(chip.closest('[data-sub-action]')!),
      clip: box(chip.closest('.truncate')!), text: chip.textContent ?? '', visible: getComputedStyle(chip).visibility !== 'hidden' }))
  }))
}

async function measureTabs(page: Page, name: string) {
  const list = page.locator('[role="tablist"]').first()
  await list.waitFor()
  const result = await list.evaluate(list => {
    const box = (element: Element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
    const client = list.clientWidth
    list.scrollLeft = list.scrollWidth
    return {
      width: innerWidth, document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth,
      scroll: list.scrollWidth, client, moved: list.scrollLeft,
      triggers: [...list.querySelectorAll('[role="tab"]')].map(trigger => {
        const count = trigger.querySelector('[data-tab-count]')
        return { box: box(trigger), ...(count ? { count: box(count) } : {}), contentFits: trigger.scrollWidth <= trigger.clientWidth + 1 }
      }),
    }
  })
  tabs.push(result)
  await capture(page, name)
  await list.evaluate(list => { list.scrollLeft = 0 })
}

describe('evidence layout backstops on the shipped bundle (424-29)', () => {
  beforeAll(async () => {
    try {
      fixture = await recordingFixture('evidence-layout', false, true)
      // Finish the post-run tail before modifying synthetic history. The primary production
      // recording run above stays untouched; only this separate layout fixture is arranged.
      const origin = fixture.dashboard.origin
      let settled = false
      for (const deadline = Date.now() + 30_000; Date.now() < deadline;) {
        const response = await fetch(`${origin}/api/runs/${encodeURIComponent(fixture!.drive.runId)}/post-processing`)
        const body = await response.json() as { status?: { chips?: Record<string, string> } }
        if (['analysis', 'curation'].every(key => ['done', 'failed'].includes(body.status?.chips?.[key] ?? ''))) {
          settled = true
          break
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      if (!settled) throw new Error('Post-run writer did not settle')
      await fixture.dashboard.stop()
      const env = populatedRunSpawnEnv()
      // A cold reader without the original environment cannot restore this synthetic credential.
      // Its genuine fill value must now render as a complete MaskedChip, never plaintext.
      delete env[POPULATED_SECRET_ENV_VAR]
      const port = await reserveEphemeralPort()
      reader = await spawnDashboard(fixture.project.root, fixture.project.configPath, port, 60_000, env)
      if (!reader.ready) throw new Error(reader.stderr())
      const url = `${reader.origin}/runs/${encodeURIComponent(fixture.drive.runId)}`
      const context = await fixture.browser.newContext({ viewport: { width: 400, height: 800 } })
      const page = await context.newPage()
      await page.goto(url)
      await page.locator('[data-timeline]').waitFor()
      const row = page.locator('[data-step-id]').first()
      await row.locator(':scope > button').click()
      await page.getByRole('radio', { name: 'Frames', exact: true }).click()

      timeline = await page.locator('[data-timeline]').evaluate(timeline => {
        const box = (element: Element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
        const member = timeline.querySelector(':scope > span')!
        const first = timeline.querySelector('[data-timeline-segment]')!
        const trackViewport = timeline.querySelector('[data-timeline-track]')!.parentElement!.parentElement!
        const signals = timeline.querySelector('[data-timeline-signals]')!
        return { member: box(member), first: box(first), trackViewport: box(trackViewport),
          numbers: [...signals.querySelectorAll(':scope > div > span')].filter(element => element.getBoundingClientRect().width > 0).length,
          badges: [...signals.querySelectorAll('[data-step-signal]')].map(box),
          steps: signals.children.length, readout: timeline.querySelector('[data-timeline-readout]')?.textContent ?? '',
        }
      })
      await capture(page, 'timeline-400')
      await capture(page, 'badges-400')
      await measureTabs(page, 'tab-strip-400')
      await measureChips(page)
      if ((await page.locator('body').textContent())?.includes(POPULATED_SECRET_VALUE)) throw new Error('Synthetic credential was not masked')
      await capture(page, 'masked-chip-400')
      await page.setViewportSize({ width: 1280, height: 800 })
      await measureChips(page)
      await capture(page, 'masked-chip-desktop')
      await page.setViewportSize({ width: 1920, height: 800 })
      await measureChips(page)
      await capture(page, 'masked-chip-wide-control')
      await page.setViewportSize({ width: 400, height: 800 })

      // deviceScaleFactor is a density test, not browser zoom. Also use a 640 CSS-pixel viewport
      // at 2x density to exercise desktop-1280 reflow at 200%, and report both distinctly.
      const dense = await fixture.browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
      const densePage = await dense.newPage()
      await densePage.goto(url)
      await measureTabs(densePage, 'tab-strip-desktop-2x-density')
      await densePage.setViewportSize({ width: 640, height: 400 })
      await measureTabs(densePage, 'tab-strip-200-percent-reflow')
      await dense.close()

      // Historical fixture: SQL NULL in the existing additive fields is precisely the migrated
      // pre-424 shape. Keep the real decision images, steps and identities; invent no new data.
      await reader.stop()
      const db = new DatabaseSync(join(fixture.project.agentQaRoot, 'runs.db'))
      db.prepare('UPDATE run_members SET recording_json = NULL WHERE run_id = ?').run(fixture.drive.runId)
      db.prepare('UPDATE run_steps SET evidence_json = NULL WHERE run_id = ?').run(fixture.drive.runId)
      db.prepare('UPDATE run_sub_actions SET evidence_state_json = NULL, recording_offset_ms = NULL WHERE run_id = ?').run(fixture.drive.runId)
      db.close()
      reader = await spawnDashboard(fixture.project.root, fixture.project.configPath, port, 60_000, env)
      await page.goto(url)
      await page.locator('[data-run-notice]').waitFor()
      await page.getByRole('tab', { name: /^Variables/ }).click()
      await page.locator('[data-evidence-state="unavailable"]').waitFor()
      notice = await page.evaluate(() => {
        const box = (element: Element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
        const notice = document.querySelector('[data-run-notice]')!
        const text = notice.querySelector(':scope > span')!
        const pane = document.querySelector('[data-evidence-state="unavailable"]')!
        return { dismiss: box(notice.querySelector('button')!), viewport: innerWidth,
          explanation: box(pane.querySelector('p')!), pane: box(pane),
          lines: box(text).height / parseFloat(getComputedStyle(text).lineHeight) }
      })
      await capture(page, 'notice-and-absence-400')
      await capture(page, 'notice-wrap-400')

      // Orphan citation fixture: preserve a real screenshot blob, remove only its marker refs,
      // and seed the typed analysis artifact citing it. No browser response is intercepted.
      const detail = await fetch(`${reader.origin}/api/runs/${encodeURIComponent(fixture.drive.runId)}/detail`).then(r => r.json()) as RunDetailProjection
      const ref = detail.subActions.flatMap(sub => sub.artifactRefs ?? []).find(ref => ref.id.startsWith('decision-screenshot:'))
      if (!ref) throw new Error('Real producer emitted no screenshot for orphan layout fixture')
      await reader.stop()
      const orphanDb = new DatabaseSync(join(fixture.project.agentQaRoot, 'runs.db'))
      orphanDb.prepare('UPDATE run_sub_actions SET artifact_refs = NULL WHERE run_id = ?').run(fixture.drive.runId)
      orphanDb.prepare("UPDATE run_members SET outcome = 'failed' WHERE run_id = ? AND test_index = 0").run(fixture.drive.runId)
      orphanDb.close()
      const analysisPath = join(fixture.project.agentQaRoot, 'runs', slugBranch(fixture.drive.runId), 'analysis.json')
      const artifact = JSON.parse(readFileSync(analysisPath, 'utf8'))
      artifact.verdicts = [{ class: 'app_bug', producer: 'analyze-run', confidence: 1, perTest: 0,
        memoryMisdirectionRuledOut: true, evidence: { citedSteps: [0], citedAnchors: [], citedArtifacts: [{ id: ref.id, sha: ref.sha }], rationale: 'Synthetic orphan layout fixture' } }]
      artifact.parts = []
      guardRunAnalysisArtifact(artifact)
      writeFileSync(analysisPath, JSON.stringify(artifact))
      reader = await spawnDashboard(fixture.project.root, fixture.project.configPath, port, 60_000, env)
      for (const width of [400, 1280]) {
        await page.setViewportSize({ width, height: 800 })
        await page.goto(url)
        await page.locator('button[data-cited-artifact]').first().click()
        await page.locator('[data-player-lightbox] img').waitFor()
        await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-player-lightbox] img')?.naturalWidth)
        await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-player-lightbox]')!).opacity === '1')
        lightboxes.push(await page.evaluate(() => {
          const box = (element: Element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
          const image = document.querySelector<HTMLImageElement>('[data-player-lightbox] img')!
          return { width: innerWidth, viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth,
            image: box(image), dialog: box(document.querySelector('[data-player-lightbox]')!), loaded: image.complete && image.naturalWidth > 0 }
        }))
        await capture(page, `lightbox-${width}`)
      }
      if (process.env.AGENT_QA_424_CAPTURE_DIR) writeFileSync(join(process.env.AGENT_QA_424_CAPTURE_DIR, 'layout-observation.json'), JSON.stringify({ timeline, tabs, notice, lightboxes, chips }, null, 2))
      await context.close()
    } catch (error) { failures.drive = String(error) }
  }, 360_000)

  afterAll(async () => { await reader?.stop(); await fixture?.close(); cleanupTempRoots() })
  it('LAYOUT-TIMELINE-400', () => {
    expect(timeline, JSON.stringify(failures)).toBeDefined()
    expect(timeline!.numbers).toBe(0)
    expect(timeline!.badges.length).toBeGreaterThan(0)
    expect(timeline!.readout).toMatch(/^#\d+\/\d+$/u)
    // Scrolled-out segments keep their un-clipped DOMRect. The actual painted track starts
    // at its overflow viewport, so an offscreen rectangle under the label is not overlap.
    expect(timeline!.member.right).toBeLessThanOrEqual(timeline!.trackViewport.x)
    const paintedFirst = { ...timeline!.first, x: Math.max(timeline!.first.x, timeline!.trackViewport.x),
      right: Math.min(timeline!.first.right, timeline!.trackViewport.right) }
    expect(overlaps(timeline!.member, paintedFirst)).toBe(false)
  })
  it('LAYOUT-BADGES-400', () => {
    expect(timeline, JSON.stringify(failures)).toBeDefined()
    expect(timeline!.steps).toBeGreaterThanOrEqual(3)
    expect(timeline!.badges.length).toBeGreaterThanOrEqual(6)
    for (const [i, badge] of timeline!.badges.entries()) {
      for (const other of timeline!.badges.slice(i + 1)) expect(overlaps(badge, other), JSON.stringify({ badge, other })).toBe(false)
    }
  })
  it('LAYOUT-TAB-STRIP-400-AND-ZOOM', () => {
    expect(tabs.length, JSON.stringify(failures)).toBe(3)
    for (const tab of tabs) {
      expect(tab.document).toBeLessThanOrEqual(tab.viewport)
      expect(tab.triggers.length).toBe(7)
      if (tab.scroll > tab.client) expect(tab.moved).toBeGreaterThan(0)
      for (const trigger of tab.triggers) {
        expect(trigger.contentFits).toBe(true)
        if (trigger.count) expect(inside(trigger.count, trigger.box)).toBe(true)
      }
    }
  })
  it('LAYOUT-NOTICE-AND-ABSENCE-400', () => {
    expect(notice, JSON.stringify(failures)).toBeDefined()
    expect(notice!.dismiss.right).toBeLessThanOrEqual(notice!.viewport)
    expect(notice!.explanation.width).toBeLessThanOrEqual(notice!.pane.width)
    expect(notice!.lines).toBeGreaterThanOrEqual(2)
  })
  it('LAYOUT-LIGHTBOX-FITS', () => {
    expect(lightboxes.length, JSON.stringify(failures)).toBe(2)
    for (const lightbox of lightboxes) {
      expect(lightbox.loaded).toBe(true)
      expect(lightbox.document).toBeLessThanOrEqual(lightbox.viewport)
      expect(inside(lightbox.image, lightbox.dialog)).toBe(true)
      expect(lightbox.dialog.x).toBeGreaterThanOrEqual(0)
      expect(lightbox.dialog.right).toBeLessThanOrEqual(lightbox.viewport)
    }
  })
  it('LAYOUT-MASKED-CHIP-TRUNCATION', () => {
    expect(chips.length, JSON.stringify(failures)).toBeGreaterThan(0)
    expect(chips.some(entry => entry.visible && inside(entry.chip, entry.clip)), 'Wide control must show a whole chip; hiding every chip is not a fix').toBe(true)
    for (const entry of chips) {
      expect(entry.text).toBeTruthy()
      expect(!entry.visible || !overlaps(entry.chip, entry.clip) || (inside(entry.chip, entry.row) && inside(entry.chip, entry.clip)), JSON.stringify(entry)).toBe(true)
    }
  })
})
