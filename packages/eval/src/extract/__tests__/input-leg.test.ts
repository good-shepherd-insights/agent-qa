import type { ArtifactRef, SubActionEvidence } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import {
  FIXTURE_ARTIFACT_SHA,
  FIXTURE_SCREENSHOT_SHA,
  makeArtifactRefV2Handoff,
  makeDegradedV2Handoff,
  makeV2Handoff,
} from '../../__tests__/fixtures/handoff-fixtures'
import { projectInputLeg } from '../input-leg'

function projectWithSubAction(subAction: SubActionEvidence) {
  const handoffTest = makeV2Handoff().tests[0]!
  const step = handoffTest.steps[0]!
  return projectInputLeg({
    handoffTest,
    step,
    subAction,
    testIndex: handoffTest.testIndex,
    stepIndex: step.stepIndex,
    decisionOrdinal: 0,
  })
}

function liveSubActionWith(fields: Partial<SubActionEvidence>): SubActionEvidence {
  const base = makeV2Handoff().tests[0]!.steps[0]!.subActions[0]!
  return { ...base, ...fields }
}

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

describe('projectInputLeg artifact-role bindings', () => {
  const screenshot: ArtifactRef = { id: 'decision-shot', sha: 'a'.repeat(64) }
  const auxA: ArtifactRef = { id: 'aux-a', sha: 'b'.repeat(64) }
  const auxB: ArtifactRef = { id: 'aux-b', sha: 'c'.repeat(64), evidenceIncomplete: true }

  it('projects the decision screenshot only into decisionScreenshotRef', () => {
    const leg = projectWithSubAction(liveSubActionWith({ decisionScreenshotRef: screenshot }))

    expect(leg.decisionScreenshotRef).toEqual(screenshot)
    expect(Object.hasOwn(leg, 'auxiliaryArtifactRefs')).toBe(false)
  })

  it('projects auxiliary refs only into auxiliaryArtifactRefs preserving order', () => {
    const leg = projectWithSubAction(liveSubActionWith({ artifactRefs: [auxA, auxB] }))

    expect(leg.auxiliaryArtifactRefs).toEqual([auxA, auxB])
    expect(Object.hasOwn(leg, 'decisionScreenshotRef')).toBe(false)
  })

  it('keeps screenshot and auxiliary roles distinct when both are present', () => {
    const leg = projectWithSubAction(
      liveSubActionWith({ decisionScreenshotRef: screenshot, artifactRefs: [auxA] }),
    )

    expect(leg.decisionScreenshotRef).toEqual(screenshot)
    expect(leg.auxiliaryArtifactRefs).toEqual([auxA])
  })

  it('preserves the optional evidenceIncomplete marker on auxiliary refs', () => {
    const leg = projectWithSubAction(liveSubActionWith({ artifactRefs: [auxB] }))

    expect(leg.auxiliaryArtifactRefs?.[0]?.evidenceIncomplete).toBe(true)
  })

  it('leaves both fields structurally absent when the source omits them', () => {
    const base = makeV2Handoff().tests[0]!.steps[0]!.subActions[0]!
    const { decisionScreenshotRef: _s, artifactRefs: _a, ...withoutRefs } = base
    void _s
    void _a

    const leg = projectWithSubAction(withoutRefs)

    expect(Object.hasOwn(leg, 'decisionScreenshotRef')).toBe(false)
    expect(Object.hasOwn(leg, 'auxiliaryArtifactRefs')).toBe(false)
  })

  it('shallow-copies the auxiliary array without copying the ref bytes or identity', () => {
    const source = [auxA, auxB]
    const leg = projectWithSubAction(liveSubActionWith({ artifactRefs: source }))

    expect(leg.auxiliaryArtifactRefs).not.toBe(source)
    expect(leg.auxiliaryArtifactRefs?.[0]).toBe(auxA)
  })

  it('maps the wired fixture screenshot and auxiliary refs into their distinct roles', () => {
    const handoff = makeArtifactRefV2Handoff()
    const handoffTest = handoff.tests[0]!
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

    expect(leg.decisionScreenshotRef).toEqual({
      id: 'fixture-screenshot',
      sha: FIXTURE_SCREENSHOT_SHA,
    })
    expect(leg.auxiliaryArtifactRefs).toEqual([
      { id: 'fixture-accessibility-snapshot', sha: FIXTURE_ARTIFACT_SHA },
    ])
  })

  it('is deterministic across repeated projection of the same evidence', () => {
    const subAction = liveSubActionWith({
      decisionScreenshotRef: screenshot,
      artifactRefs: [auxA, auxB],
    })

    expect(projectWithSubAction(subAction)).toEqual(projectWithSubAction(subAction))
  })
})
