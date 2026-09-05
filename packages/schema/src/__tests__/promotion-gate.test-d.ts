import { expectTypeOf } from 'vitest'
import { PROMOTION_GATE_HOLD_REASONS } from '../knowledge/promotion-gate'
import type { PromotionGateHoldReason, PromotionGatePosture } from '../knowledge/promotion-gate'

/**
 * The type-level half of the v54 bar on the hold-reason vocabulary (414 D-14 / D-22). The
 * `satisfies` clause on `PROMOTION_GATE_HOLD_REASONS` already makes an ENTRY naming no member a
 * compile error; this file pins the reverse direction — a MEMBER the projection does not name.
 * The runtime cell that catches a cast-smuggled member lives in
 * `promotion-gate-hold-reasons.test.ts`.
 */
expectTypeOf<
  Exclude<PromotionGateHoldReason, (typeof PROMOTION_GATE_HOLD_REASONS)[number]>
>().toEqualTypeOf<never>()

/**
 * The stray spelling. `empty-gate-set` is the member `spec/v2/memory.md` §12.4(d) and the
 * `selectGateSet` verdict union both use; `gate-set-empty` is the transposition a later hand
 * could reach for. Pinning it `never` makes the wrong spelling a compile error rather than a
 * second, silently-persisted synonym.
 */
expectTypeOf<Extract<PromotionGateHoldReason, 'gate-set-empty'>>().toEqualTypeOf<never>()

/**
 * The posture is exactly two booleans in 414. Phase 416 (PROM-04) widens it, and this bar is
 * what makes that widening a deliberate edit here rather than a silent structural drift.
 */
expectTypeOf<keyof PromotionGatePosture>().toEqualTypeOf<
  'gateSetNonEmpty' | 'replayGateAvailable'
>()
