import { describe, expect, it } from 'vitest'
import { axisVectors, FLOOR_AXES } from '../decision-vector'
import type { AxisCorrectness, DecisionCorrectnessVector, FloorAxis } from '../decision-vector'
import { computeNoiseFloor } from '../noise-floor'
import type { DecisionVector } from '../paired'
import { wilsonInterval } from '../wilson'

const reference = (): DecisionVector[] =>
  Array.from({ length: 48 }, (_, i) => ({ key: `decision-${i}`, correct: i < 41 }))
const flipped = (n: number): DecisionVector[] =>
  reference().map((v, i) => ({ ...v, correct: i < n ? !v.correct : v.correct }))

describe('axis noise floor over whole-run repeats (415 FLOOR-02)', () => {
  it('keeps identical repeats at the unrounded Wilson floor with its denominator', () => {
    const result = computeNoiseFloor({
      sameSeed: [reference(), reference(), reference()], otherSeed: [reference()],
    })
    expect(result.n).toBe(48)
    expect(result.reference).toEqual({ correct: 41, n: 48 })
    expect(result.sameSeedSpread).toBe(0)
    expect(result.twoSeedSpread).toBe(0)
    expect(result.wilsonHalfWidth).toBeCloseTo(0.0996, 4)
    expect(result.aggregateFloor).toBe(result.wilsonHalfWidth)
    expect(result.aggregateFloor).toBeGreaterThan(0)
    expect(result.aggregateFloor).not.toBe(0.0996)
  })

  it('preserves a single flip as exactly 1/48 beneath the Wilson term', () => {
    const result = computeNoiseFloor({
      sameSeed: [reference(), flipped(1), reference()], otherSeed: [reference()],
    })
    expect(result.sameSeedSpread).toBe(1 / 48)
    expect(result.twoSeedSpread).toBe(1 / 48)
    expect(result.aggregateFloor).toBe(result.wilsonHalfWidth)
  })

  it('chooses the maximum over every same-seed pair, including one without the reference', () => {
    const improved = reference().map(v => ({ ...v, correct: true }))
    const result = computeNoiseFloor({
      sameSeed: [reference(), flipped(8), improved], otherSeed: [reference()],
    })
    expect(result.sameSeedSpread).toBe(15 / 48)
    expect(result.twoSeedSpread).toBe(8 / 48)
    expect(result.aggregateFloor).toBe(15 / 48)
  })

  it('chooses eight same-seed flips when their 8/48 spread exceeds Wilson', () => {
    const result = computeNoiseFloor({
      sameSeed: [reference(), flipped(8), reference()], otherSeed: [reference()],
    })
    expect(result.sameSeedSpread).toBe(8 / 48)
    expect(result.aggregateFloor).toBe(8 / 48)
    expect(result.aggregateFloor).toBeGreaterThan(result.wilsonHalfWidth!)
  })

  it('allows the second other-seed run to set the largest spread', () => {
    const result = computeNoiseFloor({
      sameSeed: [reference(), reference(), reference()],
      otherSeed: [reference(), flipped(16)],
    })
    expect(result.sameSeedSpread).toBe(0)
    expect(result.twoSeedSpread).toBe(16 / 48)
    expect(result.aggregateFloor).toBe(16 / 48)
  })

  it('lists every same-seed pair and every cross-seed pair with their local indices and counts', () => {
    const result = computeNoiseFloor({
      sameSeed: [reference(), flipped(1), reference(), reference()],
      otherSeed: [reference(), flipped(8)],
    })
    expect(result.pairs.map(({ a, b, kind }) => [a, b, kind])).toEqual([
      [0, 1, 'same-seed'], [0, 2, 'same-seed'], [0, 3, 'same-seed'],
      [1, 2, 'same-seed'], [1, 3, 'same-seed'], [2, 3, 'same-seed'],
      [0, 0, 'two-seed'], [0, 1, 'two-seed'],
      [1, 0, 'two-seed'], [1, 1, 'two-seed'],
      [2, 0, 'two-seed'], [2, 1, 'two-seed'],
      [3, 0, 'two-seed'], [3, 1, 'two-seed'],
    ])
    expect(result.pairs[0]!.diff).toEqual({
      n: 48, both: 40, neither: 7, aOnly: 1, bOnly: 0,
      aUnpaired: 0, bUnpaired: 0, deltaAcc: 1 / 48, flipRate: 1 / 48,
    })
    expect(result.pairs[9]!.diff).toEqual({
      n: 48, both: 33, neither: 8, aOnly: 7, bOnly: 0,
      aUnpaired: 0, bUnpaired: 0, deltaAcc: 7 / 48, flipRate: 7 / 48,
    })
  })

  it('returns n: 0 with no aggregateFloor or Wilson keys when the reference is empty', () => {
    const result = computeNoiseFloor({
      sameSeed: [[], reference(), reference()], otherSeed: [reference()],
    })
    expect(result).toEqual({ n: 0, pairs: [] })
    expect(result).not.toHaveProperty('aggregateFloor')
    expect(result).not.toHaveProperty('wilsonHalfWidth')
    expect(result).not.toHaveProperty('reference')
    expect(result).not.toHaveProperty('sameSeedSpread')
    expect(result).not.toHaveProperty('twoSeedSpread')
  })

  it.each([
    { sameSeed: [], otherSeed: [reference()] },
    { sameSeed: [reference(), reference()], otherSeed: [reference()] },
    { sameSeed: [reference(), reference(), reference()], otherSeed: [] },
  ])('refuses repeat counts below the protocol minimum', input => {
    expect(() => computeNoiseFloor(input)).toThrow(TypeError)
  })

  it('lists disjoint pairs with undefined rates and zero contribution to spread', () => {
    const disjoint = reference().map(v => ({ ...v, key: `other-${v.key}` }))
    const result = computeNoiseFloor({
      sameSeed: [reference(), reference(), disjoint], otherSeed: [reference()],
    })
    expect(result.pairs).toHaveLength(6)
    expect(result.pairs[1]!.diff).toEqual({
      n: 0, both: 0, neither: 0, aOnly: 0, bOnly: 0,
      aUnpaired: 48, bUnpaired: 48, deltaAcc: undefined, flipRate: undefined,
    })
    expect(result.sameSeedSpread).toBe(0)
    expect(result.twoSeedSpread).toBe(0)
    expect(result.aggregateFloor).toBe(result.wilsonHalfWidth)
  })

  it('passes through an explicit z while preserving frozen input arrays', () => {
    const run = Object.freeze(reference().map(v => Object.freeze(v)))
    const result = computeNoiseFloor({
      sameSeed: Object.freeze([run, run, run]), otherSeed: Object.freeze([run]), z: 1,
    })
    expect(result.wilsonHalfWidth).toBe(wilsonInterval(41, 48, 1)!.halfWidth)
    expect(run).toEqual(reference())
  })
})

function correctness(key: string, axis: FloorAxis, value: AxisCorrectness): DecisionCorrectnessVector {
  const axes: DecisionCorrectnessVector['axes'] = {
    headline: 'not-applicable', elementIdentity: 'not-applicable', value: 'not-applicable',
    opClass: 'not-applicable', sideEffect: 'not-applicable', loop: 'not-applicable',
  }
  axes[axis] = value
  return {
    key, cassetteId: 'cassette-a', decisionOrdinal: 0, product: 'example-web',
    briefSource: 'proof', axes,
  }
}

describe('axis projection', () => {
  // Plan 05 owns the one hand-spelled FLOOR_AXES runtime cell and its never-bar.
  it.each(FLOOR_AXES)('projects only applicable %s decisions and preserves identity', axis => {
    const rows = Object.freeze([
      correctness('cassette-a#-#0', axis, 'correct'),
      correctness('cassette-a#0#0', axis, 'incorrect'),
      correctness('cassette-a#-#1', axis, 'not-applicable'),
    ])
    const projected = axisVectors(rows, axis)
    expect(projected).toEqual([
      { key: 'cassette-a#-#0', correct: true },
      { key: 'cassette-a#0#0', correct: false },
    ])
    expect(projected[0]).not.toBe(rows[0])
    expect(axisVectors([], axis)).toEqual([])
    expect(axisVectors([rows[2]!], axis)).toEqual([])
  })
})
