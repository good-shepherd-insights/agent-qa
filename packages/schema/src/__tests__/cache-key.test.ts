import { describe, expect, it } from 'vitest'
import { computeCacheKey } from '../determinism/cache-key'
import type { CacheableStepInput, CacheKey } from '../determinism/cache-key'

function makeInput(overrides: Partial<CacheableStepInput> = {}): CacheableStepInput {
  return {
    platform: 'web',
    suiteConfigDigest: 'suite-digest',
    testConfigDigest: 'test-digest',
    stepText: 'Click the Save button',
    stepIndex: 1,
    testIndex: 0,
    relevantEnvDigest: 'env-digest',
    screenIdentityHash: 'screen-identity',
    ...overrides,
  }
}

describe('computeCacheKey', () => {
  it('returns a stable branded 16-hex cache key', () => {
    const key: CacheKey = computeCacheKey(makeInput())

    expect(key).toBe(computeCacheKey(makeInput()))
    expect(key).toMatch(/^[0-9a-f]{16}$/)
  })

  it('changes when a tuple component changes', () => {
    const baseline = computeCacheKey(makeInput())

    expect(computeCacheKey(makeInput({ stepIndex: 2 }))).not.toBe(baseline)
    expect(computeCacheKey(makeInput({ relevantEnvDigest: 'other-env-digest' }))).not.toBe(baseline)
  })
})
