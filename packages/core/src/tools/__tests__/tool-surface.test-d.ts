import { expectTypeOf } from 'vitest'
import type {
  AndroidAction,
  CommonAction,
  IosAction,
  MobileAction,
  WebAction,
} from '@vostride/agent-qa-schema'

expectTypeOf<AndroidAction>().toEqualTypeOf<never>()
expectTypeOf<IosAction>().toEqualTypeOf<never>()

expectTypeOf<Extract<WebAction, { type: 'click' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'doubleClick' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'rightClick' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'fill' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'select' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'hover' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'paste' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'copy' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'fileUpload' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'navigate' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'waitForUrl' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'tab' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'inspect' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'route' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'unroute' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'networkState' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'storageState' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'handleDialog' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'uniqueValue' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'focus' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'setCookies' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'setLocalStorage' }>>().not.toEqualTypeOf<never>()

expectTypeOf<Extract<MobileAction, { type: 'tap' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<MobileAction, { type: 'doubleTap' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<MobileAction, { type: 'multiTap' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<MobileAction, { type: 'tapCoordinate' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<MobileAction, { type: 'swipe' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<MobileAction, { type: 'longpress' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<MobileAction, { type: 'pinch' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<MobileAction, { type: 'drag' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<MobileAction, { type: 'nativeSelect' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<MobileAction, { type: 'fill' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<MobileAction, { type: 'hideKeyboard' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<MobileAction, { type: 'setOrientation' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<MobileAction, { type: 'launchApp' }>>().toEqualTypeOf<never>()
expectTypeOf<Extract<MobileAction, { type: 'stopApp' }>>().not.toEqualTypeOf<never>()

expectTypeOf<Extract<CommonAction, { type: 'assertAI' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<CommonAction, { type: 'assertValue' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<CommonAction, { type: 'extractAI' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<CommonAction, { type: 'assert' }>>().toEqualTypeOf<never>()
expectTypeOf<Extract<CommonAction, { type: 'reportValue' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<CommonAction, { type: 'openApp' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<CommonAction, { type: 'waitFor' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<CommonAction, { type: 'delay' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<CommonAction, { type: 'scroll' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<CommonAction, { type: 'clearText' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<CommonAction, { type: 'openLink' }>>().toEqualTypeOf<never>()
expectTypeOf<Extract<CommonAction, { type: 'executeScript' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<CommonAction, { type: 'setVariable' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<CommonAction, { type: 'keypress' }>>().not.toEqualTypeOf<never>()

expectTypeOf<Extract<MobileAction, { type: 'click' }>>().toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'tap' }>>().toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'keypress' }>>().toEqualTypeOf<never>()
expectTypeOf<Extract<CommonAction, { type: 'click' }>>().toEqualTypeOf<never>()
