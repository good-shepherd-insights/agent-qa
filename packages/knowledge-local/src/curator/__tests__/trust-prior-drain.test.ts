import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { canonicalJson, type Delta, type TrustPriorTable } from '@vostride/agent-qa-schema'
import { defaultGuardrailPolicyInput, loadGuardrailPolicy } from '@vostride/agent-qa-safety'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enqueueArtifactFreeCandidateProjection } from '../../__tests__/fixtures/curation-candidate-fixture.js'
import { makeFakeEmbedder } from '../../__tests__/fixtures/fake-embedder.js'
import { loadBundle } from '../../bundle-read.js'
import { enumerateBundleDirs } from '../../bundle-scan.js'
import { indexDbPath } from '../../index-open.js'
import { rebuildIndex } from '../../index-rebuild.js'
import type { CommitIntent } from '../../journal/intent-journal.js'
import { acquireWriterLease, releaseLease } from '../../lease/writer-lease.js'
import { listQueuedCandidates } from '../../queue/curation-queue.js'
import { applyReview } from '../../review/apply-review.js'
import { proposeReview } from '../../review/propose-review.js'
import type { CuratorAuthor } from '../author-contract.js'
import { commitCurationDelta } from '../commit.js'
import { drainQueue, type DrainOperations } from '../drain.js'
import { runMaintenanceTail } from '../maintenance.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const prior = (): TrustPriorTable => ({ 'agent-verified': { alpha: 2.7, beta: 0.3 } })
const hostSnapshot = () => Object.freeze({ 'agent-verified': Object.freeze({ alpha: 2.7, beta: 0.3 }) })
const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-prior-drain-'))
  roots.push(root)
  const knowledgeRoot = join(root, 'knowledge')
  const auditBaseDir = join(root, 'audit')
  const queued = enqueueArtifactFreeCandidateProjection({ knowledgeRoot, projectionInput: {
    sourceRunId: 'prior-drain-run', scope: { tier: 'product', key: 'storefront' },
    buildOrdinal: 42, executionContext: 'local-interactive', secretFlagged: false,
    injectionFlagged: false, kind: 'fact', subtype: 'content',
    anchors: [{ t: 'el', role: 'button', name: 'Checkout' }],
    summarySeed: 'Checkout content', bodySeed: 'Checkout is available.',
    distilledObservations: [], evidenceToken: 'prior-drain-evidence',
    attributingObservationId: 'prior-drain-observation', emittedAt: '2026-07-15T10:00:00.000Z',
  } })
  if (queued.kind !== 'enqueued') throw new Error(`fixture queue refused: ${queued.kind}`)
  const author = vi.fn<CuratorAuthor>(async job => {
    const authorship = { path: 'llm' as const, model: { id: 'prior-drain-fixture' }, executionContext: job.executionContext }
    const delta: Delta = { kind: 'Add', origin: 'agent', scope: job.scope, citedIds: [], authorship,
      bundle: { kind: 'fact', subtype: 'content', anchors: job.anchors, scope: job.scope,
        summary: job.summarySeed, body: job.bodySeed, originStage: 'run-curation',
        distilledEvidenceRef: { id: `curation-candidate-${job.candidateId}`, sha: job.candidateId } } }
    return { kind: 'authored', authorship, deltas: [delta] }
  })
  return { knowledgeRoot, auditBaseDir, agentQaRoot: auditBaseDir, author,
    policy, executionContext: 'local-interactive' as const, maintenance: 'skip' as const }
}

function persisted(knowledgeRoot: string) {
  const [entry] = enumerateBundleDirs(knowledgeRoot)
  if (entry === undefined) throw new Error('fixture bundle missing')
  const loaded = loadBundle(entry.dir)
  if (loaded.kind !== 'loaded') throw new Error('fixture bundle refused')
  const db = new DatabaseSync(indexDbPath(knowledgeRoot), { readOnly: true })
  try { return { entry, bundle: loaded.bundle, row: { ...db.prepare('SELECT * FROM records WHERE bundle_id = ?').get(loaded.bundle.manifest.id)! } } }
  finally { db.close() }
}

describe('420 drain, review and maintenance prior snapshot', () => {
  it('reuses host data across a durable queue retry without authoring again', async () => {
    const f = fixture()
    const priors = hostSnapshot()
    const observed: (TrustPriorTable | undefined)[] = []
    const commit: typeof commitCurationDelta = (deps, job, checkpoint) => {
      observed.push(deps.priors)
      if (observed.length === 1) throw new Error('embedding worker terminated')
      return commitCurationDelta(deps, job, checkpoint)
    }
    const lifecycle = vi.fn()
    const options = { ...f, priors, onJobLifecycle: lifecycle, operations: { commitCurationDelta: commit } }
    expect(await drainQueue(options)).toMatchObject({ committed: 0, requeued: 1, failures: 1 })
    expect(listQueuedCandidates(f.knowledgeRoot)).toHaveLength(1)
    expect(await drainQueue(options)).toMatchObject({ committed: 1, requeued: 0, failures: 0 })
    expect(f.author).toHaveBeenCalledTimes(1)
    expect(observed).toEqual([priors, priors])
    expect(observed.every(table => Object.isFrozen(table) && Object.isFrozen(table!['agent-verified']))).toBe(true)
    expect(persisted(f.knowledgeRoot).row.trust).toBe(0.925)
    expect(lifecycle.mock.calls.filter(([event]) => event.kind === 'job-completed')).toHaveLength(1)
    expect(listQueuedCandidates(f.knowledgeRoot)).toEqual([])
  })

  it('copies the drain table before awaiting authoring', async () => {
    const f = fixture()
    const mutable = prior()
    const original = f.author.getMockImplementation()!
    f.author.mockImplementation(async (...args) => {
      mutable['agent-verified']!.alpha = 0
      return original(...args)
    })
    const options = { ...f, priors: mutable }
    expect(await drainQueue(options)).toMatchObject({ committed: 1, failures: 0 })
    expect(persisted(f.knowledgeRoot).row.trust).toBe(0.925)
  })

  it('applies review with one resolver call and the same host prior as the drain', async () => {
    const f = fixture()
    const priors = hostSnapshot()
    await drainQueue({ ...f, priors })
    const before = persisted(f.knowledgeRoot)
    const proposal = proposeReview({ agentQaRoot: f.agentQaRoot, knowledgeRoot: f.knowledgeRoot,
      request: { verb: 'accept', input: { target: { grain: 'record', recordId: before.bundle.manifest.id } } } })
    if (proposal.kind !== 'proposed') throw new Error('fixture proposal refused')
    const resolver = vi.fn().mockReturnValueOnce(priors).mockReturnValue({})
    const options = { agentQaRoot: f.agentQaRoot, knowledgeRoot: f.knowledgeRoot,
      proposalId: proposal.proposal.proposalId, resolveTrustPriors: resolver }
    expect(await applyReview(options)).toMatchObject({ outcome: 'applied' })
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(persisted(f.knowledgeRoot).row.trust).toBe(0.94)
    const bytes = readFileSync(join(before.entry.dir, 'evidence/outcomes.jsonl'), 'utf8')
    expect(await applyReview(options)).toMatchObject({ outcome: 'already-applied' })
    expect(readFileSync(join(before.entry.dir, 'evidence/outcomes.jsonl'), 'utf8')).toBe(bytes)
  })

  it('rebuilds maintenance from the host snapshot and preserves all event bytes', async () => {
    const f = fixture()
    const priors = hostSnapshot()
    await drainQueue({ ...f, priors })
    const before = persisted(f.knowledgeRoot)
    const lease = acquireWriterLease(f.knowledgeRoot)
    if (lease.kind !== 'acquired') throw new Error('fixture lease refused')
    const observed: (TrustPriorTable | undefined)[] = []
    const options = { knowledgeRoot: f.knowledgeRoot, lease, priors, embeddingCapability: { kind: 'lexical-only' as const },
      operations: { readIndexMaintenanceState: () => ({ indexAbsent: true, pendingEmbeddings: 0,
        renderingEpochStale: false, vectorReconciliationOutstanding: false }),
        rebuildIndex: async (input: Parameters<typeof rebuildIndex>[0]) => {
          observed.push(input.priors)
          return rebuildIndex({ ...input, embedder: makeFakeEmbedder(),
            writerAuthority: { knowledgeRoot: f.knowledgeRoot, leaseId: lease.leaseId, epoch: lease.epoch } })
        },
      } }
    try {
      const report = await runMaintenanceTail(options)
      expect(report.writerPass.kind).toBe('rebuilt')
      expect(report.failures).toEqual([])
      expect(observed).toEqual([priors])
      expect(persisted(f.knowledgeRoot).row.trust).toBe(0.925)
      expect(canonicalJson(persisted(f.knowledgeRoot).bundle.events)).toBe(canonicalJson(before.bundle.events))
    } finally { releaseLease({ knowledgeRoot: f.knowledgeRoot, leaseId: lease.leaseId }) }
  })

  it('passes the snapshot to both recovery projection callbacks', async () => {
    const f = fixture()
    await drainQueue(f)
    const before = persisted(f.knowledgeRoot)
    const priors = hostSnapshot()
    const observed: (TrustPriorTable | undefined)[] = []
    const operations: Partial<DrainOperations> = {
      reconcileOnDrainStart: deps => {
        deps.applyIndexDelta({ bundleId: before.bundle.manifest.id } as CommitIntent)
        deps.deriveIndexRowFromBundle(before.bundle.manifest.id)
        return { intentsCleared: 0, intentsReplayed: 0, intentsDiscarded: 0,
          intentsQuarantinedStale: 0, jobsRequeued: 0, orphansRemoved: 0, malformed: 0 }
      },
      applyIndexDeltaForBundle: input => { observed.push(input.priors) },
      deriveIndexRowFromBundle: input => { observed.push(input.priors) },
    }
    expect(await drainQueue({ ...f, priors, operations })).toMatchObject({ failures: 0 })
    expect(observed).toEqual([priors, priors])
    expect(observed[0]).toBe(observed[1])
  })

  it('preserves absent and empty prior lifecycle, counters and event bytes', async () => {
    const results = []
    for (const priors of [undefined, {}, hostSnapshot()]) {
      const f = fixture()
      const report = await drainQueue({ ...f, ...(priors === undefined ? {} : { priors }) })
      const actual = persisted(f.knowledgeRoot)
      const { trust, ...rest } = actual.row
      results.push({ report, rest, trust, events: canonicalJson(actual.bundle.events) })
    }
    expect(results[0]).toEqual(results[1])
    expect(results[2]!.report).toEqual(results[0]!.report)
    expect(results[2]!.rest).toEqual(results[0]!.rest)
    expect(results[2]!.events).toBe(results[0]!.events)
    expect(results[2]!.trust).not.toBe(results[0]!.trust)
  })
})
