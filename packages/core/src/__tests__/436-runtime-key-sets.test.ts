// 2026-10-08, 436-13 (D-18): the runtime key sets beside the narrowed planner config. They govern
// the persisted values in agent-qa.config.yaml and in test and suite files: use.planner accepts
// maxActions, maxPlanningTurns and previousStepCount, and the old refilling key is refused (D-05).
// Every expected set is spelled by hand, never derived from the module under test.
import { describe, expect, it } from 'vitest'

import { PlannerConfigSchema } from '../schema/primitives.js'
import { UseOverrideSchema, UseSchema } from '../schema/use-schema.js'

type Shaped = { shape: Record<string, unknown> }
type Wrapped = { unwrap(): unknown }

const keysOf = (value: unknown): string[] => Object.keys((value as Shaped).shape).sort()
const unwrapped = (value: unknown): unknown => (value as Wrapped).unwrap()

describe('C436-KEY-SETS', () => {
  it('PlannerConfigSchema carries exactly the limit pair and previousStepCount', () => {
    expect(keysOf(PlannerConfigSchema)).toEqual(['maxActions', 'maxPlanningTurns', 'previousStepCount'])
  })

  it('the project use block plans with PlannerConfigSchema', () => {
    expect(keysOf(unwrapped(UseSchema.shape.planner))).toEqual(['maxActions', 'maxPlanningTurns', 'previousStepCount'])
  })

  it('the test and suite use-override planner keys are the same three', () => {
    expect(keysOf(unwrapped(UseOverrideSchema.shape.planner))).toEqual(['maxActions', 'maxPlanningTurns', 'previousStepCount'])
  })
})
