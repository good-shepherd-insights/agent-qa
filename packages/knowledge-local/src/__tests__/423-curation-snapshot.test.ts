import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { asEvidenceToken, asRecordId, type BundleDraft, type Delta } from '@vostride/agent-qa-schema'
import { defaultGuardrailPolicyInput, loadGuardrailPolicy } from '@vostride/agent-qa-safety'
import * as bundleAppend from '../bundle-append.js'
import { loadBundle } from '../bundle-read.js'
import { commitCurationDelta, type CommitCurationDependencies, type CommitCurationJob } from '../curator/commit.js'
import type { AuthoredDeltaCheckpoint } from '../curator/author-contract.js'
import { claimNextJob } from '../queue/curation-queue.js'
import { enqueueArtifactFreeCandidateProjection } from './fixtures/curation-candidate-fixture.js'

import { commitIntentSchema, listCommitIntents, writeCommitIntent } from '../journal/intent-journal.js'
import { clearCommitIntent } from '../journal/intent-journal.js'
import { acquireWriterLease, releaseLease } from '../lease/writer-lease.js'
import { readJobState, writeJobState } from '../queue/job-state.js'
import { reconcileOnDrainStart } from '../journal/reconcile.js'
import { applyIndexDeltaForBundleWithinCurrentAuthority } from '../curator/commit.js'
import { enumerateBundleDirs } from '../bundle-scan.js'
import {
  COMPLETED_EFFECTS_SUBDIR,
  curationEffectReceiptSchema,
  effectIdentity,
  listCurationEffectReceipts,
  writeCurationEffectReceipt,
  receiptForEffect,
  type CurationObservation,
} from '../journal/curation-effect-receipt.js'

const roots: string[] = []
function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), '423-curation-snapshot-'))
  roots.push(root)
  return root
}
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function commitFixture() {
  const root = temporaryRoot()
  const lease = acquireWriterLease(root)
  if (lease.kind !== 'acquired') throw new Error('expected fresh lease')
  const authority = { leaseId: lease.leaseId, epoch: lease.epoch }
  const deps: CommitCurationDependencies = { knowledgeRoot: root, auditBaseDir: join(root, 'audit'), epoch: lease.epoch,
    profile: { mode: 'propose-only' }, drainState: { supersedesSeenByAnchorKey: new Map() }, policy: loadGuardrailPolicy(defaultGuardrailPolicyInput) }
  function draft(name: string): BundleDraft {
    return { kind: 'fact', subtype: 'selector', anchors: [{ t: 'el', role: 'button', name }, { t: 'page', route: '/checkout' }, { t: 'selector', literal: '[data-testid="checkout"]' }],
      scope: { tier: 'product', key: 'storefront' }, summary: `${name} selector`, body: `${name} verified`,
      distilledEvidenceRef: { id: 'synthetic-evidence', sha: 'a'.repeat(64) }, originStage: 'run-curation' }
  }
  function job(name: string, ordinal: number): CommitCurationJob {
    const bundle = draft(name)
    const enqueued = enqueueArtifactFreeCandidateProjection({ knowledgeRoot: root, projectionInput: {
      sourceRunId: `synthetic-run-${ordinal}`, scope: bundle.scope, buildOrdinal: ordinal, executionContext: 'ci', secretFlagged: false, injectionFlagged: false,
      kind: 'fact', subtype: 'selector', anchors: bundle.anchors, summarySeed: bundle.summary, bodySeed: bundle.body,
      distilledObservations: [{ schemaVersion: 1, step: { naturalKey: 'checkout', ordinal: 0 }, platform: 'web', element: { naturalKey: `button:${name}` }, observedAtOrdinal: ordinal }],
      evidenceToken: `synthetic-evidence-${ordinal}`, attributingObservationId: `synthetic-observation-${ordinal}`, emittedAt: '2026-09-14T00:00:00.000Z',
    } })
    if (enqueued.kind !== 'enqueued') throw new Error('expected enqueued candidate')
    const claimed = claimNextJob({ knowledgeRoot: root, authority, leaseId: authority.leaseId })
    if (claimed?.kind !== 'claimed') throw new Error('expected claimed candidate')
    return claimed
  }
  function checkpoint(delta: Delta): AuthoredDeltaCheckpoint {
    return { schemaVersion: 1, delta, neighborIds: [...delta.citedIds], preconditions: [...(delta.precondition ?? [])],
      authorship: { path: 'llm', model: { id: 'synthetic-curator' }, executionContext: 'ci' } }
  }
  const victimJob = job('Checkout', 42)
  const add: Delta = { kind: 'Add', origin: 'agent', scope: draft('Checkout').scope, citedIds: [], bundle: draft('Checkout') }
  const victim = commitCurationDelta(deps, victimJob, checkpoint(add))
  if (victim.kind !== 'applied') throw new Error(`expected victim Add: ${victim.kind}`)
  const claimed = job('Purchase', 43)
  const supersede: Delta = { kind: 'Supersede', origin: 'agent', scope: draft('Purchase').scope, citedIds: [victim.bundleId],
    precondition: [{ recordId: victim.bundleId, observedStatus: 'candidate', observedOrdinal: 42 }],
    victimId: victim.bundleId, newBundle: draft('Purchase'), evidenceToken: asEvidenceToken(claimed.payload.evidenceToken) }
  const rows = () => listCurationEffectReceipts(root).filter((row) => row.candidateId === claimed.candidateId)
  return { root, authority, deps, claimed, supersede, victim, victimJob, add, draft, job, checkpoint, rows }
}

import { foldCurationSnapshot, readCurationEffects } from '../curator/curation-snapshot.js'
import { drainQueue } from '../curator/drain.js'

function snapshot(f: ReturnType<typeof commitFixture>, run = 'synthetic-run-43') {
  return foldCurationSnapshot(readCurationEffects({ knowledgeRoot: f.root, sourceRunId: run }))
}

describe('423 curation snapshot', () => {
  it('CURATION-FIVE-BUCKETS counts five actual affected units and suppresses replacement Add', () => {
    const f = commitFixture()
    const active = { ...f.deps, profile: { mode: 'drain-to-active' as const } }
    expect(commitCurationDelta(active, f.claimed, f.checkpoint(f.supersede)).kind).toBe('applied')
    // Reuse one run attribution across distinct candidates, with independent historical ordinals.
    const commit = (name: string, ordinal: number, make: (job: CommitCurationJob) => Delta, proposed = false) => {
      const j = f.job(name, ordinal)
      j.payload.sourceRunId = 'synthetic-run-43'
      const result = commitCurationDelta(proposed ? f.deps : active, j, f.checkpoint(make(j)))
      expect(['applied', 'converted-confirm', 'downgraded'], `${name}: ${JSON.stringify(result)}`).toContain(result.kind)
      return result
    }
    commit('New', 44, () => ({ ...f.add, bundle: f.draft('New') }))
    const oldConfirm = f.job('Existing', 45)
    const existing = commitCurationDelta(active, oldConfirm, f.checkpoint({ ...f.add, bundle: f.draft('Existing') }))
    if (existing.kind !== 'applied') throw new Error('fixture existing Add')
    for (const ordinal of [46, 47]) commit('Reinforce', ordinal, (j) => ({ kind: 'Confirm', origin: 'agent', scope: f.add.scope,
      citedIds: [existing.bundleId], targetId: existing.bundleId, evidenceToken: asEvidenceToken(j.payload.evidenceToken) }))
    const oldDeprecate = f.job('Retire', 48)
    const retiring = commitCurationDelta(active, oldDeprecate, f.checkpoint({ ...f.add, bundle: f.draft('Retire') }))
    if (retiring.kind !== 'applied') throw new Error('fixture retired Add')
    commit('Retired', 49, () => ({ kind: 'Deprecate', origin: 'agent', scope: f.add.scope, citedIds: [retiring.bundleId], targetId: retiring.bundleId, reason: 'synthetic retired' }))
    commit('Held', 50, () => ({ ...f.supersede, precondition: [], newBundle: f.draft('Held') } as Delta), true)
    const result = snapshot(f)
    expect(result.breakdown).toEqual({ added: 1, confirmed: 1, superseded: 1, deprecated: 1, proposed: 1 })
    expect(result.rows).toHaveLength(5)
    expect(result.rows.find(r => r.bucket === 'superseded')?.changes.some(e => e.bucket === 'added')).toBe(true)
    expect(result.rows.find(r => r.bucket === 'confirmed')?.changes).toHaveLength(2)
  })

  it.each(['propose-only', 'validation', 'existing', 'deprecation'] as const)('DOWNGRADE-ORIGIN %s uses recorded disposition', (kind) => {
    const f = commitFixture()
    let delta: Delta = f.supersede
    if (kind === 'validation' && delta.kind === 'Supersede') delta = { ...delta, victimId: asRecordId('missing-victim'), citedIds: [asRecordId('missing-victim')] }
    if (kind === 'deprecation') delta = { kind: 'Deprecate', origin: 'agent', scope: f.add.scope, citedIds: [f.victim.bundleId], targetId: f.victim.bundleId, reason: 'synthetic retirement' }
    const result = commitCurationDelta(kind === 'validation' ? { ...f.deps, profile: { mode: 'drain-to-active' } } : f.deps, f.claimed, f.checkpoint(delta))
    expect(result.kind).toBe('downgraded')
    let run = 'synthetic-run-43'
    if (kind === 'existing') {
      const again = f.job('Purchase', 44)
      expect(commitCurationDelta(f.deps, again, f.checkpoint(delta)).kind).toBe('downgraded')
      run = 'synthetic-run-44'
    }
    const resultSnapshot = snapshot(f, run)
    expect(resultSnapshot.breakdown).toEqual({ added: 0, confirmed: 0, superseded: 0, deprecated: 0, proposed: 1 })
    expect(resultSnapshot.rows[0]?.changes[0]?.change).toMatchObject({ sourceRunId: run, observationId: kind === 'existing' ? 'synthetic-observation-44' : 'synthetic-observation-43', change: kind === 'existing' ? 'confirmed' : 'added' })
  })

  it('RESTART-REFOLD reads surviving receipts after cleanup and preserves exact index bytes', async () => {
    const f = commitFixture()
    commitCurationDelta(f.deps, f.claimed, f.checkpoint(f.supersede))
    expect(existsSync(f.claimed.candidateDir)).toBe(false)
    const before = snapshot(f)
    expect(before.breakdown.proposed).toBe(1)
    const index = readFileSync(join(f.root, 'memory/index/knowledge.db'))
    releaseLease({ knowledgeRoot: f.root, leaseId: f.authority.leaseId })
    expect(snapshot(f)).toEqual(before)
    expect(readFileSync(join(f.root, 'memory/index/knowledge.db')).equals(index)).toBe(true)
  })

  it('PARTIAL-NO-FAKE-ZERO exposes actual published replacement without completed snapshot', async () => {
    const f = commitFixture()
    const original = bundleAppend.appendOutcomeEvent
    vi.spyOn(bundleAppend, 'appendOutcomeEvent').mockImplementation((config, id, event) => event.type === 'superseded' ? { kind: 'not-found' } : original(config, id, event))
    expect(commitCurationDelta({ ...f.deps, profile: { mode: 'drain-to-active' } }, f.claimed, f.checkpoint(f.supersede)).kind).toBe('failed')
    const report = await drainQueue({ knowledgeRoot: f.root, auditBaseDir: f.deps.auditBaseDir, lease: f.authority,
      author: async () => ({ kind: 'fallback-required', reason: 'no-model' }), executionContext: 'ci', policy: f.deps.policy,
      budgetMs: 0, maintenance: 'skip', ...{ sourceRunId: 'synthetic-run-43' } })
    expect(report).toHaveProperty('effects', [expect.objectContaining({ bucket: 'added' })])
    expect(report).not.toHaveProperty('snapshot')
    expect(report.remaining).toBeGreaterThan(0)
  })
})
