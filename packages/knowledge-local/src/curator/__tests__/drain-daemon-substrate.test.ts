import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CurationAuthorship, Delta, ExecutionContext } from '@vostride/agent-qa-schema'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { scaffoldKnowledgeRoot } from '../../__tests__/fixtures/bundle-fixture.js'
import {
  enqueueArtifactFreeCandidateProjection,
  type ArtifactFreeCandidateProjectionInput,
} from '../../__tests__/fixtures/curation-candidate-fixture.js'
import { deriveBundleTrust, loadBundle } from '../../bundle-read.js'
import { enumerateBundleDirs } from '../../bundle-scan.js'
import * as knowledgeLocal from '../../index.js'
import {
  acquireWriterLease,
  LEASE_FILE,
  releaseLease,
  WriterAuthorityLostError,
} from '../../lease/writer-lease.js'
import * as curationQueue from '../../queue/curation-queue.js'
import {
  claimNextJob,
  listQueuedCandidates,
  type ClaimedCurationJob,
} from '../../queue/curation-queue.js'
import { readJobState } from '../../queue/job-state.js'
import { requestRebuild } from '../../rebuild-marker.js'
import type { CuratorAuthor } from '../author-contract.js'
import {
  drainQueue,
  type CurationDrainLifecycleEvent,
  type DrainOperations,
} from '../drain.js'

const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)
const NO_INDEX_MAINTENANCE = {
  indexAbsent: false,
  pendingEmbeddings: 0,
  renderingEpochStale: false,
  vectorReconciliationOutstanding: false,
} as const

describe('drainQueue daemon substrate', () => {
  let root: string
  let knowledgeRoot: string
  let auditBaseDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-drain-daemon-substrate-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    auditBaseDir = join(root, '.agent-qa')
    scaffoldKnowledgeRoot(knowledgeRoot)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function projectionInput(
    seed: string,
    executionContext: ExecutionContext,
  ): ArtifactFreeCandidateProjectionInput {
    return {
      sourceRunId: 'run-mixed-context',
      scope: { tier: 'product', key: 'storefront' },
      buildOrdinal: 42,
      executionContext,
      secretFlagged: false,
      injectionFlagged: false,
      kind: 'fact',
      subtype: 'selector',
      anchors: [
        { t: 'el', role: 'button', name: seed, ordinal: 0 },
        { t: 'page', route: `/${seed}` },
        { t: 'selector', literal: `[data-testid="${seed}"]` },
      ],
      summarySeed: `${seed} selector`,
      bodySeed: `${seed} was resolved and verified.`,
      distilledObservations: [
        {
          schemaVersion: 1,
          step: { naturalKey: `${seed}-click`, ordinal: 0 },
          platform: 'web',
          element: { naturalKey: `button:${seed}:0` },
          locator: { selector: `[data-testid="${seed}"]` },
          observedAtOrdinal: 42,
        },
      ],
      evidenceToken: `evidence-${seed}`,
      attributingObservationId: `observation-${seed}`,
      emittedAt: '2026-07-30T00:00:00.000Z',
    }
  }

  function enqueue(seed: string, executionContext: ExecutionContext): string {
    const outcome = enqueueArtifactFreeCandidateProjection({
      knowledgeRoot,
      projectionInput: projectionInput(seed, executionContext),
    })
    expect(outcome.kind).toBe('enqueued')
    if (outcome.kind !== 'enqueued') throw new Error('expected enqueued projection')
    return outcome.candidateId
  }

  function scriptedAuthor(): CuratorAuthor {
    return async (job) => {
      const authorship: CurationAuthorship = {
        path: 'llm',
        model: { id: 'daemon-substrate-fixture' },
        executionContext: job.executionContext,
      }
      const delta: Delta = {
        kind: 'Add',
        origin: 'agent',
        scope: job.scope,
        citedIds: [],
        authorship,
        bundle: {
          kind: job.kind,
          ...(job.subtype === undefined ? {} : { subtype: job.subtype }),
          anchors: job.anchors,
          scope: job.scope,
          summary: job.summarySeed,
          body: job.bodySeed,
          distilledEvidenceRef: {
            id: `curation-candidate-${job.candidateId}`,
            sha: job.candidateId,
          },
          originStage: 'run-curation',
        },
      }
      return { kind: 'authored', deltas: [delta], authorship }
    }
  }

  function maintenanceFreeOperations(): Partial<DrainOperations> {
    return {
      readRebuildRequest: () => ({ present: false }),
      readIndexMaintenanceState: () => NO_INDEX_MAINTENANCE,
    }
  }

  function statusesBySummary(): Record<string, string> {
    return Object.fromEntries(
      enumerateBundleDirs(knowledgeRoot).map(({ dir }) => {
        const loaded = loadBundle(dir)
        if (loaded.kind !== 'loaded') throw new Error(`expected loaded bundle at ${dir}`)
        return [loaded.bundle.summary, deriveBundleTrust(loaded.bundle).status]
      }),
    )
  }

  function reportRemaining(report: unknown): unknown {
    return (report as { remaining?: unknown }).remaining
  }

  function maintenanceTail() {
    const runMaintenanceTail = (
      knowledgeLocal as unknown as {
        runMaintenanceTail?: (options: {
          knowledgeRoot: string
          lease: { leaseId: string; epoch: number }
          operations?: Partial<DrainOperations>
        }) => Promise<{
          writerPass: unknown
          gc: unknown
          failures: readonly unknown[]
        }>
      }
    ).runMaintenanceTail
    expect(runMaintenanceTail).toBeTypeOf('function')
    if (runMaintenanceTail === undefined) throw new Error('runMaintenanceTail is not exported')
    return runMaintenanceTail
  }

  it('uses each claimed payload context inside one mixed-context drain', async () => {
    enqueue('ci-checkout', 'ci')
    enqueue('interactive-checkout', 'local-interactive')

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author: scriptedAuthor(),
      executionContext: 'local-headless',
      policy,
      operations: maintenanceFreeOperations(),
    })

    expect(report).toMatchObject({
      kind: 'drained',
      jobsProcessed: 2,
      committed: 2,
      failures: 0,
    })
    expect(reportRemaining(report)).toBe(0)
    expect(statusesBySummary()).toEqual({
      'ci-checkout selector': 'candidate',
      'interactive-checkout selector': 'active',
    })
    expect(listQueuedCandidates(knowledgeRoot)).toEqual([])

    const beforeSecondDrain = statusesBySummary()
    const second = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author: scriptedAuthor(),
      executionContext: 'ci',
      policy,
      operations: maintenanceFreeOperations(),
    })

    expect(second).toMatchObject({ kind: 'drained', jobsProcessed: 0, committed: 0 })
    expect(reportRemaining(second)).toBe(0)
    expect(statusesBySummary()).toEqual(beforeSecondDrain)
  })

  it('uses the drain-scoped fallback for a claimed legacy payload without context', async () => {
    const candidateId = enqueue('legacy-checkout', 'local-interactive')
    const author = vi.fn(scriptedAuthor())
    const claimWithoutContext: DrainOperations['claimNextJob'] = (options) => {
      const claimed = claimNextJob(options)
      if (claimed?.kind !== 'claimed') return claimed
      return {
        ...claimed,
        payload: {
          ...claimed.payload,
          executionContext: undefined,
        } as unknown as ClaimedCurationJob['payload'],
      }
    }

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author,
      executionContext: 'local-headless',
      policy,
      operations: {
        ...maintenanceFreeOperations(),
        claimNextJob: claimWithoutContext,
      },
    })

    expect(report).toMatchObject({
      kind: 'drained',
      jobsProcessed: 1,
      committed: 1,
      failures: 0,
    })
    expect(author).toHaveBeenCalledOnce()
    expect(author.mock.calls[0]?.[0].executionContext).toBe('local-headless')
    expect(statusesBySummary()).toEqual({ 'legacy-checkout selector': 'candidate' })
    expect(listQueuedCandidates(knowledgeRoot)).toEqual([])
    expect(readJobState(knowledgeRoot, candidateId).kind).toBe('absent')
  })

  it('drains under a caller-owned lease without touching its lease bytes', async () => {
    enqueue('caller-owned-lease', 'local-interactive')
    const acquired = acquireWriterLease(knowledgeRoot)
    if (acquired.kind !== 'acquired') throw new Error('expected caller lease')
    const leasePath = join(knowledgeRoot, LEASE_FILE)
    const before = readFileSync(leasePath)

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author: scriptedAuthor(),
      executionContext: 'ci',
      policy,
      lease: { leaseId: acquired.leaseId, epoch: acquired.epoch },
      operations: maintenanceFreeOperations(),
    } as Parameters<typeof drainQueue>[0] & {
      lease: { leaseId: string; epoch: number }
    })

    expect(report).toMatchObject({
      kind: 'drained',
      jobsProcessed: 1,
      committed: 1,
      failures: 0,
    })
    expect(reportRemaining(report)).toBe(0)
    expect(readFileSync(leasePath)).toEqual(before)
    expect(statusesBySummary()).toEqual({ 'caller-owned-lease selector': 'active' })
    expect(releaseLease({ knowledgeRoot, leaseId: acquired.leaseId })).toEqual({
      kind: 'released',
    })
  })

  it('reports one lifecycle completion after a real multi-delta terminal transition', async () => {
    const candidateId = enqueue('multi-delta-lifecycle', 'local-interactive')
    const singleDeltaAuthor = scriptedAuthor()
    const author: CuratorAuthor = async (job, neighbors) => {
      const authored = await singleDeltaAuthor(job, neighbors)
      if (authored.kind !== 'authored') throw new Error('expected authored fixture')
      const delta = authored.deltas[0]
      if (delta === undefined) throw new Error('expected fixture delta')
      return {
        ...authored,
        deltas: [delta, delta],
      }
    }
    const observed: Array<CurationDrainLifecycleEvent & { durableState: string }> = []

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author,
      executionContext: 'local-interactive',
      policy,
      maintenance: 'skip',
      onJobLifecycle: (event) => {
        const state = readJobState(knowledgeRoot, event.candidateId)
        observed.push({
          ...event,
          durableState: state.kind === 'parsed' ? state.state.lifecycle : state.kind,
        })
      },
      operations: maintenanceFreeOperations(),
    })

    expect(report).toMatchObject({
      kind: 'drained',
      jobsProcessed: 1,
      failures: 0,
    })
    expect(observed).toEqual([
      { kind: 'job-claimed', candidateId, durableState: 'queued' },
      { kind: 'job-completed', candidateId, durableState: 'absent' },
    ])
    expect(readJobState(knowledgeRoot, candidateId).kind).toBe('absent')
  })

  it('reports a real claim but no completion when a caller lease epoch is stale', async () => {
    const candidateId = enqueue('stale-epoch-lifecycle', 'local-interactive')
    const stale = acquireWriterLease(knowledgeRoot)
    if (stale.kind !== 'acquired') throw new Error('expected stale lease seed')
    expect(releaseLease({ knowledgeRoot, leaseId: stale.leaseId })).toEqual({
      kind: 'released',
    })
    const current = acquireWriterLease(knowledgeRoot)
    if (current.kind !== 'acquired') throw new Error('expected current lease')
    const leasePath = join(knowledgeRoot, LEASE_FILE)
    const currentLeaseBytes = readFileSync(leasePath)
    const observed: CurationDrainLifecycleEvent[] = []

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author: scriptedAuthor(),
      executionContext: 'local-interactive',
      policy,
      maintenance: 'skip',
      lease: { leaseId: stale.leaseId, epoch: stale.epoch },
      onJobLifecycle: (event) => observed.push(event),
      operations: maintenanceFreeOperations(),
    })

    expect(report).toMatchObject({
      kind: 'drained',
      jobsProcessed: 1,
      committed: 0,
      failures: 1,
      failureDetails: [
        expect.objectContaining({
          stage: 'commit',
          candidateId,
          message: expect.stringContaining('writer epoch became stale'),
        }),
      ],
    })
    expect(observed).toEqual([{ kind: 'job-claimed', candidateId }])
    expect(readFileSync(leasePath)).toEqual(currentLeaseBytes)
    expect(enumerateBundleDirs(knowledgeRoot)).toEqual([])
    expect(readJobState(knowledgeRoot, candidateId)).toMatchObject({
      kind: 'parsed',
      state: { lifecycle: 'authored' },
    })
    expect(releaseLease({ knowledgeRoot, leaseId: current.leaseId })).toEqual({
      kind: 'released',
    })
  })

  it.each([
    'malformed state',
    'author failure',
    'checkpoint failure',
    'requeue resynthesis',
    'embedding crash requeue',
    'non-terminal commit failure',
  ] as const)('never reports completion after %s', async (scenario) => {
    const candidateId = enqueue(`lifecycle-${scenario.replaceAll(' ', '-')}`, 'ci')
    const observed: CurationDrainLifecycleEvent[] = []
    let author: CuratorAuthor = scriptedAuthor()
    const operations: Partial<DrainOperations> = maintenanceFreeOperations()

    switch (scenario) {
      case 'malformed state':
        operations.readJobState = () => ({ kind: 'malformed', present: true })
        break
      case 'author failure':
        author = async () => {
          throw new Error('injected author failure')
        }
        break
      case 'checkpoint failure':
        operations.persistAuthoredCheckpoint = () => ({
          kind: 'malformed-state',
          present: true,
        })
        break
      case 'requeue resynthesis':
        operations.commitCurationDelta = () => ({
          kind: 'requeue-resynthesis',
          reason: 'injected compare-and-set miss',
        })
        break
      case 'embedding crash requeue':
        operations.commitCurationDelta = () => {
          throw new Error('injected native embedding crash')
        }
        break
      case 'non-terminal commit failure':
        operations.commitCurationDelta = () => ({
          kind: 'failed',
          reason: 'append-failed',
        })
        break
    }

    await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author,
      executionContext: 'ci',
      policy,
      maintenance: 'skip',
      onJobLifecycle: (event) => observed.push(event),
      operations,
    })

    expect(observed).toEqual([{ kind: 'job-claimed', candidateId }])
  })

  it('reports no lifecycle event when abort wins before the claim boundary', async () => {
    enqueue('pre-claim-abort', 'ci')
    const controller = new AbortController()
    controller.abort()
    const observed: CurationDrainLifecycleEvent[] = []

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author: scriptedAuthor(),
      executionContext: 'ci',
      policy,
      maintenance: 'skip',
      signal: controller.signal,
      onJobLifecycle: (event) => observed.push(event),
      operations: maintenanceFreeOperations(),
    })

    expect(report).toMatchObject({ kind: 'aborted', jobsProcessed: 0, committed: 0 })
    expect(observed).toEqual([])
  })

  it('reports the exact pending remainder on budget cut and handed off exits', async () => {
    enqueue('budget-first', 'local-interactive')
    enqueue('budget-second', 'local-interactive')
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(60_000)

    const budgetCut = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author: scriptedAuthor(),
      executionContext: 'ci',
      policy,
      now,
      operations: maintenanceFreeOperations(),
    })

    expect(budgetCut).toMatchObject({ kind: 'drained', jobsProcessed: 1, committed: 1 })
    expect(listQueuedCandidates(knowledgeRoot)).toHaveLength(1)
    expect(reportRemaining(budgetCut)).toBe(1)

    const holder = acquireWriterLease(knowledgeRoot)
    if (holder.kind !== 'acquired') throw new Error('expected holder lease')
    const handedOff = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author: scriptedAuthor(),
      executionContext: 'local-interactive',
      policy,
      operations: maintenanceFreeOperations(),
    })

    expect(handedOff).toMatchObject({ kind: 'handed-off' })
    expect(reportRemaining(handedOff)).toBe(1)
    expect(releaseLease({ knowledgeRoot, leaseId: holder.leaseId })).toEqual({
      kind: 'released',
    })
  })

  it('counts pending jobs and treats absent or empty queues as zero', () => {
    const countPendingCurationJobs = (
      curationQueue as unknown as {
        countPendingCurationJobs?: (knowledgeRoot: string) => number
      }
    ).countPendingCurationJobs

    expect(countPendingCurationJobs).toBeTypeOf('function')
    expect(countPendingCurationJobs?.(join(root, 'absent-knowledge-root'))).toBe(0)
    expect(countPendingCurationJobs?.(knowledgeRoot)).toBe(0)
    enqueue('pending-count-one', 'ci')
    enqueue('pending-count-two', 'ci')
    expect(countPendingCurationJobs?.(knowledgeRoot)).toBe(2)
  })

  it('omits every maintenance mutation when the daemon cadence owns the tail', async () => {
    const writerMutation = join(root, 'writer-pass-mutated')
    const gcMutation = join(root, 'gc-mutated')
    const rebuild = vi.fn(async () => {
      writeFileSync(writerMutation, 'unexpected')
      return {
        projected: 0,
        skippedIncomplete: 0,
        scanIssues: [],
        removed: 0,
        backfilled: 0,
        vec: 'vec0' as const,
        pendingEmbeddings: 0,
        maintenanceRemaining: false,
      }
    })
    const gc = vi.fn(() => {
      writeFileSync(gcMutation, 'unexpected')
      return {
        trimmedRecordIds: [],
        skipped: { unknownRef: 0, withinK: 0, userOrigin: 0, horizon: 0 },
      }
    })

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author: scriptedAuthor(),
      executionContext: 'local-headless',
      policy,
      maintenance: 'skip',
      operations: {
        readRebuildRequest: () => ({ present: false }),
        readIndexMaintenanceState: () => ({
          ...NO_INDEX_MAINTENANCE,
          pendingEmbeddings: 1,
        }),
        acquireEmbedder: async () => ({ kind: 'lexical-only' }),
        rebuildIndex: rebuild,
        runKnowledgeGc: gc,
      },
    } as Parameters<typeof drainQueue>[0] & { maintenance: 'skip' })

    expect(report.writerPass).toEqual({ kind: 'skipped', reason: 'daemon-cadence' })
    expect(report.gc).toEqual({ kind: 'skipped', reason: 'daemon-cadence' })
    expect(rebuild).not.toHaveBeenCalled()
    expect(gc).not.toHaveBeenCalled()
    expect(existsSync(writerMutation)).toBe(false)
    expect(existsSync(gcMutation)).toBe(false)
    expect(enumerateBundleDirs(knowledgeRoot)).toEqual([])
  })

  it('runs the exported maintenance tail with the inline writer and GC result shapes', async () => {
    const runMaintenanceTail = maintenanceTail()
    const request = {
      reason: 'locked' as const,
      detail: 'daemon substrate direct tail',
      requestedAt: '2026-07-30T00:00:00.000Z',
    }
    const rebuild = {
      projected: 0,
      skippedIncomplete: 0,
      scanIssues: [],
      removed: 0,
      backfilled: 0,
      vec: 'vec0' as const,
      pendingEmbeddings: 0,
      maintenanceRemaining: false,
    }
    const summary = {
      trimmedRecordIds: [],
      skipped: { unknownRef: 0, withinK: 0, userOrigin: 0, horizon: 0 },
    }

    const result = await runMaintenanceTail({
      knowledgeRoot,
      lease: { leaseId: 'direct-tail-lease', epoch: 7 },
      operations: {
        readRebuildRequest: () => ({ present: true, request }),
        readIndexMaintenanceState: () => NO_INDEX_MAINTENANCE,
        acquireEmbedder: async () => ({ kind: 'lexical-only' }),
        rebuildIndex: vi.fn(async () => rebuild),
        runKnowledgeGc: vi.fn(() => summary),
      },
    })

    expect(result).toEqual({
      writerPass: { kind: 'rebuilt', request, rebuild },
      gc: { kind: 'completed', summary },
      failures: [],
    })
  })

  it('surfaces the same WriterAuthorityLostError from a stale direct tail', async () => {
    const runMaintenanceTail = maintenanceTail()
    const stale = acquireWriterLease(knowledgeRoot)
    if (stale.kind !== 'acquired') throw new Error('expected stale lease seed')
    expect(releaseLease({ knowledgeRoot, leaseId: stale.leaseId })).toEqual({
      kind: 'released',
    })
    const current = acquireWriterLease(knowledgeRoot)
    if (current.kind !== 'acquired') throw new Error('expected replacement lease')
    requestRebuild({
      knowledgeRoot,
      reason: 'locked',
      detail: 'force the direct writer pass through its fresh epoch fence',
    })

    await expect(
      runMaintenanceTail({
        knowledgeRoot,
        lease: { leaseId: stale.leaseId, epoch: stale.epoch },
        operations: {
          acquireEmbedder: async () => ({ kind: 'lexical-only' }),
        },
      }),
    ).rejects.toMatchObject({
      name: 'WriterAuthorityLostError',
      reason: 'epoch-mismatch-before-heartbeat',
      observedEpoch: current.epoch,
    })
    await expect(
      runMaintenanceTail({
        knowledgeRoot,
        lease: { leaseId: stale.leaseId, epoch: stale.epoch },
        operations: {
          acquireEmbedder: async () => ({ kind: 'lexical-only' }),
        },
      }),
    ).rejects.toBeInstanceOf(WriterAuthorityLostError)
    expect(releaseLease({ knowledgeRoot, leaseId: current.leaseId })).toEqual({
      kind: 'released',
    })
  })
})
