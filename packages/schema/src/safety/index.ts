// 2026-10-01 (432-19, D-15/D-16): the risk tier stays for eval's side-effect scoring. The
// execution-policy verdict and result, the remedy vocabulary and the standing-approval contract are
// deleted with the gate.
export type { RiskTier } from './risk-tier'
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
// 432-18 moved `STANDING_APPROVAL_SCOPE` beside it; 432-21 (D-12) deleted it with the MCP bearer
// credential that carried it.
export { TRUST_SCOPE_KEYS } from './trust-credential'
export type { TrustCredential, TrustScope, TrustScopeKey } from './trust-credential'
// 432-18 (D-14/D-15): the grant ledger, the protected-class set and the grant op contracts are
// deleted. 432-22 (D-12): the trust-scope wire projection (`grant-ops.ts`) is deleted with the
// run-service token DTO, its last consumer.
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
