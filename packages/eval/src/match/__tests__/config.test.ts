import { sha256hex } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { canonicalJson } from '../../canonical-json'
import { MATCHER_CONFIG } from '../config'
import type { IdentityLadderLevel } from '../config'

const PINNED_CONFIG_MATERIAL_HASHES: Readonly<Record<number, string>> = Object.freeze({
  // Bump procedure: increment matcherVersion and add the new material hash; never replace
  // an existing entry, because historical score reports remain bound to that constitution.
  1: 'fd15d051163d13fa5e8f678cf558cf345adfff74c5ed49d416dea434c2d3d9a4',
})

const IDENTITY_LADDER_LEVELS: { [T in IdentityLadderLevel]: true } = {
  full: true,
  'ordinal-only-differs': true,
  'role-matches-name-differs': true,
  'name-matches-role-differs': true,
  'within-tolerance': true,
  miss: true,
}

describe('MATCHER_CONFIG', () => {
  it('requires every material change to carry a pinned matcher-version bump', () => {
    const material: Record<string, unknown> = { ...MATCHER_CONFIG }
    delete material.matcherVersion

    const expectedHash = PINNED_CONFIG_MATERIAL_HASHES[MATCHER_CONFIG.matcherVersion]
    expect(expectedHash).toBeDefined()
    expect(sha256hex(canonicalJson(material))).toBe(expectedHash)
  })

  it('is deeply frozen', () => {
    expect(Object.isFrozen(MATCHER_CONFIG)).toBe(true)
    expect(Object.isFrozen(MATCHER_CONFIG.opClass)).toBe(true)
    expect(Object.isFrozen(MATCHER_CONFIG.identityLadder)).toBe(true)
    expect(Object.isFrozen(MATCHER_CONFIG.tier3)).toBe(true)
    expect(Object.isFrozen(MATCHER_CONFIG.valueMidBand)).toBe(true)

    expect(() => {
      const mutableTier3 = MATCHER_CONFIG.tier3 as { distanceToleranceRatio: number }
      mutableTier3.distanceToleranceRatio = 0.1
    }).toThrow(TypeError)
  })

  it('keeps every tuned number internally consistent', () => {
    expect(MATCHER_CONFIG.matcherVersion).toBe(1)
    expect(MATCHER_CONFIG.valueMidBand.low).toBeGreaterThan(0)
    expect(MATCHER_CONFIG.valueMidBand.low).toBeLessThan(MATCHER_CONFIG.valueMidBand.high)
    expect(MATCHER_CONFIG.valueMidBand.high).toBeLessThan(1)
    expect(MATCHER_CONFIG.tier3.distanceToleranceRatio).toBeGreaterThan(0)
    expect(MATCHER_CONFIG.tier3.distanceToleranceRatio).toBeLessThan(1)

    expect(Object.keys(MATCHER_CONFIG.identityLadder).sort()).toEqual(
      Object.keys(IDENTITY_LADDER_LEVELS).sort(),
    )
    for (const value of Object.values(MATCHER_CONFIG.identityLadder)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
    expect(MATCHER_CONFIG.identityLadder.full).toBe(1)
    expect(MATCHER_CONFIG.identityLadder.miss).toBe(0)
  })
})
