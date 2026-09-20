import type { RunDetailArtifactRef, RunDetailSubAction } from '@vostride/agent-qa-schema'
import { decisionScreenshotRef, type RunDetailStepGroup } from './run-detail-view'
import { parseRunDetailStepKey, runDetailStepKey, type Selection } from './selection'

export interface Playhead {
  testIndex: number
  stepIndex: number
  subActionIndex: number | null
}

export interface UsableFrame {
  index: number
  ref: RunDetailArtifactRef
  substitution?: { shown: number; total: number }
}

export function frameUsable(ref: RunDetailArtifactRef | undefined): ref is RunDetailArtifactRef {
  return ref !== undefined && ref.evidenceIncomplete !== true && ref.present !== false
}

export function latestUsableFrame(subActions: readonly RunDetailSubAction[]): UsableFrame | undefined {
  for (let position = subActions.length - 1; position >= 0; position--) {
    const subAction = subActions[position]!
    const ref = decisionScreenshotRef(subAction)
    if (!frameUsable(ref)) continue
    return {
      index: subAction.subActionIndex,
      ref,
      ...(position === subActions.length - 1 ? {} : {
        substitution: { shown: position + 1, total: subActions.length },
      }),
    }
  }
  return undefined
}

export function parkTargetForStep(group: RunDetailStepGroup): Playhead {
  return {
    testIndex: group.step.testIndex,
    stepIndex: group.step.stepIndex,
    subActionIndex: latestUsableFrame(group.subActions)?.index
      ?? group.subActions.at(-1)?.subActionIndex ?? null,
  }
}

function validIndex(index: number): boolean {
  return Number.isSafeInteger(index) && index >= 0
}

export function playheadFromSelection(selection: Selection | null | undefined): Playhead | null {
  if (selection?.type !== 'step' && selection?.type !== 'subaction') return null
  const address = parseRunDetailStepKey(selection.stepId)
  if (!address || (selection.type === 'subaction' && !validIndex(selection.subIndex))) return null
  return { ...address, subActionIndex: selection.type === 'subaction' ? selection.subIndex : null }
}

export function selectionFromPlayhead(playhead: Playhead | null | undefined): Selection | null {
  if (!playhead || !validIndex(playhead.testIndex) || !validIndex(playhead.stepIndex)
    || (playhead.subActionIndex !== null && !validIndex(playhead.subActionIndex))) return null
  const stepId = runDetailStepKey(playhead.testIndex, playhead.stepIndex)
  return playhead.subActionIndex === null
    ? { type: 'step', stepId }
    : { type: 'subaction', stepId, subIndex: playhead.subActionIndex }
}
