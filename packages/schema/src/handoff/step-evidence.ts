import type { Action } from '../action/index'
import type { ServedBrief } from '../brief/served-brief'
import type { RecordId } from '../ids/record-id'
import type { WorkingMemoryEntry } from '../memory/working-memory-entry'
import type { RecordedActionResult } from '../result/index'
import type { DeclaredModelProfile, ModelIdentity } from './model-call-profile'
import type { CycleEvidence, StagnationEvidence } from './progress-evidence'
import type { SubActionEvidence } from './sub-action-evidence'
import type { PlanningFailureEvidence } from './tool-exchange'
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

/**
 * D-12 typed step plan source. `procedure-replay` = the step's actions came from a committed
 * procedure's guarded replay, carrying the guard fold (and the first miss when the fold broke
 * off). `procedure-hint` = a matched procedure was SERVED as a hint into planning without
 * replay — recorded here so M3 gate audits can measure served-hint exposure (RESEARCH Open
 * Q3: beside `planSource` on StepEvidence, never a ServedBrief widening).
 */
export type StepPlanSource =
  | {
      kind: 'procedure-replay'
      procedureId: RecordId
      guard: {
        checksPassed: number
        total: number
        miss?: {
          procedureStepIndex: number
          reason:
            | 'descriptor-ambiguous'
            | 'descriptor-missing'
            | 'page-anchor-mismatch'
            | 'gate-refused'
            // A bind-time availability gap (D-08), distinct from an invalid action shape.
            | 'parameter-unbound'
            | 'non-replayable-action'
        }
      }
    }
  | { kind: 'procedure-hint'; procedureId: RecordId }

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
  /**
   * The run's configured decision context, embedded per step including cache-hit steps
   * (D-06). New runs populate it by construction; it remains optional only for structural
   * absence in port-less harnesses under the D-04 version rule.
   */
  modelProfile?: DeclaredModelProfile
  /**
   * The deterministic 64-hex digest of the run platform's bound tool surface (INST-04,
   * D-16). It is its own receipt component because tool surface and model identity are
   * independent attribution inputs.
   */
  toolSchemaDigest?: string
  subActions: SubActionEvidence[]
  verifierVerdict: VerifierVerdict
  /**
   * The verifier's declared identity recorded beside its verdict (D-07), without widening
   * the broadly constructed `VerifierVerdict` value.
   */
  verifierIdentity?: ModelIdentity
  /**
   * The failed planning-turn block (D-03). Present only when planning failed structurally,
   * preserving that turn's exchanges instead of silently losing them.
   */
  planningFailure?: PlanningFailureEvidence
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
  /**
   * The typed step plan source (D-12). Additive optional BESIDE the existing `cacheStatus`
   * provenance — structurally distinct from the cached flag so eval/cassette consumers reading
   * cached semantics are never polluted (§A11 stays exactly the three memidex channels).
   * Present only when a procedure drove or hinted this step's planning; absent means the
   * historical single source (a planning turn, with the action cache as an exact-key shortcut).
   */
  planSource?: StepPlanSource
}
