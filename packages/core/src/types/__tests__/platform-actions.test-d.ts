import { expectTypeOf } from 'vitest'
import { assertNever } from '@vostride/agent-qa-runner'
import type {
  AndroidAction,
  CommonAction,
  IosAction,
  MobileAction,
  Platform,
  WebAction,
} from '@vostride/agent-qa-schema'
import type { Action, ActionsFor, PlatformAdapter } from '@vostride/agent-qa-runner'

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
// Runtime-only verbs remain in platform.ts until M1 adapter reconciliation.
type RuntimeOnlyCommonVerbs = 'assert' | 'openLink'
type RuntimeOnlyMobileVerbs = 'launchApp'
type WebRuntimeVerbs = WebVerbs | LegacyFoldedWebVerbs | RuntimeOnlyCommonVerbs
type MobileVerbs = (MobileAction | AndroidAction | CommonAction)['type'] | RuntimeOnlyCommonVerbs | RuntimeOnlyMobileVerbs
type IosVerbs = (MobileAction | IosAction | CommonAction)['type'] | RuntimeOnlyCommonVerbs | RuntimeOnlyMobileVerbs

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
