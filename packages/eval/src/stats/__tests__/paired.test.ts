import { describe, expect, it } from 'vitest'
import { mcnemarExactP, pairedDecisionDiff } from '../paired'
import type { DecisionVector } from '../paired'

const vector = (key: string, correct: boolean): DecisionVector => ({ key, correct })

describe('paired decision differences (415 FLOOR-03)', () => {
  it('reports both and neither with zero flips for identical vectors', () => {
    const a = [vector('one', true), vector('two', false)]
    expect(pairedDecisionDiff(a, a)).toEqual({
      n: 2, both: 1, neither: 1, aOnly: 0, bOnly: 0,
      aUnpaired: 0, bUnpaired: 0, deltaAcc: 0, flipRate: 0,
    })
  })

  it('pins a-minus-b: one current regression against 48 baseline decisions is -1/48', () => {
    const baseline = Array.from({ length: 48 }, (_, i) => vector(String(i), true))
    const current = baseline.map((v, i) => ({ ...v, correct: i !== 0 }))
    expect(pairedDecisionDiff(current, baseline)).toEqual({
      n: 48, both: 47, neither: 0, aOnly: 0, bOnly: 1,
      aUnpaired: 0, bUnpaired: 0, deltaAcc: -1 / 48, flipRate: 1 / 48,
    })
    expect(pairedDecisionDiff(baseline, current).deltaAcc).toBe(1 / 48)
  })

  it('pairs by decision key, counts all discordances, and excludes unpaired rows', () => {
    const a = [vector('a-only', true), vector('both', true), vector('neither', false),
      vector('win', true), vector('loss', false)]
    const b = [vector('loss', true), vector('b-only-1', true), vector('win', false),
      vector('b-only-2', false), vector('neither', false), vector('both', true)]
    expect(pairedDecisionDiff(a, b)).toEqual({
      n: 4, both: 1, neither: 1, aOnly: 1, bOnly: 1,
      aUnpaired: 1, bUnpaired: 2, deltaAcc: 0, flipRate: 0.5,
    })
  })

  it('is antisymmetric on a nonzero paired delta with unequal populations', () => {
    const a = [vector('x', true), vector('y', true), vector('z', false)]
    const b = [vector('x', false), vector('y', true), vector('other', true)]
    expect(pairedDecisionDiff(a, b).deltaAcc).toBe(-pairedDecisionDiff(b, a).deltaAcc!)
    expect(pairedDecisionDiff(a, b).flipRate).toBe(pairedDecisionDiff(b, a).flipRate)
  })

  it('returns undefined rates when no keys are shared', () => {
    expect(pairedDecisionDiff([vector('a', true)], [vector('b', false)])).toEqual({
      n: 0, both: 0, neither: 0, aOnly: 0, bOnly: 0,
      aUnpaired: 1, bUnpaired: 1, deltaAcc: undefined, flipRate: undefined,
    })
    expect(pairedDecisionDiff([], []).deltaAcc).toBeUndefined()
  })

  it('does not mutate either input', () => {
    const a = Object.freeze([Object.freeze(vector('x', true))])
    const b = Object.freeze([Object.freeze(vector('x', false))])
    expect(pairedDecisionDiff(a, b).aOnly).toBe(1)
    expect(a).toEqual([vector('x', true)])
    expect(b).toEqual([vector('x', false)])
  })

  it('refuses duplicate keys on either side instead of manufacturing paired counts', () => {
    const duplicates = [vector('x', true), vector('x', false)]
    expect(() => pairedDecisionDiff(duplicates, [vector('x', false)])).toThrow(TypeError)
    expect(() => pairedDecisionDiff([vector('x', false)], duplicates)).toThrow(TypeError)
  })
})

describe('exact two-sided McNemar honesty metadata', () => {
  it.each([[0, 0, 1], [5, 0, 0.0625], [2, 0, 0.5], [3, 2, 1]])(
    'pins discordant counts (%s, %s) to p = %s', (a, b, p) => {
      expect(mcnemarExactP(a, b)).toBe(p)
      expect(mcnemarExactP(b, a)).toBe(p)
    },
  )

  it('remains exact-binomial above 1074 discordances without losing the PMF to underflow', () => {
    // Independent Python integer-combination sum: 2 * sum(comb(1100,k), k=0..500) / 2**1100.
    expect(mcnemarExactP(600, 500)).toBeCloseTo(0.0028195449914364275, 14)
    expect(mcnemarExactP(600, 500)).toBe(mcnemarExactP(500, 600))
  })

  it.each([[-1, 0], [0, -1], [1.5, 2], [NaN, 2], [1, Infinity]])(
    'rejects invalid discordant counts (%s, %s)', (a, b) => {
      expect(() => mcnemarExactP(a, b)).toThrow(TypeError)
    },
  )
})
