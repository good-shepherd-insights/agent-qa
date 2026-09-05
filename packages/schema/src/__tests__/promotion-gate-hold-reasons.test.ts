import { describe, expect, it } from 'vitest'
import { PROMOTION_GATE_HOLD_REASONS } from '../knowledge/promotion-gate'

/**
 * The runtime wall on the promotion-gate hold-reason vocabulary (414 D-14 / D-22, the v54 bar).
 * It pins `PROMOTION_GATE_HOLD_REASONS` — the authored projection of
 * `PromotionGateHoldReason` — against a literal list. The companion type-level bar
 * (`Exclude<PromotionGateHoldReason, (typeof PROMOTION_GATE_HOLD_REASONS)[number]>` is `never`)
 * lives in `promotion-gate.test-d.ts`; a member widened into this projection through a cast
 * satisfies the compiler, walks past that bar and REDs only here, by name. Both halves are
 * measured by hand-mutation — Plan 08's `scripts/414-split-mutation.sh`, legs S-06 (remove the
 * last member from the array) and S-07 (remove it from the union).
 *
 * WHY THIS EXISTS NOW rather than in Phase 416. `promotionHoldReason` is a persisted value in
 * knowledge-local commit outcomes and in CLI output, so the vocabulary is governed data. 414
 * puts the bar up while the vocabulary is twelve members long so that 416 (PROM-04) EXTENDS it
 * through the bar instead of creating the bar around an already-widened set.
 *
 * The import is RELATIVE, to `src`, not through the package entry: the mutation script edits
 * `src` and re-runs vitest without a dist rebuild, so a barrel import would measure stale bytes.
 */

describe('414 D-14/D-22 — the promotion-gate hold-reason vocabulary (v54 runtime wall)', () => {
  it('declares exactly the twelve promotion-gate hold reasons, in declaration order', () => {
    // Declaration order, not sorted: `PROMOTION_GATE_HOLD_REASONS` is an authored array, so the
    // order is part of what it claims. Listed rather than counted so the RED says WHAT joined or
    // left — a `.length` or a `toContain` sweep would go green on a swap and name nothing. The
    // twelve are hand-spelled INLINE, not hoisted, so the expectation and the literal cannot
    // drift apart and Plan 08's red-parser reads one expression.
    expect([...PROMOTION_GATE_HOLD_REASONS]).toEqual([
      'kind-excluded',
      'not-candidate',
      'window-closed',
      'withheld',
      'needs-enrichment',
      'evidence-incomplete',
      'no-confirmed-evidence',
      'no-element-observation',
      'missing-root-cause',
      'memory-off-anchor',
      'user-deprecated',
      'empty-gate-set',
    ])
  })
})
