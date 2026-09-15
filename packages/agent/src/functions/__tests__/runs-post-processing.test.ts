import { createMaskingContext, setActiveMaskingContextResolver } from '@vostride/agent-qa-safety'
import {
  asJobId,
  asRunId,
  maskedMarker,
  POST_PROCESSING_CHIP_STATUSES,
  PostProcessingStatusSchema,
  CurationSnapshotSchema,
  CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION,
} from '@vostride/agent-qa-schema'
import type { CurationSnapshot, PostProcessingStageDetail, RunNotification } from '@vostride/agent-qa-schema'
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

function snapshot(): CurationSnapshot {
  return CurationSnapshotSchema.parse({
    schemaVersion: 1,
    rows: [{ recordId: 'record-synthetic-snapshot-secret', bucket: 'superseded',
      byRecordId: 'replacement-synthetic-snapshot-secret',
      changes: [{ bucket: 'superseded', change: {
        schemaVersion: 1, recordId: 'record-synthetic-snapshot-secret',
        change: 'superseded', byRecordId: 'replacement-synthetic-snapshot-secret',
        atOrdinal: 12, evidenceToken: 'token-synthetic-snapshot-secret',
        sourceRunId: 'run-synthetic-snapshot-secret', observationId: 'observation-synthetic-snapshot-secret',
      } }],
    }],
    breakdown: { added: 0, confirmed: 0, superseded: 1, deprecated: 0, proposed: 0 },
  })
}

describe('423 checkpoint-backed snapshot projection', () => {
  it('NOTIFICATION-MASK: terminal-only snapshot crosses the same strict live mask without mutation', async () => {
    const masking = createMaskingContext()
    masking.register('synthetic-snapshot-secret')
    setActiveMaskingContextResolver(() => masking)
    const recorded = snapshot()
    const notification = {
      schemaVersion: CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION, runId: RUN_ID, outcome: 'done' as const,
      verdictSummary: { total: 0, byClass: {} },
      stages: { analysis: { status: 'done' as const }, curation: { status: 'done' as const,
        curationSnapshot: recorded } },
    } satisfies RunNotification
    const before = JSON.stringify(notification)
    const result = await read({ notification })
    expect(JSON.stringify(result)).not.toContain('synthetic-snapshot-secret')
    expect(result.notification).toEqual(JSON.parse(before.replaceAll('synthetic-snapshot-secret',
      masking.mask('synthetic-snapshot-secret'))))
    expect(PostProcessingStatusSchema.parse(result)).toEqual(result)
    expect(JSON.stringify(notification)).toBe(before)
    expect(result).not.toHaveProperty('curationSnapshot')
  })

  it('NOTIFICATION-MASK-COLLISION: nested identity collisions withhold generically without deleting history', async () => {
    const recorded: CurationSnapshot = { schemaVersion: 1,
      rows: [{ recordId: 'synthetic-record', bucket: 'confirmed', changes: [
        { bucket: 'confirmed', change: { schemaVersion: 1, recordId: 'synthetic-record',
          change: 'confirmed', atOrdinal: 1, evidenceToken: 'synthetic-secret-one' } },
        { bucket: 'confirmed', change: { schemaVersion: 1, recordId: 'synthetic-record',
          change: 'confirmed', atOrdinal: 1, evidenceToken: 'synthetic-secret-two' } },
      ] }], breakdown: { added: 0, confirmed: 1, superseded: 0, deprecated: 0, proposed: 0 } }
    const notification = { schemaVersion: CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION,
      runId: RUN_ID, outcome: 'done' as const, verdictSummary: { total: 0, byClass: {} },
      stages: { analysis: { status: 'done' as const },
        curation: { status: 'done' as const, curationSnapshot: recorded } } } satisfies RunNotification
    const before = JSON.stringify(notification)
    setActiveMaskingContextResolver(() => ({ mask: () => maskedMarker('secret'), unmask: text => text }))
    await expect(read({ notification })).resolves.toHaveProperty('curationSnapshotWithheld', { reason: 'projection-refused' })
    const result = await read({ notification })
    expect(result.notification?.stages.curation).toEqual({ status: 'done' })
    expect(JSON.stringify(notification)).toBe(before)
    expect(JSON.stringify(result)).not.toContain('synthetic-secret')
    expect(PostProcessingStatusSchema.parse(result)).toEqual(result)
  })

  it('POSTPROCESSING-SNAPSHOT-EARLY copies exact masked facts beside three details and two chips', async () => {
    const masking = createMaskingContext()
    masking.register('synthetic-snapshot-secret')
    setActiveMaskingContextResolver(() => masking)
    const recorded = snapshot()
    const before = structuredClone(recorded)
    const result = await read({
      analyzeRun: { status: 'done', claimed: false, attempts: 1 },
      curateMemory: { status: 'done', claimed: false, attempts: 2 },
      proposeImprovements: { status: 'queued', claimed: true, attempts: 1 },
      curationSnapshot: recorded,
    })
    const expected = JSON.parse(JSON.stringify(before).replaceAll('synthetic-snapshot-secret',
      masking.mask('synthetic-snapshot-secret')))
    expect(result).toHaveProperty('curationSnapshot', expected)
    expect(result.chips).toEqual({ analysis: 'done', curation: 'done' })
    expect(result.stageDetails).toEqual({ analysis: { attempts: 1 }, curation: { attempts: 2 }, proposals: { attempts: 1 } })
    expect(result).not.toHaveProperty('notification')
    expect(JSON.stringify(result)).not.toContain('synthetic-snapshot-secret')
    expect(PostProcessingStatusSchema.parse(result)).toEqual(result)
    expect(recorded).toEqual(before)
    expect(runsPostProcessingSpec.classify!(result).status).toBe('executed')
  })

  it.each(['done', 'failed'] as const)('POSTPROCESSING-HISTORICAL-COUNTS %s preserves legacy counts without a snapshot', async outcome => {
    const notification: RunNotification = {
      schemaVersion: CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION, runId: RUN_ID, outcome,
      verdictSummary: { total: 1, byClass: { timeout: 1 } },
      stages: { analysis: { status: 'done' }, curation: { status: outcome, curated: 7, deprecated: 3 } },
    }
    const result = await read({
      analyzeRun: { status: 'done', claimed: false },
      curateMemory: { status: outcome, claimed: false },
      notification,
    })
    expect(result.notification).toEqual(notification)
    expect(result).not.toHaveProperty('curationSnapshot')
    expect(result.chips).toEqual({ analysis: 'done', curation: outcome })
    expect(runsPostProcessingSpec.classify!(result).status).toBe('executed')
    expect(PostProcessingStatusSchema.parse(result)).toEqual(result)
  })

  it('POSTPROCESSING-FAILED-PROPOSALS retains a completed snapshot after later chain failure', async () => {
    setActiveMaskingContextResolver(() => createMaskingContext())
    const recorded = snapshot()
    const result = await read({
      analyzeRun: { status: 'done', claimed: false },
      curateMemory: { status: 'done', claimed: false },
      proposeImprovements: { status: 'failed', claimed: false, lastFailureKind: 'permanent' },
      curationSnapshot: recorded,
    })
    expect(result).toHaveProperty('curationSnapshot', recorded)
    expect(result.chips).toEqual({ analysis: 'done', curation: 'done' })
    expect(runsPostProcessingSpec.classify!(result).status).toBe('executed')
  })

  it('POSTPROCESSING-SNAPSHOT-STRICT rejects malformed optional snapshots and extra fields', () => {
    const base = { runId: RUN_ID, chips: { analysis: 'done', curation: 'done' }, curationSnapshot: snapshot() }
    expect(PostProcessingStatusSchema.safeParse(base).success).toBe(true)
    for (const invalid of [null, { ...snapshot(), schemaVersion: 2 }, { ...snapshot(), extra: true },
      { ...snapshot(), breakdown: { ...snapshot().breakdown, superseded: 0 } }]) {
      expect(PostProcessingStatusSchema.safeParse({ ...base, curationSnapshot: invalid }).success).toBe(false)
    }
  })

  it('POSTPROCESSING-SNAPSHOT-WITHHELD degrades the snapshot, never the read', async () => {
    const recorded = CurationSnapshotSchema.parse({ schemaVersion: 1,
      rows: ['first-record', 'second-record'].map(recordId => ({ recordId, bucket: 'added',
        changes: [{ bucket: 'added', change: { schemaVersion: 1, recordId, change: 'added', atOrdinal: 1 } }],
      })),
      breakdown: { added: 2, confirmed: 0, superseded: 0, deprecated: 0, proposed: 0 },
    })
    const pending = { analysis: 'pending', curation: 'pending' }

    setActiveMaskingContextResolver(() => undefined)
    await expect(read({ curationSnapshot: recorded })).resolves.toEqual({ runId: RUN_ID, chips: pending,
      curationSnapshotWithheld: { reason: 'masking-unavailable' } })
    const unavailable = await read({ curationSnapshot: recorded })
    expect(PostProcessingStatusSchema.safeParse(unavailable).success).toBe(true)
    expect(JSON.stringify(await read({ curationSnapshot: snapshot() }))).not.toContain('synthetic-snapshot-secret')

    const notification = { schemaVersion: CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION, runId: RUN_ID,
      outcome: 'done' as const, verdictSummary: { total: 0, byClass: {} },
      stages: { analysis: { status: 'done' as const },
        curation: { status: 'done' as const, curated: 2, deprecated: 0, curationSnapshot: recorded } },
    } satisfies RunNotification
    const nested = await read({ notification })
    expect(nested).toHaveProperty('curationSnapshotWithheld', { reason: 'masking-unavailable' })
    expect(nested).not.toHaveProperty('curationSnapshot')
    expect(nested.notification?.stages.curation).toEqual({ status: 'done', curated: 2, deprecated: 0 })
    expect(notification.stages.curation.curationSnapshot).toBe(recorded)
    expect(PostProcessingStatusSchema.safeParse(nested).success).toBe(true)

    setActiveMaskingContextResolver(() => ({ mask: () => 'collided-identity', unmask: text => text }))
    const collided = await read({
      analyzeRun: { status: 'done', claimed: false, attempts: 1 },
      curateMemory: { status: 'done', claimed: false, attempts: 2 },
      curationSnapshot: recorded,
    })
    expect(collided).toEqual({ runId: RUN_ID, chips: { analysis: 'done', curation: 'done' },
      stageDetails: { analysis: { attempts: 1 }, curation: { attempts: 2 } },
      curationSnapshotWithheld: { reason: 'projection-refused' } })
    expect(PostProcessingStatusSchema.safeParse(collided).success).toBe(true)

    setActiveMaskingContextResolver(() => createMaskingContext())
    const invalid = { ...recorded, 'synthetic-raw-secret-key': 'synthetic-raw-secret-value' }
    const refused = await read({ curationSnapshot: invalid })
    expect(refused).toEqual({ runId: RUN_ID, chips: pending,
      curationSnapshotWithheld: { reason: 'projection-refused' } })
    expect(JSON.stringify(refused)).not.toContain('synthetic-raw-secret-key')
    expect(JSON.stringify(refused)).not.toContain('synthetic-raw-secret-value')
    for (const identity of ['first-record', 'second-record']) {
      expect(JSON.stringify(collided)).not.toContain(identity)
      expect(JSON.stringify(refused)).not.toContain(identity)
    }

    const empty = CurationSnapshotSchema.parse({ schemaVersion: 1, rows: [],
      breakdown: { added: 0, confirmed: 0, superseded: 0, deprecated: 0, proposed: 0 } })
    const served = await read({ curationSnapshot: empty })
    expect(served).toEqual({ runId: RUN_ID, chips: pending, curationSnapshot: empty })
    expect(served).not.toHaveProperty('curationSnapshotWithheld')
    setActiveMaskingContextResolver(() => undefined)
    expect(await read({ curationSnapshot: empty })).toEqual({ runId: RUN_ID, chips: pending,
      curationSnapshotWithheld: { reason: 'masking-unavailable' } })
  })
})

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
