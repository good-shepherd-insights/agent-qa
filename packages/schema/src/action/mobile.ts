import type { Point } from '../primitives/point'
import type { Ref } from '../primitives/ref'
import type { NoPlatform, RefTargeted } from './shared'

type MobileRefTargeted = RefTargeted & { ref: Ref }

export type MobileAction = NoPlatform & (
  | ({ type: 'tap' } & MobileRefTargeted)
  | ({ type: 'doubleTap' } & MobileRefTargeted)
  | { type: 'multiTap'; fingers: number; ref?: Ref; point?: Point }
  | { type: 'tapCoordinate'; point: Point }
  | {
      type: 'swipe'
      direction: 'up' | 'down' | 'left' | 'right'
      ref?: Ref
      start?: Point
      end?: Point
      duration?: number
    }
  | ({ type: 'longpress'; duration?: number } & MobileRefTargeted)
  | { type: 'pinch'; scale: number; ref?: Ref; point?: Point }
  | { type: 'drag'; fromRef: Ref; toRef: Ref }
  | { type: 'hideKeyboard' }
  | { type: 'setOrientation'; orientation: 'portrait' | 'landscape' }
  | { type: 'launchApp'; bundleId: string }
  | { type: 'stopApp'; bundleId: string }
)
