// 2026-09-05: CONTEXT/STACK's [0.740, 0.935] vector was measured wrong.
// FLOOR-03 pins the corrected 4-dp values below (415 RESEARCH Pitfall 1).
import { describe, expect, it } from 'vitest'
import { wilsonInterval, Z_95 } from '../wilson'

describe('Wilson score interval (415 FLOOR-03)', () => {
  it('pins the two-sided 95% quantile', () => {
    expect(Z_95).toBe(1.959964)
  })

  it.each([
    [39, 45, 0.7382, 0.9374, 0.0996],
    [3, 3, 0.4385, 1, 0.2807],
    [0, 9, 0, 0.2991, 0.1496],
  ])('pins Wilson(%s, %s) to four decimal places', (k, n, lower, upper, halfWidth) => {
    const result = wilsonInterval(k, n)
    expect(result).toBeDefined()
    expect(result!.lower).toBeCloseTo(lower, 4)
    expect(result!.upper).toBeCloseTo(upper, 4)
    expect(result!.halfWidth).toBeCloseTo(halfWidth, 4)
  })

  it.each([
    [41, 48, 0.0996],
    [112, 131, 0.0603],
  ])('pins the half-width for %s/%s without rounding output', (k, n, halfWidth) => {
    const result = wilsonInterval(k, n)!
    expect(result.halfWidth).toBeCloseTo(halfWidth, 4)
    expect(result.halfWidth).not.toBe(halfWidth)
  })

  it('clamps the 0/9 lower bound to exactly zero and 3/3 upper to one', () => {
    expect(wilsonInterval(0, 9)!.lower).toBe(0)
    expect(wilsonInterval(3, 3)!.upper).toBe(1)
  })

  it('returns undefined for n = 0, including the pinned (5, 0) vector', () => {
    expect(wilsonInterval(0, 0)).toBeUndefined()
    expect(wilsonInterval(5, 0)).toBeUndefined()
  })

  it('uses an explicit z and never emits NaN for finite valid counts', () => {
    expect(wilsonInterval(2, 4, 0)).toEqual({ lower: 0.5, upper: 0.5, halfWidth: 0 })
    for (let n = 1; n <= 50; n++) {
      for (let k = 0; k <= n; k++) {
        const result = wilsonInterval(k, n)!
        expect(Object.values(result).every(Number.isFinite)).toBe(true)
        expect(result.lower).toBeGreaterThanOrEqual(0)
        expect(result.upper).toBeLessThanOrEqual(1)
        expect(result.halfWidth).toBeGreaterThan(0)
      }
    }
  })

  it.each([
    [-1, 2],
    [1, -2],
    [1.5, 2],
    [1, 2.5],
    [3, 2],
    [NaN, 2],
    [1, Infinity],
  ])('rejects invalid counts (%s, %s) as caller errors', (k, n) => {
    expect(() => wilsonInterval(k, n)).toThrow(TypeError)
  })

  it.each([NaN, Infinity, -1])('rejects invalid z = %s instead of emitting NaN', z => {
    expect(() => wilsonInterval(1, 2, z)).toThrow(TypeError)
  })
})
