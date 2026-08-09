// Stage 3 — deterministic reconciliation (Phase 392, D-09 / D-10 / D-12 / D-16).
//
// The strategy in this file is MINIMAL on purpose, and the boundary is worth stating because the
// temptation is to write plan 07's version now. What ships here covers exactly the tracer's shape:
// every clause the table resolved is the verdict, and any clause it did not resolve and the planner
// did not plan rejects the WHOLE turn. The compound semantics — the override winning on count AND
// argument binding against a model that planned differently (D-12) — is plan 07's, and it fills
// this same seam rather than replacing it.
//
// WHAT IS ALREADY FINAL HERE IS THE ATOMICITY (D-10). Reconciliation returns before any side effect
// exists, so an unhandled clause costs the turn everything and executes nothing. That is not an
// optimisation of the failure path; it is the property `compound/` scenarios assert as
// `executed == 0`, and a strategy that let earlier clauses run before discovering a later
// unroutable one would make that assertion unwritable.

import type { ReconcileInput, ReconcileStrategy, ReconcileVerdict } from './ports.js'

/**
 * The refusal sentence a fail-closed turn carries.
 *
 * It NAMES the clause (D-08). A message that said only "I could not do that" would leave a person
 * unable to tell which half of a compound request was refused, and would make a silent drop and a
 * loud refusal read identically in the log.
 */
export function unhandledReason(clause: string): string {
  return (
    `No capability in this build handles: "${clause}". The turn was refused before anything ran, `
    + 'so nothing in the request was carried out.'
  )
}

/**
 * The deterministic override: what the table proved beats what anything else proposed.
 *
 * The mapped set is indexed by CLAUSE INDEX rather than by matching text, and that is the D-12
 * mechanism in miniature: the clause's position is its identity, so a planner entry for a clause
 * the table already resolved cannot displace the mapper's binding no matter how the model spelled
 * it. Plan 07 extends the merge; it does not get to relax this.
 */
export const deterministicOverrideStrategy: ReconcileStrategy = (
  input: ReconcileInput,
): ReconcileVerdict => {
  const mappedByIndex = new Map(input.mapped.map((resolved) => [resolved.clause.index, resolved]))
  const plannedByIndex = new Map(input.planned.map((resolved) => [resolved.clause.index, resolved]))

  const plan = []
  for (const clause of input.clauses) {
    const resolved = mappedByIndex.get(clause.index) ?? plannedByIndex.get(clause.index)
    if (resolved === undefined) {
      return { kind: 'unhandled', clause, reason: unhandledReason(clause.text) }
    }
    plan.push(resolved)
  }
  // Utterance order, preserved (D-11): order is meaning, and later clauses routinely depend on
  // earlier ones. The loop above walks `clauses`, not either resolution set, precisely so a
  // planner that answered out of order cannot reorder what runs.
  return { kind: 'execute', plan }
}

// The tracer's whole-utterance splitter USED TO LIVE HERE and is gone as of plan 02, because the
// seam it was holding open is now filled: `chat/clause-split.ts` is the real conjunction grammar
// and the composition root binds it. Keeping the one-clause version around as a published symbol
// would leave two answers to "how is an utterance split" in the barrel, with only one of them
// bound — which is precisely the second-vocabulary failure this subtree is written to avoid. A
// differential that wants a null splitter can spell one inline; that is a test's need, not a
// production surface.
