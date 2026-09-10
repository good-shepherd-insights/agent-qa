import { describe, expect, it } from 'vitest'
import { gate1HarmedSchema } from '../knowledge/gate-receipt'

const harmed = {
  cassetteId: 'fixture',
  decisionOrdinal: 0,
  origin: 'gate-set',
  verdictPresent: true,
  axes: ['headline'],
}

describe('strict Gate-1 SOFT disclosure', () => {
  it('preserves historical rows without adding a weight', () => {
    expect(gate1HarmedSchema.parse(harmed)).toEqual(harmed)
  })
  it.each([0, 0.25, 1])('preserves the exact supplied weight %s', (softWeight) => {
    const row = { ...harmed, softWeight }
    expect(gate1HarmedSchema.safeParse(row)).toEqual({ success: true, data: row })
  })
  it.each([NaN, Infinity, -Infinity, -0.01, 1.01, null, '0.25'])(
    'refuses invalid weight %s',
    (softWeight) => {
      expect(gate1HarmedSchema.safeParse({ ...harmed, softWeight }).success).toBe(false)
    },
  )
  it('keeps unknown properties strict', () => {
    expect(gate1HarmedSchema.safeParse({ ...harmed, softWeight: 0, extra: true }).success).toBe(false)
  })
})
