import type { Platform } from '../action/index'
import type { Ref } from '../primitives/ref'
import type { ElementBounds } from './element-bounds'
import type { ElementInfo } from './element-info'
import type { ScreenStateMetadata } from './metadata'

export interface ScreenState {
  platform: Platform
  tree: string
  elements: ElementInfo[]
  // Consumers re-keying Object.keys(refMap) must rebrand strings back to Ref.
  refMap: Record<Ref, ElementBounds>
  url?: string
  timestamp: number
  metadata: ScreenStateMetadata
}
