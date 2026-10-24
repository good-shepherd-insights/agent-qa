import { expect, it } from 'vitest'
import { validRecordedAnnotation, type ActionAnnotation } from '../result/annotation'

const annotation: ActionAnnotation = { kind: 'point', point: { x: 20, y: 30 }, viewport: { width: 800, height: 600 },
  recording: { startMs: 10, endMs: 30, width: 800, height: 600, scene: 'recorded-page', transform: 'identity' } }
it('ANNOTATION-VALIDATION: rejects unordered, nonfinite, mismatched and out-of-frame geometry', () => {
  expect(validRecordedAnnotation(annotation)).toBe(true)
  for (const patch of [{ startMs: -1 }, { endMs: 10 }, { endMs: Infinity }, { width: 0 }, { height: 400 }]) {
    expect(validRecordedAnnotation({ ...annotation, recording: { ...annotation.recording!, ...patch } })).toBe(false)
  }
  expect(validRecordedAnnotation({ ...annotation, point: { x: NaN, y: 0 } })).toBe(false)
  expect(validRecordedAnnotation({ ...annotation, point: { x: 900, y: 0 } })).toBe(false)
  expect(validRecordedAnnotation({ ...annotation, recording: undefined })).toBe(false)
})
