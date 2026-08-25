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
 * The scope's key set, spelled ONCE (388 C13).
 *
 * RETUNE NOTE: real scope issuance belongs to M5's cloud-auth model. A key added to {@link
 * TrustScope} above is added HERE, and the key-union pin below fails the build until it is — in
 * BOTH directions, so a key added here and not to the DTO fails too. The wire projection needs no
 * edit at all: `TrustScopeSchema` BUILDS its shape from this constant (391-11), rather than
 * restating the key set as a second literal that a compile-time pin over an all-optional object
 * type could not actually hold to. What that pin covers, stated negatively: it holds this constant
 * against the DTO declared above it and says nothing about any other file.
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
 * 2026-08-25 (Phase 403, D-01/D-03): PART OF THIS FAMILY NOW HAS A REAL ISSUER IN THIS
 * REPOSITORY, and the previous wording on this DTO — which deferred issuance, validation and the
 * signing internals wholesale to M5 — had started to read as though nothing here mints one. (The
 * two remarks on {@link TrustScope} above are a DIFFERENT and still-accurate claim: the format and
 * granularity of a project or org scope identifier are genuinely unsettled, and 403 did not touch
 * them.) The view-scoped `liveUrl` capability is minted and
 * parsed by exactly one module pair — `packages/agent/src/functions/live-url.ts`, reached only
 * through the `runs.liveurl` op — over a per-process ephemeral HMAC key that lives in
 * `packages/cli/src/composition/live-url-signer.ts` and in no other file. The resulting token is
 * short-lived, single-run, single-handle and `view`-scoped; a tamper, an expiry, a foreign run and
 * a wrong scope are each refused by name rather than by silence.
 *
 * WHAT STAYS DEFERRED, precisely, so the next reader does not have to re-derive it: the KEY
 * SOURCE (403 open Q5 — an ephemeral per-process key cannot survive a restart or be shared with a
 * second host, which is the cloud-auth model's job) and the `control` scope, which would let a
 * holder act on a run rather than watch one. Both are absent on purpose, not pending.
 *
 * This DTO still models only the credential SHAPE and its required scope. It is deliberately not
 * the liveUrl claims type: those live beside their own mint/validate pair, because a claims type
 * shared with the gate would be a second opinion about what a valid token is.
 */
export interface TrustCredential {
  /** Scope the credential is allowed to satisfy. */
  scope: TrustScope
}
