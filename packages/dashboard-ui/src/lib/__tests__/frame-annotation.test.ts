import { expect, test } from 'vitest'
import type { ActionAnnotation, RunDetailSubAction } from '@vostride/agent-qa-schema'
import { frameAnnotation, videoAnnotation } from '../frame-annotation'

test('FRAME-ANNOTATION preserves all recorded geometry forms and failure bounds', () => {
  const viewport = { width: 800, height: 600 }
  const box = { x: 100, y: 200, width: 80, height: 40 }
  const point = { x: 140, y: 220 }
  const convert = (annotation: ActionAnnotation) => frameAnnotation({
    plannedAction: { type: 'drag' }, result: { success: false, annotation },
  } as RunDetailSubAction)
  expect(convert({ kind: 'point', viewport, direction: 'down', failureHighlight: box, point: { ...point, boundingBox: box } }))
    .toMatchObject({ type: 'drag', viewport, direction: 'down', failureHighlight: box, clickPoint: point, boundingBox: box })
  expect(convert({ kind: 'region', viewport, region: { boundingBox: box } })).toMatchObject({ boundingBox: box })
  expect(convert({ kind: 'path', viewport, path: { start: point, end: { x: 300, y: 400 } } }))
    .toMatchObject({ startPoint: point, endPoint: { x: 300, y: 400 } })
  for (const scale of [0.5, 2]) {
    expect(convert({ kind: 'pinch', viewport, pinch: { center: point, scale } }))
      .toMatchObject({ startPoint: point, pinchScale: scale > 1 ? 'out' : 'in' })
  }
  expect(frameAnnotation(undefined)).toBeUndefined()
})

test('VIDEO-ANNOTATION-BOUNDARIES refuses legacy, invalid, mismatched and outside-interval overlays', () => {
  const annotation: ActionAnnotation = { kind: 'point', point: { x: 30, y: 40 }, viewport: { width: 800, height: 600 },
    recording: { startMs: 125.5, endMs: 240.2, width: 800, height: 600, scene: 'recorded-page', transform: 'identity' } }
  const sub = { plannedAction: { type: 'click' }, result: { success: true, annotation }, recordingOffsetMs: 9999 } as RunDetailSubAction
  expect(videoAnnotation(sub, 125.5, 800, 600)).toBeDefined()
  for (const time of [0, 125.4, 240.2, Infinity, NaN, 9999]) expect(videoAnnotation(sub, time, 800, 600)).toBeUndefined()
  expect(videoAnnotation(sub, 130, 1280, 720)).toBeUndefined()
  expect(videoAnnotation({ ...sub, result: { success: true, annotation: { ...annotation, recording: undefined } } }, 130, 800, 600)).toBeUndefined()
  expect(videoAnnotation({ ...sub, result: { success: true, annotation: { ...annotation, point: { x: NaN, y: 10 } } } }, 130, 800, 600)).toBeUndefined()
})
