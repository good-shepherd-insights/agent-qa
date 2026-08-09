// The four-stage turn engine (Phase 392, CHAT-01 / CHAT-05 / D-01 / D-08 / D-10 / D-24).
//
// ONE turn engine, two surfaces. The interactive REPL, the one-shot `ask` verb and the scenario
// harness all drive this same entry — and they reach it through the registered `agent.ask` op, not
// by holding this object (D-24). Chat therefore has no private powers: every capability a turn
// exercises crosses `invokeFunction`'s eight-step gate exactly as a typed CLI verb does.
//
// THE STAGE ORDER IS A PINNED CONTRACT, in the house style `invoke.ts:123-134` sets:
//
//   1. deterministic resolver — the closed table, over the clause split. Precision 1.0 by
//      construction: an exact predicate hit or nothing, never a guess (D-09).
//   2. planner LLM          — via `PlannerStagePort`, and SKIPPED ENTIRELY when stage 1 resolved
//      every clause. Skipping is the tracer's whole point and a permanent property of canonical
//      utterances: they are model-independent, which is what makes their scenarios stable.
//   3. deterministic reconciliation — the injected strategy. Runs on single-clause turns too, so
//      there is one code path rather than a fast one and a careful one.
//   4. verdict + sequential execution — in utterance order, stopping on the first runtime failure,
//      one receipt per clause (D-11).
//
// STAGE 3 COMPLETES BEFORE STAGE 4 BEGINS, and that ordering IS D-10's strict pre-flight atomicity.
// An unroutable clause anywhere in the utterance rejects the whole turn with zero executions and a
// message naming it. There is no arrangement of these four stages in which a side effect precedes
// the verdict, and that is the property `compound/` scenarios pin as `executed == 0`.
//
// THIS ENGINE NEVER BRANCHES ON `caller.surface`. The anti-pattern is named in `invoke.ts:28-29`
// and it is the thing the function layer exists to abolish; what varies per stage here is the
// ORIGIN the composition minted, which is a fact about who is acting, not about where from.

import type {
  AgentAskInput,
  AgentAskResult,
  ChatSessionEvent,
  ClauseReceipt,
  ChatTurnStatus,
  SessionLogPort,
} from '@vostride/agent-qa-schema'

import type {
  CallerMint,
  ChatClause,
  ChatInvokeBinding,
  ClauseSplitter,
  CompactionHook,
  PlannerStagePort,
  ReconcileStrategy,
  ResolvedClause,
} from './ports.js'
import { directiveNotBoundReason, resolveClause } from './resolver-table.js'
import type { ChatDirectiveName, ChatResolverTable } from './resolver-table.js'

export interface TurnEngineDeps {
  readonly table: ChatResolverTable
  readonly split: ClauseSplitter
  readonly reconcile: ReconcileStrategy
  readonly sessionLog: SessionLogPort
  readonly mint: CallerMint
  readonly invoke: ChatInvokeBinding
  /** Absent ⇒ headless: an unresolved clause fails the turn closed BY NAME (D-08). */
  readonly planner?: PlannerStagePort
  readonly compaction?: CompactionHook
  readonly now: () => string
  readonly mintTurnId: () => string
}

/** What `agent.ask` is bound to. One method, because a turn is one thing that happens. */
export interface TurnEngine {
  runTurn(input: AgentAskInput): Promise<AgentAskResult>
}

/**
 * A one-line outcome summary, never a payload body (D-18).
 *
 * The log and the receipt are a MAP: they say which op ran and how it went, and the result itself
 * stays wherever the op put it. `JSON.stringify(result)` here would be the single easiest way to
 * put a knowledge record, a config value or a masked secret into a file several surfaces render.
 */
function summarise(functionId: string): string {
  return `${functionId} completed`
}

/** The refusal NAME the function layer publishes, which is what a failed receipt carries. */
function refusalName(error: unknown): string {
  if (error instanceof Error) return error.name === '' ? error.message : error.name
  return String(error)
}

export function createTurnEngine(deps: TurnEngineDeps): TurnEngine {
  return {
    async runTurn(input: AgentAskInput): Promise<AgentAskResult> {
      const opened = await deps.sessionLog.open(input.sessionId)
      const sessionId = opened.header.sessionId
      const turnId = deps.mintTurnId()

      const append = async (event: ChatSessionEvent): Promise<void> => {
        await deps.sessionLog.append(event)
      }
      const finish = async (
        status: ChatTurnStatus,
        result: Omit<AgentAskResult, 'sessionId' | 'turnId' | 'status'>,
      ): Promise<AgentAskResult> => {
        await append({ kind: 'turn_complete', turnId, at: deps.now(), status })
        // The fsync point (D-19). Per TURN, so the loss bound is exactly the in-flight turn —
        // the case the next-turn repair already knows how to handle.
        await deps.sessionLog.turnBoundary()
        return { sessionId, turnId, status, ...result }
      }

      await append({ kind: 'user_message', turnId, at: deps.now(), text: input.message })
      await deps.compaction?.({ turnId })

      // ---- Stage 1: the deterministic resolver over the clause split.
      const clauses = deps.split(input.message)
      const mapped: ResolvedClause[] = []
      const directives: { clause: ChatClause; directive: ChatDirectiveName }[] = []
      for (const clause of clauses) {
        const resolution = resolveClause(deps.table, clause.text)
        if (resolution.kind === 'unresolved') continue
        if (resolution.entry.kind === 'directive') {
          // Resolved, and NOT executable through the function layer: a directive names no
          // capability (D-04/D-21). It is collected rather than dropped, because a clause the
          // table understood and the engine silently ignored is the exact silent-drop shape D-08
          // and D-10 exist to make impossible.
          directives.push({ clause, directive: resolution.entry.directive })
          continue
        }
        mapped.push({
          clause,
          functionId: resolution.entry.functionId,
          args: resolution.entry.input,
        })
      }
      await append({
        kind: 'stage_outcome',
        turnId,
        at: deps.now(),
        stage: 'resolver',
        // Directives count as RESOLVED here, because they were: the table matched them. Whether
        // anything can carry them out is the next question, and answering it in this field would
        // make "stage 1 did not recognise this" and "this build cannot do it" the same bytes.
        outcome:
          mapped.length + directives.length === clauses.length ? 'resolved' : 'unresolved',
      })

      // A directive with no handler bound refuses the whole turn, BEFORE stage 2, with zero
      // executions — D-10's atomicity applied to the one clause class that never reaches stage 4.
      // Plans 04-06 bind the handlers (`/model`'s session override and its `model_change` event,
      // `/pin`'s deny overlay, the REPL's own chrome) and this arm stops being reachable for them
      // one directive at a time; until then the honest answer is a named refusal, not a no-op.
      const firstDirective = directives[0]
      if (firstDirective !== undefined) {
        return finish('fail_closed', {
          receipts: [],
          unhandled: {
            clause: firstDirective.clause.text,
            reason: directiveNotBoundReason(firstDirective.directive, firstDirective.clause.text),
          },
        })
      }

      // ---- Stage 2: the planner, consulted ONLY for what stage 1 could not answer.
      const unmapped = clauses.filter(
        (clause) => !mapped.some((resolved) => resolved.clause.index === clause.index),
      )
      let planned: readonly ResolvedClause[] = []
      if (unmapped.length === 0) {
        // The tracer's path, and a permanent one: a fully canonical utterance is model-independent.
        await append({
          kind: 'stage_outcome',
          turnId,
          at: deps.now(),
          stage: 'planner',
          outcome: 'skipped',
        })
      } else if (deps.planner === undefined) {
        // Headless. Not a stub and not an error — a real host posture whose correct behaviour is
        // to refuse by name rather than to guess (D-08).
        await append({
          kind: 'stage_outcome',
          turnId,
          at: deps.now(),
          stage: 'planner',
          outcome: 'unresolved',
        })
      } else {
        planned = await deps.planner.plan({ utterance: input.message, clauses: unmapped })
        await append({
          kind: 'stage_outcome',
          turnId,
          at: deps.now(),
          stage: 'planner',
          outcome: planned.length === unmapped.length ? 'resolved' : 'unresolved',
        })
      }

      // ---- Stage 3: deterministic reconciliation, BEFORE any side effect (D-10).
      const verdict = deps.reconcile({ clauses, mapped, planned })
      await append({
        kind: 'stage_outcome',
        turnId,
        at: deps.now(),
        stage: 'reconcile',
        outcome: verdict.kind === 'execute' ? 'resolved' : 'unresolved',
      })
      if (verdict.kind === 'unhandled') {
        return finish('fail_closed', {
          receipts: [],
          unhandled: { clause: verdict.clause.text, reason: verdict.reason },
        })
      }

      // ---- Stage 4: sequential execution in utterance order, stopping on failure (D-11).
      const resolverCaller = deps.mint.forStage('resolver')
      const plannerCaller = deps.mint.forStage('planner')
      const receipts: ClauseReceipt[] = []
      let failed = false

      for (const step of verdict.plan) {
        const fromTable = mapped.some((resolved) => resolved.clause.index === step.clause.index)
        const caller = fromTable ? resolverCaller : plannerCaller
        let receipt: ClauseReceipt
        if (failed) {
          // `not-run` is a fact, not an absence: a person reading the receipt must be able to tell
          // a clause nobody attempted from one that was attempted and failed (D-11). It is LOGGED
          // like every other receipt, because "the log is the triage report" (D-18) is false the
          // moment the log carries only the clauses that got as far as a call.
          receipt = {
            clause: step.clause.text,
            functionId: step.functionId,
            origin: caller.origin,
            status: 'not-run',
            outcome: 'an earlier clause failed, so this one was never attempted',
          }
        } else {
          try {
            await deps.invoke(step.functionId, step.args, caller)
            receipt = {
              clause: step.clause.text,
              functionId: step.functionId,
              origin: caller.origin,
              status: 'executed',
              outcome: summarise(step.functionId),
            }
          } catch (error) {
            failed = true
            receipt = {
              clause: step.clause.text,
              functionId: step.functionId,
              origin: caller.origin,
              status: 'failed',
              outcome: refusalName(error),
            }
          }
        }
        receipts.push(receipt)
        await append({
          kind: 'clause_receipt',
          turnId,
          at: deps.now(),
          clause: receipt.clause,
          functionId: receipt.functionId,
          origin: receipt.origin,
          status: receipt.status,
          outcome: receipt.outcome,
        })
      }

      return finish(failed ? 'failed' : 'completed', { receipts })
    },
  }
}

/** The clause shape re-exported for composition roots that build a splitter. */
export type { ChatClause }
