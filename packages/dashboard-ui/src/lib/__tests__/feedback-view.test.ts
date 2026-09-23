// THE THREE CHOICES, ORDERED BY THE TARGET'S OWN RECORDED RESULT (426-02 · D-11, D-12, D-14).
//
// A failed target offers "This should have passed" first and a passed target offers "This should have
// failed" first, because the likelier correction is the one that contradicts what was recorded. The
// order is keyed to the TARGET — a step reads its own verifier verdict, a test its own outcome — never
// to the run as a whole and never to a guess at the tester's answer. These cells pin that rule, the
// meaning line under each choice, and the closed sets, by their exported constants; the only literal
// prose here is the locked label copy (SC2) and the S4 meaning table the spec fixes verbatim.

import { describe, expect, it } from 'vitest'
import type { Mark, RunDetailMember, RunDetailStep } from '@vostride/agent-qa-schema'

import { UNNAMED_STEP_LABEL } from '@/lib/display-step'
import {
  CHOICE_LABELS,
  CHOICE_LEGEND,
  CHOICE_MEANINGS,
  FEEDBACK_CHOICE_ORDER,
  FEEDBACK_COMPOSER_STATES,
  FEEDBACK_ENTRY_SCOPES,
  FEEDBACK_ENTRY_TEST_LABEL,
  FEEDBACK_OUTCOME_CLASSES,
  NO_STEP_VERDICT_TEXT,
  ONE_STEP_SCOPE_TEXT,
  RECORDED_RESULT_TEXT,
  WHOLE_TEST_SCOPE_TEXT,
  composerHeading,
  feedbackEntryLabel,
  feedbackOutcomeClass,
  feedbackPartsText,
  feedbackTargetView,
  memberOutcomeClass,
  scopeLine,
} from '@/lib/feedback-view'
import { memberDisplayName, memberHandleLabel } from '@/lib/run-detail-view'

const MARKS: readonly Mark[] = ['false-fail', 'false-pass', 'confirmed-bug']

function member(outcome?: RunDetailMember['outcome']): Pick<RunDetailMember, 'outcome'> {
  return outcome === undefined ? {} : { outcome }
}

function step(pass: boolean | undefined): Pick<RunDetailStep, 'verifierVerdict'> {
  return (pass === undefined ? {} : { verifierVerdict: { pass, reasoning: '' } }) as Pick<RunDetailStep, 'verifierVerdict'>
}

describe('426-02 choice order and meaning', () => {
  it('CHOICE-LABELS-EXACT: the three labels are the locked plain-language copy, keyed by exactly the marks', () => {
    expect(CHOICE_LABELS).toEqual({
      'false-fail': 'This should have passed',
      'false-pass': 'This should have failed',
      'confirmed-bug': 'This is a real product bug',
    })
    expect(Object.keys(CHOICE_LABELS).sort()).toEqual([...MARKS].sort())
  })

  it('CHOICE-ORDER-FAILED: a failed target offers should-have-passed, real bug, should-have-failed', () => {
    expect(FEEDBACK_CHOICE_ORDER.failed.map((kind) => CHOICE_LABELS[kind])).toEqual([
      CHOICE_LABELS['false-fail'],
      CHOICE_LABELS['confirmed-bug'],
      CHOICE_LABELS['false-pass'],
    ])
  })

  it('CHOICE-ORDER-PASSED: a passed target offers should-have-failed, real bug, should-have-passed', () => {
    expect(FEEDBACK_CHOICE_ORDER.passed.map((kind) => CHOICE_LABELS[kind])).toEqual([
      CHOICE_LABELS['false-pass'],
      CHOICE_LABELS['confirmed-bug'],
      CHOICE_LABELS['false-fail'],
    ])
  })

  it('CHOICE-ORDER-HEALED-TIMEOUT: healed counts as passed; timed out, cancelled and skipped count as failed', () => {
    expect(memberOutcomeClass('passed')).toBe('passed')
    expect(memberOutcomeClass('healed')).toBe('passed')
    expect(memberOutcomeClass('failed')).toBe('failed')
    expect(memberOutcomeClass('timeout')).toBe('failed')
    expect(memberOutcomeClass('cancelled')).toBe('failed')
    expect(memberOutcomeClass('skipped')).toBe('failed')
  })

  it('OUTCOME-CLASS-FALLBACK: no outcome takes the run status class, else failed; a step reads its own verdict, else its test', () => {
    expect(feedbackOutcomeClass({ member: member(), runStatus: 'passed' })).toBe('passed')
    expect(feedbackOutcomeClass({ member: member(), runStatus: 'healed' })).toBe('passed')
    expect(feedbackOutcomeClass({ member: member(), runStatus: 'failed' })).toBe('failed')
    expect(feedbackOutcomeClass({ member: member(), runStatus: 'running' })).toBe('failed')
    expect(feedbackOutcomeClass({ member: member(), runStatus: undefined })).toBe('failed')
    expect(feedbackOutcomeClass({ member: undefined, runStatus: 'passed' })).toBe('passed')
    expect(feedbackOutcomeClass({ member: member('failed'), runStatus: 'passed' })).toBe('failed')

    expect(feedbackOutcomeClass({ member: member('failed'), step: step(true), runStatus: 'failed' })).toBe('passed')
    expect(feedbackOutcomeClass({ member: member('passed'), step: step(false), runStatus: 'passed' })).toBe('failed')
    expect(feedbackOutcomeClass({ member: member('healed'), step: step(undefined), runStatus: 'failed' })).toBe('passed')
    expect(feedbackOutcomeClass({ member: member('skipped'), step: step(undefined), runStatus: 'passed' })).toBe('failed')
    expect(feedbackOutcomeClass({ member: member(), step: step(undefined), runStatus: 'passed' })).toBe('passed')
  })

  it('CHOICE-MEANINGS-TOTAL: every class carries a meaning for every mark, and the failed row is the S4 table', () => {
    expect(Object.keys(CHOICE_MEANINGS).sort()).toEqual([...FEEDBACK_OUTCOME_CLASSES].sort())
    for (const cls of FEEDBACK_OUTCOME_CLASSES) {
      expect(Object.keys(CHOICE_MEANINGS[cls]).sort()).toEqual([...MARKS].sort())
      for (const kind of MARKS) expect(CHOICE_MEANINGS[cls][kind].trim()).not.toBe('')
    }
    expect(CHOICE_MEANINGS.failed).toEqual({
      'false-fail': 'The app behaved correctly; the test was wrong to fail.',
      'confirmed-bug': 'The failure is real — the app is broken here.',
      'false-pass': 'The test missed a problem it should have caught.',
    })
    expect(new Set(MARKS.map((kind) => CHOICE_MEANINGS.passed[kind])).size).toBe(3)
    expect(CHOICE_LEGEND.trim()).not.toBe('')
  })

  it('CLOSED-SETS-RUNTIME: the outcome classes and composer states are exactly the published sets', () => {
    expect(FEEDBACK_OUTCOME_CLASSES).toEqual(['passed', 'failed'])
    expect(FEEDBACK_COMPOSER_STATES).toEqual(['composing', 'submitting', 'awaiting-approval', 'recorded', 'retained'])
    expect(Object.keys(FEEDBACK_CHOICE_ORDER).sort()).toEqual([...FEEDBACK_OUTCOME_CLASSES].sort())
    for (const cls of FEEDBACK_OUTCOME_CLASSES) {
      expect([...FEEDBACK_CHOICE_ORDER[cls]].sort()).toEqual([...MARKS].sort())
    }
  })
})

describe('426-02 the composer names its target', () => {
  const checkout = { testIndex: 1, name: 'checkout', outcome: 'failed' } as const
  const coupon = { stepIndex: 2, stepText: 'apply coupon', verifierVerdict: { pass: true, reasoning: '' } }

  it('COMPOSER-HEADING: a step, a test in a suite and a single-test run each get their own heading parts', () => {
    expect(composerHeading({ member: checkout, step: coupon, stepCount: 5, suite: true })).toEqual({
      prefix: 'Feedback on step 3 of 5 · ',
      name: 'apply coupon',
    })
    expect(composerHeading({ member: checkout, step: coupon, stepCount: 5, suite: false })).toEqual({
      prefix: 'Feedback on step 3 of 5 · ',
      name: 'apply coupon',
    })
    expect(composerHeading({ member: checkout, stepCount: 5, suite: true })).toEqual({
      prefix: 'Feedback on ',
      name: memberDisplayName(checkout),
      suffix: ` ${memberHandleLabel(1)}`,
    })
    expect(composerHeading({ member: checkout, stepCount: 5, suite: false })).toEqual({
      prefix: 'Feedback on ',
      name: memberDisplayName(checkout),
    })
    expect(composerHeading({ member: checkout, step: { stepIndex: 0 }, stepCount: 1, suite: false }).name).toBe(UNNAMED_STEP_LABEL)
    expect(feedbackPartsText({ prefix: 'a', name: 'b', suffix: 'c' })).toBe('abc')
    expect(feedbackPartsText({ prefix: 'a' })).toBe('a')

    const detail = {
      members: [{ testIndex: 0, attempts: 1 }, { testIndex: 1, attempts: 1, totalSteps: 7 }],
      steps: [0, 1, 2].map((stepIndex) => ({ testIndex: 0, stepIndex, cacheStatus: 'miss', verifierVerdict: { pass: true, reasoning: '' }, selfHealOccurred: false, briefDigest: 'd' }) as const),
    }
    expect(feedbackPartsText(feedbackTargetView({ detail, target: { testIndex: 0, stepIndex: 1 }, runStatus: 'passed' }).heading))
      .toBe(`Feedback on step 2 of 3 · ${UNNAMED_STEP_LABEL}`)
    expect(feedbackPartsText(feedbackTargetView({ detail, target: { testIndex: 1, stepIndex: 0 }, runStatus: 'passed' }).heading))
      .toBe(`Feedback on step 1 of 7 · ${UNNAMED_STEP_LABEL}`)
  })

  it('SCOPE-LINE: whole test or one step, the suite step naming its test, then the target recorded result', () => {
    const passedStep = { ...coupon, status: 'passed' as const }
    expect(feedbackPartsText(scopeLine({ member: checkout, suite: true, runStatus: 'failed' })))
      .toBe(`${WHOLE_TEST_SCOPE_TEXT} · ${RECORDED_RESULT_TEXT.failed}`)
    expect(scopeLine({ member: checkout, step: passedStep, suite: true, runStatus: 'failed' })).toEqual({
      prefix: `${ONE_STEP_SCOPE_TEXT} in `,
      name: memberDisplayName(checkout),
      suffix: ` ${memberHandleLabel(1)} · ${RECORDED_RESULT_TEXT.passed}`,
    })
    expect(feedbackPartsText(scopeLine({ member: checkout, step: passedStep, suite: false, runStatus: 'failed' })))
      .toBe(`${ONE_STEP_SCOPE_TEXT} · ${RECORDED_RESULT_TEXT.passed}`)
    expect(feedbackPartsText(scopeLine({ member: checkout, step: { ...coupon, status: 'healed' }, suite: false, runStatus: 'failed' })))
      .toBe(`${ONE_STEP_SCOPE_TEXT} · ${RECORDED_RESULT_TEXT.healed}`)
    expect(feedbackPartsText(scopeLine({ member: checkout, step: { ...coupon, status: 'failed' }, suite: false, runStatus: 'failed' })))
      .toBe(`${ONE_STEP_SCOPE_TEXT} · ${RECORDED_RESULT_TEXT.passed}`)
    expect(feedbackPartsText(scopeLine({ member: { ...checkout, outcome: 'timeout' }, step: { stepIndex: 2 }, suite: false, runStatus: 'failed' })))
      .toBe(`${ONE_STEP_SCOPE_TEXT} · ${NO_STEP_VERDICT_TEXT(RECORDED_RESULT_TEXT.timeout)}`)
    expect(feedbackPartsText(scopeLine({ member: { testIndex: 0 }, suite: false, runStatus: 'healed' })))
      .toBe(`${WHOLE_TEST_SCOPE_TEXT} · ${RECORDED_RESULT_TEXT.healed}`)
    expect(feedbackPartsText(scopeLine({ member: { testIndex: 0 }, suite: false, runStatus: 'running' })))
      .toBe(`${WHOLE_TEST_SCOPE_TEXT} · ${RECORDED_RESULT_TEXT.failed}`)
  })

  it('RECORDED-RESULT-ROWS: one row per member outcome, each counting as the class the order uses', () => {
    expect(RECORDED_RESULT_TEXT).toEqual({
      passed: 'recorded: passed',
      healed: 'recorded: healed — counts as passed',
      failed: 'recorded: failed',
      timeout: 'recorded: timed out — counts as failed',
      cancelled: 'recorded: cancelled — counts as failed',
      skipped: 'recorded: skipped — counts as failed',
    })
    for (const [outcome, text] of Object.entries(RECORDED_RESULT_TEXT)) {
      expect(text.endsWith(memberOutcomeClass(outcome as keyof typeof RECORDED_RESULT_TEXT))).toBe(true)
    }
    expect(NO_STEP_VERDICT_TEXT(RECORDED_RESULT_TEXT.failed))
      .toBe("no step verdict recorded — using the test's result (recorded: failed)")
  })
})

describe('426-03 the header entry names itself', () => {
  it('ENTRY-SCOPES-RUNTIME: the entry scopes are exactly test and step', () => {
    expect([...FEEDBACK_ENTRY_SCOPES]).toEqual(['test', 'step'])
  })

  it('ENTRY-LABEL: a step, a single test and a suite test each name their target, with the plain marked suffix', () => {
    expect(feedbackEntryLabel({ scope: 'step', stepNumber: 3 })).toBe('Give feedback on step 3')
    expect(feedbackEntryLabel({ scope: 'test' })).toBe(FEEDBACK_ENTRY_TEST_LABEL)
    expect(feedbackEntryLabel({ scope: 'test', memberName: 'Checkout', handle: '#2' })).toBe('Give feedback on Checkout #2')
    expect(feedbackEntryLabel({ scope: 'test', markedChoice: 'false-fail' })).toBe(
      `${FEEDBACK_ENTRY_TEST_LABEL} — already marked: ${CHOICE_LABELS['false-fail']}`,
    )
    expect(feedbackEntryLabel({ scope: 'step', stepNumber: 1, markedChoice: 'confirmed-bug' })).toBe(
      `Give feedback on step 1 — already marked: ${CHOICE_LABELS['confirmed-bug']}`,
    )
  })
})
