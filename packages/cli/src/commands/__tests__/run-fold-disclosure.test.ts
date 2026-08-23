// The FOLD and the SENTENCE, composed the way production composes them (401-15, WR-06).
//
// WHY A SECOND FILE WHEN `run-risk.test.ts` ALREADY RANGES THE SENTENCE. That file ranges the three
// values `RunTargetClass` can hold — which is the producer's whole input domain, and is where the
// clause wording is pinned. It cannot range MEMBER SETS, because `foldMostRestrictiveTargetClass`
// lives in the CLI and `agent-local` may not import the CLI. The property WR-06 is really about is
// a property of the pair: no member set carrying a shared or undeclared member may render the
// sentence that invites a person to approve the run as an all-local one. Measuring that needs both
// halves in one road, and this is the only package that can hold both.
//
// A second spelling of the fold is deliberately absent. Both functions are IMPORTED — a mini-fold
// written here would be the second spelling of a security fold that `run.ts` says out loud must
// not exist, and it would agree with itself rather than with production.

import { describe, expect, it } from 'vitest'

import { buildRunDisclosure } from '@vostride/agent-qa-agent-local'
import type { RunTargetClass } from '@vostride/agent-qa-agent-local'

import { foldMostRestrictiveTargetClass } from '../run.js'

/** The clause that says the declaration covers EVERY member — reachable from one fold answer. */
const ALL_LOCAL_CLAUSE = 'declared: every target local'

/**
 * Every member set over the three declarations, up to length two, plus the empty set.
 *
 * Enumerated rather than sampled: the set is small enough to be complete, and a sampled corpus is
 * how the one combination that mislabels stays unmeasured — `[shared, undefined]` is exactly the
 * combination UAT test 4 found, and it is the one a hand-picked list is most likely to skip.
 */
const DECLARATIONS: readonly RunTargetClass[] = ['local', 'shared', undefined]
const MEMBER_SETS: readonly (readonly RunTargetClass[])[] = [
  [],
  ...DECLARATIONS.map((one) => [one]),
  ...DECLARATIONS.flatMap((first) => DECLARATIONS.map((second) => [first, second])),
]

function namesFor(members: readonly RunTargetClass[]): string[] {
  return members.map((member, index) => `${member ?? 'undeclared'}-${index}`)
}

describe('no member set with a shared or undeclared member can render the all-local sentence', () => {
  it.each(MEMBER_SETS.map((members) => ({ members, label: JSON.stringify(members) })))(
    'members $label',
    ({ members }) => {
      const folded = foldMostRestrictiveTargetClass(members)
      const sentence = buildRunDisclosure(folded, namesFor(members))
      const everyMemberLocal = members.length > 0 && members.every((member) => member === 'local')

      // The whole claim, in one line: the all-local sentence appears for exactly the sets whose
      // every member really is declared local, and for no other set at all.
      expect(sentence.includes(ALL_LOCAL_CLAUSE), sentence).toBe(everyMemberLocal)
    },
  )

  it('the mixed [shared, undeclared] set never describes the declared-shared member as undeclared', () => {
    // The measured defect's own member set, driven through the production fold rather than through
    // a class this file chose: the fold is what answers `undefined` here, and reading the answer
    // off the fold is what makes this cell about the pair rather than about one function.
    const members: readonly RunTargetClass[] = ['shared', undefined]
    const folded = foldMostRestrictiveTargetClass(members)
    expect(folded).toBeUndefined()

    const sentence = buildRunDisclosure(folded, ['staging', 'weird'])

    expect(sentence).toContain('staging')
    expect(sentence).toContain('weird')
    expect(sentence).toContain('declared: at least one target undeclared, which classifies as shared')
    // No clause asserts an environment FOR THE SET — the shipped form this ruling refused.
    expect(sentence).not.toContain('environment: ')
  })
})
