// The honesty funnel: Meta's four stages over drafts that reached authoring (394, D-13/D-15).
//
// THE DENOMINATOR IS FROZEN, AND THE FREEZE IS THE FEATURE. WTST-05 compares this project's
// funnel against the published reference distribution — 75 built / 57 passed stably / 25 added
// value / 73 accepted — and a comparison against a shape that drifts is a comparison against
// nothing. So the four stages are a closed `as const` vocabulary, pinned by an exact key-set
// assertion in `__tests__/funnel.test-d.ts` and by a runtime census beside it, and changing which
// stages exist invalidates every recorded comparison rather than merely widening a type.
//
// THE ORDERED CONTRACT — which receipt field produces each count:
//
//   1. `built`         one per receipt in the window. A receipt exists exactly when a
//                      schema-valid draft was produced and evaluated.
//   2. `passedStably`  `gates.executesDefinitive.pass && gates.stableVerdict.pass` — gates 1+2.
//   3. `addedValue`    `gates.addsValue.pass` — gate 3.
//   4. `accepted`      an `applied` decision on a draft this window has a receipt for. The
//                      human decision (D-05: keep-eligible never auto-writes).
//
// GATE 4 IS NOT A STAGE. There are four gates and four stages and they are not the same four:
// `falsifiableAssertion` (gate 4) decides whether a draft asserts anything falsifiable, which is
// a property of the draft rather than a step on the way from intent to suite. A draft rejected on
// gate 4 alone still executed definitively, still ran stably and still added value, and counting
// it out of those stages would report the funnel narrowing where it did not.
//
// THE STAGES ARE INDEPENDENT COUNTS OVER ONE DENOMINATOR, NOT NESTED SUBSETS. D-04 forbids
// short-circuiting the gate evaluation — the corpus proves gate INDEPENDENCE, which is unprovable
// if evaluation stops at the first `false` — so a receipt can carry `addsValue.pass` while gate 1
// failed. `addedValue` therefore counts every receipt whose gate 3 passed, and may exceed
// `passedStably`. Re-basing each stage on the previous one would hide exactly the independence
// the gates were built to demonstrate.
//
// REFUSALS AND FINDINGS ARE NAMED SIDE COUNTERS, BESIDE THE FUNNEL AND NEVER FOLDED INTO A STAGE
// (D-15). A stage-2 dedup refusal is the loop WORKING — the intent was already covered and
// nothing was authored — so folding refusals into `built` and then into the filtered-out
// remainder would let working-as-intended refusals inflate the filter rate, and the resulting
// number could not be compared against the reference distribution at all. Findings are the same
// argument from the other end: an application defect found is not a draft filtered out.
//
// THE FLAG IS COMPUTED ON EXACT INTEGERS, NEVER ON THE ROUNDED PERCENTAGE THE RENDER SHOWS. The
// rendered percentage is a display concern computed separately and deliberately downstream of the
// decision: a keep rate of 90.4% displays as "90%" and MUST still flag, and reading the rounded
// value back is precisely how that gets silently lost. The comparison is the cross-multiplied
// integer one — `accepted * den > num * built` — on the shipped `ceilingExceeded` precedent.
//
// BOUNDARY DIRECTIONS, STATED AND PINNED. The ceiling comparison is STRICTLY GREATER: a rate
// exactly at the ceiling does not flag. The floor comparison is GREATER-OR-EQUAL: a draft count
// exactly at the floor admits the flag. Below the floor the rate renders with an explicit
// small-sample caveat and NEVER the flag.
//
// AN EMPTY WINDOW REPORTS AN ABSENT KEEP RATE, NOT 0%. `0/0` rendered as `0%` would report a loop
// that filtered perfectly when in fact nothing happened — a wrong answer wearing a correct one's
// clothes, about the one number this whole module exists to keep honest.

import { z } from 'zod'

import type { DraftReceipt } from './draft-receipt'

/**
 * The CLOSED, ORDERED four-stage vocabulary (D-15).
 *
 * Ordered because the funnel is read top to bottom and the reference distribution is quoted in
 * this order. Closed because a fifth member is a new denominator, not a new column.
 */
export const AUTHORING_FUNNEL_STAGES = [
  'built',
  'passedStably',
  'addedValue',
  'accepted',
] as const

export type AuthoringFunnelStage = (typeof AUTHORING_FUNNEL_STAGES)[number]

/**
 * The keep rate above which the loop is reported as failing to filter — 9/10 (D-13).
 *
 * A RATIONAL PAIR AND NOT A DECIMAL, on the shipped `MARK_UNHANDLED_CEILING` precedent and for
 * its stated reason: it is published so no consumer re-derives the comparison as a rounded
 * percentage. `0.9` beside it would be a second spelling of one number, free to be the one a
 * caller reaches for.
 *
 * RETUNE: moving this changes what "the loop is not filtering" MEANS, so a retune is a
 * measurement and not a preference. Before moving it, report: (a) the observed keep rate over at
 * least one full milestone of REAL sessions — not corpus runs, whose acceptances are scripted —
 * broken down by disposition, so a rate driven by `keep-eligible` drafts is distinguishable from
 * one driven by `proposal-only` ones; (b) that rate set beside the reference distribution's 73%
 * accepted (73 of 75 built), which is the number this ceiling was chosen against; and (c) which
 * side of the PROPOSED ceiling the observed rate falls on, stated explicitly — a retune that
 * lands the observed rate just under its own new ceiling is a ceiling chosen to be satisfied. A
 * ceiling argued from intuition is the failure this block exists to prevent.
 */
export const KEEP_RATE_CEILING = { num: 9, den: 10 } as const

/**
 * The fewest drafts a window must carry before the flag may be raised — 10 (D-13).
 *
 * RETUNE: a retune must report the FALSE-FLAG RATE at the current floor over real sessions —
 * how often a window of exactly 10..N drafts raised the acceptance-failure flag and a human
 * reading the drafts disagreed that the loop had stopped filtering. That number is what the
 * floor buys; a floor moved without it trades an unmeasured false-flag rate for an unmeasured
 * missed-flag rate. Report both directions: at a HIGHER floor, how many real windows would stop
 * being able to flag at all. A floor argued from intuition is the failure this block prevents.
 */
export const FUNNEL_MIN_DRAFTS_FLOOR = 10

/**
 * The counters that sit BESIDE the funnel (D-15). Never stages; see the header.
 *
 * `dedupRefusals` is OPTIONAL, and its absence is a true statement rather than a gap. A stage-2
 * refusal ends the invocation with nothing authored — no draft, no receipt, no gate-run and no
 * envelope (D-04) — so on a host where nothing durably records one, the honest answer is that it
 * is not recorded. Reporting `0` would say "no author was ever refused" about something nothing
 * counts, which is the same wrong answer the absent keep rate exists to refuse.
 */
export interface FunnelSideCounters {
  readonly dedupRefusals?: number
  readonly findings: number
}

/**
 * One human decision about one draft, addressed the way the receipts store addresses it.
 *
 * `contentDigest` and not a proposal id: the receipt's address IS `draftRef.contentDigest`, so
 * joining on anything else would need a second link to keep in step.
 */
export interface AuthoringAcceptance {
  readonly contentDigest: string
  readonly decision: 'applied' | 'rejected'
}

export interface AuthoringFunnelInput {
  /** The receipts in the window. This IS the denominator. */
  readonly receipts: readonly DraftReceipt[]
  /** Decisions taken on drafts; only `applied` ones for a digest in the window count. */
  readonly acceptances: readonly AuthoringAcceptance[]
  readonly sideCounters: FunnelSideCounters
  /**
   * Loop invocations the window covers, where the caller can count them.
   *
   * Receipts are addressed by content digest, so two byte-identical drafts collapse to ONE
   * receipt and one `built`. That is accepted rather than re-keyed — `receiptPath`'s recipe is
   * what `demo/init/scripts/drain-393-gates.sh` reads by — and it is DISCLOSED: when this number
   * exceeds the receipt count, the render carries the caveat rather than quietly under-reporting.
   */
  readonly invocationCount?: number
}

export const AuthoringFunnelSchema = z.object({
  stages: z.object({
    built: z.number().int().nonnegative(),
    passedStably: z.number().int().nonnegative(),
    addedValue: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
  }).strict(),
  sideCounters: z.object({
    dedupRefusals: z.number().int().nonnegative().optional(),
    findings: z.number().int().nonnegative(),
  }).strict(),
  /** The EXACT ratio, absent when nothing was built. Never the flag's input. */
  keepRate: z.number().min(0).max(1).optional(),
  acceptanceFailure: z.boolean(),
  smallSample: z.boolean(),
  undercounted: z.boolean(),
  /** The ONE rendered line every surface prints. See {@link renderFunnelLine}. */
  line: z.string().min(1),
}).strict()

export type AuthoringFunnel = z.infer<typeof AuthoringFunnelSchema>

/**
 * Phrasings a funnel render may never carry (the WTST-05 prohibition, made mechanical).
 *
 * A high keep rate is the loop failing to filter. Rendering it as an achievement, a score or a
 * percentage-complete is the exact misreading D-13 exists to prevent, and a prohibition nothing
 * checks is a comment. Every line this module composes is screened against these words before it
 * is returned, so the check runs on the SHIPPED wording rather than on a reviewer's attention.
 *
 * Matched on WORD BOUNDARIES, never as substrings: "win" inside "window" and "star" inside
 * "started" are the false positives a substring lexicon collects, and a screen that fires on its
 * own honest wording gets deleted rather than fixed.
 */
export const FUNNEL_SUCCESS_FRAMING_LEXICON: readonly string[] = [
  'success',
  'successful',
  'succeeded',
  'achievement',
  'achieved',
  'score',
  'scored',
  'grade',
  'excellent',
  'great',
  'healthy',
  'on track',
  'milestone',
  'well done',
  'congratulations',
  'complete',
  'completed',
  'progress',
  'goal',
  '✅',
  '🎉',
  '👍',
  '⭐',
]

/** Raised when a composed funnel line carries a framing the prohibition forbids. */
export class FunnelSuccessFramingError extends Error {
  constructor(readonly violations: readonly string[]) {
    super(
      'A funnel render may never present the keep rate as an achievement, a score or a '
      + `percentage-complete (WTST-05). Refusing a line carrying: ${violations.join(', ')}`,
    )
    this.name = 'FunnelSuccessFramingError'
  }
}

/** Which forbidden framings a string carries, in lexicon order. Empty is the clean answer. */
export function successFramingViolations(text: string): string[] {
  const lowered = text.toLowerCase()
  return FUNNEL_SUCCESS_FRAMING_LEXICON.filter((term) => (
    /^[a-z ]+$/.test(term)
      ? new RegExp(`(^|[^a-z])${term.replace(/ /g, '\\s+')}([^a-z]|$)`).test(lowered)
      : lowered.includes(term)
  ))
}

/**
 * The wording table every render composes from — the ONE place the funnel's words live.
 *
 * Pinned as a frozen record rather than inlined, so the prohibition above has something to screen
 * and a later editor changing a phrase edits it in the file that refuses a framed one.
 */
export const FUNNEL_PHRASES = {
  heading: 'Authoring funnel',
  built: 'built',
  passedStably: 'passed stably',
  addedValue: 'added value',
  accepted: 'accepted',
  noDrafts: 'No drafts reached authoring in this window, so there is no keep rate to report.',
  acceptanceFailure: 'ACCEPTANCE FAILURE',
  notFiltering: 'the loop is not filtering',
  smallSample: 'too few drafts to judge the filter',
  undercounted:
    'fewer receipts than invocations — byte-identical drafts share one receipt, so `built` is a '
    + 'lower bound here',
  refusalsUnrecorded: 'dedup refusals not recorded on this host',
} as const satisfies Readonly<Record<string, string>>

/** What {@link renderFunnelLine} needs: the computed funnel minus the line it is about to make. */
export type FunnelRenderParts = Omit<AuthoringFunnel, 'line'>

/**
 * Compose the ONE line every surface prints, and refuse it if it frames the rate as a success.
 *
 * The percentage is rounded HERE and nowhere else, and nothing downstream of this function reads
 * it back: `acceptanceFailure` was decided on integers before this ran.
 */
export function renderFunnelLine(parts: FunnelRenderParts): string {
  const { stages, sideCounters, keepRate } = parts
  const segments: string[] = [
    `${FUNNEL_PHRASES.heading} — ${stages.built} ${FUNNEL_PHRASES.built}`
    + ` · ${stages.passedStably} ${FUNNEL_PHRASES.passedStably}`
    + ` · ${stages.addedValue} ${FUNNEL_PHRASES.addedValue}`
    + ` · ${stages.accepted} ${FUNNEL_PHRASES.accepted}.`,
  ]

  if (keepRate === undefined) {
    segments.push(FUNNEL_PHRASES.noDrafts)
  } else {
    const percent = Math.round(keepRate * 100)
    const rate = `keep rate ${percent}% over ${stages.built} drafts`
    if (parts.acceptanceFailure) {
      segments.push(`${FUNNEL_PHRASES.acceptanceFailure}: ${rate} — ${FUNNEL_PHRASES.notFiltering}.`)
    } else if (parts.smallSample) {
      segments.push(
        `${rate} — ${FUNNEL_PHRASES.smallSample} (the floor is ${FUNNEL_MIN_DRAFTS_FLOOR} drafts).`,
      )
    } else {
      segments.push(`${rate}.`)
    }
  }

  if (parts.undercounted) segments.push(`Note: ${FUNNEL_PHRASES.undercounted}.`)

  const refusals = sideCounters.dedupRefusals === undefined
    ? FUNNEL_PHRASES.refusalsUnrecorded
    : `${sideCounters.dedupRefusals} dedup refusals`
  segments.push(`Beside the funnel: ${refusals}, ${sideCounters.findings} findings.`)

  const line = segments.join(' ')
  const violations = successFramingViolations(line)
  if (violations.length > 0) throw new FunnelSuccessFramingError(violations)
  return line
}

/**
 * THE ONE funnel computation (388 D-14's one-read-op law applied to the derivation).
 *
 * Pure and total. Every surface — chat, the CLI, the per-run digest — renders what this returns
 * rather than deriving a number of its own, which is what makes "how many drafts did this session
 * keep" a question with one answer.
 */
export function computeAuthoringFunnel(input: AuthoringFunnelInput): AuthoringFunnel {
  const digests = new Set(input.receipts.map((receipt) => receipt.draftRef.contentDigest))

  let passedStably = 0
  let addedValue = 0
  for (const receipt of input.receipts) {
    if (receipt.gates.executesDefinitive.pass && receipt.gates.stableVerdict.pass) passedStably += 1
    if (receipt.gates.addsValue.pass) addedValue += 1
  }

  // DISTINCT digests, and only ones this window has a receipt for. Two applied decisions about
  // one draft is one accepted draft, and an applied decision about a draft outside the window is
  // about a different denominator — either would let `accepted` exceed `built` and raise the flag
  // for a reason that has nothing to do with the loop failing to filter.
  const accepted = new Set(
    input.acceptances
      .filter((row) => row.decision === 'applied' && digests.has(row.contentDigest))
      .map((row) => row.contentDigest),
  ).size

  const built = input.receipts.length
  const stages = { built, passedStably, addedValue, accepted }

  const smallSample = built < FUNNEL_MIN_DRAFTS_FLOOR
  // INTEGERS. Never `accepted / built > 0.9`, and never the rounded percentage the line shows.
  const aboveCeiling = accepted * KEEP_RATE_CEILING.den > KEEP_RATE_CEILING.num * built
  const acceptanceFailure = aboveCeiling && built >= FUNNEL_MIN_DRAFTS_FLOOR

  const parts: FunnelRenderParts = {
    stages,
    sideCounters: {
      ...(input.sideCounters.dedupRefusals === undefined
        ? {}
        : { dedupRefusals: input.sideCounters.dedupRefusals }),
      findings: input.sideCounters.findings,
    },
    // ABSENT rather than 0 when nothing was built — see the header.
    ...(built === 0 ? {} : { keepRate: accepted / built }),
    acceptanceFailure,
    smallSample,
    undercounted: input.invocationCount !== undefined && input.invocationCount > built,
  }

  return { ...parts, line: renderFunnelLine(parts) }
}
