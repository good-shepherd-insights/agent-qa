import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import type { CuratorAuthor } from '../curator/author-contract.js'
import {
  drainQueue,
  type DrainOperations,
} from '../curator/drain.js'
import {
  acquireWriterLease,
  LEASE_FILE,
  LEASE_HEARTBEAT_TTL_MS,
  WriterAuthorityLostError,
  type CurrentWriterAuthority,
} from '../lease/writer-lease.js'
import {
  claimNextJob,
  requeueClaimed,
  type ClaimNextJobOptions,
  type ClaimNextJobOutcome,
  type RequeueClaimedOptions,
} from '../queue/curation-queue.js'
import {
  claimedCandidateDir,
  jobStatePath,
  queuedCandidateDir,
} from '../queue/queue-layout.js'
import {
  readJobState,
  writeJobState,
  type WriteJobStateOptions,
} from '../queue/job-state.js'
import {
  reconcileOnDrainStart,
  type ReconcileOnDrainStartDependencies,
  type ReconcileReport,
} from '../journal/reconcile.js'
import { scaffoldKnowledgeRoot } from './fixtures/bundle-fixture.js'
import {
  enqueueArtifactFreeCandidateProjection,
  type ArtifactFreeCandidateProjectionInput,
} from './fixtures/curation-candidate-fixture.js'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FencedClaimNextJobOptions extends ClaimNextJobOptions {
  authority: CurrentWriterAuthority
}

interface FencedRequeueClaimedOptions extends RequeueClaimedOptions {
  authority: CurrentWriterAuthority
}

interface FencedWriteJobStateOptions extends WriteJobStateOptions {
  authority: CurrentWriterAuthority
}

interface FencedReconcileDependencies extends ReconcileOnDrainStartDependencies {
  writerAuthority: CurrentWriterAuthority
}

const fencedClaimNextJob = claimNextJob as unknown as (
  options: FencedClaimNextJobOptions,
) => ClaimNextJobOutcome | undefined
const fencedRequeueClaimed = requeueClaimed as unknown as (
  options: FencedRequeueClaimedOptions,
) => string[]
const fencedWriteJobState = writeJobState as unknown as (
  options: FencedWriteJobStateOptions,
) => ReturnType<typeof writeJobState>
const fencedReconcileOnDrainStart = reconcileOnDrainStart as unknown as (
  dependencies: FencedReconcileDependencies,
) => ReconcileReport

const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)
const NO_INDEX_MAINTENANCE = {
  indexAbsent: false,
  pendingEmbeddings: 0,
  renderingEpochStale: false,
  vectorReconciliationOutstanding: false,
} as const

function snapshotTree(root: string): string[] {
  if (!existsSync(root)) return []
  const snapshot: string[] = []
  const visit = (path: string): void => {
    for (const entry of readdirSync(path).sort()) {
      const absolute = join(path, entry)
      const key = relative(root, absolute)
      const stat = lstatSync(absolute)
      if (stat.isDirectory()) {
        snapshot.push(`dir:${key}`)
        visit(absolute)
      } else {
        snapshot.push(`file:${key}:${readFileSync(absolute).toString('base64')}`)
      }
    }
  }
  visit(root)
  return snapshot
}

describe('queue and recovery writer-authority fencing (CR-02)', () => {
  let root: string
  let knowledgeRoot: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-queue-authority-fencing-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    scaffoldKnowledgeRoot(knowledgeRoot)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function projectionInput(seed: string): ArtifactFreeCandidateProjectionInput {
    return {
      sourceRunId: `run-${seed}`,
      scope: { tier: 'product', key: 'queue-authority-fencing' },
      buildOrdinal: 42,
      executionContext: 'local-headless',
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
          step: { naturalKey: seed, ordinal: 0 },
          platform: 'web',
          element: { naturalKey: `button:${seed}` },
          observedAtOrdinal: 42,
        },
      ],
      evidenceToken: `evidence-${seed}`,
      attributingObservationId: `observation-${seed}`,
      emittedAt: '2026-07-30T00:00:00.000Z',
    }
  }

  function enqueue(seed: string): string {
    const outcome = enqueueArtifactFreeCandidateProjection({
      knowledgeRoot,
      projectionInput: projectionInput(seed),
    })
    expect(outcome.kind).toBe('enqueued')
    if (outcome.kind !== 'enqueued') throw new Error('expected enqueued candidate')
    return outcome.candidateId
  }

  function acquireAuthority(): CurrentWriterAuthority {
    const outcome = acquireWriterLease(knowledgeRoot)
    expect(outcome.kind).toBe('acquired')
    if (outcome.kind !== 'acquired') throw new Error('expected acquired writer authority')
    return { leaseId: outcome.leaseId, epoch: outcome.epoch }
  }

  function reclaim(stale: CurrentWriterAuthority): CurrentWriterAuthority {
    const leasePath = join(knowledgeRoot, LEASE_FILE)
    const holder = JSON.parse(readFileSync(leasePath, 'utf8')) as Record<string, unknown>
    expect(holder.leaseId).toBe(stale.leaseId)
    writeFileSync(
      leasePath,
      `${JSON.stringify({
        ...holder,
        heartbeatAtMs: Date.now() - LEASE_HEARTBEAT_TTL_MS,
      })}\n`,
      'utf8',
    )
    const outcome = acquireWriterLease(knowledgeRoot)
    expect(outcome.kind).toBe('acquired')
    if (outcome.kind !== 'acquired') throw new Error('expected replacement authority')
    expect(outcome.epoch).toBeGreaterThan(stale.epoch)
    return { leaseId: outcome.leaseId, epoch: outcome.epoch }
  }

  function reconcileDependencies(
    writerAuthority: CurrentWriterAuthority,
  ): FencedReconcileDependencies {
    return {
      knowledgeRoot,
      writerAuthority,
      hasIndexRow: () => true,
      applyIndexDelta: () => undefined,
      deriveIndexRowFromBundle: () => undefined,
    }
  }

  it('rejects a stale claim before the queued tree changes', () => {
    const candidateId = enqueue('stale-claim')
    const stale = acquireAuthority()
    reclaim(stale)
    const before = snapshotTree(knowledgeRoot)

    expect(() => fencedClaimNextJob({
      knowledgeRoot,
      leaseId: stale.leaseId,
      authority: stale,
    })).toThrow(WriterAuthorityLostError)

    expect(snapshotTree(knowledgeRoot)).toEqual(before)
    expect(existsSync(queuedCandidateDir(knowledgeRoot, candidateId))).toBe(true)
  })

  it('accepts a current-authority claim and initializes its lifecycle state', () => {
    const candidateId = enqueue('current-claim')
    const authority = acquireAuthority()

    const claimed = fencedClaimNextJob({
      knowledgeRoot,
      leaseId: authority.leaseId,
      authority,
    })

    expect(claimed).toMatchObject({ kind: 'claimed', candidateId })
    expect(readJobState(knowledgeRoot, candidateId)).toMatchObject({
      kind: 'parsed',
      state: { lifecycle: 'queued' },
    })
  })

  it('rejects a stale requeue without moving or deleting claimed bytes', () => {
    const candidateId = 'a'.repeat(64)
    mkdirSync(claimedCandidateDir(knowledgeRoot, 'expired-claim', candidateId), {
      recursive: true,
    })
    const stale = acquireAuthority()
    reclaim(stale)
    const before = snapshotTree(knowledgeRoot)

    expect(() => fencedRequeueClaimed({
      knowledgeRoot,
      leaseId: 'expired-claim',
      authority: stale,
    })).toThrow(WriterAuthorityLostError)

    expect(snapshotTree(knowledgeRoot)).toEqual(before)
  })

  it('accepts a current-authority recovery requeue', () => {
    const candidateId = 'b'.repeat(64)
    mkdirSync(claimedCandidateDir(knowledgeRoot, 'expired-claim', candidateId), {
      recursive: true,
    })
    const authority = acquireAuthority()

    expect(fencedRequeueClaimed({
      knowledgeRoot,
      leaseId: 'expired-claim',
      authority,
    })).toEqual([candidateId])

    expect(existsSync(queuedCandidateDir(knowledgeRoot, candidateId))).toBe(true)
    expect(readJobState(knowledgeRoot, candidateId)).toMatchObject({
      kind: 'parsed',
      state: { lifecycle: 'queued' },
    })
  })

  it('rejects a stale lifecycle write without publishing a state file', () => {
    const candidateId = 'c'.repeat(64)
    const stale = acquireAuthority()
    reclaim(stale)
    const before = snapshotTree(knowledgeRoot)

    expect(() => fencedWriteJobState({
      knowledgeRoot,
      candidateId,
      lifecycle: 'authored',
      authority: stale,
    })).toThrow(WriterAuthorityLostError)

    expect(snapshotTree(knowledgeRoot)).toEqual(before)
    expect(existsSync(jobStatePath(knowledgeRoot, candidateId))).toBe(false)
  })

  it('accepts a current-authority lifecycle write', () => {
    const candidateId = 'd'.repeat(64)
    const authority = acquireAuthority()

    fencedWriteJobState({
      knowledgeRoot,
      candidateId,
      lifecycle: 'authored',
      authority,
    })

    expect(readJobState(knowledgeRoot, candidateId)).toMatchObject({
      kind: 'parsed',
      state: { lifecycle: 'authored' },
    })
  })

  it('removes only the current authority own claim when marking done', () => {
    const candidateId = 'e'.repeat(64)
    const authority = acquireAuthority()
    const ownClaim = claimedCandidateDir(knowledgeRoot, authority.leaseId, candidateId)
    const successorClaim = claimedCandidateDir(knowledgeRoot, 'successor-lease', candidateId)
    mkdirSync(ownClaim, { recursive: true })
    mkdirSync(successorClaim, { recursive: true })

    fencedWriteJobState({
      knowledgeRoot,
      candidateId,
      lifecycle: 'done',
      authority,
    })

    expect(existsSync(ownClaim)).toBe(false)
    expect(existsSync(successorClaim)).toBe(true)
  })

  it('rejects stale reconciliation before moving a recoverable claim', () => {
    const candidateId = 'f'.repeat(64)
    mkdirSync(claimedCandidateDir(knowledgeRoot, 'expired-claim', candidateId), {
      recursive: true,
    })
    const stale = acquireAuthority()
    reclaim(stale)
    const before = snapshotTree(knowledgeRoot)

    expect(() => fencedReconcileOnDrainStart(
      reconcileDependencies(stale),
    )).toThrow(WriterAuthorityLostError)

    expect(snapshotTree(knowledgeRoot)).toEqual(before)
  })

  it('accepts current-authority reconciliation and recovers the dead lease', () => {
    const candidateId = '1'.repeat(64)
    mkdirSync(claimedCandidateDir(knowledgeRoot, 'expired-claim', candidateId), {
      recursive: true,
    })
    const authority = acquireAuthority()

    expect(fencedReconcileOnDrainStart(reconcileDependencies(authority))).toMatchObject({
      jobsRequeued: 1,
    })
    expect(existsSync(queuedCandidateDir(knowledgeRoot, candidateId))).toBe(true)
  })

  it('stops a drain on its first typed authority loss without claiming the next candidate', async () => {
    enqueue('drain-first')
    enqueue('drain-second')
    const stale = acquireAuthority()
    let reclaimed = false
    const claimDuringTakeover = vi.fn((options: FencedClaimNextJobOptions) => {
      if (!reclaimed) {
        reclaimed = true
        reclaim(stale)
      }
      return fencedClaimNextJob({ ...options, authority: stale })
    })
    const author = vi.fn(async () => {
      throw new Error('author must not run after claim authority loss')
    }) as CuratorAuthor

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir: join(root, '.agent-qa'),
      author,
      executionContext: 'local-headless',
      policy,
      maintenance: 'skip',
      lease: stale,
      operations: {
        claimNextJob: claimDuringTakeover as unknown as DrainOperations['claimNextJob'],
        readRebuildRequest: () => ({ present: false }),
        readIndexMaintenanceState: () => NO_INDEX_MAINTENANCE,
      },
    })

    expect(report).toMatchObject({
      kind: 'drained',
      jobsProcessed: 0,
      committed: 0,
      failures: 1,
      failureDetails: [
        expect.objectContaining({
          stage: 'claim',
          message: expect.stringContaining('writer authority lost'),
        }),
      ],
    })
    expect(claimDuringTakeover).toHaveBeenCalledOnce()
    expect(author).not.toHaveBeenCalled()
    expect(readdirSync(join(knowledgeRoot, 'curation', 'queue', 'queued'))).toHaveLength(2)
  })
})
