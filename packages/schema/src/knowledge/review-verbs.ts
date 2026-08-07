// The five knowledge review verbs' input and output contracts (Phase 387, KREV-01/KREV-02).
//
// Four of the five verbs are WIRING over functions the read-only reader entry already
// exports (`inspectRecords`, `diffSince`, `listBundles`, the record read) — that is KREV-01's
// own claim, and it only stays true if the DTOs here PROJECT those return shapes instead of
// paraphrasing them. So the inspect and diff outputs carry the reader's own view schemas
// verbatim; a paraphrase would have quietly become a second view to keep in step, and the
// first field to drift would have been the one nobody looked at.
//
// The fifth verb — "why did the brief say this" — is the one with a real contract of its
// own, and it is a contract about HONESTY rather than shape (D-15).

import { z } from 'zod'

import { ServedRetrievalTraceV1Schema } from '../brief/retrieval-trace'
import type { ServedBrief } from '../brief/served-brief'
import { InspectFilterSchema, InspectRecordViewSchema, RecordChangeSchema } from './maintenance-views'
import { BundleProvenanceSchema } from './bundle-files'
import {
  ForgetReceiptV1Schema,
  ForgetTargetRefSchema,
  KnowledgeProposalV1Schema,
  KnowledgeTargetRefSchema,
  ProposalIdSchema,
} from './proposal'

export {
  ForgetTargetRefSchema,
  KnowledgeTargetRefSchema,
} from './proposal'
export type { ForgetTargetRef, KnowledgeTargetRef } from './proposal'

/**
 * WHY a why-question has no answer. Closed, and each member names a genuinely different
 * situation a surface has to phrase differently:
 *
 *   `pre-trace-run`   — the run predates trace capture. Nothing was lost; nothing was ever
 *                       written. This is permanent and no amount of retrying changes it.
 *   `artifact-missing`— the run captured a trace and the artifact is gone (pruned, moved).
 *   `step-not-found`  — the run and its trace exist; the step being asked about does not.
 *
 * A bare "no trace" would have collapsed all three, and the only message a surface could
 * then print is one that tells the reader nothing about whether to go looking.
 */
export const BRIEF_WHY_NO_TRACE_REASONS = [
  'pre-trace-run',
  'artifact-missing',
  'step-not-found',
] as const

export type BriefWhyNoTraceReason = (typeof BRIEF_WHY_NO_TRACE_REASONS)[number]

/**
 * The complete arm set of {@link BriefWhyResultSchema}, as a value.
 *
 * Exported so the closure can be asserted as an exact member set. "No test exercises a
 * re-run arm" is a claim about a test file; this is a claim about the contract — and the
 * absent arm is the whole design (D-15). Re-running retrieval would answer about the index
 * as it stands NOW, while the question asked is always about then.
 */
export const BRIEF_WHY_RESULT_KINDS = ['answered', 'no-trace'] as const

export type BriefWhyResultKind = (typeof BRIEF_WHY_RESULT_KINDS)[number]

/**
 * Validates an offered `ServedBrief` at the §A11 three-channel depth.
 *
 * `ServedBrief` is a TypeScript interface whose only runtime schema in the tree requires the
 * acceptance-grade `proof` block, and a historical brief — exactly the kind offered on the
 * no-trace arm — has no proof. So the offering is checked against the closed channel set
 * §A11 fixes, which is the structure any consumer of this arm renders, and no deeper.
 *
 * STRUCTURAL, not `z.custom`. 2026-08-02 (387-06): the predicate form was correct and
 * unprojectable — `z.toJSONSchema` throws `Custom types cannot be represented in JSON Schema`
 * on it, and the function layer projects EVERY registered contract into an inert document at
 * registry-construction time (D-14). So the moment an op declared this union as its output,
 * building a registry threw and every capability in the process stopped listing, not just this
 * one. A predicate that cannot be described is a contract no catalog can publish, and 396's
 * MCP tool listing consumes exactly that description.
 *
 * `looseObject` rather than a strict one, because a real brief carries more than the three
 * channels (`proof`, and whatever §A11 adds next) and an offering is a value being PASSED ON,
 * not one being defined here. The acceptance and rejection behaviour is identical to the
 * predicate it replaces: an array carrying every channel as a named property is still refused,
 * a null is still refused, a missing digest is still refused, and a non-array channel is still
 * refused — measured against 387-02's nine-case rejection corpus, which is unchanged.
 */
const ServedBriefOfferingSchema = z.looseObject({
  channel1: z.array(z.unknown()),
  channel2: z.array(z.unknown()),
  channel3: z.array(z.unknown()),
  briefDigest: z.string(),
}) as unknown as z.ZodType<ServedBrief>

/**
 * The why-verb's answer: the trace that was written down, or a named reason there is none —
 * and never a third thing (D-15).
 *
 * The two arms are structurally incompatible on purpose. A trace on the absence arm is
 * exactly the shape a re-run would arrive in, so the schema refuses it rather than trusting
 * a future implementer to remember why the arm is empty.
 */
export const BriefWhyResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('answered'),
    trace: ServedRetrievalTraceV1Schema,
    /** Where the brief this trace explains lives, when the caller wants to read it too. */
    servedBriefRef: z.string().min(1).optional(),
  }).strict(),
  z.object({
    kind: z.literal('no-trace'),
    reason: z.enum(BRIEF_WHY_NO_TRACE_REASONS),
    /** Offered when the brief survived even though its trace did not. */
    servedBrief: ServedBriefOfferingSchema.optional(),
  }).strict(),
])

export type BriefWhyResult = z.infer<typeof BriefWhyResultSchema>

/**
 * Which step's brief is being asked about.
 *
 * `runId` + `stepIndex` is the primary key and `recordId` filters within it (RESEARCH open
 * question 3). `testId` is the disambiguator that key needs in practice and did not have:
 * `stepIndex` is per TEST, so a run with two tests has two step 0s. It is optional because a
 * single-test run needs no disambiguation — and under the never-guess contract the verb
 * refuses an ambiguous address rather than picking the first test.
 */
export const BriefWhyInputSchema = z.object({
  runId: z.string().min(1),
  testId: z.string().min(1).optional(),
  stepIndex: z.number().int().nonnegative(),
  recordId: z.string().min(1).optional(),
}).strict()

export type BriefWhyInput = z.infer<typeof BriefWhyInputSchema>

/** Accept a candidate: promote what the store already holds. */
export const KnowledgeAcceptInputSchema = z.object({
  target: KnowledgeTargetRefSchema,
}).strict()

export type KnowledgeAcceptInput = z.infer<typeof KnowledgeAcceptInputSchema>

/**
 * Reject a candidate. The reason is REQUIRED because the delta this becomes (`Deprecate`)
 * requires one — an input DTO that let it through empty would have handed the verb the job
 * of inventing a justification for a human decision.
 */
export const KnowledgeRejectInputSchema = z.object({
  target: KnowledgeTargetRefSchema,
  reason: z.string().min(1),
}).strict()

export type KnowledgeRejectInput = z.infer<typeof KnowledgeRejectInputSchema>

/** Forget a record or a whole bundle (D-19). */
export const KnowledgeForgetInputSchema = z.object({
  target: ForgetTargetRefSchema,
}).strict()

export type KnowledgeForgetInput = z.infer<typeof KnowledgeForgetInputSchema>

/**
 * What a PROPOSE op takes on top of the verb it proposes: the run the caller is serving (391-07).
 *
 * Run identity is a fact about the CALL, not about the verb — which is why it lives on the op's
 * input rather than on {@link KnowledgeForgetInput} and friends beneath it, and why the port
 * takes it as a second parameter rather than as a field on the request union. The verb answers
 * "what would change"; the run answers "who asked, on whose behalf", and only a run-scoped caller
 * knows it. A composition-bound alternative would have named the wrong noun: a composition is a
 * HOST — a daemon serves many runs over its lifetime and a CLI one-shot is no run at all — so
 * binding identity there would attribute proposals to a process.
 *
 * OPTIONAL, and its absence is a true statement rather than a gap: a proposal minted by a
 * directly invoked CLI verb belongs to no run, and inventing one so the field could be required
 * is the fabricated attribution the origin vocabulary refuses elsewhere.
 *
 * DISPLAY AND GROUPING ONLY (T-391-20). Nothing authorizes on this value: the gate never reads
 * `origin.runId`, and no scope, grant or protected-class decision consumes it. A caller that
 * misstates its run can mislead a digest reader and gains no capability, which is why it is
 * accepted from the input rather than derived from a trusted source.
 */
const PROPOSE_RUN_ATTRIBUTION = { runId: z.string().min(1).optional() }

/** {@link KnowledgeForgetInputSchema} as the forget-propose OP takes it. */
export const KnowledgeForgetProposeInputSchema = z.object({
  ...KnowledgeForgetInputSchema.shape,
  ...PROPOSE_RUN_ATTRIBUTION,
}).strict()

export type KnowledgeForgetProposeInput = z.infer<typeof KnowledgeForgetProposeInputSchema>

/** Apply a proposal by id — the second half of the two-step (D-17). */
export const KnowledgeProposalApplyInputSchema = z.object({
  proposalId: ProposalIdSchema,
}).strict()

export type KnowledgeProposalApplyInput = z.infer<typeof KnowledgeProposalApplyInputSchema>

/**
 * What an apply DID, and whether this call is the one that did it.
 *
 * `outcome` is not decoration. Applying a proposal twice is an ordinary thing for a retrying
 * surface to do (a dropped socket, a re-issued MCP tool call, an operator pressing the key
 * again), and the second call must be able to say "this was already applied, here is what it
 * did" without committing a second time. Reporting that as an ordinary success would make the
 * two indistinguishable, and reporting it as a throw would throw away the receipt — which is
 * the one thing the caller asked for. So it is an ARM, and the receipt rides on both arms.
 */
export const KnowledgeProposeOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('proposed'),
    proposal: KnowledgeProposalV1Schema,
  }).strict(),
  z.object({
    kind: z.literal('target-not-found'),
    /** Echoed so an answer pasted into an issue still says what was asked about. */
    target: KnowledgeTargetRefSchema,
  }).strict(),
])

export type KnowledgeProposeOutcomeDto = z.infer<typeof KnowledgeProposeOutcomeSchema>

export const KNOWLEDGE_APPLY_OUTCOMES = ['applied', 'already-applied'] as const

export type KnowledgeApplyOutcomeKind = (typeof KNOWLEDGE_APPLY_OUTCOMES)[number]

export const KnowledgeApplyOutcomeSchema = z.object({
  outcome: z.enum(KNOWLEDGE_APPLY_OUTCOMES),
  proposal: KnowledgeProposalV1Schema,
  /** Present exactly when the applied verb was `forget` (D-19). */
  forgetReceipt: ForgetReceiptV1Schema.optional(),
}).strict()

export type KnowledgeApplyOutcomeDto = z.infer<typeof KnowledgeApplyOutcomeSchema>

/** `inspectRecords`' structural filter, unchanged — the verb is a client, not a rewrite. */
export const KnowledgeRecordsInspectInputSchema = z.object({
  filter: InspectFilterSchema,
}).strict()

export type KnowledgeRecordsInspectInput = z.infer<typeof KnowledgeRecordsInspectInputSchema>

export const KnowledgeRecordsInspectOutputSchema = z.object({
  schemaVersion: z.literal(1),
  records: z.array(InspectRecordViewSchema),
}).strict()

export type KnowledgeRecordsInspectOutput = z.infer<typeof KnowledgeRecordsInspectOutputSchema>

export const KnowledgeRecordsDiffInputSchema = z.object({
  sinceOrdinal: z.number().int().nonnegative(),
}).strict()

export type KnowledgeRecordsDiffInput = z.infer<typeof KnowledgeRecordsDiffInputSchema>

/**
 * The diff echoes the ordinal it was taken since. A change list with no baseline is a list
 * whose meaning depends on remembering the question, and these answers get pasted into
 * issues and CI logs where that context is gone.
 */
export const KnowledgeRecordsDiffOutputSchema = z.object({
  schemaVersion: z.literal(1),
  sinceOrdinal: z.number().int().nonnegative(),
  changes: z.array(RecordChangeSchema),
}).strict()

export type KnowledgeRecordsDiffOutput = z.infer<typeof KnowledgeRecordsDiffOutputSchema>

export const KnowledgeRecordShowInputSchema = z.object({
  recordId: z.string().min(1),
}).strict()

export type KnowledgeRecordShowInput = z.infer<typeof KnowledgeRecordShowInputSchema>

/**
 * One record with the provenance that justifies it — the whole point of the verb. A record
 * shown without its provenance is an assertion; shown with it, it is evidence.
 */
export const KnowledgeRecordShowOutputSchema = z.object({
  schemaVersion: z.literal(1),
  record: InspectRecordViewSchema,
  provenance: BundleProvenanceSchema,
  summary: z.string(),
  body: z.string(),
}).strict()

export type KnowledgeRecordShowOutput = z.infer<typeof KnowledgeRecordShowOutputSchema>

/**
 * The show verb's answer: the record with its provenance, or a named absence (FUNC-04).
 *
 * A closed union rather than a throw, because asking about a record id that no bundle carries
 * is an ordinary thing for a reviewer to do — an id gets pasted out of a stale issue, or a
 * record was forgotten between two reads — and the caller has to be able to tell that apart
 * from a store that could not be read at all. A verb that threw on both would have made the
 * routine case indistinguishable from the broken one.
 *
 * The found arm SPREADS {@link KnowledgeRecordShowOutputSchema}'s own shape rather than
 * restating its fields, so the two cannot drift: there is one declaration of what showing a
 * record yields, and this union only adds the discriminant that makes absence expressible.
 */
export const KnowledgeRecordShowResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('found'),
    ...KnowledgeRecordShowOutputSchema.shape,
  }).strict(),
  z.object({
    kind: z.literal('not-found'),
    schemaVersion: z.literal(1),
    /** Echoed so an answer pasted into an issue still says what was asked about. */
    recordId: z.string().min(1),
  }).strict(),
])

export type KnowledgeRecordShowResult = z.infer<typeof KnowledgeRecordShowResultSchema>
