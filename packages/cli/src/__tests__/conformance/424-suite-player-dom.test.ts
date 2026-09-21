/// <reference lib="dom" />
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RunDetailProjection } from '@vostride/agent-qa-schema'
import type { Page } from 'playwright-core'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { recordingFixture, capture, type RecordingFixture } from './recording-dom-fixture.js'
import { cleanupTempRoots } from './spawned-chat.js'

// The local model scripts actions; actual Chromium, runner, persisted read, media bytes,
// HTTP ranges and shipped dashboard provide the positive recording witness.
let fixture: RecordingFixture
let detail: RunDetailProjection
let url: string
const observations: Record<string, unknown> = {}
beforeAll(async () => {
  fixture = await recordingFixture('suite-player', false, true)
  url = `${fixture.dashboard.origin}/runs/${encodeURIComponent(fixture.drive.runId)}`
  detail = await fetch(`${fixture.dashboard.origin}/api/runs/${encodeURIComponent(fixture.drive.runId)}/detail`).then(r => r.json()) as RunDetailProjection
}, 360_000)
afterAll(async () => {
  if (process.env.AGENT_QA_424_CAPTURE_DIR) writeFileSync(join(process.env.AGENT_QA_424_CAPTURE_DIR, 'suite-player-observations.json'), JSON.stringify(observations, null, 2))
  await fixture?.close()
  cleanupTempRoots()
})

async function ready(page: Page) {
  await page.goto(url)
  await page.locator('[data-step-id]').first().waitFor()
  await page.locator('[data-media-durations-ready="true"]').waitFor()
}
async function mediaReady(page: Page) {
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2)
}
async function seek(page: Page, seconds: number) {
  await page.locator('video').evaluate(async (video, seconds) => {
    const media = video as HTMLVideoElement
    media.pause()
    if (Math.abs(media.currentTime - seconds) < 0.0001) return
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('seeked timeout')), 10_000)
      media.addEventListener('seeked', () => { clearTimeout(timer); resolve() }, { once: true })
      media.currentTime = seconds
    })
  }, seconds)
}

async function clickMarker(page: Page, ordinal: number) {
  const marker = page.locator(`[data-timeline-marker="${ordinal}"]`)
  if (await marker.count()) { await marker.click(); return }
  const groups = page.locator('[data-timeline-marker-group]')
  for (let index = 0; index < await groups.count(); index++) {
    await groups.nth(index).click()
    if (await marker.count()) { await marker.click(); return }
    await page.keyboard.press('Escape')
  }
  throw new Error(`Missing action marker ${ordinal}`)
}

async function lensProof(page: Page, point: { x: number; y: number }, name: string) {
  // Fullscreen changes the contain rectangle through ResizeObserver; target the
  // settled media pixels, not the transient pre-observer rectangle.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const media = page.locator('[data-media-transform] > video, [data-media-transform] > img')
  const origin = await media.evaluate((element, point) => {
    const rect = element.getBoundingClientRect()
    const width = element instanceof HTMLVideoElement ? element.videoWidth : (element as HTMLImageElement).naturalWidth
    const height = element instanceof HTMLVideoElement ? element.videoHeight : (element as HTMLImageElement).naturalHeight
    return { x: rect.x + point.x / width * rect.width, y: rect.y + point.y / height * rect.height }
  }, point)
  if (await page.getByRole('button', { name: 'Enable magnifier', exact: true }).count()) await page.getByRole('button', { name: 'Enable magnifier', exact: true }).click()
  await page.mouse.move(origin.x, origin.y)
  await page.locator('[data-media-lens]').waitFor({ state: 'visible' })
  const pixels = await page.locator('[data-media-lens]').evaluate((lens, origin) => {
    const canvas = lens.querySelector('canvas')!
    const media = document.querySelector<HTMLVideoElement | HTMLImageElement>('[data-media-transform] > video, [data-media-transform] > img')!
    const box = media.getBoundingClientRect()
    const nativeWidth = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth
    const nativeHeight = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight
    const scale = box.width / nativeWidth * 2.5
    const oracle = document.createElement('canvas')
    oracle.width = canvas.width; oracle.height = canvas.height
    const context = oracle.getContext('2d')!
    context.drawImage(media, (origin.x - box.x) / box.width * nativeWidth - canvas.width / scale / 2,
      (origin.y - box.y) / box.height * nativeHeight - canvas.height / scale / 2,
      canvas.width / scale, canvas.height / scale, 0, 0, canvas.width, canvas.height)
    const actual = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    const expected = context.getImageData(0, 0, canvas.width, canvas.height).data
    const colours = new Set<number>()
    let error = 0
    for (let index = 0; index < actual.length; index++) error += Math.abs(actual[index]! - expected[index]!)
    for (let index = 0; index < actual.length; index += 4) colours.add(actual[index]! * 65536 + actual[index + 1]! * 256 + actual[index + 2]!)
    const dot = lens.querySelector('[data-annotation="point"]')?.getBoundingClientRect()
    const pixelsBox = canvas.getBoundingClientRect()
    const viewport = document.querySelector('[data-media-viewport]')!.getBoundingClientRect()
    const rect = lens.getBoundingClientRect()
    return { meanPixelError: error / actual.length, colours: colours.size,
      coordinates: { origin, box: box.toJSON(), dot: dot?.toJSON(), pixelsBox: pixelsBox.toJSON(), transform: lens.querySelector('[data-lens-annotation]')?.getAttribute('style') },
      annotationError: dot ? Math.hypot(dot.x + dot.width / 2 - pixelsBox.x - canvas.width / 2, dot.y + dot.height / 2 - pixelsBox.y - canvas.height / 2) : null,
      bounded: rect.left >= viewport.left && rect.right <= viewport.right && rect.top >= viewport.top && rect.bottom <= viewport.bottom }
  }, origin)
  observations[name] = pixels
  await capture(page, name)
  expect(pixels.meanPixelError, JSON.stringify(pixels)).toBeLessThan(2)
  expect(pixels.colours).toBeGreaterThan(10)
  expect(pixels.annotationError, 'The supported action is annotated inside the lens').not.toBeNull()
  expect(pixels.annotationError, JSON.stringify(pixels)).toBeLessThan(1)
  expect(pixels.bounded).toBe(true)
  return pixels
}

it('SUITE-BROWSER-ORDER: arrows cross steps and members in both directions with one boxed action', async () => {
  expect(detail.members).toHaveLength(2)
  const addresses = detail.subActions.map(sub => `${sub.testIndex}:${sub.stepIndex}:${sub.subActionIndex}`)
  expect(addresses.length).toBeGreaterThanOrEqual(14)
  const page = await fixture.browser.newPage({ viewport: { width: 1280, height: 900 } })
  try {
    await ready(page)
    await page.getByRole('radio', { name: 'Frames', exact: true }).click()
    await page.getByRole('slider').press('Home')
    await page.getByRole('slider').evaluate(element => (element as HTMLElement).blur())
    const selected = () => page.evaluate(() => {
      const row = document.querySelector('[data-sub-action][aria-selected="true"]')
      return row?.getAttribute('data-sub-action-id')
    })
    const visit = []
    for (let index = 0; index < addresses.length; index++) {
      const [test, step, sub] = addresses[index]!.split(':')
      await expect.poll(() => selected()).toBe(`${test}:${step}-${sub}`)
      const row = page.locator('[data-sub-action][aria-selected="true"]')
      expect(await row.count()).toBe(1)
      expect(await row.locator(':scope > button').getAttribute('class')).toContain('ring-primary/60')
      expect(await row.locator(':scope > button').getAttribute('class')).not.toContain('border-l')
      visit.push(await selected())
      if (index < addresses.length - 1) await page.keyboard.press('ArrowDown')
    }
    for (const address of addresses.slice(0, -1).reverse()) {
      await page.keyboard.press('ArrowUp')
      const [test, step, sub] = address.split(':')
      await expect.poll(() => selected()).toBe(`${test}:${step}-${sub}`)
    }
    expect(await page.locator('[data-timeline]').count()).toBe(1)
    expect(await page.locator('[data-timeline-member-span]').count()).toBe(2)
    observations.order = visit
    await capture(page, 'suite-action-box-desktop')
  } finally { await page.close() }
}, 120_000)

it('SUITE-BROWSER-ANNOTATION: new recorded intervals align in normal, magnifier and fullscreen', async () => {
  const sub = detail.subActions.find(sub => sub.result?.annotation?.kind === 'point' && sub.result.annotation.recording)
  expect(sub, 'real runner persisted a measured click and recording witness').toBeDefined()
  const annotation = sub!.result!.annotation!
  if (annotation.kind !== 'point' || !annotation.recording) throw new Error('No point witness')
  const witness = annotation.recording
  expect(witness.endMs).toBeGreaterThan(witness.startMs)
  const rows = []
  for (const width of [1280, 400]) {
    const page = await fixture.browser.newPage({ viewport: { width, height: 900 } })
    try {
      await ready(page)
      await page.getByRole('radio', { name: 'Video', exact: true }).click()
      await mediaReady(page)
      await clickMarker(page, detail.subActions.indexOf(sub!) + 1)
      await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)).toBeCloseTo((witness.startMs + witness.endMs) / 2000, 3)
      await page.locator('[data-annotation="point"]').waitFor()
      await page.locator('video').evaluate(video => video.setAttribute('data-witness-video', 'same'))
      const layout = await page.locator('[data-player]').evaluate(player => {
        const rect = (selector: string) => player.querySelector(selector)!.getBoundingClientRect()
        const thumb = rect('[data-timeline-playhead]')
        const track = rect('[data-timeline-track]')
        const time = rect('[data-player-time]')
        const toolbar = rect('[data-player-preview-toolbar]')
        const preview = rect('[data-player-preview]')
        const source = player.querySelector('[data-player-controls] > :last-child')!
        const marker = player.querySelector('[data-timeline-marker-group], [data-timeline-marker]')!
        const icon = marker.querySelector('svg')!.getBoundingClientRect()
        const stem = marker.querySelector('[data-timeline-stem]')!.getBoundingClientRect()
        return { thumb: { width: thumb.width, height: thumb.height }, icon: { width: icon.width, height: icon.height },
          stemTouchesRail: Math.abs(stem.top - track.top - 16) < 1,
          timeRight: time.left >= track.right, timeAligned: Math.abs(time.top + time.height / 2 - track.top - 14) < 2,
          sourceLast: source.getAttribute('aria-label'), toolbarWidth: toolbar.width,
          toolbarInside: toolbar.right <= preview.right && toolbar.bottom <= preview.bottom,
          noStepZoom: !player.querySelector('[aria-label="Media zoom"], [aria-label="Zoom in"], [aria-label="Zoom out"]') }
      })
      expect(layout.thumb).toEqual({ width: 6, height: 18 })
      expect(layout.icon).toEqual({ width: 12, height: 12 })
      expect(layout.stemTouchesRail).toBe(true)
      expect(layout.timeRight && layout.timeAligned && layout.toolbarInside && layout.noStepZoom).toBe(true)
      expect(layout.sourceLast).toBe('Playback source')
      expect(layout.toolbarWidth).toBeLessThanOrEqual(34)
      observations[`layout-${width}`] = layout
      for (const mode of ['normal', 'magnifier', 'fullscreen'] as const) {
        if (mode === 'fullscreen') await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click()
        const lens = mode !== 'normal' ? await lensProof(page, annotation.point, `new-recording-${mode}-${width}`) : undefined
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        const geometry = await page.locator('[data-player]').evaluate((player, point) => {
          const media = player.querySelector<HTMLVideoElement>('video')!
          const box = media.getBoundingClientRect()
          const dot = player.querySelector('[data-media-transform] [data-annotation="point"]')!.getBoundingClientRect()
          const controls = player.querySelector('[data-player-controls]')!.getBoundingClientRect()
          return { time: media.currentTime, duration: media.duration, videoWidth: media.videoWidth, videoHeight: media.videoHeight,
            deltaX: Math.abs(dot.x + dot.width / 2 - box.x - point.x / media.videoWidth * box.width),
            deltaY: Math.abs(dot.y + dot.height / 2 - box.y - point.y / media.videoHeight * box.height),
            controlsLeft: controls.left, controlsRight: controls.right, viewport: innerWidth,
            identity: media.dataset.witnessVideo, paused: media.paused }
        }, annotation.point)
        expect(geometry.deltaX).toBeLessThan(1)
        expect(geometry.deltaY).toBeLessThan(1)
        expect(geometry.identity).toBe('same')
        expect(geometry.videoWidth).toBe(witness.width)
        expect(geometry.videoHeight).toBe(witness.height)
        expect(geometry.controlsLeft).toBeGreaterThanOrEqual(0)
        expect(geometry.controlsRight).toBeLessThanOrEqual(width)
        rows.push({ width, mode, witness, point: annotation.point, lens, ...geometry })
        await capture(page, `new-recording-${mode}-${width}`)
      }
      await page.keyboard.press('Escape')
      expect(await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).evaluate(button => document.activeElement === button)).toBe(true)
      await lensProof(page, annotation.point, `video-lens-paused-${width}`)
      const before = await page.locator('video').evaluate(video => {
        const source = video as HTMLVideoElement
        return { time: source.currentTime, rate: source.playbackRate, paused: source.paused }
      })
      const live = await page.locator('video').evaluate(async video => {
        const source = video as HTMLVideoElement
        const proto = CanvasRenderingContext2D.prototype
        const original = proto.drawImage
        const samples: { time: number; same: boolean }[] = []
        let seeks = 0
        const seeking = () => { seeks++ }
        source.addEventListener('seeking', seeking)
        proto.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
          if (this.canvas.closest('[data-media-lens]')) samples.push({ time: source.currentTime, same: args[0] === source })
          return Reflect.apply(original, this, args)
        } as typeof original
        try {
          const start = source.currentTime
          await source.play()
          await new Promise<void>((resolve, reject) => {
            const deadline = performance.now() + 3000
            const check = () => {
              if (samples.length >= 4 && samples.at(-1)!.time - start >= 0.12) resolve()
              else if (performance.now() > deadline) reject(new Error('Live lens did not redraw current video'))
              else requestAnimationFrame(check)
            }
            check()
          })
          source.pause()
          return { samples, seeks, rate: source.playbackRate, identity: source.dataset.witnessVideo }
        } finally { proto.drawImage = original; source.removeEventListener('seeking', seeking); source.pause() }
      })
      expect(before.paused).toBe(true)
      expect(live.samples.every(sample => sample.same)).toBe(true)
      expect(live.seeks).toBe(0)
      expect(live.rate).toBe(before.rate)
      expect(live.identity).toBe('same')
      observations[`live-lens-${width}`] = live
      await seek(page, (witness.startMs + witness.endMs) / 2000)
      await lensProof(page, annotation.point, `video-lens-after-seek-${width}`)
      await page.mouse.move(0, 0)
      expect(await page.locator('[data-media-lens]').count()).toBe(0)
      await page.getByRole('button', { name: 'Hide annotations', exact: true }).click()
      expect(await page.locator('[data-annotation]').count()).toBe(0)
      await page.getByRole('button', { name: 'Show annotations', exact: true }).click()
      await page.locator('[data-media-transform] [data-annotation="point"]').waitFor()
      await seek(page, Math.max(0, witness.startMs / 1000 - 0.05))
      expect(await page.locator('[data-annotation]').count()).toBe(0)
      await page.getByRole('radio', { name: 'Frames', exact: true }).click()
      expect(await page.locator('[data-media-lens]').count()).toBe(0)
      await capture(page, `suite-frame-normal-${width}`)
      await lensProof(page, annotation.point, `suite-frame-magnifier-${width}`)
      await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click()
      await page.locator('[role="dialog"] img').waitFor()
      await lensProof(page, annotation.point, `suite-frame-fullscreen-lens-${width}`)
      await capture(page, `suite-frame-fullscreen-${width}`)
    } finally { await page.close() }
  }
  observations.newRecording = rows
}, 120_000)

it('SUITE-BROWSER-MEDIA: real progress, marker details, local seeks and continued rate', async () => {
  const page = await fixture.browser.newPage({ viewport: { width: 1280, height: 900 } })
  try {
    await ready(page)
    await mediaReady(page)
    // Independently decode each actual artifact; stored monotonic durations deliberately
    // differ from the encoded media tail and must not control presentation spans.
    const sources = detail.members.map(member => member.recording?.state === 'present' ? `${fixture.dashboard.origin}/api/runs/${encodeURIComponent(fixture.drive.runId)}/artifacts/${member.recording.ref.sha}` : '')
    const durations = await page.evaluate(async sources => Promise.all(sources.map(src => new Promise<number>((resolve, reject) => {
      const media = document.createElement('video')
      media.preload = 'metadata'
      media.onloadedmetadata = () => { const duration = media.duration; media.removeAttribute('src'); media.load(); resolve(duration) }
      media.onerror = () => reject(new Error('Independent metadata decode failed'))
      media.src = src
    }))), sources)
    expect(durations.every(duration => duration > 0)).toBe(true)
    const stored = detail.members.map(member => member.recording?.state === 'present' ? member.recording.durationMs! / 1000 : 0)
    expect(durations[0]! - stored[0]!).toBeGreaterThan(0.2)
    const track = page.locator('[data-timeline-track]')
    const bounds = (await track.boundingBox())!
    const target = durations[0]! + durations[1]! * 0.2
    await page.mouse.click(bounds.x + bounds.width * target / (durations[0]! + durations[1]!), bounds.y + 12)
    await mediaReady(page)
    await expect.poll(() => page.locator('video').getAttribute('src')).toContain(detail.members[1]!.recording!.state === 'present' ? detail.members[1]!.recording!.ref.sha : 'missing')
    const local = await page.locator('video').evaluate(video => (video as HTMLVideoElement).currentTime)
    expect(Math.abs(local - durations[1]! * 0.2)).toBeLessThan(0.15)
    await page.getByRole('slider').press('Home')
    await mediaReady(page)
    const rates = []
    for (const speed of [0.5, 1, 2, 4, 8, 16]) {
      await page.getByRole('combobox', { name: 'Playback speed' }).click()
      await page.getByRole('option', { name: `${speed}×`, exact: true }).click()
      rates.push(await page.locator('video').evaluate(video => (video as HTMLVideoElement).playbackRate))
    }
    expect(rates).toEqual([0.5, 1, 2, 4, 8, 16])
    await page.getByRole('combobox', { name: 'Playback speed' }).click()
    await page.getByRole('option', { name: '1×', exact: true }).click()
    await seek(page, 0)
    await page.locator('video').evaluate(video => {
      video.setAttribute('data-seek-count', '0')
      video.addEventListener('seeking', () => video.setAttribute('data-seek-count', String(Number(video.getAttribute('data-seek-count')) + 1)))
    })
    await page.getByRole('button', { name: 'Play recording', exact: true }).click()
    const samples = await page.evaluate(async () => {
      const values = []
      for (let index = 0; index < 12; index++) {
        await new Promise(resolve => setTimeout(resolve, 40))
        values.push({ time: document.querySelector('video')!.currentTime, left: (document.querySelector('[data-timeline-playhead]') as HTMLElement).style.left })
      }
      return values
    })
    expect(new Set(samples.map(sample => sample.left)).size).toBeGreaterThan(5)
    expect(samples.at(-1)!.time - samples[0]!.time).toBeGreaterThan(0.2)
    expect(await page.locator('video').getAttribute('data-seek-count')).toBe('0')
    await page.getByRole('button', { name: 'Pause recording', exact: true }).click()
    await seek(page, stored[0]! + 0.1)
    await page.getByRole('button', { name: 'Play recording', exact: true }).click()
    const tail = await page.evaluate(async () => {
      const values = []
      for (let index = 0; index < 4; index++) {
        values.push({ time: document.querySelector('video')!.currentTime, left: (document.querySelector('[data-timeline-playhead]') as HTMLElement).style.left })
        await new Promise(resolve => setTimeout(resolve, 40))
      }
      return values
    })
    expect(new Set(tail.map(sample => sample.left)).size).toBe(4)
    expect(tail.every(sample => parseFloat(sample.left) < durations[0]! / (durations[0]! + durations[1]!) * 100)).toBe(true)
    await page.locator('video').evaluate(video => video.setAttribute('data-fullscreen-live', 'same'))
    await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click()
    expect(await page.locator('video[data-fullscreen-live="same"]').evaluate(video => !(video as HTMLVideoElement).paused)).toBe(true)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Pause recording', exact: true }).click()
    const last = detail.subActions.filter(sub => sub.testIndex === 0).at(-1)!
    expect(last.result.annotation?.recording).toBeDefined()
    await clickMarker(page, detail.subActions.indexOf(last) + 1)
    await page.getByRole('button', { name: 'Play recording', exact: true }).click()
    await page.locator('[data-video-action-cue]').waitFor()
    const cueTimes = await page.evaluate(async () => {
      const times = []
      for (let index = 0; index < 4; index++) {
        times.push({ time: document.querySelector('video')!.currentTime, cue: document.querySelector('[data-video-action-cue]')?.textContent })
        await new Promise(resolve => setTimeout(resolve, 40))
      }
      return times
    })
    expect(cueTimes.every(sample => sample.cue === 'Last recorded action')).toBe(true)
    expect(cueTimes.at(-1)!.time - cueTimes[0]!.time).toBeGreaterThan(0.1)
    await page.getByRole('button', { name: 'Pause recording', exact: true }).click()
    await capture(page, 'new-recording-labelled-review-cue')
    await page.getByRole('slider').press('Home')
    await mediaReady(page)
    await page.getByRole('combobox', { name: 'Playback speed' }).click()
    await page.getByRole('option', { name: '2×', exact: true }).click()
    const actualDuration = await page.locator('video').evaluate(video => (video as HTMLVideoElement).duration)
    await seek(page, actualDuration - 0.1)
    await page.getByRole('button', { name: 'Play recording', exact: true }).click()
    await expect.poll(() => page.locator('video').getAttribute('src')).toContain(detail.members[1]!.recording!.state === 'present' ? detail.members[1]!.recording!.ref.sha : 'missing')
    await mediaReady(page)
    expect(await page.locator('video').evaluate(video => ({ rate: (video as HTMLVideoElement).playbackRate, paused: (video as HTMLVideoElement).paused }))).toEqual({ rate: 2, paused: false })
    // Actual dispatches can all be tightly clustered. Arrange one visible action only
    // for the independent singleton hover/focus layout control, retaining its real facts.
    const singleton = structuredClone(detail)
    singleton.subActions = singleton.subActions.slice(0, 1)
    await page.route('**/api/runs/*/detail', route => route.fulfill({ json: singleton }))
    await ready(page)
    const marker = page.locator('[data-timeline-track] > button[data-timeline-marker]').first()
    await marker.hover()
    await marker.focus()
    expect(await page.locator('[role="tooltip"], [data-timeline-marker-details]').count()).toBe(0)
    expect(await marker.getAttribute('title')).toBeNull()
    expect(await marker.getAttribute('aria-label')).toContain('Step')
    await marker.click()
    await capture(page, 'suite-singleton-marker')
    observations.media = { durations, stored, tail, target, local, rates, samples, cueTimes, continuation: true }
  } finally { await page.close() }
}, 120_000)

it('SUITE-BROWSER-GAPS: dense actions remain individually reachable and missing recordings stop continuation', async () => {
  const page = await fixture.browser.newPage({ viewport: { width: 400, height: 900 } })
  try {
    const projection = structuredClone(detail)
    projection.members[1]!.recording = { state: 'absent', reason: 'not-captured' }
    await page.route('**/api/runs/*/detail', route => route.fulfill({ json: projection }))
    await ready(page)
    await mediaReady(page)
    const group = page.locator('[data-timeline-marker-group]').first()
    await group.click()
    const choices = page.locator('[data-slot="popover-content"] [data-timeline-marker]')
    expect(await choices.count()).toBeGreaterThan(1)
    await choices.last().click()
    expect(await page.locator('[data-sub-action][aria-selected="true"]').count()).toBe(1)
    await page.getByRole('slider').press('Home')
    await mediaReady(page)
    const duration = await page.locator('video').evaluate(video => (video as HTMLVideoElement).duration)
    await seek(page, duration - 0.1)
    await page.getByRole('button', { name: 'Play recording', exact: true }).click()
    await page.locator('[data-evidence-kind="video"][data-evidence-state="not-captured"]').waitFor()
    expect(await page.locator('video').count()).toBe(0)
    await capture(page, 'suite-missing-recording-400')
    // Historical completion offsets cannot substitute for the new interval and geometry.
    const historical = structuredClone(detail)
    for (const sub of historical.subActions) if (sub.result?.annotation) delete sub.result.annotation.recording
    await page.unroute('**/api/runs/*/detail')
    await page.route('**/api/runs/*/detail', route => route.fulfill({ json: historical }))
    await ready(page)
    await mediaReady(page)
    const offset = historical.subActions.find(sub => sub.result?.annotation)?.recordingOffsetMs
    expect(offset).toBeDefined()
    await seek(page, offset! / 1000)
    expect(await page.locator('[data-annotation]').count()).toBe(0)
    observations.gaps = { denseChoices: true, missingContinuationStopped: true, historicalCompletionOffsetNoOverlay: true }
  } finally { await page.close() }
}, 120_000)
