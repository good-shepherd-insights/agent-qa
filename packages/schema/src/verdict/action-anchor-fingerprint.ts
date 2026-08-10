// The action-anchor fingerprint: gate 3's v1 coverage recipe (Phase 393, D-13).
//
// A SIBLING of `failure-fingerprint.ts`, never an extension of it. That file is FROZEN
// (389 D-13) because 390's recurrence windows key off its bytes; this one answers a different
// question — what surface does a test EXERCISE, rather than how did it FAIL — and the two must
// be free to move independently. What they share is their building blocks: `normalizeAnchor`
// and `canonicalJson`, imported here rather than re-derived, so "near-same anchors are the
// same anchor" has exactly one definition in the codebase.
//
// THE RECIPE (contract, not implementation detail):
//   1. An element is `{ kind, type, anchor }`, plus `route` only when the step carries one.
//      `kind` separates the two vocabularies: an action contributes its action type, an
//      assertion contributes its assert-kind. Asserting a value on a field and typing into it
//      are different coverage facts about the same anchor, so they must key apart.
//   2. The anchor passes through `normalizeAnchor` — the shape-locked contract that casefolds
//      roles, runs names through `normalizeAccessibleName`, and collapses route hashes and
//      trailing slashes. A route context is normalized through the SAME contract's page arm,
//      so `/Form.html/#thanks` and `/form.html` are one route here exactly as they are there.
//   3. The element is `canonicalJson` of that object — keys sorted, so a caller building the
//      input in a different order cannot mint a second key for the same fact. Readable rather
//      than hashed, matching the frozen sibling: a receipt NAMES the uncovered element (D-14),
//      and a reader owed an explanation should be able to see what the key says.
//
// SET SEMANTICS LIVE AT THE CONSUMER. Gate 3's value test is "at least one element absent from
// the union of the suite's elements" (D-14, spec §6.3 verbatim) — no similarity threshold, no
// magic constant. This module mints elements and preserves order; it deliberately does NOT
// deduplicate, because the sequence is what a later §4.1 enrichment builds on.

import { canonicalJson } from '../determinism/canonical-json'
import type { Anchor } from '../identity/anchor'
import { normalizeAnchor } from '../identity/normalize-anchor'

/**
 * The recipe version. Bumping it RE-KEYS every accumulated fingerprint: the derived suite
 * table has to refold, and receipts already citing uncovered elements no longer line up with
 * what the table holds, so accrued coverage comparison resets. That is the costly-reversibility
 * note in D-13, and it is the reason the goldens in `__tests__` exist.
 */
export const ACTION_ANCHOR_FINGERPRINT_VERSION = 1

/** One exercised step, reduced to what coverage cares about. */
export interface ActionAnchorElementInput {
  /** Which vocabulary `type` is drawn from: an action type, or an assert-kind. */
  readonly kind: 'action' | 'assert'
  /** The action type (`click`, `fill`, …) or the assert-kind (`assertValue`, `assertAI`, …). */
  readonly type: string
  /** The step's target, in the frozen anchor union `normalizeAnchor` accepts. */
  readonly anchor: Anchor
  /** Route the step carried, where it carried one. Absent means no route context. */
  readonly route?: string
}

/**
 * Normalize a route through the frozen anchor contract's page arm.
 *
 * `normalizeRoute` is private to `normalize-anchor.ts` and stays that way — reaching it through
 * the public `normalizeAnchor` reuses the contract instead of copying its body, which is what
 * keeps route normalization single-sourced when 377-era extensions move it.
 */
function normalizedRoute(route: string): string {
  const normalized = normalizeAnchor({ t: 'page', route })
  return normalized.t === 'page' ? normalized.route : route
}

/**
 * One fingerprint element (D-13). Pure, total, and byte-stable across processes: every step of
 * the recipe is a pure function of its arguments.
 */
export function actionAnchorElement(input: ActionAnchorElementInput): string {
  const base = {
    kind: input.kind,
    type: input.type,
    anchor: normalizeAnchor(input.anchor),
  }
  return canonicalJson(
    input.route === undefined ? base : { ...base, route: normalizedRoute(input.route) },
  )
}

/**
 * The ordered element sequence for one test (D-13).
 *
 * Order and repeats are preserved deliberately — see the SET SEMANTICS note above.
 */
export function actionAnchorSequence(
  inputs: readonly ActionAnchorElementInput[],
): string[] {
  return inputs.map((input) => actionAnchorElement(input))
}
