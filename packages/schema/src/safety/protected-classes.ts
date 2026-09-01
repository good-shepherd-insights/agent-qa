// The grant-ineligible (protected) action classes (Phase 391, D-05 / D-07).
//
// A closed, code-authored constant set: these action classes can never be covered by a standing
// approval, so the human is asked EVERY time. The set is consulted on both sides of the grant
// contract — the mint refuses to record a covering grant, and the read refuses to match one that
// somehow got into the ledger anyway — because a one-sided guard on a two-sided contract is a
// regression generator (388/390's measured lesson).
//
// WHY THIS IS A CONSTANT AND NOT CONFIG, stated where the temptation lives:
//
// A protected list you can edit at runtime protects nothing. The first thing an agent that wants
// to grant itself standing approval over the approval machinery would do is edit the list that
// says it may not — and it would be a config write, the very class of act this floor exists to
// keep behind a human. A config-sourced set is self-referentially mutable, which is the exact
// hole PROP-05 closes. Membership changes are code changes, they show up in a pull request, and
// that is the design rather than a limitation of it.
//
// WHY NO CLASSIFIER, stated for the same reason (D-07): the standing floor IS the rule. "Don't
// change my auth" is honoured because auth-mutation classes are permanently ineligible and
// sovereign-ask, whether or not any model understood the sentence. No LLM ever mediates
// membership; there is nothing here for one to be wrong about.

/**
 * The closed grant-ineligible set, spelled ONCE (388 C13) and stored EXACTLY as the gate sees it.
 *
 * The `fn:`-prefixed form is load-bearing, not cosmetic: the policy gate compares
 * `grant.actionClass === action.name`, and a function op's action name is `fn:` followed by the op
 * id. A member spelled as the bare op id would parse, list, read as protection, and match nothing
 * — the silent-no-op failure the grant ledger's own note names about mints. A differential in
 * plan 05 asserts each spelling here equals the real op's `risk.name`, so this list cannot drift
 * away from the ops it protects without something going red.
 *
 * MEMBERSHIP TODAY — the approval-policy ops themselves, which is the self-reference D-06 closes:
 * a session that could grant itself standing approval over accepting proposals, or over revoking
 * the grants that constrain it, would have talked its way out of every other rule in one step.
 *
 * THE CLOSED MEMBERSHIP RULE, so later phases add to this list rather than arguing about it:
 *
 *  - Secrets and auth-mutation op classes join the moment such ops exist. 395's config surface
 *    brings the first of them; the rule is decided now so that phase adds a line here instead of
 *    re-deciding whether auth is grantable.
 *  - Nothing joins by inference, and nothing leaves without the pull request that removes it.
 */
export const PROTECTED_ACTION_CLASSES = ['fn:proposals.accept', 'fn:grants.revoke'] as const

export type ProtectedActionClass = (typeof PROTECTED_ACTION_CLASSES)[number]

const PROTECTED_ACTION_CLASS_SET: ReadonlySet<string> = new Set(PROTECTED_ACTION_CLASSES)

/**
 * True for exactly the closed set above.
 *
 * Takes `unknown` rather than `string` on purpose: one of its two call sites is the READ half,
 * where the value being tested came off a ledger line somebody could have hand-edited. A
 * signature that could only be called with a `string` would have pushed the cast to the caller
 * and put the fail-closed decision in the wrong place.
 */
export function isProtectedActionClass(value: unknown): value is ProtectedActionClass {
  return typeof value === 'string' && PROTECTED_ACTION_CLASS_SET.has(value)
}
