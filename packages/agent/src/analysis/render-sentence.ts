// The ONE deterministic sentence renderer (Phase 389, D-05/D-06/D-08).
//
// Every surface that shows a verdict sentence — plan 07's CLI print, M5's run page, 392's
// chat — calls THIS function through the `analysis.get` op or directly, which is what makes
// SC3's "printed in CI and served through the function layer without a second code path"
// structural rather than a review rule. The renderer is a pure string composer in the
// `renderChainTerminalLine` idiom (cli post-run-tail): no fs, no model, no store — absence
// rendered as absence, never padded.
//
// Producer-keying (D-06) happens at AUTHORSHIP, and the renderer preserves it by composing
// typed parts identically whoever authored them: `analyze-run` parts, the deterministic
// template parts, and the honest root-cause-undetermined fallback all flow through this one
// rule, so sentence EXISTENCE never depends on LLM availability.

import type { Verdict, VerdictSentenceParts } from '@vostride/agent-qa-schema'

/**
 * The projection's key, spelled the way `run_test_outcomes` is keyed: stable test identity
 * is `(product, filePath, testName)` — NEVER `testId`, a per-run explicit id.
 */
export interface RecurrenceQuery {
  readonly product: string
  readonly filePath: string
  readonly testName: string
}

/** Typed recurrence data in ("Kth failure, window N"); the renderer turns it into prose. */
export interface RecurrenceAnswer {
  readonly kth: number
  readonly windowBuilds: number
}

/**
 * The D-08 recurrence seam: recurrence context is a LIVE join at render time, resolved per
 * call through this provider — never baked into authored parts and never stored as prose.
 *
 * 389 binds this seam to v51's derived run-outcome projection (`readTestOutcomeHistory` +
 * `failureRecurrence`, wired at the composition root in plan 06); 390 rebinds the SAME seam
 * to its fingerprint-window computation and appends the quarantine clause. The author's
 * prompt separately consumes failure history as input-for-REASONING (plan 03's forced
 * channel); this join is the rendered-CLAUSE — two different things by decision.
 *
 * `undefined` means the provider has no history for this identity; the renderer answers
 * with an explicit no-history clause, so obligation c is always rendered, honestly.
 */
export interface RecurrenceProvider {
  failureRecurrence(query: RecurrenceQuery): RecurrenceAnswer | undefined
}

/** Between-segment separator; segment MARKERS (`observed`, `next:`, `see:`) do the locating. */
const SENTENCE_SEPARATOR = ' — '

/**
 * Obligation a: the verbatim grounding quote with its ref. The `test-outcome` arm is the
 * typed alternative for zero-step failures — never a fabricated stepIndex.
 */
function groundingSegment(quote: VerdictSentenceParts['groundingQuote']): string {
  return 'stepIndex' in quote
    ? `observed (step ${quote.stepIndex}): "${quote.quote}"`
    : `observed (test outcome): "${quote.quote}"`
}

/**
 * Obligation c, always present: live data becomes prose, and every absence is an EXPLICIT
 * clause rather than a dropped segment — a sentence whose recurrence section silently
 * vanished would read as "no history" without ever saying so.
 */
function recurrenceClause(answer: RecurrenceAnswer | undefined): string {
  if (answer === undefined || answer.windowBuilds === 0) {
    return 'no failure history is recorded for this test'
  }
  if (answer.kth === 0) {
    return `no prior failure of this test is recorded in the last ${answer.windowBuilds} builds`
  }
  return `failure ${answer.kth} of this test in the last ${answer.windowBuilds} builds`
}

/**
 * Compose one verdict's sentence from its typed parts (D-05).
 *
 * Fixed order: resolved-class frame, the quoted grounding observation with its step ref,
 * the discriminator, the recurrence clause (joined LIVE through `provider`), the
 * recommended next action, and the `agentqa://` links (rendered verbatim from
 * `parts.links`, already codec-validated at the artifact boundary; an empty list renders
 * no see-section). Byte-deterministic: the same (verdict, parts, provider answer) yields
 * the same string in every process.
 */
export function renderVerdictSentence(
  verdict: Verdict,
  parts: VerdictSentenceParts,
  provider: RecurrenceProvider | undefined,
  query: RecurrenceQuery,
): string {
  const answer = provider?.failureRecurrence(query)
  const segments = [
    `${verdict.class}: ${groundingSegment(parts.groundingQuote)}`,
    parts.discriminator,
    recurrenceClause(answer),
    `next: ${parts.nextAction}`,
    ...(parts.links.length === 0 ? [] : [`see: ${parts.links.join(', ')}`]),
  ]
  return segments.join(SENTENCE_SEPARATOR)
}
