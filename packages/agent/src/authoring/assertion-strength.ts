// Gate 4 — the static assertion-strength check (393, WTST-02; D-09, D-10, D-11, D-12).
//
// ONE classification, THREE views. `classifyDraftSteps` is the only place a step is ever
// judged; `assertionStrengthGate` folds its rows into the receipt-facing gate result, and
// `evaluateAssertionStrength` projects the same rows onto the shape plan 01's frozen proving
// suite pinned before any of this existed. Two of those views exist because two consumers
// named two shapes first, and the alternative — teaching one of them the other's spelling —
// would have meant editing an artifact whose whole value is that the implementation did not
// get to choose it. A projection is cheap; a second judgment would be two answers to
// "is this draft's oracle real", free to disagree.
//
// DETERMINISTIC BY CONSTRUCTION (D-06). No I/O, no clock, no config, no model. The hermetic
// lane runs this per-commit with no LLM by contract, which is only possible if the check
// cannot reach one.
//
// AMBIGUITY TUNES TOWARD REJECT (D-12). Every borderline arm below returns "not falsifiable".
// That is defensible only because the rejection is READABLE: the per-step table lands verbatim
// in the receipt (D-11), so a rejected author is told which step was called what, which vacuity
// phrase it matched, and which capture pattern named its expected value. A gate that tunes
// toward reject without saying why is just a gate that says no.

import type { StepClassificationRow } from '@vostride/agent-qa-schema'

/**
 * The minimal structural mirror of a parsed draft's step list.
 *
 * Declared HERE rather than imported because the dependency points the other way — this
 * package never names `core`, where `parseTestFile` lives, and acquiring that import would
 * be a `validate:arch` violation with no legal repair (the `TestOutcomeHistoryLike`
 * precedent in `jobs/kinds.ts`). The HOST parses and flattens: `parseTestFile` yields steps
 * as `string | { step: string }`, and the caller narrows to text before handing them down
 * (the parse-at-host precedent in `cli/src/curation/authoring-test-discovery.ts`).
 */
export interface ParsedDraftStepsLike {
  readonly steps: readonly string[]
}

/**
 * The closed assertion-verb set — D-09 clause (i).
 *
 * A PINNED CONSTANT, never config (386 D-15). RETUNE COMMENT: these six are the verbs a person
 * writes when the next sentence is a CLAIM about the app rather than an instruction to it.
 * Every verb added here is a verb that can now open an assertion, which moves the gate's
 * numerator directly — clause (i) is satisfiable by one more shape of step, and every draft
 * that previously failed for having no assertion at all starts failing (or passing) for a
 * different reason. So add one only with a real draft that it rescues, and re-run the frozen
 * corpus afterwards: the expectations table is the denominator that says whether the widening
 * was a fix or a leak.
 *
 * Matching is on the step's LEADING token, exactly and case-insensitively — membership never
 * position, exact never substring. `Verifying` begins with a member and is not one;
 * `Type "alice" into the Verify field` contains a member and asserts nothing.
 *
 * Order is alphabetical and NOT load-bearing: the set is read by membership, never scanned.
 */
export const ASSERTION_VERBS = [
  'assert',
  'check',
  'confirm',
  'ensure',
  'expect',
  'verify',
] as const

/**
 * The closed action-verb set — used ONLY to detect a mixed act-and-verify step (D-12).
 *
 * A PINNED CONSTANT, never config. RETUNE COMMENT: these fourteen are the verbs that open an
 * INSTRUCTION to the app. They are read at exactly one place — the leading token of a clause
 * that follows a separator inside an assertion step — and never scanned across a whole step,
 * which is what keeps `Verify the Submit button is disabled` an ordinary assertion about an
 * element that happens to be named after an action. Widening this set makes MORE assertions
 * mixed and therefore non-falsifiable, so it moves the numerator toward reject; narrowing it
 * moves the numerator toward accept, which is the direction that costs a user a bad test.
 * Either way, re-run the frozen corpus.
 */
export const ACTION_VERBS = [
  'click',
  'drag',
  'enter',
  'fill',
  'hover',
  'navigate',
  'open',
  'press',
  'scroll',
  'select',
  'submit',
  'type',
  'upload',
  'visit',
] as const

/**
 * The closed vacuity set — D-09 clause (ii).
 *
 * A PINNED CONSTANT, never config. RETUNE COMMENT: a member is a whole assertion remainder
 * that, standing alone, is true of any page the browser managed to render — it names no
 * content, no element and no state that could have come out differently. `page loaded`
 * qualifies; `page shows the text "Username"` does not, and neither does anything that names
 * a thing the app could be wrong about. Every phrase added here REJECTS a draft that used to
 * pass, so add one only with the draft it catches, and re-run the frozen corpus.
 *
 * Matched EXACTLY against the normalized remainder — the step with its leading verb, its
 * leading articles and its trailing punctuation removed — and never as a substring of the raw
 * step. `Verify the banner says "the page loaded"` contains a member and is a concrete
 * assertion about page content; a substring scan rejects it, which is a real draft lost to a
 * lexicon that reached past its own boundary.
 *
 * ITS TWO JOBS, AND WHICH ONE IS LIVE TODAY. The lexicon NAMES the phrase on the receipt, which
 * is load-bearing now (D-11 — the author has to be told which term was called empty). It also
 * sits as a conjunct in the falsifiability rule, and that conjunct decides nothing on the
 * current membership: no member contains an `EXPECTED_STATE_TERMS` token, so a remainder that
 * equals a member is already non-concrete and refused by the other arm. It is kept as a guard
 * against exactly the widening this comment invites, and 393-12 changed WHICH widening that is.
 * `page is visible` is no longer the candidate: `namesAnElement` is now closed-lexicon membership
 * over normalized residue tokens, and every token of that phrase sits in `GENERIC_PAGE_NOUNS`,
 * `NON_ELEMENT_WORDS` or `EXPECTED_STATE_TERMS`, so the concreteness arm refuses it first — in
 * every casing. The member that would hand this conjunct the whole decision is one carrying BOTH
 * an `EXPECTED_STATE_TERMS` token AND a residue word outside all three exclusion sets:
 * `banner is visible` is that shape. The guard still has a live trigger rather than a promise —
 * `assertion-strength.test.ts`'s cross-lexicon closure case walks every member and reds if the
 * conjunct goes away under such a widening.
 *
 * Order is alphabetical and NOT load-bearing: the set is read by membership.
 */
export const VACUOUS_ASSERTION_PHRASES = [
  'it works',
  'no errors',
  'no errors occurred',
  'page appears',
  'page displayed',
  'page is displayed',
  'page loaded',
  'page loads',
  'page works',
] as const

/**
 * The closed expected-state set — the second falsifiability arm of D-09 clause (ii).
 *
 * A PINNED CONSTANT, never config. RETUNE COMMENT: a member is a binary, observable state an
 * element is either in or not. It counts as concrete expected content only BESIDE a named
 * element (see `namesAnElement`), because `is visible` on its own says visible what. Widening
 * this set makes more assertions falsifiable without a quoted literal, which is the arm most
 * likely to accept a weak oracle — re-run the frozen corpus, and prefer a quoted literal.
 *
 * ONE RETUNE, TWO ARMS (393-12). A member added here is ALSO excluded from element-name candidacy
 * in `namesAnElement`, so widening this set simultaneously makes more assertions state-bearing and
 * makes fewer words able to name an element — the two effects point in opposite directions. The
 * coupling is deliberate (a word that names a state is not the name of a control, and reading it as
 * one is how `is visible` would have become its own element), and this sentence is its record: the
 * W-10 rule that one retune must not silently move two measurements is satisfied by saying so here,
 * not by a second copy of the set.
 */
export const EXPECTED_STATE_TERMS = [
  'checked',
  'disabled',
  'empty',
  'enabled',
  'hidden',
  'selected',
  'unchecked',
  'visible',
] as const

/**
 * The closed element-noun set — the ONE positive lexicon `namesAnElement` decides by (393-13).
 *
 * A PINNED CONSTANT, never config. RETUNE COMMENT, AND ITS DIRECTION IS THE INVERSE OF THE THREE
 * EXCLUSION SETS THIS REPLACED: a member is a common name for a CONTROL or a LANDMARK on a page —
 * a thing an author points at, that the app could be wrong about. ADDING a member moves the gate
 * toward ACCEPT: every vacuous-shaped claim naming that noun starts passing, which is the direction
 * that costs a user a bad test. So a member arrives only with a real draft it rescues, plus a
 * re-run of the frozen corpus — the expectations table is the denominator that says whether the
 * widening was a fix or a leak. REMOVING a member refuses drafts: D-12's safe direction, still a
 * real cost.
 *
 * Read by exact membership over a NORMALIZED (lowercased, non-letters stripped) residue token —
 * membership never position, exact never substring.
 *
 * WHAT IS DELIBERATELY ABSENT. The page-whole nouns — app, browser, content, form, page, screen,
 * site — are NOT members, because a claim naming only those says nothing an author could have got
 * wrong about a particular thing. That absence is what refuses `page is visible` and `the form is
 * empty`, in every casing and under every function-word padding, and it is load-bearing: adding
 * `form` here would re-open the exact claim D-12 exists to reject.
 *
 * Order is alphabetical and NOT load-bearing: the set is read by membership.
 */
export const ELEMENT_NOUNS = [
  'alert',
  'banner',
  'button',
  'checkbox',
  'dialog',
  'dropdown',
  'field',
  'footer',
  'header',
  'heading',
  'icon',
  'image',
  'input',
  'label',
  'link',
  'list',
  'menu',
  'modal',
  'option',
  'panel',
  'popup',
  'radio',
  'row',
  'sidebar',
  'slider',
  'spinner',
  'tab',
  'table',
  'textbox',
  'toast',
  'toggle',
  'toolbar',
  'tooltip',
] as const

/**
 * The closed capture-signature set — D-10, the oracle-capture class.
 *
 * A PINNED CONSTANT, never config. RETUNE COMMENT: a member matches a value only a CAPTURE
 * could have produced — a run's own output pasted in as the expectation, which asserts what
 * the app did rather than what it should do. Every pattern is anchored at BOTH ends and is
 * applied to a single whitespace-delimited token of a quoted expected value, never to the
 * step's prose: an unanchored machine-content pattern starts rejecting sentences, which is
 * how a heuristic about ids becomes a heuristic about English.
 *
 * Adding a pattern rejects drafts that used to pass, so add one with the draft it catches and
 * with a human-authored value it must NOT catch — the false-positive control is the half that
 * is easy to skip and expensive to omit.
 *
 * SCOPE, honestly (D-10, the W-09 discipline): this narrows the oracle-capture class, it does
 * not eliminate it. A semantically wrong but syntactically clean expectation — a plausible
 * human-shaped value that simply is not what the app should show — passes every pattern here.
 * Full closure is bug-repro anchoring (Issue milestone) plus 394's authoring provenance.
 *
 * Order is by name, alphabetically, and is NOT load-bearing: every pattern is tried and the
 * hits are reported as a sorted set.
 */
export const CAPTURE_SIGNATURE_PATTERNS = [
  { name: 'iso-8601-timestamp', pattern: /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/ },
  { name: 'long-hex', pattern: /^[0-9a-f]{16,}$/i },
  { name: 'opaque-id', pattern: /^(?:sess|session|tok|token|sk|pk|id|ref|txn|ord)[_-][A-Za-z0-9]{8,}$/i },
  { name: 'uuid', pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i },
] as const

/**
 * The closed separator set for a MIXED act-and-verify step (D-12).
 *
 * A PINNED CONSTANT, never config. RETUNE COMMENT: these are the joins a person types when
 * one step secretly contains two — `Verify the form is submitted and click Continue`. A step
 * like that has no single verdict to report, so it contributes no falsifiable assertion and
 * the author is told to split it.
 *
 * Declared HERE rather than imported from `chat/clause-split.ts`, which pins a near-identical
 * set for the conjunction grammar. That is deliberate and it is the one duplication in this
 * file: the chat separators move the CHAT-03 refusal rate and these move the gate-4 numerator,
 * and a single shared constant would make one retune silently move two unrelated measurements
 * (the W-10 lesson). The sets are allowed to drift because the questions are different.
 *
 * The word tokens carry their own whitespace, which IS the word-boundary rule: ` and ` cannot
 * match inside `command`. A separate boundary check would be a second answer to a question the
 * token spelling already answers, free to disagree with it.
 */
const MIXED_STEP_SEPARATORS = [' and ', ' then ', ';', ','] as const

/** Leading determiners stripped before the vacuity lexicon is consulted. */
const LEADING_ARTICLES = ['a', 'an', 'that', 'the'] as const

const TRAILING_PUNCTUATION_RE = /[.!?,;:\s]+$/
const QUOTED_LITERAL_RE = /"([^"]*)"/g

/** The frozen contract shape plan 01's `corpus-static-gates.test.ts` pinned (D-08). */
export interface AssertionStrengthStep {
  readonly text: string
  readonly kind: 'assertion' | 'action'
  readonly falsifiable: boolean
  readonly captureSignatureHits: string[]
}

/** @see AssertionStrengthStep */
export interface AssertionStrengthResult {
  readonly falsifiable: boolean
  readonly steps: AssertionStrengthStep[]
}

/**
 * The receipt-facing gate result.
 *
 * The counts and the reason are here rather than derived by the receipt assembler because
 * `DraftGateResults.falsifiableAssertion` asks for exactly these three fields beside `pass`,
 * and a consumer recounting the table would be a second answer to a question this function
 * already answered (388 C13, one exported vocabulary).
 */
export interface AssertionStrengthGateResult {
  readonly pass: boolean
  readonly assertionStepCount: number
  readonly falsifiableAssertionCount: number
  readonly reason: string
  readonly table: StepClassificationRow[]
}

function normalizeToken(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z]/g, '')
}

function leadingToken(text: string): string {
  return normalizeToken(text.trim().split(/\s+/)[0] ?? '')
}

function isAssertionVerb(token: string): boolean {
  return (ASSERTION_VERBS as readonly string[]).includes(token)
}

function isActionVerb(token: string): boolean {
  return (ACTION_VERBS as readonly string[]).includes(token)
}

/**
 * The double-quoted spans of a step, EMPTY AND WHITESPACE-ONLY CAPTURES DROPPED (393-13).
 *
 * The filter is a `trim` test rather than a falsiness test because `" "` asserts exactly as little
 * as `""` does, and it lives HERE rather than at either call site so the prior-action accumulation
 * and the concreteness path cannot disagree about what counts as a literal. Without it, bare
 * `Verify ""` satisfied `literals.length > 0` and short-circuited the concreteness arm — a quoted
 * expected value that expects nothing.
 */
function quotedLiterals(text: string): string[] {
  return [...text.matchAll(QUOTED_LITERAL_RE)]
    .map((match) => match[1] ?? '')
    .filter((literal) => literal.trim() !== '')
}

/** The step with every double-quoted span removed, so prose scans cannot read a literal. */
function unquotedResidue(text: string): string {
  return text.replace(QUOTED_LITERAL_RE, ' ')
}

/** The step after its leading token, byte-for-byte — every caller normalizes for itself. */
function afterLeadingToken(text: string): string {
  const trimmed = text.trim()
  const boundary = trimmed.search(/\s/)

  return boundary === -1 ? '' : trimmed.slice(boundary + 1).trim()
}

/**
 * The assertion remainder the vacuity lexicon is matched against, EXACTLY.
 *
 * Leading verb, then leading articles one at a time, then trailing punctuation. Articles are
 * stripped iteratively because `that the page is displayed` carries two, and a single pass
 * would leave a remainder that no member can equal — which reads as "not vacuous" and is the
 * failure direction that costs a user a bad test.
 */
function vacuityRemainder(text: string): string {
  let remainder = afterLeadingToken(text).toLowerCase().replace(/\s+/g, ' ').trim()

  for (;;) {
    const head = remainder.split(' ')[0] ?? ''
    if (!(LEADING_ARTICLES as readonly string[]).includes(head)) break
    remainder = remainder.slice(head.length).trim()
  }
  return remainder.replace(TRAILING_PUNCTUATION_RE, '')
}

/**
 * Whether an assertion step secretly contains an instruction (D-12).
 *
 * A separator, and then a clause whose OWN leading token is an action verb. The leading-token
 * rule is the same one role classification uses, and for the same reason: an action verb
 * appearing anywhere in a sentence says nothing, while an action verb opening a clause is an
 * instruction. Quoted spans are removed first — the literal a page must show may itself read
 * `Click here to continue`, and rejecting that draft would be the lexicon reaching past its
 * own boundary again.
 */
function isMixedActAndVerify(text: string): boolean {
  const residue = unquotedResidue(text)

  for (const separator of MIXED_STEP_SEPARATORS) {
    const pieces = residue.split(separator)
    if (pieces.length < 2) continue
    if (pieces.slice(1).some((piece) => isActionVerb(leadingToken(piece)))) return true
  }
  return false
}

/**
 * Whether the assertion names a specific element rather than the page in general.
 *
 * THE RULE ENFORCED, verbatim (393-13): the post-verb residue, with double-quoted spans already
 * removed, is split on whitespace and each piece normalized by `normalizeToken` (lowercased,
 * non-letters stripped). The answer is true iff AT LEAST ONE normalized token is a MEMBER of the
 * one positive closed set `ELEMENT_NOUNS`. Letter case is never consulted: the verdict for a step
 * and for any recasing of that step is identical, by construction.
 *
 * The full disclosure structure — the measured history, the residual, the widened accepted cost —
 * lands with this plan's documentation task; this block states only what the code above does.
 */
function namesAnElement(text: string): boolean {
  return afterLeadingToken(unquotedResidue(text))
    .split(/\s+/)
    .map(normalizeToken)
    .some((token) => (ELEMENT_NOUNS as readonly string[]).includes(token))
}

function hasExpectedStateTerm(text: string): boolean {
  return unquotedResidue(text)
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((token) => (EXPECTED_STATE_TERMS as readonly string[]).includes(token))
}

/**
 * The capture-signature patterns a quoted expected value hits, by NAME (D-10).
 *
 * Per whitespace-delimited token of each literal, so a value that embeds a machine id inside a
 * sentence is still caught, and reported as a sorted deduplicated set so the receipt reads the
 * same way whichever literal matched first.
 */
function captureSignatureHits(literals: readonly string[]): string[] {
  const hits = new Set<string>()

  for (const literal of literals) {
    for (const token of literal.split(/\s+/)) {
      for (const entry of CAPTURE_SIGNATURE_PATTERNS) {
        if (entry.pattern.test(token)) hits.add(entry.name)
      }
    }
  }
  return [...hits].sort()
}

/**
 * The per-step classification table (D-11).
 *
 * The ONE judgment in this module. Prior-action literals accumulate as the walk proceeds,
 * which is what makes the tautology rule directional: an assertion cannot restate content that
 * has not been entered yet, and an order-blind comparison would reject a legitimate
 * pre-condition check for restating something that comes later.
 */
export function classifyDraftSteps(steps: readonly string[]): StepClassificationRow[] {
  const priorActionLiterals = new Set<string>()
  const rows: StepClassificationRow[] = []

  for (const stepText of steps) {
    const literals = quotedLiterals(stepText)

    if (!isAssertionVerb(leadingToken(stepText))) {
      for (const literal of literals) priorActionLiterals.add(literal)
      rows.push({ stepText, role: 'action', falsifiable: false, captureSignatureHits: [] })
      continue
    }

    const vacuityHit = (VACUOUS_ASSERTION_PHRASES as readonly string[])
      .find((phrase) => phrase === vacuityRemainder(stepText))
    const hits = captureSignatureHits(literals)
    const tautology = literals.some((literal) => priorActionLiterals.has(literal))
    const concrete = literals.length > 0 || (namesAnElement(stepText) && hasExpectedStateTerm(stepText))

    rows.push({
      stepText,
      role: 'assertion',
      falsifiable:
        concrete
        && vacuityHit === undefined
        && hits.length === 0
        && !tautology
        && !isMixedActAndVerify(stepText),
      captureSignatureHits: hits,
      ...(vacuityHit === undefined ? {} : { vacuityHit }),
      ...(tautology ? { tautologyHit: true } : {}),
    })
  }
  return rows
}

function gateReason(rows: readonly StepClassificationRow[]): string {
  const assertions = rows.filter((row) => row.role === 'assertion')

  if (assertions.length === 0) {
    return 'no step classifies as an assertion: the draft records what it did, never what should be true (D-09 clause (i))'
  }
  if (assertions.some((row) => row.falsifiable)) {
    return `${assertions.filter((row) => row.falsifiable).length} of ${assertions.length} assertion steps reference concrete expected content`
  }

  const causes = new Set<string>()
  for (const row of assertions) {
    if (row.vacuityHit !== undefined) causes.add(`vacuous phrase "${row.vacuityHit}"`)
    if (row.tautologyHit === true) causes.add('restates a prior action\'s own literal')
    for (const hit of row.captureSignatureHits) causes.add(`capture signature ${hit}`)
    // D-12's mixed act-and-verify signal has no receipt ROW field: `StepClassificationRowSchema`
    // is strict and carries no `mixedHit`, and 393-06 declined to add one — a bare boolean would
    // name nothing the step text does not already show, where `vacuityHit` names the exact phrase
    // and `captureSignatureHits` the exact pattern. The cause therefore has to surface HERE, which
    // is where 393-04's own handoff note said it would. Until this line it did not: a mixed step
    // carrying a quoted literal fell through to the fallback below and the receipt read
    // "no quoted expected value" about a step that has one — a durable false explanation, which is
    // the one thing D-12's tune-toward-reject posture cannot afford.
    if (isMixedActAndVerify(row.stepText)) {
      causes.add('acts and verifies in one step, so it has no single verdict to report')
    }
  }
  if (causes.size === 0) causes.add('no quoted expected value and no named element in a checkable state')

  return `${assertions.length} assertion step(s), none falsifiable: ${[...causes].sort().join('; ')} (D-09 clause (ii))`
}

/**
 * Gate 4 (D-09's two clauses composed) over a parsed draft's steps.
 *
 * Pass requires at least one row that is BOTH an assertion and falsifiable — the two clauses
 * are conjoined on a single row rather than checked independently, because a draft with a
 * vacuous assertion and a falsifiable-looking action would otherwise satisfy them separately.
 */
export function assertionStrengthGate(draft: ParsedDraftStepsLike): AssertionStrengthGateResult {
  const table = classifyDraftSteps(draft.steps)
  const assertions = table.filter((row) => row.role === 'assertion')
  const falsifiable = assertions.filter((row) => row.falsifiable)

  return {
    pass: falsifiable.length > 0,
    assertionStepCount: assertions.length,
    falsifiableAssertionCount: falsifiable.length,
    reason: gateReason(table),
    table,
  }
}

/**
 * The frozen proving suite's contract (D-08) — a projection, never a second judgment.
 *
 * `corpus-static-gates.test.ts` was committed RED against this exact signature before any of
 * this module existed, and it names its fields `text`/`kind` where the receipt schema names
 * them `stepText`/`role`. Renaming either side to agree with the other would have meant the
 * implementation editing the artifact that exists to constrain it, so the two spellings both
 * stand and this function carries the mapping. `vacuityHit` and `tautologyHit` are absent from
 * the projection because the frozen shape has no field for them — they survive on the receipt
 * rows, which is where D-11 says the author reads them.
 */
export function evaluateAssertionStrength(steps: readonly string[]): AssertionStrengthResult {
  const table = classifyDraftSteps(steps)

  return {
    falsifiable: table.some((row) => row.role === 'assertion' && row.falsifiable),
    steps: table.map((row) => ({
      text: row.stepText,
      kind: row.role,
      falsifiable: row.falsifiable,
      captureSignatureHits: row.captureSignatureHits,
    })),
  }
}
