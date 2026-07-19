import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  asRunId,
  BundleOutcomeEventSchema,
  DEFAULT_EMBEDDING_PROFILE,
  canonicalJson,
  type CompletedRunHandoff,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../embedder-acquire.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../embedder-acquire.js')>(),
  acquireEmbedder: async () => ({ kind: 'lexical-only' as const }),
}))

import {
  createAuthoringReader,
  applyRunOutcomes,
  openIndexWriter,
  projectRunOutcomes,
  publishBundle,
  rebuildIndex,
  type BundleStoreConfig,
  type EmbedderPort,
} from '../../index.js'
import { makeBundleDraftFixture } from '../../__tests__/fixtures/bundle-fixture.js'

const PRODUCT = 'dense-authoring-storefront'
const SCOPE = { tier: 'product', key: PRODUCT } as const
const DENSE_ONLY_INTENT = 'semantic-only-orchid'

function unitVector(): Float32Array {
  const vector = new Float32Array(DEFAULT_EMBEDDING_PROFILE.dim)
  vector[0] = 1
  return vector
}

const matchingEmbedder: EmbedderPort = {
  async embedDocument(): Promise<Float32Array> {
    return unitVector()
  },
  async embedQuery(): Promise<Float32Array> {
    return unitVector()
  },
}

describe('createAuthoringReader dense retrieval', () => {
  let root: string
  let knowledgeRoot: string
  let publishedId: string

  beforeEach(async () => {
    root = join(tmpdir(), `authoring-reader-dense-${randomUUID()}`)
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    const store: BundleStoreConfig = {
      knowledgeRoot,
      productKey: PRODUCT,
      auditBaseDir: join(root, '.agent-qa'),
      commitArtifacts: 'none',
      writerLeaseId: 'authoring-reader-dense',
    }
    const outcome = publishBundle(store, {
      draft: makeBundleDraftFixture({
        anchors: [{ t: 'page', route: '/opaque-control' }],
        scope: SCOPE,
        summary: 'Neutral ledger control',
        body: 'Invoking this control performs the recorded action.',
      }),
      discriminant: {
        kind: 'fact',
        subtype: 'selector',
        elementRef: { role: 'Button', name: 'Neutral ledger' },
      },
      originClass: 'agent-verified',
      createdAtOrdinal: 10,
      screenStates: [],
      initialEvents: [BundleOutcomeEventSchema.parse({
        type: 'promoted',
        evidenceToken: 'dense-authoring-promoted',
        curationJobId: 'dense-authoring-job',
        buildOrdinal: 10,
      })],
      relations: [],
      provenance: {
        mode: 'standalone',
        sourceDescription: 'dense authoring reader fixture',
      },
      artifacts: [],
      evidenceMarkdown: 'Dense authoring reader evidence.\n',
    })
    if (outcome.kind !== 'published') {
      throw new Error(`expected publication, got ${outcome.kind}`)
    }
    publishedId = String(outcome.id)
    await rebuildIndex({ knowledgeRoot, embedder: matchingEmbedder })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('admits a token-disjoint fact only through the injected dense leg', async () => {
    const reader = createAuthoringReader(
      { knowledgeRoot, product: PRODUCT },
      { embedder: matchingEmbedder },
    )

    const brief = await reader.getAuthoringBrief(DENSE_ONLY_INTENT, SCOPE)

    expect(brief.facts.map(({ id }) => String(id))).toEqual([publishedId])
  })

  it('keeps the no-embedder lexical floor byte-identical', async () => {
    const reader = createAuthoringReader({ knowledgeRoot, product: PRODUCT })

    const brief = await reader.getAuthoringBrief(DENSE_ONLY_INTENT, SCOPE)

    expect(canonicalJson(brief)).toBe(canonicalJson({
      exemplars: [],
      procedures: [],
      facts: [],
      cautions: [],
      coverage: {},
      truncation: '',
      admissions: [],
    }))
  })

  it('joins id-different-from-name projection and discovery into one verified exemplar (WR-02)', async () => {
    const filePath = join(root, 'tests', 'guest-checkout.yaml')
    const testId = 'checkout-guest-1'
    const testName = 'Guest checkout with promo'
    const handoff: CompletedRunHandoff = {
      schemaVersion: 3,
      runId: asRunId('run-authoring-identity-join'),
      scope: SCOPE,
      buildOrdinal: 12,
      executionContext: 'ci',
      aggregateVerdict: 'passed',
      configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
      startedAt: 1_750_000_000_000,
      endedAt: 1_750_000_001_000,
      tests: [{
        testId,
        testName,
        filePath,
        testIndex: 0,
        outcome: 'passed',
        steps: [],
      }],
    }
    const writer = openIndexWriter(knowledgeRoot)
    try {
      applyRunOutcomes(writer.db, projectRunOutcomes(handoff, {
        extractAnchors: () => [],
      }))
    } finally {
      writer.close()
    }
    const reader = createAuthoringReader(
      { knowledgeRoot, product: PRODUCT },
      { discoverKnownTests: () => [{ filePath, testName }] },
    )

    const brief = await reader.getAuthoringBrief(testName, SCOPE)

    expect(brief.exemplars).toHaveLength(1)
    expect(brief.exemplars[0]).toMatchObject({
      filePath,
      testName,
      unverifiedOutcomes: false,
      passRate: 1,
    })
    expect(brief.exemplars).not.toContainEqual(
      expect.objectContaining({ filePath, unverifiedOutcomes: true }),
    )
  })
})
