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
// 403 D-05/D-08: live-view frame vocabulary — frames as data, capability declared per handle.
export { LIVE_FRAME_END_REASONS, LIVE_STREAM_KINDS, LiveStreamDeclarationSchema } from './live-stream'
// 403 D-01..D-04: the liveUrl capability-token vocabulary (types + refusal names only).
export { LIVE_URL_REFUSAL_REASONS, LIVE_URL_SCOPE } from './live-url'
export type { LiveUrlClaims, LiveUrlRefusalReason, LiveUrlSigner, LiveUrlVerdict } from './live-url'
export type {
  LiveFrame,
  LiveFrameEndReason,
  LiveFrameMetadata,
  LiveFrameSubscription,
  LiveStreamDeclaration,
  LiveStreamKind,
} from './live-stream'
// Bus schema v1 (D-05): envelope, event union + vocabulary, payload projections.
export { CURRENT_BUS_SCHEMA_VERSION, RUN_EVENT_TYPES } from './bus-events'
export type {
  RunEvent,
  RunEventEnvelope,
  RunEventPayload,
  RunEventType,
  RunStartedPayload,
  RunFinishedPayload,
  // 404-01 (D-09): the post-processing posture union `runFinished.disposition` carries.
  PostProcessingDisposition,
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
// 405-06 D-10: the masked-marker vocabulary — ONE spelling shared by the dashboard host's display
// seam (405-10) and the dashboard-ui chip parser (405-11), so the two cannot drift.
export { MASKED_MARKER_DELIMITER, MASKED_MARKER_PATTERN, PLACEHOLDER_PATTERN, maskedMarker } from './masked-marker'
export type { MaskedCategory } from './masked-marker'
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
