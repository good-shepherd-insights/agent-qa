import { expect, test } from 'vitest'
import type { RunDetailArtifactRef, RunDetailStep, RunDetailSubAction } from '@vostride/agent-qa-schema'
import {
  frameUsable, latestUsableFrame, parkTargetForStep,
  playheadFromSelection, selectionFromPlayhead,
} from '../playhead'
import { runDetailStepKey, type Selection } from '../selection'

function frame(index: number, extra: Partial<RunDetailArtifactRef> = {}): RunDetailArtifactRef {
  const sha = String(index).padStart(64, '0')
  return { id: `decision-screenshot:${sha}`, sha, ...extra }
}

function action(subActionIndex: number, extra: Partial<RunDetailSubAction> = {}): RunDetailSubAction {
  return {
    testIndex: 2, stepIndex: 3, subActionIndex, plan: 'navigate',
    plannedAction: { type: 'navigate', to: 'url', url: 'https://example.test' }, result: { success: true },
    screenStateHash: 'a'.repeat(64), artifactRefs: [frame(subActionIndex)], ...extra,
  }
}

function step(stepIndex = 3, extra: Partial<RunDetailStep> = {}): RunDetailStep {
  return {
    testIndex: 2, stepIndex, cacheStatus: 'miss', verifierVerdict: { pass: true, reasoning: '' },
    selfHealOccurred: false, briefDigest: 'digest', ...extra,
  }
}

test('PARENT-FRAME-RESOLVED', () => {
  const actions = [action(0), action(1), action(2, {
    artifactRefs: [{ id: 'aria:other', sha: 'f'.repeat(64) }, frame(2)],
  })]
  expect(latestUsableFrame(actions)).toEqual({ index: 2, ref: frame(2) })
  expect(parkTargetForStep({ step: step(), subActions: actions })).toEqual({
    testIndex: 2, stepIndex: 3, subActionIndex: 2,
  })
})

test('PARENT-FRAME-SUBSTITUTED', () => {
  for (const missing of [{ evidenceIncomplete: true }, { present: false }]) {
    const actions = [action(0), action(1), action(2, { artifactRefs: [frame(2, missing)] })]
    expect(latestUsableFrame(actions)).toEqual({
      index: 1, ref: frame(1), substitution: { shown: 2, total: 3 },
    })
    expect(parkTargetForStep({ step: step(), subActions: actions })?.subActionIndex).toBe(1)
  }
})

test('PARENT-FRAME-NONE', () => {
  const actions = [action(0, { artifactRefs: [] }), action(1, {
    artifactRefs: [frame(1, { present: false })],
  })]
  expect(parkTargetForStep({ step: step(), subActions: actions })).toEqual({
    testIndex: 2, stepIndex: 3, subActionIndex: 1,
  })
  expect(latestUsableFrame(actions)).toBeUndefined()
  expect(latestUsableFrame([])).toBeUndefined()
  expect(parkTargetForStep({ step: step(), subActions: [] })).toEqual({
    testIndex: 2, stepIndex: 3, subActionIndex: null,
  })
})

test('FRAME-PRESENCE-UNKNOWN-USABLE', () => {
  expect(frameUsable(frame(0))).toBe(true)
  expect(frameUsable(frame(0, { present: true }))).toBe(true)
  expect(frameUsable(undefined)).toBe(false)
  expect(frameUsable(frame(0, { present: false }))).toBe(false)
  expect(frameUsable(frame(0, { present: true, evidenceIncomplete: true }))).toBe(false)
  expect(latestUsableFrame([action(0)])).toEqual({ index: 0, ref: frame(0) })
})

test('PLAYHEAD-SELECTION-ROUNDTRIP', () => {
  const stepId = runDetailStepKey(2, 3)
  const selections: Selection[] = [
    { type: 'step', stepId }, { type: 'subaction', stepId, subIndex: 0 },
  ]
  for (const selection of selections) {
    expect(selectionFromPlayhead(playheadFromSelection(selection))).toEqual(selection)
  }
  expect(playheadFromSelection(selections[0])).toEqual({
    testIndex: 2, stepIndex: 3, subActionIndex: null,
  })
  expect(playheadFromSelection(selections[1])).toEqual({
    testIndex: 2, stepIndex: 3, subActionIndex: 0,
  })
  for (const selection of [null, undefined, { type: 'test', testIndex: 2 } as const,
    { type: 'execution', stepId, logId: 'log' } as const,
    { type: 'step', stepId: 'bad' } as const,
    { type: 'subaction', stepId, subIndex: -1 } as const,
    { type: 'subaction', stepId, subIndex: 0.5 } as const]) {
    expect(playheadFromSelection(selection)).toBeNull()
  }
  expect(selectionFromPlayhead(null)).toBeNull()
  expect(selectionFromPlayhead({ testIndex: NaN, stepIndex: 3, subActionIndex: 0 })).toBeNull()
  expect(selectionFromPlayhead({ testIndex: 2, stepIndex: 3, subActionIndex: Infinity })).toBeNull()
})
