import type { AndroidAction, CommonAction, IosAction, MobileAction, Platform, WebAction } from './index'

export type ActionsFor<P extends Platform> = P extends 'web'
  ? WebAction | CommonAction
  : P extends 'android'
    ? MobileAction | AndroidAction | CommonAction
    : MobileAction | IosAction | CommonAction

export type ActionExecutor<P extends Platform> = (action: ActionsFor<P>) => unknown
