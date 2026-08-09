import { TRUST_SCOPE_KEYS } from '@vostride/agent-qa-schema'
import type {
  RiskActionDescriptor,
  StandingApprovalGrant,
  TrustScope,
  TrustScopeKey,
} from '@vostride/agent-qa-schema'

// This file does not spell the scope key set; it ranges the published constant. The declared order
// is project-then-org, which is behaviour-neutral here: the result feeds a length comparison and an
// `every`/`includes` pair, both order-independent. What `policy/__tests__/scope.test.ts` actually
// pins, measured rather than assumed: it reds only when this leg ranges a PROPER SUBSET of the
// published key set. Replacing the import with a byte-identical literal spelling of the FULL set
// stays green — the pin is on membership coverage, not on the import itself.
function populatedKeys(scope: TrustScope): TrustScopeKey[] {
  return TRUST_SCOPE_KEYS.filter((key) => scope[key] !== undefined && scope[key] !== '')
}

export function scopeMatches(credentialScope: TrustScope, actionScope: TrustScope): boolean {
  const credentialKeys = populatedKeys(credentialScope)
  const actionKeys = populatedKeys(actionScope)

  if (credentialKeys.length === 0 || actionKeys.length === 0) return false
  if (credentialKeys.length !== actionKeys.length) return false

  // Conservative exact-scope stance: org-only credentials do not cover projects.
  return credentialKeys.every((key) => actionKeys.includes(key) && credentialScope[key] === actionScope[key])
}

export function grantCovers(
  grant: StandingApprovalGrant,
  action: RiskActionDescriptor,
  actionScope: TrustScope,
): boolean {
  return grant.actionClass === action.name && scopeMatches(grant.scope, actionScope)
}
