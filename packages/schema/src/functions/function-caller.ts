import type { TrustCredential } from '../safety/trust-credential'
import type { FunctionScope } from './function-scope'

/**
 * WHO is acting, as opposed to WHERE from (391 D-06). Closed, and spelled once (388 C13).
 *
 * `human` is a person taking an action directly; `agent` is a model-driven call, whether it
 * arrives over chat, MCP, or a background job the daemon started. The axis is deliberately NOT
 * {@link FunctionCaller.surface}: `cli` is a surface a human uses interactively AND the process a
 * scheduled job runs in, so a surface name cannot answer "did a person decide this". It is also
 * distinct from schema's TEST `Surface` (`web | mobile | android | ios | common`), which is about
 * what is under test rather than who is asking.
 *
 * There is no `unknown` member, and the absence is the fail-closed half of the design: a third
 * value would need a rule, every safe rule for it is "treat it as agent", and a vocabulary with a
 * member that always means another member is a vocabulary with two spellings for one thing.
 */
export const FUNCTION_CALLER_ORIGINS = ['human', 'agent'] as const

export type FunctionCallerOrigin = (typeof FUNCTION_CALLER_ORIGINS)[number]

/**
 * The caller record every function invocation carries (Phase 384, FUNC-03).
 *
 * Caller differences are DATA, never control flow: the only legitimate reads of this
 * record are the scope subset check in `invokeFunction`, the origin check beside it,
 * the safe-mode listing filter in the registry, audit attribution, and the
 * session-overlay scoping at the gate (392 plan 13 — see {@link FunctionCaller.sessionId}).
 * A branch on `surface` is an anti-pattern — it re-creates the per-surface private
 * powers the function layer exists to abolish.
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
   * WHO this call is on behalf of, MINTED by the composition root (391 D-06).
   *
   * The same rule the scopes above are under, for the same reason: callers never assert
   * their own grants, and an origin a caller could choose is an origin every caller
   * chooses `human`. A surface hands the layer whatever the composition gave it; the CLI
   * mints `human` because a person typed the command, the daemon mints `agent` because
   * nobody did.
   *
   * REQUIRED, and that is the fail-closed decision rather than a style choice. An optional
   * field needs a default, and every default is wrong in one direction: defaulting to
   * `agent` would refuse real people at ops nobody had got round to minting an origin for,
   * and defaulting to `human` would hand an unaudited mint the exact power the self-grant
   * rule exists to withhold. Required means a new composition root cannot acquire that
   * power by omission — it has to say which it is, in a diff someone reads.
   */
  origin: FunctionCallerOrigin
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
  /**
   * The chat session this call belongs to, MINTED by the composition root (392 plan 13, W-03).
   *
   * ONE LEGITIMATE READ, and the doc above names it: scoping the session DENY overlay at the
   * gate, so a `/pin` typed in one conversation denies that action class for that conversation
   * and for no other. Without it the overlay is one set per composition and a pin outlives the
   * session that typed it — on a daemon, for every caller until the process restarts.
   *
   * TIGHTEN-ONLY, WHICH IS WHY IT MAY BE OPTIONAL WHERE `origin` MAY NOT. The overlay this
   * scopes is deny-only by three independent constructions (no unpin, a DTO with no allow list,
   * a hook whose only true branch writes a deny), so an ABSENT or FOREIGN id can produce fewer
   * chat-pin denials and never a grant. It satisfies no scope check, no origin check and no
   * standing approval, and nothing below the overlay reads it. That asymmetry is the whole
   * reason a defaulted value is safe here and would be a self-grant on `origin`.
   *
   * Attribution and scoping only; never an identity claim. A caller naming a session it does
   * not own gains nothing it did not already have — at most it inherits that session's denials.
   */
  sessionId?: string
}
