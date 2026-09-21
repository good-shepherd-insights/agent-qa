import type { RunDetailSubAction } from '@vostride/agent-qa-schema'
import type { StepAnnotation } from './api'

/** Adapt recorded geometry without inferring coordinates from the planned target. */
export function frameAnnotation(sub: RunDetailSubAction | undefined): StepAnnotation | undefined {
  const annotation = sub?.result.annotation
  if (!annotation || !sub) return undefined
  const base = {
    type: sub.plannedAction.type,
    viewport: annotation.viewport,
    direction: annotation.direction,
    failureHighlight: annotation.failureHighlight,
  }
  switch (annotation.kind) {
    case 'point': return { ...base, clickPoint: annotation.point, boundingBox: annotation.point.boundingBox }
    case 'region': return { ...base, boundingBox: annotation.region.boundingBox }
    case 'path': return { ...base, startPoint: annotation.path.start, endPoint: annotation.path.end }
    case 'pinch': return { ...base, startPoint: annotation.pinch.center, pinchScale: annotation.pinch.scale > 1 ? 'out' : 'in' }
  }
}
