import type { LanguageModel } from 'ai'
import type { Action, TokenUsage } from '@vostride/agent-qa-runner'
import type { ScreenState } from '@vostride/agent-qa-schema'
import type { ActionPlan } from '../schema/action-schema.js'

export type { ActionPlan } from '../schema/action-schema.js'

export interface PlannerConfig {
  maxSubActions: number
  previousStepCount: number
}

export interface PlanResult {
  plan: ActionPlan
  tokenUsage?: TokenUsage
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
  healingConfig: HealingConfig
  modelId?: string
  variables?: Record<string, string>
  memoryContext?: string
  failureContext?: string
  /** Sub-actions already attempted in this step (multi-action mode). */
  subActionHistory?: { action: string; reasoning?: string; result: 'success' | 'failure'; error?: string; verifierRejection?: string; screenChanged?: boolean; data?: string }[]
  plannerConfig?: PlannerConfig
  screenshot?: Buffer
  /**
   * Vision-gate prompt note for this run (D-11). Non-empty only for text-only
   * models; injected into the planner prompt when present. Threaded from the
   * loop's `visionGate.promptNote` — a structural value, not a model import.
   */
  promptNote?: string
}

export interface HealingConfig {
  maxAttempts: number
}

export interface Planner {
  plan(step: string, screenState: ScreenState, context: StepContext, abortSignal?: AbortSignal): Promise<PlanResult>
}

export interface Verifier {
  verify(step: string, before: ScreenState, after: ScreenState, action: Action, screenshot?: Buffer, abortSignal?: AbortSignal, promptNote?: string): Promise<VerifyResult>
}

export interface VerificationResult {
  success: boolean
  reasoning: string
  isAppError: boolean
}

export interface ActionCache {
  get(stepHash: string, screenHash: string): Promise<ActionPlan | null>
  set(stepHash: string, screenHash: string, plan: ActionPlan): Promise<void>
  invalidate(stepHash: string, screenHash: string): Promise<void>
  getSubAction(stepHash: string, index: number): Promise<ActionPlan | null>
  setSubAction(stepHash: string, index: number, plan: ActionPlan): Promise<void>
  invalidateSubActionsFrom(stepHash: string, fromIndex: number): Promise<void>
}

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
