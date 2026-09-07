import { expectTypeOf } from 'vitest'
import { DECISION_WEIGHTS, DECISION_HEADLINES } from '../decision-diff'
import type { ArmDecision, DecisionWeight, DecisionHeadline } from '../decision-diff'

// Closed vocabularies: projections cover every member, and no unlabelled alias is legal.
// prettier-ignore
expectTypeOf<DecisionWeight>().toEqualTypeOf<'gold' | 'near-gold' | 'silver' | 'unverified' | 'overturned'>()
// prettier-ignore
expectTypeOf<Exclude<DecisionWeight, (typeof DECISION_WEIGHTS)[number]>>().toEqualTypeOf<never>()
// prettier-ignore
expectTypeOf<Extract<DecisionWeight, 'unlabelled'>>().toEqualTypeOf<never>()
// prettier-ignore
expectTypeOf<Exclude<DecisionHeadline, (typeof DECISION_HEADLINES)[number]>>().toEqualTypeOf<never>()
// prettier-ignore
expectTypeOf<Extract<DecisionHeadline, 'unlabelled'>>().toEqualTypeOf<never>()
// prettier-ignore
expectTypeOf<keyof ArmDecision>().toEqualTypeOf<'cassetteId' | 'stepIndex' | 'decisionOrdinal' | 'origin' | 'entry' | 'label' | 'baseline' | 'candidate'>()
