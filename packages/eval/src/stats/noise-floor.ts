// FLOOR-02 purity law: no clock, no randomness, no host modules; repeats arrive as data.
import { pairedDecisionDiff } from './paired'
import type { DecisionVector, PairedDecisionDiff } from './paired'
import { wilsonInterval } from './wilson'

export type NoiseFloorPairKind = 'same-seed' | 'two-seed'
export interface AxisNoiseFloor {
  n: number
  reference?: { correct: number; n: number }
  sameSeedSpread?: number
  twoSeedSpread?: number
  wilsonHalfWidth?: number
  aggregateFloor?: number
  /** a indexes sameSeed; b indexes sameSeed or otherSeed according to kind. */
  pairs: readonly { a: number; b: number; kind: NoiseFloorPairKind; diff: PairedDecisionDiff }[]
}

function runPairs(
  left: readonly (readonly DecisionVector[])[],
  right: readonly (readonly DecisionVector[])[],
  kind: NoiseFloorPairKind,
): AxisNoiseFloor['pairs'][number][] {
  const pairs: AxisNoiseFloor['pairs'][number][] = []
  for (let a = 0; a < left.length; a++) {
    for (let b = kind === 'same-seed' ? a + 1 : 0; b < right.length; b++) {
      pairs.push({ a, b, kind, diff: pairedDecisionDiff(left[a]!, right[b]!) })
    }
  }
  return pairs
}

function maxSpread(pairs: AxisNoiseFloor['pairs']): number {
  return pairs.reduce((max, pair) => Math.max(max, Math.abs(pair.diff.deltaAcc ?? 0)), 0)
}

export function computeNoiseFloor(input: {
  sameSeed: readonly (readonly DecisionVector[])[]
  otherSeed: readonly (readonly DecisionVector[])[]
  z?: number
}): AxisNoiseFloor {
  const { sameSeed, otherSeed, z } = input
  if (sameSeed.length < 3 || otherSeed.length < 1) {
    throw new TypeError('noise floor requires at least three same-seed and one other-seed runs')
  }
  const referenceRun = sameSeed[0]!
  const n = referenceRun.length
  if (n === 0) return { n: 0, pairs: [] }
  const correct = referenceRun.filter(v => v.correct).length
  const sameSeedPairs = runPairs(sameSeed, sameSeed, 'same-seed')
  const twoSeedPairs = runPairs(sameSeed, otherSeed, 'two-seed')
  const sameSeedSpread = maxSpread(sameSeedPairs)
  const twoSeedSpread = maxSpread(twoSeedPairs)
  const wilsonHalfWidth = wilsonInterval(correct, n, z)!.halfWidth
  return {
    n,
    reference: { correct, n },
    sameSeedSpread,
    twoSeedSpread,
    wilsonHalfWidth,
    aggregateFloor: Math.max(sameSeedSpread, twoSeedSpread, wilsonHalfWidth),
    pairs: [...sameSeedPairs, ...twoSeedPairs],
  }
}
