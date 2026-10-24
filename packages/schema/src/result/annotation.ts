import type { BoundingBox } from '../primitives/bounding-box'
import type { Point } from '../primitives/point'
import type { Viewport } from '../primitives/viewport'

/** An execution interval on the recorded page, in media milliseconds. No URLs or page IDs. */
export interface RecordingAnnotationWitness {
  startMs: number
  endMs: number
  scene: 'recorded-page'
  transform: 'identity'
  width: number
  height: number
}

export function validRecordingAnnotation(witness: RecordingAnnotationWitness | undefined, viewport: Viewport): boolean {
  return !!witness && witness.scene === 'recorded-page' && witness.transform === 'identity'
    && [witness.startMs, witness.endMs, witness.width, witness.height].every(Number.isFinite)
    && witness.startMs >= 0 && witness.endMs > witness.startMs
    && witness.width > 0 && witness.height > 0
    && witness.width === viewport.width && witness.height === viewport.height
}

export interface ActionAnnotationBase {
  viewport: Viewport
  direction?: 'up' | 'down' | 'left' | 'right'
  failureHighlight?: BoundingBox
  recording?: RecordingAnnotationWitness
}

export type ActionAnnotation =
  | (ActionAnnotationBase & { kind: 'point'; point: Point & { boundingBox?: BoundingBox } })
  | (ActionAnnotationBase & { kind: 'path'; path: { start: Point; end: Point } })
  | (ActionAnnotationBase & { kind: 'pinch'; pinch: { center: Point; scale: number } })
  | (ActionAnnotationBase & { kind: 'region'; region: { boundingBox: BoundingBox } })

export function validRecordedAnnotation(annotation: ActionAnnotation): boolean {
  if (!validRecordingAnnotation(annotation.recording, annotation.viewport)) return false
  const point = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y)
    && p.x >= 0 && p.y >= 0 && p.x <= annotation.viewport.width && p.y <= annotation.viewport.height
  const box = (b: BoundingBox) => point(b) && Number.isFinite(b.width) && Number.isFinite(b.height)
    && b.width > 0 && b.height > 0 && b.x + b.width <= annotation.viewport.width
    && b.y + b.height <= annotation.viewport.height
  if (annotation.failureHighlight && !box(annotation.failureHighlight)) return false
  switch (annotation.kind) {
    case 'point': return point(annotation.point) && (!annotation.point.boundingBox || box(annotation.point.boundingBox))
    case 'path': return point(annotation.path.start) && point(annotation.path.end)
    case 'pinch': return point(annotation.pinch.center) && Number.isFinite(annotation.pinch.scale) && annotation.pinch.scale > 0
    case 'region': return box(annotation.region.boundingBox)
  }
}
