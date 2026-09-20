import { expect, test } from 'vitest'
import { asRef, maskedMarker } from '@vostride/agent-qa-schema'
import type { TimelineMarker, TimelineModel } from '../playhead'
import { copyTextOf } from '../display-text'

const modules = import.meta.glob<typeof import('../timeline-view')>('../timeline-view.ts', { eager: true })
function view() {
  expect(modules['../timeline-view.ts'], 'timeline view helpers exist').toBeDefined()
  return modules['../timeline-view.ts']!
}
const marker: TimelineMarker = {
  testIndex: 0, stepIndex: 1, subActionIndex: 0, ordinal: 3, position: 0.2,
  result: 'passed', frame: 'absent', recordingOffsetMs: 7400,
  subAction: {
    testIndex: 0, stepIndex: 1, subActionIndex: 0, plan: 'private reasoning',
    plannedAction: { type: 'fill', ref: asRef('e1'), text: maskedMarker('secret'), clearMode: 'replace', submit: false },
    result: { success: true }, screenStateHash: 'screen',
  },
}

test('TIMELINE-DENSITY', () => {
  const { markerDensity, MARKER_DENSITIES, TICK_SLOT_PX, SCROLL_SLOT_PX } = view()
  expect(MARKER_DENSITIES).toEqual(['glyph', 'tick', 'scroll'])
  expect([TICK_SLOT_PX, SCROLL_SLOT_PX]).toEqual([16, 8])
  expect([24, 16, 15, 8, 7].map(markerDensity)).toEqual(['glyph', 'glyph', 'tick', 'tick', 'scroll'])
})

test('TIMELINE-VALUE-TEXT-MASKED', () => {
  const text = view().timelineValueText(marker, 12)
  expect(text).toBe(`Step 2, sub-action 3 of 12: Filled with ${copyTextOf(maskedMarker('secret'))}, passed, 0:07`)
  expect(text).not.toContain(maskedMarker('secret'))
  expect(view().timelineValueText({ ...marker, recordingOffsetMs: undefined }, 12)).not.toContain('0:07')
})

test('TIMELINE-READOUT-RECORDED-ONLY', () => {
  const model: TimelineModel = { testIndex: 0, axis: 'time', extent: 42000, markers: [marker], segments: [], playhead: marker }
  expect(view().timelineReadout(model, marker)).toBe('#3 of 1 · 0:07 / 0:42')
  expect(view().timelineReadout({ ...model, axis: 'ordinal' }, marker)).toBe('#3 of 1')
  expect(view().timelineReadout(model, marker, true)).toBe('#3/1')
  expect(view().timelineReadout({ ...model, markers: [], axis: 'ordinal' }, undefined)).toBe('#0 of 0')
})
