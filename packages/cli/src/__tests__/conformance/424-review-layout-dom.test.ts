/// <reference lib="dom" />
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RunDetailProjection } from '@vostride/agent-qa-schema'
import { chromium, type Page } from 'playwright-core'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { capture, recordingFixture, type RecordingFixture } from './recording-dom-fixture.js'
import { cleanupTempRoots, trackTempRoot } from './spawned-chat.js'

// Real producer, server, page and CSS. Explicit response arrangements exercise historical
// absence/capture failure and long-duration metadata; they are layout fixtures, not live claims.
let fixture: RecordingFixture
let detail: RunDetailProjection
let url: string
const observations: Record<string, unknown> = {}
beforeAll(async () => {
  fixture = await recordingFixture('review-layout')
  url = `${fixture.dashboard.origin}/runs/${encodeURIComponent(fixture.drive.runId)}`
  detail = await fetch(`${fixture.dashboard.origin}/api/runs/${encodeURIComponent(fixture.drive.runId)}/detail`).then(r => r.json()) as RunDetailProjection
}, 360_000)
afterAll(async () => {
  if (process.env.AGENT_QA_424_CAPTURE_DIR) writeFileSync(join(process.env.AGENT_QA_424_CAPTURE_DIR, 'review-layout-observations.json'), JSON.stringify(observations, null, 2))
  await fixture?.close()
  cleanupTempRoots()
})

async function arrange(page: Page, projection: RunDetailProjection) {
  await page.route('**/api/runs/*/detail', route => route.fulfill({ json: projection }))
  await page.goto(url)
  await page.locator('[data-step-id]').first().waitFor()
  await page.locator('[data-step-id]').first().locator(':scope > button').click()
}

it('REVIEW-ABSENCE-LAYOUT: assembled evidence tabs preserve flex centering and 8px gaps', async () => {
  const page = await fixture.browser.newPage({ viewport: { width: 400, height: 800 } })
  const measured = []
  try {
    for (const reason of ['unavailable', 'failed'] as const) {
      const projection = structuredClone(detail)
      for (const step of projection.steps) step.evidence = {
        variables: { kind: 'variables', state: 'absent', reason },
        console: { kind: 'console', state: 'absent', reason },
        network: { kind: 'network', state: 'absent', reason },
        a11y: { kind: 'a11y', state: 'absent', reason },
      }
      for (const sub of projection.subActions) sub.ariaEvidence = { kind: 'aria', state: 'absent', reason }
      await page.unroute('**/api/runs/*/detail')
      await arrange(page, projection)
      for (const [label, kind] of [['Variables', 'variables'], ['Network', 'network'], ['Console', 'console'], ['A11y', 'a11y'], ['ARIA Tree', 'aria']]) {
        await page.getByRole('tab', { name: new RegExp(`^${label}`) }).click()
        const pane = page.locator(`[role="tabpanel"][data-state="active"] [data-evidence-kind="${kind}"]`)
        await pane.waitFor()
        measured.push(await pane.evaluate((pane, reason) => {
          const style = getComputedStyle(pane)
          const box = pane.getBoundingClientRect()
          const icon = pane.querySelector('svg')!.getBoundingClientRect()
          const title = pane.querySelector('span')!.getBoundingClientRect()
          return { kind: pane.getAttribute('data-evidence-kind'), reason, display: style.display,
            gap: style.gap, centerDelta: Math.abs(icon.x + icon.width / 2 - box.x - box.width / 2),
            measuredGap: title.y - icon.bottom, role: pane.getAttribute('role'), state: pane.getAttribute('data-evidence-state') }
        }, reason))
        await capture(page, `review-${kind}-${reason}-400`)
      }
    }
    observations.absence = measured
    for (const row of measured) {
      expect(row.display, JSON.stringify(row)).toBe('flex')
      expect(row.gap).toBe('8px')
      expect(row.centerDelta).toBeLessThan(1)
      expect(row.measuredGap).toBeCloseTo(8, 0)
      expect(row.state).toBe(row.reason)
      expect(row.role).toBe(row.reason === 'failed' ? 'alert' : 'status')
    }
  } finally { await page.close() }
}, 120_000)

async function controls(page: Page, name: string, axis: 'time' | 'ordinal') {
  await page.getByRole('tab', { name: 'Overview', exact: true }).click()
  const initialSource = await page.locator('[data-player]').getAttribute('data-player-source')
  expect(initialSource).toBe(axis === 'ordinal' ? 'frames' : 'video')
  expect(await page.evaluate(() => localStorage.getItem('agent-qa.run-detail.player-source'))).toBe('video')
  await page.getByRole('radio', { name: 'Video', exact: true }).click()
  await page.locator('video').waitFor()
  await page.waitForFunction(() => document.querySelector('video')!.readyState >= 1)
  const result = await page.locator('[data-player]').evaluate(player => {
    const box = player.getBoundingClientRect()
    const controls = [...player.querySelectorAll('[data-slot="toggle-group-item"],button[aria-label="Play recording"],button[aria-label="Playback speed"],[data-player-time]')]
    return { viewport: innerWidth, dpr: devicePixelRatio, left: box.left, right: box.right,
      controls: controls.map(element => { const r = element.getBoundingClientRect(); return {
        label: element.textContent || element.getAttribute('aria-label'), left: r.left, right: r.right,
        width: r.width, font: getComputedStyle(element).fontSize, toggle: element.hasAttribute('data-slot') && element.getAttribute('data-slot') === 'toggle-group-item',
      } }) }
  })
  await capture(page, name)
  await page.getByRole('combobox', { name: 'Playback speed', exact: true }).click()
  await page.getByRole('option', { name: '2×', exact: true }).click()
  expect(await page.locator('video').evaluate(video => (video as HTMLVideoElement).playbackRate)).toBe(2)
  await page.locator('video').evaluate(video => video.addEventListener('play', () => video.setAttribute('data-review-played', 'true'), { once: true }))
  await page.getByRole('button', { name: 'Play recording', exact: true }).click()
  await page.locator('video[data-review-played="true"]').waitFor()
  return { initialSource, ...result }
}

it('REVIEW-VIDEO-CONTROLS: timed and ordinal long-duration controls fit at 400px and actual browser zoom', async () => {
  const measured = []
  const page = await fixture.browser.newPage({ viewport: { width: 400, height: 800 } })
  const zoomRoot = trackTempRoot(mkdtempSync(join(tmpdir(), 'agent-qa-review-zoom-')))
  const extension = join(zoomRoot, 'extension')
  mkdirSync(extension)
  writeFileSync(join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Local review zoom probe', version: '1.0',
    host_permissions: ['http://127.0.0.1/*'], background: { service_worker: 'background.js' } }))
  writeFileSync(join(extension, 'background.js'), 'chrome.runtime.onInstalled.addListener(() => {})')
  const zoomContext = await chromium.launchPersistentContext(join(zoomRoot, 'profile'), {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  })
  try {
    const zoomPage = await zoomContext.newPage()
    for (const target of [page, zoomPage]) {
      await target.addInitScript(() => localStorage.setItem('agent-qa.run-detail.player-source', 'video'))
    }
    for (const axis of ['time', 'ordinal'] as const) {
      const projection = structuredClone(detail)
      for (const member of projection.members) if (member.recording?.state === 'present') member.recording.durationMs = 400_000_000
      if (axis === 'ordinal') delete projection.subActions[0]!.recordingOffsetMs
      await page.unroute('**/api/runs/*/detail')
      await arrange(page, projection)
      measured.push({ axis, ...(await controls(page, `review-video-${axis}-400`, axis)) })
      await zoomPage.unroute('**/api/runs/*/detail')
      await arrange(zoomPage, projection)
      const worker = zoomContext.serviceWorkers()[0] ?? await zoomContext.waitForEvent('serviceworker')
      const factor = await worker.evaluate(async url => {
        const tabs = (globalThis as unknown as { chrome: { tabs: {
          query(query: { url: string }): Promise<Array<{ id?: number }>>
          setZoom(id: number, factor: number): Promise<void>
          getZoom(id: number): Promise<number>
        } } }).chrome.tabs
        const [tab] = await tabs.query({ url })
        if (tab?.id === undefined) throw new Error('No fixture tab')
        await tabs.setZoom(tab.id, 2)
        return tabs.getZoom(tab.id)
      }, zoomPage.url())
      await zoomPage.waitForFunction(() => devicePixelRatio === 2 && innerWidth === 640)
      measured.push({ axis, factor, ...(await controls(zoomPage, `review-video-${axis}-zoom`, axis)) })
    }
    observations.controls = measured
    for (const row of measured) {
      expect(row.controls).toHaveLength(5)
      for (const control of row.controls) {
        expect(control.left, JSON.stringify({ row, control })).toBeGreaterThanOrEqual(row.left)
        expect(control.right, JSON.stringify({ row, control })).toBeLessThanOrEqual(Math.min(row.right, row.viewport))
        if (control.toggle) expect(control.font).toBe('12px')
      }
    }
  } finally { await page.close(); await zoomContext.close() }
}, 120_000)
