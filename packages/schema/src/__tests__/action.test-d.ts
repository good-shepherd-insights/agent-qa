import { expectTypeOf } from 'vitest'
import { asRef } from '../primitives/ref'
import type {
  Action,
  ActionExecutor,
  ActionsFor,
  AndroidAction,
  CommonAction,
  IosAction,
  MobileAction,
  Platform,
  Surface,
  WebAction,
} from '../index'

expectTypeOf<Surface>().toEqualTypeOf<'web' | 'mobile' | 'android' | 'ios' | 'common'>()
expectTypeOf<Platform>().toEqualTypeOf<'web' | 'android' | 'ios'>()

expectTypeOf<IosAction>().toEqualTypeOf<never>()

// Populated legs are mutually exclusive except `fill`, the sole documented shared verb;
// Phase 318 registry IDs and the Phase 322 lint enforce tool-level exclusivity.
type SharedWebMobileVerb = 'fill'
expectTypeOf<Extract<WebAction['type'], MobileAction['type']>>().toEqualTypeOf<SharedWebMobileVerb>()
expectTypeOf<
  Exclude<Extract<WebAction['type'], MobileAction['type']>, SharedWebMobileVerb>
>().toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction['type'], CommonAction['type']>>().toEqualTypeOf<never>()
expectTypeOf<Extract<MobileAction['type'], CommonAction['type']>>().toEqualTypeOf<never>()

// Closure is currently over web, mobile, and common; Android/iOS join in Phase 323.
type LegUnion =
  | WebAction['type']
  | MobileAction['type']
  | AndroidAction['type']
  | IosAction['type']
  | CommonAction['type']

expectTypeOf<Exclude<Action['type'], LegUnion>>().toEqualTypeOf<never>()
expectTypeOf<Exclude<LegUnion, Action['type']>>().toEqualTypeOf<never>()

expectTypeOf<ActionsFor<'web'>>().toEqualTypeOf<WebAction | CommonAction>()
expectTypeOf<ActionsFor<'android'>>().toEqualTypeOf<MobileAction | AndroidAction | CommonAction>()
expectTypeOf<ActionsFor<'ios'>>().toEqualTypeOf<MobileAction | CommonAction>()

expectTypeOf<Extract<CommonAction, { type: 'keypress' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<MobileAction, { type: 'nativeSelect' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'keypress' }>>().toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'nativeSelect' }>>().toEqualTypeOf<never>()

expectTypeOf<Extract<WebAction, { type: 'fill' }>>().toEqualTypeOf<
  Extract<MobileAction, { type: 'fill' }>
>()
expectTypeOf<Extract<WebAction, { type: 'navigate' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'tab' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'inspect' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'route' }>>().toMatchTypeOf<{
  type: 'route'
  urlPattern: string
  headers?: Record<string, string>
  body?: string
  contentType?: string
}>()
expectTypeOf<Extract<WebAction, { type: 'unroute' }>>().toMatchTypeOf<{
  type: 'unroute'
  urlPattern?: string
}>()
expectTypeOf<Extract<WebAction, { type: 'networkState'; mode: 'offline' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'networkState'; mode: 'throttle' }>>().toMatchTypeOf<{
  type: 'networkState'
  mode: 'throttle'
  latencyMs: number
  downloadKbps: number
  uploadKbps: number
}>()
expectTypeOf<Extract<WebAction, { type: 'storageState'; op: 'save' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'storageState'; op: 'restore' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebAction, { type: 'handleDialog' }>>().toMatchTypeOf<{
  type: 'handleDialog'
  accept: boolean
  promptText?: string
}>()
expectTypeOf<Extract<WebAction, { type: 'uniqueValue' }>>().toMatchTypeOf<{
  type: 'uniqueValue'
  prefix: string
}>()
type WebFocus = Extract<WebAction, { type: 'focus' }>
expectTypeOf<WebFocus>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<WebFocus, { text: string }>>().toEqualTypeOf<never>()

expectTypeOf<Extract<AndroidAction, { type: 'pressBack' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<AndroidAction, { type: 'pressHome' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<AndroidAction, { type: 'pressRecent' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<AndroidAction, { type: 'openNotifications' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<AndroidAction, { type: 'openQuickSettings' }>>().not.toEqualTypeOf<never>()
type AndroidIntent = Extract<AndroidAction, { type: 'intent' }>
expectTypeOf<AndroidIntent>().toMatchTypeOf<{
  type: 'intent'
  action: string
  data?: string
  packageName?: string
  extras?: Array<{
    key: string
    type: 'string' | 'int' | 'long' | 'float' | 'bool'
    value: string
  }>
}>()
expectTypeOf<Extract<AndroidAction, { type: 'keyevent' }>>().toMatchTypeOf<{
  type: 'keyevent'
  keycode: string
}>()
expectTypeOf<Extract<CommonAction, { type: 'keypress' }>>().toMatchTypeOf<{
  type: 'keypress'
  keys: string[]
  mode: 'press' | 'down' | 'up'
}>()

type CommonAssertAI = Extract<CommonAction, { type: 'assertAI' }>
expectTypeOf<CommonAssertAI>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<CommonAction, { type: 'assertValue' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<CommonAction, { type: 'extractAI' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<CommonAction, { type: 'assert' }>>().toEqualTypeOf<never>()
expectTypeOf<CommonAssertAI>().toMatchTypeOf<{
  type: 'assertAI'
  claim: string
  mode: 'multimodal' | 'visual' | 'text'
  effort: 'low' | 'medium' | 'high'
  consensus: number
}>()
expectTypeOf<Extract<CommonAction, { type: 'reportValue' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<CommonAction, { type: 'openApp' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<CommonAction, { type: 'openLink' }>>().toEqualTypeOf<never>()
expectTypeOf<Extract<CommonAction, { type: 'executeScript' }>>().not.toEqualTypeOf<never>()
expectTypeOf<Extract<MobileAction, { type: 'launchApp' }>>().toEqualTypeOf<never>()
expectTypeOf<Extract<MobileAction, { type: 'stopApp' }>>().not.toEqualTypeOf<never>()

const webExec = (((_: never) => {}) as unknown) as ActionExecutor<'web'>
webExec({ type: 'click', ref: asRef('e1') })
webExec({ type: 'delay', ms: 10 })

// @ts-expect-error tap is a MobileAction and is illegal on a web executor.
webExec({ type: 'tap', ref: asRef('e1') })

const mobileExec = (((_: never) => {}) as unknown) as ActionExecutor<'android'>
mobileExec({ type: 'tap', ref: asRef('e1') })
mobileExec({ type: 'pressBack' })
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

const tabByIndex: Action = { type: 'tab', action: 'switch', index: 0 }

// @ts-expect-error empty tab selectors are guaranteed to fail.
const emptyTab: Action = { type: 'tab', action: 'switch' }

const twoFingerTap: Action = { type: 'multiTap', fingers: 2, ref: asRef('e3') }
const threeFingerTap: Action = { type: 'multiTap', fingers: 3, x: 10, y: 20, coordSpace: 'viewport' }

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
