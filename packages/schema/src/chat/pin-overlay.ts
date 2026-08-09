// The `/pin` session deny overlay (Phase 392, D-21).
//
// TIGHTEN-ONLY BY TYPE, not by convention. The overlay carries one field and it is a DENY list —
// there is no allow member, so "a pin loosened something" is not a state this type can represent.
// That matters because the alternative design (a general override map) would make the tighten-only
// rule a runtime check somebody could get wrong, and the thing it protects is the gate ladder.
//
// A GRANT STILL NEVER OVERRIDES A DENY (execution-safety §2.4), and this overlay composes with
// that rather than replacing it: the gate consults the pin after classification, so a pinned class
// lands an ordinary audit row on refusal instead of vanishing pre-gate the way `invokeFunction`'s
// own early refusals do (`invoke.ts:17-19`).
//
// THE SPELLING IS THE `fn:`-PREFIXED RISK NAME, and this is the trap 391-05 measured rather than a
// style preference. Every registered op declares `risk.name` as `fn:<id>`, so an overlay recorded
// against the bare op id matches NOTHING — a pin that a person watched being accepted and that
// then silently denies nothing at all. The predicate below compares the same bytes the gate sees.
//
// It dies with the session (D-21). Nothing here persists: a pin is a statement about this
// conversation, and a durable one would be a standing DENIAL nobody has a verb to revoke.

/** The session-scoped deny overlay a turn hands the gate. */
export interface ChatPinOverlay {
  /** Action classes in the `fn:`-prefixed risk-name spelling. See the module head. */
  readonly deniedActionClasses: readonly string[]
}

/**
 * Does this overlay deny that action class?
 *
 * PURE and total, so both consumers — plan 05's gate hook and plan 08's `/pin` verb — ask the
 * question through one function. Exact string equality rather than prefix or pattern matching: a
 * pattern would let one typed pin deny a family a person never named, which is the opposite of
 * the deliberate, visible tightening D-21 describes.
 */
export function pinDenies(overlay: ChatPinOverlay, riskName: string): boolean {
  return overlay.deniedActionClasses.includes(riskName)
}
