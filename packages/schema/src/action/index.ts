import type { CrossPlatformAction } from './cross-platform'
import type { MobileAction } from './mobile'
import type { WebAction } from './web'

export type { CrossPlatformAction } from './cross-platform'
export type { MobileAction } from './mobile'
export type { RefTargeted, TabSelector } from './shared'
export type { WebAction } from './web'

export type Action = WebAction | MobileAction | CrossPlatformAction

export type Platform = 'web' | 'android' | 'ios'
