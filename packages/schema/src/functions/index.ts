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
// 394-07 D-12/D-13: `authoring.funnel.get`'s contracts. The output IS the funnel the ONE
// computation produces (see ../authoring/funnel.ts) rather than a re-shaping of it, so the
// schema is re-exported under an op-shaped name instead of being re-declared. The window is a
// SCOPE — which invocations the projection is over — not a filter over rows already in hand.
export {
  AuthoringFunnelGetInputSchema,
  AuthoringFunnelGetOutputSchema,
  AuthoringFunnelWindowSchema,
} from './authoring'
export type {
  AuthoringFunnelGetInput,
  AuthoringFunnelGetOutput,
  AuthoringFunnelWindow,
} from './authoring'
// 394-09 D-21: `authoring.draft.edit`'s contracts. The op proposes and nothing more — plan 10's
// one-commit apply is what turns an accepted proposal into a repository change — so the output
// carries the staged draft, what it was edited FROM, and the RFC-6902 ops that produced it.
export {
  AuthoringDraftEditInputSchema,
  AuthoringDraftEditOutputSchema,
} from './authoring'
export type {
  AuthoringDraftEditInput,
  AuthoringDraftEditOutput,
} from './authoring'
// 396-04 (D-16): `runs.list`'s output contract, named rather than composed inline in the op, so a
// surface can advertise the same object `invokeFunction` validates with.
export { RunsListOutputSchema } from './runs'
export type { RunsListOutput } from './runs'
// 396-04 (D-01 · MCPS-02): the three declared fold contracts the MCP catalogue advertises. Minted
// here because they are composed with zod and `packages/mcp` may not name a validator library
// (D-20); see the module header for why a JSON-Schema-level composition cannot work at all.
export {
  TOOL_FOLD_DISCRIMINANT,
  AuthoringRefineFoldInputSchema,
  AuthoringRefineFoldOutputSchema,
  ConfigChangeFoldInputSchema,
  ConfigChangeFoldOutputSchema,
  KnowledgeChangeFoldInputSchema,
  KnowledgeChangeFoldOutputSchema,
} from './tool-folds'
export type {
  AuthoringRefineFoldInput,
  ConfigChangeFoldInput,
  KnowledgeChangeFoldInput,
} from './tool-folds'
// 402-01 (D-06/D-13/D-15 · INVK-03): the authed run service's wire vocabulary — the two-arm
// header verdict, the one error body every refusal answers with, the request shape, the readiness
// DTO, and the door's own contract version. The EVENT vocabulary is deliberately absent: the SSE
// stream serves `RunEventEnvelopeSchema` verbatim (D-13).
export {
  RUN_SERVICE_CONTRACT_VERSION,
  RUN_SERVICE_ERROR_CODES,
  RUN_SERVICE_REFUSED_REQUEST_FIELDS,
  RunServiceDenialBodySchema,
  RunServiceErrorBodySchema,
  RunServiceReadinessSchema,
  RunServiceStartRequestSchema,
  SERVICE_BEARER_REFUSAL_REASONS,
} from './run-service'
export type {
  RunServiceDenialBody,
  RunServiceErrorBody,
  RunServiceErrorCode,
  RunServiceReadiness,
  RunServiceStartRequest,
  ServiceBearerRefusalReason,
  ServiceBearerVerdict,
} from './run-service'
