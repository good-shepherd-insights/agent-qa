import type { CrossPlatformAction, MobileAction, Platform, WebAction } from './index'

export type ActionsFor<P extends Platform> = P extends 'web'
  ? WebAction | CrossPlatformAction
  : MobileAction | CrossPlatformAction

export type ActionExecutor<P extends Platform> = (action: ActionsFor<P>) => unknown
