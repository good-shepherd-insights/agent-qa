// THE DISPATCH-SCOPED GRANT OVERLAY (Phase 401 plan 08 — D-08, RESEARCH Pitfall 6).
//
// WHAT PROBLEM THIS SOLVES. 394 D-03 gives the authoring dispatch ONE human ask: the
// `fn:authoring.draft.write` gate is `mutating-shared`, it renders the fan-out preview, and a
// person approves the whole invocation. The loop then starts up to nine gate runs, and since
// 401-03 every one of those crosses the run gate too — `run:start`, classified from the target's
// declared class. Against a `shared` target from a non-interactive host that second gate asks, and
// an ask with nobody to ask denies fail-closed. One approval, N refusals.
//
// WHY IT IS A READER AND NOT A CONFIRM MEMO (Pitfall 6, and the whole reason this file exists).
// `resolveAsk`'s ladder is ordered: trust mode (a), credential (b), STANDING GRANTS (c),
// fail-closed (d), confirm (e). A dispatch approval remembered as a confirm-port memo sits at (e)
// — BELOW the fail-closed check — so in exactly the contexts D-08 is about it is never consulted.
// A grant sits at (c), ABOVE it. That ordering is the mechanism; everything else here is bookkeeping.
//
// NO STRUCTURAL BYPASS, which is the half D-08 states twice. A covered run still calls `evaluate()`,
// still classifies, still writes its OWN execution-audit row, and that row carries
// `trustSource: 'standing-approval'` — one ask, N gated runs, N attributable rows. Nothing here can
// make a run skip the gate, because all this answers is the grants question the gate asks.
//
// THE GRANT IS COMPOSITION-DERIVED, NEVER NAMED BY A CALLER. `within(fn)` takes no action name on
// purpose — its one parameter is the continuation to run, and nothing else. A `record(actionClass)`
// seam — the shape 401-08's plan sketched — would let whatever holds the scope name the class it is
// granting itself, which is the same widening `STANDING_APPROVAL_SCOPE` is composition-supplied to
// prevent (`invoke.ts`: "a caller that could name the scope its own action is evaluated under could
// widen any grant into a match"). The action class here is the run gate's own pinned constant and
// there is no parameter to move it with.
//
// AND THE FIFTH LAW, ADDED BY 401-13 (verification gap CR-03): COVERAGE IS DISPATCH-TREE-SCOPED.
// Until this plan `grantsFor` branched on `open.size === 0` and referenced nobody — so while ANY
// authoring dispatch was open on a host, EVERY concurrent `run:start` through that host was
// satisfied by it. A dashboard run-button click, a second conversation and an MCP caller all
// recorded `trustSource: 'standing-approval'`, byte-identical to a run that had actually earned it,
// which made the widening unattributable in the record. D-08 as ratified covers "exactly the
// previewed gate-runs", so the overlay now answers the union ONLY for a call whose own async
// context lies inside an open dispatch's call tree.
//
// WHY AN ASYNC SCOPE AND NOT A TOKEN ON THE REQUEST. The verifier offered two shapes. A token
// carried to the consumer would put a bearer credential into `RunsStartInputSchema` — a
// caller-suppliable wire field on exactly the surface reachable from `agent-qa fn` and MCP — and an
// unrelated caller would simply name the open dispatch, which is the SAME widening the paragraph
// above rules out, in a new costume. An `AsyncLocalStorage` scope crosses no schema and cannot be
// entered from outside the dispatch's own call tree, and it has shipped in-repo precedent at this
// exact seam class (`dashboard.ts`'s `askingSessions`, `safety-local`'s one-store run-safety scope).
// D-07's ban is on the CORE sniffing ambient context; this is composition vocabulary consulted
// through the reader the composition already resolves per run, and the core still receives a plain
// `StandingApprovalReader` it cannot tell apart from the durable ledger's.
//
// IT MINTS NOTHING DURABLE. `grants.jsonl` has ONE writer (`createGrantOperations`, hoisted in
// `compose-local-agent.ts` so a person's `a` keystroke has exactly one destination). This overlay
// is an in-memory union placed in FRONT of that ledger's reader; a dispatch grant lives in a `Set`
// and dies with the closure that opened it. A second mint would be a second answer to which
// approvals are in force — and it would be the one that outlived the dispatch.

import { AsyncLocalStorage } from 'node:async_hooks'

import { STANDING_APPROVAL_SCOPE } from '@vostride/agent-qa-schema'
import type { RiskActionDescriptor, StandingApprovalGrant, TrustScope } from '@vostride/agent-qa-schema'
import type { StandingApprovalReader } from '@vostride/agent-qa-safety'

import { RUN_START_RISK_ACTION_NAME } from './run-risk.js'

/**
 * The overlay a composition holds for the lifetime of its host.
 *
 * The OBJECT is long-lived; the GRANTS are not. With no dispatch open it answers exactly what the
 * durable ledger answers, which is what makes "the grant died with the dispatch" a property of the
 * data rather than of who is holding a reference.
 */
export interface DispatchGrants {
  /**
   * Run `fn` inside a dispatch scope covering the run gate's action class at the pinned scope.
   *
   * A SCOPE AND NOT A LEASE HANDLE, because the coverage question is "was this call made by the
   * dispatch" and a handle can only answer "is some dispatch running". Disposal is structural: the
   * scope's token leaves the open set in this function's own `finally`, so there is no exit — a
   * return, a throw, a rejection — that leaves a grant behind (T-401-22), and no second release for
   * a caller to get wrong.
   *
   * Nesting composes: an inner scope has its own token, and when it ends the enclosing scope's
   * token is what the async context restores.
   */
  within<T>(fn: () => Promise<T>): Promise<T>
  /**
   * The reader the run gate consults: `durable`'s answer for this action, unioned with the
   * dispatch grant of the open scope THIS CALL IS BEING MADE INSIDE — and with nothing else.
   *
   * A UNION AND NOT A REPLACEMENT. The durable half is the ledger a person can write by hand
   * (`grants.jsonl`), and dropping it here would mean a hand-written `run:start` approval stopped
   * being honoured the moment this overlay was composed in front of it — a one-sided tightening
   * nobody ratified, arriving as a side effect of a feature about widening.
   *
   * `undefined` durable is the no-ledger case (an unresolvable knowledge root), and it folds to
   * "no standing approvals" rather than to an error, exactly as the composition's own resolver does.
   */
  readerOver(durable: StandingApprovalReader | undefined): StandingApprovalReader
  /** How many dispatch scopes are open. DATA — a composition may say so; nothing branches on it. */
  readonly openScopes: number
}

/**
 * The grant one open dispatch contributes.
 *
 * Spelled from the two pinned constants and from nothing else. `grantCovers` demands
 * `grant.actionClass === action.name` and a byte-equal scope match, so a re-spelling here would be
 * a second answer to a comparison whose whole point is that there is only one.
 */
function dispatchGrant(): StandingApprovalGrant {
  return { actionClass: RUN_START_RISK_ACTION_NAME, scope: STANDING_APPROVAL_SCOPE }
}

export function createDispatchGrants(): DispatchGrants {
  // Tokens, not a counter. Two dispatches can overlap — a host serving two conversations, or a
  // repair probe taken while an outer scope is open — and a counter would let the inner scope
  // ending retire the outer scope's grant the moment the two interleaved.
  const open = new Set<symbol>()
  // The call-tree channel. COMPOSITION-LOCAL, on `dashboard.ts`'s `askingSessions` precedent:
  // created here, entered only by this overlay's own `within`, read only by this overlay's own
  // reader. Nothing outside can set it, so a second composition in the same process cannot be
  // answered with this one's dispatch — and no caller can name a scope it is not already inside.
  const scope = new AsyncLocalStorage<symbol>()

  return {
    async within<T>(fn: () => Promise<T>): Promise<T> {
      const token = Symbol('dispatch-grant')
      open.add(token)
      try {
        return await scope.run(token, fn)
      } finally {
        // BOTH HALVES MATTER, and they are different halves. The async context unwinds on its own
        // when `run` returns; this `delete` is what makes the grant EXPIRE — a continuation
        // captured inside the scope and resumed after the dispatch ended still carries the token
        // in its context, and the open set is the only thing that can tell it is stale.
        open.delete(token)
      }
    },
    readerOver(durable: StandingApprovalReader | undefined): StandingApprovalReader {
      return {
        grantsFor(
          action: RiskActionDescriptor,
          actionScope: TrustScope,
        ): readonly StandingApprovalGrant[] {
          const persisted = durable?.grantsFor(action, actionScope) ?? []
          // READ AT ANSWER TIME, never captured when the reader was built — both the open set and
          // the asking call's context. The run invocation builds a reader per call, but a door that
          // held one across calls must still see a dispatch that opened after it took its
          // reference, and must resolve the CALLER from the call rather than from the construction.
          //
          // TWO CONDITIONS, AND EACH ONE IS A DIFFERENT DEFECT. No token at all is the CR-03 case:
          // a dashboard click or an MCP caller running outside every dispatch's tree, which now
          // gets exactly the durable ledger's answer. A token the open set no longer holds is the
          // T-401-22 case: a call inside a tree whose dispatch has already ended.
          const token = scope.getStore()
          if (token === undefined || !open.has(token)) return persisted
          return [...persisted, dispatchGrant()]
        },
      }
    },
    get openScopes(): number {
      return open.size
    },
  }
}
