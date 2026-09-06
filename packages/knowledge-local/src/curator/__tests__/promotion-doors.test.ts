import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  asEvidenceToken,
  isPromotionReceipt,
  stampReceiptDigest,
  type CanaryOutcome,
  type ResolvePromotionPosture,
} from '@vostride/agent-qa-schema'
import { defaultGuardrailPolicyInput, loadGuardrailPolicy } from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deriveBundleTrust, readGateReceipts } from '../../bundle-read.js'
import { acquireWriterLease } from '../../lease/writer-lease.js'
import { enqueueCanaryOutcome } from '../../queue/canary-queue.js'
import { applyReview } from '../../review/apply-review.js'
import { proposeReview } from '../../review/propose-review.js'
import { drainQueue } from '../drain.js'
import * as knowledgeStore from '../knowledge-store.js'
import { completeGate1Receipt, createPromotionFloorFixture, resolvedPromotionPosture } from './fixtures/promotion-floor-fixture.js'

const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)
const bound: ResolvePromotionPosture = () => resolvedPromotionPosture()
const unavailable: ResolvePromotionPosture = () => ({
  kind: 'unavailable', replayGateAvailable: false, refusals: ['corpus.json: refused'],
})

describe('416 promotion doors share receipt authority', () => {
  let root: string
  let knowledgeRoot: string
  let auditBaseDir: string
  let fixture: ReturnType<typeof createPromotionFloorFixture>
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), '416-promotion-doors-'))
    knowledgeRoot = join(root, 'knowledge')
    auditBaseDir = join(root, 'audit')
    fixture = createPromotionFloorFixture({ knowledgeRoot, auditBaseDir })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  function store(resolvePromotionPosture?: ResolvePromotionPosture, onPromotionOutcome = vi.fn()) {
    const lease = acquireWriterLease(knowledgeRoot)
    const authority = lease.kind === 'acquired' ? lease : lease.kind === 'held' ? lease.holder : undefined
    if (authority === undefined) throw new Error('expected writer authority')
    return knowledgeStore.createLocalKnowledgeStore({
      knowledgeRoot, auditBaseDir, executionContext: 'local-interactive',
      epoch: authority.epoch, writerLeaseId: authority.leaseId, sourceBuildOrdinal: 46,
      ...(resolvePromotionPosture === undefined ? {} : { resolvePromotionPosture }),
      onPromotionOutcome,
    })
  }

  async function confirmed(resolvePromotionPosture?: ResolvePromotionPosture) {
    const seeded = fixture.publishHeldCandidate('door')
    const port = store(resolvePromotionPosture)
    await port.commit([{ kind: 'Confirm', origin: 'agent', scope: seeded.draft.scope,
      citedIds: [seeded.published.id], targetId: seeded.published.id,
      evidenceToken: asEvidenceToken('door-confirm'),
      authorship: { path: 'deterministic-fallback', executionContext: 'local-interactive' } }])
    return { ...seeded, port }
  }

  function positive(seeded: ReturnType<typeof fixture.publishHeldCandidate>): CanaryOutcome {
    return { candidateId: seeded.published.id, runOutcome: 'positive', runId: 'door-canary',
      testId: 'checkout', testIndex: 0, stepIndex: 0, buildOrdinal: 46,
      briefDigest: 'door-brief', attribution: 'The served selector was exercised.',
      exercisedAnchor: seeded.draft.anchors[0]! }
  }

  function assertPromotionLast() {
    const { dir, bundle } = fixture.onlyBundle()
    const promoted = bundle.events.filter(event => event.type === 'promoted')
    const lines = readGateReceipts(dir, bundle.manifest.id) ?? []
    expect(promoted).toHaveLength(1)
    expect(lines.filter(isPromotionReceipt)).toHaveLength(1)
    const last = lines.at(-1)!
    expect(isPromotionReceipt(last)).toBe(true)
    expect(promoted[0]!.buildOrdinal).toBeLessThanOrEqual(last.producedAtOrdinal)
    expect(JSON.parse(readFileSync(join(dir, 'evidence/gates.jsonl'), 'utf8').trim().split('\n').at(-1)!)).toEqual(last)
    expect(deriveBundleTrust(bundle).status).toBe('active')
    return last
  }

  it('D-10 door 3 holds gate1-receipt-required with a planted binding', async () => {
    const { candidateId, report } = await fixture.drainWithoutModel(fixture.selectorProjection('bound'), undefined, { resolvePromotionPosture: bound })
    expect(report.promotions).toEqual([{ candidateId, promotionHoldReason: 'gate1-receipt-required' }])
    expect(deriveBundleTrust(fixture.onlyBundle().bundle).status).toBe('candidate')
  })

  it('D-10 door 1 throws gate1-receipt-required with a planted binding', async () => {
    const { port, published } = await confirmed(bound)
    await expect(port.promote(published.id)).rejects.toMatchObject({ name: 'KnowledgePromotionError', reason: 'gate1-receipt-required' })
    expect(deriveBundleTrust(fixture.onlyBundle().bundle).status).toBe('candidate')
  })

  it('D-10 door 2 retains Confirm and reports gate1-receipt-required', async () => {
    const seeded = fixture.publishHeldCandidate('canary')
    const reports = vi.fn()
    await expect(store(bound, reports).recordCanaryOutcome(positive(seeded))).resolves.toBeUndefined()
    expect(reports).toHaveBeenCalledExactlyOnceWith({ candidateId: seeded.published.id, promotionHoldReason: 'gate1-receipt-required' })
    const { bundle } = fixture.onlyBundle()
    expect(bundle.events.filter(event => event.type === 'confirmed')).toHaveLength(1)
    expect(bundle.events.filter(event => event.type === 'promoted')).toHaveLength(0)
    expect(deriveBundleTrust(bundle).status).toBe('candidate')
  })

  it('D-10 queued door 2 receives the drain resolver and carries its hold', async () => {
    const seeded = fixture.publishHeldCandidate('queued-canary')
    expect(enqueueCanaryOutcome(knowledgeRoot, positive(seeded)).kind).toBe('enqueued')
    const author = vi.fn(async () => { throw new Error('canary must not call an author') })
    const report = await drainQueue({ knowledgeRoot, auditBaseDir, executionContext: 'local-interactive', policy,
      author, resolvePromotionPosture: bound, maintenance: 'skip' })
    expect(report).toMatchObject({ jobsProcessed: 1, failures: 0 })
    expect(report.promotions).toEqual([{ candidateId: seeded.published.id, promotionHoldReason: 'gate1-receipt-required' }])
    expect(author).not.toHaveBeenCalled()
    expect(deriveBundleTrust(fixture.onlyBundle().bundle).status).toBe('candidate')
  })

  it('D-10 door 2 requires Gate 2 after Gate 1 and promotes via gate1+gate2', async () => {
    const seeded = fixture.publishHeldCandidate('paired')
    const reports = vi.fn()
    const port = store(bound, reports)
    const gate1 = completeGate1Receipt(seeded.published.id)
    await port.recordGateReceipt(gate1)
    await port.recordCanaryOutcome(positive(seeded))
    expect(reports).toHaveBeenLastCalledWith({ candidateId: seeded.published.id, promotionHoldReason: 'gate2-receipt-required' })
    expect(deriveBundleTrust(fixture.onlyBundle().bundle).status).toBe('candidate')
    const gate2 = stampReceiptDigest({ schemaVersion: 1, gate: 2, candidateId: seeded.published.id,
      verdict: 'pass', producedAtOrdinal: gate1.producedAtOrdinal, producedBy: { opId: 'test' },
      corpusVersion: { corpusDigest: 'c'.repeat(64) }, attributedObservationId: 'door-canary',
      benefit: 'exercised-benefited', stateValidity: 'valid' })
    await port.recordGateReceipt(gate2)
    await port.recordCanaryOutcome(positive(seeded))
    expect(reports).toHaveBeenLastCalledWith({ candidateId: seeded.published.id, promotionPath: 'gate1+gate2' })
    expect(assertPromotionLast()).toMatchObject({ promotionPath: 'gate1+gate2', citedReceiptDigests: [gate1.receiptDigest, gate2.receiptDigest] })
  })

  it('D-12 unavailable posture holds at doors 1, 2 and 3', async () => {
    const { candidateId, report } = await fixture.drainWithoutModel(fixture.selectorProjection('unavailable'), undefined, { resolvePromotionPosture: unavailable })
    expect(report.promotions).toEqual([{ candidateId, promotionHoldReason: 'posture-unavailable' }])
    const { bundle } = fixture.onlyBundle()
    const reports = vi.fn()
    const port = store(unavailable, reports)
    await expect(port.promote(bundle.manifest.id)).rejects.toMatchObject({ reason: 'posture-unavailable' })
    await port.recordCanaryOutcome({ candidateId: bundle.manifest.id, runOutcome: 'positive', runId: 'unavailable-canary',
      testId: 'checkout', testIndex: 0, stepIndex: 0, buildOrdinal: 46, briefDigest: 'unavailable',
      attribution: 'Exercised selector', exercisedAnchor: fixture.selectorProjection('unavailable').anchors[0]! })
    expect(reports).toHaveBeenLastCalledWith({ candidateId: bundle.manifest.id, promotionHoldReason: 'posture-unavailable' })
    expect(deriveBundleTrust(fixture.onlyBundle().bundle).status).toBe('candidate')
  })

  async function assertPostureHold(reason: 'unprovenanced-candidate' | 'empty-gate-set') {
    const resolver: ResolvePromotionPosture = () => resolvedPromotionPosture({
      gateSetNonEmpty: false, gateSetVerdict: reason,
    })
    const { candidateId, report } = await fixture.drainWithoutModel(fixture.selectorProjection(reason), undefined, { resolvePromotionPosture: resolver })
    expect(report.promotions).toEqual([{ candidateId, promotionHoldReason: reason }])
    await expect(store(resolver).promote(fixture.onlyBundle().bundle.manifest.id)).rejects.toMatchObject({ reason })
  }

  it('D-16 doors 1 and 3 name unprovenanced-candidate before empty-gate-set', async () => {
    await assertPostureHold('unprovenanced-candidate')
  })

  it('D-16 doors 1 and 3 name empty-gate-set', async () => {
    await assertPostureHold('empty-gate-set')
  })

  it('D-12 absent resolver promotes door 3 via the floor and records the job identity', async () => {
    const { candidateId, report } = await fixture.drainWithoutModel(fixture.selectorProjection('floor'))
    expect(report.promotions).toEqual([{ candidateId, promotionPath: 'deterministic-verdict-floor' }])
    expect(assertPromotionLast()).toMatchObject({ promotionPath: 'deterministic-verdict-floor', producedBy: { jobId: candidateId } })
  })

  it('SC5 re-drain preserves one active transition, one event and one promotion line', async () => {
    const projection = fixture.selectorProjection('redrain')
    await fixture.drainWithoutModel(projection)
    const first = fixture.onlyBundle()
    const trust = deriveBundleTrust(first.bundle)
    const bytes = readFileSync(join(first.dir, 'evidence/outcomes.jsonl'), 'utf8')
    const { report } = await fixture.drainWithoutModel(projection)
    expect(report.promotions?.some(outcome => outcome.promotionPath !== undefined)).toBe(false)
    expect(report.noops).toBe(1)
    expect(readFileSync(join(first.dir, 'evidence/outcomes.jsonl'), 'utf8')).toBe(bytes)
    expect(deriveBundleTrust(fixture.onlyBundle().bundle)).toEqual(trust)
    assertPromotionLast()
  })

  it('SC5 drain then explicit door 1 promotion returns already-active with one path', async () => {
    await fixture.drainWithoutModel(fixture.selectorProjection('two-doors'))
    const first = fixture.onlyBundle()
    const trust = deriveBundleTrust(first.bundle)
    await expect(store().promote(first.bundle.manifest.id)).resolves.toEqual({ kind: 'already-active', promotionPath: 'deterministic-verdict-floor' })
    expect(deriveBundleTrust(fixture.onlyBundle().bundle)).toEqual(trust)
    assertPromotionLast()
  })

  it('D-05 door 1 appends the promotion line last after its promoted event', async () => {
    const { port, published } = await confirmed()
    await port.promote(published.id)
    assertPromotionLast()
  })

  it('D-13 apply-review passes its resolver to the in-process store', async () => {
    const seeded = fixture.publishHeldCandidate('review')
    const proposal = proposeReview({ agentQaRoot: auditBaseDir, knowledgeRoot,
      request: { verb: 'accept', input: { target: { grain: 'record', recordId: seeded.published.id } } } })
    if (proposal.kind !== 'proposed') throw new Error('expected review proposal')
    const factory = vi.spyOn(knowledgeStore, 'createLocalKnowledgeStore')
    const resolver = vi.fn(bound)
    await applyReview({ agentQaRoot: auditBaseDir, knowledgeRoot, proposalId: proposal.proposal.proposalId,
      resolvePromotionPosture: resolver })
    expect(factory).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ resolvePromotionPosture: resolver }))
  })

  it('D-13 the store commit bridge forwards its resolver to door 3', async () => {
    const seeded = fixture.publishHeldCandidate('bridge')
    const lease = acquireWriterLease(knowledgeRoot)
    if (lease.kind !== 'acquired') throw new Error('expected writer lease')
    const commit = vi.fn(() => ({ kind: 'noop' as const, reason: 'captured' }))
    const port = knowledgeStore.createLocalKnowledgeStore({ knowledgeRoot, auditBaseDir, executionContext: 'local-interactive',
      writerLeaseId: lease.leaseId, epoch: lease.epoch, resolvePromotionPosture: bound,
      operations: { commitCurationDelta: commit } })
    await port.commit([{ kind: 'Confirm', origin: 'agent', scope: seeded.draft.scope, citedIds: [seeded.published.id],
      targetId: seeded.published.id, evidenceToken: asEvidenceToken('bridge-confirm') }])
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ resolvePromotionPosture: bound }), expect.anything(), expect.anything())
  })
})
