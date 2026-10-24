import { describe, expect, it } from 'vitest'
import { ORIGIN_PRIORS } from '@vostride/agent-qa-schema'
import * as api from '../../index'

const planner = { provider: 'recorded-provider', modelId: 'gpt-5' }
const base = {
  k: 1,
  n: 1,
  corpusDigest: 'a'.repeat(64),
  evidenceDigest: 'b'.repeat(64),
  recoveringDecision: {
    modelIdentity: planner,
    governingMark: { markId: 'recorded-mark', kind: 'false-fail' as const },
  },
}

describe('420 SOFT weight', () => {
  it('returns the full evidence block for the independent one-of-one answer', () => {
    expect(api.computeSoftWeight?.(base)).toEqual({
      value: 0.75, k: 1, n: 1,
      verdictSource: 'user-gold', verdictFactor: 1,
      capabilityTier: 'full', tierFactor: 1,
      alpha0: 2, beta0: 1,
      corpusDigest: base.corpusDigest, evidenceDigest: base.evidenceDigest,
      capabilityEvidence: { kind: 'model-identity', modelIdentity: planner },
    })
  })

  it.each([[1, 2, 0.6], [0, 0, 2 / 3], [0, 1, 0.5], [2, 2, 0.8]])(
    'pins the independent answer for k=%s n=%s', (k, n, expected) => {
      expect(api.computeSoftWeight).toBeTypeOf('function')
      expect(api.computeSoftWeight({ ...base, k, n }).value).toBeCloseTo(expected, 14)
    },
  )

  it('pins provisional factors and the silver degraded one-of-one answer', () => {
    expect(api.SOFT_VERDICT_FACTORS).toEqual({
      'user-gold': 1, 'stable-pass-silver': 0.8, unverified: 0.5,
    })
    expect(api.SOFT_TIER_FACTORS).toEqual({ full: 1, degraded: 0.75, floor: 0.5 })
    const result = api.computeSoftWeight({ ...base, recoveringDecision: {
      modelIdentity: { provider: 'recorded-provider', modelId: 'unknown' },
      verifierVerdict: { pass: true },
    } })
    expect(result).toMatchObject({
      verdictSource: 'stable-pass-silver', verdictFactor: 0.8,
      capabilityTier: 'degraded', tierFactor: 0.75,
    })
    expect(result.value).toBeCloseTo(0.45, 14)
  })

  it('does not promote minted near-gold, absent verdicts or recorded FAIL to gold', () => {
    expect(api.computeSoftWeight).toBeTypeOf('function')
    for (const recoveringDecision of [
      {}, { verifierVerdict: { pass: false } },
      { tier: 'near-gold', sourceChannel: 'self-heal-pair' },
    ]) {
      const result = api.computeSoftWeight({ ...base, recoveringDecision })
      expect(result).toMatchObject({
        verdictSource: 'unverified', verdictFactor: 0.5,
        capabilityTier: 'degraded', tierFactor: 0.75,
        capabilityEvidence: { kind: 'missing' }, value: 0.28125,
      })
    }
  })

  it('classifies authentic governing marks ahead of the recorded verdict', () => {
    expect(api.computeSoftWeight).toBeTypeOf('function')
    for (const kind of ['false-pass', 'false-fail', 'confirmed-bug'] as const) {
      const result = api.computeSoftWeight({ ...base, recoveringDecision: {
        modelIdentity: planner, verifierVerdict: { pass: false },
        governingMark: { kind, markId: 'recorded-mark' },
      } })
      expect(result.verdictSource).toBe('user-gold')
    }
  })

  it('discloses deterministic execution without borrowing a configured model', () => {
    expect(api.computeSoftWeight).toBeTypeOf('function')
    const result = api.computeSoftWeight({ ...base, recoveringDecision: {
      ...base.recoveringDecision, deterministicPath: true,
    } })
    expect(result).toMatchObject({
      capabilityTier: 'floor', tierFactor: 0.5,
      capabilityEvidence: { kind: 'deterministic' }, value: 0.375,
    })
  })

  it.each([-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid counts %s', (invalid) => {
      expect(api.computeSoftWeight).toBeTypeOf('function')
      expect(() => api.computeSoftWeight({ ...base, k: invalid })).toThrow(RangeError)
      expect(() => api.computeSoftWeight({ ...base, n: invalid })).toThrow(RangeError)
    },
  )

  it('rejects k greater than n', () => {
    expect(api.computeSoftWeight).toBeTypeOf('function')
    expect(() => api.computeSoftWeight({ ...base, k: 2 })).toThrow(RangeError)
  })

  it('rejects invalid prior mass and nonfinite evidence instead of serializing NaN', () => {
    expect(api.computeSoftWeight).toBeTypeOf('function')
    const prior = ORIGIN_PRIORS['agent-verified']
    const original = { ...prior }
    try {
      for (const [alpha, beta] of [[0, 0], [NaN, 1], [2, Infinity], [-1, 1]]) {
        Object.assign(prior, { alpha, beta })
        expect(() => api.computeSoftWeight(base)).toThrow(RangeError)
      }
    } finally {
      Object.assign(prior, original)
    }
  })

  it('rejects malformed evidence and digests at the typed boundary', () => {
    expect(api.computeSoftWeight).toBeTypeOf('function')
    for (const recoveringDecision of [
      { deterministicPath: NaN }, { verifierVerdict: { pass: Infinity } },
      { governingMark: { markId: '', kind: 'false-fail' } },
      { governingMark: { markId: 'recorded-mark', kind: 'invented' } },
    ]) {
      expect(() => api.computeSoftWeight({
        ...base, recoveringDecision: recoveringDecision as never,
      })).toThrow()
    }
    expect(() => api.computeSoftWeight({ ...base, corpusDigest: '' })).toThrow()
    expect(() => api.computeSoftWeight({ ...base, evidenceDigest: 'not-a-digest' })).toThrow()
  })

  it('returns deterministic unrounded serializable output without mutating its inputs', () => {
    expect(api.computeSoftWeight).toBeTypeOf('function')
    const input = structuredClone({ ...base, k: 0, n: 0 })
    const before = structuredClone(input)
    const result = api.computeSoftWeight(input)
    expect(JSON.parse(JSON.stringify(result)).value).toBe(2 / 3)
    expect(api.computeSoftWeight(input)).toEqual(result)
    expect(input).toEqual(before)
    input.recoveringDecision.modelIdentity.modelId = 'changed'
    expect(result.capabilityEvidence.modelIdentity).toEqual(planner)
  })
})
