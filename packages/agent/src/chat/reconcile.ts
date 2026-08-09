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
import { MARK_UNHANDLED_TOOL_NAME } from './tool-names.js'

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

/** The refusal sentence a turn carries when the MODEL said the clause cannot be done (D-08). */
export function modelUnhandledReason(clause: string, reason: string): string {
  return (
    `No capability in this build handles: "${clause}" — ${reason} The turn was refused before `
    + 'anything ran, so nothing in the request was carried out.'
  )
}

/** The refusal sentence a turn carries when stage 2 could not reach the model at all. */
export function plannerFailedReason(clause: string, failure: { name: string }): string {
  return (
    `The planner could not be reached (${failure.name}), so "${clause}" was never routed. `
    + 'The turn was refused before anything ran.'
  )
}

/**
 * Read the model's own fail-closed signal off its plan (D-08).
 *
 * `mark_unhandled` is a tool call like any other, so this is a read of untrusted output: the clause
 * text it names is used to CHOOSE which clause the refusal is about, by matching what the splitter
 * produced, and never as the refusal's subject directly. A model that names a clause nobody typed
 * still refuses the turn — the first unmapped clause is the honest subject then — because a plan
 * containing this call is a plan whose author said it could not be completed.
 */
function modelMarkedUnhandled(
  input: ReconcileInput,
): { clause: string; reason: string } | undefined {
  for (const call of input.planned.toolCalls) {
    if (call.toolName !== MARK_UNHANDLED_TOOL_NAME) continue
    const body = (typeof call.input === 'object' && call.input !== null ? call.input : {}) as {
      clause?: unknown
      reason?: unknown
    }
    return {
      clause: typeof body.clause === 'string' ? body.clause : '',
      reason: typeof body.reason === 'string' ? body.reason : 'no capability for it has shipped.',
    }
  }
  return undefined
}

/**
 * The deterministic override: what the table proved beats what anything else proposed.
 *
 * The mapped set is indexed by CLAUSE INDEX rather than by matching text, and that is the D-12
 * mechanism in miniature: the clause's position is its identity, so a planner entry for a clause
 * the table already resolved cannot displace the mapper's binding no matter how the model spelled
 * it. Plan 07 extends the merge; it does not get to relax this.
 *
 * WHAT THIS STRATEGY DOES NOT YET DO, stated so a reader does not mistake it for a decision that
 * has been made: it does not ALIGN the model's action tool calls onto clauses. That alignment — one
 * call per clause in utterance order, with the table's binding winning wherever both have one — is
 * plan 07's, and it fills this same seam. Until it lands, an action call the model proposed for a
 * clause the table could not resolve leaves that clause unresolved, and the turn fails closed
 * naming it. The gap therefore errs toward refusing, never toward executing a proposal no
 * deterministic step has checked, which is the only direction D-10 permits it to err in.
 */
export const deterministicOverrideStrategy: ReconcileStrategy = (
  input: ReconcileInput,
): ReconcileVerdict => {
  const mappedByIndex = new Map(input.mapped.map((resolved) => [resolved.clause.index, resolved]))

  // The model's own refusal is checked BEFORE the plan is assembled, because a turn one of whose
  // clauses cannot be done is refused whole (D-10) — including the clauses the table did resolve.
  // Assembling first and discarding after would put a plan and a refusal in the same code path,
  // which is how a partially-executed compound turn eventually gets written.
  const marked = modelMarkedUnhandled(input)
  if (marked !== undefined) {
    const named =
      input.clauses.find((clause) => clause.text === marked.clause)
      ?? input.clauses.find((clause) => !mappedByIndex.has(clause.index))
      ?? input.clauses[0]
    if (named !== undefined) {
      return {
        kind: 'unhandled',
        clause: named,
        reason: modelUnhandledReason(named.text, marked.reason),
      }
    }
  }

  const plan = []
  for (const clause of input.clauses) {
    const resolved = mappedByIndex.get(clause.index)
    if (resolved !== undefined) {
      plan.push(resolved)
      continue
    }
    // An unresolved clause is answered by prose or it is not answered at all. `answer_only` covers
    // the turn's informational content, so a clause with no binding and an answer in hand is a
    // question that got an answer rather than an action that got dropped (CHAT-01).
    if (input.planned.answer !== undefined) continue
    if (input.planned.failure !== undefined) {
      return { kind: 'unhandled', clause, reason: plannerFailedReason(clause.text, input.planned.failure) }
    }
    return { kind: 'unhandled', clause, reason: unhandledReason(clause.text) }
  }
  // Utterance order, preserved (D-11): order is meaning, and later clauses routinely depend on
  // earlier ones. The loop above walks `clauses`, not either resolution set, precisely so a
  // planner that answered out of order cannot reorder what runs.
  return input.planned.answer === undefined
    ? { kind: 'execute', plan }
    : { kind: 'execute', plan, answer: input.planned.answer }
}

// The tracer's whole-utterance splitter USED TO LIVE HERE and is gone as of plan 02, because the
// seam it was holding open is now filled: `chat/clause-split.ts` is the real conjunction grammar
// and the composition root binds it. Keeping the one-clause version around as a published symbol
// would leave two answers to "how is an utterance split" in the barrel, with only one of them
// bound — which is precisely the second-vocabulary failure this subtree is written to avoid. A
// differential that wants a null splitter can spell one inline; that is a test's need, not a
// production surface.
