// The scenario table — the parity suite's ONE denominator (Phase 397 plan 03, D-09 / D-10 / D-12).
//
// THE CLAIM THIS FILE MAKES POSSIBLE. A capability exists iff it is one row: in the registry, and
// here. Census equality between `registry.ids()` and this table's keys is asserted set-equal in BOTH
// directions by `parity.test.ts`, so a capability landing without a row is a named RED on every PR
// (D-15: that leg, running in the workspace `turbo run test` job, IS SC-4's CI rule — there is no
// second diff-parsing mechanism on purpose).
//
// WHY TYPESCRIPT AND NOT YAML (D-09). Each row's `input` is typed against THAT op's own input
// contract — the very schema object the op's spec validates with, imported from the schema package
// exactly as `mapping.ts` imports it. A row whose input is the wrong shape for its op fails `tsc`,
// which is a thing no YAML corpus can do. The chat scenario corpus (`scenarios/<class>/<id>.yml`)
// keeps its own, different job (utterance routing); typed invocations stay here.
//
// SEEDED FROM 384's INVOCATION SAMPLES, WITH THEIR REASONING (D-10). Every `input` below arrived
// from `packages/agent/src/__tests__/parity-coverage.test.ts`'s `INVOCATION_SAMPLES`, and the
// per-op arguments for WHY each sample looks the way it does travelled with it — most of them turn
// on the same fact, that `invokeFunction` validates input BEFORE it consults binding, so a sample
// that failed its contract would make an unbound-refusal leg report an input error and certify
// nothing about binding.
//
// TRANSITION NOTE, 2026-08-16 (D-10). `parity-coverage.test.ts` is NOT deleted by this plan. It
// retires in plan 397-08, which owns the destination register for the assertions it still carries
// (the binding-status pin, the id-taxonomy sweep, the contract-projection relation). Until then both
// files exist and this table is the successor denominator: the census leg here is what a new
// capability reds against. Two registers over one universe is the divergence D-10 exists to close,
// so the overlap is dated and time-boxed rather than permanent.
//
// NOTHING HERE IS A SECOND CATALOGUE OF SCHEMAS. `OP_INPUT_CONTRACTS` names the same schema OBJECTS
// the ops themselves validate with — not copies — and `parity.test.ts` proves the pairing two ways:
// by object identity against `AGENT_QA_OP_CONTRACTS` for the 22 ops the MCP surface publishes a
// handle for, and, for all 41, by comparing each paired schema's projection to the projection the
// registry itself published on the declaration.

import {
  AgentAskInputSchema,
  AnalysisGetInputSchema,
  AuthoringDraftEditInputSchema,
  AuthoringDraftWriteInputSchema,
  AuthoringFunnelGetInputSchema,
  AuthoringVerifyDraftInputSchema,
  BriefWhyInputSchema,
  ConfigAuthSetInputSchema,
  ConfigFieldSetInputSchema,
  ConfigGetInputSchema,
  ConfigHookAddInputSchema,
  ConfigProjectScaffoldInputSchema,
  ConfigProposalApplyInputSchema,
  ConfigTargetCreateInputSchema,
  ConfigTargetEditInputSchema,
  ConfigUndoProposeInputSchema,
  EntitiesGetInputSchema,
  EntitiesResolveInputSchema,
  ExplainInputSchema,
  GrantsListInputSchema,
  GrantsRevokeInputSchema,
  KnowledgeAcceptProposeInputSchema,
  KnowledgeBundlesListInputSchema,
  KnowledgeForgetProposeInputSchema,
  KnowledgeProposalApplyInputSchema,
  KnowledgeRecordShowInputSchema,
  KnowledgeRecordsDiffInputSchema,
  KnowledgeRecordsInspectInputSchema,
  KnowledgeRejectProposeInputSchema,
  ProposalsAcceptInputSchema,
  ProposalsListInputSchema,
  ProposalsRejectInputSchema,
  ProposalsShowInputSchema,
  QuarantineAddInputSchema,
  QuarantineListInputSchema,
  QuarantineReleaseInputSchema,
  RunsDigestInputSchema,
  RunsEventsInputSchema,
  RunsGetInputSchema,
  RunsListInputSchema,
  RunsPostProcessingInputSchema,
  RunsStartInputSchema,
} from '@vostride/agent-qa-schema'
import type { z } from 'zod'

/**
 * Each op's LIVE input contract, keyed by op id.
 *
 * THE SAME OBJECTS, NOT COPIES. Every value here is the exact schema singleton the op's spec passes
 * to `FunctionSpec.input`, imported from the one module the ops import it from — the identical move
 * `mapping.ts` makes for the 22 ops it projects, and for the identical reason: a re-derived contract
 * is a second contract, free to disagree with the one dispatch enforces, and the disagreement would
 * be invisible because nothing would compare the two.
 *
 * It is a GROWTH SEAM in the `INVOCATION_SAMPLES` / `CONTRACTS_BY_ID` tradition: `parity.test.ts`
 * asserts its keys set-equal to the registry census in both directions, so a capability cannot land
 * without someone stating the contract its scenario is typed against.
 */
export const OP_INPUT_CONTRACTS = {
  'agent.ask': AgentAskInputSchema,
  'agent.explain': ExplainInputSchema,
  'analysis.get': AnalysisGetInputSchema,
  'authoring.draft.edit': AuthoringDraftEditInputSchema,
  'authoring.draft.verify': AuthoringVerifyDraftInputSchema,
  'authoring.draft.write': AuthoringDraftWriteInputSchema,
  'authoring.funnel.get': AuthoringFunnelGetInputSchema,
  'config.auth.set': ConfigAuthSetInputSchema,
  'config.field.set': ConfigFieldSetInputSchema,
  'config.get': ConfigGetInputSchema,
  'config.hook.add': ConfigHookAddInputSchema,
  'config.project.scaffold': ConfigProjectScaffoldInputSchema,
  'config.proposal.apply': ConfigProposalApplyInputSchema,
  'config.target.create': ConfigTargetCreateInputSchema,
  'config.target.edit': ConfigTargetEditInputSchema,
  'config.undo.propose': ConfigUndoProposeInputSchema,
  'entities.get': EntitiesGetInputSchema,
  'entities.resolve': EntitiesResolveInputSchema,
  'grants.list': GrantsListInputSchema,
  'grants.revoke': GrantsRevokeInputSchema,
  'knowledge.accept.propose': KnowledgeAcceptProposeInputSchema,
  'knowledge.brief.why': BriefWhyInputSchema,
  'knowledge.bundles.list': KnowledgeBundlesListInputSchema,
  'knowledge.forget.propose': KnowledgeForgetProposeInputSchema,
  'knowledge.proposal.apply': KnowledgeProposalApplyInputSchema,
  'knowledge.record.show': KnowledgeRecordShowInputSchema,
  'knowledge.records.diff': KnowledgeRecordsDiffInputSchema,
  'knowledge.records.inspect': KnowledgeRecordsInspectInputSchema,
  'knowledge.reject.propose': KnowledgeRejectProposeInputSchema,
  'proposals.accept': ProposalsAcceptInputSchema,
  'proposals.list': ProposalsListInputSchema,
  'proposals.reject': ProposalsRejectInputSchema,
  'proposals.show': ProposalsShowInputSchema,
  'quarantine.add': QuarantineAddInputSchema,
  'quarantine.list': QuarantineListInputSchema,
  'quarantine.release': QuarantineReleaseInputSchema,
  'runs.digest': RunsDigestInputSchema,
  'runs.events': RunsEventsInputSchema,
  'runs.get': RunsGetInputSchema,
  'runs.list': RunsListInputSchema,
  'runs.postprocessing': RunsPostProcessingInputSchema,
  'runs.start': RunsStartInputSchema,
} as const

/** Every op id the table knows how to type — the compile-time half of the census. */
export type ScenarioOpId = keyof typeof OP_INPUT_CONTRACTS

/** The wire shape a caller SENDS for one op — `z.input`, matching the projection's `io: 'input'`. */
export type ScenarioInput<Id extends ScenarioOpId> = z.input<(typeof OP_INPUT_CONTRACTS)[Id]>

// ---- The MCP partition, as row data joined to `mapping.ts` both ways (D-12) ---------------------

/**
 * The reason CLASSES an op can be unprojected under, as a closed vocabulary.
 *
 * WHY A KEY AND NOT THE PROSE. `UNPROJECTED_OPS` carries a paragraph per op — the right artifact for
 * a person reading the mapping, and the wrong one for a row to restate, because a restatement drifts
 * silently. The row cites the CLASS instead, and `parity.test.ts` derives the class from the shipped
 * prose and asserts the two agree. That is what makes D-03's `agent.ask` scoping note machine-checked
 * data rather than a comment: if someone rewrote that op's reason into an ordinary
 * "not a mid-flight read", the row's key would no longer be the derived key and the suite names it.
 */
export type UnprojectedReasonKey =
  | 'agent-ask-delegation-deferral'
  | 'requires-human-origin'
  // 2026-08-17 (398 D-09). The FOURTH class, and it is admitted rather than folded because the
  // vocabulary's whole job is to keep genuinely different facts apart. `agent.explain` is not
  // scoped out of a workflow and is not a door that cannot open — the question it answers is one
  // the PROTOCOL already answers for machines, which DELETION-INVENTORY row 1 ruled not-a-gap on
  // exactly that ground. Filing it under `not-mid-flight-read` would have been the available
  // shortcut and would have recorded a scoping decision where an argued one was made.
  | 'discovery-answered-by-protocol'
  | 'not-mid-flight-write'
  | 'not-mid-flight-read'

/**
 * The signature phrase each class is recognised by, in PRECEDENCE ORDER (highest first).
 *
 * Ordered rather than exclusive because the shipped reasons genuinely overlap: `grants.revoke` names
 * both `requiresHumanOrigin` and the mid-flight line, and the honest class is the stronger one — a
 * door that CANNOT open on this surface is a different fact from a door that was scoped out of it.
 * A first-match rule over a declared order makes that a decision recorded once rather than a
 * judgement call repeated per row.
 */
export const UNPROJECTED_REASON_SIGNATURES: readonly (readonly [UnprojectedReasonKey, string])[] =
  Object.freeze([
    Object.freeze(['agent-ask-delegation-deferral', 'nested-agent delegation'] as const),
    Object.freeze(['requires-human-origin', 'requiresHumanOrigin'] as const),
    // 398 D-09. Placed ABOVE the two mid-flight lines because its reason is the stronger fact, on
    // the precedence rule this list already states: a question the protocol answers is a different
    // thing from a read that was scoped out of a workflow, and the shipped prose for
    // `agent.explain` deliberately contains neither mid-flight phrase.
    Object.freeze(['discovery-answered-by-protocol', 'answers machine discovery'] as const),
    Object.freeze(['not-mid-flight-write', 'mid-flight workflow write'] as const),
    Object.freeze(['not-mid-flight-read', 'mid-flight workflow read'] as const),
  ])

/**
 * The class a shipped `UNPROJECTED_OPS` reason falls into, or `undefined` if it falls into none.
 *
 * PURE AND TOTAL, so `parity.test.ts` can drive it with synthetic prose in a control cell. The
 * `undefined` branch is not a defensive nicety: a new unprojected op written with a reason outside
 * this vocabulary must RED rather than be silently filed under whichever class happened to be last,
 * because "we scoped this out" and "this can never work here" are the two answers a reader needs to
 * be able to tell apart.
 */
export function unprojectedReasonKeyOf(reason: string): UnprojectedReasonKey | undefined {
  for (const [key, signature] of UNPROJECTED_REASON_SIGNATURES) {
    if (reason.includes(signature)) return key
  }
  return undefined
}

/** What one row claims about the MCP surface: a door, or a dated decision not to have one. */
export type McpSurfaceExpectation =
  | { readonly reachable: { readonly tool: string } }
  | { readonly unprojected: UnprojectedReasonKey }

/**
 * What one row claims about the chat surface.
 *
 * `reachable` is a BOOLEAN rather than the literal `true` every row carries today, and the width is
 * deliberate: the field's job is to be joined against the live chat enumeration in both directions,
 * and a type that could only say `true` would make one of those directions unsayable. All 41 rows
 * say `true` because the planner binds the listing 1:1 (392 D-07/D-08) and the deterministic
 * resolver adds no capability the planner lacks — which is a MEASURED fact about the shipped
 * composition, asserted by `parity.test.ts`, not a property of this type.
 */
export interface ChatSurfaceExpectation {
  readonly reachable: boolean
}

/**
 * The policy points every row declares (D-11), as expected VERDICTS.
 *
 * The callers themselves are not spelled here and must not be: `policy-fixtures.ts` derives the
 * covering caller from the op's own `requiredScopes` and the refusing caller by withholding one of
 * them, so a scope widening changes the fixtures without anyone editing 41 rows — and, more to the
 * point, a row that spelled its own scopes would be a second copy of the declaration's scope list,
 * free to fall behind it.
 *
 * `ask` is present on exactly the ops the shipped classifier can produce an `ask` verdict for, and
 * that set is DERIVED (`policy-fixtures.ts`) and asserted set-equal to the rows carrying the key in
 * both directions. Hand-picking it was the available shortcut and is exactly what D-11's discretion
 * clause forbids.
 */
export interface PolicyPointExpectations {
  readonly grant: 'allow'
  readonly refuse: 'deny'
  readonly ask?: 'ask'
}

/** One capability, as the suite drives it. */
export interface ScenarioRow<Id extends ScenarioOpId = ScenarioOpId> {
  readonly opId: Id
  /** A valid invocation fixture, typed against THIS op's contract at compile time (D-09). */
  readonly input: ScenarioInput<Id>
  readonly perSurface: {
    readonly chat: ChatSurfaceExpectation
    readonly mcp: McpSurfaceExpectation
  }
  readonly policyPoints: PolicyPointExpectations
}

/**
 * The identity function that makes a row's `input` check against its OWN op's contract.
 *
 * Without it the table would be an array of a union type and TypeScript would accept any member's
 * input for any member's id — which is the whole compile-time guarantee D-09 chose TypeScript for.
 * The generic binds `Id` from the `opId` literal and `ScenarioInput<Id>` then resolves to one
 * schema, so `{ opId: 'runs.get', input: {} }` is a compile error rather than a runtime surprise.
 */
function scenario<Id extends ScenarioOpId>(row: ScenarioRow<Id>): ScenarioRow<Id> {
  return Object.freeze(row)
}

const FIXTURE_RUN_ID = 'run-alpha'
const FIXTURE_ENTITY_SHORT_ID = 'MEM-001'

/**
 * One row per registry op. Adding a capability adds a ROW — never a file and never a `describe`.
 *
 * The rows are sorted by op id so this file reads as an index and a diff adding one is one hunk.
 */
export const SCENARIO_TABLE = Object.freeze([
  // 392 D-24: the message is non-empty (the contract's one requirement) and resolves to nothing.
  // Unprojected over MCP on the one exclusion with a DECISION behind it rather than a scoping line
  // (396 D-03), which is why its reason key is its own class.
  scenario({
    opId: 'agent.ask',
    input: { message: 'nothing in this fixture can answer this' },
    perSurface: { chat: { reachable: true }, mcp: { unprojected: 'agent-ask-delegation-deferral' } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 398 D-09: `query` is the whole input and it must be non-empty, so `{}` would report an INPUT
  // error exactly where a binding refusal is wanted. The question is a real one a person asks and
  // is deliberately NOT a phrase this fixture's rows answer — the honest outcome under any
  // composition that runs it is the abstention arm, which is the arm this capability exists to be
  // able to give. Unprojected over MCP on the one exclusion 398 argued rather than scoped.
  scenario({
    opId: 'agent.explain',
    input: { query: 'what can you do' },
    perSurface: {
      chat: { reachable: true },
      mcp: { unprojected: 'discovery-answered-by-protocol' },
    },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 389 D-11: a PARSING input for a capability most compositions cannot run — validation precedes
  // the binding check, so a sample that failed the contract would make an unbound-refusal leg report
  // an input error and certify nothing about binding.
  scenario({
    opId: 'analysis.get',
    input: { runId: FIXTURE_RUN_ID },
    perSurface: { chat: { reachable: true }, mcp: { unprojected: 'not-mid-flight-read' } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 394-09 D-21: BOTH fields are non-empty and required, so `{}` would report an input error where
  // a binding refusal is wanted. The ref is deliberately the exact-address spelling: free text would
  // be routed to the entity resolver, and this fixture resolves nothing.
  scenario({
    opId: 'authoring.draft.edit',
    input: {
      testRef: 'tests/nothing-in-this-fixture.yaml::Nothing In This Fixture',
      intent: 'nothing in this fixture can edit this',
    },
    perSurface: { chat: { reachable: true }, mcp: { reachable: { tool: 'agent_qa_refine_test' } } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 393 D-01: the path is well-formed, carries the extension the op requires, and names nothing in
  // any fixture; `draftMode` is optional and omitted.
  scenario({
    opId: 'authoring.draft.verify',
    input: { draftPath: 'tests/nothing-in-this-fixture.yaml' },
    perSurface: { chat: { reachable: true }, mcp: { reachable: { tool: 'agent_qa_refine_test' } } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 394 D-01: non-empty intent and a well-formed scope are the contract's two requirements.
  scenario({
    opId: 'authoring.draft.write',
    input: {
      intent: 'nothing in this fixture can author this',
      scope: { tier: 'product', key: 'nothing-in-this-fixture' },
    },
    perSurface: { chat: { reachable: true }, mcp: { reachable: { tool: 'agent_qa_write_test' } } },
    policyPoints: { grant: 'allow', refuse: 'deny', ask: 'ask' },
  }),
  // 394-07 D-12: the window is REQUIRED and closed, so `{}` would report an input error.
  // `all-time` is the arm with no further field, which is the honest sample for a fixture that has
  // no session and no receipts.
  scenario({
    opId: 'authoring.funnel.get',
    input: { window: { scope: 'all-time' } },
    perSurface: { chat: { reachable: true }, mcp: { unprojected: 'not-mid-flight-read' } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 395 D-03: PARSING inputs for the config write half, on the reasoning every unbound row shares.
  scenario({
    opId: 'config.auth.set',
    input: { target: 'shop', authStateName: 'shop-default' },
    perSurface: {
      chat: { reachable: true },
      mcp: { reachable: { tool: 'agent_qa_propose_config_change' } },
    },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  scenario({
    opId: 'config.field.set',
    input: { path: 'use.timeout', value: '45s' },
    perSurface: {
      chat: { reachable: true },
      mcp: { reachable: { tool: 'agent_qa_propose_config_change' } },
    },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  scenario({
    opId: 'config.get',
    input: {},
    perSurface: { chat: { reachable: true }, mcp: { unprojected: 'not-mid-flight-read' } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  scenario({
    opId: 'config.hook.add',
    input: { name: 'seed', runtime: 'node', file: 'scripts/seed.mjs' },
    perSurface: {
      chat: { reachable: true },
      mcp: { reachable: { tool: 'agent_qa_propose_config_change' } },
    },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 395-08 D-13: the ONE field the model fills, hostname-shaped — the gate is the first thing the op
  // runs and a non-hostname would make this a refusal sample instead.
  scenario({
    opId: 'config.project.scaffold',
    input: { domain: 'shop.example.com' },
    perSurface: {
      chat: { reachable: true },
      mcp: { reachable: { tool: 'agent_qa_propose_config_change' } },
    },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  scenario({
    opId: 'config.proposal.apply',
    input: { proposalId: 'prop_0123456789ab' },
    perSurface: {
      chat: { reachable: true },
      mcp: { reachable: { tool: 'agent_qa_apply_config_proposal' } },
    },
    policyPoints: { grant: 'allow', refuse: 'deny', ask: 'ask' },
  }),
  // 395-05 D-01: PARSING inputs on the rows above reasoning.
  scenario({
    opId: 'config.target.create',
    input: { name: 'shop', platform: 'web', url: 'https://shop.example.com' },
    perSurface: {
      chat: { reachable: true },
      mcp: { reachable: { tool: 'agent_qa_propose_config_change' } },
    },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  scenario({
    opId: 'config.target.edit',
    input: { name: 'shop', changes: { url: 'https://shop.example.com/basket' } },
    perSurface: {
      chat: { reachable: true },
      mcp: { reachable: { tool: 'agent_qa_propose_config_change' } },
    },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 395-06 D-07: the EMPTY object really is the whole input, and it parses. Which commit to reverse
  // is read from git history, so there is no field here for a sample to fill.
  scenario({
    opId: 'config.undo.propose',
    input: {},
    perSurface: {
      chat: { reachable: true },
      mcp: { reachable: { tool: 'agent_qa_propose_config_change' } },
    },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 387: `get` takes an exact address; the fixture entity directory is what stands behind it.
  scenario({
    opId: 'entities.get',
    input: { ref: FIXTURE_ENTITY_SHORT_ID },
    perSurface: { chat: { reachable: true }, mcp: { reachable: { tool: 'agent_qa_get_entity' } } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 387: `resolve` takes any reference at all, so the sample is free text that matches nothing — an
  // empty directory's honest answer is the none arm.
  scenario({
    opId: 'entities.resolve',
    input: { ref: 'nothing in this fixture is called this' },
    perSurface: { chat: { reachable: true }, mcp: { reachable: { tool: 'agent_qa_get_entity' } } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 391 PROP-01 / D-03: `list` genuinely takes the empty query — the fold is bounded, so there is
  // nothing to filter.
  scenario({
    opId: 'grants.list',
    input: {},
    perSurface: { chat: { reachable: true }, mcp: { unprojected: 'not-mid-flight-read' } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 391 PROP-01 / D-03: `revoke` takes the grant's durable id, and `{}` would report an INPUT error
  // exactly where a binding refusal is wanted. The id is well-formed and names nothing.
  scenario({
    opId: 'grants.revoke',
    input: { grantId: 'grant_0123456789abcdef' },
    perSurface: { chat: { reachable: true }, mcp: { unprojected: 'requires-human-origin' } },
    policyPoints: { grant: 'allow', refuse: 'deny', ask: 'ask' },
  }),
  // 387-08: valid INPUTS for capabilities most compositions cannot run — `invokeFunction` validates
  // before it consults the binding.
  scenario({
    opId: 'knowledge.accept.propose',
    input: { target: { grain: 'record', recordId: 'rec-not-in-this-fixture' } },
    perSurface: {
      chat: { reachable: true },
      mcp: { reachable: { tool: 'agent_qa_propose_knowledge_change' } },
    },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 387 KREV-02: the fixture runs port records no run, so the honest answer is the typed no-trace
  // arm — the arm this verb exists to be able to give.
  scenario({
    opId: 'knowledge.brief.why',
    input: { runId: FIXTURE_RUN_ID, stepIndex: 0 },
    perSurface: { chat: { reachable: true }, mcp: { unprojected: 'not-mid-flight-read' } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  scenario({
    opId: 'knowledge.bundles.list',
    input: {},
    perSurface: { chat: { reachable: true }, mcp: { unprojected: 'not-mid-flight-read' } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  scenario({
    opId: 'knowledge.forget.propose',
    input: { target: { grain: 'bundle', shortId: FIXTURE_ENTITY_SHORT_ID } },
    perSurface: {
      chat: { reachable: true },
      mcp: { reachable: { tool: 'agent_qa_propose_knowledge_change' } },
    },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  scenario({
    opId: 'knowledge.proposal.apply',
    input: { proposalId: 'prop_0123456789ab' },
    perSurface: {
      chat: { reachable: true },
      mcp: { reachable: { tool: 'agent_qa_apply_proposal' } },
    },
    policyPoints: { grant: 'allow', refuse: 'deny', ask: 'ask' },
  }),
  // 387: the record id names nothing in this fixture and the typed miss is the correct answer.
  scenario({
    opId: 'knowledge.record.show',
    input: { recordId: 'rec-not-in-this-fixture' },
    perSurface: { chat: { reachable: true }, mcp: { unprojected: 'not-mid-flight-read' } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 387: the diff baseline is 0 — a first-ever diff.
  scenario({
    opId: 'knowledge.records.diff',
    input: { sinceOrdinal: 0 },
    perSurface: { chat: { reachable: true }, mcp: { unprojected: 'not-mid-flight-read' } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 387: the filter is closed and every member optional, so an empty filter is the honest
  // 'everything' query.
  scenario({
    opId: 'knowledge.records.inspect',
    input: { filter: {} },
    perSurface: { chat: { reachable: true }, mcp: { unprojected: 'not-mid-flight-read' } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  scenario({
    opId: 'knowledge.reject.propose',
    input: {
      target: { grain: 'record', recordId: 'rec-not-in-this-fixture' },
      reason: 'not reproducible',
    },
    perSurface: {
      chat: { reachable: true },
      mcp: { reachable: { tool: 'agent_qa_propose_knowledge_change' } },
    },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 391 PROP-01: the accept takes the refined proposal id; `always` is optional and omitted.
  // Unprojected because it declares `requiresHumanOrigin` and this host mints `origin: agent`, so
  // the tool would refuse every call it ever received (396 D-11).
  scenario({
    opId: 'proposals.accept',
    input: { proposalId: 'prop_0123456789ab' },
    perSurface: { chat: { reachable: true }, mcp: { unprojected: 'requires-human-origin' } },
    policyPoints: { grant: 'allow', refuse: 'deny', ask: 'ask' },
  }),
  // 391 PROP-03: `list` genuinely takes the empty query — both filters are optional and absent means
  // everything.
  scenario({
    opId: 'proposals.list',
    input: {},
    perSurface: {
      chat: { reachable: true },
      mcp: { reachable: { tool: 'agent_qa_list_proposals' } },
    },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  scenario({
    opId: 'proposals.reject',
    input: { proposalId: 'prop_0123456789ab', reason: 'not this one' },
    perSurface: { chat: { reachable: true }, mcp: { unprojected: 'requires-human-origin' } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 391 PROP-03: `show` takes a `ProposalIdSchema` id, so a bare string would report an INPUT error
  // exactly where a binding refusal is wanted.
  scenario({
    opId: 'proposals.show',
    input: { proposalId: 'prop_0123456789ab' },
    perSurface: {
      chat: { reachable: true },
      mcp: { reachable: { tool: 'agent_qa_show_proposal' } },
    },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 390 D-13: the two write verbs take the three legs of stable test identity — a partial address
  // would report an input error where a binding refusal is wanted. The test named here exists in no
  // fixture; nothing is dispatched either way.
  scenario({
    opId: 'quarantine.add',
    input: {
      product: 'shop',
      filePath: 'tests/checkout.test.yaml',
      testName: 'checkout completes',
    },
    perSurface: { chat: { reachable: true }, mcp: { unprojected: 'not-mid-flight-write' } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 390 D-13: `list` genuinely takes the empty query — enumeration is the verb.
  scenario({
    opId: 'quarantine.list',
    input: {},
    perSurface: { chat: { reachable: true }, mcp: { unprojected: 'not-mid-flight-read' } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  scenario({
    opId: 'quarantine.release',
    input: {
      product: 'shop',
      filePath: 'tests/checkout.test.yaml',
      testName: 'checkout completes',
    },
    perSurface: { chat: { reachable: true }, mcp: { unprojected: 'not-mid-flight-write' } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 391 D-16: a PARSING input for a capability most compositions cannot run.
  scenario({
    opId: 'runs.digest',
    input: { runId: FIXTURE_RUN_ID },
    perSurface: {
      chat: { reachable: true },
      mcp: { reachable: { tool: 'agent_qa_get_run_digest' } },
    },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // The one STREAM op in the census. Unprojected because a `tools/call` is one round trip and has no
  // shape for a resumable event feed — the reason the mapping gives, and the reason its verdict
  // legs need their own comparison mechanics (384 D-08).
  scenario({
    opId: 'runs.events',
    input: { runId: FIXTURE_RUN_ID },
    perSurface: { chat: { reachable: true }, mcp: { unprojected: 'not-mid-flight-read' } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  scenario({
    opId: 'runs.get',
    input: { runId: FIXTURE_RUN_ID },
    perSurface: { chat: { reachable: true }, mcp: { unprojected: 'not-mid-flight-read' } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  scenario({
    opId: 'runs.list',
    input: {},
    perSurface: { chat: { reachable: true }, mcp: { reachable: { tool: 'agent_qa_list_runs' } } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // 388 D-14: a PARSING input for a capability most compositions cannot run.
  scenario({
    opId: 'runs.postprocessing',
    input: { runId: FIXTURE_RUN_ID },
    perSurface: { chat: { reachable: true }, mcp: { unprojected: 'not-mid-flight-read' } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
  // D-09: declared in full; every field is optional, so the empty object is the whole input.
  scenario({
    opId: 'runs.start',
    input: {},
    perSurface: { chat: { reachable: true }, mcp: { reachable: { tool: 'agent_qa_start_run' } } },
    policyPoints: { grant: 'allow', refuse: 'deny' },
  }),
] as const)

/**
 * COMPILE-TIME completeness: every id `OP_INPUT_CONTRACTS` types must carry a row.
 *
 * The runtime census leg in `parity.test.ts` is the one that ranges the REGISTRY, and it is the
 * load-bearing one. This is the cheaper inner check: it fails `tsc` — naming the missing ids in the
 * error — the moment a contract is paired without a scenario, so the two halves of this file cannot
 * fall out of step even before a test runs.
 */
type UncoveredOpId = Exclude<ScenarioOpId, (typeof SCENARIO_TABLE)[number]['opId']>
const EVERY_TYPED_OP_HAS_A_ROW: [UncoveredOpId] extends [never] ? true : UncoveredOpId = true
void EVERY_TYPED_OP_HAS_A_ROW

/** The two ways a table and a registry can disagree about what exists. */
export interface CensusDiff {
  /** Declared by the registry, carried by no row — a capability nobody wrote a scenario for. */
  readonly missing: readonly string[]
  /** Carried by a row, declared by no registry entry — a scenario for a capability that is gone. */
  readonly stray: readonly string[]
}

/**
 * The census self-check, as a PURE function of two id lists (D-10).
 *
 * TWO-DIRECTIONAL BY CONSTRUCTION. A one-directional census — "every row names a real op" — passes
 * forever on a table that has simply stopped growing, which is the exact failure mode two registers
 * over one universe produce and the reason D-10 folds them into one. Both sides are returned as
 * NAMED ids rather than counts, because the failure a person needs to read is "which capability",
 * not "one too few".
 *
 * Pure and total so `parity.test.ts` can drive it with a synthetic table missing a row and a
 * synthetic table carrying a stray, and OBSERVE each side fire. A register whose self-check has
 * never been seen to fire is a register that certifies its own arithmetic and nothing else.
 */
export function censusDiff(
  registryIds: readonly string[],
  tableOpIds: readonly string[],
): CensusDiff {
  const inTable = new Set(tableOpIds)
  const inRegistry = new Set(registryIds)
  return {
    missing: [...registryIds].filter((id) => !inTable.has(id)).sort(),
    stray: [...tableOpIds].filter((id) => !inRegistry.has(id)).sort(),
  }
}

/** The table's census, as ids — the comparand `registry.ids()` is asserted set-equal against. */
export function scenarioTableOpIds(): readonly string[] {
  return SCENARIO_TABLE.map((row) => row.opId)
}

/** One row by id, for the legs that iterate the registry rather than the table. */
export function scenarioRowFor(opId: string): ScenarioRow | undefined {
  return SCENARIO_TABLE.find((row) => row.opId === opId)
}
