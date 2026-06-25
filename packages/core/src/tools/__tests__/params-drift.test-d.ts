import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import type {
  Fill,
  MobileAction,
  Ref,
  Scroll,
  SwipeByDirection,
  SwipeByPath,
  TabSelector,
  WaitFor,
  WebAction,
} from '@vostride/agent-qa-schema'
import {
  fillSchema,
  multiTapSchema,
  navigateSchema,
  pinchSchema,
  scrollSchema,
  swipeSchema,
  tabSchema,
  waitForSchema,
  webInspectSchema,
} from '../actions/index.js'

type WithoutElementDescription<T> = T extends unknown
  ? Omit<T, 'elementDescription'>
  : never

type WithActionType<Type extends string, T> = T extends unknown
  ? T & { type: Type }
  : never

type WithSchemaTabSelector<T> = T extends { action: 'switch' }
  ? Omit<T, 'index' | 'title' | 'url'> & TabSelector
  : T

type WithSchemaInspectTab<T> = T extends { tab?: unknown }
  ? Omit<T, 'tab'> & { tab?: TabSelector | undefined }
  : T

type ScrollParams = z.infer<typeof scrollSchema>
type SwipeParams = z.infer<typeof swipeSchema>
type WithSwipeCompanions<T> = T extends unknown
  ? T extends { start: { x: number, y: number }, end: { x: number, y: number } }
    ? T & { elementDescription?: string | undefined, coordSpace: 'viewport' | 'screen' }
    : T & { elementDescription?: string | undefined }
  : never
type SwipeParamsWithKnownCompanions = WithSwipeCompanions<SwipeByDirection | SwipeByPath>
type RegistryPinchAction = WithActionType<'pinch', WithoutElementDescription<z.infer<typeof pinchSchema>>>
type RegistryMultiTapAction = WithActionType<'multiTap', WithoutElementDescription<z.infer<typeof multiTapSchema>>>
type RegistryNavigateAction = WithActionType<'navigate', z.infer<typeof navigateSchema>>
type RegistryTabAction = WithActionType<'tab', WithSchemaTabSelector<z.infer<typeof tabSchema>>>
type RegistryWebInspectAction = WithActionType<'inspect', WithSchemaInspectTab<z.infer<typeof webInspectSchema>>>

expectTypeOf<z.infer<typeof fillSchema>['ref']>().toEqualTypeOf<Ref>()
expectTypeOf<ScrollParams['ref']>().toEqualTypeOf<Ref | undefined>()
expectTypeOf<SwipeParams['ref']>().toEqualTypeOf<Ref | undefined>()

expectTypeOf<WithoutElementDescription<z.infer<typeof fillSchema>>>().toEqualTypeOf<Fill>()
expectTypeOf<WithoutElementDescription<z.infer<typeof scrollSchema>>>().toEqualTypeOf<Scroll>()
expectTypeOf<z.infer<typeof waitForSchema>>().toEqualTypeOf<WaitFor>()
expectTypeOf<SwipeParams>().toMatchTypeOf<SwipeParamsWithKnownCompanions>()
expectTypeOf<SwipeParamsWithKnownCompanions>().toMatchTypeOf<SwipeParams>()
expectTypeOf<RegistryPinchAction>().toMatchTypeOf<Extract<MobileAction, { type: 'pinch' }>>()
expectTypeOf<Extract<MobileAction, { type: 'pinch' }>>().toMatchTypeOf<RegistryPinchAction>()
expectTypeOf<RegistryMultiTapAction>().toMatchTypeOf<Extract<MobileAction, { type: 'multiTap' }>>()
expectTypeOf<Extract<MobileAction, { type: 'multiTap' }>>().toMatchTypeOf<RegistryMultiTapAction>()
expectTypeOf<RegistryNavigateAction>().toMatchTypeOf<Extract<WebAction, { type: 'navigate' }>>()
expectTypeOf<Extract<WebAction, { type: 'navigate' }>>().toMatchTypeOf<RegistryNavigateAction>()
expectTypeOf<RegistryTabAction>().toMatchTypeOf<Extract<WebAction, { type: 'tab' }>>()
expectTypeOf<Extract<WebAction, { type: 'tab' }>>().toMatchTypeOf<RegistryTabAction>()
expectTypeOf<RegistryWebInspectAction>().toMatchTypeOf<Extract<WebAction, { type: 'inspect' }>>()
expectTypeOf<Extract<WebAction, { type: 'inspect' }>>().toMatchTypeOf<RegistryWebInspectAction>()
