export type {
  AgentPhase,
  StepContext,
  PlannerConfig,
  HealingConfig,
  AgentLoopConfig,
  Planner,
  Verifier,
  VerificationResult,
  PlanResult,
  VerifyResult,
  ActionCache,
  ActionPlan,
  AssertionType,
  AssertionResult,
  AssertionInput,
  Asserter,
  ExtractionMethod,
  ExtractorInput,
  CaptureResult,
  VariableExtractor,
} from './types.js'

export { truncateScreenState, hashScreenState, hashStepInstruction, type StepHashInputs } from './observation.js'

export { estimateTokens } from './token-budget.js'

export { LLMPlanner } from './planner.js'

export { LLMVerifier, VerificationResultSchema } from './verifier.js'

export { buildSystemPrompt, buildStepPrompt, buildVerificationPrompt, buildAssertionPrompt, buildExtractionPrompt } from './prompts.js'

// v45 tool registry moved to @vostride/agent-qa-runner (Phase 353, D-04/Open Q1);
// re-exported here transitionally so core's public surface stays stable until 361/363.
export { defaultRegistry, buildTools, toolCallToActionPlan } from '@vostride/agent-qa-runner'
export type { ToolRegistry, ToolDefinition, ToolCategory } from '@vostride/agent-qa-runner'

export { AssertionEvaluator, LLMAssertionEvaluator, createAsserter, AssertionResultSchema } from './asserter.js'

export { executeStep } from './loop.js'

export { runTest, runTestWithRetry } from './runner.js'
export type { AccessibilityCheck, AccessibilityCheckOptions, RunTestConfig } from './runner.js'

export { parseHookInline, stripHookInline } from './hook-inline.js'

export { generateFailureSummary } from './failure-summary.js'

export { VariableStore, interpolateVariables, findBareVariables, findUnresolvedTemplates, ExplicitExtractor, LLMVariableExtractor, createExtractor, ExtractionResultSchema, parseEnvFile, serializeEnvFile } from './variables.js'
export type { VariableSource } from './variables.js'

// Secret machinery moved to @vostride/agent-qa-runner (Phase 353, D-02); re-exported
// here transitionally so core's public surface (cli, dashboard-server) stays stable
// until Phase 361/363.
export {
  SecretStore,
  SecretRedactor,
  SecretConfigError,
  MissingSecretError,
  findSecretTemplates,
  interpolateSecretTemplates,
  resolveSecretTemplatesInValue,
  redactSecretValue,
} from '@vostride/agent-qa-runner'
export type { SecretTemplate, SecretFileMetadata } from '@vostride/agent-qa-runner'
