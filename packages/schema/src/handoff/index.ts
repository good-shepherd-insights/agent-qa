export { CURRENT_HANDOFF_SCHEMA_VERSION } from './completed-run-handoff'
export type { CompletedRunHandoff } from './completed-run-handoff'
// 361 D-19: the one handoff version guard (reject-newer / migrate-older seam).
export { guardCompletedRunHandoff, HandoffVersionError, HANDOFF_MIGRATIONS } from './load-completed-run-handoff'
export type { PerTestOutcome } from './per-test-outcome'
export type {
  DeclaredModelProfile,
  ModelCallRecord,
  ModelIdentity,
  SamplingParams,
} from './model-call-profile'
export type { PlanningFailureEvidence, ToolExchangeEvidence } from './tool-exchange'
export type {
  CacheMissReason,
  StepEvidence,
  StepPlanSource,
  InterpolatedVariable,
} from './step-evidence'
export type { VerifierVerdict, Decision } from './step-evidence'
export type { SubActionEvidence } from './sub-action-evidence'
export type {
  CycleEvidence,
  LocalEffectEvidence,
  StagnationClass,
  StagnationEvidence,
} from './progress-evidence'
export type {
  AiJudgmentEvidence,
  AssertValueEvidence,
  AssertValueOp,
  ReportedValueEvidence,
  TerminationEvidence,
  VerdictSource,
} from './verb-evidence'
// 2026-10-07 (436-04, D-11..D-13): the per-step limit stop and usage.
export type { CompoundInputCount, LimitStopEvidence, StepLimitUsage } from './limit-evidence'
export { formatLimitStopReason, LIMIT_STOP_EVIDENCE_KEYS, STEP_LIMIT_USAGE_KEYS } from './limit-evidence'
// 2026-10-11 (439-01, D-07, D-10): the per-condition verdict block.
export type {
  CitationSource,
  ConditionCitation,
  ConditionEnding,
  ConditionFileCheck,
  ConditionGuard,
  ConditionNeed,
  ConditionRecord,
  ConditionVerdict,
  ConditionVerdictsEvidence,
  OpenDialogAccount,
} from './condition-evidence'
export {
  CITATION_SOURCES,
  CONDITION_ENDINGS,
  CONDITION_GUARDS,
  CONDITION_NEEDS,
  CONDITION_RECORD_KEYS,
  CONDITION_VERDICTS,
  CONDITION_VERDICTS_EVIDENCE_KEYS,
  stepOutcomeUnproven,
} from './condition-evidence'
// 2026-10-07 (436-10, D-19..D-23): operation-specific evidence on the triggering action.
export type {
  ClipboardEvidence,
  DownloadEvidence,
  OperationCaptureAvailability,
  OperationEvidence,
} from './operation-evidence'
export {
  CLIPBOARD_EVIDENCE_KEYS,
  DOWNLOAD_EVIDENCE_KEYS,
  OPERATION_CAPTURE_AVAILABILITY_KEYS,
} from './operation-evidence'
// 2026-10-08 (437-02, D-05): what an action's input delivered, on the same evidence.
export type {
  FillVerdict,
  InputEvidence,
  InputPath,
  SubmitOutcome,
  SubmitReason,
} from './operation-evidence'
export { INPUT_EVIDENCE_KEYS } from './operation-evidence'
