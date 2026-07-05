// RED scaffold (Wave 0, CACHE-03 / D-13). The deterministic descriptor matcher
// re-derives the fresh ref from a role+nameNormalized(+ordinal) descriptor against a
// fresh observation; returns null when unmatched (the rung that falls through to
// replan). Fails until Plan 03 creates ../reground.ts.
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

describe('deterministicDescriptorMatcher.reground (CACHE-03, D-13)', () => {
  it('returns the fresh ref when exactly one element matches role+nameNormalized', () => {
    const elements = [element('e1', 'button', 'checkout'), element('e2', 'link', 'help')]
    const locator: GroundedLocator = { role: 'button', nameNormalized: 'checkout' }

    expect(matcher.reground(locator, elements)).toBe(elements[0].ref)
  })

  it('returns the ordinal-th match when multiple elements share role+nameNormalized', () => {
    const elements = [element('e1', 'button', 'add'), element('e2', 'button', 'add')]

    expect(matcher.reground({ role: 'button', nameNormalized: 'add', ordinal: 0 }, elements)).toBe(elements[0].ref)
    expect(matcher.reground({ role: 'button', nameNormalized: 'add', ordinal: 1 }, elements)).toBe(elements[1].ref)
  })

  it('returns null when no element matches (fall through to replan)', () => {
    const elements = [element('e1', 'button', 'checkout')]

    expect(matcher.reground({ role: 'button', nameNormalized: 'missing' }, elements)).toBeNull()
  })
})
