// Grounding barrel (Phase 357, GROUND-01/GROUND-02). The shared matcher + the
// rung-composed ladder. Consumed by the pre-execution gate (Plan 04) and, via the
// absorbed cache/reground.ts seam, by the cache replay path.

export { matchDescriptor } from './matcher.js'
export type {
  DescriptorInput,
  DescriptorMatchInput,
  MatchResult,
  PriorContext,
} from './matcher.js'

export { assembleLadder, refValidateRung, runLadder, treeSearchRung } from './rungs.js'
export type {
  GroundingRung,
  LadderOptions,
  RunLadderResult,
  RungOutcome,
  RungRequest,
} from './rungs.js'

export { groundActionPlan } from './gate.js'
export type { GateOptions, GateResult, GateVisualRung, GroundActionPlanInput } from './gate.js'
