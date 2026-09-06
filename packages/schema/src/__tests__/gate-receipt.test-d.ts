import { expectTypeOf } from 'vitest'
// prettier-ignore
import { GATE_VERDICTS, GATE_NUMBERS, CROSS_CHECKS, DEGRADATIONS, BENEFITS, MARKS, STATE_VALIDITIES } from '../knowledge/gate-receipt'
// prettier-ignore
import type { GateVerdict, GateNumber, CrossCheck, Degradation, Benefit, Mark, StateValidity } from '../knowledge/gate-receipt'

/**
 * 2026-09-06, 416 D-02: the v54 reverse-membership bar, paired with the runtime cells.
 * Plan 06 G-13 measures src/__tests__/gate-receipt.test-d.ts:14:5; keep this first.
 */

expectTypeOf<
  Exclude<GateVerdict, (typeof GATE_VERDICTS)[number]>
>().toEqualTypeOf<never>()

expectTypeOf<Exclude<GateNumber, (typeof GATE_NUMBERS)[number]>>().toEqualTypeOf<never>()
expectTypeOf<Exclude<CrossCheck, (typeof CROSS_CHECKS)[number]>>().toEqualTypeOf<never>()
expectTypeOf<Exclude<Degradation, (typeof DEGRADATIONS)[number]>>().toEqualTypeOf<never>()
expectTypeOf<Exclude<Benefit, (typeof BENEFITS)[number]>>().toEqualTypeOf<never>()
expectTypeOf<Exclude<Mark, (typeof MARKS)[number]>>().toEqualTypeOf<never>()
expectTypeOf<Exclude<StateValidity, (typeof STATE_VALIDITIES)[number]>>().toEqualTypeOf<never>()
expectTypeOf<Extract<CrossCheck, 'not_run'>>().toEqualTypeOf<never>()
expectTypeOf<Extract<Mark, 'confirmed-defect'>>().toEqualTypeOf<never>()
