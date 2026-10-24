import { sha256hex } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import { createSeededRng, xoshiroFromState } from '../prng'

const draws = (rng: { nextUint32(): number }, n: number) =>
  Array.from({ length: n }, () => rng.nextUint32())

describe('xoshiro128** known-answer vectors (415 FLOOR-03)', () => {
  it('pins the seeding-independent raw-state vector [1,2,3,4]', () => {
    expect(draws(xoshiroFromState([1, 2, 3, 4]), 10)).toEqual([
      11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849,
      3729100597, 4258142804,
    ])
  })

  it('pins the eight outputs for seed 0', () => {
    expect(draws(createSeededRng(0), 8)).toEqual([
      1789933344, 44971166, 2521387044, 3848737593, 1138324114, 749234105, 1899511038,
      1995189375,
    ])
  })

  it('pins the eight outputs for seed 1', () => {
    expect(draws(createSeededRng(1), 8)).toEqual([
      393288148, 2174103013, 3814759091, 2092745082, 1865176206, 2179171167, 3207394750,
      2858353069,
    ])
  })

  it('pins the eight outputs for seed 0xdeadbeef', () => {
    expect(draws(createSeededRng(0xdeadbeef), 8)).toEqual([
      3842467093, 879304004, 3694663928, 2788030634, 934155191, 702880729, 3422146658,
      169081873,
    ])
  })

  it('expands seed 0 from the pinned four splitmix32 words', () => {
    const initialState: [number, number, number, number] = [
      0x64625032, 0xd9c0799c, 0xaf362e10, 0x7fa88912,
    ]
    expect(draws(createSeededRng(0), 16)).toEqual(draws(xoshiroFromState(initialState), 16))
  })

  it('hashes string seeds through the first eight hex characters of sha256hex', () => {
    const seed = '415-bootstrap-α'
    expect(draws(createSeededRng(seed), 16)).toEqual(
      draws(createSeededRng(Number.parseInt(sha256hex(seed).slice(0, 8), 16)), 16),
    )
  })

  it('copies the supplied raw state', () => {
    const state: [number, number, number, number] = [1, 2, 3, 4]
    const rng = xoshiroFromState(state)
    state[1] = 99
    expect(rng.nextUint32()).toBe(11520)
    expect(state).toEqual([1, 99, 3, 4])
  })
})

describe('seeded draws and Fisher-Yates shuffle', () => {
  it('draws floats from [0, 1) using the same uint32 stream', () => {
    const rng = createSeededRng(0)
    expect(rng.nextFloat()).toBe(1789933344 / 2 ** 32)
    for (let i = 0; i < 3000; i++) {
      const value = rng.nextFloat()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('draws all three inclusive integers without out-of-range values', () => {
    const rng = createSeededRng(0)
    const counts = [0, 0, 0]
    for (let i = 0; i < 3000; i++) {
      const value = rng.nextInt(0, 2)
      expect([0, 1, 2]).toContain(value)
      counts[value]!++
    }
    for (const count of counts) expect(count).toBeGreaterThanOrEqual(800)
  })

  it('rejects the biased uint32 tail before reducing into the inclusive range', () => {
    const rng = createSeededRng(0xdeadbeef)
    // 3842467093 is above limit 2147483649; the next word is accepted.
    expect(rng.nextInt(0, 0x80000000)).toBe(879304004)
    expect(rng.nextUint32()).toBe(3694663928)
  })

  it('supports singleton, negative and full uint32-sized ranges', () => {
    expect(createSeededRng(0).nextInt(-5, -5)).toBe(-5)
    expect(createSeededRng(0).nextInt(-2, 0)).toBe(-2)
    expect(createSeededRng(0).nextInt(0, 0xffffffff)).toBe(1789933344)
  })

  it.each([
    [1, 0],
    [0, 2 ** 32],
    [0.5, 1],
    [0, Infinity],
    [NaN, 1],
  ])('rejects an invalid inclusive range [%s, %s] without looping', (min, max) => {
    expect(() => createSeededRng(0).nextInt(min, max)).toThrow(TypeError)
  })

  it('shuffles a copy using the pinned Fisher-Yates draws', () => {
    const items = Object.freeze(['a', 'b', 'c', 'd', 'e'])
    const shuffled = createSeededRng(0).shuffle(items)
    expect(shuffled).toEqual(['d', 'b', 'a', 'c', 'e'])
    expect(createSeededRng(0).shuffle(items)).toEqual(shuffled)
    expect([...shuffled].sort()).toEqual(items)
    expect(shuffled).not.toBe(items)
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(createSeededRng(0).shuffle([])).toEqual([])
    expect(createSeededRng(0).shuffle(['a'])).toEqual(['a'])
  })
})
