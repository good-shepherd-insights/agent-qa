// The FOLD over a run's member target classes (401-15, WR-06) — RE-SPELLED 2026-10-01 (432-19, D-14).
//
// This file composed the fold with `buildRunDisclosure`, the sentence a person was asked to approve
// a run on, to prove that no member set carrying a shared or undeclared member could render the
// all-local clause. The approval prompt and its sentence are deleted (D-14), so the pair is gone;
// the FOLD stays, because it is what the production refusal reads (D-18). The property is restated
// on the fold's own answer: it says `local` for exactly the sets whose every member is declared
// local, `production` whenever any member is, and fails toward undeclared otherwise.
//
// A second spelling of the fold is deliberately absent. It is IMPORTED — a mini-fold written here
// would be the second spelling of a security fold that `run.ts` says out loud must not exist.

import { describe, expect, it } from 'vitest'

import type { RunTargetClass } from '@vostride/agent-qa-agent-local'

import { foldMostRestrictiveTargetClass } from '../run.js'


/**
 * Every member set over the declarations, up to length two, plus the empty set. (432-03 added
 * `production`, the fourth declaration, so the enumeration still ranges the whole type.)
 *
 * Enumerated rather than sampled: the set is small enough to be complete, and a sampled corpus is
 * how the one combination that mislabels stays unmeasured — `[shared, undefined]` is exactly the
 * combination UAT test 4 found, and it is the one a hand-picked list is most likely to skip.
 */
const DECLARATIONS: readonly RunTargetClass[] = ['local', 'shared', 'production', undefined]
const MEMBER_SETS: readonly (readonly RunTargetClass[])[] = [
  [],
  ...DECLARATIONS.map((one) => [one]),
  ...DECLARATIONS.flatMap((first) => DECLARATIONS.map((second) => [first, second])),
]

describe('no member set with a shared or undeclared member folds to local', () => {
  it('a production member makes the fold production (432-03, D-18)', () => {
    for (const members of [['production'], ['local', 'production'], [undefined, 'production', 'shared']] as const) {
      expect(foldMostRestrictiveTargetClass(members), JSON.stringify(members)).toBe('production')
    }
  })

  it.each(MEMBER_SETS.map((members) => ({ members, label: JSON.stringify(members) })))(
    'members $label',
    ({ members }) => {
      const folded = foldMostRestrictiveTargetClass(members)
      const everyMemberLocal = members.length > 0 && members.every((member) => member === 'local')

      // The whole claim, in one line: the fold answers `local` for exactly the sets whose every
      // member really is declared local, and for no other set at all.
      expect(folded === 'local', JSON.stringify(members)).toBe(everyMemberLocal)
      // And a production member is never hidden behind its siblings.
      if (members.includes('production')) expect(folded).toBe('production')
    },
  )

  it('the mixed [shared, undeclared] set folds to undeclared, never to shared or local', () => {
    const members: readonly RunTargetClass[] = ['shared', undefined]
    expect(foldMostRestrictiveTargetClass(members)).toBeUndefined()
  })
})

/**
 * THE ARM THE ENUMERATION ABOVE CANNOT REACH (401-19, WR-02).
 *
 * `MEMBER_SETS` ranges `RunTargetClass`, which is the whole domain the TYPE admits — and the whole
 * domain the CONFIG can produce, because any other `environment` is refused at config load. This
 * arm is about the input that arrives anyway. (432-03: `production` joined the enum and outranks
 * every class in the fold, so the stranger here is `staging`, which the enum still refuses.)
 *
 * IT IS THE LIBRARY-EMBEDDING SCENARIO, AND IT CANNOT BE DRIVEN THROUGH A SHIPPED DOOR. Saying so
 * is the point: `resolveTarget` reads `(config as any).registry?.targets` and returns
 * `targets[targetName] as TargetEntry` with no runtime check of its own (targets.ts:35-53), so a
 * host that BUILDS a config object in memory — rather than loading one off disk through the
 * validating reader — puts any string it likes on `environment`, and the fold is the next thing to
 * see it. A cell that claimed a CLI invocation produced this would be false; the arm is constructed
 * directly against the exported fold for exactly that reason.
 */
describe('a declaration the enum forbids takes the fail-closed answer, never `local` (401-19, WR-02)', () => {
  const STRANGER = 'staging' as unknown as RunTargetClass

  it('a stranger beside a local member does not make the invocation local', () => {
    expect(foldMostRestrictiveTargetClass(['local', STRANGER])).toBeUndefined()
  })

  it('a stranger alone does not make the invocation local', () => {
    expect(foldMostRestrictiveTargetClass([STRANGER])).toBeUndefined()
  })

  // RE-SPELLED 2026-10-01 (432-19) from 'and the answer it takes renders the undeclared clause,
  // which classifies as shared'. The sentence is deleted; the answer is still never `local`.
  it('and the answer it takes is never local or production', () => {
    const folded = foldMostRestrictiveTargetClass(['local', STRANGER])
    expect(folded).not.toBe('local')
    expect(folded).not.toBe('production')
  })
})
