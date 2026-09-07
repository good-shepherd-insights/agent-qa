import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  deriveBundleTrust,
  drainQueue,
  appendOutcomeEvent,
  appendGateReceipt,
  readGateReceipts,
  listQueuedCandidates,
  loadBundle,
  openKnowledgeReader,
  readCanonicalBundleAnchors,
  rebuildIndex,
  type BundleStoreConfig,
  type CuratorAuthor,
  type PublishBundleInput,
} from '@vostride/agent-qa-knowledge-local'
import { publishBundleForTest as publishBundle } from '@vostride/agent-qa-knowledge-local'
import {
  asEvidenceToken,
  asRecordId,
  asRef,
  asRunId,
  BundleOutcomeEventSchema,
  canonicalJson,
  computeBriefDigest,
  deriveEvidenceToken,
  sha256hex,
  stampReceiptDigest,
  isPromotionReceipt,
  type ResolvePromotionPosture,
  type Anchor,
  type BundleDiscriminant,
  type BundleDraft,
  type CompletedRunHandoff,
  type DistilledObservation,
  type ElementInfo,
  type RecordId,
  type ScreenState,
  type ServedBrief,
  type StepEvidence,
  type SubActionEvidence,
} from '@vostride/agent-qa-schema'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  emitCanaryOutcomes,
  projectCanaryOutcomes,
} from '../index.js'
import { createCanaryAblationForHost } from '../gates/canary-ablation-host.js'

const PRODUCT = 'canary-seam-storefront'
const BUILD_ORDINAL = 43
const POLICY_TEXT = 'GLOBAL POLICY: preserve checkout canary evidence.'
const CANDIDATE_ANCHOR: Anchor = {
  t: 'el',
  role: 'button',
  name: 'Checkout',
  ordinal: 0,
}
const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)

function element(): ElementInfo {
  return {
    ref: asRef('checkout'),
    role: 'button',
    name: 'Checkout',
    nameNormalized: 'checkout',
    bounds: { x: 10, y: 20, width: 100, height: 40 },
    center: { x: 60, y: 40 },
    state: { enabled: true, focused: false, visible: true, clickable: true },
    labels: { ariaLabel: 'Checkout' },
    attributes: { 'data-testid': 'checkout' },
  }
}

function screen(): ScreenState {
  const checkout = element()
  return {
    platform: 'web',
    tree: 'button Checkout',
    elements: [checkout],
    refMap: {
      [checkout.ref]: {
        bounds: checkout.bounds!,
        center: checkout.center!,
      },
    },
    url: '/cart',
    timestamp: 1_750_000_000_000,
    metadata: {
      captureMode: 'textOnly',
      coordSpace: 'viewport',
      viewportWidth: 1_280,
      viewportHeight: 720,
      scroll: {
        offsetX: 0,
        offsetY: 0,
        contentWidth: 1_280,
        contentHeight: 1_440,
      },
    },
  }
}

function exercisedSubAction(): SubActionEvidence {
  const state = screen()
  return {
    plan: 'Click Checkout',
    plannedAction: { type: 'click', ref: asRef('checkout') },
    stateBefore: state,
    stateAfter: state,
    result: { success: true },
  }
}

function servedBrief(candidateId: RecordId, line: ServedBrief['channel1'][number]): ServedBrief {
  const brief: ServedBrief = {
    scope: { tier: 'product', key: PRODUCT },
    asOfBuild: BUILD_ORDINAL,
    budget: 1_000,
    truncation: 'none',
    channel1: [{ ...line, id: candidateId }],
    channel2: [],
    channel3: [],
    briefDigest: '',
  }
  return { ...brief, briefDigest: computeBriefDigest(brief) }
}

function completedHandoff(
  candidateId: RecordId,
  line: ServedBrief['channel1'][number],
): CompletedRunHandoff {
  const step: StepEvidence = {
    stepIndex: 0,
    stepText: 'Click Checkout',
    cacheStatus: 'miss',
    servedBrief: servedBrief(candidateId, line),
    subActions: [exercisedSubAction()],
    verifierVerdict: { pass: true, reasoning: 'Checkout was exercised successfully.' },
  }
  return {
    schemaVersion: 3,
    runId: asRunId('run-canary-seam-live-shape'),
    scope: { tier: 'product', key: PRODUCT },
    buildOrdinal: BUILD_ORDINAL,
    executionContext: 'local-interactive',
    aggregateVerdict: 'passed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1_750_000_000_000,
    endedAt: 1_750_000_001_000,
    tests: [{
      testId: 'checkout::canary-seam',
      testName: 'Checkout canary seam',
      filePath: 'checkout.spec.yaml',
      testIndex: 0,
      outcome: 'passed',
      steps: [step],
    }],
  }
}

function candidateInput(): PublishBundleInput {
  const draft: BundleDraft = {
    kind: 'fact',
    subtype: 'selector',
    anchors: [
      CANDIDATE_ANCHOR,
      { t: 'page', route: '/checkout' },
      { t: 'selector', literal: '[data-testid="checkout"]' },
    ],
    scope: { tier: 'product', key: PRODUCT },
    summary: 'Use the Checkout button to continue from the cart.',
    body: 'The Checkout button was resolved and verified on the cart screen.',
    distilledEvidenceRef: {
      id: 'canary-seam-seed-evidence',
      sha: 'a'.repeat(64),
    },
    originStage: 'run-curation',
  }
  const discriminant: BundleDiscriminant = {
    kind: 'fact',
    subtype: 'selector',
    elementRef: { role: 'button', name: 'Checkout' },
  }
  const observation: DistilledObservation = {
    schemaVersion: 1,
    step: { naturalKey: 'checkout-click', ordinal: 0 },
    platform: 'web',
    element: { naturalKey: 'button:checkout:0' },
    locator: { selector: '[data-testid="checkout"]' },
    observedAtOrdinal: BUILD_ORDINAL - 1,
  }
  return {
    draft,
    discriminant,
    originClass: 'agent-verified',
    createdAtOrdinal: BUILD_ORDINAL - 1,
    screenStates: [],
    initialEvents: [BundleOutcomeEventSchema.parse({
      type: 'confirmed',
      evidenceToken: asEvidenceToken('canary-seam-seed-confirmation'),
      curationJobId: 'canary-seam-seed-confirmation',
      buildOrdinal: BUILD_ORDINAL - 1,
      origin: 'agent-verified',
    })],
    relations: [],
    provenance: {
      mode: 'run-linked',
      runId: 'run-canary-seam-seed',
      testId: 'test-canary-seam-seed',
      stepIndex: 0,
      curationJobId: 'seed-canary-seam-candidate',
      sourceBuildOrdinal: BUILD_ORDINAL - 1,
    },
    artifacts: [],
    evidenceMarkdown: 'Deterministically observed during checkout.\n',
    distilledObservations: [observation],
  }
}

function expectedCanaryEvidenceToken(
  outcome: ReturnType<typeof projectCanaryOutcomes>[number],
): string {
  const attributingObservationId = `canary-outcome:${sha256hex(canonicalJson({
    candidateId: outcome.candidateId,
    runId: outcome.runId,
    testId: outcome.testId,
    testIndex: outcome.testIndex,
    stepIndex: outcome.stepIndex,
  }))}`
  return deriveEvidenceToken({
    attributingObservationId,
    anchor: outcome.exercisedAnchor,
    buildOrdinal: outcome.buildOrdinal,
  })
}


const DIGEST = 'c'.repeat(64)
const bound: ResolvePromotionPosture = () => ({
  kind: 'resolved', replayGateAvailable: true, gateSetNonEmpty: true, gateSetVerdict: 'ok',
  corpusDigest: DIGEST, minimumGateSet: 1,
  counts: { natural: 1, heldOutShared: 1, heldOutPrivate: 0, adversarial: 0, excludedCount: 0 },
  scope: { partition: PRODUCT, resolution: 'product-key' },
  judge: { capable: true, reason: 'eligible' },
  canary: { kind: 'not-provided', rarePathEligible: false },
})
describe('418 credited canary Gate-2 seam', () => {
  const roots: string[] = []
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
  it.each(['eval-bound', 'no-credit', 'no-root-stale'] as const)
    ('418 negative %s preserves v51 outcome bytes through credit, queue and drain', async mode => {
      const root = mkdtempSync(join(tmpdir(), 'agent-qa-negative-seam-'))
      roots.push(root)
      const knowledgeRoot = join(root, 'knowledge')
      const auditBaseDir = join(root, '.agent-qa')
      const runDir = join(root, 'run')
      mkdirSync(runDir, { recursive: true })
      const config: BundleStoreConfig = { knowledgeRoot, auditBaseDir, productKey: PRODUCT,
        writerLeaseId: 'negative-seed', commitArtifacts: 'none', policy }
      const published = publishBundle(config, { ...candidateInput(),
        screenStates: [{ ...screen(), url: mode === 'no-root-stale'
          ? 'https://fixture.invalid/earlier-cart' : 'https://fixture.invalid/cart' }] })
      if (published.kind !== 'published') throw new Error(published.kind)
      const score = { baseline: 0.5, candidate: 0.8, delta: 0.3, floor: 0.1, n: 10 }
      if (mode === 'eval-bound') expect(appendGateReceipt(config, published.id, stampReceiptDigest({
        schemaVersion: 1, gate: 1, candidateId: published.id, verdict: 'pass',
        producedAtOrdinal: BUILD_ORDINAL - 1, producedBy: { opId: 'fixture' },
        perAxisScore: { headline: score, elementIdentity: score, value: score, opClass: score, sideEffect: score, loop: score },
        corpusVersion: { corpusDigest: DIGEST, partitionVersion: 2, gateSetSize: 10, excludedCount: 0, minimumGateSet: 1 },
        samples: { k: 1, seeds: [1], seedHonored: true, modelCalls: 0 }, crossCheck: 'held',
      })).kind).toBe('appended')
      await rebuildIndex({ knowledgeRoot })
      const reader = openKnowledgeReader({ knowledgeRoot, product: PRODUCT, scopeDefaults: { asOfBuild: BUILD_ORDINAL } })
      const line = reader.getRunBrief({ tier: 'product', key: PRODUCT }, 1_000).brief.lines.find(row => row.id === published.id)!
      expect(line).toMatchObject({ servedAsCanary: true })
      const handoff = completedHandoff(published.id, line)
      handoff.aggregateVerdict = 'failed'
      handoff.tests[0].outcome = 'failed'
      handoff.tests[0].steps[0].verifierVerdict = { pass: false, reasoning: 'Fixture attributable regression' }
      handoff.tests[0].steps[0].subActions[0].stateBefore = { ...screen(), url: 'https://fixture.invalid/cart' }
      // No rootCause means the existing deterministic unknown floor: visible negative signal.
      const projected = projectCanaryOutcomes({ handoff, resolveCandidateAnchors: () => ({
        kind: 'resolved', anchors: candidateInput().draft.anchors }) })[0]!
      expect(projected.runOutcome).toBe('negative')
      const beforeBytes = readFileSync(join(published.dir, 'evidence/outcomes.jsonl'), 'utf8')
      const observationId = `canary-outcome:${sha256hex(canonicalJson({ candidateId: published.id,
        runId: projected.runId, testId: projected.testId, testIndex: projected.testIndex, stepIndex: projected.stepIndex }))}`
      const v51Event = { type: 'contradicted', evidenceToken: expectedCanaryEvidenceToken(projected),
        curationJobId: observationId, buildOrdinal: BUILD_ORDINAL, observationOrdinal: projected.stepIndex,
        observationId, origin: 'agent-verified' }
      const configPath = join(root, 'agent-qa.config.yaml')
      writeFileSync(configPath, 'workspace:\n  testMatch: [tests/**/*.yaml]\n  suiteMatch: [suites/**/*.suite.yaml]\n  hooksFile: hooks.yaml\n  envFile: .env\n  secretsFile: .env.secrets.local\nuse:\n  mobile:\n    appState: preserve\n')
      const host = createCanaryAblationForHost({ configPath, agentQaRoot: auditBaseDir })
      const ablate = vi.spyOn(host, 'ablate')
      const corpusDigest = vi.spyOn(host, 'corpusDigest')
      if (mode === 'eval-bound') corpusDigest.mockResolvedValue({ kind: 'digest', corpusDigest: DIGEST })
      const emission = await emitCanaryOutcomes({ handoff, knowledgeRoot, runDir,
        emit: reader.emitCanaryOutcome.bind(reader),
        ...(mode === 'no-credit' ? {} : { credit: { ablation: host } }) })
      expect(emission).toMatchObject({ emitted: 1, refused: 0, unresolved: 0 })
      expect(ablate).not.toHaveBeenCalled()
      if (mode === 'no-root-stale') {
        expect(corpusDigest).toHaveBeenCalledOnce()
        await expect(corpusDigest.mock.results[0]!.value).resolves.toEqual({ kind: 'no-eval-root' })
      }
      const entry = listQueuedCandidates(knowledgeRoot)[0]!
      const payload = JSON.parse(readFileSync(join(knowledgeRoot, 'memory/queue/queued', entry, 'payload.json'), 'utf8'))
      expect(payload).toMatchObject({ schemaVersion: 3, outcome: 'negative',
        benefit: mode === 'no-credit' ? 'rode-along' : 'exercised-harmed',
        stateValidity: mode === 'eval-bound' ? 'valid' : mode === 'no-root-stale' ? 'stale' : 'unknown' })
      if (mode === 'eval-bound') expect(payload.corpusDigest).toBe(DIGEST)
      else expect(payload).not.toHaveProperty('corpusDigest')
      const author = vi.fn<CuratorAuthor>(async () => { throw new Error('negative canary must not call author') })
      expect(await drainQueue({ knowledgeRoot, auditBaseDir, author, executionContext: 'local-interactive',
        policy, maintenance: 'skip', ...(mode === 'eval-bound' ? { resolvePromotionPosture: bound } : {}) }))
        .toMatchObject({ jobsProcessed: 1, committed: 1, failures: 0 })
      expect(author).not.toHaveBeenCalled()
      expect(listQueuedCandidates(knowledgeRoot)).toEqual([])
      expect(readFileSync(join(published.dir, 'evidence/outcomes.jsonl'), 'utf8'))
        .toBe(beforeBytes + canonicalJson(v51Event) + '\n')
      const gate2 = (readGateReceipts(published.dir, published.id) ?? [])
        .filter(row => !isPromotionReceipt(row) && row.gate === 2)
      expect(gate2).toEqual(mode === 'eval-bound' ? [expect.objectContaining({ gate: 2, verdict: 'fail',
        benefit: 'exercised-harmed', stateValidity: 'valid', corpusVersion: { corpusDigest: DIGEST },
        producedAtOrdinal: handoff.buildOrdinal, producedBy: { opId: 'canary.record', jobId: entry },
      })] : [])
    })
  it.each([true, false])('ordered=%s: credit → v3 queue → drain → receipt → gate1+gate2 or hold', async ordered => {
    const root = mkdtempSync(join(tmpdir(), 'agent-qa-gate2-seam-'))
    roots.push(root)
    const knowledgeRoot = join(root, 'knowledge')
    const auditBaseDir = join(root, 'audit')
    const runDir = join(root, 'run')
    mkdirSync(runDir, { recursive: true })
    const config: BundleStoreConfig = { knowledgeRoot, auditBaseDir, productKey: PRODUCT,
      writerLeaseId: 'gate2-seed', commitArtifacts: 'none', policy }
    const published = publishBundle(config, candidateInput())
    if (published.kind !== 'published') throw new Error(published.kind)
    const score = { baseline: 0.5, candidate: 0.8, delta: 0.3, floor: 0.1, n: 10 }
    const gate1 = stampReceiptDigest({
      schemaVersion: 1 as const, gate: 1 as const, candidateId: published.id, verdict: 'pass' as const,
      producedAtOrdinal: ordered ? BUILD_ORDINAL - 1 : BUILD_ORDINAL + 4, producedBy: { opId: 'fixture' },
      perAxisScore: { headline: score, elementIdentity: score, value: score, opClass: score, sideEffect: score, loop: score },
      corpusVersion: { corpusDigest: DIGEST, partitionVersion: 2, gateSetSize: 10, excludedCount: 0, minimumGateSet: 1 },
      samples: { k: 1, seeds: [1], seedHonored: true, modelCalls: 0 }, crossCheck: 'held' as const,
    })
    expect(appendGateReceipt(config, published.id, gate1).kind).toBe('appended')
    await rebuildIndex({ knowledgeRoot })
    const reader = openKnowledgeReader({ knowledgeRoot, product: PRODUCT, scopeDefaults: { asOfBuild: BUILD_ORDINAL } })
    const line = reader.getRunBrief({ tier: 'product', key: PRODUCT }, 1_000).brief.lines.find(row => row.id === published.id)!
    expect(line).toMatchObject({ servedAsCanary: true })
    const handoff = completedHandoff(published.id, line)
    const emit = async () => emitCanaryOutcomes({
      handoff, knowledgeRoot, runDir, emit: reader.emitCanaryOutcome.bind(reader),
      credit: { ablation: {
        isNovel: async () => false, stage: async () => ({ kind: 'no-eval-root' as const }),
        corpusDigest: async () => ({ kind: 'digest', corpusDigest: DIGEST }),
        ablate: async () => ({ kind: 'ablated', crossCheck: 'flipped', corpusDigest: DIGEST,
          k: 3, baseSeed: 11, seeds: [11, 12, 13], seedHonored: true,
          spend: { modelCalls: 5, screens: 5, promptTokens: 0, completionTokens: 0 }, gate2Dir: root }),
      } },
    })
    expect(await emit()).toMatchObject({ emitted: 1, refused: 0, canary: { credited: 1 } })
    const queued = listQueuedCandidates(knowledgeRoot)
    expect(queued).toHaveLength(1)
    const entry = queued[0]!
    const payload = JSON.parse(readFileSync(join(knowledgeRoot, 'memory/queue/queued', entry, 'payload.json'), 'utf8'))
    expect(payload).toMatchObject({ schemaVersion: 3, benefit: 'exercised-benefited', corpusDigest: DIGEST })
    const author = vi.fn<CuratorAuthor>(async () => { throw new Error('no author for canaries') })
    const drain = () => drainQueue({ knowledgeRoot, auditBaseDir, author, executionContext: 'local-interactive',
      policy, resolvePromotionPosture: bound, maintenance: 'skip' })
    const report = await drain()
    expect(report).toMatchObject({ kind: 'drained', jobsProcessed: 1, committed: 1, failures: 0 })
    expect(report.promotions).toEqual([{ candidateId: published.id,
      ...(ordered ? { promotionPath: 'gate1+gate2' } : { promotionHoldReason: 'gate2-receipt-required' }) }])
    expect(listQueuedCandidates(knowledgeRoot)).toEqual([])
    const lines = readGateReceipts(published.dir, published.id)!
    const gate2 = lines.find(row => !isPromotionReceipt(row) && row.gate === 2)!
    expect(gate2).toMatchObject({ gate: 2, verdict: 'pass', producedAtOrdinal: BUILD_ORDINAL,
      producedBy: { jobId: entry, opId: 'canary.record' }, crossCheck: 'flipped',
      samples: { k: 3, seeds: [11, 12, 13], seedHonored: true, modelCalls: 5 }, spend: { modelCalls: 5 } })
    const loaded = loadBundle(published.dir)
    if (loaded.kind !== 'loaded') throw new Error(loaded.kind)
    expect(deriveBundleTrust(loaded.bundle).status).toBe(ordered ? 'active' : 'candidate')
    if (ordered) expect(lines.filter(isPromotionReceipt)).toEqual([expect.objectContaining({
      promotionPath: 'gate1+gate2', citedReceiptDigests: [gate1.receiptDigest, gate2.receiptDigest],
    })])
    const bytes = readFileSync(join(published.dir, 'evidence/gates.jsonl'), 'utf8')
    await emit()
    expect(await drain()).toMatchObject({ jobsProcessed: 1, failures: 0 })
    expect(readFileSync(join(published.dir, 'evidence/gates.jsonl'), 'utf8')).toBe(bytes)
    expect(author).not.toHaveBeenCalled()
  }, 30_000)
})
