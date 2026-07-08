export { createProviderRequestMiddleware } from './egress/provider-request-middleware'
export {
  assertCommittedEgressSafe,
  CommittedEgressBlockedError,
} from './guardrail/committed-egress'
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
export { createMaskingProviderRequestHook } from './masking/egress-hook'
export { getActiveMaskingContext, setActiveMaskingContextResolver } from './masking/resolver'
export { getActiveAuditSink, setActiveAuditSinkResolver } from './policy/audit-sink-resolver'
export { unmaskForHumanOutput } from './masking/human-output'
export { classifyRisk } from './policy/risk-classifier'
export { evaluate } from './policy/gate'
export {
  getActiveExecutionContext,
  requiresFailClosed,
  resolveExecutionContext,
  setActiveExecutionContextResolver,
} from './policy/execution-context'
export { NO_STANDING_APPROVALS, DENY_CONFIRM } from './ports/policy-ports'
export { seedMaskingContext } from './masking/seed'
export type {
  BlockedDetection,
  CommittedEgressOptions,
  CommittedEgressPart,
} from './guardrail/committed-egress'
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
} from './policy/gate'
export type { AuditSink, ExecutionAuditRow, GuardrailAuditRow } from './ports/audit-sink'
export type { StandingApprovalReader, ConfirmPort } from './ports/policy-ports'
