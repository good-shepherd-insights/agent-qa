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
// THE GRANT IS COMPOSITION-DERIVED, NEVER NAMED BY A CALLER. `open()` takes no action name on
// purpose. A `record(actionClass)` seam — the shape the plan sketched — would let whatever holds
// the lease name the class it is granting itself, which is the same widening `STANDING_APPROVAL_SCOPE`
// is composition-supplied to prevent (`invoke.ts`: "a caller that could name the scope its own
// action is evaluated under could widen any grant into a match"). The action class here is the run
// gate's own pinned constant and there is no parameter to move it with.
//
// IT MINTS NOTHING DURABLE. `grants.jsonl` has ONE writer (`createGrantOperations`, hoisted in
// `compose-local-agent.ts` so a person's `a` keystroke has exactly one destination). This overlay
// is an in-memory union placed in FRONT of that ledger's reader; a dispatch grant lives in a `Set`
// and dies with the closure that opened it. A second mint would be a second answer to which
// approvals are in force — and it would be the one that outlived the dispatch.

import { STANDING_APPROVAL_SCOPE } from '@vostride/agent-qa-schema'
import type { RiskActionDescriptor, StandingApprovalGrant, TrustScope } from '@vostride/agent-qa-schema'
import type { StandingApprovalReader } from '@vostride/agent-qa-safety'

import { RUN_START_RISK_ACTION_NAME } from './run-risk.js'

/**
 * One open dispatch scope.
 *
 * `dispose()` is IDEMPOTENT and total: a lease is released from a `finally`, and a second release
 * — a caller that disposes and then unwinds through the same `finally` — must not retire a
 * DIFFERENT dispatch's grant. Each lease holds its own token and deletes only that token.
 */
export interface DispatchGrantLease {
  dispose(): void
}

/**
 * The overlay a composition holds for the lifetime of its host.
 *
 * The OBJECT is long-lived; the GRANTS are not. With no dispatch open it answers exactly what the
 * durable ledger answers, which is what makes "the grant died with the dispatch" a property of the
 * data rather than of who is holding a reference.
 */
export interface DispatchGrants {
  /** Open a dispatch scope covering the run gate's action class at the pinned scope. */
  open(): DispatchGrantLease
  /**
   * The reader the run gate consults: `durable`'s answer for this action, unioned with the
   * dispatch grant of every scope currently open.
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
  // repair probe taken while an outer scope is open — and a counter would let the inner scope's
  // `dispose()` retire the outer scope's grant the moment the two interleaved.
  const open = new Set<symbol>()

  return {
    open(): DispatchGrantLease {
      const token = Symbol('dispatch-grant')
      open.add(token)
      return {
        dispose(): void {
          open.delete(token)
        },
      }
    },
    readerOver(durable: StandingApprovalReader | undefined): StandingApprovalReader {
      return {
        grantsFor(
          action: RiskActionDescriptor,
          actionScope: TrustScope,
        ): readonly StandingApprovalGrant[] {
          const persisted = durable?.grantsFor(action, actionScope) ?? []
          // READ AT ANSWER TIME, never captured when the reader was built. The reader the run
          // invocation hands the core is built per call, but a door that held one across calls
          // must still see a dispatch that opened after it took its reference — otherwise the
          // overlay's whole lifetime claim would depend on when somebody asked for the reader.
          if (open.size === 0) return persisted
          return [...persisted, dispatchGrant()]
        },
      }
    },
    get openScopes(): number {
      return open.size
    },
  }
}
