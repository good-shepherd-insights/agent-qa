import { expectTypeOf } from 'vitest'
import { assertNever } from '../platform.js'
import type {
  AndroidAction,
  CommonAction,
  IosAction,
  MobileAction,
  Platform,
  WebAction,
} from '@vostride/agent-qa-schema'
import type { Action, ActionsFor, PlatformAdapter } from '../platform.js'

type WebVerbs = (WebAction | CommonAction)['type']
type LegacyFoldedWebVerbs =
  | 'keyDown'
  | 'keyUp'
  | 'refresh'
  | 'navigateHistory'
  | 'readConsoleLogs'
  | 'readNetworkLogs'
  | 'readCookies'
  | 'readLocalStorage'
  | 'newTab'
  | 'switchTab'
type WebRuntimeVerbs = WebVerbs | LegacyFoldedWebVerbs
type MobileVerbs = (MobileAction | AndroidAction | CommonAction)['type']
type IosVerbs = (MobileAction | IosAction | CommonAction)['type']

expectTypeOf<ActionsFor<'web'>>().toEqualTypeOf<Extract<Action, { type: WebRuntimeVerbs }>>()
expectTypeOf<ActionsFor<'android'>>().toEqualTypeOf<Extract<Action, { type: MobileVerbs }>>()
expectTypeOf<ActionsFor<'ios'>>().toEqualTypeOf<Extract<Action, { type: IosVerbs }>>()
expectTypeOf<ActionsFor<Platform>>().toEqualTypeOf<Action>()

expectTypeOf<PlatformAdapter<'web'>['platform']>().toEqualTypeOf<'web'>()
expectTypeOf<Parameters<PlatformAdapter<'web'>['execute']>[0]>().toEqualTypeOf<ActionsFor<'web'>>()
expectTypeOf<Parameters<PlatformAdapter['execute']>[0]>().toEqualTypeOf<Action>()

const exhausted = undefined as never
assertNever(exhausted)

// @ts-expect-error assertNever only accepts already-exhausted values.
assertNever({ type: 'click', ref: 'button' })
