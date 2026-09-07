import { expectTypeOf, test } from 'vitest'
import type { RunReplayGateInput } from '../replay-gate-composition.js'

test('the Gate 1 judge bag cannot carry a same-family override', () => {
  expectTypeOf<keyof NonNullable<RunReplayGateInput['judge']>>().toEqualTypeOf<
    'profile' | 'modelOverrides' | 'resolveAuth'
  >()
  expectTypeOf<
    Extract<keyof NonNullable<RunReplayGateInput['judge']>, 'allowSameFamily'>
  >().toEqualTypeOf<never>()
})
