// The ONE visibility predicate (Phase 396 plan 01, D-05 / MCPS-04).
//
// WHY THIS FILE EXISTS. D-05 states one general law — a tool appears in `tools/list` iff every scope
// it requires is granted to the caller — and the whole value of a LAW rather than a set of rules is
// that it is written down once. MCPS-04's "config absence" test is an instance of it, not a
// carve-out; safe mode is the instance where the only granted scope is `read`. A predicate spelled
// twice is two laws that agree until the day they do not, which is why this module exports exactly
// one function and holds no other logic.
//
// IT GENERALIZES A SEAM THAT ALREADY EXISTS rather than siblinging it. The function registry's
// `list(caller)` filter hides ops whose required scopes exceed a fixed `SAFE_MODE_SCOPES` set of
// `['read']`. Read the two together: that filter is this predicate with `grantedScopes` pinned to
// `['read']`. Chat's listing behaviour is deliberately NOT changed by this phase (open question 2,
// resolved to "one exported predicate, two callers"), so the generalization lives here and the
// registry keeps answering exactly what it answered yesterday.
//
// WHERE THE ANSWER MAY LIVE, per the wire. SEP-2567 removed per-connection list variance, so this
// predicate's per-caller answer is produced by a per-REQUEST server instance built from that
// request's own granted scopes — never by a connection remembering who it is talking to. SEP-2549
// then makes `tools/list` a `CacheableResult` carrying `ttlMs` and `cacheScope`, and the two SEPs
// read together are the hazard: a shared cache could serve one caller's filtered list to another,
// disclosing the presence or absence of tools by scope. The shipped server answers `ttlMs: 0` with
// `cacheScope: 'private'` for exactly that reason (measured 2026-08-16), which is what keeps this
// predicate's output attributable to the caller it was computed for.
//
// COSMETIC, AND THAT IS THE POINT. This predicate decides what a caller can SEE. It decides nothing
// about what a caller can DO: `invokeFunction` re-checks the same subset relation server-side and
// throws `FunctionScopeError` regardless of what any surface listed (D-08's second wall). The two
// walls are independent by construction — different modules, different inputs, separate cells — so
// a mistake here is a cosmetic bug and never an elevation of privilege.

import type { FunctionScope } from '@vostride/agent-qa-schema'

/**
 * True iff every required scope is granted.
 *
 * FOR A FOLD the caller passes the UNION of the required scopes across the fold's arms, because a
 * tool that can reach any of several ops must not be listed to somebody who may only reach some of
 * them: partial visibility would advertise a door that answers refusals. Computing that union is
 * the catalog's job — this function takes a scope set and answers a question about it, and giving
 * it any knowledge of folds would make it the second place the mapping is interpreted.
 *
 * An EMPTY `required` is vacuously visible. That is the correct reading and not an oversight: an op
 * declaring no scopes has said it needs no grant, and inventing a floor here would silently
 * contradict the op's own declaration in a module the op's author never reads.
 *
 * Both arguments are read-only and neither is mutated; the function is pure, total and synchronous,
 * so it can be driven directly by a cell rather than only observed through a server.
 */
export function visibleToCaller(
  requiredScopes: readonly FunctionScope[],
  grantedScopes: readonly FunctionScope[],
): boolean {
  return requiredScopes.every((scope) => grantedScopes.includes(scope))
}
