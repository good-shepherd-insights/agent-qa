import type { Point } from '../primitives/point'
import type { Ref } from '../primitives/ref'
import type { NoPlatform, RefTargeted } from './shared'

type MobileRefTargeted = RefTargeted & { ref: Ref }

type SwipeBase = {
  type: 'swipe'
  direction: 'up' | 'down' | 'left' | 'right'
  ref?: Ref
  duration?: number
}

type SwipeByDirection = SwipeBase & { start?: never; end?: never }
type SwipeByPath = SwipeBase & { start: Point; end: Point }

export type MobileAction = NoPlatform & (
  | ({ type: 'tap' } & MobileRefTargeted)
  | ({ type: 'doubleTap' } & MobileRefTargeted)
  | { type: 'multiTap'; fingers: 2 | 3; ref?: Ref; point?: Point }
  | { type: 'tapCoordinate'; point: Point }
  | SwipeByDirection
  | SwipeByPath
  | ({ type: 'longpress'; duration?: number } & MobileRefTargeted)
  | { type: 'pinch'; scale: number; ref?: Ref; point?: Point }
  | { type: 'drag'; fromRef: Ref; toRef: Ref }
  | { type: 'hideKeyboard' }
  | { type: 'setOrientation'; orientation: 'portrait' | 'landscape' }
  | { type: 'launchApp'; bundleId: string }
  | { type: 'stopApp'; bundleId: string }
)
