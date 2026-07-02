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
 * Scoped trust credential presented to the policy gate.
 *
 * Token issuance, validation, and signing internals are deferred to the M5
 * cloud-auth model; this DTO models only the credential shape and required scope.
 */
export interface TrustCredential {
  /** Scope the credential is allowed to satisfy. */
  scope: TrustScope
}
