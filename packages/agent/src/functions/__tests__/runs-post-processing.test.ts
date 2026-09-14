import { createMaskingContext, setActiveMaskingContextResolver } from '@vostride/agent-qa-safety'
import {
  asJobId,
  asRunId,
  maskedMarker,
  POST_PROCESSING_CHIP_STATUSES,
  PostProcessingStatusSchema,
} from '@vostride/agent-qa-schema'
import type { PostProcessingStageDetail } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import { runsPostProcessingSpec } from '../ops/runs-post-processing.js'
import type { FunctionDeps, PostProcessingChainState } from '../spec.js'

const RUN_ID = asRunId('run-423-stage-details')

function read(state: PostProcessingChainState | undefined) {
  const deps: FunctionDeps = {
    runs: {
      list: async () => [],
      get: async () => undefined,
      readEvents: async () => [],
      readStepEvidence: async () => ({ kind: 'run-not-recorded' }),
    },
    knowledge: {
      listBundles: async () => [],
      inspectRecords: async () => [],
      diffSince: async () => [],
      showRecord: async ({ recordId }) => ({ kind: 'not-found', schemaVersion: 1, recordId }),
    },
    entities: {
      resolve: async () => ({ kind: 'none', reason: 'no-match' }),
      get: async () => undefined,
    },
    config: {
      getMasked: async () => ({ schemaVersion: 1, configPath: 'agent-qa.config.yaml', entries: [] }),
    },
    postProcessing: {
      idSource: { jobIdFor: (kind, key) => asJobId(`${kind}:${key}`) },
      readChain: async () => state,
    },
  }
  return runsPostProcessingSpec.invoke({ runId: RUN_ID }, deps)
}

afterEach(() => setActiveMaskingContextResolver(() => undefined))

describe('423 durable stage projection', () => {
  it('THREE-STAGE-ROWS projects exact recorded facts and masks failure text', async () => {
    const masking = createMaskingContext()
    masking.register('synthetic-stage-secret')
    setActiveMaskingContextResolver(() => masking)
    const analysis: PostProcessingStageDetail = {
      attempts: 2,
      createdAt: '2026-09-14T00:00:01.000Z',
      updatedAt: '2026-09-14T00:00:04.000Z',
      lastFailureKind: 'retry',
      lastFailureReason: 'retry synthetic-stage-secret for operator@example.test',
    }
    const curation: PostProcessingStageDetail = {
      attempts: 0,
      createdAt: '2026-09-14T00:00:05.000Z',
      updatedAt: '2026-09-14T00:00:05.000Z',
    }
    const proposals: PostProcessingStageDetail = {
      attempts: 1,
      claimedAt: '2026-09-14T00:00:07.000Z',
      conclusionKind: 'unreadable_kind',
    }
    const state = {
      analyzeRun: { status: 'done' as const, claimed: false, ...analysis },
      curateMemory: { status: 'queued' as const, claimed: false, ...curation },
      proposeImprovements: { status: 'failed' as const, claimed: false, ...proposals },
    }
    const before = structuredClone(state)
    const result = await read(state)
    expect(result.stageDetails).toEqual({
      analysis: { ...analysis, lastFailureReason: masking.mask(analysis.lastFailureReason!) },
      curation,
      proposals,
    })
    expect(JSON.stringify(result)).not.toContain('synthetic-stage-secret')
    expect(JSON.stringify(result)).not.toContain('operator@example.test')
    expect(state).toEqual(before)
    expect(PostProcessingStatusSchema.parse(result)).toEqual(result)
  })

  it('TWO-CHIPS keeps exactly two chips and four statuses with three detail stages', async () => {
    const result = await read({
      analyzeRun: { status: 'queued', claimed: true },
      curateMemory: { status: 'cancelled', claimed: false },
      proposeImprovements: { status: 'done', claimed: false },
    })
    expect(result.chips).toEqual({ analysis: 'running', curation: 'failed' })
    expect(POST_PROCESSING_CHIP_STATUSES).toEqual(['pending', 'running', 'done', 'failed'])
    expect(result.stageDetails).toEqual({ analysis: {}, curation: {}, proposals: {} })
    expect(runsPostProcessingSpec.classify!(result).status).toBe('executed')
  })

  it('ROW-ABSENT omits missing stage keys and the whole absent map', async () => {
    expect(await read(undefined)).toEqual({
      runId: RUN_ID,
      chips: { analysis: 'pending', curation: 'pending' },
    })
    expect(await read({})).not.toHaveProperty('stageDetails')
    const result = await read({ analyzeRun: { status: 'queued', claimed: false } })
    expect(result.stageDetails).toEqual({ analysis: {} })
  })

  it('MASK-NO-CONTEXT fails closed for recorded failure prose', async () => {
    const state = {
      analyzeRun: {
        status: 'failed' as const,
        claimed: false,
        lastFailureKind: 'permanent',
        lastFailureReason: 'synthetic-unregistered-secret',
      },
    }
    const result = await read(state)
    expect(result.stageDetails?.analysis?.lastFailureReason).toBe(maskedMarker('secret'))
    expect(JSON.stringify(result)).not.toContain('synthetic-unregistered-secret')
  })

  it('CHIP-CONTROL terminal status wins over a stale claim', async () => {
    const result = await read({ analyzeRun: { status: 'done', claimed: true } })
    expect(result.chips).toEqual({ analysis: 'done', curation: 'pending' })
  })
})
