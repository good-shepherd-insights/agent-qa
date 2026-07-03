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
