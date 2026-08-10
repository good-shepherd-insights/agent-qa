// Gate 4's unit contract (393-04; D-09, D-10, D-11, D-12).
//
// This suite is the module-local half of the proof. The other half lives in
// `packages/cli/src/authoring/__tests__/corpus-static-gates.test.ts`, which drives the SAME
// check through the real `parseTestFile` over the frozen corpus (the produced-not-literal
// law). What is pinned HERE is the behaviour of each clause in isolation, plus the lexicon
// discipline itself — membership never position, exact never substring — because the corpus
// cases can be satisfied by a check that happens to be right for the wrong reason.
//
// The corpus step texts below are copied VERBATIM from the frozen drafts at commit 4180c78b.
// They are literals on purpose: this package cannot import `parseTestFile` (agent never names
// core), and the produced path is already covered by the cli suite. If a literal here ever
// disagrees with the frozen draft, the cli suite is the authority.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { StepClassificationRowSchema } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import {
  ACTION_VERBS,
  ASSERTION_VERBS,
  CAPTURE_SIGNATURE_PATTERNS,
  ELEMENT_NOUNS,
  EXPECTED_STATE_TERMS,
  VACUOUS_ASSERTION_PHRASES,
  assertionStrengthGate,
  classifyDraftSteps,
  evaluateAssertionStrength,
} from '../assertion-strength.js'

/**
 * The frozen expectation table — the ONLY source of expected gate-4 verdicts for the corpus
 * walk below (D-08, the treadmill law). Read from disk rather than restated inline, because a
 * local literal is a second copy of the denominator and is free to drift from it silently.
 */
const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/corpus')

interface ExpectationsTable {
  drafts: Record<string, { expectedGates: { falsifiableAssertion: boolean } }>
}

const EXPECTATIONS = JSON.parse(
  readFileSync(join(CORPUS_DIR, 'expectations.json'), 'utf8'),
) as ExpectationsTable

/**
 * Title-case every word OUTSIDE double-quoted spans.
 *
 * Quoted spans are left byte-identical on purpose: a quoted literal is the app's own content,
 * and recasing it would change WHAT the draft asserts rather than how the sentence is written.
 * The point of the walk is that the casing of the PROSE cannot move a verdict.
 */
function titleCaseOutsideQuotes(text: string): string {
  return text
    .split(/("[^"]*")/)
    .map((segment, index) => (
      index % 2 === 1 ? segment : segment.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    ))
    .join('')
}

function onlyRow(steps: readonly string[]) {
  const rows = classifyDraftSteps(steps)
  const row = rows[rows.length - 1]

  if (row === undefined) throw new Error('classifyDraftSteps returned no rows')
  return row
}

describe('classifyDraftSteps — role classification (D-09 clause (i))', () => {
  it('classifies a leading assertion verb as an assertion', () => {
    expect(onlyRow(['Verify the page says "Received!"']).role).toBe('assertion')
  })

  it('classifies a leading action verb as an action', () => {
    expect(onlyRow(['Type "alice" into the Username field']).role).toBe('action')
  })

  it('matches the assertion verb case-insensitively', () => {
    expect(onlyRow(['VERIFY the page says "Received!"']).role).toBe('assertion')
  })

  it('matches the leading verb EXACTLY, not as a prefix', () => {
    // `verifying` begins with a member and is not one. A prefix test would classify this as
    // an assertion and hand the gate a clause (i) it never earned.
    expect(onlyRow(['Verifying the page says "Received!"']).role).toBe('action')
  })

  it('matches the leading verb by POSITION-ANCHORED membership, not by occurrence anywhere', () => {
    // An element literally named "Verify" is an element, not an assertion. A contains-check
    // over the whole step would read this as an assertion with a quoted literal and PASS the
    // gate on a draft that asserts nothing.
    expect(onlyRow(['Type "alice" into the Verify field']).role).toBe('action')
  })

  it('never marks an action row falsifiable', () => {
    const row = onlyRow(['Click the "Back to the form" link'])

    expect(row.role).toBe('action')
    expect(row.falsifiable).toBe(false)
  })
})

describe('classifyDraftSteps — falsifiability (D-09 clause (ii))', () => {
  it('a quoted expected literal makes an assertion falsifiable', () => {
    const row = onlyRow(['Verify the page says "Received!"'])

    expect(row.falsifiable).toBe(true)
    expect(row.vacuityHit).toBeUndefined()
  })

  it('a named element plus an expected-state term makes an assertion falsifiable', () => {
    expect(onlyRow(['Verify the Submit button is disabled']).falsifiable).toBe(true)
  })

  it('an expected-state term with no named element is NOT falsifiable (D-12)', () => {
    // `visible` is a member; nothing in the step says visible WHAT. Tune toward reject.
    expect(onlyRow(['Verify the content is visible']).falsifiable).toBe(false)
  })

  it('an assertion with neither a quoted literal nor an element+state is not falsifiable', () => {
    expect(onlyRow(['Verify everything worked']).falsifiable).toBe(false)
  })

  it('a vacuous assertion is still an assertion, and names the phrase it matched', () => {
    const row = onlyRow(['Verify the page loaded'])

    expect(row.role).toBe('assertion')
    expect(row.falsifiable).toBe(false)
    expect(row.vacuityHit).toBe('page loaded')
  })

  it('matches the vacuity lexicon EXACTLY on the remainder, never as a substring', () => {
    // The vacuous phrase appears inside a quoted literal. The step asserts concrete page
    // content and must stay falsifiable; a substring scan over the raw text rejects it.
    const row = onlyRow(['Verify the banner says "the page loaded"'])

    expect(row.vacuityHit).toBeUndefined()
    expect(row.falsifiable).toBe(true)
  })

  it('strips the leading article before matching the vacuity lexicon', () => {
    expect(onlyRow(['Verify that the page is displayed']).vacuityHit).toBe('page is displayed')
  })
})

describe('classifyDraftSteps — capture signatures (D-10)', () => {
  it('flags a 32-char hex expected value and NAMES the pattern', () => {
    const row = onlyRow([
      'Verify the page shows the submission reference "3f9c1ab27d5e4086bb17c2e5a94d0f6b"',
    ])

    expect(row.falsifiable).toBe(false)
    expect(row.captureSignatureHits).toEqual(['long-hex'])
  })

  it('flags a UUID expected value', () => {
    const row = onlyRow(['Verify the request id is "3f9c1ab2-7d5e-4086-bb17-c2e5a94d0f6b"'])

    expect(row.falsifiable).toBe(false)
    expect(row.captureSignatureHits).toEqual(['uuid'])
  })

  it('flags an ISO-8601 timestamp expected value', () => {
    const row = onlyRow(['Verify the receipt shows "2026-08-10T04:15:00Z"'])

    expect(row.falsifiable).toBe(false)
    expect(row.captureSignatureHits).toEqual(['iso-8601-timestamp'])
  })

  it('flags an opaque session/token id expected value', () => {
    const row = onlyRow(['Verify the header shows "sess_9f2ba71cd4e8"'])

    expect(row.falsifiable).toBe(false)
    expect(row.captureSignatureHits).toEqual(['opaque-id'])
  })

  it('leaves a human-authored expected value alone', () => {
    const row = onlyRow(['Verify the page heading says "Local Form"'])

    expect(row.captureSignatureHits).toEqual([])
    expect(row.falsifiable).toBe(true)
  })

  it('applies capture patterns ONLY to assertion steps', () => {
    // An action legitimately TYPES machine-shaped content; that is not a weak oracle.
    const row = onlyRow(['Type "3f9c1ab27d5e4086bb17c2e5a94d0f6b" into the Token field'])

    expect(row.role).toBe('action')
    expect(row.captureSignatureHits).toEqual([])
  })
})

describe('classifyDraftSteps — tautology (D-10)', () => {
  it('flags an assertion that restates a PRIOR action step\'s own literal', () => {
    const row = onlyRow([
      'Type "alice" into the Username field',
      'Verify the Username field contains "alice"',
    ])

    expect(row.role).toBe('assertion')
    expect(row.tautologyHit).toBe(true)
    expect(row.falsifiable).toBe(false)
  })

  it('does not flag a literal introduced AFTER the assertion', () => {
    // "prior" is the whole content of the rule: an assertion cannot restate what has not
    // happened yet, and an order-blind set would reject a legitimate pre-condition check.
    const row = classifyDraftSteps([
      'Verify the Username field contains "alice"',
      'Type "alice" into the Username field',
    ])[0]

    expect(row?.tautologyHit).toBeUndefined()
    expect(row?.falsifiable).toBe(true)
  })

  it('compares literals byte-for-byte, not case-insensitively', () => {
    const row = onlyRow([
      'Type "alice" into the Username field',
      'Verify the Username field contains "Alice"',
    ])

    expect(row.tautologyHit).toBeUndefined()
    expect(row.falsifiable).toBe(true)
  })
})

describe('classifyDraftSteps — mixed act-and-verify steps (D-12)', () => {
  it('an assertion whose residue also names an action verb contributes no falsifiable assertion', () => {
    const row = onlyRow(['Verify the form is submitted and click the "Continue" button'])

    expect(row.role).toBe('assertion')
    expect(row.falsifiable).toBe(false)
  })

  it('a step that acts first and verifies second never classifies as an assertion at all', () => {
    const row = onlyRow(['Click Submit and verify it worked'])

    expect(row.role).toBe('action')
    expect(row.falsifiable).toBe(false)
  })

  it('does not read an action verb out of a QUOTED expected value', () => {
    // The literal the page must show happens to contain an action word. Scanning the raw
    // text would reject a perfectly concrete oracle.
    const row = onlyRow(['Verify the page says "Click here to continue"'])

    expect(row.falsifiable).toBe(true)
  })

  it('does not read a SEPARATOR out of a quoted expected value either', () => {
    // The stronger control: the literal carries both a separator and an action verb after
    // it, so a mixed scan over the raw step splits INSIDE the expected value and rejects a
    // single-verdict assertion. Only stripping quotes before the scan gets this right.
    const row = onlyRow(['Verify the page says "Saved, then click Continue"'])

    expect(row.falsifiable).toBe(true)
  })
})

describe('namesAnElement — content decides; casing never does (393-12, 393-13, WR-06)', () => {
  // WHY THESE CONTROLS REACH THE CONCRETENESS ARM, by construction rather than by hope.
  //
  // No unquoted step below carries a double-quoted span, so `concrete` cannot short-circuit on
  // `literals.length > 0` and `namesAnElement` is genuinely consulted. `page is visible` is NOT a
  // VACUOUS_ASSERTION_PHRASES member — the lexicon's own retune comment calls it the obvious
  // candidate the set does not hold — and neither is any function-word padding of it (`page is not
  // visible` equals no member of an EXACT-match lexicon), so the vacuity arm cannot decide either.
  // No capture signature, no prior-action literal to restate, and no MIXED_STEP_SEPARATORS token is
  // present, so those three arms are silent too. Every cell below is therefore a reading of the
  // concreteness arm and nothing else, which the per-cell arm-attribution assertions re-check.
  //
  // The frozen corpus cannot observe this arm at all: every expected-true draft carries a quoted
  // literal and every expected-false draft is refused by another arm, which is why THESE
  // constructed controls are the pins and the corpus walk below is not.
  //
  // Every loop is a loop on purpose. Three prior attempts at this defect each moved one boundary
  // and satisfied a handful of enumerated cells; a loop over a whole axis cannot be satisfied that
  // way — any rule that consults letter case reds at least one casing cell, and any rule that
  // decides concreteness by NON-membership in an exclusion list reds at least one padding cell.
  //
  // AND THE AXES CROSS (393-13, the single-axis control law). Rounds 2–4 each varied ONLY the axis
  // just fixed, so the suite structurally could not see the defect move: the casing loop below was
  // green while every one of the eight padding sentences carried the same vacuous claim through
  // gate 4. So this round carries cells OFF the axis it fixes — PADDED_CASINGS crosses padding with
  // casing, and PADDED_NAMED_ELEMENTS pins the ACCEPT direction of the same padding so the fix
  // cannot silently flip into refusing padded concrete claims.

  const VACUOUS_PAGE_CASINGS = [
    'Verify the page is visible',
    'Verify the Page is visible',
    'Verify The page is visible',
    'Verify The Page is visible',
    'Verify The Page Is Visible',
    'Verify THE PAGE IS VISIBLE',
  ] as const

  const NAMED_ELEMENT_CASINGS = [
    'Verify the submit button is disabled',
    'Verify the Submit button is disabled',
    'Verify The submit button is disabled',
    'Verify The Submit button is disabled',
    'Verify The Submit Button Is Disabled',
    'Verify THE SUBMIT BUTTON IS DISABLED',
  ] as const

  // THE PADDING AXIS (393-13). These eight are the verifier's own re-measurement of the round-4
  // rule: every one of them PASSED gate 4 while `Verify the page is visible` was refused, because
  // the inserted function word — a negation, a copula, a modal, an adverb — was a member of no
  // exclusion list and therefore read as an element name. The claim each one makes is the same
  // vacuous claim about the page as a whole.
  const VACUOUS_PAGE_PADDINGS = [
    'Verify the page is not visible',
    'Verify the page is still visible',
    'Verify the page should be visible',
    'Verify the page will be visible',
    'Verify the page is not empty',
    'Verify that the content is now visible',
    'Verify the screen is not empty',
    'Verify the site was also visible',
  ] as const

  // THE CROSSING CELLS: padding under casing variation. Neither axis alone can satisfy these.
  const PADDED_CASINGS = [
    'Verify The Page Is Not Visible',
    'VERIFY THE PAGE SHOULD BE VISIBLE',
    'Verify the Page is still Visible',
    'VERIFY THE SCREEN IS NOT EMPTY',
  ] as const

  // THE ACCEPT DIRECTION of the same padding: a NAMED element beside the same function words must
  // survive. Without these, "refuse everything with `not` in it" would satisfy the loops above.
  const PADDED_NAMED_ELEMENTS = [
    'Verify the submit button is not visible',
    'Verify the username field is still empty',
    'Verify The Submit Button Is Not Visible',
  ] as const

  // THE SECOND LEAK on the same D-09 clause (ii): an EMPTY quoted capture satisfied
  // `literals.length > 0`, so the concreteness arm was short-circuited by a literal that asserts
  // nothing at all. Bare `Verify ""` passed gate 4.
  const EMPTY_LITERALS = [
    'Verify ""',
    'Verify the page shows ""',
    'Verify the page shows " "',
  ] as const

  it.each(VACUOUS_PAGE_CASINGS)('refuses the generic-page claim in every casing: %s', (step) => {
    const result = assertionStrengthGate({ steps: [step] })
    const row = result.table[0]

    expect(result.pass).toBe(false)
    expect(result.falsifiableAssertionCount).toBe(0)
    expect(row?.role).toBe('assertion')
    expect(row?.falsifiable).toBe(false)
    // Arm attribution: the CONCRETENESS arm refused this, not the vacuity or capture arm. Without
    // these two lines a future vacuity-lexicon widening could carry the cell while the arm under
    // test rots underneath it.
    expect(row?.vacuityHit).toBeUndefined()
    expect(row?.captureSignatureHits).toEqual([])
  })

  it.each(NAMED_ELEMENT_CASINGS)('accepts the named-element claim in every casing: %s', (step) => {
    const result = assertionStrengthGate({ steps: [step] })

    expect(result.pass).toBe(true)
    expect(result.falsifiableAssertionCount).toBe(1)
    expect(result.table[0]?.vacuityHit).toBeUndefined()
    expect(result.table[0]?.captureSignatureHits).toEqual([])
  })

  it.each(VACUOUS_PAGE_PADDINGS)('refuses the generic-page claim with a function word inserted: %s', (step) => {
    const result = assertionStrengthGate({ steps: [step] })
    const row = result.table[0]

    expect(result.pass).toBe(false)
    expect(result.falsifiableAssertionCount).toBe(0)
    expect(row?.role).toBe('assertion')
    expect(row?.falsifiable).toBe(false)
    // Arm attribution: the CONCRETENESS arm refused this. An exact-match vacuity lexicon holds no
    // padded remainder, so without these two lines a vacuity-lexicon widening could carry the cell
    // while the arm under test stayed exactly as leaky as the verifier measured it.
    expect(row?.vacuityHit).toBeUndefined()
    expect(row?.captureSignatureHits).toEqual([])
  })

  it.each(PADDED_CASINGS)('refuses the padded generic-page claim under recasing too: %s', (step) => {
    const result = assertionStrengthGate({ steps: [step] })
    const row = result.table[0]

    expect(result.pass).toBe(false)
    expect(result.falsifiableAssertionCount).toBe(0)
    expect(row?.role).toBe('assertion')
    expect(row?.falsifiable).toBe(false)
    expect(row?.vacuityHit).toBeUndefined()
    expect(row?.captureSignatureHits).toEqual([])
  })

  it.each(PADDED_NAMED_ELEMENTS)('still accepts a NAMED element beside the same function words: %s', (step) => {
    const result = assertionStrengthGate({ steps: [step] })

    expect(result.pass).toBe(true)
    expect(result.falsifiableAssertionCount).toBe(1)
    expect(result.table[0]?.vacuityHit).toBeUndefined()
    expect(result.table[0]?.captureSignatureHits).toEqual([])
  })

  it.each(EMPTY_LITERALS)('an EMPTY quoted literal never satisfies concreteness: %s', (step) => {
    const result = assertionStrengthGate({ steps: [step] })
    const row = result.table[0]

    expect(result.pass).toBe(false)
    expect(row?.role).toBe('assertion')
    expect(row?.falsifiable).toBe(false)
    expect(row?.vacuityHit).toBeUndefined()
    expect(row?.captureSignatureHits).toEqual([])
  })

  it('the empty-literal filter TRIMS, it does not over-reject: a non-empty literal still decides', () => {
    // The control half of the pair above. `"0"` is one character of real expected content, and a
    // filter written as a falsiness test rather than a trim test would drop it.
    expect(assertionStrengthGate({ steps: ['Verify the page shows "0"'] }).pass).toBe(true)
  })

  it('a quoted literal decides in any casing, and the prose around it is never consulted', () => {
    // Re-homed from the deleted 393-09 prose-case group: not subsumed by the casing loops above,
    // because these two cells short-circuit on `literals.length > 0` and never reach the arm the
    // loops measure. That is exactly what they pin.
    expect(assertionStrengthGate({ steps: ['Verify the page says "Received!"'] }).pass).toBe(true)
    expect(assertionStrengthGate({ steps: ['Verify The Page Says "Received!"'] }).pass).toBe(true)
  })

  it('accepts the title-cased concrete assertions the two-sided-case rule falsely rejected', () => {
    // THE MEASURED FALSE REJECT, fixed rather than disclosed. The rule this group replaced required
    // the residue to carry BOTH a capital-initial and a lowercase-initial word, so these two steps —
    // each naming a real control in a binary observable state, in the title case the module's own
    // premise says LLM drafts commonly use — lost gate 4 while their prose-cased twins kept it.
    expect(assertionStrengthGate({ steps: ['Verify The Submit Button Is Disabled'] }).pass).toBe(true)
    expect(assertionStrengthGate({ steps: ['Verify The Username Field Is Empty'] }).pass).toBe(true)
  })

  it('an expected-state term with no element noun beside it is still refused', () => {
    // Re-homed from the deleted 393-09 prose-case group. `content` names the page as a whole and
    // `visible` says visible WHAT — the twin of the loop cells above, one noun over.
    expect(assertionStrengthGate({ steps: ['Verify the content is visible'] }).pass).toBe(false)
  })

  it('leaves the documented residual open on purpose: a lexicon MEMBER reads as an element name', () => {
    // THE RESIDUAL, pinned deliberately so closing it is a conscious retune rather than an accident.
    // A lexical check cannot know the PAGE: `banner` is an ELEMENT_NOUNS member, so this passes
    // whether or not the page has a banner. Membership decides that the word names a KIND of
    // element; nothing lexical can decide that this page holds one. Closing it needs the resolved
    // a11y evidence gate 3 works from, not a lexicon retune — and never a character-case test,
    // which is the shape that shipped two of the three prior defects.
    expect(assertionStrengthGate({ steps: ['Verify the banner is visible'] }).pass).toBe(true)
  })

  it('pays the WIDENED accepted cost: an UNLISTED element noun is refused, and so is the generic-page claim', () => {
    // THE ACCEPTED COST, WIDENED knowingly by the 393-13 inversion, in D-12's ratified direction.
    //
    // Under the exclusion rule, an unlisted word was ACCEPTED — which is how the same defect rotted
    // open three times, once per class of word nobody had thought to exclude. Under membership an
    // unlisted word is REFUSED, so `widget`, `carousel` and `Login` — each naming a real thing —
    // now lose gate 4. The third cell is a deliberate verdict FLIP: `Verify the Login form is empty`
    // was the recovery route the previous round pinned as PASSING. It is the price of a closure that
    // fails toward reject, and it is paid here in the open rather than discovered later.
    //
    // The AUTHOR's route out is a lexicon noun or a quoted literal — pinned below. The MAINTAINER's
    // is an ELEMENT_NOUNS membership change plus a frozen-corpus re-run, and adding a member moves
    // the gate toward ACCEPT.
    for (const step of [
      'Verify the widget is visible',
      'Verify the carousel is visible',
      'Verify the Login form is empty',
      'Verify the Form is empty',
      'Verify the form is empty',
    ]) {
      const row = onlyRow([step])

      expect({ step, pass: assertionStrengthGate({ steps: [step] }).pass }).toEqual({ step, pass: false })
      expect(row.vacuityHit).toBeUndefined()
    }

    expect(assertionStrengthGate({ steps: ['Verify the login field is empty'] }).pass).toBe(true)
  })
})

describe('classifyDraftSteps — the table (D-11)', () => {
  it('emits exactly one row per input step, in order, with the text carried verbatim', () => {
    const steps = [
      'Type "alice" into the Username field',
      'Click the Submit button',
      'Verify the page says "Received!"',
    ]

    expect(classifyDraftSteps(steps).map((row) => row.stepText)).toEqual(steps)
  })

  it('omits the optional hit fields when they did not fire', () => {
    // The receipt schema is `.strict()`, and an always-present `tautologyHit: false` would
    // put a claim on every row that only two rows in the whole corpus earn.
    const row = onlyRow(['Type "alice" into the Username field'])

    expect(Object.hasOwn(row, 'vacuityHit')).toBe(false)
    expect(Object.hasOwn(row, 'tautologyHit')).toBe(false)
  })
})

describe('assertionStrengthGate — the two clauses composed (D-09)', () => {
  it('fails clause (i): no step classifies as an assertion at all', () => {
    const result = assertionStrengthGate({
      steps: [
        'Type "alice" into the Username field',
        'Click the Submit button',
      ],
    })

    expect(result.pass).toBe(false)
    expect(result.assertionStepCount).toBe(0)
    expect(result.falsifiableAssertionCount).toBe(0)
    expect(result.reason).toContain('no step')
  })

  it('fails clause (ii): an assertion exists but none is falsifiable', () => {
    const result = assertionStrengthGate({
      steps: [
        'Click the Submit button',
        'Verify the page loaded',
      ],
    })

    expect(result.pass).toBe(false)
    expect(result.assertionStepCount).toBe(1)
    expect(result.falsifiableAssertionCount).toBe(0)
    expect(result.reason).toContain('page loaded')
  })

  it('passes when at least one assertion is falsifiable', () => {
    const result = assertionStrengthGate({
      steps: [
        'Type "alice" into the Username field',
        'Verify the page heading says "Local Form"',
      ],
    })

    expect(result.pass).toBe(true)
    expect(result.assertionStepCount).toBe(1)
    expect(result.falsifiableAssertionCount).toBe(1)
  })

  it('passes on ONE falsifiable assertion beside a vacuous one', () => {
    const result = assertionStrengthGate({
      steps: [
        'Verify the page loaded',
        'Verify the page says "Received!"',
      ],
    })

    expect(result.pass).toBe(true)
    expect(result.assertionStepCount).toBe(2)
    expect(result.falsifiableAssertionCount).toBe(1)
  })

  // 393-06: the reason string is the ONLY place D-12's mixed act-and-verify signal reaches a
  // receipt reader — `StepClassificationRowSchema` is strict and carries no `mixedHit`, and adding
  // one was declined because a bare boolean names nothing the step text does not already show.
  // That makes the reason load-bearing rather than decorative, and it was WRONG here: a mixed step
  // carrying a quoted literal fell through to the "no quoted expected value" fallback, so the
  // durable receipt explained the refusal with a statement contradicted by the step beside it.
  it('says a mixed act-and-verify step was mixed, rather than that it quoted nothing (D-12)', () => {
    const result = assertionStrengthGate({
      steps: ['Verify the page says "Saved" and click Continue'],
    })

    expect(result.pass).toBe(false)
    expect(result.reason).toContain('acts and verifies in one step')
    // The false explanation this case exists to prevent. The step quotes "Saved".
    expect(result.reason).not.toContain('no quoted expected value')
  })

  it('still reports the no-concrete-content cause when that is genuinely why (D-09 clause (ii))', () => {
    // The fallback is not dead — it is the honest answer for an assertion that names nothing,
    // and this pairs with the case above so a fix to one cannot silently swallow the other.
    const result = assertionStrengthGate({ steps: ['Verify the content is correct'] })

    expect(result.pass).toBe(false)
    expect(result.reason).toContain('no quoted expected value')
    expect(result.reason).not.toContain('acts and verifies in one step')
  })

  it('reports the same table classifyDraftSteps does', () => {
    const steps = ['Type "alice" into the Username field', 'Verify the page loaded']

    expect(assertionStrengthGate({ steps }).table).toEqual(classifyDraftSteps(steps))
  })

  it('is deterministic: the same steps give the same answer', () => {
    const steps = ['Type "alice" into the Username field', 'Verify the page says "Received!"']

    expect(assertionStrengthGate({ steps })).toEqual(assertionStrengthGate({ steps }))
  })

  it('an empty draft fails clause (i) rather than throwing', () => {
    expect(assertionStrengthGate({ steps: [] }).pass).toBe(false)
  })
})

describe('evaluateAssertionStrength — the frozen suite projection', () => {
  it('projects the gate boolean and the per-step table onto the frozen contract shape', () => {
    const steps = ['Type "alice" into the Username field', 'Verify the page loaded']
    const result = evaluateAssertionStrength(steps)

    expect(result.falsifiable).toBe(false)
    expect(result.steps.map((entry) => entry.text)).toEqual(steps)
    expect(result.steps.map((entry) => entry.kind)).toEqual(['action', 'assertion'])
    expect(result.steps.map((entry) => entry.captureSignatureHits)).toEqual([[], []])
  })

  it('agrees with assertionStrengthGate on every corpus draft (one projection, one answer)', () => {
    const steps = [
      'Type "alice" into the Username field',
      'Verify the page shows the submission reference "3f9c1ab27d5e4086bb17c2e5a94d0f6b"',
    ]

    expect(evaluateAssertionStrength(steps).falsifiable)
      .toBe(assertionStrengthGate({ steps }).pass)
  })
})

describe('the frozen corpus classes, by literal step text (4180c78b)', () => {
  const CORPUS: ReadonlyArray<{
    readonly draft: string
    readonly expected: boolean
    readonly steps: readonly string[]
  }> = [
    {
      draft: 'accept-control.yaml',
      expected: true,
      steps: [
        'Type "alice" into the Username field',
        'Verify the page heading says "Local Form"',
      ],
    },
    {
      draft: 'assertion-free.yaml',
      expected: false,
      steps: [
        'Type "alice" into the Username field',
        'Type "hunter2" into the Password field',
        'Click the Submit button',
        'Click the "Back to the form" link',
      ],
    },
    {
      draft: 'gate1-indefinitive.yaml',
      expected: true,
      steps: [
        'Open the Reports panel from the top navigation bar',
        'Click the Export report button',
        'Verify the export status banner says "Export complete"',
      ],
    },
    {
      draft: 'gate2-unstable.yaml',
      expected: true,
      steps: ['Verify the page shows the text "Username"'],
    },
    {
      draft: 'gate3-near-duplicate.yaml',
      expected: true,
      steps: [
        'Enter "bob" in the Username field',
        'Enter "correct-horse" in the Password field',
        'Press the Submit button',
        'Verify the page says "Received!"',
      ],
    },
    {
      draft: 'oracle-capture-signature.yaml',
      expected: false,
      steps: [
        'Type "alice" into the Username field',
        'Type "hunter2" into the Password field',
        'Click the Submit button',
        'Verify the page shows the submission reference "3f9c1ab27d5e4086bb17c2e5a94d0f6b"',
      ],
    },
    {
      draft: 'oracle-capture-tautology.yaml',
      expected: false,
      steps: [
        'Type "alice" into the Username field',
        'Verify the Username field contains "alice"',
      ],
    },
    {
      draft: 'page-loaded-only.yaml',
      expected: false,
      steps: [
        'Type "alice" into the Username field',
        'Type "hunter2" into the Password field',
        'Click the Submit button',
        'Click the "Back to the form" link',
        'Verify the page loaded',
      ],
    },
  ]

  it.each(CORPUS)('$draft → falsifiable=$expected', ({ expected, steps }) => {
    expect(evaluateAssertionStrength(steps).falsifiable).toBe(expected)
  })

  it('every inline `expected` above agrees with the frozen table, draft for draft', () => {
    // The literals in CORPUS are a convenience copy; expectations.json is the denominator.
    // This is the assertion that stops the copy from becoming a second answer.
    expect(Object.fromEntries(CORPUS.map((entry) => [entry.draft, entry.expected])))
      .toEqual(Object.fromEntries(
        Object.entries(EXPECTATIONS.drafts)
          .map(([draft, entry]) => [draft, entry.expectedGates.falsifiableAssertion]),
      ))
  })

  // WHAT THIS WALK PROVES, and what it cannot (relabelled 393-12 after the verifier measured it).
  //
  // It proves the FROZEN CORPUS is insensitive to prose casing: title-case every draft's prose and
  // every verdict still equals that draft's own frozen `falsifiableAssertion` column, read from
  // expectations.json rather than an inline boolean so no future edit can be absorbed beside it.
  // That is a real property and worth pinning.
  //
  // It CANNOT observe `namesAnElement`. The verifier reverted the concreteness rule to its
  // pre-393-09 one-liner and re-ran this group alone: 8/8 green with the rule gone. Every
  // `expected: true` draft carries a quoted literal, so `concrete` short-circuits on
  // `literals.length > 0` and the element-name arm is never consulted; every `expected: false`
  // draft is refused by the vacuity, capture-signature or tautology arm in any casing. Its former
  // label ("the regression pin for the WR-06 narrowing … proves the rule cost the denominator
  // nothing") presented it as evidence for a change it is blind to. The pins for the concreteness
  // arm are the constructed casing-loop controls above, which measurably red without the rule.
  it.each(CORPUS)('title-casing $draft — the frozen corpus is casing-insensitive (this walk cannot observe namesAnElement)', ({ draft, steps }) => {
    const frozen = EXPECTATIONS.drafts[draft]?.expectedGates.falsifiableAssertion

    expect(frozen).toBeTypeOf('boolean')
    expect(assertionStrengthGate({ steps: steps.map(titleCaseOutsideQuotes) }).pass).toBe(frozen)
  })

  it('the walk actually recased something, and kept every assertion row an assertion', () => {
    // A no-op helper would make the walk above pass vacuously, which is the one failure mode a
    // case-insensitivity pin cannot afford. Seven of the eight drafts carry an assertion step;
    // `assertion-free.yaml` is the eighth and is walked too, because its frozen `false` must
    // survive recasing as well.
    const recased = CORPUS.filter((entry) =>
      entry.steps.some((step) => titleCaseOutsideQuotes(step) !== step))

    expect(recased).toHaveLength(CORPUS.length)

    for (const entry of CORPUS) {
      expect(classifyDraftSteps(entry.steps.map(titleCaseOutsideQuotes)).map((row) => row.role))
        .toEqual(classifyDraftSteps(entry.steps).map((row) => row.role))
    }
  })

  it('assertion-free classifies EVERY step as an action', () => {
    const draft = CORPUS.find((entry) => entry.draft === 'assertion-free.yaml')

    expect(classifyDraftSteps(draft?.steps ?? []).every((row) => row.role === 'action')).toBe(true)
  })

  it('page-loaded-only holds exactly one assertion row, and it is vacuous', () => {
    const draft = CORPUS.find((entry) => entry.draft === 'page-loaded-only.yaml')
    const assertions = classifyDraftSteps(draft?.steps ?? [])
      .filter((row) => row.role === 'assertion')

    expect(assertions).toHaveLength(1)
    expect(assertions[0]?.vacuityHit).toBe('page loaded')
  })

  it('every row of every draft survives the receipt schema at RUNTIME, not just at compile time', () => {
    // `StepClassificationRowSchema` is `.strict()`, and plan 06 persists these rows inside a
    // `DraftReceipt`. A type annotation is erased; a stray key is not, and it would surface as
    // a refused write one plan downstream rather than as a red here. This is also the assertion
    // that keeps the frozen suite's `text`/`kind` spelling from leaking across the projection
    // into the receipt shape, which the strict schema would refuse by name.
    for (const entry of CORPUS) {
      for (const row of classifyDraftSteps(entry.steps)) {
        expect(StepClassificationRowSchema.safeParse(row).success).toBe(true)
      }
    }
  })

  it('the two oracle-capture drafts fail for DIFFERENT recorded reasons', () => {
    // Same class, two mechanisms. A check that folded both into the boolean would report
    // the same receipt for both and D-10 would be one heuristic, not two.
    const signature = CORPUS.find((entry) => entry.draft === 'oracle-capture-signature.yaml')
    const tautology = CORPUS.find((entry) => entry.draft === 'oracle-capture-tautology.yaml')

    const signatureRows = classifyDraftSteps(signature?.steps ?? [])
    const tautologyRows = classifyDraftSteps(tautology?.steps ?? [])

    expect(signatureRows.some((row) => row.captureSignatureHits.length > 0)).toBe(true)
    expect(signatureRows.some((row) => row.tautologyHit === true)).toBe(false)
    expect(tautologyRows.some((row) => row.tautologyHit === true)).toBe(true)
    expect(tautologyRows.some((row) => row.captureSignatureHits.length > 0)).toBe(false)
  })
})

describe('the lexicons are closed pinned sets (D-09, the 392-16 discipline)', () => {
  it('every lexicon is frozen at its declared membership', () => {
    expect([...ASSERTION_VERBS]).toEqual(['assert', 'check', 'confirm', 'ensure', 'expect', 'verify'])
    expect([...VACUOUS_ASSERTION_PHRASES]).toEqual([
      'it works',
      'no errors',
      'no errors occurred',
      'page appears',
      'page displayed',
      'page is displayed',
      'page loaded',
      'page loads',
      'page works',
    ])
    expect([...EXPECTED_STATE_TERMS]).toEqual([
      'checked',
      'disabled',
      'empty',
      'enabled',
      'hidden',
      'selected',
      'unchecked',
      'visible',
    ])
    expect([...ACTION_VERBS]).toEqual([
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
    ])
    expect([...ELEMENT_NOUNS]).toEqual([
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
    ])
    // The page-whole nouns are absent on purpose, and the absence is what refuses the vacuous
    // claim. A membership rule's omissions fail toward REJECT, so this is the one lexicon whose
    // NON-members are load-bearing in the safe direction rather than the leaky one.
    for (const nonMember of ['app', 'browser', 'content', 'form', 'page', 'screen', 'site']) {
      expect({ nonMember, member: (ELEMENT_NOUNS as readonly string[]).includes(nonMember) })
        .toEqual({ nonMember, member: false })
    }
    expect(CAPTURE_SIGNATURE_PATTERNS.map((entry) => entry.name)).toEqual([
      'iso-8601-timestamp',
      'long-hex',
      'opaque-id',
      'uuid',
    ])
  })

  it('every lexicon is sorted and duplicate-free, so membership is the only reading', () => {
    const lexicons: ReadonlyArray<readonly string[]> = [
      ASSERTION_VERBS,
      VACUOUS_ASSERTION_PHRASES,
      EXPECTED_STATE_TERMS,
      ACTION_VERBS,
      ELEMENT_NOUNS,
      CAPTURE_SIGNATURE_PATTERNS.map((entry) => entry.name),
    ]

    for (const lexicon of lexicons) {
      expect([...lexicon]).toEqual([...new Set(lexicon)].sort())
    }
  })

  it('no vacuity phrase survives as a falsifiable assertion, in any casing', () => {
    // THE CROSS-LEXICON CLOSURE, and it is a guard rather than a restatement.
    //
    // The falsifiability conjunction refuses a vacuous remainder twice over: once because it
    // matched the lexicon, and once because a phrase that names no element in a checkable
    // state is not concrete to begin with. Today the second refusal alone is sufficient for
    // every member — no member contains an EXPECTED_STATE_TERMS token, so `hasExpectedStateTerm`
    // is false for all of them — which is why deleting the vacuity conjunct changes no
    // behaviour on the current lexicons (recorded as surviving mutant M4).
    //
    // 393-13 re-derived which widening triggers it for the INVERTED rule. The casing arm below is
    // not what satisfies `namesAnElement` — the rule is casing-blind, so recasing a member changes
    // nothing — and "page is visible" is refused by the concreteness arm in every casing for a
    // reason that no longer depends on any exclusion list: NO token of it is an ELEMENT_NOUNS
    // member. The member shape that WOULD hand the whole decision to the vacuity conjunct carries
    // both an EXPECTED_STATE_TERMS token AND an ELEMENT_NOUNS member — "banner is visible" remains
    // exactly that shape, so the guard keeps a live trigger across the inversion rather than
    // becoming a promise. Verified by measurement, not by argument: adding that member and deleting
    // the conjunct (393-12, snapshot + `diff` proof) reds this case and this case alone. The three
    // casings are kept because a casing-blind rule is exactly the claim they now check.
    const titleCase = (phrase: string) =>
      phrase.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())

    for (const phrase of VACUOUS_ASSERTION_PHRASES) {
      for (const step of [`Verify ${phrase}`, `Verify the ${phrase}`, `Verify the ${titleCase(phrase)}`]) {
        expect({ step, falsifiable: onlyRow([step]).falsifiable }).toEqual({ step, falsifiable: false })
      }
      expect(onlyRow([`Verify the ${phrase}`]).vacuityHit).toBe(phrase)
    }
  })

  it('every capture-signature pattern is anchored at both ends', () => {
    // An unanchored pattern matches a substring of a longer human sentence, which is how a
    // machine-content heuristic starts rejecting prose.
    for (const entry of CAPTURE_SIGNATURE_PATTERNS) {
      expect(entry.pattern.source.startsWith('^')).toBe(true)
      expect(entry.pattern.source.endsWith('$')).toBe(true)
    }
  })
})
