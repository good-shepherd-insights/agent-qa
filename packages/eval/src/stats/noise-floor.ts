import type { DecisionVector, PairedDecisionDiff } from './paired'

export type NoiseFloorPairKind = 'same-seed' | 'two-seed'
export interface AxisNoiseFloor {
  n: number
  reference?: { correct: number; n: number }
  sameSeedSpread?: number
  twoSeedSpread?: number
  wilsonHalfWidth?: number
  aggregateFloor?: number
  pairs: readonly { a: number; b: number; kind: NoiseFloorPairKind; diff: PairedDecisionDiff }[]
}

// RED contract skeleton; Task 3 supplies the repeated-run fold next.
export function computeNoiseFloor(_input: {
  sameSeed: readonly (readonly DecisionVector[])[]
  otherSeed: readonly (readonly DecisionVector[])[]
  z?: number
}): AxisNoiseFloor {
  return { n: 0, pairs: [] }
}
