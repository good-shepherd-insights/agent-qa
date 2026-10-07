// 2026-10-08, 436-13 (D-18, D-17): compile-checked exact key sets for the narrowed and new
// TypeScript-only contracts. PlannerConfig governs what every door passes the loop; StepContext
// lost its progress members; StepEvidence and SubActionEvidence gained the limit and operation
// members new runs persist, and keep stagnation, cycle and localEffect as reader-only members.
import { describe, expectTypeOf, it } from 'vitest'
import type {
  CycleEvidence,
  LimitStopEvidence,
  LocalEffectEvidence,
  OperationCaptureAvailability,
  OperationEvidence,
  StagnationEvidence,
  StepEvidence,
  StepLimitUsage,
  SubActionEvidence,
} from '@vostride/agent-qa-schema'

import type { PlannerConfig, StepContext } from '../types.js'

describe('C436-KEY-SETS narrowed types', () => {
  it('PlannerConfig has exactly the limit pair and previousStepCount', () => {
    expectTypeOf<keyof PlannerConfig>().toEqualTypeOf<'maxActions' | 'maxPlanningTurns' | 'previousStepCount'>()
    expectTypeOf<PlannerConfig>().toEqualTypeOf<{ maxActions: number; maxPlanningTurns: number; previousStepCount: number }>()
  })

  it('StepContext has no stagnation or cycle-break member', () => {
    // @ts-expect-error StepContext has no stagnation member (436-03).
    type ContextStagnation = StepContext['stagnation']
    // @ts-expect-error StepContext has no cycle-break member (436-03).
    type ContextCycleBreak = StepContext['cycleBreak']
    expectTypeOf<ContextStagnation | ContextCycleBreak>().toBeAny()
  })

  it('StepEvidence has the limit and capture members and keeps stagnation and cycle reader-only', () => {
    expectTypeOf<Pick<StepEvidence, 'limitStop' | 'limitUsage' | 'operationCapture'>>().toEqualTypeOf<{
      limitStop?: LimitStopEvidence
      limitUsage?: StepLimitUsage
      operationCapture?: OperationCaptureAvailability
    }>()
    expectTypeOf<Pick<StepEvidence, 'stagnation' | 'cycle'>>().toEqualTypeOf<{
      stagnation?: StagnationEvidence
      cycle?: CycleEvidence
    }>()
  })

  it('SubActionEvidence has operationEvidence and keeps localEffect reader-only', () => {
    expectTypeOf<Pick<SubActionEvidence, 'operationEvidence' | 'localEffect'>>().toEqualTypeOf<{
      operationEvidence?: OperationEvidence
      localEffect?: LocalEffectEvidence
    }>()
    expectTypeOf<keyof OperationEvidence>().toEqualTypeOf<'downloads' | 'clipboard'>()
  })
})
