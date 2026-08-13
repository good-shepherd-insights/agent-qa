// The function registry (Phase 384, FUNC-01 / FUNC-03).
//
// The registry OWNS the specs and hands out declaration views only. Its internals —
// the spec map, the injected deps, the audit sink, and the execution-context resolver
// — live in a module-private WeakMap that only `invokeFunction` reads. A surface holding
// a `FunctionRegistry` therefore has exactly one way to run a capability, and that way
// crosses the gate.

import { getActiveExecutionContext } from '@vostride/agent-qa-safety'
import type {
  AuditSink,
  ConfirmPort,
  SessionDenyOverlay,
  StandingApprovalReader,
} from '@vostride/agent-qa-safety'
import type { ExecutionContext, FunctionCaller, FunctionScope } from '@vostride/agent-qa-schema'

import { toSchemaProjection } from './declaration-projection.js'
import type { FunctionBindingStatus } from './spec.js'
import { agentAskSpec } from './ops/agent-ask.js'
import { analysisGetSpec } from './ops/analysis-get.js'
import { authoringDraftEditSpec } from './ops/authoring-draft-edit.js'
import { authoringDraftWriteSpec } from './ops/authoring-draft-write.js'
import { authoringFunnelGetSpec } from './ops/authoring-funnel-get.js'
import { authoringVerifyDraftSpec } from './ops/authoring-verify-draft.js'
import { configFieldSetSpec } from './ops/config-field-set.js'
import { configGetSpec } from './ops/config-get.js'
import { configProposalApplySpec } from './ops/config-proposal-apply.js'
import { entitiesGetSpec } from './ops/entities-get.js'
import { entitiesResolveSpec } from './ops/entities-resolve.js'
import { grantsListSpec } from './ops/grants-list.js'
import { grantsRevokeSpec } from './ops/grants-revoke.js'
import { knowledgeAcceptProposeSpec } from './ops/knowledge-accept-propose.js'
import { knowledgeBriefWhySpec } from './ops/knowledge-brief-why.js'
import { knowledgeBundlesListSpec } from './ops/knowledge-bundles-list.js'
import { knowledgeForgetProposeSpec } from './ops/knowledge-forget-propose.js'
import { knowledgeProposalApplySpec } from './ops/knowledge-proposal-apply.js'
import { knowledgeRecordShowSpec } from './ops/knowledge-record-show.js'
import { knowledgeRecordsDiffSpec } from './ops/knowledge-records-diff.js'
import { knowledgeRecordsInspectSpec } from './ops/knowledge-records-inspect.js'
import { knowledgeRejectProposeSpec } from './ops/knowledge-reject-propose.js'
import { proposalsAcceptSpec } from './ops/proposals-accept.js'
import { proposalsListSpec } from './ops/proposals-list.js'
import { proposalsRejectSpec } from './ops/proposals-reject.js'
import { proposalsShowSpec } from './ops/proposals-show.js'
import { quarantineAddSpec } from './ops/quarantine-add.js'
import { quarantineListSpec } from './ops/quarantine-list.js'
import { quarantineReleaseSpec } from './ops/quarantine-release.js'
import { runsEventsSpec } from './ops/runs-events.js'
import { runsDigestSpec } from './ops/runs-digest.js'
import { runsGetSpec } from './ops/runs-get.js'
import { runsListSpec } from './ops/runs-list.js'
import { runsPostProcessingSpec } from './ops/runs-post-processing.js'
import { runsStartSpec } from './ops/runs-start.js'
import type { FunctionDeclaration, FunctionDeps, FunctionSpec } from './spec.js'

/** Thrown at construction when two declarations claim the same id — never last-wins. */
export class DuplicateFunctionIdError extends Error {
  constructor(readonly functionId: string) {
    super(`Duplicate function id: ${functionId}`)
    this.name = 'DuplicateFunctionIdError'
  }
}

/**
 * Thrown at construction when the registry is handed no usable audit sink (D-11).
 *
 * The type-level requirement below binds only the callers `tsc` gets to see. This is the
 * same guarantee stated as a RUNTIME property, so it also holds for an in-workspace cast
 * and for a plain-JS consumer of the published package. It is deliberately a REFUSAL and
 * not a default: silently substituting a no-op sink would make the unaudited composition
 * the one that constructs quietly, which is exactly the fast path D-11 abolishes.
 */
export class MissingAuditSinkError extends Error {
  constructor(readonly detail: string) {
    super(
      `createRegistryFromSpecs requires a usable AuditSink (D-11): ${detail}. ` +
        'The policy gate is the single audit author, so a registry built without one would ' +
        'arm every registered capability with no execution-audit trail at all.',
    )
    this.name = 'MissingAuditSinkError'
  }
}

/** The scopes safe mode is willing to list. Cosmetic only — see `FunctionCaller`. */
const SAFE_MODE_SCOPES: readonly FunctionScope[] = ['read']

/** The capabilities every composition of this layer registers. */
const BUILT_IN_FUNCTION_SPECS: readonly FunctionSpec[] = [
  runsListSpec as FunctionSpec,
  runsGetSpec as FunctionSpec,
  runsEventsSpec as FunctionSpec,
  // Bound exactly in the compositions that supply a `runInvocation` port (D-16); listed
  // either way, so a host that cannot start a run reports a visible `unbound` rather than a
  // hole in the catalog, and `invokeFunction` refuses it by name. `composeLocalAgent()` in
  // `@vostride/agent-qa-agent-local` is the binding site.
  runsStartSpec as FunctionSpec,
  // 388 D-14: THE chip-truth read. Registered here rather than beside a surface because it is
  // the single producer three surfaces share — the CLI's exit summary line, 392's chat and M5's
  // dashboard are all thin clients of this one op, and the 397 parity suite inherits it by
  // being in the catalogue. Bound through the OPTIONAL `postProcessing` dep, so a host with no
  // durable queue lists it `unbound` BY NAME instead of answering all-pending about a chain it
  // cannot see.
  runsPostProcessingSpec as FunctionSpec,
  // 389 D-11: THE analysis read — resolved verdicts, rendered sentences, clusters, one
  // producer for the CLI print, the run page and chat. Bound through the OPTIONAL `analysis`
  // dep (the artifact reader), so a host that cannot see run directories lists it `unbound`
  // BY NAME; the optional `recurrence` dep only enriches the sentence's recurrence clause
  // and never gates the binding.
  analysisGetSpec as FunctionSpec,
  knowledgeBundlesListSpec as FunctionSpec,
  // 387 KREV-01: the read half of the review-verb family. All three bind through the REQUIRED
  // `knowledge` port, so — unlike the mutating half 387-08 registers through the optional
  // `knowledgeReview` dep — there is no composition that lists these and cannot run them.
  knowledgeRecordsInspectSpec as FunctionSpec,
  knowledgeRecordsDiffSpec as FunctionSpec,
  knowledgeRecordShowSpec as FunctionSpec,
  // KREV-02: the honest verb. Read-tier like its four siblings, and bound everywhere for the
  // same reason — its substrate is the RUNS port, which is required.
  knowledgeBriefWhySpec as FunctionSpec,
  // 387 KREV-01 D-17: the MUTATING half — three proposes and one apply. Registered here and
  // bound only where a composition supplies `knowledgeReview`, so a read-only host lists all
  // four as `unbound` BY NAME rather than omitting them: a capability that is absent from a
  // catalogue is indistinguishable from one that never existed, and D-09 requires the two to
  // look different. The apply is the ONE op in this list through which committed knowledge can
  // change; the three proposes commit nothing by construction.
  knowledgeAcceptProposeSpec as FunctionSpec,
  knowledgeRejectProposeSpec as FunctionSpec,
  knowledgeForgetProposeSpec as FunctionSpec,
  knowledgeProposalApplySpec as FunctionSpec,
  configGetSpec as FunctionSpec,
  // 395 D-01/D-03 · CFGM-01/CFGM-03: the config editor's first action and the ONE verb through
  // which committed configuration changes. Registered as SIBLINGS of `config.get` rather than in a
  // family of their own, because they are the write half of a story whose read half already ships
  // here — and registering them is what makes them instantly chat-reachable (392 D-07), projectable
  // over MCP (396) and walkable by the parity suite (397) with no harness change anywhere.
  //
  // The propose op stays at the recognized-mutating floor: it commits nothing, so gating it would
  // be asking about the request rather than the act. The apply carries `mutating-shared` — the
  // person's git history is not this machine's business alone — and its class is GRANTABLE, which
  // is D-02's design: the per-proposal `crossBoundary` flag is what protects a boundary-crossing
  // change, not a blanket refusal of the class.
  //
  // Both bind through OPTIONAL deps, so a host with no config files lists them `unbound` BY NAME
  // rather than answering an empty proposal about a project it cannot read.
  configFieldSetSpec as FunctionSpec,
  configProposalApplySpec as FunctionSpec,
  // 390 D-12/D-13: a new `quarantine.` domain — a taxonomy extension exactly as `entities.`
  // was, because quarantine state is neither a run, a memory nor an analysis. All three bind
  // through the OPTIONAL `quarantine` dep, so a host with no knowledge root lists them
  // `unbound` BY NAME rather than answering an empty list about a ledger it cannot read.
  // `list` is read-tier; `release` and `add` are DIRECT gated writes (no propose+apply pair —
  // that idiom is for learned-knowledge mutations, and this is operational state).
  quarantineListSpec as FunctionSpec,
  quarantineReleaseSpec as FunctionSpec,
  quarantineAddSpec as FunctionSpec,
  // 391 PROP-03 / D-15: a new `proposals.` domain — the inbox §3.3 said was missing. A taxonomy
  // extension exactly as `quarantine.` was, and deliberately NOT filed under `knowledge.`: the
  // envelope is kind-generic, so 393-396's test-draft, config and MCP proposals reach these same
  // three verbs. All three bind through the OPTIONAL `proposalsInbox` dep, so a host with no
  // runtime root lists them `unbound` BY NAME rather than answering an empty inbox about a
  // directory it cannot open. `list` and `show` are read-tier; `reject` is the phase's first
  // shipped `requiresHumanOrigin` op — an agent that could decline proposals could curate the
  // inbox a human checks.
  proposalsListSpec as FunctionSpec,
  proposalsShowSpec as FunctionSpec,
  proposalsRejectSpec as FunctionSpec,
  // 391 PROP-01 / D-01: the DECISION verb, and the one door in this catalogue to a standing
  // approval. It is registered beside its siblings and bound through the same inbox dep, but it
  // is the only op here that carries BOTH `knowledge-write` and `approval-write` — because one
  // call can commit knowledge AND change what the system may do without asking.
  proposalsAcceptSpec as FunctionSpec,
  // 391 PROP-01 / D-03: a new `grants.` domain — the standing approvals a person has given, and
  // the way back. A taxonomy extension exactly as `proposals.` was, and separate from it because
  // a grant outlives the proposal that minted it: a revoke is about what the agent may do, not
  // about any one decision. Both bind through the OPTIONAL `standingGrants` dep.
  //
  // THERE IS NO `grants.record`. That absence is D-01 expressed as a missing capability rather
  // than as a rule: a standing approval arises only from the deliberate accept-with-always form,
  // so a registered mint verb would be a second door into the same power — reachable without ever
  // deciding a proposal, which is precisely the silent accretion D-01 forbids.
  grantsListSpec as FunctionSpec,
  grantsRevokeSpec as FunctionSpec,
  // 391 PROP-04 / D-16: the per-run digest. Filed under `runs.` beside `runs.postprocessing`
  // because what it answers is a fact about a RUN, and bound through the same OPTIONAL
  // `proposalsInbox` dep the four verbs above use — a host that cannot open the proposals
  // directory lists it `unbound` BY NAME rather than composing a digest whose decision section
  // says "nothing was minted" about a store it has never read. Read-tier, and it registers NO
  // new dep: the projection composes from four capabilities this catalogue already had.
  runsDigestSpec as FunctionSpec,
  // 387 D-09: a new `entities.` domain, a taxonomy extension exactly as `knowledge.` was.
  // Both read-tier, both bound in every composition — the directory is a REQUIRED dep, so
  // there is no host that lists these and cannot run them.
  entitiesResolveSpec as FunctionSpec,
  entitiesGetSpec as FunctionSpec,
  // 392 D-24: a new `agent.` domain, and the taxonomy extension that matters most — the chat turn
  // entry is itself a catalogued, gated capability rather than a power the REPL holds privately
  // (§3's L10 law). It binds through the OPTIONAL `chatTurn` dep, so a host with no engine lists
  // it `unbound` BY NAME rather than answering an empty turn about a request it understood.
  //
  // `agent.chat`, the session-stateful sibling the milestone also names, is deliberately absent
  // until a consumer exists: a registered entry nothing drives would still oblige 397's parity
  // suite to stub it on every surface.
  agentAskSpec as FunctionSpec,
  // 2026-08-10 (393 D-01): a new `authoring.` domain, and the keep-filter's entry point. The four
  // gates that decide whether a generated test is worth keeping are a CATALOGUED capability rather
  // than a private power of whatever writes tests — so 393's corpus proof drives the real gated
  // entry point (the produced-not-literal law), 396's MCP projection and 397's parity suite inherit
  // it from this census with no harness change, and the standalone question ("is this existing test
  // worth keeping?") is answerable from every surface.
  //
  // Bound through the OPTIONAL `draftEvaluation` bundle, whose binding site is `composeLocalAgent()`
  // in `@vostride/agent-qa-agent-local` (385 D-15 — one composition root, therefore both the CLI and
  // the daemon). The bundle is supplied only where the host can BOTH parse a test file and start a
  // run, so a host missing either half lists this capability `unbound` BY NAME rather than leaving a
  // hole in the catalogue — and rather than returning a receipt whose four booleans were computed
  // from no runs at all, which is the one answer that could get a draft kept on the strength of
  // nothing.
  //
  // Registering it does NOT flip 392's `write_test` fail-closed scenario: that tool name stays
  // absent from the catalogue until 394 (D-01), and nothing here mints it.
  authoringVerifyDraftSpec as FunctionSpec,
  // 2026-08-11 (394 D-01 · WTST-01): the authoring LOOP's one public entry, beside the evaluator
  // it composes. All six stages — brief, dedup, compile, verify, route, compound — run INSIDE this
  // op, because the stage order is an invariant and registering a stage each would make it a hope
  // about the plan the chat planner happened to make rather than a property of the code. Everything
  // under the surface still crosses the function layer: stage 4 dispatches `authoring.draft.verify`
  // through `invokeFunction` on a caller minted with exactly that op's declared scopes.
  //
  // Bound through the OPTIONAL `draftShelf` bundle — the model and the shelf — whose binding site
  // is `composeLocalAgent()` in `@vostride/agent-qa-agent-local` (385 D-15, therefore both the CLI
  // and the daemon). The read half (`authoringRead`) is supplied with it or not at all and the
  // invoke refuses on either by the same name, so a host that cannot serve an authoring brief says
  // `unbound` BY NAME rather than compiling a test against an empty one — a plausible draft
  // authored against nothing this project knows, which is the failure that looks most like success.
  //
  // Inverting the entry above: registering THIS one DOES flip 392's `write_test` fail-closed chat
  // scenarios, because the tool name they were waiting on now exists in the catalogue the planner
  // binds 1:1. Plan 11 performs the flip and pins planned == executed.
  authoringDraftWriteSpec as FunctionSpec,
  // 2026-08-11 (394-07 D-12/D-13 · WTST-05): the honesty funnel's ONE read, beside the loop it
  // measures. It is registered rather than left a private computation for the same reason the two
  // entries above it are: the number that says whether the keep-filter is filtering must be the
  // SAME number in chat, in the CLI and in the per-run digest, and a projection reachable only
  // from whichever surface owned it would become three answers the moment the second surface
  // wanted one. Read-tier and `readOnly` — it starts nothing and writes nothing, which is D-14
  // expressed as a risk descriptor rather than as a promise.
  //
  // Bound through the OPTIONAL `authoringFunnel` bundle, whose binding site is
  // `composeLocalAgent()` in `@vostride/agent-qa-agent-local` (385 D-15 — therefore both the CLI
  // and the daemon). A host with no runtime root lists it `unbound` BY NAME rather than answering
  // an all-zero funnel: zero built with zero accepted does not read as "nothing happened", it
  // reads as a loop that filtered everything, which is the one wrong answer that would make the
  // acceptance-failure flag unable to fire on the very hosts that most need it.
  authoringFunnelGetSpec as FunctionSpec,
  // 2026-08-11 (394-09 D-21 · WTST-07): the user-facing edit, and the patch contract's SECOND real
  // consumer. Until this op existed, `applyPatchSetToTestDoc` and the RFC-6902 vocabulary had one
  // caller — the repair loop — and a contract with one consumer is a contract shaped like its one
  // caller. That is not a style objection: this project has twice paid for a one-sided contract
  // that looked correct because only one side ever exercised it (the two-sided contract law).
  //
  // It is NOT a stage of `authoring.draft.write`, which is the argument `loop-ordering.test.ts`
  // requires beside a new `authoring.` id. That pin forbids promoting a loop stage to its own
  // registered op, because a planner holding one could reorder or skip the rest. This verb takes an
  // existing COMMITTED test and a change to make to it; it has no position in the six-stage order,
  // and invoking it before, during or after a loop invocation answers the same question.
  //
  // `mutating-local` and NOT the write op's `mutating-shared`: it takes one model call, starts zero
  // runs, and writes only to the gitignored draft shelf. The consent that matters for an edit is
  // the inbox accept that turns the proposal into a commit, which 391 already owns.
  //
  // Bound through the OPTIONAL `draftShelf` bundle; `draftEvaluation` is checked by the same name
  // inside the invoke, because resolving the target's bytes and applying the patch set are two
  // halves of one capability and a host that had only one of them would list this op `bound` and
  // then fail far from whichever half was missing.
  authoringDraftEditSpec as FunctionSpec,
]

/**
 * A session deny overlay asked about the CALLER as well as the action (392 plan 13, W-03).
 *
 * The action half is safety's own {@link SessionDenyOverlay} parameter, read off that type rather
 * than re-spelled, so the adaptation at `invoke.ts`'s single `evaluate()` call-site cannot drift
 * from the descriptor the gate actually compares. `packages/safety` is untouched: this is a
 * function layer contract that NARROWS to safety's on its way to the one gate call (384 FUNC-03).
 *
 * Deny-only in both arguments. The return is a boolean whose only true branch writes a deny, and
 * the caller's session id can select WHICH deny set is consulted and nothing else — so a caller
 * carrying no session, or one naming a session this host never opened, gets the empty set.
 */
export type CallerScopedDenyOverlay = (
  action: Parameters<SessionDenyOverlay>[0],
  caller: FunctionCaller,
) => boolean

export interface CreateFunctionRegistryOptions {
  /** Host-backed implementations the ops read through; built at the composition root. */
  deps: FunctionDeps
  /**
   * Sink `evaluate()` appends its execution-audit row to. The gate is the single audit
   * author (v48): the function layer passes the sink and never writes a row itself.
   *
   * REQUIRED, on the same discipline `FunctionDeps` uses (see spec.ts): a composition that
   * omits it fails to typecheck rather than quietly arming the whole capability set with no
   * audit trail. An optional sink made the unaudited composition the EASIEST one to write,
   * which is the fast path D-11 exists to forbid.
   *
   * Required at RUNTIME too, and that is the load-bearing half: `createRegistryFromSpecs`
   * throws {@link MissingAuditSinkError} when the sink is absent or its two append methods
   * are not callable. A type binds only the callers the compiler sees; the refusal binds a
   * cast and a plain-JS consumer of the published package as well.
   */
  auditSink: AuditSink
  /**
   * Resolves the standing-approval reader the gate's ask arm consults (391, PROP-01).
   *
   * A RESOLVER rather than the reader itself, because the two ends have incompatible timing: the
   * gate's port answers synchronously, while the local composition learns its knowledge root
   * asynchronously. Awaiting the resolver once per invocation, inside `invokeFunction`'s own async
   * body, is what lets a synchronous reader be built over an asynchronously-resolved root without
   * either side pretending to be the other. It is resolved on EVERY invocation rather than cached
   * here, so a composition may hand back a reader over whatever the root currently is.
   *
   * OPTIONAL, and its absence is the shipped default: `evaluate()` falls back to the no-grants
   * reader, so a composition that omits this behaves exactly as every composition did before grants
   * existed.
   */
  standingApprovalReader?: () => StandingApprovalReader | Promise<StandingApprovalReader>
  /**
   * The interactive confirmation the gate's ask arm reaches when nothing else satisfied it.
   *
   * OPTIONAL, and its absence means `evaluate()`'s deny-by-default confirm. Note that the arm is
   * only reachable in a `local-interactive` context at all — every other context fail-closes first
   * — so a host with no terminal is right to omit it.
   */
  confirm?: ConfirmPort
  /**
   * The session-scoped DENY overlay the gate consults before its ladder (392 D-21, plan 08/13).
   *
   * TIGHTEN-ONLY BY TYPE: the hook answers a boolean whose only true branch writes a deny, so
   * "a session loosened something" is not a state this seam can represent.
   *
   * IT IS ASKED WHICH SESSION IS CALLING (392 plan 13, W-03). The overlay used to be a property
   * of "the composition's session", which is a fact no composition serving more than one
   * conversation actually has — so a `/pin` typed in one conversation denied that action class
   * for every later caller until the process restarted. The caller travels with the question
   * rather than the ANSWER travelling with the caller: `caller.sessionId` is composition-minted,
   * the overlay is deny-only, and an absent or foreign id can therefore only ever produce FEWER
   * denials. Nothing here is a permission a caller could claim.
   *
   * OPTIONAL, and its absence is the shipped default: `evaluate()` runs its ladder untouched. It
   * follows `confirm`'s precedent exactly — conditionally spread below, so an absent dependency is
   * an ABSENT field rather than a present `undefined` one.
   */
  deny?: CallerScopedDenyOverlay
  /** Defaults to safety's ambient resolver; injected in tests for determinism. */
  resolveExecutionContext?: () => ExecutionContext
}

export interface FunctionRegistry {
  /**
   * Declaration views, sorted lexicographically by id. When `caller.safeMode` is true
   * the listing hides ops whose required scopes exceed `read` — a COSMETIC filter;
   * enforcement stays server-side in `invokeFunction` (FUNC-03).
   */
  list(caller: FunctionCaller): readonly FunctionDeclaration[]
}

interface RegistryInternals {
  specs: ReadonlyMap<string, FunctionSpec>
  deps: FunctionDeps
  auditSink: AuditSink
  standingApprovalReader?: () => StandingApprovalReader | Promise<StandingApprovalReader>
  confirm?: ConfirmPort
  deny?: CallerScopedDenyOverlay
  resolveExecutionContext: () => ExecutionContext
}

const REGISTRY_INTERNALS = new WeakMap<FunctionRegistry, RegistryInternals>()

/**
 * INTERNAL seam for `invokeFunction`. Returns `undefined` for any object that did not
 * come out of `createFunctionRegistry` — such an object registers no specs at all, so
 * every id looks unknown to it.
 */
export function registryInternals(registry: FunctionRegistry): RegistryInternals | undefined {
  return REGISTRY_INTERNALS.get(registry)
}

/**
 * Freeze the parts of a spec enforcement reads (CR-04).
 *
 * The specs are module-level singletons, so a write reached through ONE listing used to
 * change what every registry in the process enforced. Freezing is idempotent and happens
 * at registration, which closes the escalation by whatever route a caller reaches the spec.
 *
 * The live `input`/`output` zod objects are deliberately NOT frozen: freezing a schema's
 * internals would break zod's own lazy caching. That is safe now for a structural reason
 * rather than a hopeful one — a declaration carries an inert projection, so no surface is
 * ever handed the schema object in the first place (BL-01). The earlier rationale here,
 * that freezing the spec made those properties unwritable, was a category error: it sealed
 * the property SLOT while the object it pointed at stayed wide open.
 *
 * WR-03: registration FREEZES the spec objects it is given, permanently and in place. Pass
 * a fresh object if the caller needs a mutable one afterwards.
 */
function freezeSpec(spec: FunctionSpec): FunctionSpec {
  Object.freeze(spec.requiredScopes)
  Object.freeze(spec.risk)
  return Object.freeze(spec)
}

/**
 * Whether THIS composition can run the op (D-09/D-16) — the one place the answer is decided.
 *
 * A spec with no `boundThrough` needs only the required deps, which the type system already
 * guarantees, so it is bound wherever it is registered. A spec that names an optional dep is
 * bound iff this composition supplied one. Nothing is read off a static field, because there
 * is none to read: the alternative — a literal on the spec — is a claim a module-level
 * singleton makes about every composition in the process, and it would report `bound` from
 * the first host that omitted the implementation.
 *
 * Exported for `invokeFunction`, which refuses on the SAME answer a listing renders. Two
 * computations of "is it bound" would be two chances to disagree, and the disagreement a
 * caller would see is a capability that lists bound and refuses.
 */
export function resolveBindingStatus(
  spec: FunctionSpec,
  deps: FunctionDeps,
): FunctionBindingStatus {
  if (spec.boundThrough === undefined) return 'bound'
  return deps[spec.boundThrough] === undefined ? 'unbound' : 'bound'
}

/**
 * Project one spec into the capability-free view a surface receives.
 *
 * Constructed field by field rather than spread-minus-invoke, so a future spec field can
 * never leak the implementation into a listing by accident.
 *
 * COPY or PROJECT, then freeze — the view aliases nothing on the spec. The scalars are
 * copied, the two contracts become inert JSON-Schema projections, and the whole graph is
 * frozen. What a caller holds after this is data: there is no live validator on it to
 * replace, so a permitted listing is no longer a write handle onto the contract vocabulary
 * every firewalled surface shares (T-384-14).
 */
function declarationView(spec: FunctionSpec, deps: FunctionDeps): FunctionDeclaration {
  return Object.freeze({
    id: spec.id,
    summary: spec.summary,
    requiredScopes: Object.freeze([...spec.requiredScopes]),
    // 391 D-06: carried onto the declaration for the reason `requiredScopes` is — what a caller
    // was SHOWN and what the gate enforces read the same field, so a chat toolset that filters
    // the verb out of its listing and `invokeFunction` refusing it cannot disagree (D-16). The
    // filter is UX; this field's enforcement is one check in the dispatch path.
    ...(spec.requiresHumanOrigin === undefined ? {} : { requiresHumanOrigin: true as const }),
    resultKind: spec.resultKind,
    bindingStatus: resolveBindingStatus(spec, deps),
    input: toSchemaProjection(spec.input),
    output: toSchemaProjection(spec.output),
    risk: Object.freeze({ ...spec.risk }),
  })
}

/**
 * Refuse a construction that cannot produce an audit trail (BL-03 / D-11).
 *
 * One check at the ONE seam that populates the internals record, covering the three live
 * routes together: the field omitted or cast past the type, and a hollow object whose
 * append methods are absent or not callable. The methods are probed rather than the shape
 * asserted, because what the gate needs at dispatch time is two things it can call.
 */
function requireAuditSink(supplied: AuditSink | undefined | null): AuditSink {
  if (supplied === undefined || supplied === null) {
    throw new MissingAuditSinkError('no sink was supplied')
  }
  if (
    typeof supplied.appendExecutionAudit !== 'function' ||
    typeof supplied.appendGuardrailAudit !== 'function'
  ) {
    throw new MissingAuditSinkError(
      'the supplied sink does not implement callable appendExecutionAudit and ' +
        'appendGuardrailAudit methods',
    )
  }
  return supplied
}

/**
 * INTERNAL: registry construction over an explicit spec set. Exported for tests and
 * future in-layer compositions, and deliberately absent from the package barrel — a
 * surface that could supply its own specs could mint capabilities the catalog never
 * declared.
 *
 * WR-03: every spec handed here is FROZEN in place, permanently. Pass a fresh object if
 * the caller needs a mutable one afterwards.
 */
export function createRegistryFromSpecs(
  specs: readonly FunctionSpec[],
  options: CreateFunctionRegistryOptions,
): FunctionRegistry {
  // Before anything is registered: a registry that cannot audit must not come to exist,
  // rather than come to exist and dispatch silently.
  const auditSink = requireAuditSink(options.auditSink as AuditSink | undefined | null)

  const byId = new Map<string, FunctionSpec>()
  for (const spec of specs) {
    if (byId.has(spec.id)) {
      throw new DuplicateFunctionIdError(spec.id)
    }
    byId.set(spec.id, freezeSpec(spec))
  }

  const sorted = [...byId.values()].sort((left, right) => (
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  ))

  const registry: FunctionRegistry = {
    list(caller) {
      return sorted
        .filter((spec) => (
          !caller.safeMode ||
          spec.requiredScopes.every((scope) => SAFE_MODE_SCOPES.includes(scope))
        ))
        .map((spec) => declarationView(spec, options.deps))
    },
  }

  REGISTRY_INTERNALS.set(registry, {
    specs: byId,
    deps: options.deps,
    auditSink,
    // Conditionally spread rather than assigned through: an absent gate dependency must be an
    // ABSENT field and not a present `undefined` one, so the gate's own defaulting is what decides
    // the no-grants and deny-confirm behaviour, in exactly one place.
    ...(options.standingApprovalReader === undefined
      ? {}
      : { standingApprovalReader: options.standingApprovalReader }),
    ...(options.confirm === undefined ? {} : { confirm: options.confirm }),
    ...(options.deny === undefined ? {} : { deny: options.deny }),
    resolveExecutionContext: options.resolveExecutionContext ?? getActiveExecutionContext,
  })

  return registry
}

/** Build the registry of built-in capabilities over composition-supplied dependencies. */
export function createFunctionRegistry(
  options: CreateFunctionRegistryOptions,
): FunctionRegistry {
  return createRegistryFromSpecs(BUILT_IN_FUNCTION_SPECS, options)
}
