import { describe, expect, it } from 'vitest'

import {
  BIMODAL_MIN_MODE_N,
  CUSUM_DECISION_H,
  bimodalSplit,
  cusumStep,
  foldMeasurements,
  measurementBaselineSchema,
  measurementObservationSchema,
  type MeasurementBaseline,
  type MeasurementObservation,
} from '../measurement-fold'

const baseline: MeasurementBaseline = {
  mu0: 10,
  sigma0: 2,
  n0: 20,
  openedAtOrdinal: 100,
}

function observation(
  value: number,
  index: number,
  buildOrdinal = 101 + index,
): MeasurementObservation {
  return {
    value,
    buildOrdinal,
    evidenceToken: `evidence-${index}`,
    curationJobId: `job-${index}`,
  }
}

describe('measurement line schemas (D-03)', () => {
  it('round-trips the strict baseline snapshot and rejects extra keys', () => {
    expect(measurementBaselineSchema.parse(baseline)).toEqual(baseline)
    expect(measurementBaselineSchema.safeParse({ ...baseline, detectorState: {} }).success)
      .toBe(false)
  })

  it('round-trips strict finite observation lines and rejects extra keys', () => {
    const line = observation(12.5, 0)

    expect(measurementObservationSchema.parse(line)).toEqual(line)
    expect(measurementObservationSchema.safeParse({ ...line, recordedAt: 'now' }).success)
      .toBe(false)
    expect(measurementObservationSchema.safeParse({ ...line, value: Number.POSITIVE_INFINITY }).success)
      .toBe(false)
  })
})

describe('foldMeasurements deterministic distribution (D-03)', () => {
  it('derives population Welford sigma and nearest-rank p50/p95 in one fold', () => {
    const lines = [2, 4, 4, 4, 5, 5].map((value, index) => observation(value, index))
    const state = foldMeasurements(baseline, lines)

    expect(state.n).toBe(6)
    expect(state.mean).toBe(4)
    expect(state.sigma).toBe(1)
    // Nearest-rank uses ceil(q * n) - 1: p50 -> index 2, p95 -> index 5.
    expect(state.p50).toBe(4)
    expect(state.p95).toBe(5)
    expect(state.bands).toEqual([{ lo: 2, hi: 5, n: 6, mean: 4 }])
  })

  it('replays byte-equivalent order deterministically and treats permutation as different input', () => {
    const lines = [12, 8, 11, 9].map((value, index) => observation(value, index))
    const first = foldMeasurements(baseline, lines)

    expect(foldMeasurements(baseline, lines)).toEqual(first)
    expect(foldMeasurements(baseline, [lines[1]!, lines[0]!, lines[3]!, lines[2]!]))
      .not.toEqual(first)
  })
})

describe('fixed-baseline two-sided CUSUM (D-04 ratification)', () => {
  it('accumulates the exact positive and negative fixed-reference equations', () => {
    expect(cusumStep({ pos: 0, neg: 0 }, 13, 10, 2)).toEqual({
      pos: 2,
      neg: 0,
      tripped: false,
    })
    expect(cusumStep({ pos: 0, neg: 0 }, 7, 10, 2)).toEqual({
      pos: 0,
      neg: 2,
      tripped: false,
    })
  })

  it('trips on a bounded +1 sigma walk while centered noise stays below the guard', () => {
    let walk = { pos: 0, neg: 0 }
    let tripAt: number | undefined

    for (let step = 1; step <= 12; step += 1) {
      const next = cusumStep(walk, 12, 10, 2)
      walk = next
      if (next.tripped) {
        tripAt = step
        break
      }
    }

    expect(CUSUM_DECISION_H).toBe(5)
    expect(tripAt).toBe(11)

    let noise = { pos: 0, neg: 0 }
    for (const value of [10.5, 9.5, 10.25, 9.75, 10.4, 9.6, 10, 10]) {
      const next = cusumStep(noise, value, 10, 2)
      expect(next.tripped).toBe(false)
      noise = next
    }
  })
})

describe('weighted largest-gap bimodality (D-04 ratification)', () => {
  it('splits a clearly separated two-band sample with enough observations per mode', () => {
    expect(bimodalSplit([9, 10, 11, 99, 100, 101])).toEqual({
      splitIndex: 3,
      bands: [
        { lo: 9, hi: 11, n: 3, mean: 10 },
        { lo: 99, hi: 101, n: 3, mean: 100 },
      ],
    })
  })

  it('rejects unimodal samples and samples smaller than two complete modes', () => {
    expect(bimodalSplit([1, 2, 3, 4, 5, 6])).toBeUndefined()
    expect(bimodalSplit(Array.from({ length: 2 * BIMODAL_MIN_MODE_N - 1 }, (_, i) => i)))
      .toBeUndefined()
  })
})
