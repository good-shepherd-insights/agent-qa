import type { RunDetailArtifactRef, RunDetailSubAction } from '@vostride/agent-qa-schema'
import type { RunDetailStepGroup } from './run-detail-view'
import type { Selection } from './selection'

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
  return false
}

export function latestUsableFrame(subActions: readonly RunDetailSubAction[]): UsableFrame | undefined {
  return undefined
}

export function parkTargetForStep(group: RunDetailStepGroup): Playhead | null {
  return null
}

export function playheadFromSelection(selection: Selection | null | undefined): Playhead | null {
  return null
}

export function selectionFromPlayhead(playhead: Playhead | null | undefined): Selection | null {
  return null
}
