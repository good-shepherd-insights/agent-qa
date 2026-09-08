// 2026-09-08, 418 D-20: shared inert proposal codecs and paths; no writer or reaper.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KnowledgeProposalV1Schema, ForgetReceiptV1Schema, CommitReceiptSchema, ProposalDecisionRecordSchema, ProposalOriginSchema, ProposalRecordSchema, isProposalKind } from '@vostride/agent-qa-schema'
import type { ProposalKind, ProposalOrigin, ProposalRecord } from '@vostride/agent-qa-schema'
import { z } from 'zod'

/** The one directory name proposals live under, beneath the agent-qa runtime root. */
export const PROPOSALS_DIR_NAME = 'proposals'

/**
 * THE FIVE DURABLE NAME SHAPES, spelled once (Phase 391, D-10).
 *
 * 387 wrote four of them and left enumeration owner-less on purpose ("391 is the owner; this
 * module is the substrate"). 391 adds the fifth — the `.rejected.json` sibling of the `.applied`
 * idiom — and, because it now has to CLASSIFY every name in the directory rather than look one
 * up, the suffixes stop being string literals scattered across four functions and become this
 * table. A classifier and a writer that spell a shape differently is how an inbox starts
 * reporting a file nobody can decide about.
 *
 *   `<id>.json`                  pending, awaiting a decision
 *   `<id>.applied.json`          applied — the winner's record plus what applying produced
 *   `<id>.rejected.json`         rejected — the proposal plus the decision that declined it
 *   `<id>.json.claimed.<pid>`    somebody is mid-apply (or died mid-apply: the WR-03 reap)
 *   `<id>.applied.json.claim`    a RETIRED marker; its durable name is already on disk
 *   `<id>.rejected.json.claim`   the same, on the rejection path
 *
 * The claim infix keeps the collision-safety argument stated at `findClaimMarker`: it starts
 * `<id>.json.` so a proposal id of `p1` cannot match `p12`'s claim, and the rejected sibling
 * added here does not begin with it either — `<id>.rejected.json` shares no prefix with
 * `<id>.json.claimed.`, so nothing about that argument moves.
 */
export const PENDING_SUFFIX = '.json'
export const APPLIED_SUFFIX = '.applied.json'
export const REJECTED_SUFFIX = '.rejected.json'
export const CLAIM_INFIX = '.json.claimed.'
export const RETIRED_CLAIM_SUFFIX = '.claim'
/** `writeFileAtomically`'s in-flight sibling. Never a proposal; never enumerated. */
export const TEMP_SUFFIX = '.tmp'

/**
 * The applied file carries the proposal AND what applying it produced.
 *
 * Storing the receipt beside the applied proposal rather than deriving it again is what makes
 * the already-applied answer honest: a second apply reports what the FIRST one did, read off
 * the durable record, instead of recomputing an answer over a store that has since moved on.
 */
export const AppliedProposalRecordSchema = z.object({
  proposal: KnowledgeProposalV1Schema,
  forgetReceipt: ForgetReceiptV1Schema.optional(),
  commitReceipt: CommitReceiptSchema.optional(),
  /**
   * 391: the mint's attribution, CARRIED ACROSS the apply rather than dropped at it.
   *
   * The pending file holds it and the applied file is what replaces the pending file, so
   * without this field an apply would erase who proposed the thing it applied — and the inbox
   * would answer "nobody knows" about a proposal it could have answered about ten seconds
   * earlier. Optional because a 387-era applied record genuinely has none.
   */
  origin: ProposalOriginSchema.optional(),
  /**
   * 391 D-12: when the apply happened. Optional for the same reason — 387-era applied records
   * carry no instant, and a fabricated one is worse than an absent one on a decision trail.
   */
  decision: ProposalDecisionRecordSchema.optional(),
}).strict()

export type AppliedProposalRecord = z.infer<typeof AppliedProposalRecordSchema>

/**
 * The rejected record: the proposal, and the decision that declined it (391, D-10 / D-12).
 *
 * Deliberately the SAME wrapper shape as {@link AppliedProposalRecordSchema} — a proposal plus
 * what the decision produced — because they are the same kind of thing: the durable, permanent
 * answer to "what became of this proposal", read back by whoever asks next instead of recomputed.
 *
 * `decision` is the SHIPPED `ProposalDecisionRecordSchema` narrowed to its rejected arm, not a
 * restatement of its fields. The narrowing is the honest part: a `.rejected.json` file whose
 * decision says `applied` is a corrupt file, and the boundary that reads it should say so rather
 * than pass it through to a surface that renders "applied" off a rejection.
 *
 * NOTHING IS DELETED HERE. The proposal rides inside the wrapper because 387's retention law is
 * what gives a forget receipt its second life (D-04), and a rejection that dropped the proposal
 * would be the one lifecycle transition that loses data.
 */
export const RejectedProposalRecordSchema = z.object({
  proposal: KnowledgeProposalV1Schema,
  decision: ProposalDecisionRecordSchema.extend({ decision: z.literal('rejected') }),
  origin: ProposalOriginSchema.optional(),
}).strict()

export type RejectedProposalRecord = z.infer<typeof RejectedProposalRecordSchema>

/**
 * The KIND-GENERIC decided record: the whole envelope record, and the decision that closed it
 * (394-18).
 *
 * ONE WRAPPER FOR BOTH DECISIONS, and a THIRD wrapper beside the two above rather than a widening
 * of either. The reason is retention: `AppliedProposalRecordSchema` and
 * `RejectedProposalRecordSchema` describe files that are already on real machines and are retained
 * forever, and both are `.strict()` with a `proposal` field typed as `KnowledgeProposalV1Schema`.
 * Widening `proposal` to the payload union would have made every one of those files parse against a
 * looser contract than the one they were written under; adding a second optional field would have
 * made "which field holds the proposal" a question with two answers. This schema carries `record` —
 * a name neither older wrapper can have, since both are strict — so the discriminant between the
 * old shapes and this one is structural and no file has to be migrated or re-read to tell them
 * apart.
 *
 * It holds the RECORD rather than the payload because a decided draft still has to answer who
 * emitted it and which kind it is; 387's wrappers keep `origin` as a sibling field precisely
 * because their `proposal` cannot carry one.
 *
 * NOTHING IS DELETED. The record rides inside the wrapper on 387's retention law, which is what
 * gives a correctly-failing draft its second life as the regression test for the defect it found.
 */
export const DecidedProposalRecordSchema = z.object({
  record: ProposalRecordSchema,
  decision: ProposalDecisionRecordSchema,
}).strict()

export type DecidedProposalRecord = z.infer<typeof DecidedProposalRecordSchema>

export function proposalsDir(agentQaRoot: string): string {
  return join(agentQaRoot, PROPOSALS_DIR_NAME)
}

export function pendingPath(agentQaRoot: string, proposalId: string): string {
  return join(proposalsDir(agentQaRoot), `${proposalId}.json`)
}

export function appliedPath(agentQaRoot: string, proposalId: string): string {
  return join(proposalsDir(agentQaRoot), `${proposalId}${APPLIED_SUFFIX}`)
}

export function rejectedPath(agentQaRoot: string, proposalId: string): string {
  return join(proposalsDir(agentQaRoot), `${proposalId}${REJECTED_SUFFIX}`)
}

/**
 * A proposal as it was STORED: the kind, its own payload, and the attribution the file carried.
 *
 * Three on-disk shapes reach this type and all three are legitimate. 387 wrote a bare
 * `KnowledgeProposalV1` document; 391 writes the envelope's `ProposalRecord` around it when the
 * mint knows who emitted it; 394-18 writes that same wrapper for the authoring kind. `origin`
 * absent means the file is one of the first — a fact about the file, never a value this module
 * invents. A bare document is `knowledge` because that is the only kind 387 could write.
 *
 * DISCRIMINATED ON `kind` WITH THE PAYLOAD CORRELATED, following {@link ProposalEnvelope}'s own
 * mapped-type idiom rather than minting a parallel shape: a reader that narrows on `kind` learns
 * what `payload` is, so no consumer has to re-classify the value off the payload's own fields —
 * the second classification the envelope's correlation exists to abolish.
 */
export type StoredProposal = {
  [K in ProposalKind]: {
    /** The proposal's durable id — the wrapper's `id`, or the bare document's `proposalId`. */
    readonly id: string
    readonly kind: K
    readonly payload: Extract<ProposalRecord, { kind: K }>['payload']
    readonly origin?: ProposalOrigin
  }
}[ProposalKind]

/** The knowledge arm, which is the only one the 387-era apply and reject paths can commit. */
export type StoredKnowledgeProposal = Extract<StoredProposal, { kind: 'knowledge' }>

/**
 * THE ONE PLACE any on-disk shape becomes a proposal (D-08, absorb-as-data · 394-18).
 *
 * A migration was the obvious alternative and it is the wrong one twice over: rewriting files
 * this store's whole contract says are retained forever is a destructive answer to a
 * non-problem, and it would have to run somewhere — at read, where it turns a listing into a
 * write, or at startup, where a crash halfway leaves a directory in two formats anyway. Reading
 * every shape costs one discriminant and leaves 387-era files byte-identical for good.
 *
 * The wrapper discriminant is `payload`, which is the wrapper's own field and cannot appear on a
 * bare `KnowledgeProposalV1` — that schema is `.strict()`, so a document carrying one would have
 * been refused at the boundary that wrote it.
 *
 * EACH KIND IS PARSED THROUGH ITS OWN ARM, never cast. `ProposalRecordSchema` is the discriminated
 * union, so `parse` selects the arm from `kind` and refuses a malformed payload AT that arm — the
 * store's own narrow-not-cast rule, now once per kind rather than once for knowledge and a refusal
 * for everything else.
 */
export function extractStoredProposal(raw: unknown): StoredProposal {
  if (typeof raw === 'object' && raw !== null && 'payload' in raw) {
    // THE UNKNOWN-KIND REFUSAL, ASKED BEFORE THE PARSE AND KEPT AS A NAMED `TypeError`. A kind no
    // schema in this build knows would otherwise surface as a `ZodError` about a discriminator,
    // which reads as a malformed document rather than as the one thing it actually is: a file
    // written by a newer build. Asked first so the message can NAME the kind it does not know.
    const kind: unknown = (raw as { kind?: unknown }).kind
    if (!isProposalKind(kind)) {
      throw new TypeError(
        `the proposals store was handed a proposal of unknown kind ${JSON.stringify(kind)}; `
          + 'no schema in this build can read it, and guessing at its payload is how an inbox '
          + 'loses a proposal',
      )
    }
    const record = ProposalRecordSchema.parse(raw)
    return {
      id: record.id,
      kind: record.kind,
      payload: record.payload,
      ...(record.origin === undefined ? {} : { origin: record.origin }),
    } as StoredProposal
  }
  const payload = KnowledgeProposalV1Schema.parse(raw)
  return { id: payload.proposalId, kind: 'knowledge', payload }
}

/**
 * The same extraction, narrowed to the KNOWLEDGE arm — for the paths that commit one.
 *
 * The refusal that lives here is about the PATH rather than about the store: `claimPendingProposal`
 * and the 387-era apply publish an `AppliedProposalRecord`, whose `proposal` field IS
 * `KnowledgeProposalV1Schema`, so handing that machinery a draft would produce a document the next
 * reader could not parse. Accepting a `test-draft` goes through `proposals.accept`'s own routes
 * and {@link decidePendingProposal} below, which is what the message names.
 */
export function extractStoredKnowledgeProposal(raw: unknown): StoredKnowledgeProposal {
  const stored = extractStoredProposal(raw)
  if (stored.kind !== 'knowledge') {
    throw new TypeError(
      `the knowledge commit path was handed a ${stored.kind} proposal (${stored.id}); `
        + 'that kind is decided through proposals.accept and recorded by decidePendingProposal',
    )
  }
  return stored
}

export function readJsonIfPresent(path: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
