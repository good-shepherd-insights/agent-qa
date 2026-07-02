import type {
  RiskActionDescriptor,
  StandingApprovalGrant,
  TrustScope,
} from '@vostride/agent-qa-schema'

type TrustScopeKey = keyof TrustScope

const SCOPE_KEYS = ['org', 'project'] as const satisfies readonly TrustScopeKey[]

function populatedKeys(scope: TrustScope): TrustScopeKey[] {
  return SCOPE_KEYS.filter((key) => scope[key] !== undefined && scope[key] !== '')
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
