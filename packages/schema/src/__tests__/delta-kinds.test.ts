import { describe, expect, it } from 'vitest'
import { DELTA_KINDS } from '../delta/delta'

/**
 * The second of two walls around the §7.3 delta vocabulary (409 D-04, "two walls, both read").
 * The first is the type-level bar `Extract<Delta, { kind: 'FileIssue' }>` is `never`, kept in
 * `delta.test-d.ts` and `seam-root.test-d.ts`; a member widened into this projection through a
 * cast satisfies the compiler, walks past that bar and REDs only here, by name.
 *
 * 2026-09-01 (Phase 409): the second delta vocabulary left with the Issue-slot cleanup — see
 * `DELETION-INVENTORY.md`.
 */

const SIX_SHIPPED_KINDS = ['Add', 'Confirm', 'Supersede', 'Deprecate', 'MintUnknown', 'Noop']

describe('the §7.3 delta vocabulary (D-04 runtime wall)', () => {
  it('declares exactly the six §7.3 delta kinds, in declaration order', () => {
    // Declaration order, not sorted: `DELTA_KINDS` is an authored array, so the order is part of
    // what it claims. Listed rather than counted so the RED says WHAT joined or left.
    expect([...DELTA_KINDS]).toEqual(SIX_SHIPPED_KINDS)
  })
})
