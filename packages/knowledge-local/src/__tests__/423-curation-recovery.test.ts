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
  const root = mkdtempSync(join(tmpdir(), '423-curation-recovery-'))
  roots.push(root)
  return root
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

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
  return { root, authority, deps, claimed, supersede, victim, victimJob, add, draft, checkpoint, rows }
}

describe('423 curation effect recovery', () => {
  function reopen(f: ReturnType<typeof commitFixture>) {
    expect(releaseLease({ knowledgeRoot: f.root, leaseId: f.authority.leaseId }).kind).toBe('released')
    const lease = acquireWriterLease(f.root)
    if (lease.kind !== 'acquired') throw new Error('expected successor lease')
    expect(lease.epoch).toBeGreaterThan(f.authority.epoch)
    return { leaseId: lease.leaseId, epoch: lease.epoch }
  }
  function reconcile(f: ReturnType<typeof commitFixture>, authority = f.authority) {
    return reconcileOnDrainStart({ knowledgeRoot: f.root, writerAuthority: authority,
      hasIndexRow: () => true,
      applyIndexDelta: (intent) => applyIndexDeltaForBundleWithinCurrentAuthority({ knowledgeRoot: f.root, bundleId: intent.bundleId }),
      deriveIndexRowFromBundle: (bundleId) => applyIndexDeltaForBundleWithinCurrentAuthority({ knowledgeRoot: f.root, bundleId }),
    })
  }
  function bundleBytes(root: string) {
    return enumerateBundleDirs(root).map(({ dir }) => [dir, readFileSync(join(dir, 'manifest.json'), 'utf8'), readFileSync(join(dir, 'evidence/outcomes.jsonl'), 'utf8')])
  }
  it.each([
    ['CRASH-AFTER-COMMIT', 'afterBundlePublished'],
    ['CRASH-AFTER-RECEIPT', 'afterEffectReceiptsWritten'],
    ['CRASH-BEFORE-OUTER-CHECKPOINT', 'afterIntentCleared'],
  ] as const)('%s recovers identical classification under a newer epoch', (_name, hook) => {
    const f = commitFixture()
    let observation: CurationObservation | undefined
    const crash = () => { throw new Error('synthetic-interruption') }
    expect(() => commitCurationDelta({ ...f.deps, hooks: {
      afterIntentWritten: () => {
        const entry = listCommitIntents(f.root)[0]
        if (entry !== undefined && 'parsed' in entry) observation = entry.parsed.observation
      }, [hook]: crash,
    } }, f.claimed, f.checkpoint(f.supersede))).toThrow('synthetic-interruption')
    expect(observation).toBeDefined()
    const expected = observation!.effects.map((effect) => receiptForEffect(f.claimed.candidateId, observation!, effect))
    const before = bundleBytes(f.root)
    const successor = reopen(f)
    reconcile(f, successor)
    expect(f.rows()).toEqual(expected)
    expect(bundleBytes(f.root)).toEqual(before)
    const receipts = readdirSync(join(f.root, COMPLETED_EFFECTS_SUBDIR)).map((name) => readFileSync(join(f.root, COMPLETED_EFFECTS_SUBDIR, name), 'utf8'))
    reconcile(f, successor)
    expect(f.rows()).toEqual(expected)
    expect(readdirSync(join(f.root, COMPLETED_EFFECTS_SUBDIR)).map((name) => readFileSync(join(f.root, COMPLETED_EFFECTS_SUBDIR, name), 'utf8'))).toEqual(receipts)
  })
  it('CRASH-BEFORE-PUBLICATION contributes no successfully committed row', () => {
    const f = commitFixture()
    expect(() => commitCurationDelta({ ...f.deps, hooks: { beforePublishRename: () => { throw new Error('synthetic-before-publish') } } }, f.claimed, f.checkpoint(f.supersede))).toThrow('synthetic-before-publish')
    reconcile(f, reopen(f))
    expect(f.rows()).toEqual([])
  })
  it('RESTART-REFOLD reads completed effects after candidate state was deleted', () => {
    const f = commitFixture()
    const outcome = commitCurationDelta(f.deps, f.claimed, f.checkpoint(f.supersede))
    expect(outcome.kind).toBe('downgraded')
    expect(readJobState(f.root, f.claimed.candidateId).kind).toBe('absent')
    expect(existsSync(f.claimed.candidateDir)).toBe(false)
    const before = f.rows()
    expect(before).toHaveLength(1)
    reconcile(f, reopen(f))
    expect(f.rows()).toEqual(before)
  })
  it('STALE-EPOCH-EFFECT refuses old writers creating or overwriting receipts', () => {
    const f = commitFixture()
    commitCurationDelta(f.deps, f.claimed, f.checkpoint(f.supersede))
    const row = f.rows()[0]!
    reopen(f)
    const options = { knowledgeRoot: f.root, authority: f.authority, auditBaseDir: f.deps.auditBaseDir, receipt: row }
    expect(() => writeCurationEffectReceipt(options)).toThrow()
    expect(() => writeCurationEffectReceipt({ ...options, receipt: { ...row, sourceRunId: 'foreign' } })).toThrow()
    const newEffect = { recordId: 'fact-new', product: 'storefront', change: 'added' as const, atOrdinal: 44, evidenceToken: 'synthetic-new' }
    expect(() => writeCurationEffectReceipt({ ...options, receipt: { ...row, ...newEffect, effectId: effectIdentity(row.candidateId, newEffect) } })).toThrow()
    expect(f.rows()).toEqual([row])
  })
  it('DOWNGRADE-PROPOSE-ONLY retains original Supersede while ordinary Add stays added', () => {
    const f = commitFixture()
    const before = readFileSync(join(f.victim.bundleDir, 'manifest.json'))
    const outcome = commitCurationDelta(f.deps, f.claimed, f.checkpoint(f.supersede))
    expect(outcome).toMatchObject({ kind: 'downgraded', deltaKind: 'Add', original: f.supersede, reason: 'propose-only' })
    expect(f.rows()).toMatchObject([{ originalDeltaKind: 'Supersede', appliedDeltaKind: 'Add', disposition: 'downgraded', change: 'added' }])
    expect(listCurationEffectReceipts(f.root).filter((r) => r.candidateId === f.victimJob.candidateId)).toMatchObject([{ originalDeltaKind: 'Add', disposition: 'apply', change: 'added' }])
    expect(readFileSync(join(f.victim.bundleDir, 'manifest.json'))).toEqual(before)
  })
  it('DOWNGRADE-VALIDATION retains validation origin without a proposal relation heuristic', () => {
    const f = commitFixture()
    if (f.supersede.kind !== 'Supersede') throw new Error('fixture Supersede')
    const invalid = { ...f.supersede, victimId: asRecordId('missing-victim'), citedIds: [asRecordId('missing-victim')] }
    const outcome = commitCurationDelta({ ...f.deps, profile: { mode: 'drain-to-active' } }, f.claimed, f.checkpoint(invalid))
    expect(outcome).toMatchObject({ kind: 'downgraded', original: invalid })
    expect(f.rows()).toMatchObject([{ originalDeltaKind: 'Supersede', disposition: 'downgraded', downgradeReason: 'cited-id-integrity' }])
  })
  it('DEPRECATE-PROPOSED distinguishes clarification from ordinary MintUnknown', () => {
    const f = commitFixture()
    const delta: Delta = { kind: 'Deprecate', origin: 'agent', scope: f.supersede.scope, citedIds: [f.victim.bundleId], targetId: f.victim.bundleId, reason: 'synthetic-reason' }
    const outcome = commitCurationDelta(f.deps, f.claimed, f.checkpoint(delta))
    expect(outcome).toMatchObject({ kind: 'downgraded', original: delta, deltaKind: 'MintUnknown' })
    expect(f.rows()).toMatchObject([{ originalDeltaKind: 'Deprecate', appliedDeltaKind: 'MintUnknown', disposition: 'downgraded' }])
    const loaded = loadBundle(f.victim.bundleDir)
    expect(loaded.kind === 'loaded' && loaded.bundle.events.some((e) => e.type === 'deprecated')).toBe(false)
  })
  it('COMMIT-PARTIAL-EFFECTS records replacement publication but no refused victim effect', () => {
    const f = commitFixture()
    const original = bundleAppend.appendOutcomeEvent
    vi.spyOn(bundleAppend, 'appendOutcomeEvent').mockImplementation((config, id, event) => event.type === 'superseded' ? { kind: 'not-found' } : original(config, id, event))
    const outcome = commitCurationDelta({ ...f.deps, profile: { mode: 'drain-to-active' } }, f.claimed, f.checkpoint(f.supersede))
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'append-failed' })
    expect(f.rows()).toMatchObject([{ change: 'added', originalDeltaKind: 'Supersede' }])
    expect(f.rows().some((row) => row.recordId === f.victim.bundleId)).toBe(false)
  })
  function receipt() {
    const effect = { recordId: 'fact-fixture', change: 'added' as const, atOrdinal: 42, evidenceToken: 'synthetic-token', product: 'storefront' }
    const candidateId = 'a'.repeat(64)
    return { schemaVersion: 1 as const, candidateId, effectId: effectIdentity(candidateId, effect), ...effect,
      sourceRunId: 'synthetic-run', observationId: 'synthetic-observation', originalDeltaKind: 'Supersede' as const,
      appliedDeltaKind: 'Add' as const, disposition: 'downgraded' as const, downgradeReason: 'propose-only' }
  }
  function writer(root: string) {
    const lease = acquireWriterLease(root)
    if (lease.kind !== 'acquired') throw new Error('fixture requires fresh lease')
    return { leaseId: lease.leaseId, epoch: lease.epoch }
  }
  it('EFFECT-READ-NOTHING reads absence without creating any directory', () => {
    const root = join(temporaryRoot(), 'absent')
    expect(listCurationEffectReceipts(root)).toEqual([])
    expect(existsSync(root)).toBe(false)
  })
  it('EFFECT-RECEIPT-ROUNDTRIP survives intent and done-state cleanup', () => {
    const root = temporaryRoot()
    const authority = writer(root)
    const row = receipt()
    writeCurationEffectReceipt({ knowledgeRoot: root, authority, auditBaseDir: join(root, 'audit'), receipt: row })
    writeCommitIntent(root, { schemaVersion: 1, candidateId: row.candidateId, bundleId: row.recordId, deltaKind: 'Add', epoch: authority.epoch })
    clearCommitIntent(root, row.candidateId)
    writeJobState({ knowledgeRoot: root, authority, candidateId: row.candidateId, lifecycle: 'done' })
    expect(listCurationEffectReceipts(root)).toEqual([row])
    for (const invalid of [{ ...row, schemaVersion: 9 }, { ...row, unexpected: true }, { ...row, candidateId: '../escape' }, { ...row, effectId: 'f'.repeat(64) }]) {
      expect(curationEffectReceiptSchema.safeParse(invalid).success).toBe(false)
    }
  })
  it('EFFECT-IDEMPOTENT keeps exact bytes and refuses conflicting or malformed receipts', () => {
    const root = temporaryRoot()
    const authority = writer(root)
    const row = receipt()
    const options = { knowledgeRoot: root, authority, auditBaseDir: join(root, 'audit'), receipt: row }
    writeCurationEffectReceipt(options)
    const dir = join(root, COMPLETED_EFFECTS_SUBDIR)
    const file = join(dir, readdirSync(dir)[0]!)
    const before = readFileSync(file)
    writeCurationEffectReceipt(options)
    expect(readFileSync(file)).toEqual(before)
    expect(readdirSync(dir)).toHaveLength(1)
    expect(() => writeCurationEffectReceipt({ ...options, receipt: { ...row, sourceRunId: 'foreign' } })).toThrow('conflicting')
    writeFileSync(file, '{"schemaVersion":99}')
    expect(() => listCurationEffectReceipts(root)).toThrow('invalid curation effect receipt')
  })
  it('INTENT-HISTORICAL preserves old intents and versioned original disposition', () => {
    const root = temporaryRoot()
    const legacy = { schemaVersion: 1 as const, candidateId: 'a'.repeat(64), bundleId: 'fixture', deltaKind: 'Add' as const, epoch: 1 }
    writeCommitIntent(root, legacy)
    expect(listCommitIntents(root)).toEqual([{ parsed: legacy }])
    expect(commitIntentSchema.safeParse({ ...legacy, schemaVersion: 99 }).success).toBe(false)
    expect(commitIntentSchema.safeParse({ ...legacy, observation: { schemaVersion: 99 } }).success).toBe(false)
    const observation = { schemaVersion: 1, effects: [], originalDeltaKind: 'Supersede', appliedDeltaKind: 'Add', disposition: 'downgraded', downgradeReason: 'propose-only', sourceRunId: 'synthetic-run', observationId: 'synthetic-observation' }
    const parsed = commitIntentSchema.safeParse({ ...legacy, observation })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data).toEqual({ ...legacy, observation })
  })
})
