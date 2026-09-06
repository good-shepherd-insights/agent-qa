import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asEvidenceToken, asRecordId, stampReceiptDigest, type GateReceipt, type ResolvePromotionPosture, type ResolvedPromotionGatePosture } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveBundleTrust, readGateReceipts } from '../../bundle-read.js'
import { acquireWriterLease } from '../../lease/writer-lease.js'
import { createLocalKnowledgeStore, type CreateLocalKnowledgeStoreConfig } from '../knowledge-store.js'
import { completeGate1Receipt, createPromotionFloorFixture } from './fixtures/promotion-floor-fixture.js'

const posture: ResolvedPromotionGatePosture = {
  kind: 'resolved', replayGateAvailable: true, gateSetNonEmpty: true, gateSetVerdict: 'ok',
  corpusDigest: 'c'.repeat(64), minimumGateSet: 1,
  counts: { natural: 1, heldOutShared: 1, heldOutPrivate: 0, adversarial: 0, excludedCount: 0 },
  scope: { partition: 'storefront', resolution: 'product-key' },
  judge: { capable: true, reason: 'eligible' },
  canary: { kind: 'not-provided', rarePathEligible: false },
}

describe('416 promotion receipt writer contract', () => {
  let root: string
  let fixture: ReturnType<typeof createPromotionFloorFixture>
  let config: CreateLocalKnowledgeStoreConfig
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), '416-promotion-idempotency-'))
    const knowledgeRoot = join(root, 'knowledge')
    const auditBaseDir = join(root, 'audit')
    fixture = createPromotionFloorFixture({ knowledgeRoot, auditBaseDir })
    const lease = acquireWriterLease(knowledgeRoot)
    if (lease.kind !== 'acquired') throw new Error('expected writer lease')
    config = { knowledgeRoot, auditBaseDir, executionContext: 'local-interactive',
      epoch: lease.epoch, writerLeaseId: lease.leaseId, sourceBuildOrdinal: 46 }
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))
  async function confirmed(resolvePromotionPosture?: ResolvePromotionPosture) {
    const seeded = fixture.publishHeldCandidate('receipt-writer')
    const store = createLocalKnowledgeStore({ ...config, resolvePromotionPosture })
    await store.commit([{ kind: 'Confirm', origin: 'agent', scope: seeded.draft.scope,
      citedIds: [seeded.published.id], targetId: seeded.published.id,
      evidenceToken: asEvidenceToken('receipt-writer-confirm'),
      authorship: { path: 'deterministic-fallback', executionContext: 'local-interactive' } }])
    return { ...seeded, store }
  }
  function gate2(candidateId: string) {
    return stampReceiptDigest({ schemaVersion: 1, gate: 2, candidateId, verdict: 'pass',
      producedAtOrdinal: 45, producedBy: { opId: 'test' },
      corpusVersion: { corpusDigest: 'c'.repeat(64) },
      attributedObservationId: 'receipt-writer-canary', benefit: 'exercised-benefited', stateValidity: 'valid' })
  }
  it('D-14 records identical receipts as appended then duplicate', async () => {
    const { published, store } = await confirmed()
    const receipt = completeGate1Receipt(published.id)
    expect(await store.recordGateReceipt(receipt)).toEqual({ kind: 'appended' })
    expect(await store.recordGateReceipt(receipt)).toEqual({ kind: 'duplicate' })
    expect(readGateReceipts(published.dir, published.id)).toEqual([receipt])
    expect(fixture.onlyBundle().bundle.events.filter(event => event.type === 'promoted')).toHaveLength(0)
  })
  it('D-07 repeats floor promotion with exactly one event and promotion receipt', async () => {
    const { published, store } = await confirmed()
    expect(await store.promote(published.id)).toEqual({ kind: 'promoted',
      promotionPath: 'deterministic-verdict-floor', citedReceiptDigests: [] })
    const trust = deriveBundleTrust(fixture.onlyBundle().bundle)
    expect(await store.promote(published.id)).toEqual({ kind: 'already-active',
      promotionPath: 'deterministic-verdict-floor' })
    expect(readGateReceipts(published.dir, published.id)).toHaveLength(1)
    expect(fixture.onlyBundle().bundle.events.filter(event => event.type === 'promoted')).toHaveLength(1)
    expect(deriveBundleTrust(fixture.onlyBundle().bundle)).toEqual(trust)
  })
  it('D-07 upgrades an active floor path using the supplied receipt batch once', async () => {
    const { published, store } = await confirmed()
    await store.promote(published.id)
    const trust = deriveBundleTrust(fixture.onlyBundle().bundle)
    const events = readFileSync(join(published.dir, 'evidence/outcomes.jsonl'), 'utf8')
    const receipts: GateReceipt[] = [completeGate1Receipt(published.id), gate2(published.id)]
    const resolver = vi.fn<ResolvePromotionPosture>(() => posture)
    const reports = vi.fn()
    const gated = createLocalKnowledgeStore({ ...config, resolvePromotionPosture: resolver, onPromotionOutcome: reports })
    expect(await gated.promote(published.id, receipts)).toEqual({ kind: 'already-active', promotionPath: 'gate1+gate2' })
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(reports).toHaveBeenLastCalledWith({ candidateId: published.id, promotionPath: 'gate1+gate2' })
    expect(readGateReceipts(published.dir, published.id)).toHaveLength(4)
    expect(readGateReceipts(published.dir, published.id)!.at(-1)).toMatchObject({ kind: 'promotion',
      promotionPath: 'gate1+gate2', citedReceiptDigests: receipts.map(receipt => receipt.receiptDigest) })
    expect(await gated.promote(published.id, receipts)).toEqual({ kind: 'already-active', promotionPath: 'gate1+gate2' })
    expect(readGateReceipts(published.dir, published.id)).toHaveLength(4)
    expect(readFileSync(join(published.dir, 'evidence/outcomes.jsonl'), 'utf8')).toBe(events)
    expect(deriveBundleTrust(fixture.onlyBundle().bundle)).toEqual(trust)
    expect(trust.status).toBe('active')
    expect(fixture.onlyBundle().bundle.events.filter(event => event.type === 'promoted')).toHaveLength(1)
  })
  it.each(['digest', 'candidate'] as const)('refuses a later invalid %s before any supplied receipt lands', async defect => {
    const { published, store } = await confirmed()
    const valid = completeGate1Receipt(published.id)
    const invalid = defect === 'digest'
      ? { ...gate2(published.id), receiptDigest: 'f'.repeat(64) }
      : completeGate1Receipt('foreign-candidate')
    const manifest = readFileSync(join(published.dir, 'manifest.json'), 'utf8')
    const events = readFileSync(join(published.dir, 'evidence/outcomes.jsonl'), 'utf8')
    await expect(store.promote(published.id, [valid, invalid])).rejects.toThrow(TypeError)
    expect(readGateReceipts(published.dir, published.id)).toBeUndefined()
    expect(readFileSync(join(published.dir, 'manifest.json'), 'utf8')).toBe(manifest)
    expect(readFileSync(join(published.dir, 'evidence/outcomes.jsonl'), 'utf8')).toBe(events)
  })
  it('refuses an unknown record and a tampered standalone receipt', async () => {
    const { published, store } = await confirmed()
    await expect(store.recordGateReceipt(completeGate1Receipt(asRecordId('missing'))))
      .rejects.toMatchObject({ name: 'KnowledgePromotionError', reason: 'not-found' })
    await expect(store.recordGateReceipt({ ...completeGate1Receipt(published.id), receiptDigest: 'f'.repeat(64) }))
      .rejects.toThrow(TypeError)
    expect(readGateReceipts(published.dir, published.id)).toBeUndefined()
  })
  it('reports a bound gate hold without promoting the confirmed candidate', async () => {
    const { published } = await confirmed()
    const reports = vi.fn()
    const store = createLocalKnowledgeStore({ ...config, resolvePromotionPosture: () => posture, onPromotionOutcome: reports })
    await expect(store.promote(published.id)).rejects.toMatchObject({ name: 'KnowledgePromotionError', reason: 'gate1-receipt-required' })
    expect(reports).toHaveBeenCalledExactlyOnceWith({ candidateId: published.id, promotionHoldReason: 'gate1-receipt-required' })
    expect(deriveBundleTrust(fixture.onlyBundle().bundle).status).toBe('candidate')
    expect(readGateReceipts(published.dir, published.id)).toBeUndefined()
  })
})
