import type { AndroidAction } from './android'
import type { CommonAction } from './common'
import type { IosAction } from './ios'
import type { MobileAction } from './mobile'
import type { WebAction } from './web'

export type { AndroidAction } from './android'
export type { CommonAction } from './common'
export type { IosAction } from './ios'
export type { MobileAction } from './mobile'
export type { RefTargeted, TabSelector } from './shared'
export type { WebAction } from './web'

export type Action = WebAction | MobileAction | AndroidAction | IosAction | CommonAction

export type Platform = 'web' | 'android' | 'ios'
export type Surface = 'web' | 'mobile' | 'android' | 'ios' | 'common'
