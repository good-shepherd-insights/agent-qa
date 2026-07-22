import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import {
  canonicalJson,
  sha256hex,
  type CanaryOutcome,
} from '@vostride/agent-qa-schema'

import { anchorSchema } from './anchor-schema.js'
import {
  bestEffortFsyncDirectory,
  durableWrite,
  publishStagedQueueEntry,
  queueStagingRoot,
  queuedCandidateDir,
  queuedRoot,
  removeEmptyDir,
} from './queue-transport.js'

export const CANARY_QUEUE_SCHEMA_VERSION = 2

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

export type EnqueueCanaryOutcome =
  | { kind: 'enqueued'; entryId: string }
  | { kind: 'coalesced'; entryId: string }

/**
 * D-20's one emit pattern: synchronously publish with the same durable staging and rename
 * semantics as a curation drop, so crashes and retries cannot multiply one attributed outcome.
 */
export function enqueueCanaryOutcome(
  knowledgeRoot: string,
  outcome: CanaryOutcome,
): EnqueueCanaryOutcome {
  const payload = canaryOutcomePayloadSchema.parse({
    schemaVersion: CANARY_QUEUE_SCHEMA_VERSION,
    jobKind: 'canary-outcome',
    candidateId: outcome.candidateId,
    runId: outcome.runId,
    testId: outcome.testId,
    testIndex: outcome.testIndex,
    buildOrdinal: outcome.buildOrdinal,
    stepIndex: outcome.stepIndex,
    outcome: outcome.runOutcome,
    exercisedAnchor: outcome.exercisedAnchor,
    attribution: outcome.attribution,
    briefDigest: outcome.briefDigest,
  })
  const entryId = canaryOutcomeContentAddress(payload)
  const stagingRoot = queueStagingRoot(knowledgeRoot)
  const stagingDir = join(stagingRoot, randomUUID())
  mkdirSync(stagingDir, { recursive: true })
  try {
    durableWrite(join(stagingDir, 'payload.json'), `${canonicalJson(payload)}\n`)
    bestEffortFsyncDirectory(stagingDir)
    const published = publishStagedQueueEntry(
      stagingDir,
      queuedCandidateDir(knowledgeRoot, entryId),
      queuedRoot(knowledgeRoot),
    )
    return {
      kind: published === 'published' ? 'enqueued' : 'coalesced',
      entryId,
    }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
    removeEmptyDir(stagingRoot)
  }
}
