export type {
  PlatformAdapter,
  ActionsFor,
  ObserveOptions,
  ScreenState,
  ScreenStateMetadata,
  ElementInfo,
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
