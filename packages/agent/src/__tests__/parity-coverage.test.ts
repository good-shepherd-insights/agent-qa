// Conformance-suite LEG 1 — coverage (Phase 384, SC4 / Pitfall 11 / D-09 / D-15).
//
// The full parity suite lands in 397. This is its coverage leg, shipped now as a stub in
// the only sense that matters: it enumerates the REGISTRY rather than a hand-written id
// list, so it grows with the layer instead of describing the layer as it was in 384.
//
// What Pitfall 11 asks of a coverage check: `unbound` is COVERED-BUT-UNBOUND, not missing.
// A declared-but-unbound capability has a contract, a listing row, a gate verdict and an
// audit trail — reading it as a hole in the API is the silent gap `bindingStatus` exists
// to prevent, and reading it as an ordinary bound op would make this suite fail on the
// phase's own `runs.start`. It is asserted as its own third state here.
//
// The leg is structurally incapable of passing vacuously. A nonzero declaration count is
// asserted; the six ids this phase registers are asserted present at their exact binding
// status; and every registered id must carry an invocation sample below, so a seventh
// capability added in 386 or 387 fails this file until someone states how to call it.

import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  STANDING_APPROVAL_SCOPE,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  ExecutionContext,
  FunctionCaller,
} from '@vostride/agent-qa-schema'
import type { AuditSink, StandingApprovalReader } from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'

import { FunctionNotBoundError, invokeFunction } from '../functions/invoke.js'
import { createFunctionRegistry } from '../functions/registry.js'
import type { FunctionDeclaration, FunctionDeps } from '../functions/spec.js'
import { CONTRACTS_BY_ID, expectProjectionDerivedFrom } from './projection-relation.js'

/**
 * The fixed id domain taxonomy (D-15), plus `knowledge`.
 *
 * PLANNER NOTE, 2026-07-28: D-15 fixes the domain list at L10's eight, but D-06's locked
 * seed ids include `knowledge.bundles.list`, whose domain is not on that list. The ids are
 * the shipped, locked contract, so the taxonomy is widened here rather than the ids being
 * renamed. 397 reconciles the naming when the full conformance suite lands; until then this
 * note is the reconciliation.
 */
const ALLOWED_ID_DOMAINS = new Set([
  'tests',
  'runs',
  'memory',
  'analysis',
  'eval',
  'gates',
  'config',
  'agent',
  'knowledge',
  // 2026-08-02 (387 D-09): `entities` is a taxonomy EXTENSION, declared as such rather than
  // squeezed under an existing domain. Two read verbs over one addressing surface do not
  // belong to runs, memory or analysis, and filing them there would have made the domain
  // list decorative. Same reconciliation the `knowledge` line above records; 397 folds both.
  'entities',
  // 2026-08-05 (390 D-13): `quarantine` is the third taxonomy EXTENSION, declared on exactly
  // the footing of the two above. Quarantine state is neither a run, a memory nor an analysis
  // — a lifecycle with its own enumeration, exit and entry verbs — and filing it under one of
  // those would have made this list decorative for a third time. 397 folds all three.
  'quarantine',
  // 2026-08-07 (391 D-15): `proposals` is the fourth taxonomy EXTENSION, on exactly the same
  // footing. A proposal is neither a run, a memory nor an analysis, and filing the inbox under
  // `knowledge.` would have been the tempting move and the wrong one — the envelope is
  // kind-generic, so 393-396's test-draft, config and MCP proposals reach these same verbs.
  'proposals',
  // 2026-08-07 (391 D-03): `grants` is the fifth taxonomy EXTENSION, on exactly the same footing.
  // A standing approval outlives the proposal that minted it — it is a fact about what the agent
  // may do, not about any one decision — so filing the list/revoke pair under `proposals.` would
  // have made the two indistinguishable at exactly the moment a person needs to tell them apart.
  'grants',
  // 2026-08-09 (392 D-24): `agent` is the sixth taxonomy EXTENSION, and the one that closes the
  // L10 loop. A conversational turn is not a run, a memory, an analysis, a quarantine entry, a
  // proposal or a grant — it is the ORCHESTRATOR of those, and registering it here is what makes
  // the orchestrator itself a catalogued, gated capability rather than a power a REPL holds
  // privately. 396's MCP projection and 397's parity suite pick it up from this same census.
  'agent',
  // 2026-08-10 (393 D-01): `authoring` is the SEVENTH taxonomy EXTENSION, on exactly the footing
  // of the six above — counted from the dated notes in this literal: `knowledge` (2026-07-28),
  // `entities`, `quarantine`, `proposals`, `grants`, `agent`. Writing a test is neither a run, a
  // memory, an analysis, a quarantine entry, a proposal, a grant nor a conversation: it is the
  // thing all of those are ABOUT, and filing the keep-gate evaluator under `tests.` would have
  // conflated "verify this draft is worth keeping" with the suite-execution verbs D-15 reserved
  // that domain for. The id itself is `authoring.draft.verify` and not `authoring.verify_draft`
  // because the assertion below forbids an underscore, and `chat/tool-names.ts` refuses an id
  // carrying the separator it maps onto — 397 folds this note with the six above it.
  'authoring',
])

/**
 * The registered capability set, with the binding state each one ships in.
 *
 * Renamed off its phase number in 387: it was `EXPECTED_384_BINDING_STATUS`, and once a
 * second phase adds rows, a name that claims one phase’s set is a name that lies about what
 * the exact-equality assertion below is actually pinning.
 */
const EXPECTED_BINDING_STATUS: Readonly<Record<string, 'bound' | 'unbound'>> = {
  // 393 D-01: UNBOUND here because this fixture supplies no draft-evaluation bundle — a claim
  // about the composition and not about the op, exactly like `agent.ask` below. `composeLocalAgent`
  // binds it wherever the host can BOTH parse a test file and start a run, so both production hosts
  // list it bound. A host missing either half must refuse by NAME rather than return a receipt whose
  // four booleans were computed from no runs at all — a refusal wearing a verdict's clothes is the
  // one answer that would let a draft be kept on the strength of nothing.
  'authoring.draft.verify': 'unbound',
  // 394 D-01: UNBOUND here for the reason its sibling above is, and on both of its halves — this
  // fixture supplies neither the authoring read nor the shelf. `composeLocalAgent` binds the pair
  // wherever the host can parse a test file AND start a run, which is the same condition the
  // evaluator binds under, because the loop's stage 4 dispatches the evaluator. A host missing
  // either half must refuse by NAME rather than compile a test against an EMPTY authoring brief:
  // a draft authored from nothing this project knows is indistinguishable, at the caller, from
  // one authored from everything it knows.
  'authoring.draft.write': 'unbound',
  // 394-09 D-21: UNBOUND here for its siblings' reason — this fixture supplies neither the shelf
  // (its `boundThrough`) nor the draft evaluation its invoke checks by the same name.
  // `composeLocalAgent` binds both wherever the host can parse a test file and reach a model, so
  // both production hosts list it bound. A host missing either half must refuse by NAME rather
  // than answer an edit it could not apply.
  'authoring.draft.edit': 'unbound',
  // 394-07 D-12: UNBOUND here for its two siblings' reason — this fixture supplies no funnel
  // bundle. `composeLocalAgent` binds it wherever the host owns an agent-qa runtime root, which
  // is every local composition, so both production hosts list it bound. A host without one must
  // refuse by NAME rather than answer an all-zero funnel: zero built with zero accepted does not
  // read as "nothing happened", it reads as a loop that filtered everything — the one wrong
  // answer that would make the acceptance-failure flag unable to fire on the hosts that need it.
  'authoring.funnel.get': 'unbound',
  // 392 D-24: UNBOUND here because this fixture supplies no turn engine — a claim about the
  // composition and not about the op, exactly like `analysis.get` below. `composeLocalAgent`
  // assembles one, so both production hosts list `agent.ask` as bound. A host with no engine must
  // refuse by NAME rather than answer an empty turn: telling a person their request was understood
  // and produced nothing is the one wrong answer that stops them asking again.
  'agent.ask': 'unbound',
  // 389 D-11: UNBOUND here because this fixture supplies no analysis-artifact reader — a
  // claim about the composition, not the op, exactly like `runs.postprocessing` below. The
  // optional `recurrence` dep never gates this binding; only `analysis` does.
  'analysis.get': 'unbound',
  'config.get': 'bound',
  // 395 D-01/D-03 · CFGM-01/03: the config editor's write half, UNBOUND here for the 387-08
  // reason — this fixture supplies no config-file, validation, apply or proposal-write port, which
  // is a TRUE statement about it. Both are listed by name and refused by name, which is exactly
  // what `unbound` exists to say and what omitting them would have made unsayable.
  'config.auth.set': 'unbound',
  'config.field.set': 'unbound',
  'config.hook.add': 'unbound',
  'config.proposal.apply': 'unbound',
  // 395-05 D-01: the rest of the closed action class, UNBOUND here for the identical reason — this
  // fixture supplies no config ports at all. Listed by name and refused by name.
  'config.target.create': 'unbound',
  'config.target.edit': 'unbound',
  // 395-06 D-07: unbound here for the identical reason, and for one more of its own — this
  // fixture supplies no `configUndoSource` either, which is the dep whose absence makes THIS op
  // specifically unavailable.
  'config.undo.propose': 'unbound',
  // 387 D-09. Both BOUND everywhere: the entity directory is a required dep, so unlike
  // `runs.start` there is no composition that can list these and then refuse them.
  'entities.get': 'bound',
  'entities.resolve': 'bound',
  'knowledge.bundles.list': 'bound',
  // 387 KREV-01: the three new read verbs, all BOUND everywhere for the same reason the
  // entity pair is — they dispatch through the REQUIRED knowledge port.
  'knowledge.brief.why': 'bound',
  'knowledge.record.show': 'bound',
  'knowledge.records.diff': 'bound',
  'knowledge.records.inspect': 'bound',
  // 387-08 KREV-01 D-17: the MUTATING half, and the first rows here to read 'unbound' for a
  // reason other than run execution. This composition supplies a reader and no review port,
  // which is a TRUE statement about it — the four verbs are listed by name and refused by
  // name, which is exactly the state widening the reader port would have made unsayable.
  'knowledge.accept.propose': 'unbound',
  'knowledge.forget.propose': 'unbound',
  'knowledge.proposal.apply': 'unbound',
  'knowledge.reject.propose': 'unbound',
  // 390 D-12/D-13: the three quarantine verbs, UNBOUND here for the 387-08 reason — this
  // fixture supplies no quarantine port. That is now a statement about THIS FIXTURE and
  // nothing else: plan 06 implemented the port and bound it at `composeLocalAgent`, so both
  // production hosts list all three `bound` (the CLI catalog in `fn-command.test.ts` pins it).
  // A host with no port must still refuse by name rather than answer an empty list about a
  // ledger it cannot read — an empty answer would say "nothing is quarantined" about a file
  // it has never been able to open.
  // 391 PROP-03: the three inbox verbs, UNBOUND here for the 390 reason — this fixture supplies
  // no proposals-inbox port. `composeLocalAgent` binds one, so both production hosts list all
  // three `bound`. A host with no port must refuse by name rather than answer an empty inbox
  // about a directory it has never been able to open: an empty answer reads as "nothing is
  // waiting on you", which is the wrong answer that makes a person stop checking.
  // 391 PROP-01 / D-03: the two grant verbs, UNBOUND here for the 390/391 reason — this fixture
  // supplies no standing-grants port. There is deliberately no `grants.record` row, and never
  // will be: the mint is a member of the PORT and of no registry entry, because a standing
  // approval arises only from the accept escalation (D-01).
  'grants.list': 'unbound',
  'grants.revoke': 'unbound',
  'proposals.accept': 'unbound',
  'proposals.list': 'unbound',
  'proposals.reject': 'unbound',
  'proposals.show': 'unbound',
  'quarantine.add': 'unbound',
  'quarantine.list': 'unbound',
  'quarantine.release': 'unbound',
  'runs.events': 'bound',
  'runs.get': 'bound',
  'runs.list': 'bound',
  // 388 D-14: UNBOUND here, and for a third distinct reason — this fixture supplies no durable
  // queue storage at all. A host that cannot see the queue must say so by name rather than
  // answer all-pending about a chain it has never been able to observe, so this row is a claim
  // about the composition and not about the op.
  'runs.postprocessing': 'unbound',
  // 391 D-16: UNBOUND for the proposals-inbox reason rather than the queue one. The digest
  // binds through `proposalsInbox` — a host that cannot open the proposals directory would
  // otherwise compose a digest saying nothing is waiting on you about a store it never read.
  'runs.digest': 'unbound',
  // D-09: declared in full, bound by nothing in this composition. 386 flips one field.
  'runs.start': 'unbound',
}

const FIXTURE_RUN_ID = 'run-alpha'

const FIXTURE_ENTITY_SHORT_ID = 'MEM-001'

/**
 * The one entity this fixture directory knows about.
 *
 * A REAL descriptor rather than a refusing stub, because the invocation leg below calls every
 * bound capability and parses the answer against its declared output contract — so a port that
 * refused would make `entities.get` uncallable here, in the file that exists to ensure no
 * capability arrives without someone stating how it is called.
 */
const FIXTURE_ENTITY_DESCRIPTOR = {
  kind: 'MEM' as const,
  shortId: FIXTURE_ENTITY_SHORT_ID,
  uri: 'agentqa://memory/MEM-001',
  machineId: 'bundle-fixture',
  title: 'a fixture memory record',
  statusSource: 'active',
}

/**
 * A valid input for every registered id.
 *
 * Keyed by id and compared for exact set equality against the registry, so this map is the
 * conformance suite's growth seam: a new capability cannot join the layer without someone
 * writing down how it is called.
 */
const INVOCATION_SAMPLES: Readonly<Record<string, unknown>> = {
  // 389 D-11: a PARSING input for a capability this composition cannot run — validation
  // precedes the binding check, so a sample that failed the contract would make the
  // unbound-refusal leg report an input error and certify nothing about binding.
  'analysis.get': { runId: FIXTURE_RUN_ID },
  // 393 D-01: a PARSING input for a capability this composition cannot run, on the reasoning every
  // unbound row here shares — validation precedes the binding check, so a sample that failed the
  // contract would make the unbound-refusal leg report an input error and certify nothing about
  // binding. The path is well-formed, carries the extension the op requires, and names nothing in
  // any fixture; `draftMode` is optional and omitted, because the unbound leg needs a parsing input
  // and nothing more.
  'authoring.draft.verify': { draftPath: 'tests/nothing-in-this-fixture.yaml' },
  // 394 D-01: a PARSING input for a capability this composition cannot run, on the same reasoning
  // — validation precedes the binding check. Non-empty intent and a well-formed scope are the
  // contract's two requirements; `draftMode` is optional and omitted, because the unbound leg
  // needs a parsing input and nothing more.
  'authoring.draft.write': {
    intent: 'nothing in this fixture can author this',
    scope: { tier: 'product', key: 'nothing-in-this-fixture' },
  },
  // 394-09 D-21: a PARSING input, on the same reasoning — validation precedes the binding check.
  // BOTH fields are non-empty and required, so `{}` would report an input error and the unbound
  // leg would certify nothing about binding. The ref is deliberately the exact-address spelling:
  // free text would be routed to the entity resolver, and this leg has to reach the BINDING check
  // rather than a never-guess refusal about a fixture that resolves nothing.
  'authoring.draft.edit': {
    testRef: 'tests/nothing-in-this-fixture.yaml::Nothing In This Fixture',
    intent: 'nothing in this fixture can edit this',
  },
  // 394-07 D-12: a PARSING input, on the same reasoning — validation precedes the binding check.
  // The window is REQUIRED and closed, so `{}` would report an input error and the unbound leg
  // would certify nothing about binding. `all-time` is the arm with no further field, which is
  // what makes it the honest sample for a fixture that has no session and no receipts.
  'authoring.funnel.get': { window: { scope: 'all-time' } },
  'config.get': {},
  // 395 D-03: PARSING inputs for two capabilities this composition cannot run, on the rows above
  // reasoning — `invokeFunction` validates before it consults the binding, so a sample that did
  // not parse would make the unbound-refusal leg report an input error and certify nothing.
  'config.auth.set': { target: 'shop', authStateName: 'shop-default' },
  'config.field.set': { path: 'use.timeout', value: '45s' },
  'config.hook.add': { name: 'seed', runtime: 'node', file: 'scripts/seed.mjs' },
  'config.proposal.apply': { proposalId: 'prop_0123456789ab' },
  // 395-05 D-01: PARSING inputs on the rows above reasoning — `invokeFunction` validates before it
  // consults the binding, so a sample that did not parse would make the unbound-refusal leg report
  // an input error and certify nothing about binding.
  'config.target.create': { name: 'shop', platform: 'web', url: 'https://shop.example.com' },
  'config.target.edit': { name: 'shop', changes: { url: 'https://shop.example.com/basket' } },
  // 395-06 D-07: the EMPTY object really is the whole input, and it parses. Which commit to
  // reverse is read from git history, so there is no field here for a sample to fill.
  'config.undo.propose': {},
  // 387: `resolve` takes any reference at all, so the sample is free text that matches
  // nothing — the fixture directory is empty and the honest answer is the none arm. `get`
  // takes an exact address, and the fixture port below is what stands behind it.
  // 392 D-24: a PARSING input for a capability this composition cannot run, on the 387-08
  // reasoning below — validation precedes the binding check, so a sample that failed the contract
  // would make the unbound-refusal leg report an input error and certify nothing about binding.
  // The message is non-empty (the contract's one requirement) and resolves to nothing, which is
  // irrelevant here: no engine exists to route it.
  'agent.ask': { message: 'nothing in this fixture can answer this' },
  'entities.get': { ref: FIXTURE_ENTITY_SHORT_ID },
  'entities.resolve': { ref: 'nothing in this fixture is called this' },
  'knowledge.bundles.list': {},
  // 387: the filter is closed and every member optional, so an empty filter is the honest
  // 'everything' query; the diff baseline is 0 (a first-ever diff); the record id names
  // nothing in this fixture and the typed miss is the correct answer.
  // 387 KREV-02: the fixture runs port records no run, so the honest answer is the typed
  // no-trace arm — which is the arm this verb exists to be able to give.
  'knowledge.brief.why': { runId: FIXTURE_RUN_ID, stepIndex: 0 },
  'knowledge.record.show': { recordId: 'rec-not-in-this-fixture' },
  'knowledge.records.diff': { sinceOrdinal: 0 },
  'knowledge.records.inspect': { filter: {} },
  // 387-08: valid INPUTS for capabilities this composition cannot run. They have to parse,
  // because `invokeFunction` validates before it consults the binding — so a sample that did
  // not parse would make the unbound-refusal leg below report an input error and certify
  // nothing about binding at all.
  'knowledge.accept.propose': { target: { grain: 'record', recordId: 'rec-not-in-this-fixture' } },
  'knowledge.reject.propose': {
    target: { grain: 'record', recordId: 'rec-not-in-this-fixture' },
    reason: 'not reproducible',
  },
  'knowledge.forget.propose': { target: { grain: 'bundle', shortId: FIXTURE_ENTITY_SHORT_ID } },
  'knowledge.proposal.apply': { proposalId: 'prop_0123456789ab' },
  // 390 D-13: PARSING inputs for three capabilities this composition cannot run, on the same
  // reasoning as the rows above. `list` genuinely takes the empty query — enumeration is the
  // verb — while the two write verbs take the three legs of stable test identity, and a
  // partial address would report an input error where the unbound-refusal leg needs a binding
  // refusal. The test named here exists in no fixture; nothing is dispatched either way.
  // 391 PROP-03: PARSING inputs for three capabilities this composition cannot run, on the same
  // reasoning as every row above. `list` genuinely takes the empty query — both filters are
  // optional and absent means everything — while `show` and `reject` take a `ProposalIdSchema`
  // id, so a bare string would report an INPUT error exactly where the unbound-refusal leg needs
  // a binding refusal. The id below is well-formed and names nothing in any fixture.
  // 391 PROP-01 / D-03: `list` genuinely takes the empty query — the fold is bounded, so there is
  // nothing to filter — while `revoke` takes the grant's durable id, and the `{}` default would
  // report an INPUT error exactly where the unbound-refusal leg needs a binding refusal. The id
  // below is well-formed and names nothing in any fixture.
  'grants.list': {},
  'grants.revoke': { grantId: 'grant_0123456789abcdef' },
  // 391 PROP-01: the accept takes the same refined id; `always` is optional and omitted here,
  // because the unbound-refusal leg needs a PARSING input and nothing more.
  'proposals.accept': { proposalId: 'prop_0123456789ab' },
  'proposals.list': {},
  'proposals.show': { proposalId: 'prop_0123456789ab' },
  'proposals.reject': { proposalId: 'prop_0123456789ab', reason: 'not this one' },
  'quarantine.add': {
    product: 'shop',
    filePath: 'tests/checkout.test.yaml',
    testName: 'checkout completes',
  },
  'quarantine.list': {},
  'quarantine.release': {
    product: 'shop',
    filePath: 'tests/checkout.test.yaml',
    testName: 'checkout completes',
  },
  'runs.events': { runId: FIXTURE_RUN_ID },
  'runs.get': { runId: FIXTURE_RUN_ID },
  'runs.list': {},
  // 388 D-14: a PARSING input for a capability this composition cannot run, on the 387-08
  // reasoning above — validation precedes the binding check, so a sample that failed the
  // contract would make the unbound-refusal leg report an input error and certify nothing.
  'runs.postprocessing': { runId: FIXTURE_RUN_ID },
  // 391 D-16: a PARSING input for a capability this composition cannot run, exactly as above.
  'runs.digest': { runId: FIXTURE_RUN_ID },
  'runs.start': {},
}

const FIXED_CONTEXT: () => ExecutionContext = () => 'local-interactive'

function handoff(runId: string): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: runId as CompletedRunHandoff['runId'],
    scope: { tier: 'product', key: 'shop' },
    buildOrdinal: 7,
    executionContext: 'local-headless',
    aggregateVerdict: 'passed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1_000,
    endedAt: 2_000,
    tests: [],
  }
}

/**
 * Fully-faked dependencies: every port resolves, nothing reaches a host API.
 *
 * The point of faking ALL of them is that a `bound` op which quietly needed something the
 * ports do not offer would fail here rather than in whichever composition root first tried
 * to run it.
 */
function fakeDeps(): FunctionDeps {
  const documents = [handoff(FIXTURE_RUN_ID)]
  return {
    runs: {
      list: () => Promise.resolve(documents),
      get: runId => Promise.resolve(documents.find(document => document.runId === runId)),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    knowledge: {
      listBundles: () => Promise.resolve([]),
      inspectRecords: () => Promise.resolve([]),
      diffSince: () => Promise.resolve([]),
      showRecord: ({ recordId }) => Promise.resolve({ kind: 'not-found', schemaVersion: 1, recordId } as const),
    },
    entities: {
      // Free text against an empty directory: the none arm, which is what the sample above
      // asks for and what the never-guess contract requires.
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: (ref: string) => Promise.resolve(
        ref === FIXTURE_ENTITY_SHORT_ID ? FIXTURE_ENTITY_DESCRIPTOR : undefined,
      ),
    },
    config: {
      getMasked: () => Promise.resolve({
        schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
        configPath: 'agent-qa.config.yaml',
        entries: [],
      }),
    },
  }
}

/**
 * Every scope the layer knows, so a refusal here can never be a missing grant.
 *
 * Derived from `FunctionScopeSchema` rather than listed, and that is load-bearing for the
 * unbound-refusal leg below: `invokeFunction` checks scopes BEFORE it checks binding, so a
 * hand-written list that fell one member behind the union would turn every new capability's
 * "refused because this host cannot run it" into "refused because this caller was not granted
 * it" — a green-looking assertion certifying the wrong refusal. 387-08 measured exactly that.
 */
const FULLY_GRANTED: FunctionCaller = {
  surface: 'conformance',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  // 391 D-06: `human`, and it is a deliberate answer rather than a relaxation. This caller's
  // whole job is to REACH every capability so the coverage legs measure what they claim to —
  // the docstring on `grantedScopes` above makes exactly that argument for scopes, and origin is
  // the same hazard on a new axis: an origin-refused op never reaches the binding check, so the
  // unbound-refusal leg would certify nothing about `proposals.reject` while looking green.
  origin: 'human',
}

/** Discards every row: this file asserts on coverage, never on the audit trail. */
function noOpSink(): AuditSink {
  return {
    appendExecutionAudit() {},
    appendGuardrailAudit() {},
  }
}

/**
 * A composition where every ask is already standing-approved (391).
 *
 * The claims in this file are about the CATALOGUE — coverage, contracts, and the by-name refusal of
 * an unbound capability — and 391 raised `knowledge.proposal.apply` to the ask tier. Without this,
 * that capability would be refused by the GATE before the binding check ran, and the unbound-refusal
 * case would be asserting a policy verdict while claiming to assert a binding one. The grant is
 * built from the action's own name, so it covers whatever the registry lists rather than a class
 * spelled here, and the real gate still runs and still audits.
 */
const EVERY_ASK_STANDING_APPROVED: StandingApprovalReader = {
  grantsFor: (action) => [{ actionClass: action.name, scope: STANDING_APPROVAL_SCOPE }],
}

function registry() {
  return createFunctionRegistry({
    deps: fakeDeps(),
    auditSink: noOpSink(),
    standingApprovalReader: () => EVERY_ASK_STANDING_APPROVED,
    resolveExecutionContext: FIXED_CONTEXT,
  })
}

function declarations(): readonly FunctionDeclaration[] {
  return registry().list(FULLY_GRANTED)
}

async function drain(result: unknown): Promise<unknown> {
  if (typeof result === 'object' && result !== null && Symbol.asyncIterator in result) {
    const collected: unknown[] = []
    for await (const element of result as AsyncIterable<unknown>) {
      collected.push(element)
    }
    return collected
  }
  return result
}

describe('parity leg 1 — registry coverage', () => {
  it('registers a nonzero, uniquely-identified capability set', () => {
    const ids = declarations().map(declaration => declaration.id)

    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toEqual(ids.length)
    expect([...ids].sort()).toEqual(ids)
  })

  it('names every capability dot-namespaced over the fixed domain taxonomy (D-15)', () => {
    for (const declaration of declarations()) {
      expect(declaration.id, declaration.id).toMatch(/^[a-z]+(?:\.[a-z]+)+$/)
      expect(ALLOWED_ID_DOMAINS, declaration.id).toContain(declaration.id.split('.')[0])
    }
  })

  it('carries a complete declaration for every capability', () => {
    for (const declaration of declarations()) {
      const label = declaration.id
      expect(declaration.summary.trim(), label).not.toEqual('')
      expect(declaration.requiredScopes.length, label).toBeGreaterThan(0)
      expect(['unary', 'stream'], label).toContain(declaration.resultKind)
      expect(['bound', 'unbound'], label).toContain(declaration.bindingStatus)
      expect(declaration.risk.name, label).toEqual(`fn:${declaration.id}`)
      expect(declaration.risk.recognized, label).toBe(true)
      // The declared contracts arrive as INERT projections, never as live validators
      // (BL-01 / D-14): a listing is a description of the contract, not a handle on it.
      for (const side of ['input', 'output'] as const) {
        const projection = declaration[side]
        expect(typeof projection, `${label}.${side}`).toEqual('object')
        expect(projection, `${label}.${side}`).not.toBeNull()
        expect((projection as Record<string, unknown>)['safeParse'], `${label}.${side}`)
          .toBeUndefined()
        expect((projection as Record<string, unknown>)['parse'], `${label}.${side}`)
          .toBeUndefined()
      }
      // A listing view never carries the implementation (T-384-20).
      expect(declaration, label).not.toHaveProperty('invoke')
    }
  })

  it('projects each contract FROM the schema it was declared with, naming no field', () => {
    // The projection is computed once at listing time by `toSchemaProjection`, so the
    // catalog surfaces 396 builds read a value rather than running a schema. Asserting its
    // SHAPE is not enough to know it is the RIGHT value — a frozen constant that discards
    // the schema passed the shape version of this case across the whole suite. What is
    // asserted instead is the relation between each projection and the live contract it
    // came from, with every expected key set read off that contract.
    const listed = declarations()

    expect(listed.length).toBeGreaterThan(0)
    // The same growth seam `INVOCATION_SAMPLES` applies to calling, applied to contracts.
    expect(Object.keys(CONTRACTS_BY_ID).sort())
      .toEqual(listed.map((declaration) => declaration.id).sort())

    for (const declaration of listed) {
      const contracts = CONTRACTS_BY_ID[declaration.id]!
      for (const side of ['input', 'output'] as const) {
        const label = `${declaration.id}.${side}`
        expect(Object.getPrototypeOf(declaration[side]), label).toBe(Object.prototype)
        expectProjectionDerivedFrom(contracts[side], declaration[side], label)
      }
    }
  })

  it('pins the registered capability set and each id binding state', () => {
    const observed = Object.fromEntries(
      declarations().map(declaration => [declaration.id, declaration.bindingStatus]),
    )

    expect(observed).toEqual(EXPECTED_BINDING_STATUS)
  })

  it('holds an invocation sample for every registered id — no capability without one', () => {
    expect(declarations().map(declaration => declaration.id).sort())
      .toEqual(Object.keys(INVOCATION_SAMPLES).sort())
  })

  it('resolves every BOUND capability into a value its declared output contract accepts', async () => {
    // This gate used to assert mere defined-ness, which `null`, `[]`, `{}`, `0` and `''`
    // all satisfy — in the file that is explicitly this layer's growth seam for 386 and
    // 387. It is now a relation between the result and the contract the registry already
    // holds: the declared output schema must PARSE what came back. An id-keyed table of
    // expected values would be the enumeration move (a seventh capability re-opens the
    // hole), so nothing is written down per id here either.
    const built = registry()

    let checked = 0
    for (const declaration of built.list(FULLY_GRANTED)) {
      if (declaration.bindingStatus !== 'bound') continue

      const contract = CONTRACTS_BY_ID[declaration.id]!
      const drained = await drain(
        await invokeFunction(
          built,
          declaration.id,
          INVOCATION_SAMPLES[declaration.id],
          FULLY_GRANTED,
        ),
      )

      if (declaration.resultKind === 'stream') {
        // A stream spec's output contract describes the ELEMENT, so every drained element is
        // re-parsed. The array assertion makes an empty drain a visible, deliberate pass
        // rather than a silently skipped loop.
        expect(Array.isArray(drained), declaration.id).toBe(true)
        const elements = drained as readonly unknown[]
        for (let index = 0; index < elements.length; index++) {
          expect(contract.output.safeParse(elements[index]).success, `${declaration.id}[${index}]`)
            .toBe(true)
        }
      } else {
        expect(contract.output.safeParse(drained).success, declaration.id).toBe(true)
      }
      checked += 1
    }

    // …and the loop ran: a `bound` set that emptied would otherwise pass every line above.
    expect(checked).toBeGreaterThan(0)
  })

  it('refuses every UNBOUND capability by name — covered, not missing (Pitfall 11)', async () => {
    const built = registry()
    const unbound = built
      .list(FULLY_GRANTED)
      .filter(declaration => declaration.bindingStatus === 'unbound')

    // The phase ships exactly one; the assertion is that the state exists and is refused
    // distinctly, not that the count stays at one forever.
    expect(unbound.length).toBeGreaterThan(0)

    for (const declaration of unbound) {
      const refusal = invokeFunction(
        built,
        declaration.id,
        INVOCATION_SAMPLES[declaration.id],
        FULLY_GRANTED,
      )

      await expect(refusal, declaration.id).rejects.toBeInstanceOf(FunctionNotBoundError)
      await expect(refusal, declaration.id).rejects.toMatchObject({
        functionId: declaration.id,
      })
    }
  })
})
