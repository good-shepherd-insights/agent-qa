import type { LanguageModel } from 'ai'
import type { PlatformAdapter, Action, ActionResult } from '@vostride/agent-qa-runner'
import type { StepResult, HealingAttempt, TokenUsage, StepPhaseEvent } from '@vostride/agent-qa-runner'
import type { ScreenState } from '@vostride/agent-qa-schema'
import type { SafetyHookRunner } from '@vostride/agent-qa-safety'
import type { ActionPlan } from '../schema/action-schema.js'
import type { LogManager } from '../logging/log-manager.js'
import type { SecretRedactor, SecretStore } from '@vostride/agent-qa-runner'

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

export type AgentPhase =
  | { type: 'observe' }
  | { type: 'plan'; screenState: ScreenState }
  | { type: 'execute'; action: Action; screenStateBefore: ScreenState }
  | { type: 'verify'; action: Action; screenStateBefore: ScreenState; result: ActionResult }
  | { type: 'heal'; error: string; attempts: HealingAttempt[]; screenStateBefore: ScreenState; failedAction: Action }
  | { type: 'done'; result: StepResult }

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

export interface AgentLoopConfig {
  adapter: PlatformAdapter
  planner: Planner
  verifier?: Verifier
  cache?: ActionCache
  healingConfig: HealingConfig
  plannerConfig?: PlannerConfig
  /** Wall-clock timeout for a single step (ms). 0 or undefined = no timeout. */
  stepTimeout?: number
  /** Override the consecutive failure limit for this step. */
  maxAttempts?: number
  logger?: LogManager
  configContent?: string
  testFileContent?: string
  testFilePath?: string
  stepIndex?: number
  suiteFileContent?: string
  suiteTestIndex?: number
  cacheState?: { invalidated: boolean }
  logCapture?: { console?: boolean; network?: boolean }
  vision?: {
    screenshotSize?: number
    /** Max image edge (pixels) to resize screenshots to before sending to LLM. */
    effectiveResolution?: number
  }
  /**
   * Vision gate for this run. Resolved once per run by the composition root (the
   * CLI), which owns the model package, and threaded here as a structural value —
   * core never imports the model package (D-11). Absent means full-capture
   * behavior (the pre-gate default, used by tests and non-CLI callers).
   */
  visionGate?: { attachImage: boolean; captureMode: 'full' | 'textOnly'; promptNote: string }
  onSetVariable?: (name: string, value: string) => void
  onPhase?: (event: StepPhaseEvent) => void | Promise<void>
  safetyHooks?: SafetyHookRunner
  abortSignal?: AbortSignal
  secretStore?: SecretStore
  secretRedactor?: SecretRedactor
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

export type AssertionType = 'text-presence' | 'element-visibility' | 'url-match' | 'element-count' | 'ai'

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

export interface AssertionInput {
  type: AssertionType
  value: string
  expected?: string
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
