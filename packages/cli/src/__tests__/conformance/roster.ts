// The surface roster: a pinned closed set (Phase 397 plan 01, D-04).
//
// WHY A CLOSED SET AND NOT A DISCOVERY. "No private powers" is a claim about EVERY surface, and a
// suite that ranged over whatever surfaces it happened to find would be measuring an accident. Two
// surfaces exist today — the chat host and the MCP server — and they are named here as data so that
// adding a third is a reviewed one-line diff rather than a silent widening of the claim.
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
// THE ROW NAMES ITS ADAPTER RATHER THAN INLINING ONE. What a surface IS (a member of the roster) and
// HOW it is read (a wire round trip, a projection walk) are different questions with different
// reasons to change, and the enumeration mechanics carry enough reasoning to want their own module.

import { chatSurfaceAdapter, mcpSurfaceAdapter, type SurfaceAdapter } from './adapters.js'

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
] as const satisfies readonly SurfaceRosterEntry[])
