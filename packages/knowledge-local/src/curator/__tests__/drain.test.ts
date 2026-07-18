import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_EMBEDDING_PROFILE,
  asRecordId,
  type CurationAuthorship,
  type Delta,
} from '@vostride/agent-qa-schema'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  makeBundleDraftFixture,
  makeDiscriminantFixture,
  makeScreenStateFixture,
  scaffoldKnowledgeRoot,
} from '../../__tests__/fixtures/bundle-fixture.js'
import {
  enqueueArtifactFreeCandidateProjection,
  type ArtifactFreeCandidateProjectionInput,
} from '../../__tests__/fixtures/curation-candidate-fixture.js'
import { makeFakeEmbedder } from '../../__tests__/fixtures/fake-embedder.js'
import { publishBundle } from '../../bundle-publish.js'
import { readIndexMaintenanceState } from '../../index-open.js'
import { projectBundleIndexRow } from '../../index-rebuild.js'
import * as knowledgeLocal from '../../index.js'
import {
  reconcileOnDrainStart,
  type ReconcileReport,
} from '../../journal/reconcile.js'
import { acquireWriterLease, releaseLease } from '../../lease/writer-lease.js'
import { buildRetrievalQuery } from '../../query-helper.js'
import { retrieve, type RetrieveResult } from '../../retrieve.js'
import {
  clearRebuildRequest,
  readRebuildRequest,
  requestRebuild,
} from '../../rebuild-marker.js'
import {
  claimNextJob,
  listQueuedCandidates,
  type ClaimedCurationJob,
} from '../../queue/curation-queue.js'
import { readJobState, writeJobState } from '../../queue/job-state.js'
import type { CuratorAuthor, NeighborRecord } from '../author-contract.js'
import type { CommitCurationOutcome } from '../commit.js'
import {
  DRAIN_BUDGET_MS,
  EMBED_CRASH_VECTORLESS_THRESHOLD,
  SEARCH_BEFORE_CREATE_MAX_QUERIES,
  drainQueue,
  type DrainOperations,
} from '../drain.js'

const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)
const EMPTY_RECONCILE: ReconcileReport = {
  intentsCleared: 0,
  intentsReplayed: 0,
  intentsDiscarded: 0,
  jobsRequeued: 0,
  orphansRemoved: 0,
  malformed: 0,
}

const NO_INDEX_MAINTENANCE = {
  indexAbsent: false,
  pendingEmbeddings: 0,
  renderingEpochStale: false,
  vectorReconciliationOutstanding: false,
} as const

describe('drainQueue one-shot serialized engine (CUR-03/CUR-04)', () => {
  let root: string
  let knowledgeRoot: string
  let auditBaseDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-curator-drain-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    auditBaseDir = join(root, '.agent-qa')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function projectionInput(
    seed: string,
    overrides: Partial<ArtifactFreeCandidateProjectionInput> = {},
  ): ArtifactFreeCandidateProjectionInput {
    return {
      sourceRunId: `run-${seed}`,
      scope: { tier: 'product', key: 'storefront' },
      buildOrdinal: 42,
      executionContext: 'local-interactive',
      secretFlagged: false,
      injectionFlagged: false,
      kind: 'fact',
      subtype: 'selector',
      anchors: [{ t: 'el', role: 'button', name: seed }],
      summarySeed: `${seed} selector`,
      bodySeed: `${seed} was resolved and verified.`,
      distilledObservations: [
        {
          schemaVersion: 1,
          step: { naturalKey: `${seed}-step`, ordinal: 0 },
          platform: 'web',
          element: { naturalKey: `button:${seed}` },
          observedAtOrdinal: 42,
        },
      ],
      evidenceToken: `evidence-${seed}`,
      attributingObservationId: `observation-${seed}`,
      emittedAt: '2026-07-15T10:00:00.000Z',
      ...overrides,
    }
  }

  function enqueue(
    seed: string,
    overrides: Partial<ArtifactFreeCandidateProjectionInput> = {},
  ): string {
    const outcome = enqueueArtifactFreeCandidateProjection({
      knowledgeRoot,
      projectionInput: projectionInput(seed, overrides),
    })
    expect(outcome.kind).toBe('enqueued')
    if (outcome.kind !== 'enqueued') throw new Error('expected enqueued projection')
    return outcome.candidateId
  }

  function addDelta(job: ClaimedCurationJob): Delta {
    return {
      kind: 'Add',
      origin: 'agent',
      scope: job.payload.scope,
      citedIds: [],
      authorship: authorship(job),
      bundle: {
        kind: job.payload.kind,
        ...(job.payload.subtype === undefined ? {} : { subtype: job.payload.subtype }),
        anchors: job.payload.anchors,
        scope: job.payload.scope,
        summary: job.payload.summarySeed,
        body: job.payload.bodySeed,
        distilledEvidenceRef: {
          id: `curation-candidate-${job.candidateId}`,
          sha: job.candidateId,
        },
        originStage: 'run-curation',
      },
    }
  }

  function authorship(job: ClaimedCurationJob): CurationAuthorship {
    return {
      path: 'llm',
      model: { id: 'curator-test' },
      executionContext: job.payload.executionContext,
    }
  }

  function completingCommit(
    order?: string[],
  ): DrainOperations['commitCurationDelta'] {
    return (_deps, job): CommitCurationOutcome => {
      order?.push(`commit:${job.candidateId}`)
      writeJobState({
        knowledgeRoot,
        candidateId: job.candidateId,
        lifecycle: 'done',
      })
      return {
        kind: 'applied',
        bundleId: asRecordId(`bundle-${job.candidateId}`),
        bundleDir: join(knowledgeRoot, 'memory', 'storefront', 'bundles', job.candidateId),
        deltaKind: 'Add',
      }
    }
  }

  function noWriterPass(): Partial<DrainOperations> {
    return {
      readRebuildRequest: () => ({ present: false }),
      readIndexMaintenanceState: () => NO_INDEX_MAINTENANCE,
    }
  }

  it('hands off to a fresh current holder without claiming or authoring', async () => {
    enqueue('held')
    const holder = acquireWriterLease(knowledgeRoot)
    if (holder.kind !== 'acquired') throw new Error('expected initial lease')
    const author = vi.fn<CuratorAuthor>()

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author,
      executionContext: 'local-interactive',
      policy,
      operations: noWriterPass(),
    })

    expect(report).toMatchObject({
      kind: 'handed-off',
      jobsProcessed: 0,
      committed: 0,
      writerPass: { kind: 'skipped', reason: 'lease-held' },
      holder: { leaseId: holder.leaseId, epoch: holder.epoch },
    })
    expect(author).not.toHaveBeenCalled()
    expect(listQueuedCandidates(knowledgeRoot)).toHaveLength(1)
    releaseLease({ knowledgeRoot, leaseId: holder.leaseId })
  })

  it('reconciles before the first claim and processes deterministic claims serially', async () => {
    const expectedIds = [enqueue('zulu'), enqueue('alpha')].sort()
    const order: string[] = []
    let activeAuthors = 0
    let maxActiveAuthors = 0
    const author = vi.fn<CuratorAuthor>(async (job) => {
      activeAuthors += 1
      maxActiveAuthors = Math.max(maxActiveAuthors, activeAuthors)
      order.push(`author:${job.candidateId}`)
      await Promise.resolve()
      activeAuthors -= 1
      const claimed = { payload: job, candidateId: job.candidateId } as ClaimedCurationJob
      const stamp = authorship(claimed)
      return { kind: 'authored', deltas: [addDelta(claimed)], authorship: stamp }
    })
    const operations: Partial<DrainOperations> = {
      ...noWriterPass(),
      reconcileOnDrainStart: (deps) => {
        order.push('reconcile')
        return reconcileOnDrainStart(deps)
      },
      claimNextJob: (options) => {
        order.push('claim')
        return claimNextJob(options)
      },
      commitCurationDelta: completingCommit(order),
      openKnowledgeReader: () => fakeReader(),
      retrieve: async () => [],
    }

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author,
      executionContext: 'local-interactive',
      policy,
      operations,
    })

    expect(report).toMatchObject({ kind: 'drained', jobsProcessed: 2, committed: 2 })
    expect(order[0]).toBe('reconcile')
    expect(order.indexOf('reconcile')).toBeLessThan(order.indexOf('claim'))
    expect(
      order.filter((entry) => entry.startsWith('author:')).map((entry) => entry.slice(7)),
    ).toEqual(expectedIds)
    expect(maxActiveAuthors).toBe(1)
  })

  it('uses the budget only as a gate before new claims', async () => {
    enqueue('first')
    enqueue('second')
    const author = vi.fn<CuratorAuthor>(async (job) => {
      const claimed = { payload: job, candidateId: job.candidateId } as ClaimedCurationJob
      return {
        kind: 'authored',
        deltas: [addDelta(claimed)],
        authorship: authorship(claimed),
      }
    })
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(DRAIN_BUDGET_MS)
    const commit = vi.fn(completingCommit())

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author,
      executionContext: 'local-interactive',
      policy,
      now,
      operations: {
        ...noWriterPass(),
        commitCurationDelta: commit,
        openKnowledgeReader: () => fakeReader(),
        retrieve: async () => [],
      },
    })

    expect(report).toMatchObject({
      kind: 'drained',
      jobsProcessed: 1,
      committed: 1,
      writerPass: { kind: 'skipped', reason: 'budget-exhausted' },
    })
    expect(author).toHaveBeenCalledTimes(1)
    expect(author.mock.calls[0]).toHaveLength(2)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(listQueuedCandidates(knowledgeRoot)).toHaveLength(1)
  })

  it('uses one reader for targeted queries and passes stable deduped aliases', async () => {
    enqueue('search', {
      distilledObservations: [
        {
          schemaVersion: 1,
          step: { naturalKey: 'checkout-step', ordinal: 0 },
          flow: { name: 'Checkout flow' },
          error: { naturalKey: 'payment declined' },
          observedAtOrdinal: 42,
        },
      ],
    })
    const reader = fakeReader()
    const open = vi.fn(() => reader)
    const build = vi.fn(buildRetrievalQuery)
    const queries: string[] = []
    const duplicate = retrievalHit('record-a', 'Existing checkout selector', 40)
    const second = retrievalHit('record-b', 'Payment decline caution', 41, 'caution')
    const retrieveSpy = vi.fn<typeof retrieve>(async (_reader, query) => {
      queries.push(query.intent)
      return queries.length === 1 ? [duplicate] : [duplicate, second]
    })
    let presented: NeighborRecord[] = []
    const author = vi.fn<CuratorAuthor>(async (job, neighbors) => {
      presented = neighbors
      const claimed = { payload: job, candidateId: job.candidateId } as ClaimedCurationJob
      return {
        kind: 'authored',
        deltas: [addDelta(claimed)],
        authorship: authorship(claimed),
      }
    })

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author,
      executionContext: 'local-interactive',
      policy,
      operations: {
        ...noWriterPass(),
        openKnowledgeReader: open,
        buildRetrievalQuery: build,
        retrieve: retrieveSpy,
        commitCurationDelta: completingCommit(),
      },
    })

    expect(report.committed).toBe(1)
    expect(retrieveSpy.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(retrieveSpy.mock.calls.length).toBeLessThanOrEqual(
      SEARCH_BEFORE_CREATE_MAX_QUERIES,
    )
    expect(build).toHaveBeenCalledTimes(retrieveSpy.mock.calls.length)
    expect(open).toHaveBeenCalledTimes(1)
    expect(reader.close).toHaveBeenCalledTimes(1)
    expect(queries).toEqual(expect.arrayContaining(['payment declined', 'Checkout flow']))
    expect(presented).toEqual([
      expect.objectContaining({
        alias: 1,
        recordId: asRecordId('record-a'),
        observedStatus: 'active',
        observedOrdinal: 40,
      }),
      expect.objectContaining({
        alias: 2,
        recordId: asRecordId('record-b'),
        observedStatus: 'active',
        observedOrdinal: 41,
      }),
    ])
  })

  it('persists the authored checkpoint before commit and never re-invokes the author', async () => {
    enqueue('recovery')
    const author = vi.fn<CuratorAuthor>(async (job) => {
      const claimed = { payload: job, candidateId: job.candidateId } as ClaimedCurationJob
      return {
        kind: 'authored',
        deltas: [addDelta(claimed)],
        authorship: authorship(claimed),
      }
    })
    const search = vi.fn<typeof retrieve>(async () => [])
    let commits = 0
    const commit: DrainOperations['commitCurationDelta'] = (_deps, job) => {
      commits += 1
      const state = readJobState(knowledgeRoot, job.candidateId)
      expect(state.kind).toBe('parsed')
      if (state.kind !== 'parsed') throw new Error('expected checkpointed state')
      expect(state.state.authored).toMatchObject({ schemaVersion: 1 })
      if (commits === 1) {
        expect(state.state.lifecycle).toBe('authored')
        throw new Error('simulated crash after checkpoint')
      }
      writeJobState({ knowledgeRoot, candidateId: job.candidateId, lifecycle: 'done' })
      return {
        kind: 'applied',
        bundleId: asRecordId('recovered-bundle'),
        bundleDir: join(knowledgeRoot, 'memory', 'storefront', 'bundles', 'recovered-bundle'),
        deltaKind: 'Add',
      }
    }
    const options = {
      knowledgeRoot,
      auditBaseDir,
      author,
      executionContext: 'local-interactive' as const,
      policy,
      operations: {
        ...noWriterPass(),
        openKnowledgeReader: () => fakeReader(),
        retrieve: search,
        commitCurationDelta: commit,
      },
    }

    const crashed = await drainQueue(options)
    expect(crashed.failures).toBe(1)
    expect(author).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledTimes(1)

    const recovered = await drainQueue(options)
    expect(recovered).toMatchObject({ jobsProcessed: 1, committed: 1, failures: 0 })
    expect(author).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledTimes(1)
    expect(commits).toBe(2)
  })

  it('finishes an in-flight job, then aborts at the next boundary and releases the lease', async () => {
    enqueue('abort-first')
    enqueue('abort-second')
    const controller = new AbortController()
    const author = vi.fn<CuratorAuthor>(async (job) => {
      controller.abort()
      const claimed = { payload: job, candidateId: job.candidateId } as ClaimedCurationJob
      return {
        kind: 'authored',
        deltas: [addDelta(claimed)],
        authorship: authorship(claimed),
      }
    })

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author,
      executionContext: 'local-interactive',
      policy,
      signal: controller.signal,
      operations: {
        ...noWriterPass(),
        openKnowledgeReader: () => fakeReader(),
        retrieve: async () => [],
        commitCurationDelta: completingCommit(),
      },
    })

    expect(report).toMatchObject({
      kind: 'aborted',
      jobsProcessed: 1,
      committed: 1,
      writerPass: { kind: 'skipped', reason: 'aborted' },
    })
    expect(author).toHaveBeenCalledTimes(1)
    expect(listQueuedCandidates(knowledgeRoot)).toHaveLength(1)
    expect(existsSync(join(knowledgeRoot, '.lease'))).toBe(false)
  })

  it('durably breaks repeated embedding crashes into a vectorless commit', async () => {
    const candidateId = enqueue('embed-crash')
    const author = vi.fn<CuratorAuthor>(async (job) => {
      const claimed = { payload: job, candidateId: job.candidateId } as ClaimedCurationJob
      return {
        kind: 'authored',
        deltas: [addDelta(claimed)],
        authorship: authorship(claimed),
      }
    })
    const embeddingCommit = vi.fn<DrainOperations['commitCurationDelta']>(() => {
      throw new Error('embedding embed-crash failed: native embedder crashed')
    })
    const vectorlessCommit = vi.fn(completingCommit())
    const options = {
      knowledgeRoot,
      auditBaseDir,
      author,
      executionContext: 'local-interactive' as const,
      policy,
      operations: {
        ...noWriterPass(),
        openKnowledgeReader: () => fakeReader(),
        retrieve: async () => [],
        commitCurationDelta: embeddingCommit,
        commitCurationDeltaVectorless: vectorlessCommit,
      },
    }

    for (let crashCount = 1; crashCount <= EMBED_CRASH_VECTORLESS_THRESHOLD; crashCount += 1) {
      const report = await drainQueue(options)
      expect(report).toMatchObject({ jobsProcessed: 1, committed: 0, requeued: 1 })
      const state = readJobState(knowledgeRoot, candidateId)
      expect(state.kind).toBe('parsed')
      if (state.kind !== 'parsed') throw new Error('expected requeued crash state')
      expect(state.state.lifecycle).toBe('queued')
      expect(state.state.embedCrashCount).toBe(crashCount)
      expect(state.state.authored).toMatchObject({ schemaVersion: 1 })
    }

    const recovered = await drainQueue(options)
    expect(recovered).toMatchObject({ jobsProcessed: 1, committed: 1, requeued: 0 })
    expect(embeddingCommit).toHaveBeenCalledTimes(EMBED_CRASH_VECTORLESS_THRESHOLD)
    expect(vectorlessCommit).toHaveBeenCalledTimes(1)
    expect(author).toHaveBeenCalledTimes(1)
    expect(readJobState(knowledgeRoot, candidateId).kind).toBe('absent')
  })

  it('delegates rebuild-marker consumption to the rebuild authority', async () => {
    requestRebuild({ knowledgeRoot, reason: 'absent', detail: 'test marker' })
    const order: string[] = []
    const read = vi.fn((root: string) => {
      order.push('read')
      return readRebuildRequest(root)
    })
    const inspect = vi.fn(() => {
      order.push('inspect')
      return {
        ...NO_INDEX_MAINTENANCE,
        indexAbsent: true,
      }
    })
    const rebuild = vi.fn<DrainOperations['rebuildIndex']>(async ({ knowledgeRoot: root }) => {
      order.push('rebuild')
      clearRebuildRequest(root)
      return {
        projected: 3,
        skippedIncomplete: 0,
        scanIssues: [],
        removed: 0,
        backfilled: 0,
        vec: 'vec0',
        pendingEmbeddings: 0,
        maintenanceRemaining: false,
      }
    })
    const acquire = vi.fn<DrainOperations['acquireEmbedder']>(async () => {
      order.push('acquire')
      return { kind: 'lexical-only' }
    })

    const operations: Partial<DrainOperations> = {
      readRebuildRequest: read,
      readIndexMaintenanceState: inspect,
      acquireEmbedder: acquire,
      rebuildIndex: rebuild,
    }

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author: vi.fn<CuratorAuthor>(),
      executionContext: 'local-interactive',
      policy,
      operations,
    })

    expect(report.writerPass).toMatchObject({
      kind: 'rebuilt',
      request: expect.objectContaining({ reason: 'absent' }),
      rebuild: { projected: 3 },
    })
    expect(order).toEqual(['read', 'inspect', 'acquire', 'rebuild'])
    expect(readRebuildRequest(knowledgeRoot)).toEqual({ present: false })
  })

  it('does not request writer work when both marker and durable debt are absent', async () => {
    const acquire = vi.fn<DrainOperations['acquireEmbedder']>()
    const rebuild = vi.fn<DrainOperations['rebuildIndex']>()
    const operations: Partial<DrainOperations> = {
      ...noWriterPass(),
      acquireEmbedder: acquire,
      rebuildIndex: rebuild,
    }

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author: vi.fn<CuratorAuthor>(),
      executionContext: 'local-interactive',
      policy,
      operations,
    })

    expect(report.writerPass).toEqual({ kind: 'not-requested' })
    expect(acquire).not.toHaveBeenCalled()
    expect(rebuild).not.toHaveBeenCalled()
  })

  it('runs the writer pass for pending debt without a rebuild marker', async () => {
    const acquire = vi.fn<DrainOperations['acquireEmbedder']>(async () => ({
      kind: 'lexical-only',
    }))
    const rebuild = vi.fn<DrainOperations['rebuildIndex']>(async () => ({
      projected: 0,
      skippedIncomplete: 0,
      scanIssues: [],
      removed: 0,
      backfilled: 0,
      vec: 'vec0',
      pendingEmbeddings: 1,
      maintenanceRemaining: true,
    }))
    const operations: Partial<DrainOperations> = {
      readRebuildRequest: () => ({ present: false }),
      readIndexMaintenanceState: () => ({
        ...NO_INDEX_MAINTENANCE,
        pendingEmbeddings: 1,
      }),
      acquireEmbedder: acquire,
      rebuildIndex: rebuild,
    }

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author: vi.fn<CuratorAuthor>(),
      executionContext: 'local-interactive',
      policy,
      operations,
    })

    expect(report.writerPass).toMatchObject({
      kind: 'rebuilt',
      rebuild: { pendingEmbeddings: 1, maintenanceRemaining: true },
    })
    expect(report.writerPass).not.toHaveProperty('request')
    expect(acquire).toHaveBeenCalledWith({ allowDownload: false })
    expect(rebuild).toHaveBeenCalledWith({ knowledgeRoot })
  })

  it('heals the same pending row across lexical-only and ready drains without a marker', async () => {
    scaffoldKnowledgeRoot(knowledgeRoot)
    const published = publishBundle(
      {
        knowledgeRoot,
        productKey: 'Writer Maintenance Product',
        auditBaseDir,
        commitArtifacts: 'none',
      },
      {
        draft: makeBundleDraftFixture({
          summary: 'Writer maintenance pending row',
          body: 'The same canonical row must survive until dense backfill is ready.',
        }),
        discriminant: makeDiscriminantFixture(),
        originClass: 'agent-verified',
        createdAtOrdinal: 42,
        screenStates: [makeScreenStateFixture()],
        initialEvents: [],
        relations: [],
        provenance: {
          mode: 'run-linked',
          runId: 'writer-maintenance-run',
          testId: 'writer-maintenance-test',
          stepIndex: 0,
        },
        artifacts: [],
      },
    )
    expect(published.kind).toBe('published')
    if (published.kind !== 'published') throw new Error(`unexpected ${published.kind}`)
    projectBundleIndexRow({ knowledgeRoot, bundleId: published.id })

    expect(readRebuildRequest(knowledgeRoot)).toEqual({ present: false })
    expect(readIndexMaintenanceState(knowledgeRoot).pendingEmbeddings).toBe(1)
    const pendingReader = knowledgeLocal.openIndexReaderConnection(knowledgeRoot)
    const pendingRow = pendingReader.db
      .prepare('SELECT record_rowid, bundle_id, embed_status FROM records WHERE bundle_id = ?')
      .get(published.id)
    pendingReader.db.close()
    expect(pendingRow).toMatchObject({
      bundle_id: published.id,
      embed_status: 'pending',
    })

    const acquire = vi.fn<DrainOperations['acquireEmbedder']>()
      .mockResolvedValueOnce({ kind: 'lexical-only' })
      .mockResolvedValueOnce({
        kind: 'ready',
        rung: 'native',
        profile: DEFAULT_EMBEDDING_PROFILE,
        embedder: makeFakeEmbedder(),
      })
    const options = {
      knowledgeRoot,
      auditBaseDir,
      author: vi.fn<CuratorAuthor>(),
      executionContext: 'local-interactive' as const,
      policy,
      operations: { acquireEmbedder: acquire },
    }

    const lexicalOnly = await drainQueue(options)
    expect(lexicalOnly.writerPass).toMatchObject({
      kind: 'rebuilt',
      rebuild: { pendingEmbeddings: 1, maintenanceRemaining: true },
    })
    expect(lexicalOnly.writerPass).not.toHaveProperty('request')
    expect(readIndexMaintenanceState(knowledgeRoot).pendingEmbeddings).toBe(1)
    expect(readRebuildRequest(knowledgeRoot)).toEqual({ present: false })
    const lexicalReader = knowledgeLocal.openIndexReaderConnection(knowledgeRoot)
    try {
      expect(
        lexicalReader.db
          .prepare('SELECT record_rowid, bundle_id, embed_status FROM records WHERE bundle_id = ?')
          .get(published.id),
      ).toEqual({
        record_rowid: pendingRow?.record_rowid,
        bundle_id: published.id,
        embed_status: 'pending',
      })
    } finally {
      lexicalReader.db.close()
    }

    const ready = await drainQueue(options)
    expect(ready.writerPass).toMatchObject({
      kind: 'rebuilt',
      rebuild: {
        projected: 0,
        backfilled: 1,
        pendingEmbeddings: 0,
        maintenanceRemaining: false,
      },
    })
    expect(ready.writerPass).not.toHaveProperty('request')
    expect(readIndexMaintenanceState(knowledgeRoot).pendingEmbeddings).toBe(0)
    expect(readRebuildRequest(knowledgeRoot)).toEqual({ present: false })

    const presentReader = knowledgeLocal.openIndexReaderConnection(knowledgeRoot)
    try {
      expect(
        presentReader.db
          .prepare('SELECT record_rowid, bundle_id, embed_status FROM records WHERE bundle_id = ?')
          .get(published.id),
      ).toEqual({
        record_rowid: pendingRow?.record_rowid,
        bundle_id: published.id,
        embed_status: 'present',
      })
    } finally {
      presentReader.db.close()
    }
    expect(acquire).toHaveBeenCalledTimes(2)
  })

  it('leaves writer work durable when jobs consume the budget', async () => {
    enqueue('budget-marker')
    requestRebuild({ knowledgeRoot, reason: 'corrupt', detail: 'retry later' })
    const author = vi.fn<CuratorAuthor>(async (job) => {
      const claimed = { payload: job, candidateId: job.candidateId } as ClaimedCurationJob
      return {
        kind: 'authored',
        deltas: [addDelta(claimed)],
        authorship: authorship(claimed),
      }
    })
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(DRAIN_BUDGET_MS)
    const rebuild = vi.fn<DrainOperations['rebuildIndex']>()

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author,
      executionContext: 'local-interactive',
      policy,
      now,
      operations: {
        openKnowledgeReader: () => fakeReader(),
        retrieve: async () => [],
        commitCurationDelta: completingCommit(),
        rebuildIndex: rebuild,
      },
    })

    expect(report.writerPass).toEqual({ kind: 'skipped', reason: 'budget-exhausted' })
    expect(rebuild).not.toHaveBeenCalled()
    expect(readRebuildRequest(knowledgeRoot).present).toBe(true)
  })

  it('reports writer-pass failure without consuming its durable marker', async () => {
    requestRebuild({ knowledgeRoot, reason: 'locked', detail: 'writer unavailable' })

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author: vi.fn<CuratorAuthor>(),
      executionContext: 'local-interactive',
      policy,
      operations: {
        acquireEmbedder: async () => ({ kind: 'lexical-only' }),
        rebuildIndex: async () => {
          throw new Error('simulated writer pass failure')
        },
      },
    })

    expect(report.writerPass).toEqual({
      kind: 'failed',
      message: 'simulated writer pass failure',
    })
    expect(report.failures).toBe(1)
    expect(readRebuildRequest(knowledgeRoot).present).toBe(true)
  })

  it('barrel-exports the daemon-stable drain seam', () => {
    expect(knowledgeLocal.drainQueue).toBe(drainQueue)
  })
})

function fakeReader() {
  return {
    source: 'scan' as const,
    vec: 'none' as const,
    getById: vi.fn(),
    searchLexical: vi.fn(() => []),
    lookupAnchor: vi.fn(() => []),
    searchDense: vi.fn(() => []),
    recheck: vi.fn((hits) => [...hits]),
    close: vi.fn(),
  }
}

function retrievalHit(
  recordId: string,
  summary: string,
  ordinal: number,
  kind: 'fact' | 'caution' = 'fact',
) {
  return {
    id: asRecordId(recordId),
    kind,
    ...(kind === 'fact' ? { subtype: 'selector' as const } : {}),
    title: summary,
    summary,
    trust: 0.8,
    anchors: [{ t: 'el' as const, role: 'button', name: 'Checkout' }],
    status: 'active' as const,
    servedAsCanary: false,
    audit: {
      status: 'active',
      openedAtOrdinal: ordinal,
      closedAtOrdinal: null,
    },
    scope: { tier: 'product' as const, key: 'storefront' },
    validity: 'audit' as const,
  } as RetrieveResult[number]
}
