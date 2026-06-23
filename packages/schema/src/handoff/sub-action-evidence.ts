import type { Action } from '../action/index'
import type { ArtifactRef } from '../ids/artifact-ref'
import type { RecordedActionResult } from '../result/index'
import type { ScreenState } from '../screen/screen-state'

export interface SubActionEvidence {
  plan: string
  plannedAction: Action
  stateBefore: ScreenState
  stateAfter?: ScreenState
  result: RecordedActionResult
  decisionScreenshotRef?: ArtifactRef
  artifactRefs?: ArtifactRef[]
}
