import { expect, test } from 'vitest'
import * as api from '../index'

const sha = 'a'.repeat(64)
const ref = { id: `recording:${sha}`, sha }
const present = { state: 'present', ref, contentType: 'video/webm', byteLength: 42 }

test('C424-RECORDING-STATES-EXACT', () => {
  expect(api.RECORDING_STATES).toEqual(['present', 'absent'])
  expect(api.RecordingEntrySchema.safeParse({ ...present, state: 'pending' }).success).toBe(false)
})

test('C424-RECORDING-TYPES-EXACT', () => {
  expect(api.RECORDING_CONTENT_TYPES).toEqual(['video/webm', 'video/mp4'])
  for (const contentType of ['video/webm', 'video/mp4']) {
    expect(api.RecordingEntrySchema.safeParse({ ...present, contentType }).success).toBe(true)
  }
  expect(api.RecordingEntrySchema.safeParse({ ...present, contentType: 'text/html' }).success).toBe(false)
})

test('C424-RECORDING-REF-EXACT', () => {
  expect(api.RECORDING_REF_PREFIX).toBe('recording:')
  expect(api.RecordingRefSchema.parse(ref)).toEqual(ref)
  for (const invalid of [
    { ...ref, id: `decision-screenshot:${sha}` },
    { ...ref, sha: 'b'.repeat(64) },
    { ...ref, id: 'recording:../x' },
    { id: 'recording:../x', sha: '../x' },
    { ...ref, sha: sha.toUpperCase() },
  ]) expect(api.RecordingRefSchema.safeParse(invalid).success).toBe(false)
})

test('REC-PRESENT', () => {
  expect(api.RecordingEntrySchema).toBeDefined()
  expect(api.RecordingEntrySchema.parse(present)).toEqual(present)
  expect(api.RecordingEntrySchema.safeParse({ ...present, ref: undefined }).success).toBe(false)
  for (const byteLength of [-1, 1.5, Infinity, NaN]) {
    expect(api.RecordingEntrySchema.safeParse({ ...present, byteLength }).success).toBe(false)
  }
})

for (const [cell, reason] of [
  ['REC-EMPTY', 'empty'],
  ['REC-UNSUPPORTED', 'unsupported'],
  ['REC-NOT-CAPTURED', 'not-captured'],
  ['REC-FAILED', 'failed'],
  ['REC-UNAVAILABLE', 'unavailable'],
] as const) {
  test(cell, () => {
    expect(api.RecordingEntrySchema).toBeDefined()
    const absent = { state: 'absent', reason }
    expect(api.RecordingEntrySchema.parse(absent)).toEqual(absent)
    expect(api.RecordingEntrySchema.safeParse({ ...absent, ref }).success).toBe(false)
    expect(api.RecordingEntrySchema.safeParse({ ...absent, reason: 'unknown' }).success).toBe(false)
  })
}

test('REC-BYTES-GONE', () => {
  expect(api.RecordingEntrySchema).toBeDefined()
  const absent = { state: 'absent', reason: 'unavailable', evidenceIncomplete: true }
  expect(api.RecordingEntrySchema.parse(absent)).toEqual(absent)
})
