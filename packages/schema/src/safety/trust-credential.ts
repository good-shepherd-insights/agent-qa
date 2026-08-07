/**
 * Browser-safe scope carried by trust credentials and standing approvals.
 */
export interface TrustScope {
  /**
   * Opaque project scope identifier.
   * Format and granularity are deferred to the M5 cloud-auth model.
   */
  project?: string
  /**
   * Opaque organization scope identifier.
   * Format and granularity are deferred to the M5 cloud-auth model.
   */
  org?: string
}

/**
 * The scope's key set, spelled ONCE (388 C13). The structural guard on the committed grant ledger
 * and the strict wire projection of {@link TrustScope} both range this constant, so neither can
 * admit a key the other refuses.
 *
 * RETUNE NOTE: real scope issuance belongs to M5's cloud-auth model. A key added there is added
 * HERE, and the compile-time pin below fails the build until it is.
 */
export const TRUST_SCOPE_KEYS = ['project', 'org'] as const

export type TrustScopeKey = (typeof TRUST_SCOPE_KEYS)[number]

/** True only when the two types are mutually assignable — a real equality, not a subtype check. */
type ExactlyEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

const _trustScopeKeysCoverTheDto: ExactlyEqual<TrustScopeKey, keyof TrustScope> = true
void _trustScopeKeysCoverTheDto

/**
 * Scoped trust credential presented to the policy gate.
 *
 * Token issuance, validation, and signing internals are deferred to the M5
 * cloud-auth model; this DTO models only the credential shape and required scope.
 */
export interface TrustCredential {
  /** Scope the credential is allowed to satisfy. */
  scope: TrustScope
}
