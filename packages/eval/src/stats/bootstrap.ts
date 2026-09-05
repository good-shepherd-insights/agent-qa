import type { SeededRng } from './prng'
export const BOOTSTRAP_B = 2000
export interface BootstrapPair { a: boolean; b: boolean }

// RED contract skeleton; Task 2 supplies the percentile bootstrap next.
export function pairedBootstrapCI(
  _pairs: readonly BootstrapPair[],
  _statistic: (sample: readonly BootstrapPair[]) => number,
  _rng: SeededRng,
  B = BOOTSTRAP_B,
): { lower: number; upper: number; B: number } {
  return { lower: 0, upper: 0, B }
}
