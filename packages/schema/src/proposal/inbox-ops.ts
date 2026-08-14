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

import { FindingProposalV1Schema, TestDraftProposalV1Schema } from '../authoring/proposal-arms'
import { ConfigApplyOutcomeSchema } from '../config-mutation/actions'
import { CROSS_BOUNDARY_REASONS } from '../config-mutation/constants'
import { ConfigProposalV1Schema } from '../config-mutation/proposal'
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
const proposalEnvelopeArm = <K extends string, P extends z.ZodType>(kind: K, payload: P) =>
  z.object({
    id: z.string().min(1),
    kind: z.literal(kind),
    status: z.enum(PROPOSAL_ENVELOPE_STATUSES),
    origin: ProposalOriginSchema.optional(),
    evidenceRefs: z.array(ProposalEvidenceRefSchema).readonly(),
    decision: ProposalDecisionRecordSchema.optional(),
    payload,
  }).strict()

/**
 * A DISCRIMINATED UNION since 394-06, mirroring the DTO's own correlation.
 *
 * A flat `kind: z.enum(PROPOSAL_KINDS)` beside `payload: z.union([...])` would parse an envelope
 * whose kind said `finding` and whose payload was a knowledge proposal — nine combinations for
 * three legal ones, all of them valid on the wire. The discriminated form admits the three, and
 * the parity pin below then carries that same guarantee into the DTO.
 */
export const ProposalEnvelopeSchema = z.discriminatedUnion('kind', [
  proposalEnvelopeArm('knowledge', KnowledgeProposalV1Schema),
  proposalEnvelopeArm('test-draft', TestDraftProposalV1Schema),
  proposalEnvelopeArm('finding', FindingProposalV1Schema),
  proposalEnvelopeArm('config', ConfigProposalV1Schema),
])

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
  // 394 D-05: the apply that WRITES the draft into the suite and makes one git commit for it
  // (D-06). Plan 10 implements the write; the outcome shape is named here because this is the
  // surface that reports it.
  z.object({
    kind: z.literal('test-draft'),
    outcome: z.object({
      /** Where the accepted draft was written. */
      filePath: z.string().min(1),
      /** The one commit D-06 makes for that file, or absent when the apply is not yet wired. */
      commit: z.string().min(1).optional(),
    }).strict(),
  }).strict(),
  // 394 D-11: record-and-surface. Accepting a finding is an ACKNOWLEDGEMENT — the decision trail
  // is the whole of what happens, so this arm carries no target and no receipt of a change. It is
  // a distinct arm rather than an omitted one so a surface can render "acknowledged" instead of
  // having to infer it from a missing field.
  z.object({
    kind: z.literal('finding'),
    outcome: z.object({ acknowledged: z.literal(true) }).strict(),
  }).strict(),
  // 395 D-01/D-03 · CFGM-03: the apply that COMMITS the config change. `already-applied` rides the
  // same outcome union rather than a sibling arm here, because a person who accepted twice is owed
  // the receipt either way and a surface that had to distinguish two shapes to print one hash would
  // be re-deciding what the port already decided.
  z.object({
    kind: z.literal('config'),
    outcome: ConfigApplyOutcomeSchema,
  }).strict(),
])

export type ProposalsAcceptApplied = z.infer<typeof ProposalsAcceptAppliedSchema>

/**
 * What became of the apply — six arms, and none of them is a throw.
 *
 * `expired` is the arm that keeps D-12's lifecycle from being decorative. An expired proposal is
 * still durably pending — nothing happens at the moment one expires, which is why there is no
 * reaper — so an accept that routed it through would commit deltas computed against evidence the
 * lifecycle has already declared too old to act on. Refusing here is what makes the computed status
 * mean something at the one verb that COMMITS; `proposals.reject` deliberately does not refuse an
 * expired proposal, because declining something stale is always a reasonable thing to do.
 *
 * `not-applyable` is 395-04's, and it is DATA rather than the throw that would otherwise reach this
 * surface. A blocked config proposal is a real record a person can list, show and accept — accepting
 * it is a reasonable thing to try, and the honest answer is that there is nothing filed to apply.
 * `applyablePayload()` refuses such a payload by name at the one apply funnel, but that refusal is
 * an internal invariant guarding a port; letting it escape as an exception would report a decision
 * surface's ordinary answer as a fault, discarding the reason and the id along with it (RESEARCH
 * Pitfall 9's shape: refusals come back beside the receipt, never instead of it).
 */
export const ProposalsAcceptOutcomeSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('applied'), applied: ProposalsAcceptAppliedSchema }).strict(),
  z.object({ outcome: z.literal('already-rejected'), entry: ProposalInboxEntrySchema }).strict(),
  z.object({ outcome: z.literal('expired'), entry: ProposalInboxEntrySchema }).strict(),
  z.object({ outcome: z.literal('apply-in-flight'), proposalId: z.string().min(1) }).strict(),
  z.object({ outcome: z.literal('not-found'), proposalId: z.string().min(1) }).strict(),
  z.object({
    outcome: z.literal('not-applyable'),
    proposalId: z.string().min(1),
    /**
     * Why there is nothing to apply, in the blocked record's own two words (`schema-fail`,
     * `guardrail-hit`). NEVER the report itself: a surface that wanted the findings reaches for
     * `proposals.show`, which renders the record that already holds them.
     */
    reason: z.string().min(1),
  }).strict(),
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
 * `cross-boundary` is the MINT HALF of 395's D-02, and it is the sibling of `protected-class` one
 * level up: that arm refuses a class no approval may ever cover, this one refuses a PROPOSAL whose
 * own values cross a boundary a standing approval may not span. The class stays grantable — an
 * in-scope config proposal accepted with `--always` still records one — so what is refused here is
 * this proposal, per value, which is the whole reason D-02 put the flag on the proposal rather than
 * on the op. It carries the classifier's own `crossBoundaryReasons` because "refused" without the
 * words is a refusal a person cannot act on, and the words are a closed vocabulary every surface
 * already renders.
 *
 * IT IS AN ARM RATHER THAN A THROW for this union's stated reason, and here the reason is sharper
 * than anywhere else on it: the apply has already committed. A person who accepted a cross-boundary
 * proposal with `--always` gets the commit they asked for AND the sentence saying their standing
 * approval was not recorded, in one answer. An exception would have discarded the receipt for a
 * change that really happened, and the predictable next thing they do is apply it again.
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
    kind: z.literal('cross-boundary'),
    /**
     * WHY this proposal may not be pre-approved, in the classifier's OWN closed vocabulary.
     *
     * DELIBERATELY NOT `.min(1)`, and the reason is the direction a guard may not fail in. The
     * producer's invariant — flag and reasons set together — is pinned where it is PRODUCED
     * (`computeCrossBoundary` returns `crossBoundary: reasons.length > 0`), and the stored payload
     * schema admits an empty list. A `.min(1)` here would mean that a record carrying the flag with
     * no reasons — a doctored one, or one this build read through an older shape — could not have
     * its refusal PARSED, so the one input this arm exists to refuse would be the one input that
     * broke it. An empty list is therefore an answerable state: refused, with no reason recorded.
     */
    reasons: z.array(z.enum(CROSS_BOUNDARY_REASONS)),
  }).strict(),
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
 * and the port cannot produce — the two no-mint answers, the refusal-to-decide this op converts
 * from the port's throw, and 395's per-proposal `cross-boundary` refusal, which the port cannot
 * express because `record` is never handed a proposal at all. Everything left over is still
 * required to be the port's union EXACTLY, so
 * an arm the PORT gains and this surface does not carry still fails to compile here. The pin's
 * direction is unchanged: it constrains the port's arms, and the exclusion is the list of arms the
 * port was never asked to have.
 */
const _acceptGrantArmsCoverThePort: ExactlyEqual<
  Exclude<
    ProposalsAcceptGrantOutcome,
    { kind: 'not-requested' | 'not-applied' | 'cross-boundary' | 'ledger-damaged' }
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
  recordApplied(input: ProposalsRecordAppliedInput): Promise<ProposalsRecordAppliedOutput>
}

/**
 * The APPLIED half of the decision trail, for the kinds whose apply is not itself a commit
 * (394-18).
 *
 * IT IS THE SYMMETRIC HALF OF `reject`, and its absence was the reason `accepted` could not be a
 * real number. A knowledge accept commits deltas and `publishAppliedProposal` records the decision
 * as part of committing them, so the knowledge arm needs nothing here. The two kinds 394 mints have
 * no such commit: a `test-draft` writes a file through a port that is not this store, and a
 * `finding` is an acknowledgement with no side effect at all — so without a verb that says "a
 * person decided this", both would sit `pending` forever and the funnel's `accepted` stage would be
 * structurally 0 on every host, which is exactly the state WINDOWS 102 recorded.
 *
 * A PORT VERB RATHER THAN A SECOND PORT, on this port's own stated reasoning: the read/write
 * asymmetry is declared where it is ENFORCED — `proposals.accept` carries `approval-write`,
 * `readOnly: false` and `requiresHumanOrigin` — so a separate writer port would restate at the
 * composition root a distinction the gate already makes at every call.
 *
 * NOT AN OP INPUT, which is why these are interfaces rather than zod schemas. Nothing parses one
 * off a wire: the caller is `proposals.accept`'s own route, one package away, and a schema here
 * would invite somebody to expose recording a decision as a verb of its own — a way to mark a
 * proposal applied without applying it.
 */
export interface ProposalsRecordAppliedInput {
  readonly proposalId: string
}

/**
 * What recording found, in the store's own vocabulary. Every arm is a RESULT; none is a throw.
 *
 * The four non-`recorded` arms are the same four `reject` answers, and they are here for the same
 * reason: a retrying surface, two people on two machines, a race with an in-flight apply and a
 * mistyped id are all ordinary. `already-applied` in particular is what a second accept of the same
 * proposal must say, and it must not overwrite the first decision's instant.
 */
export interface ProposalsRecordAppliedOutput {
  readonly outcome:
    | 'recorded'
    | 'already-applied'
    | 'already-rejected'
    | 'apply-in-flight'
    | 'not-found'
}
