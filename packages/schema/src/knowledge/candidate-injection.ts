import { z } from 'zod'
import { BriefLineSchema } from '../brief/guard-lossless-served-brief'
import { BundleKindSchema, BundleStatusSchema } from '../functions/knowledge'
import { RecordAnchorsSchema, RecordScopeSchema } from './record-frontmatter'

/**
 * 2026-09-07, 417 D-01, ARCHITECTURE §2.2: the DATA the cli bridge carries from
 * knowledge into eval-local. Declared here because agent and knowledge-local
 * both name it and neither may name eval. One brief line, never a prompt or code edit.
 */
export const CandidateInjectionSchema = z.object({
  candidateId: z.string().min(1),
  kind: BundleKindSchema,
  product: z.string().min(1),
  scope: RecordScopeSchema,
  anchors: RecordAnchorsSchema,
  status: BundleStatusSchema,
  line: BriefLineSchema,
  renderedLine: z.string().min(1),
  provenance: z.object({
    runIds: z.array(z.string()),
    receiptDigests: z.array(z.string()),
    capturedAtOrdinals: z.array(z.number().int()),
  }).strict(),
  target: z.object({
    runId: z.string().min(1),
    stepIndex: z.number().int().nonnegative(),
    testId: z.string().optional(),
    sourceBuildOrdinal: z.number().int().optional(),
  }).strict().optional(),
  latestOrdinal: z.number().int().nonnegative(),
}).strict()

export const KnowledgeCandidateInjectionResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not-found'), recordId: z.string() }).strict(),
  z.object({ kind: z.literal('found'), injection: CandidateInjectionSchema }).strict(),
])

export type CandidateInjection = z.infer<typeof CandidateInjectionSchema>
export type KnowledgeCandidateInjectionResult = z.infer<typeof KnowledgeCandidateInjectionResultSchema>
