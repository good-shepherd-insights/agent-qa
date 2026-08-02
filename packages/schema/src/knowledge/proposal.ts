// The knowledge-review proposal and its forget receipt (Phase 387, KREV-01 · D-17/D-19).
//
// 391-SHAPED (2026-08-02, D-17): the proposals inbox, `StandingApprovalGrant` and the
// per-run digest engine that Phase 391 builds absorb THIS DTO as data — do not fork it
// there. 387 ships the two-step seam only (propose computes typed deltas and commits
// nothing; apply routes them through the Curator), and 396's MCP `agent_qa_apply_proposal`
// projects the same shape. Re-minting it once two consumers exist would be a cross-surface
// contract migration, which is precisely the cost this note exists to avoid.
//
// The two-step shape is not ceremony. A one-shot mutating call would mean the only way to
// find out what a verb was about to do is to let it do it — and "forget" is not an operation
// anyone wants to learn the scope of afterwards.

import { z } from 'zod'

import { DELTA_KINDS } from '../delta/delta'
import { DELTA_ORIGINS } from '../delta/envelope'
import type { Delta } from '../delta/delta'
import { ENTITY_STATUSES } from '../entity/entity-card'
import { parseShortId } from '../entity/kinds'
import { BundleProvenanceSchema } from './bundle-files'

/** The three mutating review verbs (KREV-01). Closed: there is no fourth review verb. */
export const KNOWLEDGE_REVIEW_VERBS = ['accept', 'reject', 'forget'] as const

export type KnowledgeReviewVerb = (typeof KNOWLEDGE_REVIEW_VERBS)[number]

/**
 * A proposal is `pending` until its deltas reach `commit()`, then `applied`.
 *
 * Two states, not three: there is deliberately no `rejected`/`expired` state, because 387
 * keeps no inbox for a proposal to sit in and be reaped from (D-17). 391 owns the lifecycle
 * that would need them, and it inherits this field rather than replacing it.
 */
export const KNOWLEDGE_PROPOSAL_STATUSES = ['pending', 'applied'] as const

export type KnowledgeProposalStatus = (typeof KNOWLEDGE_PROPOSAL_STATUSES)[number]

/**
 * The §7.7 projections a forget must scrub. Closed, and the closure is the point: "scrub
 * every projection" is only a checkable promise if the set of projections is enumerable.
 */
export const KNOWLEDGE_PROJECTIONS = ['fts', 'vec', 'graph', 'exemplar'] as const

export type KnowledgeProjection = (typeof KNOWLEDGE_PROJECTIONS)[number]

/**
 * A proposal id, refined rather than a bare string.
 *
 * It travels between two separate process invocations (propose, then apply) and is echoed
 * into receipts, so it is attacker-reachable input to whatever 387-08 uses it to look a
 * proposal up by. The pattern admits both a hex mint and an `id-agent` word-id while
 * refusing whitespace, path separators and the empty body — the shapes that turn a lookup
 * key into a traversal.
 */
export const ProposalIdSchema = z
  .string()
  .min(10)
  .regex(/^prop_[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'expected a prop_-prefixed lowercase proposal id')

/**
 * WHAT a review verb is about, at either of the two grains D-19 pins: one record, or the
 * `MEM-` addressed bundle that contains records.
 *
 * ONE union serves the proposal's `targetRef` and the forget verb's target
 * ({@link ForgetTargetRefSchema} is this same value under the name D-19 uses). A second,
 * parallel union for the non-forget verbs would be a second thing to keep in step for no
 * gain: the grains are the same grains.
 *
 * The bundle arm refuses a well-formed short-ID of any other kind. `TST-001` parses and
 * resolves to a real entity — it is simply not a thing knowledge review applies to, and a
 * ref that reached the store before anyone noticed would address by coincidence.
 */
export const KnowledgeTargetRefSchema = z.discriminatedUnion('grain', [
  z.object({
    grain: z.literal('record'),
    recordId: z.string().min(1),
  }).strict(),
  z.object({
    grain: z.literal('bundle'),
    shortId: z.string().refine(
      (value) => parseShortId(value)?.kind === 'MEM',
      'expected a MEM- short-ID addressing a knowledge bundle',
    ),
  }).strict(),
])

export type KnowledgeTargetRef = z.infer<typeof KnowledgeTargetRefSchema>

/** {@link KnowledgeTargetRefSchema} under the name D-19 gives it. Deliberately the same value. */
export const ForgetTargetRefSchema = KnowledgeTargetRefSchema

export type ForgetTargetRef = KnowledgeTargetRef

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const DELTA_KIND_SET = new Set<string>(DELTA_KINDS)
const DELTA_ORIGIN_SET = new Set<string>(DELTA_ORIGINS)

/**
 * Validates a proposal's deltas at ENVELOPE depth — the discriminant plus the three fields
 * every arm of the union carries — and no deeper.
 *
 * The depth is a deliberate, stated limit rather than an oversight. `Delta` is a type-only
 * union (see `DELTA_KINDS` for why a runtime projection of its discriminant exists at all),
 * so a full arm-by-arm schema here would be a SECOND declaration of the write vocabulary,
 * free to drift from the one `commit()` actually applies. Arm interiors are validated where
 * they are applied; what this boundary owes is that an unrecognised kind or a delta with no
 * attributable origin never reaches that point looking well-formed.
 */
const DeltaSchema = z.custom<Delta>(
  (value) =>
    isNonArrayObject(value) &&
    typeof value.kind === 'string' &&
    DELTA_KIND_SET.has(value.kind) &&
    typeof value.origin === 'string' &&
    DELTA_ORIGIN_SET.has(value.origin) &&
    isNonArrayObject(value.scope) &&
    typeof value.scope.tier === 'string' &&
    typeof value.scope.key === 'string' &&
    Array.isArray(value.citedIds) &&
    value.citedIds.every((member) => typeof member === 'string'),
  'expected a §7.3 delta carrying its envelope (kind, origin, scope, citedIds)',
)

/** One record a forget tombstones, with the provenance that survives it (D-19). */
export const TombstonedRecordSchema = z.object({
  recordId: z.string().min(1),
  provenance: BundleProvenanceSchema,
}).strict()

export type TombstonedRecord = z.infer<typeof TombstonedRecordSchema>

const scrubSetSchema = z
  .array(z.enum(KNOWLEDGE_PROJECTIONS))
  .refine(
    (members) => new Set(members).size === members.length,
    'projectionsScrubbed is a SUBSET of the scrub set, not a log of attempts',
  )

/**
 * What a forget DID, designed once for its two uses (D-19 + D-04): the value the apply verb
 * returns, and the content the forgotten entity's permanent address resolves to afterwards.
 *
 * That second use is why `resultingBundleStatus` is drawn from the MEM card's own status
 * vocabulary rather than the broader bundle-status one. A receipt that reported `deprecated`
 * would force the card producer to MAP it to something renderable, and a mapping step is
 * exactly where "designed once for both uses" quietly becomes "designed for one use plus a
 * translation" — with the schema boundary no longer refusing an undeclared status (D-12).
 *
 * Every tombstoned record is enumerated with its provenance because a receipt that listed
 * only what it happened to find is a receipt nobody can act on: forgetting a bundle lists
 * every member record, and nothing is silently partial.
 */
export const ForgetReceiptV1Schema = z.object({
  schemaVersion: z.literal(1),
  proposalId: ProposalIdSchema,
  tombstonedRecords: z.array(TombstonedRecordSchema),
  projectionsScrubbed: scrubSetSchema,
  resultingBundleStatus: z.enum(ENTITY_STATUSES.MEM),
  forgottenAt: z.number().int().nonnegative(),
}).strict()

export type ForgetReceiptV1 = z.infer<typeof ForgetReceiptV1Schema>

/**
 * What a forget WOULD do, which is a different claim from what it did.
 *
 * Not a {@link ForgetReceiptV1}: a receipt states what happened and carries the moment it
 * happened, and typing the preview the same way would have put a fabricated `forgottenAt` on
 * every proposal. Propose can honestly enumerate the targets and name the projections it
 * intends to scrub; it cannot know when, or that it succeeded.
 */
export const ForgetPreviewSchema = z.object({
  tombstonedRecords: z.array(TombstonedRecordSchema),
  projectionsToScrub: scrubSetSchema,
}).strict()

export type ForgetPreview = z.infer<typeof ForgetPreviewSchema>

/**
 * The proposal itself: what would change, what it is about, and an id to apply it by —
 * committing nothing (D-17).
 */
export const KnowledgeProposalV1Schema = z.object({
  schemaVersion: z.literal(1),
  proposalId: ProposalIdSchema,
  verb: z.enum(KNOWLEDGE_REVIEW_VERBS),
  targetRef: KnowledgeTargetRefSchema,
  deltas: z.array(DeltaSchema),
  /** Present only on a forget proposal — the "show what would be removed" half of D-19. */
  receiptPreview: ForgetPreviewSchema.optional(),
  proposedAt: z.number().int().nonnegative(),
  status: z.enum(KNOWLEDGE_PROPOSAL_STATUSES),
}).strict().superRefine((value, ctx) => {
  if (value.receiptPreview !== undefined && value.verb !== 'forget') {
    ctx.addIssue({
      code: 'custom',
      path: ['receiptPreview'],
      message: 'only a forget proposal previews tombstones (D-19)',
    })
  }
})

export type KnowledgeProposalV1 = z.infer<typeof KnowledgeProposalV1Schema>
