import { describe, expect, it } from 'vitest'
import {
  makeDegradedV2Handoff,
  makeV2Handoff,
} from '../../__tests__/fixtures/handoff-fixtures'
import { projectInputLeg } from '../input-leg'

describe('projectInputLeg', () => {
  it('projects the recorded planner input field-for-field without merging channels', () => {
    const handoffTest = makeV2Handoff().tests[0]!
    const step = handoffTest.steps[0]!
    const subAction = step.subActions[0]!
    const input = {
      handoffTest,
      step,
      subAction,
      testIndex: handoffTest.testIndex,
      stepIndex: step.stepIndex,
      decisionOrdinal: 0,
    }

    const leg = projectInputLeg(input)

    expect(leg).toEqual({
      testId: handoffTest.testId,
      testIndex: handoffTest.testIndex,
      stepIndex: step.stepIndex,
      decisionOrdinal: 0,
      stepText: step.stepText,
      stateBefore: subAction.stateBefore,
      servedBrief: step.servedBrief,
      workingMemory: step.workingMemory,
      exchanges: subAction.exchanges,
      modelProfile: step.modelProfile,
    })
    expect(leg.servedBrief).toBe(step.servedBrief)
    expect(leg.workingMemory).toBe(step.workingMemory)
    expect(leg.servedBrief).not.toHaveProperty('workingMemory')
  })

  it('shallow-copies the opaque exchange list without reading its payloads', () => {
    const handoffTest = makeV2Handoff().tests[0]!
    const step = handoffTest.steps[0]!
    const subAction = step.subActions[0]!

    const leg = projectInputLeg({
      handoffTest,
      step,
      subAction,
      testIndex: handoffTest.testIndex,
      stepIndex: step.stepIndex,
      decisionOrdinal: 0,
    })

    expect(leg.exchanges).toEqual(subAction.exchanges)
    expect(leg.exchanges).not.toBe(subAction.exchanges)
    expect(leg.exchanges[0]).toBe(subAction.exchanges![0])
  })

  it('preserves an empty live exchange list', () => {
    const handoffTest = makeV2Handoff().tests[0]!
    const step = handoffTest.steps[1]!
    const subAction = step.subActions[1]!

    expect(
      projectInputLeg({
        handoffTest,
        step,
        subAction,
        testIndex: handoffTest.testIndex,
        stepIndex: step.stepIndex,
        decisionOrdinal: 1,
      }).exchanges,
    ).toEqual([])
  })

  it('keeps working memory and model profile structurally absent when unrecorded', () => {
    const handoffTest = makeDegradedV2Handoff().tests[0]!
    const step = handoffTest.steps[0]!
    const subAction = step.subActions[0]!

    const leg = projectInputLeg({
      handoffTest,
      step,
      subAction,
      testIndex: handoffTest.testIndex,
      stepIndex: step.stepIndex,
      decisionOrdinal: 0,
    })

    expect(Object.hasOwn(leg, 'workingMemory')).toBe(false)
    expect(Object.hasOwn(leg, 'modelProfile')).toBe(false)
  })
})
