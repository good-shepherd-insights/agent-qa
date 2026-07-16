import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BundleOutcomeEventSchema,
  type BundleDiscriminant,
  type BundleDraft,
  type BundleOutcomeEvent,
  type DistilledObservation,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { appendOutcomeEvent } from '../../bundle-append.js'
import { deriveBundleTrust, loadBundle } from '../../bundle-read.js'
import {
  publishBundle,
  type BundleStoreConfig,
  type PublishBundleInput,
} from '../../bundle-publish.js'
import { openIndexReaderConnection } from '../../index-open.js'
import {
  createLocalKnowledgeStore,
  type CreateLocalKnowledgeStoreConfig,
} from '../knowledge-store.js'

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

describe('KnowledgePort promote deterministic gate (PROM-01/D-17)', () => {
  let root: string
  let knowledgeRoot: string
  let auditBaseDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-store-promote-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    auditBaseDir = join(root, '.agent-qa')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function bundleConfig(): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey: 'storefront',
      auditBaseDir,
      commitArtifacts: 'none',
      writerLeaseId: 'knowledge-store-test',
    }
  }

  function confirmedEvent(suffix: string, buildOrdinal = 42): BundleOutcomeEvent {
    return BundleOutcomeEventSchema.parse({
      type: 'confirmed',
      evidenceToken: `confirmed-${suffix}`,
      curationJobId: `confirmed-${suffix}-job`,
      buildOrdinal,
      origin: 'agent-verified',
    })
  }

  function seedCandidate(options: {
    kind?: 'fact' | 'procedure'
    confirmed?: boolean
    withheld?: boolean
    observations?: readonly DistilledObservation[]
  } = {}) {
    const kind = options.kind ?? 'fact'
    const draft: BundleDraft = kind === 'fact'
      ? {
          kind,
          subtype: 'selector',
          anchors: FACT_ANCHORS,
          scope: { tier: 'product', key: 'storefront' },
          summary: 'Checkout button selector',
          body: 'The checkout button was resolved and verified.',
          distilledEvidenceRef: { id: 'checkout-evidence', sha: 'a'.repeat(64) },
          originStage: 'run-curation',
        }
      : {
          kind,
          anchors: [
            { t: 'flow', name: 'Checkout flow' },
            { t: 'page', route: '/checkout' },
          ],
          scope: { tier: 'product', key: 'storefront' },
          summary: 'Complete checkout',
          body: 'Open the cart and activate checkout.',
          distilledEvidenceRef: { id: 'checkout-procedure-evidence', sha: 'b'.repeat(64) },
          originStage: 'run-curation',
        }
    const discriminant: BundleDiscriminant = kind === 'fact'
      ? {
          kind,
          subtype: 'selector',
          elementRef: { role: 'button', name: 'Checkout' },
        }
      : { kind, flowName: 'Checkout flow', stepSignature: 'cart>checkout' }
    const input: PublishBundleInput = {
      draft,
      discriminant,
      originClass: 'agent-verified',
      createdAtOrdinal: 42,
      screenStates: [],
      initialEvents: options.confirmed === false ? [] : [confirmedEvent(kind)],
      relations: [],
      provenance: {
        mode: 'run-linked',
        runId: 'promote-run',
        testId: 'promote-test',
        stepIndex: 0,
        curationJobId: 'seed-candidate',
        sourceBuildOrdinal: 42,
        ...(options.withheld === true ? { withheld: true } : {}),
      },
      artifacts: [],
      evidenceMarkdown: 'Deterministically observed during checkout.\n',
      distilledObservations: options.observations
        ?? (kind === 'fact' ? [ELEMENT_OBSERVATION] : []),
    }
    const published = publishBundle(bundleConfig(), input)
    if (published.kind !== 'published') {
      throw new Error(`expected candidate publish, got ${published.kind}`)
    }
    return published
  }

  function storeConfig(
    overrides: Partial<CreateLocalKnowledgeStoreConfig> = {},
  ): CreateLocalKnowledgeStoreConfig {
    return {
      knowledgeRoot,
      auditBaseDir,
      executionContext: 'local-interactive',
      sourceBuildOrdinal: 43,
      ...overrides,
    }
  }

  function loadedTrust(bundleDir: string) {
    const loaded = loadBundle(bundleDir)
    if (loaded.kind !== 'loaded') throw new Error(`expected loaded bundle, got ${loaded.kind}`)
    return { bundle: loaded.bundle, trust: deriveBundleTrust(loaded.bundle) }
  }

  it('promotes after later durable evidence completes the same gate and re-projects active', async () => {
    const published = seedCandidate({ confirmed: false })
    const store = createLocalKnowledgeStore(storeConfig())

    await expect(store.promote(published.id)).rejects.toMatchObject({
      name: 'KnowledgePromotionError',
      reason: 'no-confirmed-evidence',
    })
    expect(loadedTrust(published.dir).trust.status).toBe('candidate')

    expect(
      appendOutcomeEvent(bundleConfig(), published.id, confirmedEvent('later', 43)),
    ).toEqual({ kind: 'appended' })

    await store.promote(published.id)

    const loaded = loadedTrust(published.dir)
    expect(loaded.trust.status).toBe('active')
    expect(loaded.bundle.events.filter(({ type }) => type === 'promoted')).toHaveLength(1)
    const reader = openIndexReaderConnection(knowledgeRoot)
    try {
      expect(
        reader.db.prepare('SELECT status FROM records WHERE bundle_id = ?').get(published.id),
      ).toMatchObject({ status: 'active' })
    } finally {
      reader.db.close()
    }
  })

  it.each([
    {
      label: 'withheld provenance',
      options: { withheld: true },
      reason: 'withheld',
    },
    {
      label: 'procedure kind',
      options: { kind: 'procedure' as const },
      reason: 'kind-excluded',
    },
    {
      label: 'missing element observation',
      options: { observations: [] },
      reason: 'no-element-observation',
    },
  ])('never bypasses the gate for $label', async ({ options, reason }) => {
    const published = seedCandidate(options)
    const store = createLocalKnowledgeStore(storeConfig())

    await expect(store.promote(published.id)).rejects.toMatchObject({
      name: 'KnowledgePromotionError',
      reason,
    })

    const loaded = loadedTrust(published.dir)
    expect(loaded.trust.status).toBe('candidate')
    expect(loaded.bundle.events.filter(({ type }) => type === 'promoted')).toHaveLength(0)
  })

  it('re-evaluates propose-only posture at call time and refuses regardless of evidence', async () => {
    const published = seedCandidate()
    const config = storeConfig()
    const store = createLocalKnowledgeStore(config)
    config.executionContext = 'ci'

    await expect(store.promote(published.id)).rejects.toMatchObject({
      name: 'KnowledgePromotionError',
      reason: 'propose-only',
    })

    const loaded = loadedTrust(published.dir)
    expect(loaded.trust.status).toBe('candidate')
    expect(loaded.bundle.events.filter(({ type }) => type === 'promoted')).toHaveLength(0)
  })

  it('is an idempotent noop after the first promoted append', async () => {
    const published = seedCandidate()
    const store = createLocalKnowledgeStore(storeConfig())

    await store.promote(published.id)
    await store.promote(published.id)

    const loaded = loadedTrust(published.dir)
    expect(loaded.trust.status).toBe('active')
    expect(loaded.bundle.events.filter(({ type }) => type === 'promoted')).toHaveLength(1)
  })
})
