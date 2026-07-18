import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { canonicalJson, type CanaryOutcome } from '@vostride/agent-qa-schema'

import {
  CANARY_QUEUE_SCHEMA_VERSION,
  canaryOutcomeContentAddress,
  canaryOutcomePayloadSchema,
} from './canary-payload.js'
import {
  bestEffortFsyncDirectory,
  durableWrite,
  publishStagedQueueEntry,
  removeEmptyDir,
} from './curation-queue.js'
import {
  queueStagingRoot,
  queuedCandidateDir,
  queuedRoot,
} from './queue-layout.js'

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
