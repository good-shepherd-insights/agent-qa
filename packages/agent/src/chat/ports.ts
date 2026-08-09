// The turn engine's injected seams (Phase 392, D-16 / RESEARCH Pitfall 1).
//
// EVERY SEAT IS DECLARED NOW, including the ones nothing fills yet. The tracer ships one stage-1
// path, but a turn engine whose planner seat, reconciliation seat and compaction seat arrive later
// is a turn engine that gets re-architected three times — and each of those rewrites happens after
// sibling plans have composed against the previous shape. Declaring the seats up front costs a few
// optional members and buys every expansion plan a fill rather than a redesign.
//
// NONE OF THESE IS CONFIG-REACHABLE, and that is load-bearing rather than tidy. D-16's whole point
// is that the reconciliation override — the mechanism that stops a model's plan from beating the
// deterministic mapper's — must be switchable by a DIFFERENTIAL and by nothing else. A config field
// that could turn it off would be a production knob that disables a safety property, which is the
// one thing the mutation proof exists to prove impossible.

import type { FunctionCaller } from '@vostride/agent-qa-schema'

import type { SessionReplay } from './session-repair.js'

/** One piece of an utterance, as the splitter produced it. */
export interface ChatClause {
  /** The clause text exactly as the person typed it — what a refusal has to be able to name. */
  readonly text: string
  readonly index: number
}

/** A clause the deterministic table resolved: which op, and with what arguments. */
export interface ResolvedClause {
  readonly clause: ChatClause
  readonly functionId: string
  readonly args: unknown
}

/**
 * Stage 2 — the tool-bound planner (CHAT-01).
 *
 * OPTIONAL AT THE COMPOSITION, and its absence is a real production posture rather than a stub:
 * a host with no model bound is HEADLESS, and the correct behaviour there is that any clause the
 * table cannot resolve fails the turn closed by name. A stubbed planner that answered "I could not
 * plan that" would say the same words about a completely different fact — that a model was asked
 * and declined — and the two need to stay distinguishable in the log.
 */
export interface PlannerStagePort {
  plan(request: {
    readonly utterance: string
    readonly clauses: readonly ChatClause[]
  }): Promise<readonly ResolvedClause[]>
}

/** What stage 3 is given: what the table proved, and what the model proposed. */
export interface ReconcileInput {
  readonly clauses: readonly ChatClause[]
  readonly mapped: readonly ResolvedClause[]
  readonly planned: readonly ResolvedClause[]
}

/**
 * What stage 3 decides.
 *
 * `unhandled` and `execute` are mutually exclusive by contract rather than by shape, and the
 * asymmetry is D-10: reconciliation completes BEFORE the first side effect, so a verdict naming an
 * unhandled clause carries an empty execution plan and the turn ends with `executed == 0`.
 */
export type ReconcileVerdict =
  | { readonly kind: 'execute'; readonly plan: readonly ResolvedClause[] }
  | { readonly kind: 'unhandled'; readonly clause: ChatClause; readonly reason: string }

/**
 * Stage 3 — deterministic reconciliation (D-09 / D-12 / D-16).
 *
 * A pure function, supplied at engine CONSTRUCTION. The purity is what makes the mutation proof
 * possible at all: the differential composes the real host twice with two strategies and reads the
 * difference off a named scenario, without a single production code path knowing which it got.
 */
export type ReconcileStrategy = (input: ReconcileInput) => ReconcileVerdict

/**
 * The deterministic conjunction splitter (D-09).
 *
 * A seam rather than a hard-coded call because plan 02 replaces the tracer's whole-utterance
 * splitter with the quote-aware tokenizer, and the engine must not need editing for that.
 */
export type ClauseSplitter = (utterance: string) => readonly ChatClause[]

/**
 * Per-stage caller minting (RESEARCH Pitfall 1 / 391 D-06).
 *
 * `FunctionCaller.origin` is a per-CALL fact, not a per-surface one: a person typing a canonical
 * alias IS a human acting, and a model planning a call is not, and both happen inside one turn. A
 * uniform mint would be wrong in one direction or the other — `agent` everywhere kills the
 * deterministic `proposals` alias against every `requiresHumanOrigin` op, `human` everywhere hands
 * the planner the self-grant power 391 D-06 deliberately withholds.
 */
export interface CallerMint {
  forStage(stage: 'resolver' | 'planner'): FunctionCaller
}

/**
 * Stage-4's dispatch binding.
 *
 * A closure over `invokeFunction` supplied by the composition root, NOT a registry handle. Two
 * reasons and the second is the structural one: `agent`'s chat subtree would otherwise import the
 * registry it is registered inside, and — more importantly — a seam typed as "call this op for me"
 * cannot become a seam that runs a spec directly. `evaluate()` is reachable from exactly one place
 * in this repo and chat is not it (384 FUNC-03).
 */
export type ChatInvokeBinding = (
  functionId: string,
  input: unknown,
  caller: FunctionCaller,
) => Promise<unknown>

/**
 * CHAT-04's degrade pass, as a seam the tracer leaves empty.
 *
 * Declared now for the reason every other seat here is: plan 06 fills it over the shipped
 * `TokenAccounting` substrate, and an engine that grew a compaction call later would grow it in the
 * middle of the turn contract this file pins.
 *
 * IT IS HANDED THE REPLAY, AND THAT IS WHAT MAKES CHAT-05'S ORDERING STRUCTURAL. The requirement is
 * that the replay-safety repair runs BEFORE pruning, and a hook that received nothing would have to
 * fetch its own messages — at which point nothing in the type stops it fetching them from an
 * unrepaired source. Receiving an already-repaired replay leaves the degrade pass no other input to
 * prune, so "repair first" is a fact about the argument rather than a rule someone has to remember.
 */
export type CompactionHook = (context: {
  readonly turnId: string
  /** The conversation as of this turn's start: repaired, aborted turns already excluded. */
  readonly replay: SessionReplay
}) => Promise<void> | void
