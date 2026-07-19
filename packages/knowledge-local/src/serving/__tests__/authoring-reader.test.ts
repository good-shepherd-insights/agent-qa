import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  asRunId,
  BundleOutcomeEventSchema,
  DEFAULT_EMBEDDING_PROFILE,
  canonicalJson,
  type Anchor,
  type CompletedRunHandoff,
  type ScopeKey,
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
const BLOG_PRODUCT = 'dense-authoring-blog'
const BLOG_SCOPE = { tier: 'product', key: BLOG_PRODUCT } as const
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

function outcomeHandoff(input: {
  runId: string
  scope: ScopeKey
  buildOrdinal: number
  filePath: string
  testName: string
  outcome: 'passed' | 'failed'
  anchor?: Anchor
}): CompletedRunHandoff {
  return {
    schemaVersion: 3,
    runId: asRunId(input.runId),
    scope: input.scope,
    buildOrdinal: input.buildOrdinal,
    executionContext: 'ci',
    aggregateVerdict: input.outcome,
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1_750_000_000_000,
    endedAt: 1_750_000_001_000,
    tests: [{
      testId: `${input.runId}-test`,
      testName: input.testName,
      filePath: input.filePath,
      testIndex: 0,
      outcome: input.outcome,
      steps: input.anchor === undefined
        ? []
        : [{ stepIndex: 0, anchors: [input.anchor] }],
    }],
  } as unknown as CompletedRunHandoff
}

function foldOutcomeHandoff(knowledgeRoot: string, handoff: CompletedRunHandoff): void {
  const writer = openIndexWriter(knowledgeRoot)
  try {
    applyRunOutcomes(writer.db, projectRunOutcomes(handoff, {
      extractAnchors: (step) => (
        step as unknown as { anchors?: Anchor[] }
      ).anchors ?? [],
    }))
  } finally {
    writer.close()
  }
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

  it('keeps projection exemplars and counters inside the requested product scope', async () => {
    const shared = {
      filePath: 'tests/shared-checkout.yaml',
      testName: 'shared checkout path',
    }
    foldOutcomeHandoff(knowledgeRoot, outcomeHandoff({
      runId: 'run-shop-shared-1',
      scope: SCOPE,
      buildOrdinal: 20,
      ...shared,
      outcome: 'passed',
      anchor: { t: 'page', route: '/checkout' },
    }))
    foldOutcomeHandoff(knowledgeRoot, outcomeHandoff({
      runId: 'run-shop-shared-2',
      scope: SCOPE,
      buildOrdinal: 21,
      ...shared,
      outcome: 'passed',
      anchor: { t: 'page', route: '/checkout' },
    }))
    foldOutcomeHandoff(knowledgeRoot, outcomeHandoff({
      runId: 'run-blog-shared',
      scope: BLOG_SCOPE,
      buildOrdinal: 22,
      ...shared,
      outcome: 'passed',
      anchor: { t: 'page', route: '/blog-checkout' },
    }))
    foldOutcomeHandoff(knowledgeRoot, outcomeHandoff({
      runId: 'run-blog-only',
      scope: BLOG_SCOPE,
      buildOrdinal: 23,
      filePath: 'tests/blog-only-checkout.yaml',
      testName: 'blog only checkout path',
      outcome: 'passed',
      anchor: { t: 'page', route: '/checkout' },
    }))

    const reader = createAuthoringReader({ knowledgeRoot, product: PRODUCT })
    const brief = await reader.getAuthoringBrief('checkout path /checkout', SCOPE)

    expect(brief.exemplars.map(({ filePath, testName }) => ({ filePath, testName }))).toEqual([
      shared,
    ])
    expect(brief.exemplars[0]).toMatchObject({
      passRate: 1,
      unverifiedOutcomes: false,
    })
    expect(brief.exemplars[0]?.excerpt).toContain('outcomes 2 pass / 0 fail')
    expect(brief.exemplars[0]?.excerpt).not.toContain('blog-checkout')
  })

  it('does not let a foreign projection row suppress a local never-run test', async () => {
    const localRef = {
      filePath: 'tests/shared-never-run.yaml',
      testName: 'shared never run checkout',
    }
    foldOutcomeHandoff(knowledgeRoot, outcomeHandoff({
      runId: 'run-blog-never-run-name',
      scope: BLOG_SCOPE,
      buildOrdinal: 24,
      ...localRef,
      outcome: 'passed',
    }))
    const reader = createAuthoringReader(
      { knowledgeRoot, product: PRODUCT },
      { discoverKnownTests: () => [localRef] },
    )

    const brief = await reader.getAuthoringBrief('shared never run checkout', SCOPE)

    expect(brief.exemplars).toHaveLength(1)
    expect(brief.exemplars[0]).toMatchObject({
      ...localRef,
      unverifiedOutcomes: true,
    })
    expect(brief.exemplars[0]).not.toHaveProperty('passRate')
  })

  it('treats a pre-partition projection shape as empty instead of querying it', async () => {
    const writer = openIndexWriter(knowledgeRoot)
    try {
      writer.db.exec(`
        DROP TABLE run_test_outcomes;
        DROP TABLE run_test_anchors;
        CREATE TABLE run_test_outcomes (
          file_path TEXT NOT NULL,
          test_name TEXT NOT NULL,
          passes INTEGER NOT NULL DEFAULT 0,
          failures INTEGER NOT NULL DEFAULT 0,
          heals INTEGER NOT NULL DEFAULT 0,
          flake_count INTEGER NOT NULL DEFAULT 0,
          quarantined INTEGER NOT NULL DEFAULT 0,
          last_outcomes_json TEXT NOT NULL DEFAULT '[]',
          last_build_ordinal INTEGER,
          PRIMARY KEY (file_path, test_name)
        );
        CREATE TABLE run_test_anchors (
          file_path TEXT NOT NULL,
          test_name TEXT NOT NULL,
          anchor_normalized_json TEXT NOT NULL,
          UNIQUE (file_path, test_name, anchor_normalized_json)
        );
        INSERT INTO run_test_outcomes (
          file_path, test_name, passes, last_outcomes_json
        ) VALUES (
          'tests/legacy-checkout.yaml', 'legacy checkout', 1,
          '[{"buildOrdinal":1,"passed":true}]'
        );
      `)
    } finally {
      writer.close()
    }
    const reader = createAuthoringReader({ knowledgeRoot, product: PRODUCT })

    const brief = await reader.getAuthoringBrief('legacy checkout', SCOPE)

    expect(brief.exemplars).toEqual([])
  })

  it('treats absent projection tables as an empty projection', async () => {
    const writer = openIndexWriter(knowledgeRoot)
    try {
      writer.db.exec(`
        DROP TABLE run_test_outcomes;
        DROP TABLE run_test_anchors;
      `)
    } finally {
      writer.close()
    }
    const reader = createAuthoringReader({ knowledgeRoot, product: PRODUCT })

    const brief = await reader.getAuthoringBrief('missing projection', SCOPE)

    expect(brief.exemplars).toEqual([])
  })
})
