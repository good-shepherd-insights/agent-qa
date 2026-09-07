import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  asEvidenceToken,
  asRecordId,
  canonicalJson,
  deriveEvidenceToken,
  evaluatePromotionGate,
  isVettedCandidate,
  isPromotionReceipt,
  stampReceiptDigest,
  type BundleDiscriminant,
  type BundleDraft,
  type CanaryOutcome,
  type DistilledObservation,
} from '@vostride/agent-qa-schema'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  enqueueArtifactFreeCandidateProjection,
} from '../../__tests__/fixtures/curation-candidate-fixture.js'
import { scaffoldKnowledgeRoot } from '../../__tests__/fixtures/bundle-fixture.js'
import { deriveBundleTrust, loadBundle, readGateReceipts } from '../../bundle-read.js'
import {
  publishBundle,
  type BundleStoreConfig,
  type PublishBundleInput,
} from '../../bundle-publish.test-helper.js'
import { buildRetrievalQuery } from '../../query-helper.js'
import { acquireWriterLease, releaseLease } from '../../lease/writer-lease.js'
import { enqueueCanaryOutcome } from '../../queue/canary-queue.js'
import { listQueuedCandidates } from '../../queue/curation-queue.js'
import { readJobState, writeJobState } from '../../queue/job-state.js'
import type { CuratorAuthor } from '../author-contract.js'
import {
  drainQueue,
  type DrainOperations,
} from '../drain.js'
import { canaryOutcomeObservationId } from '../disposition.js'
import { createLocalKnowledgeStore } from '../knowledge-store.js'
import { assemblePromotionGateInput } from '../commit.js'
import { appendOutcomeEvent } from '../../bundle-append.js'
import { rebuildIndex } from '../../index-rebuild.js'
import { openKnowledgeReader } from '../../index-reader.js'
import { completeGate1Receipt, resolvedPromotionPosture } from './fixtures/promotion-floor-fixture.js'

const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)
const FACT_ANCHORS = [
  { t: 'el', role: 'button', name: 'Checkout', ordinal: 0 },
  { t: 'page', route: '/checkout' },
  { t: 'selector', literal: '[data-testid="checkout"]' },
] as const
const ELEMENT_OBSERVATION: DistilledObservation = {
  schemaVersion: 1,
  step: { naturalKey: 'checkout-click', ordinal: 0 },
  platform: 'web',
  element: { naturalKey: 'button:checkout:0' },
  locator: { selector: '[data-testid="checkout"]' },
  observedAtOrdinal: 42,
}

describe('canary outcome deterministic disposition (PROM-02/D-22)', () => {
  let root: string
  let knowledgeRoot: string
  let auditBaseDir: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-canary-disposition-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    auditBaseDir = join(root, '.agent-qa')
    scaffoldKnowledgeRoot(knowledgeRoot)
    const lease = acquireWriterLease(knowledgeRoot)
    if (lease.kind !== 'acquired') throw new Error('expected a fresh writer lease')
    const released = releaseLease({ knowledgeRoot, leaseId: lease.leaseId })
    if (released.kind !== 'released') throw new Error('expected writer lease release')
  })

  /**
   * CR-01: the port bridge can no longer synthesize an identity, so a store handed to a test
   * must hold the genuine published lease. drainQueue acquires its own, which is why beforeEach
   * still leaves the root unheld.
   */
  function portAuthority(): { writerLeaseId: string; epoch: number } {
    const lease = acquireWriterLease(knowledgeRoot)
    if (lease.kind === 'acquired') return { writerLeaseId: lease.leaseId, epoch: lease.epoch }
    if (lease.kind === 'held') {
      return { writerLeaseId: lease.holder.leaseId, epoch: lease.holder.epoch }
    }
    throw new Error('expected writer authority for the knowledge port')
  }

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function bundleConfig(): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey: 'storefront',
      auditBaseDir,
      commitArtifacts: 'none',
      writerLeaseId: 'canary-disposition-test',
      policy,
    }
  }

  function seedCandidate(kind: 'fact' | 'policy' = 'fact') {
    const draft: BundleDraft = {
      kind,
      ...(kind === 'fact' ? { subtype: 'selector' as const } : {}),
      anchors: [...FACT_ANCHORS],
      scope: { tier: 'product', key: 'storefront' },
      summary: kind === 'fact'
        ? 'Checkout button selector'
        : 'Checkout approval policy proposal',
      body: kind === 'fact'
        ? 'The checkout button was resolved and verified.'
        : 'Only approved users may activate checkout.',
      distilledEvidenceRef: {
        id: `${kind}-checkout-evidence`,
        sha: kind === 'fact' ? 'a'.repeat(64) : 'b'.repeat(64),
      },
      originStage: 'run-curation',
    }
    const discriminant: BundleDiscriminant = kind === 'fact'
      ? {
          kind,
          subtype: 'selector',
          elementRef: { role: 'button', name: 'Checkout' },
        }
      : { kind, ruleKey: 'only approved users may activate checkout' }
    const input: PublishBundleInput = {
      draft,
      discriminant,
      originClass: 'agent-verified',
      createdAtOrdinal: 42,
      screenStates: [],
      initialEvents: [],
      relations: [],
      provenance: {
        mode: 'run-linked',
        runId: 'run-canary-seed',
        testId: 'test-canary-seed',
        stepIndex: 0,
        curationJobId: `seed-${kind}-candidate`,
        sourceBuildOrdinal: 42,
      },
      artifacts: [],
      evidenceMarkdown: 'Deterministically observed during checkout.\n',
      distilledObservations: [ELEMENT_OBSERVATION],
    }
    const published = publishBundle(bundleConfig(), input)
    if (published.kind !== 'published') {
      throw new Error(`expected candidate publish, got ${published.kind}`)
    }
    return published
  }

  function outcome(
    candidateId: ReturnType<typeof asRecordId>,
    runOutcome: CanaryOutcome['runOutcome'] = 'positive',
  ): CanaryOutcome {
    return {
      candidateId,
      runOutcome,
      benefit: 'rode-along',
      stateValidity: 'unknown',
      runId: 'run-canary-disposition',
      testId: 'checkout::happy-path',
      testIndex: 0,
      buildOrdinal: 43,
      stepIndex: 2,
      briefDigest: 'brief-digest-canary-disposition',
      attribution: 'The served checkout hypothesis was exercised by the attributed step.',
      exercisedAnchor: FACT_ANCHORS[0],
    }
  }

  function store() {
    return createLocalKnowledgeStore({
      knowledgeRoot,
      auditBaseDir,
      executionContext: 'local-interactive',
      sourceBuildOrdinal: 43,
      sourceRunId: 'run-canary-disposition',
      ...portAuthority(),
      policy,
    })
  }

  function loaded(bundleDir: string) {
    const result = loadBundle(bundleDir)
    if (result.kind !== 'loaded') throw new Error(`expected loaded bundle, got ${result.kind}`)
    return { bundle: result.bundle, trust: deriveBundleTrust(result.bundle) }
  }

  it('commits a positive attributed outcome before promoting with the schema evidence recipe', async () => {
    const published = seedCandidate()
    const attributed = outcome(published.id)

    await store().recordCanaryOutcome(attributed)

    const result = loaded(published.dir)
    const expectedToken = deriveEvidenceToken({
      attributingObservationId: canaryOutcomeObservationId(attributed),
      anchor: attributed.exercisedAnchor,
      buildOrdinal: attributed.buildOrdinal,
    })
    const confirmedIndex = result.bundle.events.findIndex(
      (event) => event.type === 'confirmed' && event.evidenceToken === expectedToken,
    )
    const promotedIndex = result.bundle.events.findIndex((event) => event.type === 'promoted')

    expect(confirmedIndex).toBeGreaterThanOrEqual(0)
    expect(promotedIndex).toBeGreaterThan(confirmedIndex)
    expect(result.trust.status).toBe('active')
    expect(result.trust.counters.confirmed).toBe(1)
  })

  it.each([true, false])('SC3 ordered=%s: keeps credited receipt and reports the gated result without throwing', async ordered => {
    const published = seedCandidate()
    const onPromotionOutcome = vi.fn()
    const port = createLocalKnowledgeStore({ knowledgeRoot, auditBaseDir, policy,
      executionContext: 'local-interactive', sourceBuildOrdinal: 43, sourceJobId: 'fixture-job',
      ...portAuthority(), resolvePromotionPosture: () => resolvedPromotionPosture(), onPromotionOutcome })
    await port.recordGateReceipt(completeGate1Receipt(published.id, { producedAtOrdinal: ordered ? 42 : 48 }))
    const credited: CanaryOutcome = { ...outcome(published.id), benefit: 'exercised-benefited', corpusDigest: 'c'.repeat(64) }
    await expect(port.recordCanaryOutcome(credited)).resolves.toBeUndefined()
    expect(onPromotionOutcome).toHaveBeenLastCalledWith({ candidateId: published.id,
      ...(ordered ? { promotionPath: 'gate1+gate2' } : { promotionHoldReason: 'gate2-receipt-required' }) })
    const before = readFileSync(join(published.dir, 'evidence/gates.jsonl'), 'utf8')
    await port.recordCanaryOutcome(credited)
    expect(readFileSync(join(published.dir, 'evidence/gates.jsonl'), 'utf8')).toBe(before)
    const receipts = readGateReceipts(published.dir, published.id)!
    expect(receipts.filter(line => !isPromotionReceipt(line) && line.gate === 2)).toEqual([
      expect.objectContaining({ gate: 2, verdict: 'pass', producedAtOrdinal: 43,
        producedBy: { jobId: 'fixture-job', opId: 'canary.record' } }),
    ])
  })

  it.each(['rode-along', 'exercised-benefited'] as const)('SC3 %s without digest preserves v51 Confirm and floor bytes', async benefit => {
    const published = seedCandidate()
    const attributed = { ...outcome(published.id), benefit }
    await store().recordCanaryOutcome(attributed)
    const { bundle } = loaded(published.dir)
    expect(bundle.events.filter(event => event.type === 'confirmed')).toEqual([
      expect.objectContaining({ evidenceToken: deriveEvidenceToken({ attributingObservationId: canaryOutcomeObservationId(attributed),
        anchor: attributed.exercisedAnchor, buildOrdinal: attributed.buildOrdinal }), buildOrdinal: 43 }),
    ])
    const receipts = readGateReceipts(published.dir, published.id)!
    expect(receipts).toEqual([expect.objectContaining({ promotionPath: 'deterministic-verdict-floor' })])
    expect(receipts.filter(line => !isPromotionReceipt(line) && line.gate === 2)).toEqual([])
    const bytes = canonicalJson(bundle.events)
    await store().recordCanaryOutcome({ ...attributed, benefit: 'rode-along' })
    expect(canonicalJson(loaded(published.dir).bundle.events)).toBe(bytes)
  })

  it('the canary arm appends its receipt before the one gated routine and never appends a promoted event itself', () => {
    const source = readFileSync(new URL('../knowledge-store.ts', import.meta.url), 'utf8')
    const arm = source.slice(source.indexOf("case 'positive': {"), source.indexOf("case 'negative': {"))
    expect(arm.indexOf('appendGateReceipt(')).toBeGreaterThanOrEqual(0)
    expect(arm.indexOf('appendGateReceipt(')).toBeLessThan(arm.indexOf('promoteWithinCurrentAuthority(outcome.candidateId)'))
    expect(arm).not.toContain("type: 'promoted'")
    expect(arm).not.toContain('evaluatePromotionGate(')
    expect(source.match(/\/\/ 416-DOOR:/g)).toHaveLength(3)
  })

  it('replays the same positive outcome as a trust-preserving no-op', async () => {
    const published = seedCandidate()
    const attributed = outcome(published.id)
    const knowledgeStore = store()

    await knowledgeStore.recordCanaryOutcome(attributed)
    const first = loaded(published.dir)
    const firstEvidence = canonicalJson({
      events: first.bundle.events,
      counters: first.trust.counters,
      trust: first.trust.trust,
      status: first.trust.status,
    })

    await knowledgeStore.recordCanaryOutcome(attributed)
    const replayed = loaded(published.dir)

    expect(canonicalJson({
      events: replayed.bundle.events,
      counters: replayed.trust.counters,
      trust: replayed.trust.trust,
      status: replayed.trust.status,
    })).toBe(firstEvidence)
    expect(replayed.trust.counters.confirmed).toBe(1)
  })

  it('D-22 retains the positive Confirm while a planted replay binding holds promotion', async () => {
    const published = seedCandidate()
    const onPromotionOutcome = vi.fn()
    const gated = createLocalKnowledgeStore({ knowledgeRoot, auditBaseDir,
      executionContext: 'local-interactive', sourceBuildOrdinal: 43,
      ...portAuthority(), policy, resolvePromotionPosture: () => resolvedPromotionPosture(), onPromotionOutcome })
    await gated.recordCanaryOutcome(outcome(published.id))
    const result = loaded(published.dir)
    expect(result.bundle.events.filter(event => event.type === 'confirmed')).toHaveLength(1)
    expect(result.bundle.events.filter(event => event.type === 'promoted')).toHaveLength(0)
    expect(result.trust.status).toBe('candidate')
    expect(onPromotionOutcome).toHaveBeenCalledExactlyOnceWith({ candidateId: published.id, promotionHoldReason: 'gate1-receipt-required' })
  })

  it('appends replay-safe negative evidence through the existing trust disposition', async () => {
    const published = seedCandidate()
    const attributed = outcome(published.id, 'negative')
    const knowledgeStore = store()
    const before = loaded(published.dir)

    await knowledgeStore.recordCanaryOutcome(attributed)
    const first = loaded(published.dir)
    await knowledgeStore.recordCanaryOutcome(attributed)
    const replayed = loaded(published.dir)

    expect(first.trust.counters.contradicted).toBe(1)
    expect(first.trust.trust).toBeLessThan(before.trust.trust)
    expect(first.trust.status).toBe('candidate')
    expect(replayed.trust).toEqual(first.trust)
    expect(replayed.bundle.events).toEqual(first.bundle.events)
  })

  it('418 SC4 stale harm abstains without trust motion, then a different run in the window confirms', async () => {
    const published = seedCandidate()
    const beforeIndexProjection = vi.fn()
    const terminal = vi.fn()
    await rebuildIndex({ knowledgeRoot })
    const port = createLocalKnowledgeStore({ knowledgeRoot, auditBaseDir, policy,
      executionContext: 'local-interactive', ...portAuthority(),
      canaryAuthorityHooks: { beforeIndexProjection }, onCanaryTailWithinCurrentAuthority: terminal })
    // Supply the existing floor evidence so the actual diagnostic reaches Gate 2.
    expect(appendOutcomeEvent(bundleConfig(), published.id, { type: 'confirmed',
      evidenceToken: asEvidenceToken('stale-seed'), curationJobId: 'stale-seed',
      buildOrdinal: 42, origin: 'agent-verified' }).kind).toBe('appended')
    await port.recordGateReceipt(completeGate1Receipt(published.id, { producedAtOrdinal: 42 }))
    const index = openKnowledgeReader(knowledgeRoot)
    expect(index.source).toBe('index')
    const indexBefore = index.getById(published.id)
    index.close()
    const harm: CanaryOutcome = { ...outcome(published.id, 'negative'),
      benefit: 'exercised-harmed', stateValidity: 'stale', corpusDigest: 'c'.repeat(64),
      observedStateDigest: 'd'.repeat(64) }
    const before = loaded(published.dir)
    await port.recordCanaryOutcome(harm)
    expect(loaded(published.dir).trust).toEqual(before.trust)
    expect(loaded(published.dir).bundle.events).toEqual(before.bundle.events)
    expect(beforeIndexProjection).not.toHaveBeenCalled()
    expect(terminal).toHaveBeenCalledOnce()
    const afterIndex = openKnowledgeReader(knowledgeRoot)
    expect(afterIndex.source).toBe('index')
    expect(afterIndex.getById(published.id)).toEqual(indexBefore)
    afterIndex.close()
    const receipts = readGateReceipts(published.dir, published.id)!
    expect(receipts.at(-1)).toMatchObject({ gate: 2, verdict: 'abstain', benefit: 'exercised-harmed',
      stateValidity: 'stale', runId: harm.runId, testIndex: harm.testIndex, stepIndex: harm.stepIndex,
      observedStateDigest: harm.observedStateDigest })
    const current = loaded(published.dir)
    expect(evaluatePromotionGate(assemblePromotionGateInput({ knowledgeRoot,
      bundleDir: published.dir, bundle: current.bundle,
      resolvePromotionPosture: () => resolvedPromotionPosture() })))
      .toMatchObject({ verdict: 'hold', reason: 'gate-abstained' })

    await port.recordCanaryOutcome({ ...harm, testIndex: 1, stepIndex: 3 })
    expect(loaded(published.dir).trust.counters.contradicted).toBe(0)
    expect(beforeIndexProjection).not.toHaveBeenCalled()
    const next = { ...harm, runId: 'run-canary-confirmation', buildOrdinal: 44 }
    await port.recordCanaryOutcome(next)
    expect(loaded(published.dir).trust.counters.contradicted).toBe(1)
    expect(readGateReceipts(published.dir, published.id)!.at(-1))
      .toMatchObject({ gate: 2, verdict: 'fail', runId: next.runId, producedAtOrdinal: 44 })
    expect(beforeIndexProjection).toHaveBeenCalledOnce()
    const bytes = readFileSync(join(published.dir, 'evidence/gates.jsonl'), 'utf8')
    await port.recordCanaryOutcome(next)
    expect(readFileSync(join(published.dir, 'evidence/gates.jsonl'), 'utf8')).toBe(bytes)
    expect(loaded(published.dir).trust.counters.contradicted).toBe(1)
  })

  it.each(['below-open', 'above-close', 'missing-run', 'current-outside'] as const)
    ('418 stale confirmation rejects %s evidence outside the validity/identity contract', async mode => {
      const published = seedCandidate()
      const port = store()
      const openedAtOrdinal = loaded(published.dir).trust.validity.openedAtOrdinal
      if (mode === 'above-close' || mode === 'current-outside') {
        expect(appendOutcomeEvent(bundleConfig(), published.id, { type: 'window-close',
          evidenceToken: asEvidenceToken('close-stale-window'), curationJobId: 'close-stale-window',
          buildOrdinal: 44, closedAtOrdinal: 44 }).kind).toBe('appended')
      }
      await port.recordGateReceipt(stampReceiptDigest({ schemaVersion: 1, gate: 2,
        candidateId: published.id, verdict: 'abstain', benefit: 'exercised-harmed', stateValidity: 'stale',
        producedAtOrdinal: mode === 'below-open' ? openedAtOrdinal - 1 : mode === 'above-close' ? 45 : 43,
        producedBy: { opId: 'canary.record' }, corpusVersion: { corpusDigest: 'c'.repeat(64) },
        attributedObservationId: 'fixture-prior-stale',
        ...(mode === 'missing-run' ? {} : { runId: 'run-prior-stale' }) }))
      await port.recordCanaryOutcome({ ...outcome(published.id, 'negative'),
        benefit: 'exercised-harmed', stateValidity: 'stale', corpusDigest: 'c'.repeat(64),
        buildOrdinal: mode === 'current-outside' ? 45 : 43 })
      expect(loaded(published.dir).trust.counters.contradicted).toBe(0)
      expect(readGateReceipts(published.dir, published.id)!.at(-1)).toMatchObject({ verdict: 'abstain' })
    })

  it.each(['valid', 'unknown'] as const)('418 %s negative contradicts immediately and writes fail', async stateValidity => {
    const published = seedCandidate()
    await store().recordCanaryOutcome({ ...outcome(published.id, 'negative'),
      stateValidity, benefit: 'exercised-harmed', corpusDigest: 'c'.repeat(64) })
    expect(loaded(published.dir).trust.counters.contradicted).toBe(1)
    expect(readGateReceipts(published.dir, published.id)).toEqual([
      expect.objectContaining({ gate: 2, verdict: 'fail', benefit: 'exercised-harmed', stateValidity,
        producedBy: { opId: 'canary.record' }, corpusVersion: { corpusDigest: 'c'.repeat(64) } }),
    ])
  })

  it.each(['unknown', 'stale'] as const)('418 digest-less %s negative keeps the v51 event law without receipt', async stateValidity => {
    const published = seedCandidate()
    await store().recordCanaryOutcome({ ...outcome(published.id, 'negative'),
      stateValidity, benefit: 'exercised-harmed' })
    expect(loaded(published.dir).trust.counters.contradicted).toBe(1)
    expect(readGateReceipts(published.dir, published.id)).toBeUndefined()
  })

  it('persists mixed same-step outcomes from separate tests under distinct identities', async () => {
    const published = seedCandidate()
    const positive = outcome(published.id)
    const negative: CanaryOutcome = {
      ...outcome(published.id, 'negative'),
      testId: 'checkout::declined-card',
      testIndex: 1,
    }
    const positiveObservationId = canaryOutcomeObservationId(positive)
    const negativeObservationId = canaryOutcomeObservationId(negative)

    expect(negative.stepIndex).toBe(positive.stepIndex)
    expect(negativeObservationId).not.toBe(positiveObservationId)

    const positiveEntry = enqueueCanaryOutcome(knowledgeRoot, positive)
    const negativeEntry = enqueueCanaryOutcome(knowledgeRoot, negative)
    expect(negativeEntry.entryId).not.toBe(positiveEntry.entryId)
    expect(listQueuedCandidates(knowledgeRoot)).toHaveLength(2)

    const author = vi.fn<CuratorAuthor>(async () => {
      throw new Error('canary jobs must not invoke the Curator author')
    })
    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author,
      executionContext: 'local-interactive',
      policy,
    })
    const result = loaded(published.dir)
    const positiveToken = deriveEvidenceToken({
      attributingObservationId: positiveObservationId,
      anchor: positive.exercisedAnchor,
      buildOrdinal: positive.buildOrdinal,
    })
    const negativeToken = deriveEvidenceToken({
      attributingObservationId: negativeObservationId,
      anchor: negative.exercisedAnchor,
      buildOrdinal: negative.buildOrdinal,
    })

    expect(report).toMatchObject({
      kind: 'drained',
      jobsProcessed: 2,
      committed: 2,
      failures: 0,
    })
    expect(author).not.toHaveBeenCalled()
    expect(result.bundle.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'confirmed', evidenceToken: positiveToken }),
      expect.objectContaining({ type: 'contradicted', evidenceToken: negativeToken }),
    ]))
    expect(result.trust.counters).toMatchObject({ confirmed: 1, contradicted: 1 })
    expect(listQueuedCandidates(knowledgeRoot)).toEqual([])
  })

  it('drains mixed canary and curation jobs without spending author or query work on canaries', async () => {
    const published = seedCandidate()
    const canary = enqueueCanaryOutcome(knowledgeRoot, outcome(published.id))
    const curation = enqueueArtifactFreeCandidateProjection({
      knowledgeRoot,
      projectionInput: {
        sourceRunId: 'run-mixed-curation',
        scope: { tier: 'product', key: 'storefront' },
        buildOrdinal: 44,
        executionContext: 'local-interactive',
        secretFlagged: false,
        injectionFlagged: false,
        kind: 'fact',
        subtype: 'selector',
        anchors: [{ t: 'el', role: 'button', name: 'Pay now', ordinal: 0 }],
        summarySeed: 'Pay now button selector',
        bodySeed: 'The Pay now button was observed during checkout.',
        distilledObservations: [
          {
            schemaVersion: 1,
            step: { naturalKey: 'pay-now-click', ordinal: 0 },
            platform: 'web',
            element: { naturalKey: 'button:Pay now:0' },
            observedAtOrdinal: 44,
          },
        ],
        evidenceToken: 'mixed-curation-evidence',
        attributingObservationId: 'run-mixed-curation:test-0:step-0',
        emittedAt: '2026-07-18T00:00:00.000Z',
      },
    })
    if (curation.kind !== 'enqueued') throw new Error(`expected curation enqueue, got ${curation.kind}`)

    const author = vi.fn<CuratorAuthor>(async (job) => {
      if (job.candidateId !== curation.candidateId) {
        throw new Error(`canary job ${job.candidateId} reached the author`)
      }
      return { kind: 'fallback-required', reason: 'no-model' }
    })
    const build = vi.fn(buildRetrievalQuery)
    const commit = vi.fn<DrainOperations['commitCurationDelta']>((dependencies, job) => {
      writeJobState({
        knowledgeRoot,
        candidateId: job.candidateId,
        lifecycle: 'done',
        authority: { leaseId: job.leaseId, epoch: dependencies.epoch },
      })
      return {
        kind: 'applied',
        bundleId: asRecordId(`bundle-${job.candidateId}`),
        bundleDir: join(knowledgeRoot, 'memory', 'storefront', 'bundles', job.candidateId),
        deltaKind: 'Add',
      }
    })

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author,
      executionContext: 'local-interactive',
      policy,
      operations: {
        readRebuildRequest: () => ({ present: false }),
        readIndexMaintenanceState: () => ({
          indexAbsent: false,
          pendingEmbeddings: 0,
          renderingEpochStale: false,
          vectorReconciliationOutstanding: false,
        }),
        openKnowledgeReader: () => fakeReader(),
        buildRetrievalQuery: build,
        retrieve: async () => [],
        commitCurationDelta: commit,
      },
    })

    expect(report).toMatchObject({
      kind: 'drained',
      jobsProcessed: 2,
      committed: 2,
      failures: 0,
    })
    expect(author).toHaveBeenCalledOnce()
    expect(author.mock.calls[0]?.[0].candidateId).toBe(curation.candidateId)
    expect(build).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledOnce()
    expect(loaded(published.dir).trust.status).toBe('active')
    expect(readJobState(knowledgeRoot, canary.entryId).kind).toBe('absent')
    expect(listQueuedCandidates(knowledgeRoot)).toEqual([])
  })

  // D-08 wall 1: serving a proposed-but-unapproved rule as a hypothesis is the
  // confused-deputy shape — a rule is either sovereign or it is not yet a rule.
  it('holds a promotion-ready policy candidate at the kind allowlist', () => {
    const otherwisePromotionReady = {
      status: 'candidate' as const,
      validityOpen: true,
      anchors: [
        { t: 'el' as const, role: 'button', name: 'checkout', ordinal: 0 },
        { t: 'page' as const, route: '/checkout' },
      ],
      originClass: 'agent-verified' as const,
      withheld: false,
      needsEnrichment: false,
      evidenceIncomplete: false,
      distilledObservations: [
        { element: { naturalKey: 'button:checkout:0' } },
      ],
      confirmedOutcomeEvidenceTokens: [asEvidenceToken('policy-confirmed-evidence')],
      hasUserDeprecateInLineage: false,
      memoryOffForAnchorGroup: false,
    }

    expect(evaluatePromotionGate({
      ...otherwisePromotionReady,
      kind: 'fact',
      subtype: 'selector',
    })).toEqual({ verdict: 'promote', promotionPath: 'deterministic-verdict-floor', citedReceiptDigests: [] })
    expect(evaluatePromotionGate({
      ...otherwisePromotionReady,
      kind: 'policy',
    })).toEqual({ verdict: 'hold', reason: 'kind-excluded' })
  })

  it('records positive policy evidence without moving the candidate to active', async () => {
    const published = seedCandidate('policy')

    await store().recordCanaryOutcome(outcome(published.id))

    const result = loaded(published.dir)
    expect(result.trust.counters.confirmed).toBe(1)
    expect(result.trust.status).toBe('candidate')
    expect(result.bundle.events.some((event) => event.type === 'promoted')).toBe(false)
  })

  it('excludes policy candidates from the cold-start vetted sub-cap', () => {
    expect(isVettedCandidate({
      kind: 'policy',
      status: 'candidate',
      validityOpen: true,
      anchors: [{ t: 'page', route: '/checkout' }],
      originClass: 'agent-verified',
      withheld: false,
      needsEnrichment: false,
      evidenceIncomplete: false,
      confirmedOutcomeEvidenceTokens: [asEvidenceToken('policy-vetted-evidence')],
      hasUserDeprecateInLineage: false,
      memoryOffForAnchorGroup: false,
    })).toBe(false)
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
