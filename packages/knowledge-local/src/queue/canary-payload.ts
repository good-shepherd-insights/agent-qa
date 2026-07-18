import { z } from 'zod'

import { canonicalJson, sha256hex } from '@vostride/agent-qa-schema'

import { curationCandidateProjectionSchema } from './queue-payload.js'

export const CANARY_QUEUE_SCHEMA_VERSION = 2

// Reuse the curation queue's exact Anchor validator without widening its public payload.
const anchorSchema = curationCandidateProjectionSchema.shape.anchors.element

const canaryOutcomePayloadShape = {
  schemaVersion: z.literal(CANARY_QUEUE_SCHEMA_VERSION),
  jobKind: z.literal('canary-outcome'),
  candidateId: z.string().min(1),
  runId: z.string().min(1),
  testId: z.string().min(1),
  testIndex: z.number().int().nonnegative(),
  buildOrdinal: z.number().int().nonnegative(),
  stepIndex: z.number().int().nonnegative(),
  outcome: z.enum(['positive', 'negative']),
  exercisedAnchor: anchorSchema,
  attribution: z.string(),
  briefDigest: z.string().min(1),
} as const

/** Pin 3 sibling payload; curation payloads deliberately retain their original shape. */
export const canaryOutcomePayloadSchema = z
  .object(canaryOutcomePayloadShape)
  .strict()

const canaryOutcomeAddressFieldsSchema = z
  .object({
    ...canaryOutcomePayloadShape,
    /** Diagnostic only; wall-clock metadata never participates in durable identity. */
    emittedAt: z.string().optional(),
  })
  .strict()

export type CanaryOutcomePayload = z.infer<typeof canaryOutcomePayloadSchema>
export type CanaryOutcomeAddressFields = z.infer<
  typeof canaryOutcomeAddressFieldsSchema
>

/** Content-address all attribution authority while excluding diagnostic wall-clock metadata. */
export function canaryOutcomeContentAddress(
  fields: CanaryOutcomeAddressFields,
): string {
  const parsed = canaryOutcomeAddressFieldsSchema.parse(fields)
  const { emittedAt: _diagnostic, ...deterministic } = parsed
  return sha256hex(canonicalJson(deterministic))
}
