import { expectTypeOf, test } from 'vitest'
import { STEP_SIGNALS, type StepSignal } from '../evidence-counts'
import { EVIDENCE_SCOPES, type EvidenceScope } from '../../components/run-detail/evidence-scope-line'

test('C424-STEP-SIGNALS-EXACT', () => {
  type Expected = 'console' | 'network' | 'a11y'
  expectTypeOf<StepSignal>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof STEP_SIGNALS)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<StepSignal, (typeof STEP_SIGNALS)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<(typeof STEP_SIGNALS)[number], StepSignal>>().toEqualTypeOf<never>()
})

test('C424-EVIDENCE-SCOPES-EXACT', () => {
  type Expected = 'step' | 'sub-action'
  expectTypeOf<EvidenceScope>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof EVIDENCE_SCOPES)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<EvidenceScope, (typeof EVIDENCE_SCOPES)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<(typeof EVIDENCE_SCOPES)[number], EvidenceScope>>().toEqualTypeOf<never>()
})
