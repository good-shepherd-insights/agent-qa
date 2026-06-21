import { expectTypeOf } from 'vitest'
import { asRef } from '../primitives/ref'
import type {
  Action,
  ActionExecutor,
  ActionsFor,
  CrossPlatformAction,
  MobileAction,
  Platform,
  WebAction,
} from '../index'

type AllVerbs =
  | 'navigate'
  | 'refresh'
  | 'navigateHistory'
  | 'waitForUrl'
  | 'click'
  | 'doubleClick'
  | 'rightClick'
  | 'fill'
  | 'select'
  | 'nativeSelect'
  | 'hover'
  | 'keypress'
  | 'keyDown'
  | 'keyUp'
  | 'paste'
  | 'copy'
  | 'fileUpload'
  | 'newTab'
  | 'switchTab'
  | 'readConsoleLogs'
  | 'readNetworkLogs'
  | 'readCookies'
  | 'setCookies'
  | 'readLocalStorage'
  | 'setLocalStorage'
  | 'tap'
  | 'doubleTap'
  | 'multiTap'
  | 'tapCoordinate'
  | 'swipe'
  | 'longpress'
  | 'pinch'
  | 'drag'
  | 'hideKeyboard'
  | 'setOrientation'
  | 'launchApp'
  | 'stopApp'
  | 'assert'
  | 'waitFor'
  | 'delay'
  | 'scroll'
  | 'clearText'
  | 'openLink'
  | 'executeScript'
  | 'setVariable'

expectTypeOf<Action['type']>().toEqualTypeOf<AllVerbs>()

expectTypeOf<Extract<WebAction['type'], MobileAction['type']>>().toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction['type'], CrossPlatformAction['type']>>().toEqualTypeOf<never>()
expectTypeOf<Extract<MobileAction['type'], CrossPlatformAction['type']>>().toEqualTypeOf<never>()

expectTypeOf<Platform>().toEqualTypeOf<'web' | 'android' | 'ios'>()
expectTypeOf<ActionsFor<'web'>>().toEqualTypeOf<WebAction | CrossPlatformAction>()
expectTypeOf<ActionsFor<'android'>>().toEqualTypeOf<MobileAction | CrossPlatformAction>()
expectTypeOf<ActionsFor<'ios'>>().toEqualTypeOf<MobileAction | CrossPlatformAction>()

const webExec = (((_: never) => {}) as unknown) as ActionExecutor<'web'>
webExec({ type: 'click', ref: asRef('e1') })
webExec({ type: 'delay', ms: 10 })

// @ts-expect-error tap is a MobileAction and is illegal on a web executor.
webExec({ type: 'tap', ref: asRef('e1') })

const mobileExec = (((_: never) => {}) as unknown) as ActionExecutor<'android'>
mobileExec({ type: 'tap', ref: asRef('e1') })
mobileExec({ type: 'delay', ms: 10 })

// @ts-expect-error click is a WebAction and is illegal on a mobile executor.
mobileExec({ type: 'click', ref: asRef('e1') })

const valid: Action = { type: 'tap', ref: asRef('e1') }

// @ts-expect-error Action members carry no `platform` key.
const invalid: Action = { type: 'tap', platform: 'web', ref: asRef('e1') }

void valid
void invalid
