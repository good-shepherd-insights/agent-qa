import type { Point } from '../primitives/point'
import type { Ref } from '../primitives/ref'
import type { Fill, SwipeByDirection, SwipeByPath } from './params'
import type { NoPlatform, RefTargeted } from './shared'

type MobileRefTargeted = RefTargeted & { ref: Ref }

export type MobileAction = NoPlatform & (
  | ({ type: 'tap' } & MobileRefTargeted)
  | ({ type: 'doubleTap' } & MobileRefTargeted)
  | { type: 'multiTap'; fingers: 2 | 3; ref: Ref }
  | { type: 'multiTap'; fingers: 2 | 3; x: number; y: number; coordSpace: 'viewport' | 'content' | 'screen' }
  | { type: 'tapCoordinate'; point: Point }
  | SwipeByDirection
  | SwipeByPath
  | ({ type: 'longpress'; duration?: number } & MobileRefTargeted)
  | { type: 'pinch'; scale: number; ref: Ref }
  | { type: 'pinch'; scale: number; x: number; y: number; coordSpace: 'viewport' | 'content' | 'screen' }
  | { type: 'drag'; fromRef: Ref; toRef: Ref }
  | ({ type: 'nativeSelect'; value: string } & MobileRefTargeted)
  | ({ type: 'fill' } & Fill)
  | { type: 'hideKeyboard' }
  | { type: 'setOrientation'; orientation: 'portrait' | 'landscape' }
  | { type: 'launchApp'; bundleId: string }
  | { type: 'stopApp'; bundleId: string }
)
