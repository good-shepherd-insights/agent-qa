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

import {
  CHOICE_LABELS,
  CHOICE_LEGEND,
  CHOICE_MEANINGS,
  FEEDBACK_CHOICE_ORDER,
  FEEDBACK_COMPOSER_STATES,
  FEEDBACK_OUTCOME_CLASSES,
  feedbackOutcomeClass,
  memberOutcomeClass,
} from '@/lib/feedback-view'

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
