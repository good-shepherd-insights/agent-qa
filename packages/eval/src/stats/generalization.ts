export const HELD_OUT_GENERALIZATION_MIN = 0.7
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

// RED contract skeleton; Task 2 supplies the lift preconditions next.
export function generalizationRatio(
  _input: GeneralizationRatioInput,
): { verdict: 'in-floor'; ratio?: undefined } | { verdict: 'generalizes' | 'overfit'; ratio: number } {
  return { verdict: 'in-floor' }
}
