export { createProviderRequestMiddleware } from './egress/provider-request-middleware'
export {
  assertCommittedEgressSafe,
  CommittedEgressBlockedError,
} from './guardrail/committed-egress'
export {
  CONSTRUCTION_SCAN_DETECTORS,
  CONSTRUCTION_SCAN_EXCLUDED_DETECTORS,
  SEEDED_SECRET_DETECTOR,
  scanConstructedArtifact,
} from './guardrail/construction-scan'
// The detector PRIMITIVE, public (395-20 · F-03). `findDetectorMatches` is a pure
// text-in/matches-out function: it grants no registration capability, holds no state and reads no
// policy, so it is outside D-03's non-export rule (which is about registration capability leaving
// the public surface). It is exported because a caller outside this package needs the SAME shape
// vocabulary the guardrail uses — `config show`/`config set` recognising a credential by shape
// rather than by key name — and re-deriving those regexes in the cli would be a second answer to
// "what does a credential look like", which is precisely the drift this phase keeps paying for.
export { findDetectorMatches } from './guardrail/detectors'
export { createGuardrailProviderRequestHook, GuardrailBlockError } from './guardrail/egress-hook'
export {
  defaultGuardrailPolicyInput,
  GuardrailConfigError,
  loadGuardrailPolicy,
} from './guardrail/policy-loader'
export { scan } from './guardrail/scan'
export { createGuardrailStreamScan } from './guardrail/stream-scan'
// Raw registry construction (HookRegistry class + createHookRegistry factory) is
// intentionally NOT re-exported (D-03): registration capability leaves the public
// surface so registerFirstPartySafetyHooks is the only public registration path.
// Hook TYPE exports below grant no registration capability and stay public.
export { registerFirstPartySafetyHooks } from './hooks/first-party'
export { FirstPartyHookError } from './hooks/capability'
export { createMaskingContext } from './masking/context'
export { detectEmails } from './masking/detectors'
export { createMaskingProviderRequestHook } from './masking/egress-hook'
export { getActiveMaskingContext, setActiveMaskingContextResolver } from './masking/resolver'
export { getActiveAuditSink, setActiveAuditSinkResolver } from './policy/audit-sink-resolver'
export { unmaskForHumanOutput } from './masking/human-output'
export { classifyRisk, TIER_ORDER } from './policy/risk-classifier'
export { evaluate } from './policy/gate'
export {
  getActiveExecutionContext,
  requiresFailClosed,
  resolveExecutionContext,
  setActiveExecutionContextResolver,
} from './policy/execution-context'
export { NO_STANDING_APPROVALS, DENY_CONFIRM } from './ports/policy-ports'
export { seedMaskingContext } from './masking/seed'
export {
  APP_OBSERVED_DATA_CLOSE,
  APP_OBSERVED_DATA_OPEN,
  wrapAppObservedData,
} from './serving/data-delimiters'
export type {
  BlockedDetection,
  CommittedEgressOptions,
  CommittedEgressPart,
} from './guardrail/committed-egress'
export type {
  ConstructionScanDetector,
  ConstructionScanFinding,
  ConstructionScanPart,
  ConstructionScanReport,
} from './guardrail/construction-scan'
export type {
  AsyncToolCallHook,
  ContextHook,
  HookRegistryOptions,
  ProviderRequestHook,
  ProviderRequestParams,
  SafetyHookRunner,
  ToolCallHook,
  ToolResultHook,
} from './hooks/interfaces'
export type { FirstPartySafetyDeps, FirstPartySafetyHooks } from './hooks/first-party'
export type { PolicyGateHookDeps } from './policy/gate-hook'
export type { MaskCategory } from './masking/categories'
// 405-02 (D-08): the row `snapshotRegistered()` reports. Type-only — the enumeration exists for
// the run-scoped digest sidecar writer, which turns each value into a keyed HMAC and never
// persists the value itself.
export type { RegisteredMaskingEntry } from './masking/context'
export type { MaskingContextResolver } from './masking/resolver'
export type { AuditSinkResolver } from './policy/audit-sink-resolver'
export type { MaskingSeedSources } from './masking/seed'
export type {
  ExecutionContextResolver,
  ExecutionContextSignals,
} from './policy/execution-context'
export type {
  GateDeps,
  GateTrust,
  ExecutionPolicyOutcome,
  ExecutionPolicyTrustSource,
  // 392 D-21: published on the same footing as `ConfirmPort` below — a composition root that can
  // hand the gate a session deny overlay but cannot NAME its type would spell the signature again
  // locally, and a second spelling of a tighten-only contract is a place for a widening one to
  // appear. Nothing here is a gate call-site: this is a type.
  SessionDenyOverlay,
} from './policy/gate'
export type { AuditSink, ExecutionAuditRow, GuardrailAuditRow } from './ports/audit-sink'
export type {
  StandingApprovalReader,
  ConfirmPort,
  ConfirmAsk,
  // G-401-17: published beside `ConfirmPort` for the reason `SessionDenyOverlay` is published
  // above — a composition root that must DECLARE which surface it speaks for and cannot name the
  // vocabulary would spell the literal locally, and a second spelling of an audit vocabulary is
  // where a value that can be declared but not recorded comes from.
  ConfirmAnsweringSurface,
} from './ports/policy-ports'
