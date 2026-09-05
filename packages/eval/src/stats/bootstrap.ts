// FLOOR-04 purity law: no clock or host modules; draws come only from the supplied stream.
import type { SeededRng } from './prng'

// Stable 2.5/97.5 percentiles at n <= 200; recorded beside the bootstrap seed in artifacts.
export const BOOTSTRAP_B = 2000

export interface BootstrapPair {
  a: boolean
  b: boolean
}

export function pairedBootstrapCI(
  pairs: readonly BootstrapPair[],
  statistic: (sample: readonly BootstrapPair[]) => number,
  rng: SeededRng,
  B = BOOTSTRAP_B,
): { lower: number; upper: number; B: number } {
  if (pairs.length === 0) throw new TypeError('bootstrap requires at least one paired decision')
  if (!Number.isSafeInteger(B) || B < 1) throw new TypeError('bootstrap B must be a positive integer')
  const draws: number[] = []
  for (let i = 0; i < B; i++) {
    const sample = Array.from({ length: pairs.length }, () => pairs[rng.nextInt(0, pairs.length - 1)]!)
    const draw = statistic(sample)
    if (!Number.isFinite(draw)) throw new TypeError('bootstrap statistic must be finite')
    draws.push(draw)
  }
  draws.sort((x, y) => x - y)
  return {
    lower: draws[Math.floor(0.025 * (B - 1))]!,
    upper: draws[Math.ceil(0.975 * (B - 1))]!,
    B,
  }
}
