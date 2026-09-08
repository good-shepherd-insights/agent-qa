// 2026-09-08, 419 D-06/D-07/D-08/D-12: the Gate-3 neutral contracts.
import { z } from 'zod'
import type { Action } from '../action/index'
import { actionWireSchema } from '../action/wire-schema'

import { MARKS } from '../knowledge/gate-receipt'
import { PROMOTION_PATHS } from '../knowledge/promotion-path'
import { DeltaSchema, KnowledgeTargetRefSchema, ProposalIdSchema } from '../knowledge/proposal'
import { runIdSchema as runIdCodec, type RunId } from '../run/run-id'
import { VERDICT_CLASSES, type VerdictClass } from '../verdict/verdict'

// Reuse the canonical path validator before its type-only branding transform. The bytes
// are unchanged; this structural schema also supports output JSON-schema projection.
const runIdSchema = runIdCodec.in as unknown as z.ZodType<RunId>
const markIdSchema = z.string().regex(/^mark_[0-9a-f]{12}$/)
const indexSchema = z.number().int().nonnegative()
const correctedActionSchema = actionWireSchema as unknown as z.ZodType<Action>

// prettier-ignore
export const MARK_QUARANTINE_CLASSES = ['flake', 'environment', 'timeout'] as const satisfies readonly VerdictClass[]
export type MarkQuarantineClass = (typeof MARK_QUARANTINE_CLASSES)[number]

export const MARK_FIX_KINDS = ['fact', 'caution', 'procedure-hint', 'test-edit'] as const
export type MarkFixKind = (typeof MARK_FIX_KINDS)[number]

// prettier-ignore
export const MARK_DISPOSITIONS = ['quarantined', 'drafted', 'no-draftable-fix', 'confirmed-bug'] as const

export const NoDraftableFixCheckedSchema = z.object({
  servedRecords: indexSchema,
  procedureReads: indexSchema,
  assertionDrift: z.boolean(),
  rootCause: z.enum(VERDICT_CLASSES).optional(),
}).strict()
export type NoDraftableFixChecked = z.infer<typeof NoDraftableFixCheckedSchema>

export const MarkDispositionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('quarantined'), class: z.enum(MARK_QUARANTINE_CLASSES) }).strict(),
  z.object({
    kind: z.literal('drafted'),
    fix: z.enum(MARK_FIX_KINDS),
    proposalId: z.string().min(1),
    proposalKind: z.enum(['knowledge', 'test-draft']),
  }).strict(),
  z.object({ kind: z.literal('no-draftable-fix'), checked: NoDraftableFixCheckedSchema }).strict(),
  z.object({ kind: z.literal('confirmed-bug'), confirmedRecords: indexSchema }).strict(),
])
export type MarkDisposition = z.infer<typeof MarkDispositionSchema>

export const MarkAddressSchema = z.object({
  runId: runIdSchema,
  testIndex: indexSchema,
  testId: z.string().min(1).optional(),
  stepIndex: indexSchema.optional(),
}).strict()
export type MarkAddress = z.infer<typeof MarkAddressSchema>

export const MARK_RECEIPT_SCHEMA_VERSION = 1
export const MarkReceiptSchema = z.object({
  schemaVersion: z.literal(MARK_RECEIPT_SCHEMA_VERSION),
  markId: markIdSchema,
  ...MarkAddressSchema.shape,
  runSlug: z.string().min(1),
  kind: z.enum(MARKS),
  origin: z.literal('user'),
  /** The 1-based append position governs latest-wins, never markedAt (419 D-11). */
  ordinal: z.number().int().positive(),
  markedAt: indexSchema,
  note: z.string().max(2000).optional(),
  correctedExpectation: z.string().max(2000).optional(),
  correctedAction: correctedActionSchema.optional(),
  rootCause: z.object({ class: z.enum(VERDICT_CLASSES), producer: z.string().min(1) }).strict().optional(),
  isRerun: z.literal(true).optional(),
  disposition: MarkDispositionSchema,
  gold: z.array(z.object({
    cassetteId: z.string().min(1),
    sourceCassetteId: z.string().min(1),
    channel: z.enum(['user-mark', 'overturned-verdict']),
  }).strict()),
  evidence: z.object({ confirmed: indexSchema, overturned: indexSchema }).strict(),
  supersedes: markIdSchema.optional(),
}).strict()
export type MarkReceipt = z.infer<typeof MarkReceiptSchema>

export const RunsMarkInputSchema = z.object({
  runId: runIdSchema,
  testId: z.string().min(1).optional(),
  stepIndex: indexSchema.optional(),
  kind: z.enum(MARKS),
  note: z.string().max(2000).optional(),
  correctedExpectation: z.string().max(2000).optional(),
  correctedAction: correctedActionSchema.optional(),
}).strict()
export type RunsMarkInput = z.infer<typeof RunsMarkInputSchema>

export const RunsMarkOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('marked'), receipt: MarkReceiptSchema }).strict(),
  z.object({ kind: z.literal('already-marked'), receipt: MarkReceiptSchema }).strict(),
  z.object({ kind: z.literal('run-not-found'), runId: runIdSchema }).strict(),
  z.object({ kind: z.literal('member-not-found'), runId: runIdSchema, testId: z.string().optional() }).strict(),
  z.object({
    kind: z.literal('step-not-found'), runId: runIdSchema,
    testIndex: indexSchema, stepIndex: indexSchema, stepCount: indexSchema,
  }).strict(),
  z.object({
    kind: z.literal('ambiguous-address'), runId: runIdSchema,
    candidates: z.array(z.object({ testIndex: indexSchema, testId: z.string().optional() }).strict()).min(2),
  }).strict(),
  z.object({ kind: z.literal('ambiguous-correction'), runId: runIdSchema,
    testIndex: indexSchema, decisionCount: indexSchema }).strict(),
])
export type RunsMarkOutcome = z.infer<typeof RunsMarkOutcomeSchema>

export const IMPROVEMENT_PLAN_SCHEMA_VERSION = 1
const improvementPlanShape = {
  schemaVersion: z.literal(IMPROVEMENT_PLAN_SCHEMA_VERSION),
  markId: markIdSchema,
  feedbackSource: MarkAddressSchema.extend({ kind: z.enum(MARKS) }),
  runTraceRef: z.object({ runId: runIdSchema, runSlug: z.string().min(1) }).strict(),
}
const wordingSchema = z.enum(['model', 'floor'])
export const ImprovementPlanKnowledgeSchema = z.object({
  kind: z.literal('knowledge'),
  ...improvementPlanShape,
  fix: z.enum(['fact', 'caution', 'procedure-hint']),
  target: KnowledgeTargetRefSchema,
  deltas: z.array(DeltaSchema).min(1),
  wording: wordingSchema,
}).strict().superRefine((value, ctx) => {
  value.deltas.forEach((delta, index) => {
    if (delta.kind === 'MintUnknown') {
      ctx.addIssue({ code: 'custom', path: ['deltas', index, 'kind'], message: 'a mark never mints unknown knowledge (419 D-12)' })
    }
  })
})
export type ImprovementPlanKnowledge = z.infer<typeof ImprovementPlanKnowledgeSchema>

export const ImprovementPlanSchema = z.discriminatedUnion('kind', [
  ImprovementPlanKnowledgeSchema,
  z.object({
    kind: z.literal('test-edit'), ...improvementPlanShape,
    fix: z.literal('test-edit'), testRef: z.string().min(1), intent: z.string().min(1), wording: wordingSchema,
  }).strict(),
  z.object({
    kind: z.literal('no-draftable-fix'), ...improvementPlanShape, checked: NoDraftableFixCheckedSchema,
  }).strict(),
])
export type ImprovementPlan = z.infer<typeof ImprovementPlanSchema>

export const COMMIT_RECEIPT_SCHEMA_VERSION = 1
export const CommitReceiptSchema = z.object({
  schemaVersion: z.literal(COMMIT_RECEIPT_SCHEMA_VERSION),
  proposalId: ProposalIdSchema,
  markId: z.string().optional(),
  committedAtOrdinal: indexSchema,
  recordIds: z.array(z.string().min(1)),
  gate3: z.array(z.object({ candidateId: z.string().min(1), receiptDigest: z.string().min(1) }).strict()),
  promoted: z.array(z.object({ candidateId: z.string().min(1), promotionPath: z.enum(PROMOTION_PATHS) }).strict()),
  held: z.array(z.object({ candidateId: z.string().min(1), reason: z.string().min(1) }).strict()),
  policy: z.object({
    recordId: z.string().min(1), scope: z.string().min(1), relPath: z.string().min(1),
    outcome: z.enum(['written', 'unchanged']),
  }).strict().optional(),
}).strict()
export type CommitReceipt = z.infer<typeof CommitReceiptSchema>

export const RunDetailMemberMarkSchema = z.object({
  markId: markIdSchema,
  kind: z.enum(MARKS),
  ordinal: z.number().int().positive(),
  stepIndex: indexSchema.optional(),
  disposition: MarkDispositionSchema,
}).strict()
export type RunDetailMemberMark = z.infer<typeof RunDetailMemberMarkSchema>

/** OQ5: gate3ArmSchema.stepId uses the same test:step spelling as DisplayStep addressing. */
export function deriveMarkStepId(testIndex: number, stepIndex: number): string {
  return `${testIndex}:${stepIndex}`
}

/** Shared by runs.mark and runs.detail's ledger projection. */
export interface FeedbackPort {
  mark(input: RunsMarkInput): Promise<RunsMarkOutcome>
  marksFor(runId: RunId): Promise<readonly MarkReceipt[]>
}
