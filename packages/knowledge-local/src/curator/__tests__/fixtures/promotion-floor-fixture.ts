// 2026-09-06, 416 D-06: shared pristine v51 acceptance builders.
import { stampReceiptDigest, type Gate1Receipt, type GateVerdict, type Anchor, type BundleDraft, type DistilledObservation, type ExecutionContext, type ResolvedPromotionGatePosture } from '@vostride/agent-qa-schema'
import { defaultGuardrailPolicyInput, loadGuardrailPolicy } from '@vostride/agent-qa-safety'
import { expect, vi } from 'vitest'
import { createLocalKnowledgeStore, drainQueue, enumerateBundleDirs, loadBundle, type BundleStoreConfig, type CuratorAuthor, type DrainOptions, type LoadedBundle } from '../../../index.js'
import { publishBundle } from '../../../bundle-publish.test-helper.js'
import { enqueueArtifactFreeCandidateProjection, type ArtifactFreeCandidateProjectionInput } from '../../../__tests__/fixtures/curation-candidate-fixture.js'
import { acquireWriterLease } from '../../../lease/writer-lease.js'
const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)
const NO_INDEX_MAINTENANCE = { indexAbsent: false, pendingEmbeddings: 0, renderingEpochStale: false, vectorReconciliationOutstanding: false } as const
export function resolvedPromotionPosture(
  overrides: Partial<ResolvedPromotionGatePosture> = {},
): ResolvedPromotionGatePosture {
  return {
    kind: 'resolved', replayGateAvailable: true, gateSetNonEmpty: true, gateSetVerdict: 'ok',
    corpusDigest: 'c'.repeat(64), minimumGateSet: 1,
    counts: { natural: 1, heldOutShared: 1, heldOutPrivate: 0, adversarial: 0, excludedCount: 0 },
    scope: { partition: 'storefront', resolution: 'product-key' },
    judge: { capable: true, reason: 'eligible' },
    canary: { kind: 'not-provided', rarePathEligible: false },
    ...overrides,
  }
}
// 416-02: additive receipt builder; the pristine v51 builders below stay byte-identical.
export function completeGate1Receipt(
  candidateId: string,
  overrides?: { producedAtOrdinal?: number; corpusDigest?: string; verdict?: GateVerdict },
): Gate1Receipt {
  const score = { baseline: 0.5, candidate: 0.8, delta: 0.3, floor: 0.1, n: 10 }
  return stampReceiptDigest({
    schemaVersion: 1, gate: 1, candidateId, verdict: overrides?.verdict ?? 'pass',
    producedAtOrdinal: overrides?.producedAtOrdinal ?? 44, producedBy: { opId: 'test' },
    perAxisScore: { headline: score, elementIdentity: score, value: score, opClass: score,
      sideEffect: score, loop: score },
    corpusVersion: { corpusDigest: overrides?.corpusDigest ?? 'c'.repeat(64), partitionVersion: 2,
      gateSetSize: 10, excludedCount: 0, minimumGateSet: 1 },
    samples: { k: 1, seeds: [1], seedHonored: true, modelCalls: 0 }, crossCheck: 'held',
  })
}
export function createPromotionFloorFixture({ knowledgeRoot, auditBaseDir }: { knowledgeRoot: string; auditBaseDir: string }) {
  function selectorProjection(
    seed: string,
    overrides: Partial<ArtifactFreeCandidateProjectionInput> = {},
  ): ArtifactFreeCandidateProjectionInput {
    const normalizedName = `checkout ${seed}`
    return {
      sourceRunId: `run-promotion-${seed}`,
      scope: { tier: 'product', key: 'storefront' },
      buildOrdinal: 42,
      executionContext: 'local-interactive',
      secretFlagged: false,
      injectionFlagged: false,
      kind: 'fact',
      subtype: 'selector',
      anchors: [
        { t: 'el', role: 'button', name: `Checkout ${seed}`, ordinal: 0 },
        { t: 'page', route: '/checkout' },
        { t: 'selector', literal: `[data-testid="checkout-${seed}"]` },
      ],
      summarySeed: `Checkout ${seed} selector`,
      bodySeed: `The Checkout ${seed} button was resolved and verified.`,
      distilledObservations: [
        {
          schemaVersion: 1,
          step: { naturalKey: `checkout-${seed}`, ordinal: 0 },
          platform: 'web',
          element: { naturalKey: `button:${normalizedName}:0` },
          locator: { selector: `[data-testid="checkout-${seed}"]` },
          observedAtOrdinal: 42,
        },
      ],
      evidenceToken: `promotion-evidence-${seed}`,
      attributingObservationId: `promotion-observation-${seed}`,
      emittedAt: '2026-07-16T00:00:00.000Z',
      ...overrides,
    }
  }

  function cautionProjection(seed: string): ArtifactFreeCandidateProjectionInput {
    return {
      sourceRunId: `run-promotion-${seed}`,
      scope: { tier: 'product', key: 'storefront' },
      buildOrdinal: 42,
      executionContext: 'local-interactive',
      secretFlagged: false,
      injectionFlagged: false,
      kind: 'caution',
      rootCauseClass: 'timeout',
      anchors: [{ t: 'error', message: 'checkout confirmation timed out' }],
      summarySeed: 'Checkout confirmation can time out',
      bodySeed: 'Retry after the deterministic timeout attribution.',
      distilledObservations: [
        {
          schemaVersion: 1,
          step: { naturalKey: 'checkout-confirmation', ordinal: 0 },
          error: {
            naturalKey: 'checkout confirmation timed out',
            rootCauseClass: 'timeout',
          },
          observedAtOrdinal: 42,
        },
      ],
      evidenceToken: `promotion-evidence-${seed}`,
      attributingObservationId: `promotion-observation-${seed}`,
      emittedAt: '2026-07-16T00:00:00.000Z',
    }
  }

  function enqueue(projection: ArtifactFreeCandidateProjectionInput): string {
    const outcome = enqueueArtifactFreeCandidateProjection({
      knowledgeRoot,
      projectionInput: projection,
    })
    expect(outcome.kind).toBe('enqueued')
    if (outcome.kind !== 'enqueued') {
      throw new Error(`expected enqueued projection, received ${outcome.kind}`)
    }
    return outcome.candidateId
  }

  async function drainWithoutModel(
    projection: ArtifactFreeCandidateProjectionInput,
    executionContext: ExecutionContext = projection.executionContext,
    drainOptions: Partial<DrainOptions> = {},
  ) {
    const candidateId = enqueue(projection)
    // The API requires an author capability, but this fixture binds no model/provider port.
    // Returning `no-model` forces §7.9's deterministic fallback author on every job.
    const author = vi.fn<CuratorAuthor>(async () => ({
      kind: 'fallback-required',
      reason: 'no-model',
    }))
    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author,
      executionContext,
      policy,
      operations: {
        readRebuildRequest: () => ({ present: false }),
        readIndexMaintenanceState: () => NO_INDEX_MAINTENANCE,
        runKnowledgeGc: () => ({
          trimmedRecordIds: [],
          skipped: { unknownRef: 0, withinK: 0, userOrigin: 0, horizon: 0 },
        }),
      },
      ...drainOptions,
    })
    expect(report).toMatchObject({ jobsProcessed: 1, failures: 0 })
    expect(author).toHaveBeenCalledOnce()
    return { candidateId, report }
  }

  function loadedBundles(): Array<{ dir: string; bundle: LoadedBundle }> {
    return enumerateBundleDirs(knowledgeRoot).map(({ dir }) => {
      const loaded = loadBundle(dir)
      if (loaded.kind !== 'loaded') throw new Error(`expected loaded bundle, got ${loaded.kind}`)
      return { dir, bundle: loaded.bundle }
    })
  }

  function onlyBundle(): { dir: string; bundle: LoadedBundle } {
    const bundles = loadedBundles()
    expect(bundles).toHaveLength(1)
    return bundles[0]!
  }

  function publishHeldCandidate(seed: string) {
    const displayName = `Held checkout ${seed}`
    const normalizedName = displayName.toLowerCase()
    const anchors: Anchor[] = [
      { t: 'el', role: 'button', name: displayName, ordinal: 0 },
      { t: 'page', route: '/checkout' },
      { t: 'selector', literal: `[data-testid="held-checkout-${seed}"]` },
    ]
    const observation: DistilledObservation = {
      schemaVersion: 1,
      step: { naturalKey: `held-checkout-${seed}`, ordinal: 0 },
      platform: 'web',
      element: { naturalKey: `button:${normalizedName}:0` },
      locator: { selector: `[data-testid="held-checkout-${seed}"]` },
      observedAtOrdinal: 42,
    }
    const draft: BundleDraft = {
      kind: 'fact',
      subtype: 'selector',
      anchors,
      scope: { tier: 'product', key: 'storefront' },
      summary: `${displayName} selector`,
      body: `The ${displayName} button was resolved and verified.`,
      distilledEvidenceRef: { id: `held-checkout-${seed}`, sha: 'a'.repeat(64) },
      originStage: 'run-curation',
    }
    const published = publishBundle({
      knowledgeRoot,
      productKey: 'storefront',
      auditBaseDir,
      commitArtifacts: 'none',
      writerLeaseId: 'promotion-floor-fixture',
    }, {
      draft,
      discriminant: {
        kind: 'fact',
        subtype: 'selector',
        elementRef: { role: 'button', name: displayName },
      },
      originClass: 'agent-verified',
      createdAtOrdinal: 42,
      screenStates: [],
      initialEvents: [],
      relations: [],
      provenance: {
        mode: 'run-linked',
        runId: `held-checkout-${seed}-run`,
        testId: `held-checkout-${seed}-test`,
        stepIndex: 0,
        curationJobId: `held-checkout-${seed}-seed`,
        sourceBuildOrdinal: 42,
        authorship: {
          path: 'deterministic-fallback',
          executionContext: 'local-interactive',
        },
      },
      artifacts: [],
      evidenceMarkdown: 'Held pending canonical confirmation.\n',
      distilledObservations: [observation],
    })
    if (published.kind !== 'published') {
      throw new Error(`expected held candidate publish, got ${published.kind}`)
    }
    return { draft, published }
  }

  function outcomeAppendConfig(): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey: 'storefront',
      auditBaseDir,
      commitArtifacts: 'none',
      writerLeaseId: 'promotion-floor-fixture',
      policy,
    }
  }

  function promotionStore(sourceBuildOrdinal: number) {
    const lease = acquireWriterLease(knowledgeRoot)
    if (lease.kind !== 'acquired') throw new Error('expected promotion fixture writer lease')
    return createLocalKnowledgeStore({
      knowledgeRoot,
      auditBaseDir,
      executionContext: 'local-interactive',
      epoch: lease.epoch,
      writerLeaseId: lease.leaseId,
      sourceBuildOrdinal,
    })
  }

  function publishHeldCaution(seed: string) {
    const projection = cautionProjection(seed)
    const draft: BundleDraft = {
      kind: 'caution', anchors: projection.anchors,
      scope: projection.scope, summary: projection.summarySeed, body: projection.bodySeed,
      distilledEvidenceRef: { id: `held-caution-${seed}`, sha: 'b'.repeat(64) },
      originStage: 'run-curation',
    }
    const published = publishBundle(outcomeAppendConfig(), {
      draft, discriminant: { kind: 'caution', errorKey: 'checkout confirmation timed out' },
      originClass: 'agent-verified', createdAtOrdinal: 42,
      screenStates: [], initialEvents: [], relations: [],
      provenance: { mode: 'run-linked', runId: `held-caution-${seed}-run`,
        testId: `held-caution-${seed}-test`, stepIndex: 0,
        curationJobId: `held-caution-${seed}-seed`, sourceBuildOrdinal: 42,
        authorship: { path: 'deterministic-fallback', executionContext: 'local-interactive' } },
      artifacts: [], evidenceMarkdown: 'Held pending canonical confirmation.\n',
      distilledObservations: projection.distilledObservations,
    })
    if (published.kind !== 'published') throw new Error(`expected held caution publish, got ${published.kind}`)
    return { draft, published }
  }
  function canaryStore(sourceBuildOrdinal: number, sourceRunId: string) {
    const lease = acquireWriterLease(knowledgeRoot)
    if (lease.kind !== 'acquired') throw new Error('expected canary fixture writer lease')
    return createLocalKnowledgeStore({ knowledgeRoot, auditBaseDir,
      executionContext: 'local-interactive', epoch: lease.epoch, writerLeaseId: lease.leaseId,
      sourceBuildOrdinal, sourceRunId, policy })
  }
  return { selectorProjection, cautionProjection, enqueue, drainWithoutModel, onlyBundle,
    publishHeldCandidate, publishHeldCaution, outcomeAppendConfig, promotionStore, canaryStore }
}
