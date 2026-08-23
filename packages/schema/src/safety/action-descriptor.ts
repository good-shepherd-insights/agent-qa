import type { RiskTier } from './risk-tier'
import type { Surface } from '../action'

/**
 * Neutral, browser-safe descriptor the static risk classifier consumes.
 * Core, chat, skill, and shell actions project into this schema-owned shape.
 */
export interface RiskActionDescriptor {
  /** Action verb/id, e.g. 'web_navigate', 'git_push', or 'trigger_cloud_run'. */
  name: string
  /** True when the action is a known or registered action. */
  recognized: boolean
  /** Optional originating surface, when known. */
  surface?: Surface
  /** Advisory "has a side effect" hint, not the destructive risk tier. */
  destructive?: boolean
  /** Advisory read-only hint. */
  readOnly?: boolean
  /** Explicit static command payload for shell-style wrappers. */
  command?: string
  /** Explicit tier declaration; later classifier signals may raise this floor. */
  declaredTier?: RiskTier
  /**
   * A per-invocation DISCLOSURE for the person the confirm prompt reaches (394-08, D-03 · WTST-08).
   *
   * WHY THE DESCRIPTOR NEEDED A FIELD AT ALL. Every other member here is a static property of the
   * action CLASS, and that is exactly right for classification. WTST-08's control is not a class
   * property: it is what THIS invocation is about to cost, and a person asked to approve nine child
   * processes needs to be told nine. There was no channel for that, so a confirm could only ever
   * name the class — which is why the field exists rather than a friendlier prompt string.
   *
   * DISPLAY-ONLY, AND NEVER CLASSIFIED. `classifyRisk` reads `name`, `command`, `recognized`,
   * `readOnly` and `declaredTier`, and it must never read this. A free-text field feeding the tier
   * decision would be a channel through which whatever composed the disclosure could move an action
   * up or down the ladder. It is likewise not part of the action CLASS: a standing grant matches on
   * `name`, the audit row records `name`, and the session deny overlay keys on `name`, so two
   * invocations with different disclosures are the same class to every one of them.
   *
   * COMPOSITION-DERIVED, NEVER CALLER INPUT. What a caller may put in front of a person at the
   * moment they are deciding is a capability, not a convenience.
   */
  disclosure?: string
}


// ---- the field's ENFORCEMENT, beside the field's law (401-15, WR-01 / T-401-G5 / T-401-G6) -----
//
// WHY IT LIVES HERE AND NOT AT A WRITER. The `disclosure` above states a rule — composition-derived,
// never caller input — and until this plan the rule had no enforcement anywhere. Both compositions
// that fill the field interpolate text they do not own: the run gate's preview carries a target
// name straight out of a `.yaml` document (`TestDefinitionSchema.target` is a bare `z.string()`),
// and `invoke.ts` hands the field whatever `FunctionSpec.disclose` composed from parsed caller
// input. The string then lands on the line directly above a `[y/N]` prompt AND is rendered into a
// browser as a confirm preview.
//
// THE WRITER IS THE WRONG PLACE, MEASURED. `writeDisclosure` is the TTY channel only; the browser
// channel never passes through it. Hygiene at the writer would leave the second channel open, so
// the scrub is applied where the string is BUILT and this module is where the rule it enforces is
// written down. The 401 verifier also measured both production doors closed today by an unrelated
// throw in the product preflight — an incidental guard that does not know it is one, and is
// explicitly NOT ratified as the guard.
//
// PURE, SYNCHRONOUS, DEPENDENCY-FREE. `packages/schema` is browser-safe with zero internal
// dependencies and may take none; everything below is string work.

/**
 * What a scrubbed control character leaves behind.
 *
 * REPLACED, NEVER DROPPED. A deleted control byte turns a hostile name into one that reads like an
 * ordinary name — the attack succeeds at looking innocent. A visible replacement leaves a name that
 * reads as odd, which is the outcome a person can act on.
 */
export const DISCLOSURE_REPLACEMENT_CHARACTER = '\uFFFD'

/** The mark a truncated fragment ends with, so shortening is visible rather than silent. */
export const DISCLOSURE_TRUNCATION_MARK = '…'

/** How much of one untrusted fragment survives into the sentence. */
export const DISCLOSURE_FRAGMENT_MAX_LENGTH = 48

/**
 * Everything a terminal or a browser ACTS on rather than draws.
 *
 * C0 (\u0000-\u001F) and C1 (\u007F-\u009F) cover the newline that adds a line, the carriage return
 * that redraws one, and the ESC that introduces every CSI sequence — including the erase-line and
 * cursor-up pair that overwrites the line above without adding anything.
 *
 * The four beyond the control ranges are line/paragraph separators and the bidi overrides: \u2028
 * and \u2029 break lines in a browser exactly as \u000A does in a terminal, and \u202A-\u202E /
 * \u2066-\u2069 reorder what a reader sees without changing a byte of what they are approving.
 */
const DISCLOSURE_UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g

/**
 * Make one untrusted fragment safe to interpolate into a single line of a security prompt.
 *
 * THREE THINGS, AND EACH ONE IS A SEPARATE ATTACK CLOSED:
 * - control bytes replaced, so no fragment can add, erase or reorder a line;
 * - a length cap with a visible mark, so no fragment can consume the sentence it sits in;
 * - quoting, so where the fragment ENDS is legible — an odd name reads as odd rather than as prose
 *   the product wrote.
 *
 * IT IS NOT AN ESCAPER AND MUST NOT BECOME ONE. The output is for a person to read, not for a shell
 * or a parser to consume. Nothing here promises round-tripping; a scrubbed name is a rendering.
 */
export function scrubDisclosureFragment(fragment: string): string {
  const flattened = fragment.replace(DISCLOSURE_UNSAFE, DISCLOSURE_REPLACEMENT_CHARACTER)
  const capped = flattened.length > DISCLOSURE_FRAGMENT_MAX_LENGTH
    ? `${flattened.slice(0, DISCLOSURE_FRAGMENT_MAX_LENGTH)}${DISCLOSURE_TRUNCATION_MARK}`
    : flattened
  return `"${capped}"`
}

/** How much of a whole composed disclosure line survives. */
export const DISCLOSURE_TEXT_MAX_LENGTH = 512

/**
 * The same hygiene for a WHOLE composed disclosure, where the composition owns the prose.
 *
 * SEPARATE FROM THE FRAGMENT FORM BECAUSE THE INPUT IS A DIFFERENT SHAPE. A fragment is a noun the
 * sentence interpolates and quoting it is exactly right; a `FunctionSpec.disclose` return is the
 * whole sentence, and wrapping it in quotes would render every op's prompt as a quotation. What
 * both share is the rule that actually matters — no byte on this channel may act on the channel.
 *
 * THE CAP IS GENEROUS AND STILL A CAP. An op composes its own prose, so the realistic risk is an
 * unbounded caller-derived substring rather than a long sentence; a bound that no honest disclosure
 * reaches still removes "unbounded" from what a caller controls.
 */
export function scrubDisclosureText(text: string): string {
  const flattened = text.replace(DISCLOSURE_UNSAFE, DISCLOSURE_REPLACEMENT_CHARACTER)
  return flattened.length > DISCLOSURE_TEXT_MAX_LENGTH
    ? `${flattened.slice(0, DISCLOSURE_TEXT_MAX_LENGTH)}${DISCLOSURE_TRUNCATION_MARK}`
    : flattened
}
