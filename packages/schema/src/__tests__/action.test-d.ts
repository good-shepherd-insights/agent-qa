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

const taggedTap = { type: 'tap' as const, platform: 'web' as const, ref: asRef('e2') }

// @ts-expect-error non-fresh values carrying forbidden platform metadata must not satisfy Action.
const invalidFromVariable: Action = taggedTap

// @ts-expect-error non-fresh values carrying forbidden platform metadata must not execute on mobile.
mobileExec(taggedTap)

const tabByIndex: Action = { type: 'switchTab', index: 0 }

// @ts-expect-error empty tab selectors are guaranteed to fail.
const emptyTab: Action = { type: 'switchTab' }

const twoFingerTap: Action = { type: 'multiTap', fingers: 2, ref: asRef('e3') }
const threeFingerTap: Action = { type: 'multiTap', fingers: 3, point: { x: 10, y: 20 } }

// @ts-expect-error unsupported finger counts are rejected.
const zeroFingerTap: Action = { type: 'multiTap', fingers: 0, ref: asRef('e3') }

// @ts-expect-error unsupported finger counts are rejected.
const oneFingerTap: Action = { type: 'multiTap', fingers: 1, ref: asRef('e3') }

// @ts-expect-error unsupported finger counts are rejected.
const manyFingerTap: Action = { type: 'multiTap', fingers: 99, ref: asRef('e3') }

const swipeStart = { x: 0, y: 0 }
const swipeEnd = { x: 10, y: 20 }
const directionSwipe: Action = { type: 'swipe', direction: 'up' }
const pathSwipe: Action = { type: 'swipe', direction: 'up', start: swipeStart, end: swipeEnd }

// @ts-expect-error half-specified swipe paths are rejected.
const swipeMissingEnd: Action = { type: 'swipe', direction: 'up', start: swipeStart }

// @ts-expect-error half-specified swipe paths are rejected.
const swipeMissingStart: Action = { type: 'swipe', direction: 'up', end: swipeEnd }

void valid
void invalid
void invalidFromVariable
void tabByIndex
void emptyTab
void twoFingerTap
void threeFingerTap
void zeroFingerTap
void oneFingerTap
void manyFingerTap
void directionSwipe
void pathSwipe
void swipeMissingEnd
void swipeMissingStart
