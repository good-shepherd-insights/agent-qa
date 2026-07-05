import type { Action } from '../action/index'
import type { ArtifactRef } from '../ids/artifact-ref'
import type { RecordedActionResult } from '../result/index'
import type { ScreenState } from '../screen/screen-state'
import type { GroundingEvidence } from '../screen/target-descriptor'

export interface SubActionEvidence {
  plan: string
  plannedAction: Action
  stateBefore: ScreenState
  stateAfter?: ScreenState
  result: RecordedActionResult
  decisionScreenshotRef?: ArtifactRef
  artifactRefs?: ArtifactRef[]
  /**
   * The §A8 grounding evidence (GROUND-02). Present only when the grounder ran for
   * this sub-action: it carries the descriptor the planner emitted plus one attempt
   * entry per ladder rung run — an unattempted visual rung records outcome 'skipped',
   * and `resolvedRef` is present only on a 'resolved' rung.
   */
  grounding?: GroundingEvidence
}
