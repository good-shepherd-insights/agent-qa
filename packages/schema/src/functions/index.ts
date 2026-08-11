export { FunctionScopeSchema } from './function-scope'
export type { FunctionScope } from './function-scope'
// 391 D-06: the actor-origin axis. The vocabulary is a VALUE so a composition root can iterate
// it and a test can pin its closure; the caller record's `origin` field is required.
export { FUNCTION_CALLER_ORIGINS } from './function-caller'
export type { FunctionCaller, FunctionCallerOrigin } from './function-caller'
export {
  RUN_SUMMARY_SCHEMA_VERSION,
  RUN_DETAIL_SCHEMA_VERSION,
  RunSummarySchema,
  RunDetailSchema,
  RunTestDetailSchema,
  RunsListInputSchema,
  RunsGetInputSchema,
  RunsStartInputSchema,
  RunsEventsInputSchema,
  // 388 D-14: the chip-truth read op's two contracts, and the notification's wire shape.
  RunsPostProcessingInputSchema,
  RunNotificationSchema,
  PostProcessingStatusSchema,
  RUN_START_ACKNOWLEDGEMENT_SCHEMA_VERSION,
  RunStartAcknowledgementSchema,
  RUN_EVENT_ENVELOPE_SCHEMA_VERSION,
  RunEventEnvelopeSchema,
} from './runs'
export type {
  RunSummary,
  RunDetail,
  RunTestDetail,
  RunsListInput,
  RunsGetInput,
  RunsStartInput,
  RunsEventsInput,
  RunsPostProcessingInput,
  RunStartAcknowledgement,
} from './runs'
// 389 D-11: the analysis.get op's contracts — verdicts + sentences + clusters, one producer.
export {
  AnalysisGetInputSchema,
  AnalysisGetOutputSchema,
  AnalysisResolvedVerdictSchema,
  AnalysisSentenceSchema,
  AnalysisClusterViewSchema,
} from './analysis-get'
export type {
  AnalysisGetInput,
  AnalysisGetOutput,
  AnalysisResolvedVerdict,
  AnalysisSentence,
  AnalysisClusterMemberRef,
  AnalysisClusterView,
} from './analysis-get'
export {
  KNOWLEDGE_BUNDLE_SUMMARY_SCHEMA_VERSION,
  KnowledgeBundleSummarySchema,
  KnowledgeBundlesListInputSchema,
} from './knowledge'
export type {
  KnowledgeBundleSummary,
  KnowledgeBundlesListInput,
} from './knowledge'
export {
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  CONFIG_MASK_PLACEHOLDER,
  MaskedConfigEntrySchema,
  MaskedResolvedConfigSchema,
  ConfigGetInputSchema,
} from './config'
export type {
  ConfigValueSource,
  MaskedConfigEntry,
  MaskedResolvedConfig,
  ConfigGetInput,
} from './config'
// 393 D-01: the `authoring.draft.verify` op's contracts (D-01 sketches the verb as
// `verify_draft`; that spelling is unrepresentable — see ./authoring.ts). The output IS the receipt
// (D-19) rather than a summary of it, so the schema is re-exported here under an op-shaped
// name instead of being re-declared.
export {
  AuthoringVerifyDraftInputSchema,
  AuthoringVerifyDraftOutputSchema,
} from './authoring'
export type {
  AuthoringVerifyDraftInput,
  AuthoringVerifyDraftOutput,
} from './authoring'
// 394 D-01: `authoring.draft.write`'s contracts and the closed loop-outcome vocabulary. The
// vocabulary is declared WHOLE here in the tracer so plans 04-06 add a branch behind a
// discriminant every consumer already reads, never a member to the shape.
export {
  AUTHORING_DEDUP_CONTINUATIONS,
  AUTHORING_LOOP_OUTCOMES,
  AuthoringDedupRefusalSchema,
  AuthoringDraftWriteInputSchema,
  AuthoringDraftWriteOutputSchema,
} from './authoring'
export type {
  AuthoringDedupContinuation,
  AuthoringDedupRefusal,
  AuthoringDraftWriteInput,
  AuthoringDraftWriteOutput,
  AuthoringLoopOutcomeKind,
} from './authoring'
