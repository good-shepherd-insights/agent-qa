// The five entity kinds, pinned at runtime (Phase 410, ENTY-03 / D-01 / D-02 / D-03).
//
// WHY A RUNTIME PIN BESIDE THE COMPILE WALL. Every per-kind table in this directory carries
// `as const satisfies Record<EntityKind, …>`, so a row for a kind that is not in the array is
// a type error — but `vitest` TRANSFORMS without typechecking, so nothing in this package's
// suite would notice a row smuggled past `satisfies` with a cast. The cells below read the
// key SET at runtime, which is what makes "re-adding the sixth entity kind" RED a named cell
// instead of only failing a separate `tsc` run somebody might not have executed.
//
// The imports are RELATIVE on purpose (the `url.test.ts` shape): the cells read `src`, so a
// mutation and its measurement need no `dist` rebuild between them.

import { describe, expect, it } from 'vitest'

import { ENTITY_STATUSES, ENTITY_IDENTITY_FACT_LABELS } from '../entity-card'
import { ENTITY_DASHBOARD_ROUTES } from '../dashboard-route'
import { ENTITY_KINDS, ENTITY_URI_SEGMENTS, SLUG_ADDRESSED_ENTITY_KINDS } from '../kinds'
import { ENTITY_NO_MATCH_REASONS } from '../resolution'

/** The vocabulary, spelled once by hand — the denominator every cell below joins against. */
const FIVE = ['TST', 'RUN', 'MEM', 'POL', 'TGT'] as const

const TABLES = {
  ENTITY_URI_SEGMENTS,
  SLUG_ADDRESSED_ENTITY_KINDS,
  ENTITY_STATUSES,
  ENTITY_IDENTITY_FACT_LABELS,
  ENTITY_DASHBOARD_ROUTES,
} as const

describe('the five entity kinds, closed (410 ENTY-03)', () => {
  // UNSORTED: the array's order IS the canonical listing order (D-02), so a reordering is a
  // change to a published fact and reds here rather than being normalised away.
  it('spells exactly the five kinds in declaration order', () => {
    expect([...ENTITY_KINDS]).toEqual([...FIVE])
  })

  for (const [name, table] of Object.entries(TABLES)) {
    // The KEY-SET reading. Exact list equality, never containment and never a count: a table
    // holding less fails this as loudly as a table holding more.
    it(`${name} has exactly the five kinds as keys`, () => {
      expect(Object.keys(table).sort()).toEqual([...FIVE].sort())
    })
  }

  it('resolves to nothing for exactly two reasons, in declaration order', () => {
    expect([...ENTITY_NO_MATCH_REASONS]).toEqual(['unknown-address', 'no-match'])
  })
})
