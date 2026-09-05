/**
 * FLOOR-03: xoshiro128** seeded with four successive splitmix32 outputs.
 * This splitmix32 variant is pinned: increment 0x9e3779b9; mix with
 * imul(z ^ (z >>> 16), 0x21f0aaad), then imul(z ^ (z >>> 15), 0x735a2d97),
 * then (z ^ (z >>> 15)) >>> 0. Changing it moves every committed bootstrap CI.
 * NOT a cryptographic generator: bootstrap resampling and later shadow sampling only.
 * Purity law: no clock, no randomness beyond this seeded stream, no host modules.
 * String seeds use the schema package's pure-JS sha256hex.
 */
import { sha256hex } from '@vostride/agent-qa-schema'

const UINT32_SIZE = 2 ** 32
const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0

function splitmix32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x9e3779b9) >>> 0
    let z = s
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad)
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97)
    return (z ^ (z >>> 15)) >>> 0
  }
}

function drawsFrom(nextUint32: () => number) {
  const nextFloat = (): number => nextUint32() / UINT32_SIZE
  const nextInt = (min: number, max: number): number => {
    const range = max - min + 1
    if (
      !Number.isSafeInteger(min) ||
      !Number.isSafeInteger(max) ||
      range < 1 ||
      range > UINT32_SIZE
    ) {
      throw new TypeError('inclusive integer range must contain 1 through 2^32 values')
    }
    const limit = UINT32_SIZE - (UINT32_SIZE % range)
    let x = nextUint32()
    while (x >= limit) x = nextUint32()
    return min + (x % range)
  }
  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i--) {
      const j = nextInt(0, i)
      const value = out[i]!
      out[i] = out[j]!
      out[j] = value
    }
    return out
  }
  return { nextUint32, nextFloat, nextInt, shuffle }
}

/** Test-only raw-state entry point, independent of seeding; state must be nonzero. */
export function xoshiroFromState(state: [number, number, number, number]) {
  let [s0, s1, s2, s3] = state
  const nextUint32 = (): number => {
    const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0
    const t = s1 << 9
    s2 ^= s0
    s3 ^= s1
    s1 ^= s2
    s0 ^= s3
    s2 ^= t
    s3 = rotl(s3, 11)
    return result
  }
  return drawsFrom(nextUint32)
}

export function createSeededRng(seed: number | string) {
  const seed32 =
    typeof seed === 'number' ? seed >>> 0 : Number.parseInt(sha256hex(seed).slice(0, 8), 16)
  const sm = splitmix32(seed32)
  return xoshiroFromState([sm(), sm(), sm(), sm()])
}

export type SeededRng = ReturnType<typeof createSeededRng>
