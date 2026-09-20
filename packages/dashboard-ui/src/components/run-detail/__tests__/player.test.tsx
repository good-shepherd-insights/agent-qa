// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { asRef, maskedMarker } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { buildTimelineModel, latestUsableFrame, type TimelineModel } from '@/lib/playhead'
import type { RunDetailGroup } from '@/lib/run-detail-view'
import { PLAYER_COPY } from '@/lib/player-view'
import { routes } from '@/lib/routes'

const modules = import.meta.glob<typeof import('../player')>('../player.tsx', { eager: true })
type Props = ComponentProps<typeof import('../player').Player>
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let host: HTMLDivElement
let group: RunDetailGroup
let model: TimelineModel
const change = vi.fn()
const sourceChange = vi.fn()
const sha = 'a'.repeat(64)
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('fetch', vi.fn(async () => ({ status: 404 })))
  group = {
    member: { testIndex: 0, attempts: 1 },
    steps: [{
      step: { testIndex: 0, stepIndex: 0, cacheStatus: 'miss', verifierVerdict: { pass: true, reasoning: '' }, selfHealOccurred: false, briefDigest: 'digest' },
      subActions: [0, 1].map(subActionIndex => ({
        testIndex: 0, stepIndex: 0, subActionIndex, plan: 'private reasoning',
        plannedAction: { type: 'fill', ref: asRef('e1'), text: maskedMarker('secret'), clearMode: 'replace', submit: false },
        result: { success: true }, screenStateHash: 'screen', recordingOffsetMs: subActionIndex * 10000,
        artifactRefs: subActionIndex === 0 ? [{ id: `decision-screenshot:${sha}`, sha }] : [],
      })),
    }],
  }
  model = buildTimelineModel(group)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function render(extra: Partial<Props> = {}) {
  const module = modules['../player.tsx']
  expect(module, 'Player exists').toBeDefined()
  const { Player } = module!
  act(() => root.render(<Player model={model} playhead={model.markers[0]!} source='frames' runId='run' onSourceChange={sourceChange} onPlayheadChange={change} {...extra} />))
}
function query(selector: string) { return host.querySelector<HTMLElement>(selector)! }
async function errorImage() {
  await act(async () => { query('img').dispatchEvent(new Event('error')); await Promise.resolve() })
}

test('PLAYER-OPENS-ON-FRAMES', () => {
  render({ recording: { state: 'absent', reason: 'not-captured' } })
  expect(query('[data-player]').dataset.playerSource).toBe('frames')
  const video = query('[data-slot="toggle-group-item"][value="video"]')
  expect(video.getAttribute('aria-label')).toBe('Video — No recording for this test')
  expect(video.className).toContain('opacity-60')
  expect(video.hasAttribute('disabled')).toBe(false)
  act(() => video.click())
  expect(sourceChange).toHaveBeenCalledWith('video')
})
test('PLAYER-FRAME-THREE-ROADS', async () => {
  for (const unavailable of [{ evidenceIncomplete: true }, { present: false }]) {
    const marker = model.markers[0]!
    render({ model: { ...model, markers: [{ ...marker, ref: { ...marker.ref!, ...unavailable } }] } })
    expect(query('[data-evidence-kind="frame"]').dataset.evidenceState).toBe('unavailable')
    expect(query('[data-evidence-kind="frame"]').dataset.evidenceIncomplete).toBe('true')
    expect(query('img')).toBeNull()
  }
  render()
  expect(query('[data-artifact-state="available"] img')).not.toBeNull()
  await errorImage()
  expect(query('[data-evidence-kind="frame"]').dataset.evidenceState).toBe('unavailable')
  expect(query('[data-evidence-kind="frame"]').dataset.evidenceIncomplete).toBe('true')
})
test('PLAYER-CAPTION-SUBSTITUTION', () => {
  render({ frame: latestUsableFrame(group.steps[0]!.subActions) })
  const caption = query('[data-player-caption]')
  expect(caption.textContent).toContain(PLAYER_COPY.substitution(1, 2))
  expect(caption.dataset.frameSourceSubAction).toBe('0')
  expect(caption.className).toContain('[overflow-wrap:anywhere]')
  expect(caption.querySelector('[data-action-family]')?.className).toContain('text-sm')
  expect(caption.textContent).toContain('#1')
  expect(caption.textContent).toContain('passed')
  expect(caption.textContent).toContain('0:00')
  expect(host.innerHTML).not.toContain(maskedMarker('secret'))
  render()
  expect(query('[data-frame-source-sub-action]')).toBeNull()
  expect(query('[data-player-caption]').textContent).not.toContain('Showing')
})
test('PLAYER-ONE-MINTER', () => {
  render()
  expect(query('img').getAttribute('src')).toBe(routes.runArtifact('run', sha))
})
test('PLAYER-FRAME-NOT-CAPTURED-ROWS', () => {
  render({ playhead: model.markers[1]! })
  expect(query('[data-evidence-kind="frame"]').textContent).toContain('No screenshot for this action')
  render({ model: { ...model, markers: [], segments: [] }, playhead: null })
  expect(query('[data-evidence-kind="frame"]').textContent).toContain('No screenshots for this step')
})
