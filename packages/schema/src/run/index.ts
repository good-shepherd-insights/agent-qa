export { asRunId } from './run-id'
export type { RunId } from './run-id'
// 363 D-08: run-artifact payload type family (relocated from core/src/artifacts).
export { RUN_ARTIFACT_SCHEMA_VERSION } from './run-artifact'
export type {
  ArtifactRecord,
  JsonArray,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  RunArtifactConfigSnapshot,
  RunArtifactFinalizeInput,
  RunArtifactKind,
  RunArtifactMemoryDelta,
  RunArtifactMemoryDeltaAction,
  RunArtifactMemoryObservationSnapshot,
  RunArtifactMemorySnapshot,
  RunArtifactMetadata,
  RunArtifactPayload,
  RunArtifactReporterContext,
  RunArtifactRuntimeSnapshot,
  RunArtifactStageInput,
  RunArtifactSuiteMemberSnapshot,
  RunArtifactSuiteSourceSnapshot,
  RunArtifactTerminalError,
  RunArtifactTestSourceSnapshot,
} from './run-artifact'
export type { RunStatus, ExecutionContext } from './run-status'
export { EXECUTION_CONTEXT_VALUES } from './run-status'
export type { MemberTestOutcome } from './member-outcome'
export type { RunSession, RunCompletion } from './run-session'
// Bus schema v1 (D-05): envelope, event union + vocabulary, payload projections.
export { CURRENT_BUS_SCHEMA_VERSION, RUN_EVENT_TYPES } from './bus-events'
export type {
  RunEvent,
  RunEventEnvelope,
  RunEventPayload,
  RunEventType,
  RunStartedPayload,
  RunFinishedPayload,
  VerdictPayload,
  RunWarningPayload,
  RunErrorPayload,
  HeartbeatPayload,
  TestStartedPayload,
  TestFinishedPayload,
  StepStartedPayload,
  StepFinalizedPayload,
  SubActionRecordedPayload,
  ChipEventPayload,
  AnalysisStartedPayload,
  AnalysisCompletedPayload,
  AnalysisFailedPayload,
  CurationStartedPayload,
  CurationCompletedPayload,
  CurationFailedPayload,
  IssuesStartedPayload,
  IssuesCompletedPayload,
  IssuesFailedPayload,
  // 363 D-01 parity appends: hook lifecycle + retry payloads.
  HookStartedPayload,
  HookFinishedPayload,
  TestRetryScheduledPayload,
} from './bus-events'
// 361 D-10/D-09: pure masked payload projections (schema-in/schema-out).
export {
  maskPayloadStrings,
  projectStepFinalized,
  projectSubActionRecorded,
  projectTestFinished,
  // 363 D-01 parity appends: hook lifecycle + retry projections (masked at the sink).
  projectHookStarted,
  projectHookFinished,
  projectTestRetryScheduled,
} from './bus-projections'
export type { MaskFn } from './bus-projections'
// 402-04 D-10/D-14: handle identity — the TOTAL event-scope classification, the one filter
// predicate, the composite id spelling and the additive runStarted roster reader.
export {
  HANDLE_ID_SEPARATOR,
  RUN_EVENT_SCOPE,
  RUN_EVENT_SCOPE_TYPES,
  handleId,
  handleRosterOf,
  memberIndexOf,
  parseHandleId,
  parseHandleParam,
  passesHandleFilter,
} from './handle-scope'
export type { HandleParamParse, RunEventScope } from './handle-scope'
