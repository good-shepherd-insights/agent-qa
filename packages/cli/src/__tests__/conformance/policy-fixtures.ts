// The policy fixtures the verdict legs are driven with (Phase 397 plan 03, D-11).
//
// WHAT THIS FILE OWNS. Three things, and none of them is an expectation: the CALLERS each policy
// point is exercised under, the execution context those points are decided in, and the set of ops
// whose risk class can reach an `ask` at all. 397-04 owns the verdict comparisons themselves; the
// scenario table owns which points each row declares. Splitting it that way is what keeps the
// fixtures from quietly encoding the answer they are supposed to be measuring.
//
// EVERY CALLER IS DERIVED FROM THE OP'S OWN DECLARATION. `coveringCallerFor` reads
// `declaration.requiredScopes`; `refusingCallerFor` withholds one of them, by name, and says which.
// Neither spells a scope. A fixture that listed scopes per op would be a second copy of the
// declaration's scope list — one that falls behind the day a scope is widened, and then passes
// forever on the smaller world, which is the exact failure 387-08 measured.
//
// THE EXECUTION CONTEXT IS INJECTED AND NEVER READ FROM THE AMBIENT PROCESS (Pitfall 3). The shipped
// resolver answers `ci` whenever CI markers are present, so anything computed against the ambient
// context would be one answer on a laptop and another on a PR. Nothing here calls
// `getActiveExecutionContext`, reads `process.env`, or consults a TTY; the context is a constant this
// file exports and every consumer passes explicitly.
//
// THE FORMERLY-ASKING SET IS PRODUCED BY THE SHIPPED CLASSIFIER, NEVER HAND-PICKED (D-11).
//
// SINCE 432-13 (D-14/D-15) the function door asks nobody and dispatches these directly; the scenario
// rows carry them as the `direct` policy point. 2026-10-01 (432-19, D-15): the gate (`evaluate`), its
// ask ladder and its confirm port are deleted, so the set can no longer be OBSERVED by watching a
// confirm port get consulted. It is derived from what is left: `classifyRisk`'s tier, and the two
// tiers the deleted ladder used to ask about (`mutating-shared`, `destructive`). `restricted` was
// never an ask (it was blocked) and stays out. The pinned constant is still the recorded output, and
// `parity.test.ts` still asserts the two are equal, so classifier drift reds by op id.

import type { FunctionDeclaration } from '@vostride/agent-qa-agent'
import { CHAT_RESOLVER_CALLER } from '@vostride/agent-qa-agent-local'
import { classifyRisk } from '@vostride/agent-qa-safety'
import type { ExecutionContext, FunctionCaller, FunctionScope } from '@vostride/agent-qa-schema'
import type { RiskActionDescriptor } from '@vostride/agent-qa-schema'

import { mcpFunctionCaller } from '../../commands/mcp.js'

/**
 * The one execution context every conformance policy decision is taken in.
 *
 * `local-interactive`, fixed. Since 432-19 no decision depends on the context (there is no
 * fail-closed context any more); it is still injected so the surface-dispatch fixtures never read
 * the ambient one.
 */
export const CONFORMANCE_EXECUTION_CONTEXT: ExecutionContext = 'local-interactive'

/** The injected resolver form, for the seams that take a resolver rather than a value. */
export const conformanceResolveExecutionContext = (): ExecutionContext =>
  CONFORMANCE_EXECUTION_CONTEXT

/** A caller record in the suite's own surface, so an audit row can never be mistaken for a host's. */
function conformanceCaller(grantedScopes: readonly FunctionScope[]): FunctionCaller {
  return Object.freeze({
    surface: 'conformance',
    grantedScopes: [...grantedScopes],
    safeMode: false,
    // `human`, deliberately. Two ops declare `requiresHumanOrigin` and an agent-origin caller is
    // refused BEFORE the scope check — so a covering caller minted as an agent would produce a
    // refusal on the wrong axis while looking like it had measured the grant point.
    origin: 'human',
  })
}

/**
 * The GRANT point's caller: exactly the scopes this op declares it needs, and nothing else.
 *
 * Exactly, not the full union: a caller holding every scope would pass the grant point for an op
 * whose `requiredScopes` had silently emptied, and "this op needs nothing" is a claim the suite
 * should be able to notice rather than to satisfy.
 */
export function coveringCallerFor(declaration: FunctionDeclaration): FunctionCaller {
  return conformanceCaller(declaration.requiredScopes)
}

/** The refusing caller, and the grant that was deliberately withheld to make it refuse. */
export interface RefusingCallerFixture {
  readonly caller: FunctionCaller
  readonly withheldScope: FunctionScope
}

/**
 * The REFUSE point's caller: the covering grant minus one scope, named.
 *
 * The withheld scope is RETURNED rather than merely omitted, because the refusal a leg asserts has
 * to be attributable — "refused" is a fact about a caller and an op together, and a leg that could
 * not say which grant was missing would report the same green whether the refusal came from the
 * scope wall, the origin wall or an input error.
 *
 * The scopes are sorted before the first is dropped, so which one is withheld is a function of the
 * declaration and not of the order a spec happened to list them in — a reordering must not silently
 * change what this suite measures.
 */
export function refusingCallerFor(declaration: FunctionDeclaration): RefusingCallerFixture {
  const ordered = [...declaration.requiredScopes].sort()
  const withheldScope = ordered[0]
  if (withheldScope === undefined) {
    throw new Error(
      `${declaration.id}: declares no required scope, so no caller can be made to lack one — `
        + 'the refuse point is unstateable for this op and that is a defect in the declaration',
    )
  }
  return {
    caller: conformanceCaller(ordered.slice(1)),
    withheldScope,
  }
}

// ---- The two surfaces' own caller mints (397-04, legs 3 and 4) ---------------------------------

/**
 * One capability's caller, as each rostered surface would mint it for the same grant.
 *
 * BOTH SIDES ARE PRODUCED BY THE SURFACE THAT OWNS THEM, and that is the whole point of this type
 * existing rather than a `surface` argument on one builder. `CHAT_RESOLVER_CALLER` is the frozen
 * record `composeLocalAgent` spreads at its own `mint.forStage`; `mcpFunctionCaller` is the function
 * `commands/mcp.ts` composes its server with. A parity assertion whose two comparands came out of
 * ONE builder with a different string is a value compared to itself: it passes whatever the product
 * does, which is precisely the vacuity 397-02 measured and handed forward.
 */
export interface SurfaceShapedCallers {
  readonly chat: FunctionCaller
  readonly mcp: FunctionCaller
}

/**
 * The two surfaces' callers for one grant, each minted the way its own surface mints.
 *
 * They differ in TWO fields, and both differences are real product facts rather than fixture noise:
 * `surface` (attribution, which nothing in the function layer may branch on — FUNC-03) and `origin`
 * (`human` for the deterministic chat route, `agent` for MCP — 391 D-06, the self-grant rule). The
 * origin difference is DATA the gate is entitled to answer differently on, so a cell that asserted
 * these two must always agree would be asserting the product wrong. See
 * {@link surfaceInertCallers} for the comparison that isolates `surface`.
 */
export function surfaceShapedCallers(
  grantedScopes: readonly FunctionScope[],
): SurfaceShapedCallers {
  return {
    chat: Object.freeze({ ...CHAT_RESOLVER_CALLER, grantedScopes: [...grantedScopes] }),
    mcp: Object.freeze(mcpFunctionCaller([...grantedScopes])),
  }
}

/**
 * The same two callers with every field but `surface` harmonised.
 *
 * THIS IS FUNC-03's CLAIM, stated so it can be measured: a caller is DATA, and `surface` is
 * attribution only. Two records that agree on grants, origin and safe mode and disagree only on
 * which surface minted them must produce the same verdict for every capability — `if
 * (caller.surface === 'chat')` is the anti-pattern `invoke.ts` names at its head, and this is the
 * cell that would red on it.
 *
 * The harmonised origin is the CHAT mint's, taken off the shipped record rather than written here,
 * because it is the one under which every capability is reachable: three ops declare
 * `requiresHumanOrigin` and would refuse an agent-origin caller BEFORE the gate, which would leave
 * the surface question unasked on exactly the capabilities that most need it answered.
 */
export function surfaceInertCallers(
  grantedScopes: readonly FunctionScope[],
): SurfaceShapedCallers {
  const shaped = surfaceShapedCallers(grantedScopes)
  return {
    chat: shaped.chat,
    mcp: Object.freeze({ ...shaped.mcp, origin: shaped.chat.origin, safeMode: shaped.chat.safeMode }),
  }
}

/** The minimum an op needs to be classified: its id and the risk descriptor it declares. */
export interface RiskClassifiable {
  readonly id: string
  readonly risk: RiskActionDescriptor
}

/** The two tiers the deleted ask ladder resolved through a confirm (`baseVerdict` → `ask`). */
const FORMERLY_ASKING_TIERS: ReadonlySet<string> = new Set(['mutating-shared', 'destructive'])

/**
 * The ops whose risk class the deleted gate would have ASKED about, PRODUCED by the shipped
 * classifier.
 *
 * Until 432-19 this OBSERVED the gate: it ran `evaluate` with a declining confirm and recorded which
 * ops reached the port. The gate and its port are deleted (D-15), so there is nothing to observe; the
 * set is the classifier's own tier for each declaration's descriptor, filtered to the two tiers the
 * ladder asked on. Pure of ambient state, and drivable with synthetic descriptors, so
 * `parity.test.ts` can prove the derivation still tells an asking class from a non-asking one.
 */
export function deriveAskCapableOpIds(ops: readonly RiskClassifiable[]): readonly string[] {
  return ops
    .filter((op) => FORMERLY_ASKING_TIERS.has(classifyRisk(op.risk).riskTier))
    .map((op) => op.id)
    .sort()
}

/**
 * The derived ask set, PINNED (2026-08-16, measured over the 41-op census).
 *
 * A pin rather than a bare derivation because a set computed fresh on every run and compared to
 * nothing is a set nobody has agreed to: the scenario table's ask points would silently follow the
 * classifier wherever it went. `parity.test.ts` asserts this constant set-equals a fresh derivation,
 * so a lexicon change or a declared-tier edit that moves a capability into or out of "asks a person
 * first" is a named RED on the PR that makes it — which is the whole reason the pin exists.
 *
 * Worth reading once: `grants.revoke` was here (until 432-18 deleted it) at `destructive` rather
 * than at the `mutating-shared` its spec declared, because the soft-destructive lexicon matches
 * `revoke` in its action name and the classifier takes the HIGHEST proposal. That is the classifier
 * working, and it is exactly the kind of fact a hand-picked list gets wrong.
 */
export const ASK_CAPABLE_OP_IDS: readonly string[] = Object.freeze([
  'authoring.draft.write',
  // 2026-10-01 (432-17): `config.proposal.apply`, `knowledge.proposal.apply` and `proposals.accept`
  // left the registry with the inbox, and so left this set. 2026-10-01 (432-18): `grants.revoke`
  // left with the grant ledger.
  // 2026-09-08, 419 D-13/D-20: measured by the same shipped ask derivation.
  'runs.mark',
])
