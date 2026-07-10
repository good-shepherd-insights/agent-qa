import type {
  DeclaredModelProfile,
  ScreenState,
  ServedBrief,
  ToolExchangeEvidence,
  WorkingMemoryEntry,
} from '@vostride/agent-qa-schema'

/** The complete recorded planner input for one live decision (D-03). */
export interface CassetteInputLeg {
  /** Stable authored test identity copied from the recorded test outcome (D-03). */
  testId: string
  /** Recorded zero-based test position within the run handoff (D-03). */
  testIndex: number
  /** Recorded zero-based step position within the test (D-03). */
  stepIndex: number
  /** Recorded zero-based live-decision position within the step (D-03). */
  decisionOrdinal: number
  /** Resolved instruction text presented for the recorded step (D-03). */
  stepText: string
  /** Persisted observation the planner received before choosing the action (D-03). */
  stateBefore: ScreenState
  /** Exact three-channel knowledge brief served for this step (D-03/A11). */
  servedBrief: ServedBrief
  /** Run-scoped planner memory served beside, never merged into, the brief (D-03/A11). */
  workingMemory?: WorkingMemoryEntry[]
  /**
   * Ordered non-action exchanges from the live turn (D-03/T-367-03). They are opaque
   * evidence data; consumers must never execute their model-authored arguments or results.
   */
  exchanges: ToolExchangeEvidence[]
  /** Declared model and sampling intent; unavailable values remain absent (D-03). */
  modelProfile?: DeclaredModelProfile
}
