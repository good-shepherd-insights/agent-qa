// Stage 3 — deterministic reconciliation (Phase 392, D-09 / D-10 / D-11 / D-12 / D-16).
//
// THE FILE IS A TOTAL FUNCTION FROM TWO PROPOSALS TO ONE VERDICT, and every clause of the utterance
// leaves it accounted for: bound by the table, bound by the model, answered in prose, or naming the
// refusal that costs the whole turn. There is no fifth outcome and no path on which a clause simply
// stops being mentioned — a silently dropped clause is T-392-25, and the only structural defence
// against it is a merge that walks the CLAUSES rather than either proposal.
//
// D-12, PRECISELY. Wherever the table resolved a clause, the mapper's `{ functionId, args }` is the
// verdict — the model's call for that same clause is discarded whole, target and arguments alike
// ("run test 42" with the model planning TST-999 executes TST-42). That is two claims and they fail
// independently, so the suite asserts them apart: the ACTION SET (how many, and which) and the
// BOUND ARGUMENTS. A reconciler that honoured the first and not the second would run the right op
// against the wrong entity, which is the more dangerous half.
//
// D-09'S PRECISION CLAUSE IS WHAT LIMITS THE OVERRIDE. Only EXACT table resolutions participate:
// `mapped` carries what stage 1 proved at confidence 1.0, and nothing else may ever be added to it,
// because an overriding path that false-positived would beat a correct model plan with a wrong
// guess. Everything fuzzy stays on the model's side of the merge, where it is one proposal among
// others rather than a verdict.
//
// WHAT IS ALREADY FINAL HERE IS THE ATOMICITY (D-10). Reconciliation returns before any side effect
// exists, so an unhandled clause costs the turn everything and executes nothing. That is not an
// optimisation of the failure path; it is the property `compound/` scenarios assert as
// `executed == 0`, and a strategy that let earlier clauses run before discovering a later
// unroutable one would make that assertion unwritable.
//
// THE STRATEGY IS PURE: a verdict in, a verdict out, no clock, no filesystem, no model. That purity
// is what makes D-16's mutation proof meaningful — the differential composes the REAL host twice
// with two strategies and reads the difference off a named scenario, and it can only do that
// because swapping this function changes nothing else about the assembled system.

import type {
  ClauseAction,
  PlannerToolCall,
  ReconcileInput,
  ReconcileStrategy,
  ReconcileVerdict,
} from './ports.js'
import { MARK_UNHANDLED_TOOL_NAME, fromToolName, isChatMetaToolName } from './tool-names.js'

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
 * The model's ACTION proposals, in the order it made them.
 *
 * The two orchestration calls are removed here and nowhere else. They are not proposals about what
 * to run — one answers the turn and the other refuses it — and {@link fromToolName} THROWS on both
 * by design, so a merge that reversed every call without checking would crash on precisely the two
 * calls that matter most. Filtering by the published predicate rather than by a local name test is
 * what keeps that check from being re-derived a third time.
 */
function actionCalls(input: ReconcileInput): readonly PlannerToolCall[] {
  return input.planned.toolCalls.filter((call) => !isChatMetaToolName(call.toolName))
}

/**
 * The deterministic override: what the table proved beats what anything else proposed.
 *
 * The mapped set is indexed by CLAUSE INDEX rather than by matching text, and that is the D-12
 * mechanism in miniature: the clause's position is its identity, so a planner entry for a clause
 * the table already resolved cannot displace the mapper's binding no matter how the model spelled
 * it — nor can an EXTRA call inflate the plan, because the merge takes its length from the clauses.
 *
 * THE ALIGNMENT RULE FOR EVERYTHING ELSE is the prompt's own contract, read back: one action call
 * per clause, in utterance order. So the model's action calls are consumed in order by the clauses
 * the table could not bind, and a leftover call is discarded rather than executed. Discarding a
 * CALL is not dropping a CLAUSE — every clause is still accounted for below — and the asymmetry is
 * the point: the model may lose a proposal, and the person may never lose a request.
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

  const proposed = actionCalls(input)
  let nextProposal = 0

  const plan: ClauseAction[] = []
  for (const clause of input.clauses) {
    const resolved = mappedByIndex.get(clause.index)
    if (resolved !== undefined) {
      // The override, in one line: the table's binding, tagged with the stage that proved it so the
      // engine mints a human caller for it. Nothing the model proposed is consulted for this clause.
      plan.push({ ...resolved, source: 'resolver' })
      continue
    }
    const proposal = proposed[nextProposal]
    if (proposal !== undefined) {
      nextProposal += 1
      plan.push({
        clause,
        // The id the function layer answers to. An id nothing registered is NOT checked here —
        // `invokeFunction` raises `UnknownFunctionError` naming it, from the one place that knows
        // what is registered, and a check here would be a second catalogue free to disagree.
        functionId: fromToolName(proposal.toolName),
        // Carried across UNVALIDATED and unshaped. What validates a tool call's arguments is the
        // op's own live schema inside `invokeFunction`; a shape enforced here would be a second
        // validator standing in front of the real one.
        args: proposal.input,
        source: 'planner',
      })
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
