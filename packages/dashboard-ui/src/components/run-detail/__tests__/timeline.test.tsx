// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { asRef, maskedMarker } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { buildTimelineModel, type TimelineModel } from '@/lib/playhead'
import { signalBadgeName, stepSignals } from '@/lib/evidence-counts'
import { copyTextOf } from '@/lib/display-text'
import type { RunDetailGroup } from '@/lib/run-detail-view'

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
  const counts = stepSignals({ console: { kind: 'console', state: 'present', ref: { sha: 'b'.repeat(64) }, counts: { total: 2, errors: 2, warnings: 0 } } })
  render({ signals: { 0: counts } })
  const button = query('[data-step-signal="console"]')
  expect(button.tagName).toBe('BUTTON')
  expect(button.dataset.count).toBe('2')
  expect(button.getAttribute('aria-label')).toBe(signalBadgeName('console', 2, 1))
  expect(host.querySelectorAll('[data-step-signal]')).toHaveLength(1)
  act(() => button.click())
  expect(openSignal).toHaveBeenCalledWith(0, 'console')
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
