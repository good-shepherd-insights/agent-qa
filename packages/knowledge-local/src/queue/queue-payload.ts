import { z } from 'zod'

import {
  canonicalJson,
  distilledObservationSchema,
  sha256hex,
} from '@vostride/agent-qa-schema'
import type {
  Anchor,
  BundleKind,
  ExecutionContext,
  FactSubtype,
  ScopeKey,
} from '@vostride/agent-qa-schema'

export const CURATION_QUEUE_SCHEMA_VERSION = 1

const SHA256_HEX = /^[0-9a-f]{64}$/

const scopeSchema: z.ZodType<ScopeKey> = z
  .object({
    tier: z.enum(['global', 'product', 'suite', 'test']),
    key: z.string().min(1),
  })
  .strict()

const anchorSchema: z.ZodType<Anchor> = z.discriminatedUnion('t', [
  z.object({ t: z.literal('page'), route: z.string() }).strict(),
  z.object({ t: z.literal('flow'), name: z.string() }).strict(),
  z
    .object({
      t: z.literal('el'),
      role: z.string(),
      name: z.string(),
      ordinal: z.number().int().optional(),
    })
    .strict(),
  z
    .object({
      t: z.literal('platform'),
      platform: z.enum(['web', 'android', 'ios']),
    })
    .strict(),
  z.object({ t: z.literal('selector'), literal: z.string() }).strict(),
  z.object({ t: z.literal('error'), message: z.string() }).strict(),
])

const bundleKindSchema: z.ZodType<BundleKind> = z.enum([
  'fact',
  'procedure',
  'caution',
  'unknown',
  'policy',
])
const factSubtypeSchema: z.ZodType<FactSubtype> = z.enum([
  'selector',
  'behavioral',
  'navigational',
  'measurement',
  'content',
])
const executionContextSchema: z.ZodType<ExecutionContext> = z.enum([
  'local-interactive',
  'local-headless',
  'ci',
  'cloud',
])

const artifactInventoryEntrySchema = z
  .object({
    relativePath: z.string().regex(/^artifacts\/[0-9a-f]{64}$/),
    sha256: z.string().regex(SHA256_HEX),
    bytes: z.number().int().nonnegative(),
    stepIndex: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.relativePath !== `artifacts/${entry.sha256}`) {
      ctx.addIssue({
        code: 'custom',
        path: ['relativePath'],
        message: 'artifact relativePath must match its SHA-256 digest',
      })
    }
  })

const addressShape = {
  schemaVersion: z.literal(CURATION_QUEUE_SCHEMA_VERSION),
  sourceRunId: z.string().min(1),
  scope: scopeSchema,
  buildOrdinal: z.number().int().nonnegative(),
  executionContext: executionContextSchema,
  secretFlagged: z.boolean(),
  injectionFlagged: z.boolean(),
  kind: bundleKindSchema,
  subtype: factSubtypeSchema.optional(),
  anchors: z.array(anchorSchema).min(1),
  summarySeed: z.string(),
  bodySeed: z.string(),
  distilledObservations: z.array(distilledObservationSchema),
  evidenceToken: z.string().min(1),
  attributingObservationId: z.string().min(1),
  artifactInventory: z.array(artifactInventoryEntrySchema),
  /** Diagnostic only; wall-clock metadata is excluded from queue identity. */
  emittedAt: z.string(),
} as const

function validateCandidateSemantics(
  value: {
    kind: BundleKind
    subtype?: FactSubtype
    artifactInventory: readonly { relativePath: string }[]
  },
  ctx: z.RefinementCtx,
): void {
  if (value.kind === 'fact' && value.subtype === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['subtype'],
      message: 'fact candidates require a fact subtype',
    })
  }
  if (value.kind !== 'fact' && value.subtype !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['subtype'],
      message: 'only fact candidates may carry a fact subtype',
    })
  }
  const paths = new Set<string>()
  for (const [index, artifact] of value.artifactInventory.entries()) {
    if (paths.has(artifact.relativePath)) {
      ctx.addIssue({
        code: 'custom',
        path: ['artifactInventory', index, 'relativePath'],
        message: 'artifact inventory paths must be unique',
      })
    }
    paths.add(artifact.relativePath)
  }
}

const curationCandidateAddressFieldsSchema = z
  .object(addressShape)
  .strict()
  .superRefine(validateCandidateSemantics)

export const curationCandidatePayloadSchema = z
  .object({
    candidateId: z.string().regex(SHA256_HEX),
    ...addressShape,
  })
  .strict()
  .superRefine((payload, ctx) => {
    validateCandidateSemantics(payload, ctx)
    const { candidateId, ...fields } = payload
    if (candidateId !== candidateContentAddress(fields)) {
      ctx.addIssue({
        code: 'custom',
        path: ['candidateId'],
        message: 'candidateId must equal the deterministic payload content address',
      })
    }
  })

export type CurationCandidateAddressFields = z.infer<
  typeof curationCandidateAddressFieldsSchema
>
export type CurationCandidatePayload = z.infer<typeof curationCandidatePayloadSchema>
export type CurationCandidateArtifact = z.infer<typeof artifactInventoryEntrySchema>

/**
 * Hashes every payload field except derived candidateId and diagnostic emittedAt. Identity covers
 * schema/run/scope/ordinal/posture flags, candidate kind/subtype, anchors and seeds, distilled
 * observations, evidence attribution, and the complete artifact inventory.
 */
export function candidateContentAddress(fields: CurationCandidateAddressFields): string {
  const parsed = curationCandidateAddressFieldsSchema.parse(fields)
  const { emittedAt: _diagnostic, ...deterministic } = parsed
  return sha256hex(canonicalJson(deterministic))
}
