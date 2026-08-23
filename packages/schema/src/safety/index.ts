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
// 391-11 (REVIEW WR-05): the scope key set, spelled ONCE and PUBLISHED — same posture as the
// sibling constant `PROTECTED_ACTION_CLASSES` below, on the identical 388-C13 argument. Keeping it
// package-private is what stopped any out-of-package differential from ranging the key set.
export { TRUST_SCOPE_KEYS } from './trust-credential'
export type { TrustCredential, TrustScope, TrustScopeKey } from './trust-credential'
export type { StandingApprovalGrant } from './standing-approval'
// 391 D-04/D-11: the committed standing-grant ledger's event contract. The DTOs and both guard legs
// live here; knowledge-local owns the bytes and the fold over them.
export {
  CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
  GRANT_LEDGER_EVENT_KINDS,
  GRANT_LEDGER_MIGRATIONS,
  GrantLedgerVersionError,
  STANDING_APPROVAL_SCOPE,
  guardGrantLedgerEvent,
  hasGrantEventShape,
  isGrantLedgerEventKind,
} from './grant-ledger'
export type {
  ActiveStandingGrant,
  GrantLedgerEvent,
  GrantLedgerEventKind,
  GrantRecordedEvent,
  GrantRevokedEvent,
} from './grant-ledger'
// 391 D-05/D-07: the closed grant-ineligible action-class set, exported ONCE. Both the mint side
// and the read side consult THIS value; nothing sources it from config.
export { PROTECTED_ACTION_CLASSES, isProtectedActionClass } from './protected-classes'
export type { ProtectedActionClass } from './protected-classes'
// 391 D-03/D-05: the grant verbs' IO contracts, the wire projections of the fold's DTO and the
// trust scope, and the ONE port both `agent` (which declares against it) and `knowledge-local`
// (which implements it) consume. There is no `record` OP — only the accept escalation reaches it.
export {
  GrantRecordInputSchema,
  GrantRecordOutcomeSchema,
  GrantsListInputSchema,
  GrantsListOutputSchema,
  GrantsRevokeInputSchema,
  GrantsRevokeOutputSchema,
  StandingGrantSchema,
  TrustScopeSchema,
} from './grant-ops'
export type {
  GrantRecordInput,
  GrantRecordOutcome,
  GrantsListInput,
  GrantsListOutput,
  GrantsRevokeInput,
  GrantsRevokeOutput,
  StandingGrantDto,
  StandingGrantsPort,
} from './grant-ops'
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
