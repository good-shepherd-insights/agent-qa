import { expect, test } from 'vitest'
import type { ActionAnnotation, RunDetailSubAction } from '@vostride/agent-qa-schema'
import { frameAnnotation } from '../frame-annotation'

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
