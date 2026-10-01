// The policy fixtures the verdict legs are driven with (Phase 397 plan 03, D-11).
//
// WHAT THIS FILE OWNS. Three things, and none of them is an expectation: the CALLERS each policy
// point is exercised under, the execution context those points are decided in, and the set of ops
// whose risk class can reach an `ask` at all. 397-04 owns the verdict comparisons themselves; the
// scenario table owns which points each row declares. Splitting it that way is what keeps the
// fixtures from quietly encoding the answer they are supposed to be measuring.
//
// NO CALLER HOLDS A GRANT (2026-10-01, 432-20, D-12). Until the permission wave the covering caller
// held exactly an op's declared scopes and the refusing caller withheld one. Declarations carry no
// scopes and `invokeFunction` reads none, so the covering caller is the tokenless record every door
// now mints, and the refuse point is retired — there is no grant left to withhold. No scope is
// spelled here, and none is read.
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
import type { ExecutionContext, FunctionCaller } from '@vostride/agent-qa-schema'
import type { RiskActionDescriptor } from '@vostride/agent-qa-schema'

import { MCP_DEFAULT_GRANTED_SCOPES, mcpFunctionCaller } from '../../commands/mcp.js'

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
function conformanceCaller(): FunctionCaller {
  return Object.freeze({
    surface: 'conformance',
    // `human`, as before: since 432-20 the origin decides nothing, and keeping the value the suite
    // always used means a re-spelled cell differs from its old self only in the grants.
    origin: 'human',
  })
}

/**
 * The covering caller for an op: the tokenless record, holding no grant at all (432-20, D-12).
 *
 * Until 432-20 this held exactly the op's declared scopes, so a caller holding every scope could not
 * mask an op whose scopes had silently emptied. With no scopes declared or read, a caller holding
 * NOTHING is the strongest covering caller there is: anything it reaches, every caller reaches.
 */
export function coveringCallerFor(_declaration: FunctionDeclaration): FunctionCaller {
  return conformanceCaller()
}

// 2026-10-01 (432-20, D-12): `refusingCallerFor` and `RefusingCallerFixture` are deleted. The refuse
// point was "the covering grant minus one scope, named"; no grant is read, so there is nothing to
// withhold and no refusal on that axis to attribute.

// ---- The two surfaces' own caller mints (397-04, legs 3 and 4) ---------------------------------

/**
 * One capability's caller, as each rostered surface would mint it.
 *
 * BOTH SIDES ARE PRODUCED BY THE SURFACE THAT OWNS THEM, and that is the whole point of this type
 * existing rather than a `surface` argument on one builder. `CHAT_RESOLVER_CALLER` is the frozen
 * record `composeLocalAgent` spreads at its own `mint.forStage`; `mcpFunctionCaller` is the function
 * `commands/mcp.ts` composes its server with. A parity assertion whose two comparands came out of
 * ONE builder with a different string is a value compared to itself.
 */
export interface SurfaceShapedCallers {
  readonly chat: FunctionCaller
  readonly mcp: FunctionCaller
}

/**
 * The two surfaces' callers, each minted the way its own surface mints today: the chat resolver's
 * record verbatim, and the MCP door's anonymous mint over its default grant.
 *
 * They differ in `surface`, `origin` and the retired grant fields. Since 432-20 (D-10/D-12) none of
 * those is read by the function layer, so the two must answer alike for every capability.
 */
export function surfaceShapedCallers(): SurfaceShapedCallers {
  return {
    chat: Object.freeze({ ...CHAT_RESOLVER_CALLER }),
    mcp: Object.freeze(mcpFunctionCaller([...MCP_DEFAULT_GRANTED_SCOPES])),
  }
}

/**
 * The same two callers with every field but `surface` harmonised — FUNC-03's claim, isolated: two
 * records that agree on everything else and disagree only on which surface minted them.
 */
export function surfaceInertCallers(): SurfaceShapedCallers {
  const shaped = surfaceShapedCallers()
  return {
    chat: shaped.chat,
    mcp: Object.freeze({
      ...shaped.mcp,
      origin: shaped.chat.origin,
      grantedScopes: shaped.chat.grantedScopes,
      safeMode: shaped.chat.safeMode,
    }),
  }
}

/**
 * The two surfaces' callers stripped of every grant — the shortest caller each surface could hand
 * the function layer. Used by the retired refuse legs to show nothing refuses them (432-20).
 */
export function grantlessSurfaceCallers(): SurfaceShapedCallers {
  const inert = surfaceInertCallers()
  return {
    chat: Object.freeze({ ...inert.chat, grantedScopes: [] }),
    mcp: Object.freeze({ ...inert.mcp, grantedScopes: [] }),
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
