import type { TrustCredential } from '../safety/trust-credential'
import type { FunctionScope } from './function-scope'

/**
 * The caller record every function invocation carries (Phase 384, FUNC-03).
 *
 * Caller differences are DATA, never control flow: the only legitimate reads of this
 * record are the scope subset check in `invokeFunction`, the safe-mode listing filter
 * in the registry, and audit attribution. A branch on `surface` is an anti-pattern —
 * it re-creates the per-surface private powers the function layer exists to abolish.
 */
export interface FunctionCaller {
  /**
   * Coded originating surface, e.g. 'cli' or 'mcp'. Attribution and diagnostics only;
   * never a permission input.
   */
  surface: string
  /**
   * Capability scopes the composition root MINTED for this caller. Callers never
   * assert their own grants — a surface hands the layer whatever the composition
   * gave it, and enforcement stays server-side in `invokeFunction`.
   *
   * Issuance (who may mint which grants, and how they are proven) is deferred to
   * the M5 cloud-auth model; today every local composition root mints them directly.
   */
  grantedScopes: readonly FunctionScope[]
  /**
   * Cosmetic listing filter (FUNC-03): when true the registry hides ops whose
   * required scopes exceed `read`. Safe mode NEVER enforces — an op hidden from a
   * listing is still refused server-side by the scope subset check if invoked.
   */
  safeMode: boolean
  /**
   * The v48 trust credential presented to the policy gate, passed through untouched.
   * The function layer never inspects or rewrites it; `evaluate()` owns ask-tier
   * resolution against it.
   */
  credential?: TrustCredential
}
