import { canonicalJson, guardCompletedRunHandoff, sha256hex } from '@vostride/agent-qa-schema'
import type { CompletedRunHandoff, Job, JobHandlerOutcome } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { createRealJobKindRegistry } from '../kinds.js'
import type { PostRunJobCapabilities } from '../kinds.js'
import type { JobHandlerContext } from '../kind-registry.js'
import { buildSyntheticHandoff } from './fixtures/synthetic-handoff.js'

const RUN_ID = 'run-handoff-stamps'

function storedBytes(stamp: number): string {
  const handoff = buildSyntheticHandoff({ runId: RUN_ID, failureCount: 0, passedCount: 1 })
  return canonicalJson({ ...handoff, schemaVersion: stamp })
}

function contextFor(payload: unknown): JobHandlerContext {
  const recorded = new Map<string, unknown>()
  return {
    job: {
      id: 'job_analyze_handoff_stamps',
      kind: 'analyze-run',
      status: 'queued',
      summary: 'fixture',
      attempts: 1,
      createdAt: '2026-10-22T00:00:00.000Z',
      updatedAt: '2026-10-22T00:00:00.000Z',
    } as unknown as Job,
    payload,
    publishCheckpoint: async (checkpointId: string, value: unknown) => {
      recorded.set(checkpointId, value)
    },
    recordLlmAuthorship: (async (
      checkpointId: string,
      author: (model: unknown) => Promise<unknown>,
    ) => {
      if (recorded.has(checkpointId)) return recorded.get(checkpointId)
      const value = await author({
        modelId: 'stub-handoff-stamps',
        generate: async () => ({ text: '' }),
      })
      recorded.set(checkpointId, value)
      return value
    }) as unknown as JobHandlerContext['recordLlmAuthorship'],
  }
}

async function analyze(bytes: string, stamp: number, digest: string): Promise<JobHandlerOutcome> {
  const capabilities: PostRunJobCapabilities = {
    loadCompletedRunHandoff: () => guardCompletedRunHandoff(JSON.parse(bytes)),
    curateRun: async () => ({ curated: 0, deprecated: 0, complete: true }),
    persistAnalysis: () => {},
  }
  return createRealJobKindRegistry(capabilities)
    .require('analyze-run')
    .handler(
      contextFor({
        runId: RUN_ID,
        handoffDigest: digest,
        handoffSchemaVersion: stamp,
        executionContext: 'local-headless',
      }),
    )
}

describe('a stored handoff keeps its stamp and its digest through analyze-run', () => {
  it.each([2, 3, 4, 5, 6, 7])(
    'a handoff stamped %i passes the version and digest checks',
    async (stamp) => {
      const bytes = storedBytes(stamp)
      const doc = JSON.parse(bytes) as CompletedRunHandoff
      const outcome = await analyze(bytes, stamp, sha256hex(canonicalJson(doc)))

      const reason = outcome.status === 'permanent' ? outcome.reason : ''
      expect(reason).not.toContain('declares schema version')
      expect(reason).not.toContain('no longer digests')
      expect(reason).not.toContain('could not be read')
      expect(outcome.status).toBe('complete')
    },
  )

  it.each([1, 8])('a handoff stamped %i is refused at the load', async (stamp) => {
    const bytes = storedBytes(stamp)
    const outcome = await analyze(bytes, stamp, sha256hex(bytes))

    expect(outcome.status).toBe('permanent')
    expect(outcome.status === 'permanent' ? outcome.reason : '').toContain('could not be read')
  })
})
