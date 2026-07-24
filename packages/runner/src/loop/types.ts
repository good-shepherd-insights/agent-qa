// Re-derived loop type vocabulary for the runner-owned step-execution spine (D-02).
// CRITICAL: provider-neutral + storage-neutral. No node:* imports, no fs/sharp,
// no core/model/adapter package imports. Types only — from @vostride/agent-qa-schema,
// the sibling runner modules, and the neutral orchestration SDK (`ai`, D-04).
// Re-derived from v1 core/src/agent/types.ts; the v1 healing config type and the
// per-step attempt-limit fields are D-10 deletion targets and are intentionally
// absent here.

import type { LanguageModel } from 'ai'
import type {
  GroundingAttempt,
  InterpolatedVariable,
  ModelCallRecord,
  ScreenState,
  ToolExchangeEvidence,
  WorkingMemoryEntry,
} from '@vostride/agent-qa-schema'
import type { Action } from '../platform.js'
import type { TokenUsage } from '../result.js'

/**
 * A planned action plus the frozen v45 plan envelope (D-09). Structural mirror of
 * core's ActionPlanSchema output; the v45 tool registry (this plan, task 3) produces it.
 */
export interface ActionPlan {
  reasoning: string
  action: { type: string; [key: string]: unknown }
  confidence: number
  stepComplete: boolean
  stepFailed?: boolean
  /**
   * D-09/GROUND-01 grounding-attempts carriage. When the planning turn grounds the
   * action in-turn (via the injected groundability callback), the gate's §A8
   * GroundingAttempt trail rides here so the resolved-descriptor evidence reaches
   * executeStep (threaded onto StepEvidence in Plan 07). Absent when no grounding
   * callback is injected or the gate recorded no attempts.
   */
  groundingAttempts?: GroundingAttempt[]
  /**
   * WM-01 write channel (spec §12.15, ratified 2026-07-05). Verbatim facts the planner captured
   * this turn via the `remember[]` plan-field; the loop hands them to the run-scoped
   * `WorkingMemoryStore` (Plan 08 wiring). Absent when the planner captured nothing this turn.
   */
  remember?: WorkingMemoryEntry[]
  /**
   * D-09 bulk-loop completion predicate. On a "do X to all" step the planner declares the positive
   * completion predicate here and re-states it each turn; the verifier backstops. Absent for
   * non-bulk steps.
   */
  bulkCompletionPredicate?: string
  /**
   * D-04 infeasible terminal outcome (EXEC-05, spec §12.10). The additive plan-field envelope
   * (358 remember[] precedent) by which a turn declares the step terminally infeasible — the
   * requested capability/screen does not exist in this build. Closed literal union ('infeasible'
   * today, extensible later); machine-distinguishable from a plain `stepFailed`. When set, the
   * loop routes it into a typed StepEvidence.termination block and a distinct verdict outcome
   * (Plan 10 seam). Absent for an ordinary failure.
   */
  failureKind?: 'infeasible'
  /**
   * D-04 infeasible reason — required whenever `failureKind` is set (enforced at the
   * toolCallToActionPlan parse boundary). The human-readable why, recorded verbatim in the
   * termination evidence block. Absent unless `failureKind` is present.
   */
  failureReason?: string
}

export interface PlannerConfig {
  maxSubActions: number
  previousStepCount: number
}

export interface PlanResult {
  plan: ActionPlan
  tokenUsage?: TokenUsage
  /**
   * Ordered non-action exchanges from this live planning decision (D-01).
   * Absent for cache-replay-produced results, which have no live planning turn.
   */
  exchanges?: ToolExchangeEvidence[]
  /**
   * Observed final-response metadata for this live planning decision (D-05/D-08).
   * Absent when the provider exposes no call record or no live model call occurred.
   */
  callRecord?: ModelCallRecord
}

export interface VerificationResult {
  success: boolean
  reasoning: string
  isAppError: boolean
}

export interface VerifyResult {
  verification: VerificationResult
  tokenUsage?: TokenUsage
}

export interface StepContext {
  stepInstruction: string
  testName: string
  testContext?: string
  suiteContext?: string
  previousSteps: { instruction: string; outcome: string; reasoning?: string; plannedAction?: string; verifierResponse?: string }[]
  contextWindow?: number
  plannerModel: LanguageModel
  verifierModel: LanguageModel
  modelId?: string
  variables?: Record<string, string>
  /**
   * The `{{env:NAME}}` bindings that interpolated into `stepInstruction` before this step
   * was planned (PROC-01 · 381 D-03/D-08). DESTINATION: stamped verbatim onto
   * `StepEvidence.interpolatedVariables` at finalize, where the procedure-extraction emit
   * fold reads it to classify a trajectory value slot back to its source binding NAME.
   *
   * Carried VERBATIM end to end — never masked (unlike `variables` above, which is
   * secret-redacted for the planner). See the masking prohibition documented on
   * `StepEvidence.interpolatedVariables`: masking would break the consumer's exact-match
   * classification for email-valued and credential-named bindings.
   *
   * Absent/empty when the step's text interpolated nothing — finalize then stamps nothing.
   */
  interpolatedVariables?: readonly InterpolatedVariable[]
  /**
   * D-12/D-13 compatibility slot for a directly supplied learned brief. Reader-backed runs use
   * the structured L1/L2/truncation fields below; buildVolatileTier applies the same hypotheses
   * frame to either source. Empty/undefined omits the learned section entirely.
   */
  knowledgeBrief?: string
  /**
   * BRIF-01 human-authored/sovereign L0 policy material. It is isolated from learned spans so
   * buildContextTier can keep only this byte-stable material in the cached-prefix region.
   */
  knowledgePolicyL0?: string
  /** BRIF-01 learned caution summaries rendered under the volatile hypotheses frame. */
  knowledgeBriefL1?: string
  /** BRIF-01 learned procedure/high-trust-fact summaries rendered in the volatile tier. */
  knowledgeBriefL2?: string
  /** BRIF-01 reader-provided clipping signal; empty/undefined means no signal is rendered. */
  knowledgeBriefTruncation?: string
  /**
   * CR-08 immutable UTC date for planner prompt evidence, captured once per step as
   * `YYYY-MM-DD`. When absent, direct legacy prompt-builder callers retain the current
   * UTC-date fallback. Bound values cross this type unchanged; the production capture
   * boundary validates the closed date form before persistence.
   */
  promptDate?: string
  /**
   * D-12/D-13 working-memory channel (structured turn content). The run-scoped
   * `WorkingMemoryStore` set, injected verbatim as its own turn message by `composeTurnMessages`
   * — the second v2 channel replacing the retired single memory-context string. Phase 358
   * SANCTIONED BREAK (D-12/D-13): this was a plain `string` slot; it is now `WorkingMemoryEntry[]`
   * (no shim, no string overload) so the planner receives the structured verbatim set. Empty
   * array/undefined ⇒ omitted from the turn entirely (empty-slot omission).
   */
  workingMemory?: WorkingMemoryEntry[]
  /**
   * D-01/D-07 stagnation classification block (per-turn VOLATILE turn content — it rides
   * `composeTurnMessages` ONLY, NEVER the cached system tiers, Pitfall 3). Populated by Plan 08
   * when the deterministic classifier flags a stagnating anchor. The block hands the planner the
   * classification, the stagnating control's anchor (`role + nameNormalized + ordinal` — the
   * wandering ban's positive half: the exact control it MUST remediate), and the raw diff facts
   * (rendered injection-inert as opaque display text, renderDescriptor precedent). For the
   * `unresponsive` class the block renders facts only, no suggested remediation (D-02). The
   * classification/anchor/diff render triplet and the D-04 `bannedSubstitutions` gate-ban list are
   * INDEPENDENTLY optional: a turn may carry only the render block (a planner-routed rung with no
   * ban), only the ban list (a banned anchor with nothing to render), or both. The ban list drives
   * the deterministic longpress-for-tap gate rejection the planner's groundability closure enforces
   * pre-gate. Absent entirely when no anchor is stagnating this turn (empty-slot omission).
   */
  stagnation?: {
    classification?: string
    anchor?: { role: string; nameNormalized: string; ordinal: number }
    diff?: string
    bannedSubstitutions?: Array<{ anchorKey: string; banned: string; required: string }>
  }
  /**
   * D-08 cycle-break block (per-turn VOLATILE turn content). One-shot per step: the first
   * confirmed cycle flag surfaces this block (the revisited key + the W-window summary + the
   * §7.1 change-approach-or-stepFailed instruction) in the next planning turn; a following window
   * with zero progress ends the step. Absent otherwise.
   */
  cycleBreak?: { revisitedKey: string; windowSummary: string }
  /**
   * D-09 active bulk-completion predicate (per-turn VOLATILE turn content). While a bulk
   * "do X to all" loop is running, the planner's declared positive predicate is re-stated each
   * turn with the re-evaluate/cite-positive-evidence instruction. Absent for non-bulk steps.
   */
  bulkCompletionPredicate?: string
  failureContext?: string
  /**
   * Sub-actions already attempted in this step (multi-action mode). Phase 358 retired the v1
   * per-entry screen-change heuristic flag — the differential-observation oracle's `localEffect`
   * block (SubActionEvidence) is the sanctioned progress signal now (§12.16 replacement).
   */
  subActionHistory?: { action: string; reasoning?: string; result: 'success' | 'failure'; error?: string; verifierRejection?: string; data?: string }[]
  plannerConfig?: PlannerConfig
  screenshot?: Buffer
  /**
   * Vision-gate prompt note for this run (D-11). Non-empty only for text-only
   * models; injected into the planner prompt when present.
   */
  promptNote?: string
  /**
   * D-13 re-run-after-failure context (LOOP-03). A re-run carries everything (full
   * memory/context, no ablation) plus an explicit run-level flag and the prior
   * attempt's failure summary, surfaced to the planner as prompt context.
   */
  isRerun?: boolean
  rerunAttempt?: number
  previousFailureSummary?: string
}

export interface Planner {
  plan(step: string, screenState: ScreenState, context: StepContext, abortSignal?: AbortSignal): Promise<PlanResult>
}

export interface Verifier {
  verify(step: string, before: ScreenState, after: ScreenState, action: Action, screenshot?: Buffer, abortSignal?: AbortSignal, promptNote?: string, bulkCompletionPredicate?: string): Promise<VerifyResult>
  /**
   * D-05 AI judge lane (EXEC-07, spec §9.6/§12.2) — OPTIONAL so every existing Verifier
   * implementor keeps compiling (D-05: no new port). Plan 09 implements this on LLMVerifier
   * against the injected model handle; the loop (Plan 10 seam) routes `assertAI` through it
   * exactly once per attempt (single-model law). A single-shot judgment over the current
   * observation returning the verdict + rationale. `opts` carries the requested-but-deferred
   * M3/M4 knobs (consensus/video/effort) so demand is recorded (D-09).
   */
  judgeClaim?(claim: string, screen: ScreenState, opts?: Record<string, unknown>): Promise<{ verdict: boolean; rationale: string }>
  /**
   * D-07 AI extraction lane (EXEC-07, spec §9.6) — OPTIONAL, same no-new-port rationale as
   * `judgeClaim`. Plan 09 implements it on LLMVerifier; the loop routes `extractAI` through it,
   * writes the extracted fields into run-scoped working memory (`scope:'run'`), and degrades
   * `scope:'global'` to the same run-scoped write (D-07). Returns the extracted field map.
   */
  extractData?(query: string, screen: ScreenState, opts?: Record<string, unknown>): Promise<Record<string, unknown>>
}

// Assertion vocabulary (re-derived from v1 core/src/agent/types.ts). The asserter
// and buildAssertionPrompt (this plan, 353-03) are the sole consumers; kept in the
// runner loop vocabulary so asserter.ts imports resolve to runner-local modules only.
export type AssertionType = 'text-presence' | 'element-visibility' | 'url-match' | 'element-count' | 'ai'

export interface AssertionInput {
  type: AssertionType
  value: string
  expected?: string
}

export interface AssertionResult {
  passed: boolean
  assertionType: AssertionType
  expected: string
  actual: string
  reasoning: string
}

export interface Asserter {
  evaluate(assertion: AssertionInput, screenState: ScreenState): Promise<AssertionResult>
}

// Extraction vocabulary (Phase 363 D-07) — the runner owns the full capture surface:
// buildExtractionPrompt (prompts.ts), the ExplicitExtractor + createExtractor factory
// (variables/extractor.ts), and the LLMVariableExtractor (loop/llm-variable-extractor.ts).
export type ExtractionMethod = 'regex' | 'selector' | 'ai'

export interface ExtractorInput {
  method: ExtractionMethod
  variableName: string
  pattern?: string
  selector?: string
  description?: string
}

export interface CaptureResult {
  success: boolean
  variableName: string
  value?: string
  reasoning: string
}

export interface VariableExtractor {
  extract(input: ExtractorInput, screenState: ScreenState): Promise<CaptureResult>
}
