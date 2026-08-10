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

import { StepClassificationRowSchema } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import {
  ACTION_VERBS,
  ASSERTION_VERBS,
  CAPTURE_SIGNATURE_PATTERNS,
  EXPECTED_STATE_TERMS,
  VACUOUS_ASSERTION_PHRASES,
  assertionStrengthGate,
  classifyDraftSteps,
  evaluateAssertionStrength,
} from '../assertion-strength.js'

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
    // The title-cased arm is what makes this a live guard instead of a comment: it satisfies
    // `namesAnElement`, so the FIRST member that ever carries a state term ("page is visible"
    // is the obvious candidate) makes the concreteness arm answer true and hands the whole
    // decision to the vacuity conjunct. Verified by construction, not by argument — adding
    // such a member and deleting the conjunct reds this case.
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
