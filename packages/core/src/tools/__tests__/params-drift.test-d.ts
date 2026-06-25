import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import type {
  Fill,
  Ref,
  Scroll,
  SwipeByDirection,
  SwipeByPath,
  WaitFor,
} from '@vostride/agent-qa-schema'
import {
  fillSchema,
  scrollSchema,
  swipeSchema,
  waitForSchema,
} from '../actions/index.js'

type WithoutElementDescription<T> = T extends unknown
  ? Omit<T, 'elementDescription'>
  : never

type ScrollParams = z.infer<typeof scrollSchema>
type SwipeParams = z.infer<typeof swipeSchema>
type WithSwipeCompanions<T> = T extends unknown
  ? T extends { start: { x: number, y: number }, end: { x: number, y: number } }
    ? T & { elementDescription?: string | undefined, coordSpace: 'viewport' | 'screen' }
    : T & { elementDescription?: string | undefined }
  : never
type SwipeParamsWithKnownCompanions = WithSwipeCompanions<SwipeByDirection | SwipeByPath>

expectTypeOf<z.infer<typeof fillSchema>['ref']>().toEqualTypeOf<Ref>()
expectTypeOf<ScrollParams['ref']>().toEqualTypeOf<Ref | undefined>()
expectTypeOf<SwipeParams['ref']>().toEqualTypeOf<Ref | undefined>()

expectTypeOf<WithoutElementDescription<z.infer<typeof fillSchema>>>().toEqualTypeOf<Fill>()
expectTypeOf<WithoutElementDescription<z.infer<typeof scrollSchema>>>().toEqualTypeOf<Scroll>()
expectTypeOf<z.infer<typeof waitForSchema>>().toEqualTypeOf<WaitFor>()
expectTypeOf<SwipeParams>().toMatchTypeOf<SwipeParamsWithKnownCompanions>()
expectTypeOf<SwipeParamsWithKnownCompanions>().toMatchTypeOf<SwipeParams>()
