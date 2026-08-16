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
// THE EXECUTION CONTEXT IS INJECTED AND NEVER READ FROM THE AMBIENT PROCESS (Pitfall 3). The gate's
// ladder branches on `requiresFailClosed(ctx)`, and the shipped resolver answers `ci` whenever CI
// markers are present — so a verdict computed against the ambient context would be one answer on a
// laptop and another on a PR, in a suite whose entire job is to state what the verdict IS. Nothing
// here calls `getActiveExecutionContext`, reads `process.env`, or consults a TTY; the context is a
// constant this file exports and every consumer passes explicitly.
//
// THE ASK SET IS PRODUCED BY THE SHIPPED CLASSIFIER, NEVER HAND-PICKED (D-11's discretion clause).
// `deriveAskCapableOpIds` runs the real `evaluate` over each declaration's own risk descriptor and
// OBSERVES whether the ladder reached the confirm port — which is what "this op can produce an ask"
// means operationally, as opposed to what a reading of the tier table says it should mean. The
// pinned constant below is the recorded output of that run, and `parity.test.ts` asserts the two
// are equal on every execution, so classifier drift reds by name rather than silently re-scoping
// which capabilities ask a person before they act.

import type { FunctionDeclaration } from '@vostride/agent-qa-agent'
import { CHAT_RESOLVER_CALLER } from '@vostride/agent-qa-agent-local'
import { evaluate, NO_STANDING_APPROVALS } from '@vostride/agent-qa-safety'
import type { StandingApprovalReader } from '@vostride/agent-qa-safety'
import type { ExecutionContext, FunctionCaller, FunctionScope } from '@vostride/agent-qa-schema'
import type { RiskActionDescriptor, TrustScope } from '@vostride/agent-qa-schema'

import { mcpFunctionCaller } from '../../commands/mcp.js'

/**
 * The one execution context every conformance policy decision is taken in.
 *
 * `local-interactive` is the ONLY context `requiresFailClosed` answers `false` for, and that is
 * exactly why it is the right fixture: in any other context the gate denies an ask before it can be
 * observed to BE an ask, so a derivation taken there would report an empty ask set and a suite built
 * on it would assert that no capability in this product ever asks anyone anything.
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

/**
 * A standing-approval reader that pre-approves whatever action it is ASKED about.
 *
 * BUILT FROM THE ACTION'S OWN NAME AND THE CALL'S OWN SCOPE — the produced-not-literal idiom
 * `parity-coverage.test.ts` established for `EVERY_ASK_STANDING_APPROVED`. A reader holding a list
 * of pre-written action classes would be a second copy of the risk names, free to fall behind the
 * declarations and then to leave a capability's grant point silently measuring an ask instead.
 *
 * Its ONLY use is the grant point of an ask-capable capability: a cell that must get PAST the ask
 * to see where dispatch lands. Every cell that measures the ask ITSELF uses
 * {@link NO_STANDING_APPROVALS}, which is the gate's own default.
 */
export const EVERY_ASK_STANDING_APPROVED: StandingApprovalReader = Object.freeze({
  // Explicitly typed rather than contextually: `Object.freeze` is generic and infers from its
  // argument, so a member written inside it loses the annotation the interface would have supplied
  // — the same trap `resolver-table.ts` names at its `rule()` helper.
  grantsFor: (action: RiskActionDescriptor, actionScope: TrustScope) => [
    { scope: actionScope, actionClass: action.name },
  ],
})

/** The minimum an op needs to be classified: its id and the risk descriptor it declares. */
export interface RiskClassifiable {
  readonly id: string
  readonly risk: RiskActionDescriptor
}

/**
 * The ops whose risk class can produce an `ask`, PRODUCED by running the shipped gate.
 *
 * OBSERVED RATHER THAN INFERRED. `evaluate` never returns the string `ask` — it RESOLVES an ask into
 * an allow or a deny — so "can this op ask" cannot be read off its answer. What it can be read off
 * is behaviour: the confirm port is reached on exactly the path where the base verdict was `ask` and
 * no trust, credential or standing grant satisfied it. So the derivation supplies a confirm that
 * records having been consulted (and declines, so nothing is ever approved by this measurement),
 * an empty standing-approval reader, and no trust at all.
 *
 * Reading `classifyRisk(...).riskTier` and comparing it against a tier list would have been the
 * shorter spelling and a worse one: it restates the gate's own `baseVerdict` table in the suite, so
 * a change to that table would leave both copies agreeing with themselves and disagreeing with the
 * product.
 *
 * Pure of ambient state, and drivable with synthetic descriptors, so `parity.test.ts` can prove the
 * derivation distinguishes an asking op from a non-asking one instead of trusting its output.
 */
export async function deriveAskCapableOpIds(
  ops: readonly RiskClassifiable[],
  ctx: ExecutionContext = CONFORMANCE_EXECUTION_CONTEXT,
): Promise<readonly string[]> {
  const asked: string[] = []
  for (const op of ops) {
    let confirmConsulted = false
    await evaluate(
      op.risk,
      ctx,
      {},
      {
        reader: NO_STANDING_APPROVALS,
        confirm: () => {
          confirmConsulted = true
          return false
        },
      },
    )
    if (confirmConsulted) asked.push(op.id)
  }
  return asked.sort()
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
 * Worth reading once: `grants.revoke` is here at `destructive` rather than at the `mutating-shared`
 * its spec declares, because the soft-destructive lexicon matches `revoke` in its action name and
 * the classifier takes the HIGHEST proposal. That is the classifier working, and it is exactly the
 * kind of fact a hand-picked list gets wrong.
 */
export const ASK_CAPABLE_OP_IDS: readonly string[] = Object.freeze([
  'authoring.draft.write',
  'config.proposal.apply',
  'grants.revoke',
  'knowledge.proposal.apply',
  'proposals.accept',
])
