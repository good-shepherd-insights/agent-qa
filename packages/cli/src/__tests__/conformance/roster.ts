// The surface roster: a pinned closed set (Phase 397 plan 01, D-04).
//
// WHY A CLOSED SET AND NOT A DISCOVERY. "No private powers" is a claim about EVERY surface, and a
// suite that ranged over whatever surfaces it happened to find would be measuring an accident. Two
// surfaces exist today — the chat host and the MCP server — and they are named here as data so that
// adding a third is a reviewed one-line diff rather than a silent widening of the claim.
//
// 2026-08-21 — FOUR ROWS. The sentence above is left as it was written because this file reads as a
// dated history, and its counts are history too; the roster itself is what states the current set.
//
// 2026-08-16 — THE REGISTRATION NOTE. A surface that lands after this date MUST arrive with a roster
// row and an adapter, in the same change that ships it. Three are already anticipated:
//
//   * 398's capability catalogue, if it enumerates capabilities to a caller rather than only
//     describing them;
//   * the M5 dashboard, whose HTTP path is the exact private channel the v1 server carried and the
//     one this whole suite exists to make impossible to re-create quietly;
//   * any post-v2.0 REST or SDK surface.
//
// A surface without a row is not "not yet covered" — it is a surface the parity claim silently
// excludes itself from, which is worse than an uncovered one because the suite still reads green.
//
// 2026-08-17 — THE CAPABILITY CATALOGUE IS NOT A SURFACE (Phase 398, D-02). The first of the three
// anticipated arrivals above has landed, and the answer to its "if it enumerates" condition is NO
// ROW. A surface is an INVOCATION DOOR: dispatch, policy, and gate verdicts. The catalogue
// (`packages/cli/capability-catalog/capability-catalog.json`, produced by `catalog.ts`) invokes
// nothing — it is committed build-time data describing what exists — so legs 3 and 4 of every
// rostered surface would be vacuous for it, and a roster row whose policy legs assert nothing is
// exactly the skip-list 397 D-12 refuses to start keeping.
//
// WHAT ANSWERS THE ENUMERATION OBLIGATION INSTEAD. The condition the note above was really about is
// "can a capability be reached, or advertised, without this suite seeing it". For the catalogue
// that is answered by census rather than by dispatch: `catalog.test.ts` asserts its op rows against
// the committed golden ledger, its alias rows against the shipped resolver table, and its skill
// rows against the skills directory — each set-equal in BOTH directions. A capability the catalogue
// advertised and the registry did not declare is a named RED there, which is the same guarantee a
// roster row would have bought and the only one it could have.
//
// THIS CLOSES THE RESERVATION FOR THE CATALOGUE ONLY. The M5 dashboard and any post-v2.0 REST or
// SDK surface are unaffected: both dispatch, so both arrive with a row and an adapter. And if the
// catalogue ever grows a read ENDPOINT — a caller asking a running process what exists, rather than
// reading committed bytes — that endpoint is a door, and this note does not cover it.
//
// 2026-08-20 — THE `fn` DOOR IS THE THIRD ROW (Phase 399.1, D-07). This is the registration note
// above being honoured rather than an exception to it: `agent-qa fn` is an INVOCATION DOOR by the
// 2026-08-17 test — it dispatches, it consults the gate, and a person reaches every registered
// capability through it — and it had no row for three phases. 399's UAT is what made the omission
// costly: `fn` is the door the owner called HONEST (399 D-14, the CLI parity door), the one whose
// render the chat surface's default was then re-derived from, and the suite could not compare the
// two because only one of them was rostered. A parity claim about "what a person sees" that ranges
// the two surfaces that DON'T print the payload, and not the one that does, is a claim measured
// against the wrong denominator.
//
// WHAT IS AND IS NOT ON THE ROW (397 D-03, unchanged). The row is the REGISTRY-DRIVEN `fn` path —
// `--list` and `fn <id>`, which own no capability of their own and resolve everything through
// `invokeFunction`. The bespoke per-capability CLI command handlers (`agent-qa run`, `proposals
// show`, …) stay OFF the roster exactly as 397 D-03 ruled: rostering them would mint a new parity
// claim over hand-written handlers this suite has never measured, which is a widening dressed as a
// completion. So D-04's rule reads unchanged for the third time: adding a surface adds a ROW and an
// ADAPTER, in the change that ships it.
//
// THE ROW NAMES ITS ADAPTER RATHER THAN INLINING ONE. What a surface IS (a member of the roster) and
// HOW it is read (a wire round trip, a projection walk) are different questions with different
// reasons to change, and the enumeration mechanics carry enough reasoning to want their own module.

import {
  chatSurfaceAdapter,
  dashboardSurfaceAdapter,
  fnSurfaceAdapter,
  mcpSurfaceAdapter,
  type SurfaceAdapter,
} from './adapters.js'

/** One rostered surface. */
export interface SurfaceRosterEntry {
  /** The suite's word for the surface — it appears in every named RED this suite raises. */
  readonly id: string
  readonly adapter: SurfaceAdapter
}

export const SURFACE_ROSTER: readonly SurfaceRosterEntry[] = Object.freeze([
  // The chat host (392). TWO routes behind one row, both enumerated by the adapter: the planner
  // binds every listed op 1:1 into the model's vocabulary, and the deterministic resolver dispatches
  // without a model at all. One row because they are one surface — a person typing at one prompt.
  Object.freeze({ id: 'chat', adapter: chatSurfaceAdapter }),
  // The MCP server (396). Twelve workflow-coarse tools over twenty-two ops via the declared mapping;
  // the adapter folds a live listing back into op ids rather than comparing wire names to wire
  // names, because the other surface has no wire names to compare against.
  Object.freeze({ id: 'mcp', adapter: mcpSurfaceAdapter }),
  // The `fn` door (384, rostered 399.1 D-07). One route and no projection at all: the id a person
  // types IS the registry id, so the adapter's fold from wire names to op ids — the move the two
  // rows above both need — is the identity here. What its adapter still has to do is DRIVE the
  // command rather than read the registry, because the listing passes through a composition root, a
  // caller mint and a declaration projection, and a set assembled from the registry this file could
  // reach would be the same set on both sides of every comparison.
  Object.freeze({ id: 'fn', adapter: fnSurfaceAdapter }),
  // The dashboard chat door (400, rostered 400-01, D-12). THE SECOND OF THE THREE ARRIVALS THE
  // 2026-08-16 registration note reserved, and it lands on day one of the phase that ships it rather
  // than at its end — which is what D-04's "in the change that ships it" means when the surface is
  // being built rather than discovered. The note named this door specifically: "the M5 dashboard,
  // whose HTTP path is the exact private channel the v1 server carried and the one this whole suite
  // exists to make impossible to re-create quietly."
  //
  // WHAT IS AND IS NOT ON THE ROW, on 397 D-03's unchanged rule. The row is the registry-driven chat
  // door — `POST /api/chat/turn`, which owns no capability of its own and resolves everything
  // through one `invokeFunction(agent.ask, …)`, and `GET /api/chat/capabilities`, which is that
  // door's own listing. The dashboard's other ~90 HTTP routes — runs, suites, config, artifacts,
  // the live editor — stay OFF the roster exactly as `agent-qa run` and `proposals show` do:
  // rostering them would mint a parity claim over hand-written v1 handlers this suite has never
  // measured, which is a widening dressed as a completion. Their retirement is 401's and 402's.
  //
  // THE ADAPTER DRIVES A REAL SERVER (D-09's in-process half). The door has no in-process listing
  // that is not served: what it reaches is what its own route says it reaches, read off the response
  // bytes, so a door that started filtering reds here by name.
  Object.freeze({ id: 'dashboard', adapter: dashboardSurfaceAdapter }),
] as const satisfies readonly SurfaceRosterEntry[])
