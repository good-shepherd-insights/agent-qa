// Re-derived loop type vocabulary for the runner-owned step-execution spine (D-02).
// CRITICAL: provider-neutral + storage-neutral. No node:* imports, no fs/sharp,
// no core/model/adapter package imports. Types only — from @vostride/agent-qa-schema,
// the sibling runner modules, and the neutral orchestration SDK (`ai`, D-04).
// Re-derived from v1 core/src/agent/types.ts; the v1 healing config type and the
// per-step attempt-limit fields are D-10 deletion targets and are intentionally
// absent here.

import type { LanguageModel } from 'ai'
import type { GroundingAttempt, ScreenState } from '@vostride/agent-qa-schema'
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
}

export interface PlannerConfig {
  maxSubActions: number
  previousStepCount: number
}

export interface PlanResult {
  plan: ActionPlan
  tokenUsage?: TokenUsage
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
  agentRules?: string
  previousSteps: { instruction: string; outcome: string; reasoning?: string; plannedAction?: string; verifierResponse?: string }[]
  contextWindow?: number
  plannerModel: LanguageModel
  verifierModel: LanguageModel
  modelId?: string
  variables?: Record<string, string>
  /**
   * D-12/D-13 knowledge-brief channel (volatile tier). The pre-rendered L2 brief text,
   * framed as hypotheses by `buildVolatileTier` — one of the two v2 channels that replace
   * the retired opaque single memory-context string. Sourced via the `KnowledgeHintReader`
   * port (rendered upstream from its `BriefBlock`); empty/undefined until M2 binds an impl,
   * at which point the volatile tier omits the brief section and degrades to no-brief.
   */
  knowledgeBrief?: string
  /**
   * D-12/D-13 working-memory channel (structured turn content). Run-scoped memory injected
   * as its own turn message by `composeTurnMessages` — the second v2 channel replacing the
   * retired single memory-context string. Empty/undefined until 358 binds the working-memory
   * store; omitted from the turn entirely when absent (empty-slot omission).
   */
  workingMemory?: string
  failureContext?: string
  /** Sub-actions already attempted in this step (multi-action mode). */
  subActionHistory?: { action: string; reasoning?: string; result: 'success' | 'failure'; error?: string; verifierRejection?: string; screenChanged?: boolean; data?: string }[]
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
  verify(step: string, before: ScreenState, after: ScreenState, action: Action, screenshot?: Buffer, abortSignal?: AbortSignal, promptNote?: string): Promise<VerifyResult>
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

// Extraction vocabulary — buildExtractionPrompt (moved with the prompts module) is
// the only consumer in this plan.
export type ExtractionMethod = 'regex' | 'selector' | 'ai'

export interface ExtractorInput {
  method: ExtractionMethod
  variableName: string
  pattern?: string
  selector?: string
  description?: string
}
