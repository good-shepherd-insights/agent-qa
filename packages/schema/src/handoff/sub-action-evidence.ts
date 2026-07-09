import type { Action } from '../action/index'
import type { ArtifactRef } from '../ids/artifact-ref'
import type { RecordedActionResult } from '../result/index'
import type { ScreenState } from '../screen/screen-state'
import type { GroundingEvidence } from '../screen/target-descriptor'
import type { ModelCallRecord } from './model-call-profile'
import type { LocalEffectEvidence } from './progress-evidence'
import type { ToolExchangeEvidence } from './tool-exchange'

export interface SubActionEvidence {
  plan: string
  plannedAction: Action
  stateBefore: ScreenState
  stateAfter?: ScreenState
  result: RecordedActionResult
  decisionScreenshotRef?: ArtifactRef
  artifactRefs?: ArtifactRef[]
  /**
   * The ordered non-action tool exchanges from the live planning turn that produced this
   * decision (D-01). Present, possibly empty, for live-turn decisions and structurally
   * absent for cache-hit or replayed sub-actions; values arrive masked under D-02.
   */
  exchanges?: ToolExchangeEvidence[]
  /**
   * Observed enrichment for the live call that produced this decision (D-05/D-08).
   * Absent when no live model call happened; unknown values are never fabricated.
   */
  callRecord?: ModelCallRecord
  /**
   * The §A8 grounding evidence (GROUND-02). Present only when the grounder ran for
   * this sub-action: it carries the descriptor the planner emitted plus one attempt
   * entry per ladder rung run — an unattempted visual rung records outcome 'skipped',
   * and `resolvedRef` is present only on a 'resolved' rung.
   */
  grounding?: GroundingEvidence
  /**
   * The §A8 differential-observation oracle outcome (CYCLE-01, D-07). Present only when
   * the per-verb intended-effect oracle ran for this sub-action: which oracle row keyed
   * on the verb class and whether the action's local intended effect was achieved.
   */
  localEffect?: LocalEffectEvidence
}
