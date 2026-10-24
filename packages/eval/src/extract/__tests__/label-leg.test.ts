import type { CassetteLabelLeg } from '../../cassette/label-leg'
import { describe, expect, it } from 'vitest'
import { makeV2Handoff } from '../../__tests__/fixtures/handoff-fixtures'
import { projectLabelLeg } from '../label-leg'

function expectReservedFieldsAbsent(leg: CassetteLabelLeg): void {
  expect(leg.rootCause).toBeUndefined()
  expect(leg.pairing).toBeUndefined()
  expect(Object.hasOwn(leg, 'rootCause')).toBe(false)
  expect(Object.hasOwn(leg, 'pairing')).toBe(false)
}

describe('projectLabelLeg', () => {
  it('maps a passing recorded verdict to the silver recorded-verdict channel', () => {
    const step = makeV2Handoff().tests[0]!.steps[0]!
    const leg = projectLabelLeg({ step, subAction: step.subActions[0]! })

    expect(leg).toEqual({
      verdict: step.verifierVerdict,
      sourceChannel: 'recorded-verdict',
      tier: 'silver',
    })
    expect(leg.verdict).toBe(step.verifierVerdict)
    expectReservedFieldsAbsent(leg)
  })

  it('projects a failing verdict and its recorded verifier reasoning', () => {
    const step = makeV2Handoff().tests[1]!.steps[0]!
    const leg = projectLabelLeg({ step, subAction: step.subActions[0]! })

    expect(leg.verdict).toEqual({
      pass: false,
      reasoning: 'Continue remained blocked after execution',
    })
    expect(leg.recordedFailure).toEqual({
      verifierReasoning: 'Continue remained blocked after execution',
    })
    expectReservedFieldsAbsent(leg)
  })

  it('adds only recorded planning-failure and typed-termination context', () => {
    const handoff = makeV2Handoff()
    const decisionStep = handoff.tests[1]!.steps[0]!
    const planningFailureStep = handoff.tests[1]!.steps[1]!
    const step = {
      ...decisionStep,
      planningFailure: planningFailureStep.planningFailure,
      termination: { kind: 'infeasible', reason: 'The checkout cannot progress' } as const,
    }

    const leg = projectLabelLeg({ step, subAction: step.subActions[0]! })

    expect(leg.recordedFailure).toEqual({
      verifierReasoning: 'Continue remained blocked after execution',
      planningFailureReason: 'tool-loop-exhausted',
      termination: 'The checkout cannot progress',
    })
    expectReservedFieldsAbsent(leg)
  })

  it('keeps recordedFailure absent when the step has no recorded failure fields', () => {
    const step = makeV2Handoff().tests[0]!.steps[0]!
    const leg = projectLabelLeg({ step, subAction: step.subActions[0]! })

    expect(Object.hasOwn(leg, 'recordedFailure')).toBe(false)
    expectReservedFieldsAbsent(leg)
  })
})
