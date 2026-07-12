import type { MemberTestOutcome } from '../run/member-outcome'
import type { StepEvidence } from './step-evidence'
import type { Verdict } from '../verdict/verdict'

export interface PerTestOutcome {
  testId: string
  testIndex: number
  outcome: MemberTestOutcome
  steps: StepEvidence[]
  /**
   * Bounded root-cause classification for this member test (D-01, §A9).
   * Present iff a failure occurred to classify — outcome 'failed'/'timeout',
   * or 'passed' with retryCount > 0 (class 'flake'); clean passes, skipped,
   * and cancelled members omit it. Populated by the runner's deterministic
   * classifier (Phase 373 Plans 06/07); M4's analyze-run upgrades 'unknown'
   * verdicts at this same per-test granularity via ordinary supersession.
   */
  rootCause?: Verdict
}
