import type {
  ArtifactRef,
  DeclaredModelProfile,
  RecordedRetrievalRung,
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
   * Run-constant retrieval rung recorded beside — never inside — the brief (413 D-07,
   * 407 D-13), so `briefDigest` and §A11's exactly-three channels stay untouched. Absent on
   * legacy cassettes and on runs with no knowledge reader bound; the census counts those as
   * `legacy-no-rung` rather than hiding them.
   */
  retrievalRung?: RecordedRetrievalRung
  /**
   * Ordered non-action exchanges from the live turn (D-03/T-367-03). They are opaque
   * evidence data; consumers must never execute their model-authored arguments or results.
   */
  exchanges: ToolExchangeEvidence[]
  /** Declared model and sampling intent; unavailable values remain absent (D-03). */
  modelProfile?: DeclaredModelProfile
  /** Typed planner-screenshot identity; absent until later phases mint it (D-14/T-367-23). */
  decisionScreenshotRef?: ArtifactRef
  /** Ordered non-screenshot evidence refs kept distinct from the screenshot role (D-14). */
  auxiliaryArtifactRefs?: readonly ArtifactRef[]
}
