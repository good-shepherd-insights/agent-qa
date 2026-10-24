// FLOOR-04 purity law: no clock, no randomness, no host modules; lift and floor are data.
// Project-adopted (REQUIREMENTS reconciliation 5); the OpenSRE artifact could not be located.
// Report with a bootstrap CI and lift precondition; this threshold is not externally verified.
export const HELD_OUT_GENERALIZATION_MIN = 0.7
// FLOOR-04 lift precondition, also reused as D-13's minimumGateSet lower bound.
export const MIN_LIFT_DECISIONS = 3

export interface GeneralizationRatioInput {
  optimizeLiftDecisions: number
  optimizeLiftRate: number
  heldOutLiftRate: number
  floor: number
}
export type GeneralizationVerdict = 'in-floor' | 'generalizes' | 'overfit'
// prettier-ignore
export const GENERALIZATION_VERDICTS = ['in-floor', 'generalizes', 'overfit'] as const satisfies readonly GeneralizationVerdict[]

export function generalizationRatio(
  input: GeneralizationRatioInput,
): { verdict: 'in-floor'; ratio?: undefined } | { verdict: 'generalizes' | 'overfit'; ratio: number } {
  const { optimizeLiftDecisions, optimizeLiftRate, heldOutLiftRate, floor } = input
  if (
    !Number.isSafeInteger(optimizeLiftDecisions) ||
    ![optimizeLiftRate, heldOutLiftRate, floor].every(Number.isFinite) || floor < 0
  ) {
    throw new TypeError('lift counts must be integers and rates finite, with a nonnegative floor')
  }
  if (optimizeLiftDecisions < MIN_LIFT_DECISIONS || optimizeLiftRate <= floor) {
    return { verdict: 'in-floor' }
  }
  const ratio = heldOutLiftRate / optimizeLiftRate
  return { verdict: ratio >= HELD_OUT_GENERALIZATION_MIN ? 'generalizes' : 'overfit', ratio }
}
