import type { Action } from '../action/index'
import type { ServedBrief } from '../brief/served-brief'
import type { WorkingMemoryEntry } from '../memory/working-memory-entry'
import type { RecordedActionResult } from '../result/index'
import type { CycleEvidence, StagnationEvidence } from './progress-evidence'
import type { SubActionEvidence } from './sub-action-evidence'
import type {
  AiJudgmentEvidence,
  AssertValueEvidence,
  ReportedValueEvidence,
  TerminationEvidence,
  VerdictSource,
} from './verb-evidence'

export interface VerifierVerdict {
  pass: boolean
  reasoning: string
}

export interface Decision {
  plan: string
  plannedAction: Action
  result: RecordedActionResult
}

export interface StepEvidence {
  stepIndex: number
  stepText: string
  cacheStatus: 'hit' | 'miss' | 'bypass'
  servedBrief: ServedBrief
  /**
   * The run-scoped verbatim working-memory entries served to this step's planning turns
   * (WM-01, §12.15), masked. Planner INPUT recorded BESIDE the brief — never a
   * `ServedBrief` channel (§A11 stays exactly the three memidex channels). Ratified
   * 2026-07-03; the structured-entry shape lands with Phase 358.
   */
  workingMemory?: WorkingMemoryEntry[]
  subActions: SubActionEvidence[]
  verifierVerdict: VerifierVerdict
  /**
   * The stagnation tree state at a terminal `stepFailed` (CYCLE-02, D-07). Present only
   * when the step failed after the bounded per-element ladder exhausted.
   */
  stagnation?: StagnationEvidence
  /**
   * The cycle-flag terminal block (CYCLE-03, D-07/D-08). Present only when a true cycle
   * was flagged (state revisitation AND no task progress across the window).
   */
  cycle?: CycleEvidence
  selfHeal?: {
    failedDecision: Decision
    recoveringDecision: Decision
  }
  /**
   * The `common_reportValue` answer block (D-03). Present when the step reported a value;
   * masked-before-record. Additive optional — every existing consumer keeps compiling (358-02
   * `workingMemory` idiom).
   */
  reportedValue?: ReportedValueEvidence
  /**
   * The typed infeasible termination block (D-04). Present only when a turn declared the step
   * infeasible via `failureKind`/`failureReason` — distinct from a plain `stepFailed`.
   */
  termination?: TerminationEvidence
  /**
   * The `assertAI`/`extractAI` judge block (D-05/D-06/D-07/D-09). Present when the step ran an
   * AI verb through the verifier model lane; carries verdict, rationale, deferred knobs, and the
   * extractAI global-scope degradation marker.
   */
  aiJudgment?: AiJudgmentEvidence
  /**
   * The structured `common_assertValue` outcome block (D-10/D-11). Present when the step ran a
   * deterministic assertValue comparison; masked-before-record.
   */
  assertOutcome?: AssertValueEvidence
  /**
   * Which path produced this step's verification verdict (D-11): the deterministic assertValue
   * comparator, the assertAI judge, or the verifier's own model call.
   */
  verdictSource?: VerdictSource
}
