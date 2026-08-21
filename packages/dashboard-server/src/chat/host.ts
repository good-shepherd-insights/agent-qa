// The injected-host seam the dashboard's chat door dispatches through (Phase 400 plan 01, D-01).
//
// WHY THIS FILE IS A TYPE AND NOTHING ELSE. D-01 puts the composed agent host in THIS PROCESS —
// dashboard-server's — and the shortest reading of that is "dashboard-server calls
// `composeLocalAgent()`". It is also the wrong one. This package has no dependency on `agent`,
// `agent-local` or `safety` and its ownership contract says so by name; acquiring them would mean
// re-assembling the ~3,500 lines of port wiring `composeCliLocalAgent` already owns — the run
// executor, the draft authoring and apply ports, the config editor's four halves, the capability
// catalog, the masked config reader — and the moment that second assembly exists there are two
// answers to "what can a conversation do", which is the exact drift the whole function layer was
// built to abolish (385 D-15, one composition root).
//
// So the host is composed by `agent-qa dashboard` — the CLI command that starts this server, in the
// same process — and handed in. The process is the one D-01 names; the assembly is the one the CLI
// chat door already uses; and this package still names no agent package.
//
// WHAT CROSSES THIS SEAM, AND WHY IT IS SHAPED THIS WAY. Everything below is a function the CALLER
// supplies, not a value this package computes. `invokeFunction` and `foldFunctionResult` are the
// agent package's own exports, bound by the composer; `registry` and `caller` are opaque handles
// this package never inspects; and `agentAskFunctionId` is the agent package's `agent.ask`
// constant, PASSED rather than re-spelled — a string literal here would be a second spelling of an
// op id, free to drift from the one that dispatches.
//
// THE SEAM CARRIES NO CAPABILITY OF ITS OWN. There is no `runTest`, no `listRuns`, no per-capability
// verb: the door reaches every capability through one gated invocation of one registered op, which
// is 397 D-03's rule ("bespoke per-capability handlers stay off the roster") expressed as a type.
// A second method here would be a private power with no roster row.

import type {
  AgentAskInput,
  AgentAskResult,
  ClauseReceiptStatus,
  FunctionCaller,
} from '@vostride/agent-qa-schema'

/**
 * The composed function registry, OPAQUE to this package.
 *
 * Deliberately not structurally described. The registry's real type lives in `agent`, this package
 * may not name it, and a hand-written mirror of its shape here would be a second declaration of
 * somebody else's contract — stale on the day `agent` changes it, and silently so, because nothing
 * would compare the two. What this package does with the value is hand it straight back to the
 * functions below, which is all an opaque handle has to support.
 */
export type AgentRegistryHandle = object

/**
 * One op result's registry fold, as `foldFunctionResult` produces it (399.1 D-04).
 *
 * FOLDS ARE COMPUTED SERVER-SIDE AND SHIPPED BESIDE THE PAYLOAD, because folding needs the registry
 * and the browser has none. They ADD legibility and can never suppress: the complete masked payload
 * travels whole in `results[]` regardless of what a fold says about it.
 */
export interface AgentResultFold {
  readonly verdict: AgentClauseVerdict
  readonly foldLines: readonly string[]
}

/**
 * What one op's classifier fold decided, in the CLOSED vocabulary the schema package publishes.
 *
 * `not-run` is excluded because a fold runs over a result, and a clause that did not run produced
 * none — the same exclusion the agent package's own `ClauseVerdict` makes. Spelled over
 * `ClauseReceiptStatus` rather than as a local union of four words, so a fifth member minted by a
 * later phase reaches this door as a compile error instead of as a status the browser cannot name.
 *
 * THIS IS A STRUCTURAL MIRROR, NOT A SECOND CONTRACT. The agent package owns `ClauseVerdict`; this
 * package may not name it, and the composer that binds `foldFunctionResult` assigns the real one to
 * this type — so a shape change there reds at the composition site rather than drifting quietly.
 */
export interface AgentClauseVerdict {
  readonly status: Exclude<ClauseReceiptStatus, 'not-run'>
  readonly outcome: string
}

/** One capability the door lists, as its declaration names it. */
export interface AgentDeclarationRow {
  readonly id: string
}

/**
 * The whole of what the chat routes may ask of the process that started them.
 *
 * A single object rather than four loose options, because the four members are one decision: they
 * all come from ONE composition, and a server holding an invoke from one host and a registry from
 * another is a state nobody should be able to construct.
 */
export interface AgentHost {
  /** The composed registry every call and every listing goes through. Opaque here. */
  readonly registry: AgentRegistryHandle
  /**
   * The caller this door dispatches as, MINTED by the composition root and never by this package.
   *
   * Attribution and grants both. The composer derives it from the CLI chat door's own mint with
   * only the surface name changed (D-08/Pitfall 9) — a hand-typed scope list here would be the
   * drift vector the parity legs exist to catch, and this package could not type-check one anyway.
   */
  readonly caller: FunctionCaller
  /** The agent package's `agent.ask` id, supplied rather than re-spelled. */
  readonly agentAskFunctionId: string
  /** `invokeFunction`, bound by the composer. THE one door call. */
  invokeFunction(
    registry: AgentRegistryHandle,
    functionId: string,
    input: AgentAskInput,
    caller: FunctionCaller,
  ): Promise<unknown>
  /** `foldFunctionResult`, bound by the composer. */
  foldFunctionResult(
    registry: AgentRegistryHandle,
    functionId: string,
    payload: unknown,
  ): AgentResultFold
  /**
   * `registry.list`, bound by the composer — what this door can reach, as the registry declares it.
   *
   * THE LISTING ROUTE'S ONLY SOURCE, and the reason the door has a listing route at all: a rostered
   * surface has to be able to say what it reaches, PRODUCED by driving the door rather than
   * assembled from a registry the asker could have read itself (397 D-01's produced-enumeration
   * law). The browser needs the same bytes for `/help` and type-ahead.
   */
  listDeclarations(
    registry: AgentRegistryHandle,
    caller: FunctionCaller,
  ): readonly AgentDeclarationRow[]
}

/** One executed clause's result, with the fold that makes it legible. */
export interface ChatTurnFold extends AgentResultFold {
  readonly functionId: string
}

/**
 * What `POST /api/chat/turn` answers with.
 *
 * THE TYPED RESULT TRAVELS WHOLE. `result` is the `agent.ask` output verbatim — status, receipts,
 * results, unhandled — because 399.1 D-05 makes `results[]` the structural channel a render reads,
 * and a door that summarised it would be the second render path DASH-01 forbids. `folds` rides
 * BESIDE it, one entry per executed clause in the same order, never merged into the payload.
 */
export interface ChatTurnResponse {
  readonly result: AgentAskResult
  readonly folds: readonly ChatTurnFold[]
}
