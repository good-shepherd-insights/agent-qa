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
