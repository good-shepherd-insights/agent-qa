import { expectTypeOf } from 'vitest'
import { PROMOTION_GATE_HOLD_REASONS, PROMOTION_PATHS } from '../knowledge/promotion-gate'
import type { PromotionGateHoldReason, PromotionGatePosture, ResolvedPromotionGatePosture, UnavailablePromotionGatePosture, PromotionPath } from '../knowledge/promotion-gate'

/**
 * The type-level half of the v54 bar on the hold-reason vocabulary (414 D-14 / D-22). The
 * `satisfies` clause on `PROMOTION_GATE_HOLD_REASONS` already makes an ENTRY naming no member a
 * compile error; this file pins the reverse direction — a MEMBER the projection does not name.
 * The runtime cell that catches a cast-smuggled member lives in
 * `promotion-gate-hold-reasons.test.ts`. 416 G-04 measured pin: promotion-gate.test-d.ts:37:74.
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
 * 416 D-09/D-12: resolved posture and refusal are distinct, exhaustively pinned arms.
 */
expectTypeOf<keyof ResolvedPromotionGatePosture>().toEqualTypeOf<
  'kind' | 'replayGateAvailable' | 'gateSetNonEmpty' | 'gateSetVerdict' | 'corpusDigest' |
  'minimumGateSet' | 'counts' | 'scope' | 'judge' | 'canary'
>()
expectTypeOf<keyof UnavailablePromotionGatePosture>().toEqualTypeOf<
  'kind' | 'replayGateAvailable' | 'refusals'
>()
expectTypeOf<PromotionGatePosture['kind']>().toEqualTypeOf<'resolved' | 'unavailable'>()

// 2026-09-06, 416 G-04: measured path never-bar diagnostic at promotion-gate.test-d.ts:37:74.
expectTypeOf<Exclude<PromotionPath, (typeof PROMOTION_PATHS)[number]>>().toEqualTypeOf<never>()
expectTypeOf<Extract<PromotionPath, 'gate1-and-gate2'>>().toEqualTypeOf<never>()
