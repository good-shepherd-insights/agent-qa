import type { MemberTestOutcome } from '../run/member-outcome'
import type { StepEvidence } from './step-evidence'
import type { Verdict } from '../verdict/verdict'

export interface PerTestOutcome {
  testId: string
  /**
   * The parsed test's human display name exactly as core binds it (ABRF-02/D-14).
   * Stable test identity = filePath + testName. `testId` remains the explicit
   * machine id and never substitutes for this name.
   */
  testName: string
  /**
   * The member test file's path exactly as the CLI resolves it (ABRF-02). Stable test
   * identity = filePath + testName — rebuildable from handoff.json alone. REQUIRED, not
   * optional, under the v2 no-back-compat law: new handoffs always mint it; older
   * handoff.json files that fail the current-schema load are skipped by the projection
   * rebuild (RESEARCH A2, doc-commented at the rebuild site in plan 381-05).
   */
  filePath: string
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
