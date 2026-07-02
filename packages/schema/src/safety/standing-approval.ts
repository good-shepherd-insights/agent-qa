import type { TrustScope } from './trust-credential'

/**
 * Standing approval for a class of action within a concrete scope.
 *
 * A grant is keyed by action identity plus scope, not by risk tier; granting a
 * tier such as "all destructive" would be over-broad.
 */
export interface StandingApprovalGrant {
  /** Scope where the action class is pre-approved. */
  scope: TrustScope
  /** Action name or class covered by the standing approval. */
  actionClass: string
}
