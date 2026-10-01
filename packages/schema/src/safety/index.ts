export type { RiskTier, PolicyVerdict, ExecutionPolicyResult } from './risk-tier'
// 400 D-15: the closed, surface-aware remedy vocabulary that rides beside a decision's prose
// reason. Published from here because four packages read it (safety mints, cli/agent/dashboard
// render) — the same reasoning that seated `session-events` in this package.
export { GATE_REMEDY_KINDS, GATE_REMEDY_SURFACES, GATE_REMEDY_SURFACES_BY_KIND, remediesRenderableBy } from './remedies'
export type { GateRemedy, GateRemedyKind, GateRemedySurface, RemedyKindFor } from './remedies'
export type { RiskActionDescriptor } from './action-descriptor'
// 401-15 (WR-01): the `disclosure` field's ENFORCEMENT, published from the module that states its
// law so a composition filling the field cannot find the rule without finding the scrub.
export {
  DISCLOSURE_FRAGMENT_MAX_LENGTH,
  DISCLOSURE_REPLACEMENT_CHARACTER,
  DISCLOSURE_TEXT_MAX_LENGTH,
  DISCLOSURE_TRUNCATION_MARK,
  scrubDisclosureFragment,
  scrubDisclosureText,
} from './action-descriptor'
// 391-11 (REVIEW WR-05): the scope key set, spelled ONCE and PUBLISHED, so an out-of-package
// differential can range it.
// 432-18: `STANDING_APPROVAL_SCOPE` moved beside it when the grant ledger was deleted; it is the scope
// the MCP bearer credential carries.
export { STANDING_APPROVAL_SCOPE, TRUST_SCOPE_KEYS } from './trust-credential'
export type { TrustCredential, TrustScope, TrustScopeKey } from './trust-credential'
export type { StandingApprovalGrant } from './standing-approval'
// 432-18 (D-14/D-15): the grant ledger, the protected-class set and the grant op contracts are
// deleted. The trust-scope projection stays for `config/run-service.ts` until 432-22.
export { TrustScopeSchema } from './grant-ops'
export type { ScanAction, ScanResult } from './scan'
export type { ContentOrigin } from './content-origin'
export type { MaskingContext } from './masking'
export { guardrailPolicySchema } from './guardrail-policy'
export type { GuardrailPolicy, GuardrailDetectorFamily } from './guardrail-policy'
export type {
  ToolCallHookAllowResult,
  ToolCallHookMutateResult,
  ToolCallHookDenyResult,
  ToolCallHookResult,
  ToolResultHookResult,
  ContextHookResult,
} from './hook-results'
