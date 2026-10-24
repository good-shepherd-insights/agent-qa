// FLOOR-03 purity law: only in-memory correctness and identity, no clock or host modules.
import type { DecisionVector } from './paired'

export type FloorAxis = 'headline' | 'elementIdentity' | 'value' | 'opClass' | 'sideEffect' | 'loop'
// prettier-ignore
export const FLOOR_AXES = ['headline', 'elementIdentity', 'value', 'opClass', 'sideEffect', 'loop'] as const satisfies readonly FloorAxis[]
export type AxisCorrectness = 'correct' | 'incorrect' | 'not-applicable'

export interface DecisionCorrectnessVector {
  /** `${cassetteId}#${stepIndex ?? '-'}#${decisionOrdinal}`; supplied by the scoring fold. */
  key: string
  cassetteId: string
  stepIndex?: number
  decisionOrdinal: number
  product: string
  briefSource: 'proof' | 'rendered' | 'empty'
  axes: Record<FloorAxis, AxisCorrectness>
}

/** Exclude inapplicable decisions from this axis's denominator; retain identity only. */
export function axisVectors(
  vectors: readonly DecisionCorrectnessVector[],
  axis: FloorAxis,
): DecisionVector[] {
  return vectors
    .filter(v => v.axes[axis] !== 'not-applicable')
    .map(v => ({ key: v.key, correct: v.axes[axis] === 'correct' }))
}
