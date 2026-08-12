// `proposals.accept` — the human decision surface, and the ONE door to a standing grant
// (Phase 391, PROP-01 / D-01 · D-02 · D-04 · D-06).
//
// TWO FORMS, ONE SURFACE (D-01). Plain accept applies THIS proposal and mints nothing.
// `always: true` applies it AND records a standing approval covering the kind's apply verb. That
// is the whole of "approves/rejects UNTIL they grant standing approval": the escalation is a flag
// on the same decision a person was already making, so it cannot be reached without deciding, and
// it cannot happen by accident. Grants never accrete silently, and this file is the only place in
// the layer where one can be minted at all — there is no `grants.record` op, deliberately.
//
// THE GATE NEVER MINTS (D-02). The policy gate is pure enforcement: it has no write path and it
// persists no blocked-call arguments. The mint happens HERE, inside this op's dispatch, AFTER the
// gate allowed the invocation — so "the system recorded that you approved this" can only follow a
// call the system was allowed to make.
//
// ONE COMMIT PATH (D-02, again). The apply goes through the SAME `KnowledgeReviewPort.apply` that
// `knowledge.proposal.apply` binds through, and NOT by invoking that op. Op-calling-op would put a
// second gate evaluation and a second audit row in front of one human decision, and would make the
// accept's own verdict advisory. Port-level reuse keeps exactly one place where committed knowledge
// changes.
//
// THE ACTION CLASS IS PRODUCED, NEVER TYPED (D-04). What the grant covers is read off the target
// op's own `risk.name` through {@link APPLY_ACTION_CLASS_FOR_PROPOSAL_KIND}. The gate compares
// `grant.actionClass === action.name` with `===`, so a hand-typed literal here would keep matching
// a name the op had stopped carrying — and the failure is SILENT, because a grant that matches
// nothing parses, folds, lists and reads as authorization forever.
//
// `requiresHumanOrigin: true` (D-06). An agent that could accept its own proposals would be an
// agent that approves itself, and one that could accept-with-always would be an agent that GRANTS
// itself standing approval — the exact self-escalation PROP-05 closes. Refused as data on the op,
// checked once at the single dispatch pipeline, never as a branch on which surface called.
//
// `declaredTier: 'mutating-shared'`, and `fn:proposals.accept` is a PROTECTED class. Those two
// facts together are the point rather than a redundancy: the tier makes every accept an ASK, and
// the protected membership means that ask is one no standing approval may ever satisfy. A session
// that could pre-approve accepting would have talked its way out of every other rule in one step.
// The consequence, stated plainly rather than discovered: in a fail-closed context — which is
// every context except an interactive terminal — an accept with no trust credential DENIES. The
// ways through are an interactive confirmation (the CLI binds one), session trust, or a credential.
//
// THREE DEPS, ONE `boundThrough`. This op needs the inbox (to learn which KIND it is deciding), the
// kind's apply port (to commit), and the grants port (to mint). `boundThrough` names ONE, and it
// names the inbox because that is the first thing this verb touches and the thing whose absence
// means "this host has no proposals at all". What dispatch does with that name is exactly one key:
// `resolveBindingStatus` returns `deps[spec.boundThrough] === undefined ? 'unbound' : 'bound'`, so
// the registry checks the inbox and nothing else. The other two are checked inside `invoke` — the
// apply port at the route, and the grants port AFTER the apply has already committed. In practice
// `composeLocalAgent` binds all three together, because all three are facts about a host that owns
// a knowledge root.

import {
  PROPOSAL_KINDS,
  ProposalsAcceptInputSchema,
  ProposalsAcceptOutputSchema,
  STANDING_APPROVAL_SCOPE,
} from '@vostride/agent-qa-schema'
import type {
  ProposalInboxEntryDto,
  ProposalKind,
  ProposalsAcceptApplied,
  ProposalsAcceptGrantOutcome,
  ProposalsAcceptInput,
  ProposalsAcceptOutcome,
  ProposalsAcceptOutput,
} from '@vostride/agent-qa-schema'

import { FunctionNotBoundError } from '../spec.js'
import type { FunctionDeps, FunctionSpec } from '../spec.js'
import { knowledgeProposalApplySpec } from './knowledge-proposal-apply.js'

/** The literal appears here once; every surface names the constant (384 D-15). */
export const PROPOSALS_ACCEPT_FUNCTION_ID = 'proposals.accept'

/**
 * This verb's own gate-seen action name, spelled once and read by the spec below AND by the
 * `finding` route — so the two cannot drift into naming different classes for the same op.
 */
const PROPOSALS_ACCEPT_ACTION_CLASS = `fn:${PROPOSALS_ACCEPT_FUNCTION_ID}`

/**
 * How one proposal kind is committed, and therefore what a standing approval over it covers.
 *
 * A TOTAL `Record` over {@link PROPOSAL_KINDS} rather than a switch with a default: 393's test
 * drafts, 395's config and 396's MCP projection each add a kind, and a kind that arrives without an
 * answer here must fail to COMPILE rather than fall through to whatever the knowledge arm does.
 *
 * The two members of a route are deliberately in ONE object. Keeping "which port commits it" and
 * "which class a grant over it covers" together is what stops the mint from recording an approval
 * for a verb the apply did not actually use — the two would otherwise be two tables free to agree
 * today and disagree after the first routing change.
 */
type ProposalEnvelopeDto = ProposalInboxEntryDto['envelope']

/** The payload arm that travels with one kind. Correlated, so a route cannot read another's. */
type ProposalPayloadFor<K extends ProposalKind> = Extract<ProposalEnvelopeDto, { kind: K }>['payload']

interface ProposalApplyRoute<K extends ProposalKind> {
  /** The gate-seen action name, READ off the committing op's own descriptor. Never a literal. */
  readonly actionClass: string
  /** Commit through the port the committing op itself binds through — never by invoking it. */
  apply(
    deps: FunctionDeps,
    proposalId: string,
    payload: ProposalPayloadFor<K>,
  ): Promise<ProposalsAcceptApplied>
}

const ROUTE_FOR_KIND: Readonly<{ [K in ProposalKind]: ProposalApplyRoute<K> }> = Object.freeze({
  knowledge: {
    actionClass: knowledgeProposalApplySpec.risk.name,
    async apply(deps: FunctionDeps, proposalId: string): Promise<ProposalsAcceptApplied> {
      const review = deps.knowledgeReview
      if (review === undefined) throw new FunctionNotBoundError(PROPOSALS_ACCEPT_FUNCTION_ID)
      return { kind: 'knowledge', outcome: await review.apply(proposalId) }
    },
  },
  // 394 D-05/D-06: accepting a verified draft WRITES it into the suite and makes ONE git commit
  // containing exactly that file.
  //
  // ITS COVERED CLASS IS THIS VERB'S OWN (394-16, resolving CR-04). The write goes through the
  // bound {@link FunctionDeps.draftApply} port, and a port is not a gated op: no `evaluate()` ever
  // runs with a class of its own, so the only class a grant over this kind can truthfully cover is
  // the accept's. `fn:proposals.accept` is in the closed protected set, so accept-with-always over
  // a test-draft is refused as `protected-class` beside a successful apply, and every draft accept
  // is an individual human decision. An entry naming a class no registered op carries is a red
  // build: `__tests__/apply-action-classes.test.ts` ranges this table against the live registry.
  //
  // THE PAYLOAD TRAVELS TO THE PORT. It was minted that way because nothing on any host persisted
  // a `test-draft` record, so a port taking an id alone would have been asking a host to look up
  // something no store could hold; 394-18 landed that store and the shape is KEPT on its own
  // merits. This op has ALREADY read the envelope — that is how it knows which route to dispatch —
  // so handing the payload it is holding to the route it chose is one read. An id would make the
  // host read the same record again, with a window in between in which the two reads can disagree
  // about the very `sourceDigest` the apply re-checks.
  'test-draft': {
    actionClass: PROPOSALS_ACCEPT_ACTION_CLASS,
    async apply(
      deps: FunctionDeps,
      proposalId: string,
      payload: ProposalPayloadFor<'test-draft'>,
    ): Promise<ProposalsAcceptApplied> {
      // AN UNBOUND APPLY REFUSES BY NAME. An accept that reported `applied` while writing nothing
      // would be a wrong answer wearing a correct one's clothes: the inbox would show a decision
      // the repository never received, and the person would go looking for a commit that is not
      // there. `FunctionNotBoundError` is the shipped spelling — the knowledge arm above raises the
      // same class for the same condition, and a parallel class would be a second vocabulary for
      // one fact.
      const draftApply = deps.draftApply
      if (draftApply === undefined) throw new FunctionNotBoundError(PROPOSALS_ACCEPT_FUNCTION_ID)
      const written = await draftApply.apply({
        proposalId,
        // The SHELF path is where the accepted bytes come from, and `targetPath` is where they go.
        // Both ride the arm; neither is recomputed here, because a second recipe for either would
        // be free to disagree with the one `sourceDigest` was taken over.
        draftPath: payload.draftRef.filePath,
        targetPath: payload.targetPath,
        ...(payload.sourceDigest === undefined ? {} : { sourceDigest: payload.sourceDigest }),
        summaryLine: payload.summaryLine,
      })
      // THE DECISION IS RECORDED AFTER THE COMMIT, and the ORDER is the decision (394-18).
      //
      // Recording first would mark a proposal applied for a write that may then refuse — a dirty
      // target, a target that moved, git absent — and the inbox would show a decision the
      // repository never received. Recording after leaves exactly one narrow window: a commit that
      // succeeded and a store write that did not, which surfaces as a throw carrying the caller's
      // own error rather than a silent success, and leaves the proposal PENDING beside a real
      // commit. That is the recoverable direction of the two: the person can see both.
      await recordDecision(deps, proposalId)
      return {
        kind: 'test-draft',
        outcome: { filePath: written.filePath, commit: written.commit },
      }
    },
  },
  // 394 D-11: ACKNOWLEDGE-ONLY. Accepting a finding records the decision and does nothing else —
  // no file, no commit, no issue filed. The decision trail 391 already keeps is the entire effect,
  // which is what "record-and-surface" means, and it is why this arm needs no port at all.
  //
  // ITS COVERED CLASS IS THIS VERB'S OWN, AND THAT IS THE DECISION RATHER THAN A CONVENIENCE.
  // There is no committing op to read a class off, so the only honest answer to "what would a
  // standing approval over acknowledging findings cover" is the accept itself — and
  // `fn:proposals.accept` is a PROTECTED class, so such a grant can never be minted. Nobody may
  // pre-approve acknowledging what the loop says is an application defect: an acknowledgement is
  // a person having looked, and a standing one is a person having stopped looking. The mint
  // refuses as DATA beside a successful apply, so the decision is still recorded.
  finding: {
    actionClass: PROPOSALS_ACCEPT_ACTION_CLASS,
    async apply(deps: FunctionDeps, proposalId: string): Promise<ProposalsAcceptApplied> {
      // THE RECORDING IS THE WHOLE EFFECT HERE (394-18). Acknowledging a finding writes no file
      // and makes no commit, so if this call did nothing the acknowledgement would leave no trace
      // anywhere and the inbox would keep asking for a decision a person had already made. The arm
      // that "needs no port at all" needed exactly this one.
      await recordDecision(deps, proposalId)
      return { kind: 'finding', outcome: { acknowledged: true } }
    },
  },
})

/**
 * Close the proposal's own lifecycle after a route committed (394-18 · WINDOWS 99 / 102).
 *
 * ONE HELPER FOR THE TWO ARMS THAT NEED IT, and the knowledge arm deliberately does not call it:
 * `KnowledgeReviewPort.apply` publishes the applied record as part of committing the deltas, so a
 * second write here would be a second answer to when that proposal was decided.
 *
 * A NON-`recorded` ANSWER IS A REFUSAL, not a shrug. Every other arm means the store found the
 * proposal in a state a decision cannot be taken from — already decided, mid-apply, or absent — and
 * the apply that just ran did so against an envelope the accept had already read. Reporting
 * `applied` over it would produce a funnel whose `accepted` stage disagrees with its own store.
 */
async function recordDecision(deps: FunctionDeps, proposalId: string): Promise<void> {
  const inbox = deps.proposalsInbox
  if (inbox === undefined) throw new FunctionNotBoundError(PROPOSALS_ACCEPT_FUNCTION_ID)
  const recorded = await inbox.recordApplied({ proposalId })
  if (recorded.outcome !== 'recorded') {
    throw new TypeError(
      `proposals.accept applied ${proposalId} but the decision could not be recorded: `
        + `the store answered ${recorded.outcome}`,
    )
  }
}

/**
 * Dispatch one envelope to its own route, with its own payload.
 *
 * A SWITCH BESIDE THE TOTAL `Record`, and the pair is not a redundancy. The Record makes a new
 * `PROPOSAL_KINDS` member fail to compile for want of a ROUTE; this switch makes it fail to compile
 * for want of a CORRELATION — `ROUTE_FOR_KIND[envelope.kind].apply(…, envelope.payload)` written
 * directly does not typecheck, because the index and the payload are each the whole union and
 * nothing relates them. The alternative was a route taking the payload union and re-narrowing
 * inside itself, which is a second classification of one value, free to disagree with the first.
 *
 * No `default:` and no cast. The closing arm assigns to `never`, so a fourth kind is a compile
 * error here as well as at the Record above.
 */
function applyEnvelope(
  deps: FunctionDeps,
  proposalId: string,
  envelope: ProposalEnvelopeDto,
): Promise<ProposalsAcceptApplied> {
  switch (envelope.kind) {
    case 'knowledge':
      return ROUTE_FOR_KIND.knowledge.apply(deps, proposalId, envelope.payload)
    case 'test-draft':
      return ROUTE_FOR_KIND['test-draft'].apply(deps, proposalId, envelope.payload)
    case 'finding':
      return ROUTE_FOR_KIND.finding.apply(deps, proposalId, envelope.payload)
    default: {
      const unhandled: never = envelope
      throw new TypeError(`proposals.accept: unhandled proposal kind ${JSON.stringify(unhandled)}`)
    }
  }
}

/**
 * The class a standing approval over each kind covers — the PRODUCED spelling, published.
 *
 * Exported so a differential can range it rather than restate it, and
 * `__tests__/apply-action-classes.test.ts` is that differential. What it checks, stated as what it
 * checks rather than as a property this module asserts about itself: every entry is the `risk.name`
 * of EXACTLY ONE op in the live registry listing, so an entry naming a class nothing evaluates —
 * the state the `test-draft` row shipped in until 394-16 — is a red build rather than a grant that
 * matches nothing forever. It also pins WHICH entries are members of the closed protected set.
 *
 * The partition is per kind and it is a decision at each row. `knowledge` reads its class off the
 * registered apply op and is grantable. `finding` and `test-draft` both carry this verb's own
 * class — the first because acknowledging an application defect has no committing op at all, the
 * second because its write rides a port that is never gate-evaluated — and both are therefore
 * protected, so neither can be pre-approved.
 */
export const APPLY_ACTION_CLASS_FOR_PROPOSAL_KIND: Readonly<Record<ProposalKind, string>> =
  Object.freeze(
    Object.fromEntries(
      PROPOSAL_KINDS.map((kind) => [kind, ROUTE_FOR_KIND[kind].actionClass]),
    ) as Record<ProposalKind, string>,
  )

/** Nothing was asked for, so nothing was minted — the D-01 answer to a plain accept. */
const GRANT_NOT_REQUESTED: ProposalsAcceptGrantOutcome = { kind: 'not-requested' }

/** The escalation was asked for, but the apply never happened — so nothing may be recorded. */
const GRANT_NOT_APPLIED: ProposalsAcceptGrantOutcome = { kind: 'not-applied' }

/**
 * The ONE refusal this op folds into data, named as a string because the class is unimportable.
 *
 * Nothing else may be folded. A lease refusal, an egress refusal and a contract refusal are
 * different facts about different problems, and reporting any of them as ledger damage would send
 * an operator to repair a file that is perfectly readable.
 *
 * WHAT THE FOLD LEAVES OUT, OBSERVED RATHER THAN INFERRED. Read at submodule commit `d7966f04` on
 * 2026-08-08 with `grep -n 'throw new\|\.parse(\|new Grant' packages/knowledge-local/src/grants/operations.ts`,
 * the raisers that port declared on its `record` path were five: `GrantLedgerDamagedError` (`:214`),
 * `GrantWriteBlockedError` (`:236`), a `GrantRecordInputSchema.parse` failure (`:269`),
 * `GrantLeaseHeldError` (class at `:108`, raised from the lease wrapper at `:227`), and version or
 * fs errors propagating out of `readActive` (`:210`). Only the first is folded here. The other four
 * leave `invoke` and take the whole `{apply, grant}` payload with them, so a caller is told their
 * accept failed for a knowledge commit that is already durable on disk.
 *
 * That asymmetry is a DECISION taken in gap-closure round 4, not an omission. Re-applying is
 * idempotent, so the cost is operator confusion rather than corruption. It is not an exotic edge
 * either: a version conflict out of `readActive` is among the four. Note what that case actually
 * is — an ordinary same-version pull does NOT throw. `create-version-guard.ts:53-63` raises only
 * when the pulled line carries `schemaVersion` GREATER than this build's current version, or when
 * a migration step between the stored and current versions is missing. So the reachable case is a
 * teammate on a NEWER schema committing a line that you then pull onto an older build.
 */
const GRANT_LEDGER_DAMAGED_ERROR_NAME = 'GrantLedgerDamagedError'

function isGrantLedgerDamaged(error: unknown): error is Error {
  return error instanceof Error && error.name === GRANT_LEDGER_DAMAGED_ERROR_NAME
}

/**
 * The refused lines off an error whose shape this package cannot type — read defensively.
 *
 * `name` and `message` are always there; `refusedLines` is a property of an implementation class
 * across a boundary, so it is kept only when it is genuinely an array of `{lineNumber, reason}`.
 * The degradation is honest rather than silent: the composed CLI case asserts this array is
 * NON-EMPTY and names the damaged line, so an extraction that started returning `[]` reds instead
 * of shipping a refusal that names nothing.
 */
function refusedLinesOf(error: Error): { lineNumber: number; reason: string }[] {
  const candidate = (error as { refusedLines?: unknown }).refusedLines
  if (!Array.isArray(candidate)) return []
  return candidate.flatMap((line: unknown) => {
    if (typeof line !== 'object' || line === null) return []
    const { lineNumber, reason } = line as { lineNumber?: unknown; reason?: unknown }
    if (typeof lineNumber !== 'number' || !Number.isInteger(lineNumber) || lineNumber < 1) return []
    if (typeof reason !== 'string' || reason.length === 0) return []
    return [{ lineNumber, reason }]
  })
}

export const proposalsAcceptSpec: FunctionSpec<ProposalsAcceptInput, ProposalsAcceptOutput> = {
  id: PROPOSALS_ACCEPT_FUNCTION_ID,
  summary: 'Apply a pending proposal, optionally recording a standing approval for its kind.',
  // BOTH scopes, and the pair is the honest description of what one call can do: it commits
  // knowledge (or, later, config) AND it can change what the system may do without asking. A
  // caller holding only one of them is holding half the power this verb exercises.
  requiredScopes: ['knowledge-write', 'approval-write'],
  requiresHumanOrigin: true,
  resultKind: 'unary',
  boundThrough: 'proposalsInbox',
  input: ProposalsAcceptInputSchema,
  output: ProposalsAcceptOutputSchema,
  risk: {
    name: PROPOSALS_ACCEPT_ACTION_CLASS,
    recognized: true,
    readOnly: false,
    declaredTier: 'mutating-shared',
  },
  async invoke(input, deps: FunctionDeps): Promise<ProposalsAcceptOutput> {
    const inbox = deps.proposalsInbox
    if (inbox === undefined) throw new FunctionNotBoundError(PROPOSALS_ACCEPT_FUNCTION_ID)

    // The KIND is read off the envelope rather than assumed, which is what keeps this verb generic
    // over 393-396's payload arms — and what lets the mint below name the class the apply actually
    // used. Reading it also gives the four refusals below their evidence for free.
    const shown = await inbox.show({ proposalId: input.proposalId })
    const apply = await resolveApply(deps, input, shown)

    if (apply.outcome !== 'applied') {
      // NOTHING IS MINTED WHEN NOTHING WAS APPLIED. A standing approval recorded beside an apply
      // that did not happen would be autonomy widened by a call that decided nothing.
      return { apply, grant: input.always === true ? GRANT_NOT_APPLIED : GRANT_NOT_REQUESTED }
    }
    if (input.always !== true) {
      // D-01, as the only line that matters: the plain form reaches no mint at all. Not a mint that
      // declines — no call. The grants dep is not even consulted, so a plain accept on a host that
      // binds no grants port behaves identically to one that does.
      return { apply, grant: GRANT_NOT_REQUESTED }
    }

    // REACHABILITY OF THIS THROW, OBSERVED RATHER THAN ASSUMED. At submodule commit `d7966f04` on
    // 2026-08-08, `grep -rn 'createFunctionRegistry(' packages --include=*.ts | grep -v '/dist/' |
    // grep -v '__tests__'` returned two lines: the definition at `registry.ts:401`, and one call
    // site, `agent-local/src/composition/compose-local-agent.ts:1388`. In that composition
    // `proposalsInbox:` (`:1498`) and `standingGrants:` (`:1529`) were both plain properties of the
    // one `deps` literal, bound unconditionally, so on the shipped host of that tree this throw was
    // not reachable. It becomes reachable the first time a host composes partially — the milestone's
    // MCP projection phase is the first candidate to do so.
    const grants = deps.standingGrants
    if (grants === undefined) throw new FunctionNotBoundError(PROPOSALS_ACCEPT_FUNCTION_ID)

    // The mint's refusal arms — protected-class above all — come back as DATA and travel BESIDE the
    // apply outcome rather than replacing it. The apply already committed; a caller told only about
    // the refusal would have no receipt for a change that really happened.
    //
    // The TRY IS PART OF THAT RULE, not a hedge against it (391-12). The port raises rather than
    // answers when the committed grant ledger carries a line it cannot read — a refusal to DECIDE,
    // which is not a decision and therefore not an arm the port may have. Uncaught, that throw
    // leaves `invoke` and takes this whole payload with it, telling a person their accept failed
    // for a knowledge commit that is already durable on disk. So it is folded into `ledger-damaged`
    // HERE, at the one seam where something has already committed by the time the mint runs.
    let grant: ProposalsAcceptGrantOutcome
    try {
      grant = await grants.record({
        actionClass: ROUTE_FOR_KIND[apply.applied.kind].actionClass,
        scope: STANDING_APPROVAL_SCOPE,
        // The provenance link, and the ONLY one: the envelope deliberately carries no grant
        // reference, so this id pointing back is the whole of the relation (391-02's argument that
        // two copies of a link is how one of them starts pointing at nothing).
        proposalId: input.proposalId,
      })
    } catch (error) {
      // MATCHED BY NAME, NOT BY CLASS, and the reason is architectural rather than stylistic: this
      // package declares against the schema-owned `StandingGrantsPort` and may not import the
      // `knowledge-local` implementation that raises the error — that import edge is exactly what
      // `validate:arch` refuses. The cost of the choice, stated rather than discovered: a rename on
      // the raising side stops this match SILENTLY. What holds the line is not a type but the
      // composed case in `cli/…/proposals-digest-commands.test.ts`, which drives the production CLI
      // composition end to end over a real damaged ledger and reds the moment the name stops
      // matching.
      if (!isGrantLedgerDamaged(error)) throw error
      grant = {
        kind: 'ledger-damaged',
        reason: `${error.name}: ${error.message}`,
        refusedLines: refusedLinesOf(error),
      }
    }

    return { apply, grant }
  },
}

/**
 * The four situations in which an accept commits nothing, and the one in which it does.
 *
 * Every one of them is an ARM rather than a throw, the same posture the inbox's reject verb takes
 * for the same four: a retrying surface, two people on two machines, a race with an in-flight
 * apply and a mistyped id are all ordinary, and each is answered with what actually happened.
 *
 * An ALREADY-APPLIED proposal is deliberately NOT refused here — it is routed, because the apply
 * port answers `already-applied` WITH the receipt, and "look at what it did" is what a person
 * asking twice actually wants. Refusing it would have been the arm that discards the answer.
 */
async function resolveApply(
  deps: FunctionDeps,
  input: ProposalsAcceptInput,
  shown: Awaited<ReturnType<NonNullable<FunctionDeps['proposalsInbox']>['show']>>,
): Promise<ProposalsAcceptOutcome> {
  if (shown.kind === 'not-found') {
    return { outcome: 'not-found', proposalId: input.proposalId }
  }
  const { entry } = shown
  if (entry.envelope.status === 'rejected') {
    return { outcome: 'already-rejected', entry }
  }
  if (entry.envelope.status === 'expired') {
    return { outcome: 'expired', entry }
  }
  if (entry.applyInFlight) {
    return { outcome: 'apply-in-flight', proposalId: input.proposalId }
  }
  return {
    outcome: 'applied',
    applied: await applyEnvelope(deps, input.proposalId, entry.envelope),
  }
}
