// The three widened corpus closed sets, pinned at runtime (414 D-22).
//
// WHY A RUNTIME CELL BESIDE THE COMPILE WALL. `CORPUS_SPLITS`,
// `HELD_OUT_VISIBILITIES` and `GENERATOR_KINDS` each carry
// `as const satisfies readonly <T>[]`, so an entry naming no member of its
// type is a compile error — but `vitest` TRANSFORMS without typechecking, so
// a member REMOVED from both the type and its array would slip past
// `satisfies` entirely. These cells read the arrays at runtime, which is what
// makes removing `held-out` or `adversarial` RED a named cell rather than
// only failing a separate `tsc` run somebody might not have executed. The
// companion never-bars live in `corpus-entry.test-d.ts`, and the mutation
// measurement is `scripts/414-split-mutation.sh`.
//
// The lists are HAND-SPELLED and compared in DECLARATION order — never
// `toContain`, never `.length`. Declaration order is part of what an authored
// array claims, and spelling the members out is what makes the RED say WHAT
// joined or left instead of only that a count moved.
//
// The imports are RELATIVE on purpose: the cells read `src`, so a mutation
// and its measurement need no `dist` rebuild between them.
import { describe, expect, it } from 'vitest'
import { CORPUS_SPLITS, GENERATOR_KINDS, HELD_OUT_VISIBILITIES } from '../corpus-entry'

describe('414 D-22 — the widened corpus closed sets (v54 runtime wall)', () => {
  it('declares exactly the three corpus splits, in declaration order', () => {
    expect([...CORPUS_SPLITS]).toEqual(['natural', 'held-out', 'adversarial'])
  })

  it('declares exactly the two held-out visibilities, in declaration order', () => {
    expect([...HELD_OUT_VISIBILITIES]).toEqual(['shared', 'private'])
  })

  it('declares exactly the six generator kinds, in declaration order', () => {
    // Kept on ONE line so the plan's literal-list grep and the mutation
    // script's red-parser both read the six members verbatim.
    // prettier-ignore
    expect([...GENERATOR_KINDS]).toEqual(['fuzz-selector', 'fuzz-label', 'fuzz-error', 'injection-name', 'optimized-trigger', 'judge-targeted'])
  })
})
