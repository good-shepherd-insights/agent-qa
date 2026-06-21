import type { BoundingBox } from '../primitives/bounding-box'
import type { Point } from '../primitives/point'
import type { Viewport } from '../primitives/viewport'

export interface ActionAnnotationBase {
  viewport: Viewport
  direction?: 'up' | 'down' | 'left' | 'right'
  failureHighlight?: BoundingBox
}

export type ActionAnnotation =
  | (ActionAnnotationBase & { kind: 'point'; point: Point & { boundingBox?: BoundingBox } })
  | (ActionAnnotationBase & { kind: 'path'; path: { start: Point; end: Point } })
  | (ActionAnnotationBase & { kind: 'pinch'; pinch: { center: Point; scale: number } })
  | (ActionAnnotationBase & { kind: 'region'; region: { boundingBox: BoundingBox } })
