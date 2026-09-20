import { expectTypeOf, test } from 'vitest'
import { STEP_SIGNALS, type StepSignal } from '../evidence-counts'

test('C424-STEP-SIGNALS-EXACT', () => {
  type Expected = 'console' | 'network' | 'a11y'
  expectTypeOf<StepSignal>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof STEP_SIGNALS)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<StepSignal, (typeof STEP_SIGNALS)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<(typeof STEP_SIGNALS)[number], StepSignal>>().toEqualTypeOf<never>()
})
