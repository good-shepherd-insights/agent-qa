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

// Phase 321 brands core `ref` schemas; delete DeBrand once refs infer as Ref.
type DeBrand<T> = T extends Ref
  ? string
  : T extends object
    ? { [K in keyof T]: DeBrand<T[K]> }
    : T

expectTypeOf<z.infer<typeof fillSchema>>().toEqualTypeOf<DeBrand<Fill>>()
expectTypeOf<z.infer<typeof scrollSchema>>().toEqualTypeOf<DeBrand<Scroll>>()
expectTypeOf<z.infer<typeof waitForSchema>>().toEqualTypeOf<DeBrand<WaitFor>>()
expectTypeOf<z.infer<typeof swipeSchema>>().toEqualTypeOf<DeBrand<SwipeByDirection | SwipeByPath>>()
