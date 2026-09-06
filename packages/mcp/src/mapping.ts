// The declared tool -> op mapping (Phase 396 plans 01 + 04, D-01 / D-03 / D-04 / D-16 · MCPS-02).
//
// WHY THIS FILE EXISTS. The v1 server carried its catalogue as 33 hand-written handlers, each free
// to reach data its own way; the whole point of the re-derivation is that a tool is a PROJECTION of
// a registry op and nothing else. What is left over once the handlers are gone is DATA — which tool
// names exist, which op ids each one stands in front of, and what class of thing it does — and this
// module is where that data lives so a single artifact can be pinned by the bump guard and ranged
// over by 397's parity suite. Anything that is not data belongs in `projection.ts` or `catalog.ts`.
//
// THE SET IS COMPLETE AS OF PLAN 04. Twelve tools over twenty-two registry ops; the other TWENTY
// ops are listed below in `UNPROJECTED_OPS` with a reason each. Twenty-two plus twenty is the
// registry's own count, and `__tests__/mapping-bump-guard.test.ts` asserts that partition against
// the registry's enumeration rather than against the arithmetic in this sentence.
//
// 2026-08-17 (398 D-09): the unprojected side moved from nineteen to twenty when `agent.explain`
// was registered. This sentence is prose and the guard is the mechanism — but the prose is updated
// in the same change-set anyway, because a header that goes on stating a partition the code stopped
// having is the class of untruth the ops' own docstrings were caught in (397 D-18).
//
// 2026-08-29 (407-01 D-05): the unprojected side grows again, and the registry with it, when
// `runs.knowledge` is registered — so the partition holds with both sides one larger. Unprojected
// DELIBERATELY and on `runs.detail`'s footing: a completed run's whole used-and-learned projection
// is a large one-shot payload, not a mid-flight read. The guard is the mechanism; this sentence is
// updated in the same change-set for the reason the paragraph below states.
//
// 2026-08-25 (403-01 D-03): twenty to twenty-one, and the registry from forty-two to forty-three,
// when `runs.liveurl` was registered. Unprojected DELIBERATELY: minting a live-view capability
// token is handing out a credential, and whether an MCP caller may mint one is Phase 408's
// question (the MCP App embed) rather than a side effect of this phase registering the op.
//
// 2026-08-31 (408 D-01): that question is ANSWERED and the partition does not move for it. The
// ruling is internal mint only — the App-rendering path invokes `runs.liveurl` by reference and
// the token reaches a person only through host-rendered HTML — so the op stays on the
// unprojected side, now by RULING rather than by deferral. Recorded here, at the entry, and at
// the conformance row, because a deferral that quietly becomes a permanent absence is the same
// untruth as a partition the code stopped having.
// 2026-09-01 (408-08, the gap round, road `demote`): the partition still does not move, and the
// em-dashed half above is corrected in the same place it was claimed. "The token reaches a person
// only through host-rendered HTML" is a statement about what the CALLER does with a document it
// asked for, not about this server. What this server does is write the token into exactly one
// place — the frame src of the document the `ui://` read serves — and that door is bounded by the
// `read` scope an operator granted the caller plus a bound mint, never by the caller's own
// capability declaration. The entry's own reason carries the full addendum; `app-resource.ts`'s
// header carries the ruling. The op stays unprojected on the same, stronger footing.
//
// Protocol grounding: SEP-2567 removed per-connection list variance, so the tool NAMES a caller can
// see are a property of the caller's grants and of this table — never of a session. SEP-2549 makes
// those listings cacheable, which is the other half of the same reason the table is static data.

import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import {
  AuthoringDraftEditInputSchema,
  AuthoringDraftEditOutputSchema,
  AuthoringDraftWriteInputSchema,
  AuthoringDraftWriteOutputSchema,
  AuthoringRefineFoldInputSchema,
  AuthoringRefineFoldOutputSchema,
  AuthoringVerifyDraftInputSchema,
  AuthoringVerifyDraftOutputSchema,
  ConfigApplyOutcomeSchema,
  ConfigAuthSetInputSchema,
  ConfigChangeFoldInputSchema,
  ConfigChangeFoldOutputSchema,
  ConfigFieldSetInputSchema,
  ConfigHookAddInputSchema,
  ConfigProjectScaffoldInputSchema,
  ConfigProposalApplyInputSchema,
  ConfigProposeOutputSchema,
  ConfigTargetCreateInputSchema,
  ConfigTargetEditInputSchema,
  ConfigUndoProposeInputSchema,
  EntitiesGetInputSchema,
  EntitiesResolveInputSchema,
  EntityCardResolutionSchema,
  EntityCardSchema,
  KnowledgeAcceptProposeInputSchema,
  KnowledgeApplyOutcomeSchema,
  KnowledgeChangeFoldInputSchema,
  KnowledgeChangeFoldOutputSchema,
  KnowledgeForgetProposeInputSchema,
  KnowledgeProposalApplyInputSchema,
  KnowledgeProposeOutcomeSchema,
  KnowledgeRejectProposeInputSchema,
  ProposalsListInputSchema,
  ProposalsListOutputSchema,
  ProposalsShowInputSchema,
  ProposalsShowOutputSchema,
  RunDigestSchema,
  RunStartAcknowledgementSchema,
  RunsDigestInputSchema,
  RunsListInputSchema,
  RunsListOutputSchema,
  RunsStartInputSchema,
  TOOL_FOLD_DISCRIMINANT,
} from '@vostride/agent-qa-schema'

import { APPLY_TOOL_INPUT_SCHEMA, composeApplyToolOutput } from './apply-refusal.js'

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
 * How a tool's arms compose — DERIVED from the entry, never stated a second time on it.
 *
 * `single` is a 1:1 projection. `union` is D-01's declared fold: several sibling ops behind one
 * discriminated-union input, the arm selected by a literal. `pipeline` is D-02's one read door:
 * two ops invoked in sequence, the first one's answer choosing whether the second runs at all.
 *
 * A third field on the entry would have been a third thing to keep in step with the first two, and
 * the failure it would have hidden is a fold declared `single` — which registers a tool advertising
 * one arm's contract while the guard reports two arms and agrees with itself.
 */
export type ToolComposition = 'single' | 'union' | 'pipeline'

/** One declared tool. */
export interface ToolProjection {
  /** Curated `verb_noun` name per spec section 3.3 (D-04). The bump guard pins the exact list. */
  readonly name: string
  /** The registry op ids this tool projects. Length 1 = 1:1; length > 1 = a declared fold. */
  readonly ops: readonly string[]
  readonly kind: ToolProjectionKind
  /**
   * A union fold's discriminant key — absent on a 1:1 tool AND on the pipeline.
   *
   * Its presence is what tells a fold from a pipeline, which is why it is spelled per entry rather
   * than assumed from `ops.length > 1`.
   */
  readonly discriminant?: string
  /**
   * This tool CARRIES the live-view MCP App (2026-08-31, Phase 408 plan 01 · D-05 / MCPA-01).
   *
   * ITS PRESENCE IS THE SIGNAL, exactly as `discriminant`'s above is. A carrier is a tool whose
   * declaration references the `ui://` App resource, so a host that negotiated the Apps extension
   * can render the run's live view beside the result; a tool without this member references
   * nothing, and `projection.ts` derives an ABSENT `_meta` for it rather than an empty one. Spelled
   * per entry rather than inferred from a name, a kind or an op id, because the census that
   * enumerates carriers reads THIS field — and a predicate over names would be a second, unwritten
   * declaration of which doors reach a credential channel (the 399.1 lesson).
   *
   * `resource` names which `ui://` template the reference points at; one template exists today and
   * the field is spelled anyway, so a second App is an added member here rather than a second
   * meaning for a boolean.
   *
   * `runIdFrom` names where the CONCRETE runId for a per-call reference is found — on the call's
   * input or in the op's own result. `agent_qa_start_run` answers a `RunStartAcknowledgement`
   * carrying the id the run was given, so its reference is derivable only from the OUTPUT;
   * `agent_qa_get_run_digest` is asked about a run by id, so its reference is derivable from the
   * INPUT, which is what makes it the late-attach door (D-07).
   *
   * THE TASK-SHAPE QUESTION D-05 LEFT OPEN IS CLOSED, and closed by measurement rather than by
   * preference: the task seam is dormant — "It registers nothing, advertises nothing and routes
   * nothing" (task-seam.ts:21-23, and catalog.ts:34-36 states the matching absence) — so both
   * carriers are plain tools answering immediate results, and there is no task completion or
   * status poll for a reference to ride. (2026-08-31; the 2.0.0 core SDK has since grown the Tasks
   * vocabulary, which makes the seam's own dated deferral stale at the SDK layer and changes
   * nothing here: registering Tasks is not this phase's job.)
   */
  readonly ui?: {
    readonly resource: 'live-run'
    readonly runIdFrom: 'input' | 'output'
  }
}

/** The composition, read off the entry. See {@link ToolComposition}. */
export function compositionOf(projection: ToolProjection): ToolComposition {
  if (projection.ops.length === 1) return 'single'
  return projection.discriminant === undefined ? 'pipeline' : 'union'
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
 * `catalog.ts` refuses to build a tool whose op is missing from it, so the two tables can never
 * drift apart silently.
 */
export const AGENT_QA_OP_CONTRACTS: Readonly<Record<string, ToolOpContracts>> = Object.freeze({
  'authoring.draft.write': Object.freeze({
    input: AuthoringDraftWriteInputSchema,
    output: AuthoringDraftWriteOutputSchema,
  }),
  'authoring.draft.edit': Object.freeze({
    input: AuthoringDraftEditInputSchema,
    output: AuthoringDraftEditOutputSchema,
  }),
  'authoring.draft.verify': Object.freeze({
    input: AuthoringVerifyDraftInputSchema,
    output: AuthoringVerifyDraftOutputSchema,
  }),
  'runs.start': Object.freeze({
    input: RunsStartInputSchema,
    output: RunStartAcknowledgementSchema,
  }),
  'config.field.set': Object.freeze({
    input: ConfigFieldSetInputSchema,
    output: ConfigProposeOutputSchema,
  }),
  'config.target.create': Object.freeze({
    input: ConfigTargetCreateInputSchema,
    output: ConfigProposeOutputSchema,
  }),
  'config.target.edit': Object.freeze({
    input: ConfigTargetEditInputSchema,
    output: ConfigProposeOutputSchema,
  }),
  'config.auth.set': Object.freeze({
    input: ConfigAuthSetInputSchema,
    output: ConfigProposeOutputSchema,
  }),
  'config.hook.add': Object.freeze({
    input: ConfigHookAddInputSchema,
    output: ConfigProposeOutputSchema,
  }),
  'config.project.scaffold': Object.freeze({
    input: ConfigProjectScaffoldInputSchema,
    output: ConfigProposeOutputSchema,
  }),
  'config.undo.propose': Object.freeze({
    input: ConfigUndoProposeInputSchema,
    output: ConfigProposeOutputSchema,
  }),
  'config.proposal.apply': Object.freeze({
    input: ConfigProposalApplyInputSchema,
    output: ConfigApplyOutcomeSchema,
  }),
  'knowledge.accept.propose': Object.freeze({
    input: KnowledgeAcceptProposeInputSchema,
    output: KnowledgeProposeOutcomeSchema,
  }),
  'knowledge.reject.propose': Object.freeze({
    input: KnowledgeRejectProposeInputSchema,
    output: KnowledgeProposeOutcomeSchema,
  }),
  'knowledge.forget.propose': Object.freeze({
    input: KnowledgeForgetProposeInputSchema,
    output: KnowledgeProposeOutcomeSchema,
  }),
  'knowledge.proposal.apply': Object.freeze({
    input: KnowledgeProposalApplyInputSchema,
    output: KnowledgeApplyOutcomeSchema,
  }),
  'entities.resolve': Object.freeze({
    input: EntitiesResolveInputSchema,
    output: EntityCardResolutionSchema,
  }),
  'entities.get': Object.freeze({
    input: EntitiesGetInputSchema,
    output: EntityCardSchema,
  }),
  'runs.list': Object.freeze({
    input: RunsListInputSchema,
    output: RunsListOutputSchema,
  }),
  'runs.digest': Object.freeze({
    input: RunsDigestInputSchema,
    output: RunDigestSchema,
  }),
  'proposals.list': Object.freeze({
    input: ProposalsListInputSchema,
    output: ProposalsListOutputSchema,
  }),
  'proposals.show': Object.freeze({
    input: ProposalsShowInputSchema,
    output: ProposalsShowOutputSchema,
  }),
})

/**
 * THE CATALOGUE. Twelve tools, and the bump guard pins this exact list by name and by op set.
 *
 * The read side is D-02: one universal entity door plus the three reads a workflow needs mid-flight
 * (runs list, run digest, the proposal inbox). The write side is propose-then-apply and nothing
 * else — every `workflow` entry files a proposal that commits nothing, and the two `apply` entries
 * are the only doors through which anything becomes durable.
 *
 * WHY THERE IS NO `agent_qa_reject_proposal`, which the plan's own table listed. `proposals.reject`
 * declares `requiresHumanOrigin: true`, and `invokeFunction` refuses any caller whose origin is not
 * `human` (invoke.ts, the check immediately after the scope check). This host mints `origin:
 * 'agent'` by construction — 391 D-06's rule is that nobody typed an MCP request — so the tool would
 * have listed for every caller and refused every call: a door that cannot open. That is exactly the
 * property that keeps `proposals.accept` out of this table (RESEARCH Pitfall 7), and it is a
 * property of the OP rather than of one op's name, so it is applied to both. The op moves to
 * `UNPROJECTED_OPS` below and 397 adjudicates whether a human-origin MCP caller can exist at all.
 * The bump guard states the rule generally: no projected op may declare `requiresHumanOrigin`.
 */
export const AGENT_QA_TOOL_PROJECTIONS: readonly ToolProjection[] = Object.freeze([
  Object.freeze({
    name: 'agent_qa_write_test',
    ops: Object.freeze(['authoring.draft.write']),
    kind: 'workflow',
  }),
  Object.freeze({
    name: 'agent_qa_refine_test',
    ops: Object.freeze(['authoring.draft.edit', 'authoring.draft.verify']),
    kind: 'workflow',
    discriminant: TOOL_FOLD_DISCRIMINANT,
  }),
  Object.freeze({
    name: 'agent_qa_start_run',
    ops: Object.freeze(['runs.start']),
    kind: 'workflow',
    // 408 D-05: a run starts and is immediately watchable. The ack carries the runId, so the
    // per-call reference is derived from the OUTPUT.
    ui: Object.freeze({ resource: 'live-run', runIdFrom: 'output' } as const),
  }),
  Object.freeze({
    name: 'agent_qa_propose_config_change',
    ops: Object.freeze([
      'config.field.set',
      'config.target.create',
      'config.target.edit',
      'config.auth.set',
      'config.hook.add',
      'config.project.scaffold',
      'config.undo.propose',
    ]),
    kind: 'workflow',
    discriminant: TOOL_FOLD_DISCRIMINANT,
  }),
  Object.freeze({
    name: 'agent_qa_apply_config_proposal',
    ops: Object.freeze(['config.proposal.apply']),
    kind: 'apply',
  }),
  Object.freeze({
    name: 'agent_qa_propose_knowledge_change',
    ops: Object.freeze([
      'knowledge.accept.propose',
      'knowledge.reject.propose',
      'knowledge.forget.propose',
    ]),
    kind: 'workflow',
    discriminant: TOOL_FOLD_DISCRIMINANT,
  }),
  Object.freeze({
    name: 'agent_qa_apply_proposal',
    ops: Object.freeze(['knowledge.proposal.apply']),
    kind: 'apply',
  }),
  Object.freeze({
    name: 'agent_qa_get_entity',
    ops: Object.freeze(['entities.resolve', 'entities.get']),
    kind: 'read',
  }),
  Object.freeze({
    name: 'agent_qa_list_runs',
    ops: Object.freeze(['runs.list']),
    kind: 'read',
  }),
  Object.freeze({
    name: 'agent_qa_get_run_digest',
    ops: Object.freeze(['runs.digest']),
    kind: 'read',
    // 408 D-05/D-07: the watch/status read, and therefore the LATE-ATTACH door — a run started
    // from the CLI, from CI or from the dashboard is watchable through it exactly as an
    // MCP-started one is, because a viewer attaches and never owns. Its runId is on the INPUT.
    ui: Object.freeze({ resource: 'live-run', runIdFrom: 'input' } as const),
  }),
  Object.freeze({
    name: 'agent_qa_list_proposals',
    ops: Object.freeze(['proposals.list']),
    kind: 'read',
  }),
  Object.freeze({
    name: 'agent_qa_show_proposal',
    ops: Object.freeze(['proposals.show']),
    kind: 'read',
  }),
] as const satisfies readonly ToolProjection[])

/**
 * Tool name -> the contract that tool ADVERTISES, where it is not simply its one op's contract.
 *
 * Exactly three reasons an entry exists here, and no fourth:
 *
 *  1. A UNION FOLD advertises the discriminated union of its arms' own DTOs, composed in
 *     `@vostride/agent-qa-schema` (see `functions/tool-folds.ts` for why it is composed there and
 *     not here). Its output is the union of the arms' own outputs, collapsed when they are one.
 *  2. THE PIPELINE advertises the FIRST op's contract on both sides: a caller hands `entities.resolve`
 *     the reference it has, and reads back the resolution union — a card, a small disambiguation
 *     set, or an honest miss. `entities.get` runs inside the resolved arm and contributes no shape
 *     of its own, which is why its contract is absent from the advertisement.
 *  3. THE APPLY DOORS advertise the wire envelope of D-11 rather than the op's `{ proposalId }`,
 *     because `confirmed` is a fact about a single-round-trip tool call and about no other caller
 *     of the same op. The handler translates the envelope into the op's own contract and
 *     `invokeFunction` parses it there, which keeps the two independent parses this layer relies on.
 *     The OUTPUT is still the op's own contract, untouched.
 */
export const AGENT_QA_COMPOSED_CONTRACTS: Readonly<Record<string, ToolOpContracts>> = Object.freeze({
  agent_qa_refine_test: Object.freeze({
    input: AuthoringRefineFoldInputSchema,
    output: AuthoringRefineFoldOutputSchema,
  }),
  agent_qa_propose_config_change: Object.freeze({
    input: ConfigChangeFoldInputSchema,
    output: ConfigChangeFoldOutputSchema,
  }),
  agent_qa_propose_knowledge_change: Object.freeze({
    input: KnowledgeChangeFoldInputSchema,
    output: KnowledgeChangeFoldOutputSchema,
  }),
  agent_qa_get_entity: Object.freeze({
    input: EntitiesResolveInputSchema,
    output: EntityCardResolutionSchema,
  }),
  // The apply doors advertise the op's outcome OR the D-11 refusal, on both sides of the call, for
  // one reason (396-06): `confirmed` and "nothing was applied, here is the call that would" are
  // both facts about a single-round-trip tool call and about no other caller of the same op. The
  // union is composed from the op's OWN converted document, so the receipt arm is the op's contract
  // rather than a copy of it.
  agent_qa_apply_proposal: Object.freeze({
    input: APPLY_TOOL_INPUT_SCHEMA,
    output: composeApplyToolOutput(KnowledgeApplyOutcomeSchema),
  }),
  agent_qa_apply_config_proposal: Object.freeze({
    input: APPLY_TOOL_INPUT_SCHEMA,
    output: composeApplyToolOutput(ConfigApplyOutcomeSchema),
  }),
})

/** The contract a tool advertises: its composition when it has one, its one op's otherwise. */
export function advertisedContracts(
  projection: ToolProjection,
): ToolOpContracts | undefined {
  const composed = AGENT_QA_COMPOSED_CONTRACTS[projection.name]
  if (composed !== undefined) return composed
  const [only] = projection.ops
  return only === undefined ? undefined : AGENT_QA_OP_CONTRACTS[only]
}

/**
 * A tool whose advertised OUTPUT cannot be represented as JSON Schema, and therefore ships with no
 * `outputSchema` at all (2026-08-16, D-16's explicit-degradation clause).
 *
 * MEASURED, NOT PREDICTED. `tools/list` converts every `outputSchema` in zod's OUTPUT mode
 * (`mcp-DXXb3Vv3.mjs:1391`, uncaught), and a contract built over a branded id — `z.string()
 * .transform(asRunId)` — makes that conversion throw `Transforms cannot be represented in JSON
 * Schema`. The consequence is not a poorer listing for one tool: the throw takes the WHOLE
 * `tools/list` response down for every caller who can see the tool. Phase 384 hit the same wall from
 * the other side and answered it by projecting both sides in input mode (`declaration-projection.ts`).
 *
 * WHY OMISSION RATHER THAN A SECOND CONVERSION. Advertising the INPUT-mode document as the output
 * would have worked and been a lie of exactly the kind D-16 forbids: a schema derived by a second
 * recipe, no longer the object `invokeFunction` validates with, presented as though it were. What a
 * caller gets instead is `content` plus `structuredContent` and no advertised shape — less, and
 * true. `validateToolOutput` skips a tool with no `outputSchema`, so the result still flows.
 *
 * THE LIST IS TWO-SIDED. `projection.ts` PROBES the conversion for every tool: an undeclared
 * failure throws, and a declared entry whose contract has since become convertible throws too. So
 * this list cannot silently grow and cannot silently rot.
 */
export interface OutputSchemaDegradation {
  readonly tool: string
  readonly opId: string
  /** The schema symbol whose transform the converter refused, for a reader chasing the cause. */
  readonly schema: string
  /** The converter's own message, verbatim as measured on 2026-08-16. */
  readonly measured: string
  readonly adjudication: '397'
}

export const DEGRADED_OUTPUT_CONTRACTS: readonly OutputSchemaDegradation[] = Object.freeze([
  // 397 DISPOSITION (2026-08-16 · D-20): keep-degraded. `agent_qa_start_run` advertises no
  // `outputSchema` and keeps it that way. The cause is a property of the CONTRACT, not of this
  // surface — a branded run id is `z.string().transform(asRunId)`, and the converter refuses a
  // transform because there is no true JSON-Schema for "and then this function runs". The two ways
  // out are both worse: advertising the input-mode document is the second-recipe lie D-16 forbids,
  // and un-branding the id to please a converter would spend a type-safety property of the whole
  // codebase on one surface's listing. 397 rules the degradation ADJUDICATED and CLOSED rather than
  // pending; re-opening it means changing the contract, which is a golden-diff-visible act. The
  // absence itself is not re-pinned here — `projection.ts` probes the conversion both ways and the
  // shipped projection suite owns that fact (RESEARCH Pitfall 9); the conformance suite asserts
  // only the join.
  Object.freeze({
    tool: 'agent_qa_start_run',
    opId: 'runs.start',
    schema: 'RunStartAcknowledgementSchema',
    measured: 'Transforms cannot be represented in JSON Schema',
    adjudication: '397',
  }),
  // 397 DISPOSITION (2026-08-16 · D-20): keep-degraded, on the row above's reasoning and not by
  // appeal to it. `agent_qa_list_runs` degrades one level down — the transform sits inside
  // `RunSummarySchema`, an element of the array this op returns — so a caller loses the shape of a
  // LIST rather than of a single acknowledgement. That is the more tempting one to paper over with
  // a hand-written array schema, and the same objection answers it: a shape derived by a second
  // recipe is no longer the object `invokeFunction` validates, and advertising it would make this
  // tool the one place a client could be told something the gate does not enforce.
  Object.freeze({
    tool: 'agent_qa_list_runs',
    opId: 'runs.list',
    schema: 'RunsListOutputSchema (over RunSummarySchema)',
    measured: 'Transforms cannot be represented in JSON Schema',
    adjudication: '397',
  }),
] as const satisfies readonly OutputSchemaDegradation[])

/**
 * A registry op that this surface deliberately does NOT project, and why (2026-08-16 · D-03/D-15).
 *
 * THE DATED SCOPING NOTE IS THIS TABLE, not a comment beside it. 397's parity suite ranges over the
 * projected set, and a suite that scoped itself to whatever happened to be in the mapping would be
 * discovering an accident rather than honouring a decision. Every op the registry declares appears
 * either above or here — the bump guard asserts that partition against the registry's own
 * enumeration, so a new op cannot land undispositioned.
 *
 * `agent.ask` LEADS THE LIST because its exclusion is the one with a decision behind it (D-03).
 * Projecting the agent's own turn entry over MCP is nested-agent delegation: a caller's tool call
 * would spend this project's model tokens, take the lease the local host holds, and stream through a
 * channel a single `tools/call` round trip has no shape for — four independent reasons, and no MCPS
 * requirement asking for any of them. It is deferred as its own seam rather than left out by
 * oversight, and the deferral is dated so a later reader can tell the two apart.
 *
 * The rest are D-02's line — this surface carries the reads a workflow needs MID-FLIGHT and not the
 * whole catalogue — and the two ops that cannot serve an agent-origin caller at all.
 */
export interface UnprojectedOp {
  readonly opId: string
  readonly reason: string
  /**
   * Who decided this absence is not a gap.
   *
   * 397 for every op that existed when 397's parity walk ruled the whole register (D-15). WIDENED
   * to admit `'398'` on 2026-08-17 for `agent.explain`, and the widening is the honest move rather
   * than a convenience: 397 could not have adjudicated an op that did not exist, and stamping this
   * one `'397'` to keep a literal green would have made the field record a ruling nobody made — the
   * one thing a provenance column is for. The vocabulary is a CLOSED set and the bump guard pins
   * which entries carry which adjudicator by name, so it cannot widen again by habit.
   *
   * 405-05 adds `runs.artifact` under the SAME `'405'` stamp on the same day and by the same
   * ruling; the vocabulary does not widen for it.
   *
   * WIDENED AGAIN on 2026-08-27 (405-01, D-03) for `runs.detail`, on exactly the 398 and 403
   * reasoning and for no new one: 397 could not have ruled on an op registered eight phases
   * later. The bump guard names which entry carries this adjudicator, in both directions, so an
   * entry stamped `'405'` because it was easier reds there rather than joining a set that has
   * quietly become "any phase number".
   *
   * WIDENED AGAIN on 2026-08-29 (407-01, D-05) for `runs.knowledge`, on exactly that reasoning and
   * for no new one: 397 could not have ruled on an op registered ten phases later. Membership is
   * still spelled by op id in the bump guard, in both directions.
   *
   * RE-STAMPED on 2026-08-31 (408 D-01): `'403'` LEAVES this vocabulary and `'408'` enters. This is
   * not a widening and not a rename — it is the provenance moving with the ruling. `runs.liveurl`
   * was the ONLY `'403'` entry, and its 403 stamp recorded a DEFERRAL ("Phase 408's question");
   * 408 D-01 answered that question, so the phase that decided this absence is now 408 and saying
   * `'403'` would credit 403 with a ruling it explicitly declined to make. Leaving `'403'` in a
   * closed set with no member would also be exactly the empty literal the bump guard's
   * non-vacuity check passes silently over, which is the hole that check exists to close.
   */
  readonly adjudication: '397' | '398' | '405' | '407' | '408'
}

export const UNPROJECTED_OPS: readonly UnprojectedOp[] = Object.freeze([
  Object.freeze({
    opId: 'agent.ask',
    reason:
      'D-03 (dated 2026-08-15): ask-over-MCP is nested-agent delegation — trust, token-driven LLM '
      + 'spend, lease interaction and streaming are four separate problems and no MCPS requirement '
      + 'asks for any of them. Deferred as its own seam, not omitted by oversight.',
    adjudication: '397',
  }),
  Object.freeze({
    opId: 'proposals.accept',
    reason:
      'declares requiresHumanOrigin, and this host mints origin: agent (391 D-06), so the tool '
      + 'would refuse every call it ever received. The commit door for this surface is the gated '
      + 'apply instead (D-11; RESEARCH Pitfall 7).',
    adjudication: '397',
  }),
  Object.freeze({
    opId: 'proposals.reject',
    reason:
      'declares requiresHumanOrigin for the same reason proposals.accept does — an agent that '
      + 'could decline proposals could curate the inbox a human checks — so it is a door that '
      + 'cannot open on this surface. Measured 2026-08-16 (396-04), not planned.',
    adjudication: '397',
  }),
  Object.freeze({
    opId: 'grants.revoke',
    reason:
      'declares requiresHumanOrigin: withdrawing a standing approval is not the agent\'s decision '
      + 'to make. Not a mid-flight workflow write per D-02.',
    adjudication: '397',
  }),
  Object.freeze({
    opId: 'grants.list',
    reason: 'not a mid-flight workflow read per D-02; 397 adjudicates',
    adjudication: '397',
  }),
  Object.freeze({
    opId: 'runs.get',
    reason:
      'not a mid-flight workflow read per D-02 — the entity door renders a run\'s card and the '
      + 'digest carries what triage needs; 397 adjudicates',
    adjudication: '397',
  }),
  Object.freeze({
    opId: 'runs.events',
    reason:
      'not a mid-flight workflow read per D-02, and a stream op besides: a `tools/call` is one '
      + 'round trip and has no shape for a resumable event feed; 397 adjudicates',
    adjudication: '397',
  }),
  Object.freeze({
    opId: 'runs.postprocessing',
    reason: 'not a mid-flight workflow read per D-02; 397 adjudicates',
    adjudication: '397',
  }),
  Object.freeze({
    opId: 'runs.artifact',
    reason:
      'D-12/D-13 (dated 2026-08-27, 405-05): not a mid-flight workflow read per D-02 — this '
      + 'resolves ONE completed run\'s content-addressed evidence blob, and its result is a '
      + 'base64 body. A `tools/call` round trip is the wrong carriage for bytes: a conversation '
      + 'cannot render a PNG, and a tool that returned one would spend a context window on a '
      + 'payload no reader can read. The two HTTP doors are its carriage, and 408\'s embed is the '
      + 'surface that renders it. Deferred as its own seam, not omitted.',
    adjudication: '405',
  }),
  Object.freeze({
    opId: 'runs.detail',
    reason:
      'D-03 (dated 2026-08-27, 405-01): not a mid-flight workflow read per D-02 — this is a '
      + 'COMPLETED run\'s projected step tree, read by the durable run-detail page, and the '
      + 'entity door already renders a run\'s card while the digest carries what triage needs. '
      + 'The whole projection of a run is also a large one-shot payload with no shape a '
      + '`tools/call` round trip wants. Deferred as its own seam, not omitted.',
    adjudication: '405',
  }),
  Object.freeze({
    opId: 'runs.knowledge',
    reason:
      'D-05 (dated 2026-08-29, 407-01): not a mid-flight workflow read per D-02 — this is a '
      + "COMPLETED run's used-and-learned projection, read by the durable Knowledge tab, and it is "
      + 'unprojected on exactly the footing its sibling `runs.detail` is. It carries every step\'s '
      + "three served brief channels, each one's serve-time retrieval trace and the truncated "
      + 'candidate ledger beside it, so it is a large one-shot payload with no shape a '
      + '`tools/call` round trip wants — larger than the step tree, not smaller. A planner '
      + 'mid-flight also has no use for what a FINISHED run was briefed with; the entity door '
      + "already renders a record's card and the digest carries what triage needs. Deferred as its "
      + 'own seam, not omitted.',
    adjudication: '407',
  }),
  Object.freeze({
    opId: 'runs.liveurl',
    reason:
      'D-03 (dated 2026-08-25, 403-01): the op MINTS A CREDENTIAL — a short-lived, view-scoped '
      + 'capability token for a running browser. Whether an agent-origin MCP caller may mint one, '
      + 'and what it may hand it to, is Phase 408\'s question (the MCP App embed); projecting it '
      + 'here would answer that question by accident. Deferred as its own seam, not omitted. '
      + 'ANSWERED (dated 2026-08-31, 408 D-01): the deferral above is discharged, and the ruling '
      + 'is INTERNAL MINT ONLY. The MCP server invokes this op BY REFERENCE, inside its '
      + 'App-rendering path and nowhere else, and the minted token lands only in the '
      + 'host-rendered HTML of the unlisted `ui://agent-qa/live-run/{runId}` App resource — '
      + 'never in tool-result text a model reads. Projecting a mint tool stays REJECTED: a live '
      + 'credential in model context is the T-395-R5-10 shape, and masking it would leave a tool '
      + 'that hands back nothing a host could use. The op therefore STAYS unprojected BY RULING '
      + 'rather than by deferral — answered on the record, never silently reclassified. '
      + 'RE-GROUNDED (dated 2026-09-01, 408 gap round, road `demote`; the full ruling is in '
      + "`app-resource.ts`'s header). The answer above STANDS and one half of its stated property "
      + 'is corrected rather than deleted. Whether the document this server serves is '
      + 'host-rendered HTML or text a model consumes is a property of the CALLER, not of this '
      + 'server, so the "never in tool-result text a model reads" half over-claimed. What this '
      + 'server guarantees is narrower and it is verifiable: it writes the token into exactly one '
      + 'place, the frame src of the document the `ui://` read serves, and that door is reachable '
      + 'by any caller an operator granted the `read` scope (`visibleToCaller` over the '
      + "registry's own declared scopes, plus a bound mint). The op STAYS unprojected on exactly "
      + 'the same footing, and the reason is unchanged and STRONGER rather than weaker: a '
      + 'projected mint tool would put the credential on a channel a model consumes BY DEFAULT, '
      + 'on every call, for every caller, whereas the `ui://` read is an unlisted address a '
      + 'caller must already know and deliberately ask for.',
    adjudication: '408',
  }),
  Object.freeze({
    opId: 'config.get',
    reason: 'not a mid-flight workflow read per D-02; 397 adjudicates',
    adjudication: '397',
  }),
  Object.freeze({
    opId: 'analysis.get',
    reason: 'not a mid-flight workflow read per D-02; 397 adjudicates',
    adjudication: '397',
  }),
  Object.freeze({
    opId: 'authoring.funnel.get',
    reason: 'not a mid-flight workflow read per D-02; 397 adjudicates',
    adjudication: '397',
  }),
  Object.freeze({
    opId: 'quarantine.add',
    reason: 'not a mid-flight workflow write per D-02; 397 adjudicates',
    adjudication: '397',
  }),
  Object.freeze({
    opId: 'quarantine.release',
    reason: 'not a mid-flight workflow write per D-02; 397 adjudicates',
    adjudication: '397',
  }),
  Object.freeze({
    opId: 'quarantine.list',
    reason: 'not a mid-flight workflow read per D-02; 397 adjudicates',
    adjudication: '397',
  }),
  Object.freeze({
    opId: 'knowledge.brief.why',
    reason: 'not a mid-flight workflow read per D-02; 397 adjudicates',
    adjudication: '397',
  }),
  Object.freeze({
    opId: 'knowledge.bundles.list',
    reason: 'not a mid-flight workflow read per D-02; 397 adjudicates',
    adjudication: '397',
  }),
  Object.freeze({
    opId: 'knowledge.gates.list',
    reason: 'not a mid-flight workflow read per D-02; 397 adjudicates',
    adjudication: '397',
  }),
  Object.freeze({
    opId: 'knowledge.record.show',
    reason: 'not a mid-flight workflow read per D-02; 397 adjudicates',
    adjudication: '397',
  }),
  Object.freeze({
    opId: 'knowledge.records.diff',
    reason: 'not a mid-flight workflow read per D-02; 397 adjudicates',
    adjudication: '397',
  }),
  Object.freeze({
    opId: 'knowledge.records.inspect',
    reason: 'not a mid-flight workflow read per D-02; 397 adjudicates',
    adjudication: '397',
  }),
  // 398 D-09 (dated 2026-08-17): the twentieth entry, and the FIRST op ever dispositioned here that
  // 397 did not rule on — because it did not exist then. Its exclusion is argued rather than scoped,
  // which is why it does not take the mid-flight line: `agent.explain` answers "what can you do",
  // and DELETION-INVENTORY row 1 already ruled that question NOT a gap on this surface, because the
  // protocol answers machine discovery itself. Projecting it anyway would be the third answer that
  // row refuses.
  Object.freeze({
    opId: 'agent.explain',
    reason:
      'D-09 (dated 2026-08-17): the protocol answers machine discovery itself — `tools/list` plus '
      + 'SEP-2575 `server/discover` — and 398\'s `init --agent` manifest answers agent discovery '
      + 'from the committed catalog. This op answers a PERSON asking in prose, which is a third '
      + 'question with a third audience. DELETION-INVENTORY row 1 ruled a discovery TOOL not-a-gap '
      + 'on exactly this reasoning; projecting the op would reinstate it under a new name.',
    adjudication: '398',
  }),
] as const satisfies readonly UnprojectedOp[])
