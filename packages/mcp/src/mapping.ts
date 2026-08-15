// The declared tool -> op mapping (Phase 396 plan 01, D-01 / MCPS-02).
//
// WHY THIS FILE EXISTS. The v1 server carried its catalogue as 33 hand-written handlers, each free
// to reach data its own way; the whole point of the re-derivation is that a tool is a PROJECTION of
// a registry op and nothing else. What is left over once the handlers are gone is DATA — which tool
// names exist, which op ids each one stands in front of, and what class of thing it does — and this
// module is where that data lives so a single artifact can be pinned by the bump guard and ranged
// over by 397's parity suite. Anything that is not data belongs in `projection.ts` or `catalog.ts`.
//
// PLAN 01 DECLARES EXACTLY ONE ENTRY. It is the tracer's tool. Plan 04 completes the set (and the
// bump guard that pins it); `DELETION-INVENTORY.md` beside this file already records which v1 tools
// have a registry op behind them and are therefore owed a row here.
//
// Protocol grounding: SEP-2567 removed per-connection list variance, so the tool NAMES a caller can
// see are a property of the caller's grants and of this table — never of a session. SEP-2549 makes
// those listings cacheable, which is the other half of the same reason the table is static data.

import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import {
  ProposalsListInputSchema,
  ProposalsListOutputSchema,
} from '@vostride/agent-qa-schema'

/**
 * What a tool DOES, coarsely — the axis annotations are derived along (`projection.ts`).
 *
 * Three members and not more: a caller (and the host in front of it) needs to tell a read from a
 * mutation, and to tell a mutation that only PROPOSES from the one that commits. `apply` is its own
 * member rather than a flag on `workflow` because it is the class D-11's refuse-and-teach route and
 * MCPS-03's two-call rule attach to, and a class those rules can be forgotten for is a class they
 * will be forgotten for.
 */
export type ToolProjectionKind = 'read' | 'workflow' | 'apply'

/**
 * One declared tool.
 *
 * `ops` is an ARRAY rather than a single id because D-01 is a hybrid: length 1 is a 1:1 projection
 * over an op the registry already states workflow-coarsely, and length > 1 is a FOLD, where the
 * registry is finer than the workflow and several sibling ops arrive through one tool with a
 * discriminated-union input. Making the single case an array of one costs a pair of brackets and
 * buys a mapping whose every consumer — the guard, the parity walk, the visibility union — reads
 * one shape instead of branching on two.
 */
export interface ToolProjection {
  /** Curated `verb_noun` name per spec section 3.3 (D-04). The bump guard pins the exact list. */
  readonly name: string
  /** The registry op ids this tool projects. Length 1 = 1:1; length > 1 = a declared fold. */
  readonly ops: readonly string[]
  readonly kind: ToolProjectionKind
}

/**
 * The live input/output contracts of one projected op.
 *
 * WHY THIS TABLE EXISTS AT ALL, since it looks like a second declaration of something the registry
 * already knows. It is not: `FunctionSpec` — the record holding the LIVE validators — deliberately
 * never leaves the function layer's own directory (T-384-01 / T-384-14), and what a surface can see
 * through `registry.list(caller)` is a `FunctionDeclaration` whose `input`/`output` are already
 * INERT JSON-Schema projections. D-16 mechanic (a) needs the live Standard-Schema objects, so the
 * projection names them here, imported from the ONE module the ops themselves import them from.
 * Drift is therefore impossible in the only sense that matters: this is not a copy of the contract,
 * it is the same object, so the schema advertised in `tools/list` and the schema `invokeFunction`
 * validates with are one thing that cannot disagree.
 *
 * The alternative — `fromJsonSchema(declaration.output)` — was available and rejected: it is a
 * SECOND conversion recipe beside the SDK's own, and the anti-pattern this phase's research names
 * first is exactly two recipes for one conversion.
 *
 * The field type is the SDK's `StandardSchemaWithJSON` and NOT a zod type, which is the same
 * decision seen from the other side: this package's runtime dependency allow-list is exactly the
 * two protocol packages (D-20), so naming a validator library here — even in a type position, which
 * the dependency lint reads no differently — would reopen the collapse the phase exists to make.
 * A zod 4.4 schema satisfies the interface, which is the whole of what either side needs to know.
 */
export interface ToolOpContracts {
  readonly input: StandardSchemaWithJSON
  readonly output: StandardSchemaWithJSON
}

/**
 * Op id -> its live contracts, for every op any declared projection names.
 *
 * Plan 04 grows this table in lockstep with the projections above it; `catalog.ts` refuses to build
 * a tool whose op is missing from it, so the two can never drift apart silently.
 */
export const AGENT_QA_OP_CONTRACTS: Readonly<Record<string, ToolOpContracts>> = Object.freeze({
  'proposals.list': Object.freeze({
    input: ProposalsListInputSchema,
    output: ProposalsListOutputSchema,
  }),
})

/**
 * THE catalogue. One entry at plan 01 — the tracer's — and the set is completed by plan 04.
 *
 * `agent_qa_list_proposals` is the right first tool for a reason beyond convenience: it is a pure
 * `['read']` op with a real store behind it, so the whole path (client -> tools/call -> handler ->
 * `invokeFunction` -> the proposals inbox -> `structuredContent`) is exercised end to end without
 * any write, any confirmation route, or any grant this host has not been given.
 */
export const AGENT_QA_TOOL_PROJECTIONS: readonly ToolProjection[] = Object.freeze([
  Object.freeze({
    name: 'agent_qa_list_proposals',
    ops: Object.freeze(['proposals.list']),
    kind: 'read',
  }),
] as const satisfies readonly ToolProjection[])
