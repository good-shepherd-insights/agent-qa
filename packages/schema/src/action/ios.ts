import type { Ref } from '../primitives/ref'
import type { NoPlatform } from './shared'

export type IosAction = NoPlatform & (
  | { type: 'pressButton'; button: 'home' | 'volumeUp' | 'action' }
  | { type: 'pickerSelect'; ref: Ref; value: string }
  | { type: 'pickerSelect'; ref: Ref; order: number }
  | { type: 'swipeFromEdge'; edge: 'left' | 'right' | 'top' | 'bottom' }
  | { type: 'openUniversalLink'; url: string; bundleId?: string }
)
