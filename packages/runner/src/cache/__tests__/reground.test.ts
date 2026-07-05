// Revised to D-12 semantics (Phase 357 Wave 0). The 356 seam re-derives a fresh ref
// from a role+nameNormalized(+ordinal) descriptor against a fresh observation, but the
// first-pick behavior is DELETED: ambiguity (≥2 candidates with no uniquely-selecting
// ordinal) collapses to null on the cache path (invalidate → replan, Q4) — never a
// first-pick — while benign name drift is now rescued by the substring rung (D-12a).
// The seam contract is unchanged: reground(locator, elements) => Ref | null, where null
// is the fall-through-to-replan signal. Knowingly RED until Plan 03 lands the upgraded
// matcher body behind this same GroundingStrategy contract.
import { describe, expect, it } from 'vitest'

import { asRef } from '@vostride/agent-qa-schema'
import type { ElementInfo } from '@vostride/agent-qa-schema'

import { deterministicDescriptorMatcher } from '../reground.js'
import type { GroundingStrategy } from '../reground.js'
import type { GroundedLocator } from '../value.js'

function element(ref: string, role: string, nameNormalized: string): ElementInfo {
  return {
    ref: asRef(ref),
    role,
    name: nameNormalized,
    nameNormalized,
    state: { enabled: true, focused: false, visible: true },
    labels: {},
    attributes: {},
  }
}

// Structural conformance to the thin GroundingStrategy seam (Phase 357 absorbs it).
const matcher: GroundingStrategy = deterministicDescriptorMatcher

describe('deterministicDescriptorMatcher.reground (D-12 — one matcher, ambiguity never picks)', () => {
  it('returns the fresh ref when exactly one element matches role+nameNormalized', () => {
    const elements = [element('e1', 'button', 'checkout'), element('e2', 'link', 'help')]
    const locator: GroundedLocator = { role: 'button', nameNormalized: 'checkout' }

    expect(matcher.reground(locator, elements)).toBe(elements[0].ref)
  })

  it('returns null for a multi-candidate set with NO ordinal — ambiguity collapses to replan (Q4), never a first-pick', () => {
    const elements = [element('e1', 'button', 'add'), element('e2', 'button', 'add')]

    // D-12 deletes the 356 `matches[ordinal ?? 0]` first-pick: no unique selector ⇒ null.
    expect(matcher.reground({ role: 'button', nameNormalized: 'add' }, elements)).toBeNull()
  })

  it('still selects by ordinal within the surviving set; an ordinal beyond the set is null', () => {
    const elements = [element('e1', 'button', 'add'), element('e2', 'button', 'add')]

    expect(matcher.reground({ role: 'button', nameNormalized: 'add', ordinal: 0 }, elements)).toBe(elements[0].ref)
    expect(matcher.reground({ role: 'button', nameNormalized: 'add', ordinal: 1 }, elements)).toBe(elements[1].ref)
    // beyond the surviving set ⇒ null, never a clamp to the last element.
    expect(matcher.reground({ role: 'button', nameNormalized: 'add', ordinal: 5 }, elements)).toBeNull()
  })

  it('rescues benign name drift through the substring rung where the 356 exact-only matcher returned null (D-12a)', () => {
    // Live name drifted from the stored 'save' to 'save changes'; the lower rung rescues it.
    const elements = [element('e1', 'button', 'save changes'), element('e2', 'link', 'help')]

    expect(matcher.reground({ role: 'button', nameNormalized: 'save' }, elements)).toBe(elements[0].ref)
  })

  it('returns null when no element matches (fall through to replan)', () => {
    const elements = [element('e1', 'button', 'checkout')]

    expect(matcher.reground({ role: 'button', nameNormalized: 'missing' }, elements)).toBeNull()
  })
})
