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
  ProposalOrigin,
  ProposalsAcceptApplied,
  ProposalsAcceptGrantOutcome,
  ProposalsAcceptInput,
  ProposalsAcceptOutcome,
  ProposalsAcceptOutput,
} from '@vostride/agent-qa-schema'

import { applyablePayload } from '../../config-mutation/construct.js'
import { FunctionNotBoundError } from '../spec.js'
import type { ClauseVerdict, FunctionDeps, FunctionSpec } from '../spec.js'
import { configProposalApplySpec } from './config-proposal-apply.js'
import { knowledgeProposalApplySpec } from './knowledge-proposal-apply.js'

/** The literal appears here once; every surface names the constant (384 D-15). */
export const PROPOSALS_ACCEPT_FUNCTION_ID = 'proposals.accept'

/**
 * This verb's own gate-seen action name, spelled once and read by the spec below AND by the
 * `test-draft` route — so the two cannot drift into naming different classes for the same op.
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
    /**
     * The envelope's own provenance, travelling BESIDE the payload (400-05).
     *
     * ON THE SHARED SIGNATURE RATHER THAN ON THE ONE ARM THAT READS IT, because provenance is a
     * fact about every envelope and not about the config arm's change. A per-arm parameter would
     * have made the next route that needs it a second widening of this contract; today exactly one
     * route reads it, and the others ignoring it is the honest shape of that.
     */
    origin: ProposalOrigin | undefined,
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
  // 395 D-01/D-02 · CFGM-03: accepting a config proposal makes ONE commit in the person's own
  // repository containing exactly the files the proposal names.
  //
  // ITS COVERED CLASS IS THE COMMITTING OP'S, READ OFF `risk.name` — the KNOWLEDGE shape rather than
  // the 394 arm's, and the difference is a decision. `config.proposal.apply` is a REGISTERED op
  // carrying its own class, so a gate really does evaluate that name, so a standing approval over it
  // is a grant that can match something. `fn:config.proposal.apply` is deliberately NOT in the
  // closed protected set: D-02 puts the protection on the PROPOSAL — the per-value `crossBoundary`
  // flag — rather than on the class, because cross-boundary-ness is a fact about a base URL pointing
  // somewhere new, which no per-op map can see.
  //
  // THE TWO SIDES OF THAT FLAG, AND WHERE EACH ONE LIVES (395-07). The MINT half is in `invoke`
  // below: an accept-with-always on a flagged proposal answers the `cross-boundary` arm and calls
  // the grants port not at all. The READ half is NOT here, and its absence is a decision rather
  // than an omission — this verb's own class `fn:proposals.accept` is in the closed protected set,
  // so `grantsFor` never returns a line covering it and no covering grant is ever consulted on this
  // route in the first place. A filter placed here would be a mechanism at a seam where the thing
  // it filters is never read. The read half lives where a grant CAN satisfy an ask over config —
  // `config.proposal.apply`, the grantable class — and it is stated in that file's header.

  //
  // THE PAYLOAD TRAVELS TO THE PORT, on the test-draft arm's stated reasoning: this op has ALREADY
  // read the envelope — that is how it knows which route to dispatch — so handing the payload it is
  // holding to the route it chose is ONE read. An id would make the host read the same record again
  // with a window in between in which the two reads can disagree about the very `baseDigest` the
  // apply re-checks. `config.proposal.apply` reaches the SAME port after doing that one read itself.
  config: {
    actionClass: configProposalApplySpec.risk.name,
    async apply(
      deps: FunctionDeps,
      proposalId: string,
      payload: ProposalPayloadFor<'config'>,
      origin: ProposalOrigin | undefined,
    ): Promise<ProposalsAcceptApplied> {
      const configApply = deps.configApply
      if (configApply === undefined) throw new FunctionNotBoundError(PROPOSALS_ACCEPT_FUNCTION_ID)
      // 400-05: WHO PROPOSED, off the envelope this accept already read — never off this process.
      // The surface accepting a proposal is routinely not the surface that minted it (a dashboard
      // conversation proposes; a person accepts it from the CLI inbox the next morning), so reading
      // the applying side here would be attributing the commit to the wrong door precisely in the
      // case the field exists for.
      const outcome = await configApply.apply({
        proposalId,
        payload: applyablePayload(payload),
        ...(origin?.surface === undefined ? {} : { mintedSurface: origin.surface }),
      })
      // THE DECISION IS RECORDED AFTER THE COMMIT, and only when a commit was MADE. CFGM-03's
      // idempotency edge is why the second half is a condition rather than an unconditional call:
      // an `already-applied` answer means the store recorded this decision the first time, and
      // `recordApplied` refuses a proposal it has already decided — so recording again would turn
      // the honest idempotent answer into a thrown error about a commit that is exactly where the
      // person left it.
      if (outcome.outcome === 'applied') await recordDecision(deps, proposalId)
      return { kind: 'config', outcome }
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
      return ROUTE_FOR_KIND.knowledge.apply(deps, proposalId, envelope.payload, envelope.origin)
    case 'test-draft':
      return ROUTE_FOR_KIND['test-draft'].apply(deps, proposalId, envelope.payload, envelope.origin)
    case 'config':
      return ROUTE_FOR_KIND.config.apply(deps, proposalId, envelope.payload, envelope.origin)
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
 * registered apply op and is grantable. `test-draft` carries this verb's own class, because its
 * write rides a port that is never gate-evaluated, and is therefore protected — no standing
 * approval over draft accepts can be minted.
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
 * The MINT HALF of 395 D-02: a cross-boundary proposal may not be pre-approved (395-07).
 *
 * WHAT IS REFUSED IS THE PROPOSAL, NOT THE CLASS, and the distinction is the decision. The
 * `protected-class` arm one level down refuses a class no approval may ever cover, and it is a fact
 * about the op. `fn:config.proposal.apply` is deliberately NOT such a class — an in-scope config
 * change IS a reasonable thing to pre-approve, and D-02 says so — so the only thing that can carry
 * the refusal is the per-VALUE flag the construction computed. A static per-op map could not see a
 * base URL edited to point at a new origin, which is the whole reason the flag exists.
 *
 * READ OFF THE ENVELOPE THIS CALL ALREADY HOLDS, never re-read by id. `invoke` has the `show`
 * answer in hand — that is how it knew which route to dispatch — and a second read here would open
 * exactly the disagreement window the route's own payload-travels-to-the-port rule closes: two
 * reads of one record with a decision taken between them can disagree about the very flag this
 * refusal turns on.
 *
 * NARROWED ON THE PAYLOAD'S OWN DISCRIMINANT. A `blocked` payload never reaches the mint at all
 * (`resolveApply` answers `not-applyable` above), and it carries no flag to read; narrowing here
 * rather than assuming that is what keeps the two classifications from being two.
 *
 * ANSWERS `undefined` FOR EVERY OTHER KIND, which is the honest shape: knowledge and test-draft
 * proposals have no per-value boundary flag, and inventing `false` for them would be this
 * function claiming to have classified something it never looked at.
 */
function crossBoundaryRefusal(
  shown: Awaited<ReturnType<NonNullable<FunctionDeps['proposalsInbox']>['show']>>,
): ProposalsAcceptGrantOutcome | undefined {
  if (shown.kind === 'not-found') return undefined
  const { envelope } = shown.entry
  if (envelope.kind !== 'config') return undefined
  if (envelope.payload.payloadKind !== 'applyable') return undefined
  if (!envelope.payload.crossBoundary) return undefined
  return { kind: 'cross-boundary', reasons: [...envelope.payload.crossBoundaryReasons] }
}

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
  /**
   * The APPLY half's own union, folded into a clause verdict (2026-08-20, Phase 399.1 D-01/D-02).
   *
   * THIS OP WAS NOT ON PLAN 03'S FLOOR AND THE CENSUS FOUND IT. `not-applyable` is a BLOCKED config
   * proposal reaching the one verb that commits, and its `reason` is the very `guardrail-hit` /
   * `schema-fail` vocabulary `config.field.set` publishes — so reporting it `executed` is the
   * G-399-2 defect one door over: the guardrail held, nothing was committed, and the person was told
   * their change went in. `expired` is the lifecycle declining evidence D-12 has already ruled too
   * old to act on — the schema's own words are "Refusing here is what makes the computed status mean
   * something at the one verb that COMMITS".
   *
   * THE OTHER ARMS ARE ANSWERS, NOT REFUSALS, and the line is deliberate. `not-found` is an id
   * pasted out of a stale message, `already-rejected` is somebody having got there first, and
   * `apply-in-flight` is a machine holding the lock — none of them is a control declining an act it
   * would otherwise have carried out, which is what D-02 minted `refused` to mean. Each reports
   * `executed` with the outcome naming exactly what the caller found, and nothing pretends a commit
   * happened: the payload is rendered beside the receipt on every arm (D-04).
   *
   * IT READS THE APPLY HALF ONLY. The GRANT half's refusals (`cross-boundary`, `ledger-damaged`,
   * `protected-class`) are refusals of the MINT, on a call whose apply may have committed — folding
   * them into this one status would force the choice the output's two-field shape exists to refuse.
   * They travel in the payload, where both halves stay readable.
   */
  classify(output): ClauseVerdict {
    const apply = output.apply
    switch (apply.outcome) {
      case 'not-applyable':
        return { status: 'refused', outcome: `not-applyable: ${apply.reason}` }
      case 'expired':
        return { status: 'refused', outcome: 'expired: the proposal is past its decision window' }
      case 'applied':
        return { status: 'executed', outcome: `applied ${apply.applied.kind}` }
      case 'already-rejected':
        return { status: 'executed', outcome: 'already-rejected: nothing was applied' }
      case 'apply-in-flight':
        return { status: 'executed', outcome: `apply-in-flight: ${apply.proposalId}` }
      case 'not-found':
        return { status: 'executed', outcome: `not-found: ${apply.proposalId}` }
    }
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

    // 395 D-02, THE MINT HALF — placed HERE, above the grants dep, and both facts are the decision.
    //
    // ABOVE THE DEP because the refusal is a property of the PROPOSAL, not of the host: a
    // composition that binds no grants port must give the same answer as one that does, and
    // resolving the dep first would have made this refusal report a binding problem on hosts that
    // have one. It is the same shape as D-01's line ten lines up — the plain form reaches no mint
    // at all, and this form reaches no mint either.
    //
    // AND THE LEDGER IS THEREFORE NEVER TOUCHED, which is what makes "the grants file is
    // byte-identical across a refused accept-with-always" a property of the code rather than of
    // the port's good behaviour. No `record` call is made, so there is nothing for a mint to
    // decline and nothing for an append to half-write.
    const crossBoundary = crossBoundaryRefusal(shown)
    if (crossBoundary !== undefined) return { apply, grant: crossBoundary }

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
  // 395-04 D-10: a BLOCKED config proposal is a real record — listable, showable, and a perfectly
  // reasonable thing for a person to try to accept. There is nothing filed to apply, and saying so
  // as DATA is what keeps the reason and the id in the answer. `applyablePayload()` still refuses
  // the same payload by name one layer down; that refusal guards the PORT, and letting it escape
  // here would report this surface's ordinary answer as a fault (RESEARCH Pitfall 9's shape).
  //
  // NARROWED ON THE PAYLOAD'S OWN DISCRIMINANT, at the kind that has one. A check keyed on anything
  // else — a status, a flag beside the payload — would be a second classification of one value,
  // free to disagree with the one the funnel below takes.
  if (entry.envelope.kind === 'config' && entry.envelope.payload.payloadKind === 'blocked') {
    return {
      outcome: 'not-applyable',
      proposalId: input.proposalId,
      reason: entry.envelope.payload.blockedReason,
    }
  }
  return {
    outcome: 'applied',
    applied: await applyEnvelope(deps, input.proposalId, entry.envelope),
  }
}
