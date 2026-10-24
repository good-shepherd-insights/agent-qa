import { expectTypeOf, test } from 'vitest'
import type { RunReplayGateInput, RemovalFlipsOutcomeInput } from '../replay-gate-composition.js'
import type { CandidateInjection } from '@vostride/agent-qa-schema'

test('removal has exactly injected and opt-in served-canary active-record modes', () => {
  expectTypeOf<RemovalFlipsOutcomeInput['mode']>().toEqualTypeOf<
    { kind: 'injected'; injection: CandidateInjection } | { kind: 'active-record'; servedCanary?: true }
  >()
})

test('the Gate 1 judge bag cannot carry a same-family override', () => {
  expectTypeOf<keyof NonNullable<RunReplayGateInput['judge']>>().toEqualTypeOf<
    'profile' | 'modelOverrides' | 'resolveAuth'
  >()
  expectTypeOf<
    Extract<keyof NonNullable<RunReplayGateInput['judge']>, 'allowSameFamily'>
  >().toEqualTypeOf<never>()
})
