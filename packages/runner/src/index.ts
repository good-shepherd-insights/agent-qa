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
  HealingAttempt,
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
} from './loop/types.js'
export type {
  StepKeyInput,
  ActionPlanCache,
  CompressedScreenshot,
  ScreenshotCompressor,
  SecretResolver,
  SecretRedactorPort,
  LoopScopedLogger,
  LoopLogger,
  LoopPorts,
} from './loop/ports.js'
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
