// 2026-10-11 (439-02, D-07): the per-condition verdict block's key sets and the loader's
// present-implies-valid clause. Every expected set is spelled by hand, never derived from the
// module under test.
import { readFileSync } from 'node:fs'

import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  CONDITION_RECORD_KEYS,
  CONDITION_VERDICTS,
  CONDITION_VERDICTS_EVIDENCE_KEYS,
  CURRENT_HANDOFF_SCHEMA_VERSION,
  guardCompletedRunHandoff,
} from '../index'
import type {
  CompletedRunHandoff,
  ConditionRecord,
  ConditionVerdict,
  ConditionVerdictsEvidence,
} from '../index'

const preChangeHandoff = new URL(
  '../../../../test-fixtures/legacy-handoff/handoff.json',
  import.meta.url,
)

function wellFormed(): ConditionVerdictsEvidence {
  return {
    ending: 'completion',
    conditions: [
      {
        quote: 'Save the setting',
        verdict: 'unverified',
        judged: 'met',
        guard: 'citation-missing',
        needs: 'persistence',
        reason: 'no cited evidence was found in what the verifier was given',
        citations: [
          { source: 'final-screen', quote: 'Saved', found: false },
          { source: 'screenshot', quote: 'green tick', found: 'unchecked' },
        ],
        file: { name: 'match', content: 'differs', firstDifference: 'line 2' },
      },
      { quote: 'setting', verdict: 'met', reason: 'shown', citations: [] },
    ],
    openDialogs: [{ name: 'Cookies', account: 'unrelated' }],
  }
}

function handoffWith(block: unknown): unknown {
  const handoff = JSON.parse(readFileSync(preChangeHandoff, 'utf8')) as CompletedRunHandoff
  const step = handoff.tests[0].steps[0] as unknown as Record<string, unknown>
  if (block !== undefined) step.conditionVerdicts = block
  return JSON.parse(JSON.stringify(handoff))
}

describe('C439-KEY-SETS', () => {
  it('a condition record carries exactly its eight members', () => {
    expect([...CONDITION_RECORD_KEYS].sort()).toEqual([
      'citations',
      'file',
      'guard',
      'judged',
      'needs',
      'quote',
      'reason',
      'verdict',
    ])
    expectTypeOf<keyof ConditionRecord>().toEqualTypeOf<(typeof CONDITION_RECORD_KEYS)[number]>()
  })

  it('the block carries exactly ending, conditions and openDialogs', () => {
    expect([...CONDITION_VERDICTS_EVIDENCE_KEYS].sort()).toEqual([
      'conditions',
      'ending',
      'openDialogs',
    ])
    expectTypeOf<keyof ConditionVerdictsEvidence>().toEqualTypeOf<
      (typeof CONDITION_VERDICTS_EVIDENCE_KEYS)[number]
    >()
  })

  it('a condition verdict is exactly met, not-met, unverified or inconclusive', () => {
    expect([...CONDITION_VERDICTS].sort()).toEqual(['inconclusive', 'met', 'not-met', 'unverified'])
    expectTypeOf<ConditionVerdict>().toEqualTypeOf<
      'met' | 'not-met' | 'unverified' | 'inconclusive'
    >()
  })

  it('the handoff schema version is 2 and a handoff stamped 7 still reads', () => {
    expect(CURRENT_HANDOFF_SCHEMA_VERSION).toBe(2)
    const handoff = JSON.parse(readFileSync(preChangeHandoff, 'utf8')) as CompletedRunHandoff
    expect(handoff.schemaVersion).toBe(7)
    expect(guardCompletedRunHandoff(handoff)).toBe(handoff)
  })

  it('a handoff whose step carries a well-formed block loads', () => {
    const loaded = guardCompletedRunHandoff(handoffWith(wellFormed()))
    expect(loaded.tests[0].steps[0].conditionVerdicts).toEqual(wellFormed())
  })

  it('a block whose conditions are not an array is refused', () => {
    expect(() => guardCompletedRunHandoff(handoffWith({ ...wellFormed(), conditions: 'x' }))).toThrow()
  })

  it('a block with an unknown verdict literal is refused', () => {
    const block = wellFormed()
    ;(block.conditions[1] as unknown as Record<string, unknown>).verdict = 'passed'
    expect(() => guardCompletedRunHandoff(handoffWith(block))).toThrow()
  })

  it("a citation whose found is 'maybe' is refused", () => {
    const block = wellFormed()
    ;(block.conditions[0].citations[0] as unknown as Record<string, unknown>).found = 'maybe'
    expect(() => guardCompletedRunHandoff(handoffWith(block))).toThrow()
  })

  it('a handoff with no block loads unchanged', () => {
    const input = handoffWith(undefined)
    const loaded = guardCompletedRunHandoff(JSON.parse(JSON.stringify(input)))
    expect(loaded).toEqual(input)
    expect('conditionVerdicts' in loaded.tests[0].steps[0]).toBe(false)
  })
})
