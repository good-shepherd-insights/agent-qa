// The generic proposal envelope (Phase 391, D-08 / D-12).
//
// One kind-discriminated envelope that every proactive write rides. The envelope owns identity,
// lifecycle, attribution and the decision trail; the KIND owns what is being proposed. Today
// there is exactly one kind and its payload is `KnowledgeProposalV1` — absorbed AS DATA, never
// forked and never widened, which is the 391-SHAPED note in `knowledge/proposal.ts` honoured
// verbatim rather than paraphrased. 393–396 add payload arms; nothing in the inbox, the grant
// machinery or the digest has to learn about them, because none of those read the payload.
//
// TWO AXES THAT LOOK LIKE ONE, AND ARE NOT:
//
//  1. `KNOWLEDGE_PROPOSAL_STATUSES` (`pending | applied`) is the INNER DTO's field and keeps its
//     own meaning: did this proposal's deltas reach `commit()`. It is untouched here.
//  2. {@link PROPOSAL_ENVELOPE_STATUSES} is the ENVELOPE's lifecycle: what has become of the
//     human decision this proposal is waiting for. A proposal can be `rejected` or `expired`
//     without its deltas ever having been a question of commit at all.
//
// Collapsing those two would have made "applied" mean two different things one field apart.

import { z } from 'zod'

import { TestDraftProposalV1Schema } from '../authoring/proposal-arms'
import { ConfigProposalV1Schema } from '../config-mutation/proposal'
import { KnowledgeProposalV1Schema, ProposalIdSchema } from '../knowledge/proposal'

/**
 * Version 1: the first shape. No envelope record exists on disk yet, so the contract is still
 * free to move; once records are written it is not, which is why the fields below are the
 * minimum the inbox, the digest and a decision need and nothing more.
 */
export const CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION = 1

/**
 * The closed kind discriminant, spelled ONCE (388 C13).
 *
 * The single-member array was the point rather than an accident: the machinery that enumerates,
 * decides and digests proposals is written against the discriminant, so a second kind is a payload
 * arm plus a member here — not a change to any consumer. 395 adds config, 396 projects the same
 * shape over MCP.
 *
 * 394 LANDED THE AUTHORING ARM AS A KIND rather than as a flag, and that choice is the interesting
 * part. `test-draft` is a verified draft awaiting the human decision D-05 says every draft gets,
 * even a keep-eligible one. It is a separate KIND rather than a field on another arm because this
 * vocabulary feeds two exhaustive `Record<ProposalKind, …>` sites, so a discriminated kind gets
 * compile-time coverage at both for free while a field would get none: an unhandled flag routes to
 * the knowledge apply and renders the knowledge proposal's decision line, and nothing anywhere
 * fails to compile.
 *
 * 2026-09-02 (Phase 411): the proposal arm for a correctly-failing draft left with the Issue-slot
 * cleanup — see `DELETION-INVENTORY.md`. Three kinds, and the loop reports that verdict on its own
 * result rather than minting an envelope for it.
 */
export const PROPOSAL_KINDS = ['knowledge', 'test-draft', 'config'] as const

export type ProposalKind = (typeof PROPOSAL_KINDS)[number]

const PROPOSAL_KIND_SET: ReadonlySet<string> = new Set(PROPOSAL_KINDS)

/** True for exactly the closed kind set. */
export function isProposalKind(value: unknown): value is ProposalKind {
  return typeof value === 'string' && PROPOSAL_KIND_SET.has(value)
}

/**
 * The envelope's lifecycle vocabulary (D-12). Exactly four, and closed.
 *
 * `pending` is awaiting a decision; `applied` and `rejected` are the two decisions a human can
 * make; `expired` is the absence of one for long enough that acting on it would be acting on
 * stale evidence. There is no `cancelled` and no `superseded` — the superseded v44 family had
 * both, and neither was ever a state anyone could reach or a surface could render.
 */
export const PROPOSAL_ENVELOPE_STATUSES = ['pending', 'applied', 'rejected', 'expired'] as const

export type ProposalEnvelopeStatus = (typeof PROPOSAL_ENVELOPE_STATUSES)[number]

/**
 * How long a pending proposal stays actionable: 30 days.
 *
 * RETUNE NOTE (386 D-15's pinned-constant idiom — a constant with a stated owner, never a config
 * knob). The number is a judgement about how long the evidence behind a proposal stays true, not
 * a preference: knowledge proposals cite records and bundles that later runs keep changing, and a
 * two-month-old "forget this bundle" is a decision about a system that no longer exists. Thirty
 * days is the same order as the quarantine window's deadline and long enough that a fortnight
 * away from the project loses nothing. Retune it here, in this file, when there is a measurement
 * that says so — an inbox where a real fraction of accepts happen against expired proposals, or
 * one where nothing ever expires because everything is decided inside a week. A per-user knob
 * would make "how long is a proposal good for" unanswerable across two machines reading the same
 * store, which is the question the expiry exists to answer.
 */
export const PROPOSAL_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Where a proposal came from — attribution the digest ranges over (plan 06's per-run report).
 *
 * `emittedBy` is the emitting function op's id (e.g. `knowledge.forget.propose`), the bare id
 * rather than the gate's prefixed action name: this is provenance for a human reading an inbox,
 * not a match key, and the one place the prefixed spelling is load-bearing already says so on the
 * grant ledger. `runId` is OPTIONAL and its absence is a true statement rather than a gap — a
 * proposal minted by a directly invoked CLI verb belongs to no run, and inventing one so the
 * field could be required is exactly the fabricated attribution the ledger vocabulary refuses
 * elsewhere.
 */
export const ProposalOriginSchema = z.object({
  emittedBy: z.string().min(1),
  runId: z.string().min(1).optional(),
  /**
   * WHICH DOOR MINTED THIS PROPOSAL (400-05) — the composition's own `FunctionCaller.surface`.
   *
   * IT BELONGS ON THE ORIGIN AND NOWHERE ELSE, because this record is already the answer to "where
   * did this come from" and a second attribution field on a payload arm would be a per-kind copy of
   * one cross-kind fact. It is emphatically NOT the session header's `surface` tag (400-03): that
   * one says which door OPENED a conversation, which is a per-session fact and is read at the wrong
   * moment — a proposal minted in a dashboard conversation and accepted the next morning from the
   * CLI would be attributed to whichever session happened to be open at apply time.
   *
   * OPTIONAL, AND ITS ABSENCE IS A STATEMENT RATHER THAN A GAP: no surface was recorded. Every
   * proposal written before this field existed is in that population, and so is every mint by a
   * composition that declares no door. A reader may say so — `unrecorded` — and may NOT pick a
   * surface to stand in for it; a fabricated attribution in a git author is exactly the defect this
   * field closes. The schema is `.strict()`, so optional is also what keeps every pre-400 record on
   * disk parsing unchanged.
   *
   * A PLAIN STRING RATHER THAN A CLOSED UNION, on the session tag's own reasoning (400-03): nothing
   * here branches on it, and a union would make a record written by a later build fail to parse
   * against an older one. What is closed is the READER's vocabulary — see
   * `agentConfigCommitAuthor` in the CLI's host, whose map over known surfaces has an explicit arm
   * for a word it does not recognise.
   */
  surface: z.string().min(1).optional(),
  /** Epoch milliseconds, stamped by the CALLER at mint time (this module reads no clock). */
  at: z.number().int().nonnegative(),
}).strict()

export type ProposalOrigin = z.infer<typeof ProposalOriginSchema>

/**
 * The grains an envelope's evidence refs address.
 *
 * `record` and `bundle` are deliberately the SAME two words `KnowledgeTargetRef` discriminates
 * on: an inbox that spelled the same two grains differently from the verb whose targets it lists
 * would be a second addressing vocabulary, and two vocabularies for one relation is how a `show`
 * verb starts rendering refs no other surface can resolve. `run` is the third because a proposal
 * is evidence-linked to the run that produced it and the digest addresses runs.
 */
export const PROPOSAL_EVIDENCE_GRAINS = ['record', 'bundle', 'run'] as const

export type ProposalEvidenceGrain = (typeof PROPOSAL_EVIDENCE_GRAINS)[number]

/** One thing a human can go and look at before deciding. */
export const ProposalEvidenceRefSchema = z.object({
  grain: z.enum(PROPOSAL_EVIDENCE_GRAINS),
  ref: z.string().min(1),
}).strict()

export type ProposalEvidenceRef = z.infer<typeof ProposalEvidenceRefSchema>

/**
 * The two decisions a human can make. Closed, and deliberately NOT the envelope status union:
 * `pending` is the absence of a decision and `expired` is the absence of one for too long, so
 * neither is a thing anybody did. A decision record exists exactly when somebody acted.
 */
export const PROPOSAL_DECISIONS = ['applied', 'rejected'] as const

export type ProposalDecision = (typeof PROPOSAL_DECISIONS)[number]

/**
 * The decision trail: what was decided, when, and — where the surface collected one — why.
 *
 * There is deliberately NO grant reference here. An accept-with-always mints a standing grant,
 * and the grant ledger's own event already carries `proposalId` as its link back (391 plan 01).
 * A second copy of that relation, pointing the other way, is two things to keep in step for no
 * gain — and the failure mode is the one the ledger's own note names about revokes: two copies of
 * a link is how one of them starts pointing at nothing.
 */
export const ProposalDecisionRecordSchema = z.object({
  decision: z.enum(PROPOSAL_DECISIONS),
  /** Epoch milliseconds, stamped by the CALLER at decision time. */
  at: z.number().int().nonnegative(),
  reason: z.string().min(1).optional(),
}).strict()

export type ProposalDecisionRecord = z.infer<typeof ProposalDecisionRecordSchema>

/**
 * The DURABLE record: what a proposal file holds, before any read-time computation.
 *
 * A discriminated union on `kind` even at one member, because that is what makes a second kind
 * additive. The `knowledge` arm's payload is `KnowledgeProposalV1Schema` itself — the shipped
 * schema value, not a restatement of its fields — so there is exactly one declaration of what a
 * knowledge proposal is and this envelope cannot drift from it.
 *
 * `status` is absent on purpose. The envelope's status is COMPUTED at read from the durable state
 * plus the clock ({@link computeProposalEnvelopeStatus}); a stored copy would be a second answer
 * to the same question, wrong from the moment an expiry passed with nobody looking.
 */
export const ProposalRecordSchema = z.discriminatedUnion('kind', [
  z.object({
    schemaVersion: z.literal(CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION),
    id: ProposalIdSchema,
    kind: z.literal('knowledge'),
    origin: ProposalOriginSchema,
    payload: KnowledgeProposalV1Schema,
  }).strict(),
  // 394 D-05: every draft proposes, keep-eligible included.
  z.object({
    schemaVersion: z.literal(CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION),
    id: ProposalIdSchema,
    kind: z.literal('test-draft'),
    origin: ProposalOriginSchema,
    payload: TestDraftProposalV1Schema,
  }).strict(),
  // 395 D-01/D-17 · CFGM-01: the config editor's one artifact. Accepting it makes ONE git commit
  // in the person's own repository, which is why its payload carries bytes rather than refs — see
  // `config-mutation/proposal.ts`'s header for the exception and what buys it.
  z.object({
    schemaVersion: z.literal(CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION),
    id: ProposalIdSchema,
    kind: z.literal('config'),
    origin: ProposalOriginSchema,
    payload: ConfigProposalV1Schema,
  }).strict(),
])

export type ProposalRecord = z.infer<typeof ProposalRecordSchema>

/**
 * What the store durably KNOWS about a proposal, independent of the clock.
 *
 * Three states, not four: expiry is not something a store can record, because nothing happens at
 * the moment a proposal expires. It is a fact about the gap between when the proposal was made
 * and when somebody is looking, which is why it is computed and why there is no reaper.
 */
export const PROPOSAL_DURABLE_STATES = ['pending', 'applied', 'rejected'] as const

export type ProposalDurableState = (typeof PROPOSAL_DURABLE_STATES)[number]

/**
 * THE lifecycle rule, spelled once (D-12).
 *
 * A decided proposal keeps its decision forever. Only a proposal nobody decided can expire, and
 * it expires strictly after `PROPOSAL_EXPIRY_MS` has elapsed since it was proposed — at exactly
 * the boundary it is still pending, so a caller and a reader disagreeing by a millisecond
 * disagree about nothing.
 *
 * Pure: no clock read, no store. The caller supplies `now`, which is what lets the store, the
 * inbox, the digest and every test compute the same answer from the same two numbers instead of
 * each deriving a rule from the file suffixes it happens to see.
 */
export function computeProposalEnvelopeStatus(input: {
  durableState: ProposalDurableState
  proposedAt: number
  now: number
}): ProposalEnvelopeStatus {
  if (input.durableState !== 'pending') return input.durableState
  return input.now > input.proposedAt + PROPOSAL_EXPIRY_MS ? 'expired' : 'pending'
}

/**
 * The READ-TIME envelope: the durable record plus the two things only a reader can know.
 *
 * A DTO rather than a zod schema, and that is the honest shape: nothing parses one off a wire.
 * It is what a projection composes and a surface renders, so the contract it owes is a type, and
 * a schema here would invite somebody to persist one — which is precisely the second
 * representation of `status` this module refuses to keep.
 */
/** Everything an envelope carries that does NOT depend on which kind it is. */
export interface ProposalEnvelopeCommon {
  id: string
  /** Computed by {@link computeProposalEnvelopeStatus}, never read off a file. */
  status: ProposalEnvelopeStatus
  /**
   * OPTIONAL, and the absence is a true statement rather than a gap (391 plan 03).
   *
   * The durable {@link ProposalRecordSchema} requires an origin, so every proposal minted through
   * the envelope carries one. But 387 shipped a store whose files are bare
   * `KnowledgeProposalV1` documents with no attribution field at all, and D-08 absorbs those as
   * data — unmigrated, byte-untouched. An inbox listing one of them has nobody to name, and the
   * two ways to make this field required are both worse than saying so: fabricating an emitter
   * from the proposal's verb is exactly the invented attribution `runId`'s own note refuses one
   * paragraph above, and refusing to list the file would hide a real pending decision.
   */
  origin?: ProposalOrigin
  /** What to go and look at before deciding. Empty is allowed and means exactly that. */
  evidenceRefs: readonly ProposalEvidenceRef[]
  /** Present exactly when somebody decided. Absent for `pending` and for `expired`. */
  decision?: ProposalDecisionRecord
}

/**
 * The READ-TIME envelope: the durable record plus the two things only a reader can know.
 *
 * A DTO rather than a zod schema, and that is the honest shape: nothing parses one off a wire.
 * It is what a projection composes and a surface renders, so the contract it owes is a type, and
 * a schema here would invite somebody to persist one — which is precisely the second
 * representation of `status` this module refuses to keep.
 *
 * DISCRIMINATED ON `kind`, WITH THE PAYLOAD CORRELATED (394-06). It was a flat interface carrying
 * `kind: ProposalKind` and `payload: ProposalRecord['payload']` as INDEPENDENT fields, which was
 * harmless while there was one kind and one payload. With three it would be actively wrong: a
 * reader narrowing on `envelope.kind === 'knowledge'` would learn nothing about `payload`, so
 * every consumer would have to re-discriminate on the payload's own fields — a second
 * classification of the same value, free to disagree with the first. Correlating them means the
 * narrow a consumer already writes is the narrow that works.
 */
export type ProposalEnvelope = {
  [K in ProposalKind]: ProposalEnvelopeCommon & {
    kind: K
    /** The kind's own content, unforked. */
    payload: Extract<ProposalRecord, { kind: K }>['payload']
  }
}[ProposalKind]
