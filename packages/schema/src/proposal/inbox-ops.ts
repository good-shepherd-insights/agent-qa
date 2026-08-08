// The proposals INBOX contract — three verbs and the port behind them (Phase 391, PROP-03).
//
// MINTED IN SCHEMA, on the `QuarantineOperationsPort` precedent and not by analogy to it. Two
// packages consume this port and neither may import the other: `agent` names it as an optional
// `FunctionDeps` member and declares three ops against it, and `knowledge-local` implements it
// over the durable proposals store. A port type living in either would be an import edge the
// architecture refuses. `packages/agent/src/ports/` is the v47 LEGACY port directory and holds no
// 384-era dep port at all, which is why this is not there.
//
// D-13/D-14, stated where the temptation is: this inbox lists ENVELOPE proposals only. Curator
// candidates stay candidate-status truth inside bundles and are reviewed through the KREV verbs;
// the quarantine verbs are not wrapped, because auto-quarantine is code-authored operational
// state and the human add/release verbs are already a human's own act. Neither belongs here, and
// a `kind` filter that could name them would be the first half of making them belong.

import { z } from 'zod'

import { KnowledgeProposalV1Schema, ProposalIdSchema } from '../knowledge/proposal'
import { KnowledgeApplyOutcomeSchema } from '../knowledge/review-verbs'
import { GrantRecordOutcomeSchema } from '../safety/grant-ops'
import type { GrantRecordOutcome } from '../safety/grant-ops'
import {
  PROPOSAL_ENVELOPE_STATUSES,
  PROPOSAL_KINDS,
  ProposalDecisionRecordSchema,
  ProposalEvidenceRefSchema,
  ProposalOriginSchema,
} from './envelope'
import type { ProposalEnvelope } from './envelope'

/**
 * The WIRE projection of {@link ProposalEnvelope}.
 *
 * `envelope.ts` deliberately declares the envelope as a DTO interface and not a schema, so that
 * nothing is invited to persist one — a stored `status` would be a second answer to a question
 * the clock already answers. That argument is about DURABILITY and says nothing about transport,
 * and the function layer requires a live validator for every declared contract plus an inert
 * JSON-Schema projection of it (384 D-14). So the envelope gets a schema here, at the boundary
 * that needs one, and never in the module that owns the durable record.
 *
 * The two declarations are pinned EXACTLY EQUAL below rather than trusted to stay in step. A
 * projection that quietly dropped `decision` would still parse every envelope the store produces
 * and would strip the decision trail out of every surface — the failure mode a `.strict()` object
 * cannot catch, because the value it is stripping is one it was never told to expect.
 */
export const ProposalEnvelopeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(PROPOSAL_KINDS),
  status: z.enum(PROPOSAL_ENVELOPE_STATUSES),
  origin: ProposalOriginSchema.optional(),
  evidenceRefs: z.array(ProposalEvidenceRefSchema).readonly(),
  decision: ProposalDecisionRecordSchema.optional(),
  payload: KnowledgeProposalV1Schema,
}).strict()

/** True only when the two types are mutually assignable — a real equality, not a subtype check. */
type ExactlyEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

/**
 * The pin. If the schema above and the DTO in `envelope.ts` ever describe different shapes, this
 * line stops compiling — which is the whole reason the schema is allowed to exist beside a DTO.
 */
const _envelopeProjectionMatchesDto: ExactlyEqual<
  z.infer<typeof ProposalEnvelopeSchema>,
  ProposalEnvelope
> = true
void _envelopeProjectionMatchesDto

/**
 * One inbox row: the envelope, plus whether somebody is applying it RIGHT NOW.
 *
 * `applyInFlight` is not a lifecycle status and is deliberately not folded into one. The four
 * envelope states are what became of the human decision; an apply in flight has not changed that
 * — the proposal is still pending and is also being acted on. Rendering it is what stops a
 * surface offering a decision on a proposal that is seconds from being decided by a machine.
 */
export const ProposalInboxEntrySchema = z.object({
  envelope: ProposalEnvelopeSchema,
  applyInFlight: z.boolean(),
}).strict()

export type ProposalInboxEntryDto = z.infer<typeof ProposalInboxEntrySchema>

/**
 * `proposals.list`'s input — two OPTIONAL filters, and the departure from the quarantine
 * precedent is argued rather than inherited.
 *
 * `quarantine.list` takes no filter, on the ground that a filter makes the answer depend on how
 * it was asked and the caller who most needs the full picture is the one who would have to know
 * to ask. That argument holds for a ledger whose entries expire and are released — it is bounded.
 * This store is not: D-10 retains every proposal FOREVER, so an inbox that could only be asked
 * for everything would, on a project six months old, answer a question about what is waiting on
 * a human with a thousand rows about what already happened. The filter is what keeps the verb
 * usable, and the full picture stays one omitted field away.
 *
 * Both are absent-means-everything rather than defaulted to `pending`, so nothing is hidden from
 * a caller that did not know to ask — which is as much of the quarantine argument as transfers.
 */
export const ProposalsListInputSchema = z.object({
  status: z.enum(PROPOSAL_ENVELOPE_STATUSES).optional(),
  kind: z.enum(PROPOSAL_KINDS).optional(),
}).strict()

export type ProposalsListInput = z.infer<typeof ProposalsListInputSchema>

export const ProposalsListOutputSchema = z.object({
  entries: z.array(ProposalInboxEntrySchema),
}).strict()

export type ProposalsListOutput = z.infer<typeof ProposalsListOutputSchema>

/**
 * `proposals.show`'s input. The id is `ProposalIdSchema` and not a bare string, so the id-as-path
 * law is enforced at the SCHEMA boundary — before the op body runs, and therefore before any
 * value derived from it could reach a join.
 */
export const ProposalsShowInputSchema = z.object({
  proposalId: ProposalIdSchema,
}).strict()

export type ProposalsShowInput = z.infer<typeof ProposalsShowInputSchema>

/**
 * What a show found, or a named absence.
 *
 * Absence is a RESULT rather than a refusal, on the reasoning `KnowledgeRecordShowResult` already
 * applies: an id that names nothing is an ordinary human mistake — pasted out of a stale message,
 * typed from a screenshot — and not a broken store.
 */
export const ProposalsShowOutputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('found'), entry: ProposalInboxEntrySchema }).strict(),
  z.object({ kind: z.literal('not-found'), proposalId: z.string().min(1) }).strict(),
])

export type ProposalsShowOutput = z.infer<typeof ProposalsShowOutputSchema>

/** `proposals.reject`'s input: which proposal, and — where the surface collected one — why. */
export const ProposalsRejectInputSchema = z.object({
  proposalId: ProposalIdSchema,
  /**
   * OPTIONAL, unlike `knowledge.reject`'s required reason, and the difference is real rather than
   * an inconsistency. That verb records a judgement ABOUT A RECORD that later readers weigh; this
   * one records that a human declined to act, and a decision trail that refuses to record the
   * decision until somebody types a justification is a trail with holes in exactly the cases
   * where the human was in a hurry.
   */
  reason: z.string().min(1).optional(),
}).strict()

export type ProposalsRejectInput = z.infer<typeof ProposalsRejectInputSchema>

/**
 * What a reject did — five arms, none of them a throw.
 *
 * Four of them are the ways a proposal can already be spoken for, and they are kept apart because
 * a human acts differently on each: already-applied means look at what it did, already-rejected
 * means somebody beat you to the same answer, apply-in-flight means wait and re-ask, not-found
 * means check the id. Collapsing them into one refusal would have made the inbox's most common
 * concurrent case indistinguishable from a typo.
 */
export const ProposalsRejectOutputSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('rejected'), entry: ProposalInboxEntrySchema }).strict(),
  z.object({ outcome: z.literal('already-applied'), entry: ProposalInboxEntrySchema }).strict(),
  z.object({ outcome: z.literal('already-rejected'), entry: ProposalInboxEntrySchema }).strict(),
  z.object({ outcome: z.literal('apply-in-flight'), proposalId: z.string().min(1) }).strict(),
  z.object({ outcome: z.literal('not-found'), proposalId: z.string().min(1) }).strict(),
])

export type ProposalsRejectOutput = z.infer<typeof ProposalsRejectOutputSchema>

/**
 * `proposals.accept`'s input — the decision, and the ESCALATION on the same surface (391 D-01).
 *
 * `always` is a flag on the SAME request rather than a second verb, and that is the whole of D-01
 * expressed as a type. Two verbs would have made "apply this" and "apply this and stop asking" two
 * capabilities a surface chooses between, so a chat toolset or an MCP client could offer the second
 * without ever offering the first — and standing approval would have become a thing you could reach
 * without deciding anything. One request, one decision, one escalation you have to ask for.
 *
 * ABSENT MEANS NO. There is no default and no tri-state: plain accept applies THIS proposal only,
 * and a grant is minted by nothing else. Grants never accrete silently, which is the property the
 * whole phase turns on.
 */
export const ProposalsAcceptInputSchema = z.object({
  proposalId: ProposalIdSchema,
  /** Also record a standing approval covering this kind's apply verb. Absent means no. */
  always: z.literal(true).optional(),
}).strict()

export type ProposalsAcceptInput = z.infer<typeof ProposalsAcceptInputSchema>

/**
 * What the apply half of an accept COMMITTED, per kind.
 *
 * Discriminated on `kind` at one member, on the envelope's own reasoning: 393-396's payload arms
 * reach this same verb, and their apply outcomes are their own. A flat `KnowledgeApplyOutcome` here
 * would have baked one kind into the generic decision surface.
 */
export const ProposalsAcceptAppliedSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('knowledge'), outcome: KnowledgeApplyOutcomeSchema }).strict(),
])

export type ProposalsAcceptApplied = z.infer<typeof ProposalsAcceptAppliedSchema>

/**
 * What became of the apply — five arms, mirroring `ProposalsRejectOutputSchema`'s five because they
 * are answers to the same five situations, and none of them is a throw.
 *
 * `expired` is the arm that keeps D-12's lifecycle from being decorative. An expired proposal is
 * still durably pending — nothing happens at the moment one expires, which is why there is no
 * reaper — so an accept that routed it through would commit deltas computed against evidence the
 * lifecycle has already declared too old to act on. Refusing here is what makes the computed status
 * mean something at the one verb that COMMITS; `proposals.reject` deliberately does not refuse an
 * expired proposal, because declining something stale is always a reasonable thing to do.
 */
export const ProposalsAcceptOutcomeSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('applied'), applied: ProposalsAcceptAppliedSchema }).strict(),
  z.object({ outcome: z.literal('already-rejected'), entry: ProposalInboxEntrySchema }).strict(),
  z.object({ outcome: z.literal('expired'), entry: ProposalInboxEntrySchema }).strict(),
  z.object({ outcome: z.literal('apply-in-flight'), proposalId: z.string().min(1) }).strict(),
  z.object({ outcome: z.literal('not-found'), proposalId: z.string().min(1) }).strict(),
])

export type ProposalsAcceptOutcome = z.infer<typeof ProposalsAcceptOutcomeSchema>

/**
 * What became of the MINT — the port's three arms, plus the two only this verb can answer.
 *
 * `not-requested` is a plain accept, and it is a first-class ANSWER rather than an omitted field:
 * a surface rendering a decision receipt has to be able to distinguish "nothing was granted" and
 * "the grant half never ran", and an absent value would collapse the two.
 *
 * `not-applied` is `always: true` on a request whose apply never happened. Minting there would
 * record a standing approval for a commit that did not occur, which is the one way this surface
 * could widen autonomy without anything having been decided at all.
 *
 * `ledger-damaged` is the mint that could not be DECIDED at all, because the committed grant ledger
 * carries a line this build cannot read (391-09's typed refusal). It lives HERE, with this verb's
 * own arms, and deliberately NOT inside {@link GrantRecordOutcomeSchema}: the port keeps its THROW,
 * because a refusal to decide is not a decision and widening the port's union would make every
 * existing exhaustive switch over it silently incomplete rather than loudly broken. Only this op
 * converts that throw into data, and only because its apply has ALREADY COMMITTED by the time the
 * mint runs — a caller told only about the refusal would hold no receipt for a change that really
 * happened, and the predictable next thing they do is re-apply it.
 */
export const ProposalsAcceptGrantOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not-requested') }).strict(),
  z.object({ kind: z.literal('not-applied') }).strict(),
  z.object({
    kind: z.literal('ledger-damaged'),
    /** The refusal in the operator's words — what is wrong, and what repairs it. */
    reason: z.string().min(1),
    /**
     * The refused lines, in the ledger reader's OWN field names (`RefusedGrantLine`), so a refused
     * line has one spelling in the repo and a renderer can print either source unchanged.
     */
    refusedLines: z.array(
      z.object({
        lineNumber: z.number().int().positive(),
        reason: z.string().min(1),
      }).strict(),
    ),
  }).strict(),
  ...GrantRecordOutcomeSchema.options,
])

export type ProposalsAcceptGrantOutcome = z.infer<typeof ProposalsAcceptGrantOutcomeSchema>

/**
 * The pin that keeps the two spellings honest: everything on the grant half that is NOT one of this
 * verb's own arms must be EXACTLY the port's outcome union.
 *
 * WHAT IT STILL BUYS AFTER THE WIDENING, because an exclusion list that grows without a restated
 * purpose is the next decorative assertion. The exclusion names only arms THIS VERB mints itself
 * and the port cannot produce — the two no-mint answers, and the refusal-to-decide this op converts
 * from the port's throw. Everything left over is still required to be the port's union EXACTLY, so
 * an arm the PORT gains and this surface does not carry still fails to compile here. The pin's
 * direction is unchanged: it constrains the port's arms, and the exclusion is the list of arms the
 * port was never asked to have.
 */
const _acceptGrantArmsCoverThePort: ExactlyEqual<
  Exclude<
    ProposalsAcceptGrantOutcome,
    { kind: 'not-requested' | 'not-applied' | 'ledger-damaged' }
  >,
  GrantRecordOutcome
> = true
void _acceptGrantArmsCoverThePort

/**
 * The whole answer: what the apply did, and — separately — what the mint did.
 *
 * TWO FIELDS RATHER THAN ONE UNION, and the separation is load-bearing (D-01/D-05). An
 * accept-with-always whose apply COMMITTED and whose mint was REFUSED — because the kind's apply
 * verb turned out to be a protected class — has to report both halves truthfully. Folding them into
 * one outcome would force a choice between reporting the refusal (and losing the receipt for a
 * commit that really happened) and reporting the apply (and silently swallowing the refusal),
 * which is exactly how a person ends up believing they hold a standing approval they do not.
 */
export const ProposalsAcceptOutputSchema = z.object({
  apply: ProposalsAcceptOutcomeSchema,
  grant: ProposalsAcceptGrantOutcomeSchema,
}).strict()

export type ProposalsAcceptOutput = z.infer<typeof ProposalsAcceptOutputSchema>

/**
 * The injected capability the three inbox ops dispatch through — one OPTIONAL dep, three verbs.
 *
 * ONE port rather than a reader/writer split, on the quarantine port's stated reasoning: the
 * read/write asymmetry is already declared where it is ENFORCED — `list` and `show` declare read
 * scopes and read-only descriptors, `reject` declares an approval-write scope, `readOnly: false`
 * and a human-origin requirement — so a second port would restate at the composition root a
 * distinction the gate makes at every call.
 *
 * `list` answers EVERY row and does no filtering: the op filters rows already in hand, so a
 * status filter cannot become a second place the classification rule lives. The implementation
 * owns three things this contract deliberately does not — the ordering law, the process-liveness
 * model the orphaned-claim reap turns on, and the wall clock a decision instant is stamped with.
 * All three are host facts, and a port that took them as arguments would let a caller pick them.
 *
 * A STANDING-GRANTS PORT IS NOT HERE. Accept-with-always and the grant verbs range over the grant
 * ledger rather than this store, and their signatures are the consuming plan's to derive — a
 * guess written here would be the second spelling the phase's own one-vocabulary law refuses.
 */
export interface ProposalsInboxPort {
  list(): Promise<readonly ProposalInboxEntryDto[]>
  show(input: ProposalsShowInput): Promise<ProposalsShowOutput>
  reject(input: ProposalsRejectInput): Promise<ProposalsRejectOutput>
}
