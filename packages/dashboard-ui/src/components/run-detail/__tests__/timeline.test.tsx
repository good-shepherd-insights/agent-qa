// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { asRef, maskedMarker } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { buildTimelineModel, type TimelineModel } from '@/lib/playhead'
import { signalBadgeName, stepProblemCounts } from '@/lib/evidence-counts'
import { copyTextOf } from '@/lib/display-text'
import type { RunDetailGroup } from '@/lib/run-detail-view'
import { routes } from '@/lib/routes'

const modules = import.meta.glob<typeof import('../timeline')>('../timeline.tsx', { eager: true })
type Props = ComponentProps<typeof import('../timeline').Timeline>
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let host: HTMLDivElement
let model: TimelineModel
const change = vi.fn()
const seek = vi.fn()
const openSignal = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })))
  const group: RunDetailGroup = {
    member: { testIndex: 0, attempts: 1 },
    steps: [0, 1].map(stepIndex => ({
      step: { testIndex: 0, stepIndex, cacheStatus: 'miss', verifierVerdict: { pass: true, reasoning: '' }, selfHealOccurred: stepIndex === 0, briefDigest: 'digest' },
      subActions: [0, 1].map(subActionIndex => ({
        testIndex: 0, stepIndex, subActionIndex, plan: 'private reasoning',
        plannedAction: { type: 'fill', ref: asRef('e1'), text: maskedMarker('secret'), clearMode: 'replace', submit: false },
        result: { success: subActionIndex === 0 }, screenStateHash: 'screen',
        recordingOffsetMs: (stepIndex * 2 + subActionIndex) * 10000,
        artifactRefs: subActionIndex === 1 ? [] : [{ id: `decision-screenshot:${'a'.repeat(64)}`, sha: 'a'.repeat(64) }],
      })),
    })),
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
  const module = modules['../timeline.tsx']
  expect(module, 'Timeline exists').toBeDefined()
  const { Timeline } = module!
  act(() => root.render(<Timeline model={model} playhead={model.markers[0]!} source='frames' runId='run' onPlayheadChange={change} onSeekFraction={seek} onOpenSignal={openSignal} {...extra} />))
}
function query(selector: string) { return host.querySelector<HTMLElement>(selector)! }

test('TIMELINE-MARKER-PER-SUBACTION', () => {
  render()
  expect(host.querySelectorAll('[data-timeline-marker]')).toHaveLength(4)
  expect([...host.querySelectorAll('[data-marker-index]')].map(node => node.getAttribute('data-marker-index'))).toEqual(['1', '2', '3', '4'])
  expect(host.querySelectorAll('[data-timeline-marker][tabindex="-1"][aria-hidden="true"]')).toHaveLength(4)
})
test('TIMELINE-GAP-DASHED-NUMBERED', () => {
  render()
  const gap = query('[data-marker-index="2"]')
  expect(gap.dataset.markerFrame).toBe('absent')
  expect(gap.querySelector('.border-dashed')).not.toBeNull()
  expect(gap.textContent).toContain('2')
})
test('TIMELINE-RESULT-SHAPE-NOT-COLOUR', () => {
  render()
  expect(query('[data-marker-result="passed"]').querySelector('.lucide-check')).not.toBeNull()
  expect(query('[data-marker-result="failed"]').querySelector('.lucide-x')).not.toBeNull()
})
test('TIMELINE-AXIS-ATTRIBUTE', () => {
  render()
  expect(query('[data-timeline]').dataset.timelineAxis).toBe('ordinal')
  render({ model: { ...model, axis: 'time', extent: 42000 } })
  expect(query('[data-timeline]').dataset.timelineAxis).toBe('time')
  expect(query('[data-timeline]').dataset.timelineMember).toBe('0')
})
test('TIMELINE-SELECTED-SEGMENT', () => {
  render({ playhead: model.markers[2]! })
  expect(query('[data-timeline-segment="0:1"]').dataset.selected).toBe('true')
  expect(query('[data-timeline-segment="0:1"]').className).toContain('bg-primary/25')
  expect(query('[data-marker-current="true"]').dataset.markerIndex).toBe('3')
  expect(query('[data-marker-current="true"]').innerHTML).toContain('ring-primary')
})
test('TIMELINE-SIGNAL-BADGES', () => {
  const counts = stepProblemCounts({
    console: { kind: 'console', state: 'present', ref: { id: `console-evidence:${'b'.repeat(64)}`, sha: 'b'.repeat(64) }, counts: { total: 2, errors: 2, warnings: 0 } },
    network: { kind: 'network', state: 'absent', reason: 'not-captured' },
    a11y: { kind: 'a11y', state: 'absent', reason: 'not-captured' },
    variables: { kind: 'variables', state: 'absent', reason: 'not-captured' },
  })
  render({ signals: { 0: counts } })
  const button = query('[data-step-signal="console"]')
  expect(button.tagName).toBe('BUTTON')
  expect(button.dataset.count).toBe('2')
  expect(button.className).toContain('text-red-500')
  expect(button.getAttribute('aria-label')).toBe(signalBadgeName('console', 2, 1))
  expect(host.querySelectorAll('[data-step-signal]')).toHaveLength(1)
  act(() => button.click())
  expect(openSignal).toHaveBeenCalledWith(0, 'console')
})

test('TIMELINE-SIGNAL-SEVERITY follows recorded impact at equal totals and omits absent evidence', () => {
  const ref = { id: `a11y-evidence:${'b'.repeat(64)}` as const, sha: 'b'.repeat(64) }
  for (const impact of ['minor', 'moderate', 'serious', 'critical'] as const) {
    model.segments[0]!.step.evidence = {
      variables: { kind: 'variables', state: 'absent', reason: 'not-captured' },
      console: { kind: 'console', state: 'absent', reason: 'failed' },
      network: { kind: 'network', state: 'present', ref, counts: { total: 2, failed: 1, errored: 1 } },
      a11y: { kind: 'a11y', state: 'present', ref, counts: { minor: 0, moderate: 0, serious: 0, critical: 0, [impact]: 2 } },
    }
    render()
    const badge = query('[data-step-signal="a11y"]')
    expect(badge.dataset.count).toBe('2')
    expect(badge.getAttribute('aria-label')).toBe(signalBadgeName('a11y', 2, 1))
    expect(badge.className).toContain(impact === 'minor' || impact === 'moderate' ? 'text-amber-500' : 'text-red-500')
    expect(query('[data-step-signal="network"]').className).toContain('text-red-500')
    expect(query('[data-step-signal="console"]')).toBeNull()
  }
})
test('TIMELINE-HEALED-STEP-ROW-A', () => {
  render()
  expect(query('[data-timeline-signals]').querySelector('.lucide-refresh-cw')).not.toBeNull()
  expect(host.querySelector('[data-marker-result="healed"]')).toBeNull()
})
test('TIMELINE-ZERO-STEPS', () => {
  render({ model: { ...model, markers: [], segments: [], playhead: null }, playhead: null })
  expect(query('[data-timeline]')).not.toBeNull()
  expect(query('[data-timeline-readout]').textContent).toBe('#0 of 0')
  expect(query('[data-timeline-marker]')).toBeNull()
  expect(query('[data-timeline-playhead]')).toBeNull()
})
test('TIMELINE-SLIDER-ARIA', () => {
  render()
  const slider = query('[role="slider"]')
  expect(slider.getAttribute('aria-label')).toBe('Test timeline')
  expect(slider.getAttribute('aria-valuemin')).toBe('1')
  expect(slider.getAttribute('aria-valuemax')).toBe('4')
  expect(slider.getAttribute('aria-valuenow')).toBe('1')
  expect(slider.getAttribute('aria-valuetext')).toBe(`Step 1, sub-action 1 of 4: Filled with ${copyTextOf(maskedMarker('secret'))}, passed, 0:00`)
  expect(host.innerHTML).not.toContain(maskedMarker('secret'))
  expect(host.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
})

function pointer(element: HTMLElement, type: string, clientX = 0) {
  const event = new MouseEvent(type, { bubbles: true, clientX, button: 0 })
  Object.defineProperty(event, 'pointerId', { value: 7 })
  Object.defineProperty(event, 'pointerType', { value: 'mouse' })
  act(() => element.dispatchEvent(event))
}
function track() {
  const element = query('[data-timeline-track]')
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ left: 10, width: 400 } as DOMRect)
  element.setPointerCapture = vi.fn()
  element.hasPointerCapture = vi.fn(() => true)
  element.releasePointerCapture = vi.fn()
  return element
}
function address(index: number) {
  const marker = model.markers[index]!
  return { testIndex: marker.testIndex, stepIndex: marker.stepIndex, subActionIndex: marker.subActionIndex }
}
function key(element: HTMLElement, value: string) {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })
  act(() => element.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(true)
}
async function hover(index: number) {
  await act(async () => { pointer(query(`[data-marker-index="${index}"]`), 'pointerover'); await new Promise(resolve => setTimeout(resolve, 0)) })
}
function popover() { return document.querySelector<HTMLElement>('[data-timeline-popover]')! }

test('TIMELINE-SNAP-FRAMES-NEAREST', () => {
  render()
  const element = track()
  pointer(element, 'pointerdown', 208)
  expect(change).toHaveBeenLastCalledWith(address(1))
  expect(element.setPointerCapture).toHaveBeenCalledWith(7)
  pointer(element, 'pointermove', 330)
  expect(change).toHaveBeenLastCalledWith(address(3))
  pointer(element, 'pointerup', 330)
  expect(element.releasePointerCapture).toHaveBeenCalledWith(7)
  pointer(element, 'pointermove', 60)
  expect(change).toHaveBeenLastCalledWith(address(3))
  expect(seek).not.toHaveBeenCalled()
})
test('TIMELINE-SNAP-VIDEO-FREE', () => {
  render({ source: 'video' })
  const element = track()
  pointer(element, 'pointerdown', 72)
  expect(change).toHaveBeenLastCalledWith(address(0))
  expect(seek).toHaveBeenLastCalledWith(0.125)
  pointer(element, 'pointermove', 210)
  expect(seek).toHaveBeenLastCalledWith(0.5)
  expect(change).toHaveBeenLastCalledWith(address(1))
  pointer(element, 'pointercancel', 210)
  pointer(element, 'pointermove', 400)
  expect(seek).toHaveBeenLastCalledWith(0.5)
})
test('TIMELINE-KEYS-ON-THUMB', () => {
  render({ playhead: model.markers[1]! })
  const slider = query('[role="slider"]')
  key(slider, 'ArrowRight'); expect(change).toHaveBeenLastCalledWith(address(2))
  key(slider, 'ArrowLeft'); expect(change).toHaveBeenLastCalledWith(address(0))
  key(slider, 'Home'); expect(change).toHaveBeenLastCalledWith(address(0))
  key(slider, 'End'); expect(change).toHaveBeenLastCalledWith(address(3))
  key(slider, 'PageDown'); expect(change).toHaveBeenLastCalledWith(address(2))
  render({ playhead: model.markers[3]! })
  key(query('[role="slider"]'), 'PageUp'); expect(change).toHaveBeenLastCalledWith(address(0))
  const calls = change.mock.calls.length
  act(() => query('[data-timeline]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
  expect(change).toHaveBeenCalledTimes(calls)
})
test('TIMELINE-POPOVER-HOVER', async () => {
  render()
  expect(document.querySelector('img')).toBeNull()
  await hover(1)
  expect(popover()).not.toBeNull()
  expect(popover().querySelector('img')?.getAttribute('src')).toBe(routes.runArtifact('run', 'a'.repeat(64)))
  expect(popover().querySelector('[data-slot="skeleton"]')).not.toBeNull()
  act(() => popover().querySelector('img')!.dispatchEvent(new Event('load')))
  expect(popover().querySelector('[data-slot="skeleton"]')).toBeNull()
  expect(popover().querySelector('[data-masked="secret"]')).not.toBeNull()
  expect(popover().querySelector('.line-clamp-2')).not.toBeNull()
  expect(popover().textContent).toContain('0:00.0')
  expect(document.body.innerHTML).not.toContain(maskedMarker('secret'))
  pointer(query('[data-marker-index="1"]'), 'pointerout')
  expect(document.querySelector('img')).toBeNull()
})
test('TIMELINE-POPOVER-THUMB-FOCUS', async () => {
  render({ playhead: model.markers[2]! })
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })))
  await act(async () => query('[role="slider"]').focus())
  expect(popover()).not.toBeNull()
  expect(popover().dataset.timelinePopover).toBe('3')
  render({ playhead: model.markers[0]! })
  expect(popover().dataset.timelinePopover).toBe('1')
})
test('TIMELINE-POPOVER-ABSENT-FRAME', async () => {
  render()
  await hover(2)
  expect(popover()).not.toBeNull()
  expect(popover().querySelector('[data-evidence-state="unavailable"][data-evidence-kind="frame"]')).not.toBeNull()
  expect(popover().querySelector('img')).toBeNull()
  expect(popover().textContent).toContain('#2')
  expect(popover().textContent).toContain('failed')
})
test('TIMELINE-POPOVER-THUMB-FAILED', async () => {
  render()
  await hover(1)
  expect(popover()).not.toBeNull()
  act(() => popover().querySelector('img')!.dispatchEvent(new Event('error')))
  expect(popover().querySelector('[data-evidence-state="failed"][data-evidence-failure="load"]')).not.toBeNull()
  expect(popover().querySelector('button')).toBeNull()
})
test('TIMELINE-REDUCED-MOTION', () => {
  vi.mocked(window.matchMedia).mockImplementation(query => ({ matches: query.includes('reduced-motion'), addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList)
  render()
  expect(query('[data-timeline-playhead]').className).not.toContain('transition')
})
test('TIMELINE-BADGE-ROVING', () => {
  render({ signals: {
    0: { console: { kind: 'problem', count: 2, severity: 'high' }, network: { kind: 'problem', count: 1, severity: 'high' }, a11y: undefined },
    1: { console: undefined, network: undefined, a11y: { kind: 'problem', count: 3, severity: 'moderate' } },
  } })
  const group = query('[role="group"]')
  const buttons = group.querySelectorAll<HTMLButtonElement>('button')
  expect(group.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
  act(() => buttons[0]!.focus())
  key(buttons[0]!, 'ArrowRight')
  expect(document.activeElement).toBe(buttons[1])
  key(buttons[1]!, 'ArrowRight')
  expect(document.activeElement).toBe(buttons[2])
  key(buttons[2]!, 'ArrowLeft')
  expect(document.activeElement).toBe(buttons[1])
  expect(group.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
})

test('TIMELINE-DENSITY-RENDER keeps ticks compact and failures recognizable', () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(60)
  render()
  expect(query('[data-marker-result="passed"]').querySelector('.h-4.w-4')).toBeNull()
  expect(query('[data-marker-result="passed"]').querySelector('.h-3.w-1')).not.toBeNull()
  expect(query('[data-marker-result="failed"]').querySelector('.lucide-x')).not.toBeNull()
})
