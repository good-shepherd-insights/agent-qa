export type {
  PlatformAdapter,
  ActionsFor,
  ObserveOptions,
  Action,
  ActionResult,
  PlatformConfig,
  BrowserConfig,
  DeviceConfig,
  TimeoutConfig,
  RuntimeAuthStateConfig,
} from './platform.js'
export type { KnowledgeHintReader } from './knowledge-hint-reader.js'
export { assertNever } from './platform.js'

export { buildScreenState, renderScreenTree, stampCaptureMode } from './screen-builder.js'
export type {
  InterimNode,
  BuildScreenStateInput,
  BuildScreenStateResult,
  RefBinding,
  CaptureStamp,
} from './screen-builder.js'

export { makeScreenState, makeInterimNodes } from './testing/screen-fixtures.js'
export type { InterimFixture, InterimFixtureKind } from './testing/screen-fixtures.js'
export { screenConformanceCases } from './testing/conformance.js'
export type { ConformanceInput, ScreenConformanceCase } from './testing/conformance.js'

export type {
  StepStatus,
  TestStatus,
  StepAnnotation,
  TokenUsage,
  SubActionTrace,
  StepTrace,
  StepPhaseEvent,
  AccessibilityViolation,
  ConsoleLogEntry,
  NetworkLogEntry,
  StepResult,
  TestResult,
} from './result.js'

// Step-execution loop spine (re-derived into runner, Phase 353).
export { executeStep } from './loop/index.js'
// Run-scoped working-memory store (Phase 358 · WM-01/WM-02). Exported so the CLI composition
// root constructs one per run and threads it into LoopPorts.workingMemory (the 361 rebind seam).
export { WorkingMemoryStore } from './loop/working-memory/index.js'
export type { WorkingMemoryProvenanceContext } from './loop/working-memory/index.js'
export {
  createTimeoutAbortReason,
  getTimeoutAbortReason,
  withAbort,
} from './loop/abort.js'
export type { AgentAbortScope, AgentTimeoutAbortReason } from './loop/abort.js'
export type {
  ActionPlan,
  PlannerConfig,
  PlanResult,
  VerificationResult,
  VerifyResult,
  StepContext,
  Planner,
  Verifier,
  Asserter,
  AssertionInput,
  AssertionResult,
  AssertionType,
  ExtractionMethod,
  ExtractorInput,
} from './loop/types.js'
export { LLMPlanner } from './loop/planner.js'
export {
  executePlanningTurn,
  DEFAULT_NON_ACTION_TOOL_BUDGET,
} from './loop/planning-turn.js'
export type {
  NonActionToolHandler,
  NonActionToolMap,
  ToolExchange,
  PlanningTurnResult,
  PlanningTurnSuccess,
  PlanningTurnFailure,
  PlanningTurnFailureReason,
  ExecutePlanningTurnOptions,
} from './loop/planning-turn.js'
export { LLMVerifier, VerificationResultSchema } from './loop/verifier.js'
export { AssertionEvaluator, LLMAssertionEvaluator, createAsserter } from './loop/asserter.js'
export {
  buildSystemPrompt,
  buildContextTier,
  buildVolatileTier,
  renderBriefAsHypotheses,
  composeTurnMessages,
  buildVerifierStableTier,
  buildVerificationPrompt,
  buildAssertionPrompt,
  buildExtractionPrompt,
  formatAction,
  estimateTokens,
} from './loop/prompts.js'
export {
  EvidenceRecorder,
  collapseAnnotation,
  makeEmptyServedBrief,
  foldCacheStatus,
  projectLegacyTrace,
} from './loop/evidence.js'
export type { RecordSubActionInput } from './loop/evidence.js'
// Phase 356 redesigned cache port (D-03): the new per-key ActionPlanCache is the
// single public cache surface. The v1 StepKeyInput / v1 sub-action ActionPlanCache
// are intentionally no longer exported here — they survive internally in
// loop/ports.ts until Plan 04 rewires the loop and Plan 06 retires the v1 adapter.
export type {
  CompressedScreenshot,
  ScreenshotCompressor,
  SecretResolver,
  SecretRedactorPort,
  LoopScopedLogger,
  LoopLogger,
  LoopPorts,
  WorkingMemoryPort,
  TokenAccounting,
  RunnerDegradeOptions,
  RunnerDegradeOutcome,
} from './loop/ports.js'

// Redesigned pure cache core (Phase 356, CACHE-01/02/03).
export type {
  ActionPlanCache,
  CachedPlanValue,
  GroundedLocator,
  GroundingStrategy,
  CacheableClassification,
  ClassifyStepInput,
  BuildCacheableStepInputArgs,
  BuildCachedPlanValueInput,
} from './cache/index.js'
export {
  buildCacheableStepInput,
  CACHE_ENV_DIGEST_SALT,
  classifyStep,
  toGroundedLocator,
  buildCachedPlanValue,
  deterministicDescriptorMatcher,
} from './cache/index.js'
export {
  SecretStore,
  SecretRedactor,
  SecretConfigError,
  MissingSecretError,
  findSecretTemplates,
  interpolateSecretTemplates,
  resolveSecretTemplatesInValue,
  redactSecretValue,
  containsRedactedSecretMarker,
} from './loop/secrets.js'
export type { SecretTemplate, SecretFileMetadata } from './loop/secrets.js'

// v45 tool registry — the planned-actions-as-tools substrate (moved from core,
// Phase 353; D-09 frozen envelope). Re-exporting from ./tools/index.js runs its
// top-level registerAllActions side-effect on defaultRegistry. Always-send-all law:
// nothing here gates or shrinks the tool slice.
export { ToolRegistry, defaultRegistry, buildTools, toolCallToActionPlan } from './tools/index.js'
export type { ToolDefinition, ToolCategory } from './tools/index.js'
export { EXPOSURE } from './tools/registry.js'
export { normalizePointerActionForStep } from './tools/pointer-action-normalization.js'
export { convertKeysForPlatform, isMacPlatform } from './tools/actions/key-conversion.js'
