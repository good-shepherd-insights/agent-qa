import { describe, expect, it } from 'vitest'
import { generalizationRatio, HELD_OUT_GENERALIZATION_MIN, MIN_LIFT_DECISIONS } from '../generalization'

describe('held-out generalization ratio (415 FLOOR-04)', () => {
  it('pins project-adopted constants 0.70 and 3 decisions', () => {
    expect(HELD_OUT_GENERALIZATION_MIN).toBe(0.7)
    expect(MIN_LIFT_DECISIONS).toBe(3)
  })

  it('abstains at exactly 2 decisions even when the lift exceeds the floor', () => {
    const result = generalizationRatio({
      optimizeLiftDecisions: 2, optimizeLiftRate: 0.5, heldOutLiftRate: 0.4, floor: 0.1,
    })
    expect(result.verdict).toBe('in-floor')
    expect(result.ratio).toBeUndefined()
  })

  it('defines ratio 0.8 at exactly 3 decisions with lift above the floor', () => {
    expect(generalizationRatio({
      optimizeLiftDecisions: 3, optimizeLiftRate: 0.5, heldOutLiftRate: 0.4, floor: 0.1,
    })).toEqual({ verdict: 'generalizes', ratio: 0.8 })
  })

  it('reports overfit at ratio 0.6 and generalizes at exactly 0.70', () => {
    expect(generalizationRatio({
      optimizeLiftDecisions: 3, optimizeLiftRate: 0.5, heldOutLiftRate: 0.3, floor: 0.1,
    })).toEqual({ verdict: 'overfit', ratio: 0.6 })
    expect(generalizationRatio({
      optimizeLiftDecisions: 3, optimizeLiftRate: 0.5, heldOutLiftRate: 0.35, floor: 0.1,
    })).toEqual({ verdict: 'generalizes', ratio: 0.7 })
  })

  it.each([0, 0.05, 0.1])('abstains when lift %s does not strictly exceed the floor', lift => {
    const result = generalizationRatio({
      optimizeLiftDecisions: 3, optimizeLiftRate: lift, heldOutLiftRate: 0.4, floor: 0.1,
    })
    expect(result.verdict).toBe('in-floor')
    expect(result.ratio).toBeUndefined()
  })

  it('keeps a tiny positive lift above a zero floor without rounding', () => {
    expect(generalizationRatio({
      optimizeLiftDecisions: 3, optimizeLiftRate: 0.0001, heldOutLiftRate: 0.00008, floor: 0,
    })).toEqual({ verdict: 'generalizes', ratio: 0.00008 / 0.0001 })
  })

  it('preserves an unrounded negative held-out lift as overfit', () => {
    expect(generalizationRatio({
      optimizeLiftDecisions: 3, optimizeLiftRate: 0.3, heldOutLiftRate: -0.1, floor: 0.1,
    })).toEqual({ verdict: 'overfit', ratio: -0.1 / 0.3 })
  })

  it.each([
    { optimizeLiftDecisions: NaN }, { optimizeLiftDecisions: 2.5 },
    { optimizeLiftRate: NaN }, { heldOutLiftRate: Infinity }, { floor: NaN }, { floor: -0.1 },
  ])('rejects invalid lift/floor inputs %j', invalid => {
    expect(() => generalizationRatio({
      optimizeLiftDecisions: 3, optimizeLiftRate: 0.5, heldOutLiftRate: 0.4, floor: 0.1, ...invalid,
    })).toThrow(TypeError)
  })
})
