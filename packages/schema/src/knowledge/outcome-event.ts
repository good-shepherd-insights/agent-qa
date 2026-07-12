import { z } from 'zod'

import { asEvidenceToken, asRecordId } from '../ids/record-id'

/**
 * The §7.5 trust-prior origin classes. This vocabulary is deliberately separate
 * from DeltaEnvelope.origin, which records producer-stage provenance rather than
 * the strength of the evidence source used by the Beta fold.
 */
export type OriginClass = 'user' | 'agent-verified' | 'agent-observed' | 'import'

const originClassValues = [
  'user',
  'agent-verified',
  'agent-observed',
  'import',
] as const satisfies readonly OriginClass[]

const commonEventShape = {
  evidenceToken: z.string().transform(asEvidenceToken),
  curationJobId: z.string(),
  buildOrdinal: z.number(),
  observationOrdinal: z.number().optional(),
  observationId: z.string().optional(),
}

const originClassSchema = z.enum(originClassValues)
const observationVariant = <T extends 'confirmed' | 'contradicted' | 'helpful' | 'harmful'>(
  type: T,
) => z.object({
  ...commonEventShape,
  type: z.literal(type),
  origin: originClassSchema.optional(),
}).strict()

/**
 * The ONE canonical outcomes log carries attributed observations and explicit
 * lifecycle events. Helpful/harmful are minted now for Phase 380 attribution but
 * have no producer yet (D-10). Every line is real evidence or an explicit lifecycle
 * transition: evidence-incomplete is a prior discount, never a synthetic event
 * (D-08). Lines are append-only and never rewritten after commit (D-09).
 *
 * Event lines intentionally carry no schemaVersion; the containing bundle manifest
 * governs their format version.
 */
export const BundleOutcomeEventSchema = z.discriminatedUnion('type', [
  observationVariant('confirmed'),
  observationVariant('contradicted'),
  observationVariant('helpful'),
  observationVariant('harmful'),
  z.object({
    ...commonEventShape,
    type: z.literal('superseded'),
    byRecordId: z.string().transform(asRecordId),
  }).strict(),
  z.object({
    ...commonEventShape,
    type: z.literal('deprecated'),
    reason: z.string(),
  }).strict(),
  z.object({
    ...commonEventShape,
    type: z.literal('promoted'),
  }).strict(),
  z.object({
    ...commonEventShape,
    type: z.literal('window-close'),
    closedAtOrdinal: z.number(),
  }).strict(),
])

export type BundleOutcomeEvent = z.infer<typeof BundleOutcomeEventSchema>

/**
 * Derivation-level replay identity within one bundle. The record id is implicit
 * because a fold never spans bundle directories.
 */
export function eventDedupKey(event: BundleOutcomeEvent): string {
  return `${event.evidenceToken}:${event.curationJobId}`
}

/** First-wins, order-preserving defense against replayed outcome lines (BNDL-03). */
export function dedupeEvents(events: readonly BundleOutcomeEvent[]): BundleOutcomeEvent[] {
  const keys = new Set<string>()
  const deduped: BundleOutcomeEvent[] = []

  for (const event of events) {
    const key = eventDedupKey(event)
    if (keys.has(key)) continue
    keys.add(key)
    deduped.push(event)
  }

  return deduped
}
