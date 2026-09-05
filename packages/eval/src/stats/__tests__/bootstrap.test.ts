import { describe, expect, it } from 'vitest'
import { BOOTSTRAP_B, pairedBootstrapCI } from '../bootstrap'
import type { BootstrapPair } from '../bootstrap'
import { createSeededRng } from '../prng'

const delta = (sample: readonly BootstrapPair[]): number =>
  sample.reduce((sum, pair) => sum + Number(pair.a) - Number(pair.b), 0) / sample.length

describe('paired percentile bootstrap (415 FLOOR-04)', () => {
  it('pins B = 2000 and reproduces the same interval from seed 7', () => {
    const pairs = Object.freeze([
      Object.freeze({ a: true, b: false }), Object.freeze({ a: true, b: false }),
      Object.freeze({ a: false, b: true }), Object.freeze({ a: true, b: true }),
    ])
    const first = pairedBootstrapCI(pairs, delta, createSeededRng(7))
    expect(BOOTSTRAP_B).toBe(2000)
    expect(first).toEqual({ lower: -0.5, upper: 1, B: 2000 })
    expect(first).toEqual(pairedBootstrapCI(pairs, delta, createSeededRng(7)))
    expect(first.lower).toBeLessThanOrEqual(delta(pairs))
    expect(first.upper).toBeGreaterThanOrEqual(delta(pairs))
  })

  it('resamples intact pairs with replacement, sorts numerically, and pins both percentile indices', () => {
    const pairs = Array.from({ length: 40 }, (_, i) => ({ a: i === 0, b: false }))
    let calls = 0
    const rng = {
      ...createSeededRng(7),
      nextInt(min: number, max: number): number {
        expect([min, max]).toEqual([0, 39])
        // Descending draws 39/40 ... 0/40 force sorting before reading indices 0 and 39.
        const successes = 39 - Math.floor(calls / 40)
        return calls++ % 40 < successes ? 0 : 1
      },
    }
    const statistic = (sample: readonly BootstrapPair[]) => {
      expect(sample).toHaveLength(pairs.length)
      expect(sample.every(pair => pairs.includes(pair))).toBe(true)
      return delta(sample)
    }
    expect(pairedBootstrapCI(pairs, statistic, rng, 40)).toEqual({
      lower: 0, upper: 39 / 40, B: 40,
    })
    expect(calls).toBe(40 * 40)
  })

  it('returns the constant statistic for singleton input and one resample', () => {
    expect(pairedBootstrapCI([{ a: false, b: true }], delta, createSeededRng(7), 1)).toEqual({
      lower: -1, upper: -1, B: 1,
    })
  })

  it('rejects empty paired populations', () => {
    expect(() => pairedBootstrapCI([], delta, createSeededRng(7))).toThrow(TypeError)
  })

  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid B = %s', B => {
    expect(() => pairedBootstrapCI([{ a: true, b: true }], delta, createSeededRng(7), B))
      .toThrow(TypeError)
  })

  it.each([NaN, Infinity, -Infinity])('rejects a nonfinite statistic (%s)', value => {
    expect(() => pairedBootstrapCI([{ a: true, b: true }], () => value, createSeededRng(7), 1))
      .toThrow(TypeError)
  })
})
