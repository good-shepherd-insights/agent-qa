import { expect, test } from 'vitest'
import { buildSuiteTimeline, suiteProgress, suiteSeek } from '../suite-timeline'
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
