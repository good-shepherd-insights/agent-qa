import {
  asEvidenceToken,
  asRecordId,
  type Anchor,
  type ArtifactRef,
  type BundleDraft,
  type BundleKind,
  type CompareAndSet,
  type CurationAuthorship,
  type Delta,
  type ExecutionContext,
  type FactSubtype,
  type RecordId,
  type ScopeKey,
} from '@vostride/agent-qa-schema'
import { z } from 'zod'

import type { CurationCandidatePayload } from '../queue/queue-payload.js'

export const AUTHORED_CHECKPOINT_SCHEMA_VERSION = 1

/** The deterministic author-facing projection of one durable queue payload. */
export type CurationJobView = Pick<
  CurationCandidatePayload,
  | 'candidateId'
  | 'kind'
  | 'subtype'
  | 'anchors'
  | 'summarySeed'
  | 'bodySeed'
  | 'distilledObservations'
  | 'scope'
  | 'buildOrdinal'
  | 'attributingObservationId'
  | 'executionContext'
  | 'secretFlagged'
  | 'injectionFlagged'
>

/** One retrieval hit as shown to the author through a small integer alias. */
interface NeighborRecordBase {
  alias: number
  recordId: RecordId
  summary: string
  anchors: Anchor[]
  observedStatus: string
  observedOrdinal: number
}

type NonFactNeighborRecord = {
  [Kind in Exclude<BundleKind, 'fact'>]: { kind: Kind; subtype?: never }
}[Exclude<BundleKind, 'fact'>]

export type NeighborRecord = NeighborRecordBase &
  ({ kind: 'fact'; subtype: FactSubtype } | NonFactNeighborRecord)

export type AuthorOutcome =
  | { kind: 'authored'; delta: Delta; authorship: CurationAuthorship }
  | {
      kind: 'fallback-required'
      reason: 'malformed' | 'no-model' | 'token-budget' | 'model-error'
    }

/** Provider-neutral author seam injected by the CLI composition root. */
export type CuratorAuthor = (
  job: CurationJobView,
  neighbors: NeighborRecord[],
) => Promise<AuthorOutcome>

/**
 * Caller-owned disposition authority. Phase 379 may extend this profile with its deterministic
 * born-active drift-supersede carve-out without changing the author or checkpoint contracts.
 */
export interface DispositionProfile {
  mode: 'drain-to-active' | 'propose-only'
}

/** Resolve the SAFE-01 authority table from the run's already-captured execution context. */
export function resolveDispositionProfile(
  executionContext: ExecutionContext,
): DispositionProfile {
  switch (executionContext) {
    case 'local-interactive':
      return { mode: 'drain-to-active' }
    case 'ci':
    case 'cloud':
    case 'local-headless':
      return { mode: 'propose-only' }
    default: {
      const exhaustive: never = executionContext
      return exhaustive
    }
  }
}

const recordIdSchema = z.string().min(1).transform(asRecordId)
const evidenceTokenSchema = z.string().min(1).transform(asEvidenceToken)

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

const artifactRefSchema: z.ZodType<ArtifactRef> = z
  .object({
    id: z.string().min(1),
    sha: z.string().regex(/^[0-9a-f]{64}$/),
    evidenceIncomplete: z.boolean().optional(),
  })
  .strict()

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

type CheckpointBundleDraft = BundleDraft & { needsEnrichment?: true }

const bundleDraftSchema: z.ZodType<CheckpointBundleDraft> = z
  .object({
    kind: bundleKindSchema,
    subtype: factSubtypeSchema.optional(),
    anchors: z.array(anchorSchema).min(1),
    scope: scopeSchema,
    summary: z.string(),
    body: z.string(),
    distilledEvidenceRef: artifactRefSchema,
    originStage: z.literal('run-curation'),
    /** Transient CUR-02 signal consumed when commit renders run-linked provenance. */
    needsEnrichment: z.literal(true).optional(),
  })
  .strict()
  .superRefine((bundle, ctx) => {
    if (bundle.kind === 'fact' && bundle.subtype === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['subtype'],
        message: 'fact bundle drafts require a fact subtype',
      })
    }
    if (bundle.kind !== 'fact' && bundle.subtype !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['subtype'],
        message: 'only fact bundle drafts may carry a fact subtype',
      })
    }
  })

const compareAndSetSchema: z.ZodType<CompareAndSet> = z
  .object({
    recordId: recordIdSchema,
    observedStatus: z.string(),
    observedOrdinal: z.number(),
  })
  .strict()

const curationAuthorshipSchema: z.ZodType<CurationAuthorship> = z
  .object({
    path: z.enum(['llm', 'llm-repaired', 'deterministic-fallback']),
    model: z
      .object({
        id: z.string().min(1),
        family: z.string().optional(),
        fingerprint: z.string().optional(),
      })
      .strict()
      .optional(),
    executionContext: z.enum(['local-interactive', 'local-headless', 'ci', 'cloud']),
  })
  .strict()

const envelopeShape = {
  origin: z.enum(['agent', 'user', 'import', 'system']),
  scope: scopeSchema,
  citedIds: z.array(recordIdSchema),
  precondition: z.array(compareAndSetSchema).optional(),
  authorship: curationAuthorshipSchema.optional(),
} as const

const deltaSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('Add'),
      ...envelopeShape,
      bundle: bundleDraftSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('Confirm'),
      ...envelopeShape,
      targetId: recordIdSchema,
      evidenceToken: evidenceTokenSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('Supersede'),
      ...envelopeShape,
      victimId: recordIdSchema,
      newBundle: bundleDraftSchema,
      evidenceToken: evidenceTokenSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('Deprecate'),
      ...envelopeShape,
      targetId: recordIdSchema,
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('MintUnknown'),
      ...envelopeShape,
      conflict: z
        .object({
          recordIds: z.array(recordIdSchema),
          kind: z.enum(['contradiction', 'drift', 'clarification']),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('Noop'),
      ...envelopeShape,
    })
    .strict(),
]) satisfies z.ZodType<Delta>

/**
 * Strict recovery boundary for the opaque queue slot. Neighbor membership and CAS freshness are
 * deliberately disposition checks, so this schema validates structure without applying them.
 */
export const authoredCheckpointSchema = z
  .object({
    schemaVersion: z.literal(AUTHORED_CHECKPOINT_SCHEMA_VERSION),
    delta: deltaSchema,
    neighborIds: z.array(recordIdSchema),
    preconditions: z.array(compareAndSetSchema),
    authorship: curationAuthorshipSchema,
  })
  .strict()

export type AuthoredCheckpoint = z.infer<typeof authoredCheckpointSchema>

/** Parse crash-recovered authored bytes before replaying the deterministic tail. */
export function parseAuthoredCheckpoint(value: unknown): AuthoredCheckpoint {
  return authoredCheckpointSchema.parse(value)
}
