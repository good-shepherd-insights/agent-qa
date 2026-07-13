import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import {
  BundleOutcomeEventSchema,
  canonicalJson,
  DEFAULT_EMBEDDING_PROFILE,
  graphNodeId,
  slugBranch,
} from '@vostride/agent-qa-schema'
import type {
  Anchor,
  BundleRelation,
  DerivedTrustState,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import * as knowledgeLocal from '../index.js'
import { deriveBundleTrust, loadBundle } from '../bundle-read.js'
import {
  publishBundle,
  type BundleStoreConfig,
  type PublishBundleInput,
  type PublishBundleOutcome,
} from '../bundle-publish.js'
import {
  makeBundleDraftFixture,
  makeDiscriminantFixture,
  makeScreenStateFixture,
  scaffoldKnowledgeRoot,
} from './fixtures/bundle-fixture.js'
import { makeFakeEmbedder } from './fixtures/fake-embedder.js'

interface RebuildReport {
  projected: number
  skippedIncomplete: number
  scanIssues: string[]
  removed: number
  backfilled: number
  vec: 'vec0' | 'brute'
}

interface RebuildApi {
  rebuildIndex(opts: {
    knowledgeRoot: string
    embedder?: knowledgeLocal.EmbedderPort
    vecLoadablePath?: string
  }): Promise<RebuildReport>
}

type PublishedBundle = Extract<PublishBundleOutcome, { kind: 'published' }>

function rebuildApi(): RebuildApi {
  const candidate = knowledgeLocal as unknown as Partial<RebuildApi>
  if (typeof candidate.rebuildIndex !== 'function') {
    throw new Error('rebuildIndex public API is not implemented')
  }
  return candidate as RebuildApi
}

function rows(db: DatabaseSync, sql: string): Record<string, unknown>[] {
  return db.prepare(sql).all() as Record<string, unknown>[]
}

describe('IDX-01 derived-index rebuild projection', () => {
  let root: string
  let knowledgeRoot: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'knowledge-index-rebuild-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    scaffoldKnowledgeRoot(knowledgeRoot)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function config(productKey: string): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey,
      auditBaseDir: join(root, '.agent-qa'),
      commitArtifacts: 'none',
    }
  }

  function input(overrides: Partial<PublishBundleInput> = {}): PublishBundleInput {
    return {
      draft: makeBundleDraftFixture(),
      discriminant: makeDiscriminantFixture(),
      originClass: 'agent-verified',
      createdAtOrdinal: 42,
      screenStates: [makeScreenStateFixture()],
      initialEvents: [],
      relations: [],
      provenance: {
        mode: 'run-linked',
        runId: 'index-rebuild-run',
        testId: 'index-rebuild-test',
        stepIndex: 0,
      },
      artifacts: [],
      ...overrides,
    }
  }

  function publish(
    productKey: string,
    overrides: Partial<PublishBundleInput> = {},
  ): PublishedBundle {
    const outcome = publishBundle(config(productKey), input(overrides))
    expect(outcome.kind).toBe('published')
    if (outcome.kind !== 'published') {
      throw new Error(`expected publication, got ${outcome.kind}`)
    }
    return outcome
  }

  function openReader(): knowledgeLocal.IndexReaderConnection {
    return knowledgeLocal.openIndexReaderConnection(knowledgeRoot)
  }

  it('projects records, trust, FTS, anchors, graph edges, and pending vectors from bundles', async () => {
    const target = publish('Checkout Product', {
      draft: makeBundleDraftFixture({
        anchors: [
          { t: 'el', role: 'Button', name: 'Checkout now' },
          { t: 'page', route: '/cart' },
          { t: 'platform', platform: 'web' },
        ],
        scope: { tier: 'product', key: 'checkout-product' },
        summary: 'Checkout control on the cart page',
        body: 'Selecting Checkout now opens the payment page.',
      }),
    })
    const relation: BundleRelation = {
      type: 'relates-to',
      targetId: target.id,
      addedAtOrdinal: 43,
      curationJobId: 'index-rebuild-relation-job',
    }
    const sourceAnchors: Anchor[] = [
      { t: 'el', role: 'Button', name: 'Sign in' },
      { t: 'page', route: '/login' },
      { t: 'selector', literal: '#sign-in' },
      { t: 'error', message: 'Authentication failed 401' },
      { t: 'platform', platform: 'web' },
    ]
    const source = publish('Storefront Product', {
      draft: makeBundleDraftFixture({
        anchors: sourceAnchors,
        scope: { tier: 'product', key: 'storefront-product' },
      }),
      initialEvents: [
        BundleOutcomeEventSchema.parse({
          type: 'confirmed',
          evidenceToken: 'index-rebuild-confirmed',
          curationJobId: 'index-rebuild-confirmed-job',
          buildOrdinal: 43,
          origin: 'agent-verified',
        }),
      ],
      relations: [relation],
    })

    const sourceManifest = JSON.parse(
      readFileSync(join(source.dir, 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>
    const incompleteDir = join(
      knowledgeRoot,
      'memory',
      'partial-product',
      'bundles',
      'half-written',
    )
    mkdirSync(incompleteDir, { recursive: true })
    writeFileSync(
      join(incompleteDir, 'manifest.json'),
      `${JSON.stringify({ ...sourceManifest, complete: false })}\n`,
      'utf8',
    )

    const report = await rebuildApi().rebuildIndex({ knowledgeRoot })
    expect(report).toMatchObject({
      projected: 2,
      skippedIncomplete: 1,
      scanIssues: [],
      removed: 0,
      backfilled: 0,
    })

    const reader = openReader()
    try {
      const recordRows = rows(
        reader.db,
        `SELECT * FROM records ORDER BY product, bundle_id`,
      )
      expect(recordRows).toHaveLength(2)
      expect(recordRows.every((row) => row.embed_status === 'pending')).toBe(true)
      expect(recordRows.every((row) => row.embedding === null)).toBe(true)

      for (const published of [source, target]) {
        const loaded = loadBundle(published.dir)
        expect(loaded.kind).toBe('loaded')
        if (loaded.kind !== 'loaded') throw new Error(`expected loaded, got ${loaded.kind}`)
        const expectedTrust: DerivedTrustState = deriveBundleTrust(loaded.bundle)
        const projected = recordRows.find((row) => row.bundle_id === published.id)
        expect(projected).toMatchObject({
          mutable_state_hash: loaded.bundle.manifest.mutableStateHash,
          kind: loaded.bundle.frontmatter.kind,
          subtype: loaded.bundle.frontmatter.subtype ?? null,
          scope_tier: loaded.bundle.frontmatter.scope.tier,
          scope_key: loaded.bundle.frontmatter.scope.key,
          status: expectedTrust.status,
          confirmed: expectedTrust.counters.confirmed,
          contradicted: expectedTrust.counters.contradicted,
          helpful: expectedTrust.counters.helpful,
          harmful: expectedTrust.counters.harmful,
          opened_at_ordinal: expectedTrust.validity.openedAtOrdinal,
          closed_at_ordinal: expectedTrust.validity.closedAtOrdinal ?? null,
          created_at_ordinal: loaded.bundle.frontmatter.createdAtOrdinal,
          origin_class: loaded.bundle.frontmatter.originClass,
          summary: loaded.bundle.summary,
          embedding_input: loaded.bundle.manifest.embeddingInput,
        })
        expect(projected?.trust).toBeCloseTo(expectedTrust.trust)
      }

      const sourceRow = recordRows.find((row) => row.bundle_id === source.id)
      expect(sourceRow).toBeDefined()
      const sourceRowid = Number(sourceRow?.record_rowid)
      const fts = reader.db
        .prepare('SELECT rowid, identity, content FROM fts_records WHERE rowid = ?')
        .get(sourceRowid)
      expect(fts).toMatchObject({
        rowid: sourceRowid,
        content: expect.any(String),
      })
      expect(String(fts?.identity)).toContain(canonicalJson(sourceAnchors[0]))
      expect(String(fts?.identity)).toContain('#sign-in')
      expect(String(fts?.identity)).toContain('Authentication failed 401')
      expect(rows(reader.db, 'SELECT * FROM fts_records')).toHaveLength(2)
      expect(
        rows(reader.db, `SELECT * FROM anchors WHERE record_rowid = ${sourceRowid}`),
      ).toHaveLength(sourceAnchors.length)

      const recordNodeId = graphNodeId('fact', source.id)
      const elementNodeId = graphNodeId('web-element', {
        role: 'button',
        name: 'sign in',
      })
      const pageNodeId = graphNodeId('web-page', '/login')
      const targetNodeId = graphNodeId('fact', target.id)
      expect(
        reader.db.prepare('SELECT * FROM graph_nodes WHERE node_id = ?').get(recordNodeId),
      ).toMatchObject({
        node_type: 'fact',
        natural_key_json: canonicalJson(source.id),
      })
      expect(
        reader.db.prepare('SELECT * FROM graph_nodes WHERE node_id = ?').get(elementNodeId),
      ).toMatchObject({
        node_type: 'web-element',
        natural_key_json: canonicalJson({ role: 'button', name: 'sign in' }),
      })
      const graphEdges = rows(
        reader.db,
        'SELECT src_node_id, edge_type, dst_node_id FROM graph_edges',
      )
      expect(graphEdges).toEqual(
        expect.arrayContaining([
          { src_node_id: recordNodeId, edge_type: 'about', dst_node_id: elementNodeId },
          { src_node_id: elementNodeId, edge_type: 'part-of', dst_node_id: pageNodeId },
          { src_node_id: recordNodeId, edge_type: 'relates-to', dst_node_id: targetNodeId },
        ]),
      )
    } finally {
      reader.db.close()
    }
  })

  it('stores canonical Float32 BLOBs and vec0 accelerator rows with the fake embedder', async () => {
    const published = publish('Embedded Product', {
      draft: makeBundleDraftFixture({
        anchors: [
          { t: 'el', role: 'Button', name: 'Embed me' },
          { t: 'platform', platform: 'web' },
        ],
        scope: { tier: 'product', key: 'embedded-product' },
      }),
    })
    const embedder = makeFakeEmbedder()

    const report = await rebuildApi().rebuildIndex({ knowledgeRoot, embedder })
    expect(report.vec).toBe('vec0')
    expect(report.projected).toBe(1)

    const reader = openReader()
    try {
      const record = reader.db
        .prepare('SELECT record_rowid, embed_status, embedding FROM records WHERE bundle_id = ?')
        .get(published.id)
      expect(record?.embed_status).toBe('present')
      expect(record?.embedding).toBeInstanceOf(Uint8Array)
      expect((record?.embedding as Uint8Array).byteLength).toBe(
        DEFAULT_EMBEDDING_PROFILE.dim * Float32Array.BYTES_PER_ELEMENT,
      )

      const tableName = knowledgeLocal.vecTableName(DEFAULT_EMBEDDING_PROFILE)
      const vecRow = reader.db
        .prepare(`SELECT record_rowid, product FROM ${tableName} WHERE record_rowid = ?`)
        .get(BigInt(Number(record?.record_rowid)))
      expect(vecRow).toMatchObject({
        record_rowid: Number(record?.record_rowid),
        product: slugBranch('Embedded Product'),
      })

      const expected = await embedder.embedDocument(
        String(
          reader.db
            .prepare('SELECT embedding_input FROM records WHERE bundle_id = ?')
            .get(published.id)?.embedding_input,
        ),
      )
      expect(Buffer.from(record?.embedding as Uint8Array)).toEqual(Buffer.from(expected.buffer))
    } finally {
      reader.db.close()
    }
  })
})
