import type { DecisionVector } from './paired'

export type FloorAxis = 'headline' | 'elementIdentity' | 'value' | 'opClass' | 'sideEffect' | 'loop'
// prettier-ignore
export const FLOOR_AXES = ['headline', 'elementIdentity', 'value', 'opClass', 'sideEffect', 'loop'] as const satisfies readonly FloorAxis[]
export type AxisCorrectness = 'correct' | 'incorrect' | 'not-applicable'

export interface DecisionCorrectnessVector {
  key: string
  cassetteId: string
  stepIndex?: number
  decisionOrdinal: number
  product: string
  briefSource: 'proof' | 'rendered' | 'empty'
  axes: Record<FloorAxis, AxisCorrectness>
}

// RED contract skeleton; Task 3 supplies applicable-axis projection next.
export function axisVectors(
  _vectors: readonly DecisionCorrectnessVector[], _axis: FloorAxis,
): DecisionVector[] {
  return []
}
