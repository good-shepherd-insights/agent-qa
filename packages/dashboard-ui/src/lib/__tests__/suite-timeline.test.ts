import { expect, test } from 'vitest'
import { buildSuiteTimeline, suiteProgress, suiteSeek, suiteClock } from '../suite-timeline'
import type { RunDetailGroup } from '../run-detail-view'

function member(testIndex: number, durationMs = 10000): RunDetailGroup {
  return {
    member: { testIndex, attempts: 1, name: `Test ${testIndex}`, recording: {
      state: 'present', ref: { id: `recording:${'a'.repeat(64)}`, sha: 'a'.repeat(64) },
      contentType: 'video/webm', byteLength: 100, durationMs,
    } },
    steps: [{ step: { testIndex, stepIndex: 0, cacheStatus: 'miss', verifierVerdict: { pass: true, reasoning: '' }, selfHealOccurred: false, briefDigest: '' },
      subActions: [1000, 5000].map((recordingOffsetMs, subActionIndex) => ({ testIndex, stepIndex: 0, subActionIndex, recordingOffsetMs,
        plannedAction: { type: 'delay', ms: 10 }, result: { success: true }, plan: '', screenStateHash: '',
      })),
    }],
  }
}

test('SUITE-LOCAL-SEEK preserves order and recording-local offsets across boundaries', () => {
  const model = buildSuiteTimeline([member(2), member(7, 20000)])
  expect(model.axis).toBe('time')
  expect(model.extent).toBe(30000)
  expect(model.markers.map(marker => [marker.testIndex, marker.recordingOffsetMs])).toEqual([[2, 1000], [2, 5000], [7, 1000], [7, 5000]])
  const target = suiteSeek(model, 0.5)!
  expect(target.member.model.testIndex).toBe(7)
  expect(target.localFraction).toBeCloseTo(0.25)
  expect(suiteSeek(model, 1 / 3)!.member.model.testIndex).toBe(7)
  // An action at the previous recording's endpoint still belongs to that recording.
  const endpoint = suiteSeek(model, 1 / 3, { testIndex: 2, stepIndex: 0, subActionIndex: 1 })!
  expect(endpoint.member.model.testIndex).toBe(2)
  expect(endpoint.localFraction).toBe(1)
  expect(suiteSeek(model, 1)!.localFraction).toBe(1)
  expect(suiteProgress(model, 7, 7.5)).toBeCloseTo(17.5 / 30)
  expect(buildSuiteTimeline([member(7)]).markers[0]!.position).toBe(0.1)
})

test('SUITE-WITNESS-SEEK uses measured review coordinates without rewriting completion offsets', () => {
  const first = member(2)
  const second = member(7, 20000)
  second.steps[0]!.subActions[0]!.result.annotation = { kind: 'point', viewport: { width: 800, height: 600 }, point: { x: 40, y: 80 },
    recording: { startMs: 200, endMs: 220, width: 800, height: 600, scene: 'recorded-page', transform: 'identity' } }
  const model = buildSuiteTimeline([first, second])
  const marker = model.markers[2]!
  expect(marker.recordingOffsetMs).toBe(1000)
  expect(marker.position).toBeCloseTo(10210 / 30000)
  expect(suiteSeek(model, marker.position, marker)!.localFraction! * 20000).toBeCloseTo(210)
})

test('SUITE-GAPS remain explicit and untimed members never gain action offsets', () => {
  const untimed = member(3)
  delete untimed.steps[0]!.subActions[1]!.recordingOffsetMs
  const absent = { ...member(5), steps: [] }
  absent.member.recording = { state: 'absent', reason: 'unsupported' }
  const model = buildSuiteTimeline([member(0), untimed, absent, member(8)])
  expect(model.axis).toBe('ordinal')
  expect(model.members).toHaveLength(4)
  const target = suiteSeek(model, (model.members[1]!.start + model.members[1]!.end) / 2)!
  expect(target.localFraction).toBeUndefined()
  expect(model.markers.find(marker => marker.testIndex === 3 && marker.subActionIndex === 1)?.recordingOffsetMs).toBeUndefined()
  const gap = suiteSeek(model, (model.members[2]!.start + model.members[2]!.end) / 2)!
  expect(gap.member.model.testIndex).toBe(5)
  expect(gap.playhead).toBeNull()
  expect(gap.localFraction).toBeUndefined()
  expect(suiteProgress(model, 3, 5)).toBeUndefined()
  expect(suiteProgress(model, 0, 5)).toBeCloseTo(1 / 7)
})


test('SUITE-CLOCK accumulates decoded visible durations without rounding or guessing gaps', () => {
  const model = buildSuiteTimeline([member(2), member(7), member(9)])
  const durations = new Map([[2, 10234.5], [7, 20345.75], [9, 30789.25]])
  expect(suiteClock(model, durations, 2)).toEqual({ offsetMs: 0, totalMs: 61369.5 })
  expect(suiteClock(model, durations, 7)).toEqual({ offsetMs: 10234.5, totalMs: 61369.5 })
  expect(suiteClock(model, durations, 9)).toEqual({ offsetMs: 30580.25, totalMs: 61369.5 })
  expect(suiteClock(buildSuiteTimeline([member(7)]), durations, 7)).toEqual({ offsetMs: 0, totalMs: 20345.75 })
  durations.delete(7)
  expect(suiteClock(model, durations, 2)).toEqual({ offsetMs: 0, totalMs: undefined })
  expect(suiteClock(model, durations, 9)).toEqual({ offsetMs: undefined, totalMs: undefined })
  expect(suiteClock(model, new Map(), 7)).toEqual({ offsetMs: undefined, totalMs: undefined })
})
