import { existsSync, rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  BundleOutcomeEventSchema,
  DEFAULT_EMBEDDING_PROFILE,
  graphNodeId,
} from '@vostride/agent-qa-schema'
import type { Anchor } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import * as knowledgeLocal from '../index.js'
import type {
  BundleStoreConfig,
  PublishBundleInput,
  PublishBundleOutcome,
} from '../index.js'
import { enqueueArtifactFreeCandidateProjection } from './fixtures/curation-candidate-fixture.js'
import {
  makeBundleDraftFixture,
  makeScreenStateFixture,
  scaffoldKnowledgeRoot,
} from './fixtures/bundle-fixture.js'
import { makeFakeEmbedder } from './fixtures/fake-embedder.js'

type PublishedBundle = Extract<PublishBundleOutcome, { kind: 'published' }>

interface PurgeRecordInput {
  knowledgeRoot: string
  recordId: string
  initiator: string
}

interface PurgeRecordOutcome {
  kind: string
}

interface PurgeApi {
  purgeRecord(input: PurgeRecordInput): PurgeRecordOutcome
}

const PRODUCT = 'purge-storefront'

function purgeApi(): PurgeApi {
  const candidate = knowledgeLocal as unknown as Partial<PurgeApi>
  if (typeof candidate.purgeRecord !== 'function') {
    throw new Error('purgeRecord public API is not implemented')
  }
  return candidate as PurgeApi
}

describe('DCAY-05 sovereign purge', () => {
  let root: string
  let knowledgeRoot: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'knowledge-purge-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    scaffoldKnowledgeRoot(knowledgeRoot)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function config(productKey = PRODUCT): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey,
      auditBaseDir: join(root, '.agent-qa'),
      commitArtifacts: 'none',
    }
  }

  function input(
    identity: string,
    anchors: readonly Anchor[],
    overrides: Partial<PublishBundleInput> = {},
  ): PublishBundleInput {
    return {
      draft: makeBundleDraftFixture({
        anchors: [...anchors],
        scope: { tier: 'product', key: PRODUCT },
        summary: `${identity} purge fixture`,
        body: `${identity} records the content exercised by the purge contract.`,
      }),
      discriminant: {
        kind: 'fact',
        subtype: 'selector',
        elementRef: { role: 'fixture', name: identity },
      },
      originClass: 'agent-verified',
      createdAtOrdinal: 42,
      screenStates: [makeScreenStateFixture()],
      initialEvents: [],
      relations: [],
      provenance: {
        mode: 'run-linked',
        runId: `purge-${identity}-run`,
        testId: `purge-${identity}-test`,
        stepIndex: 0,
        sourceBuildOrdinal: 42,
      },
      artifacts: [],
      ...overrides,
    }
  }

  function publish(
    identity: string,
    anchors: readonly Anchor[],
    overrides: Partial<PublishBundleInput> = {},
  ): PublishedBundle {
    const outcome = knowledgeLocal.publishBundle(
      config(),
      input(identity, anchors, overrides),
    )
    expect(outcome.kind).toBe('published')
    if (outcome.kind !== 'published') {
      throw new Error(`expected ${identity} publication, got ${outcome.kind}`)
    }
    return outcome
  }

  function purge(recordId: string): PurgeRecordOutcome {
    return purgeApi().purgeRecord({ knowledgeRoot, recordId, initiator: 'user' })
  }

  function enqueue(identity: string, anchors: readonly Anchor[]): string {
    const outcome = enqueueArtifactFreeCandidateProjection({
      knowledgeRoot,
      projectionInput: {
        sourceRunId: `purge-queue-${identity}`,
        scope: { tier: 'product', key: PRODUCT },
        buildOrdinal: 43,
        executionContext: 'local-interactive',
        secretFlagged: false,
        injectionFlagged: false,
        kind: 'fact',
        subtype: 'selector',
        anchors: [...anchors],
        summarySeed: `${identity} queue summary`,
        bodySeed: `${identity} queue body`,
        distilledObservations: [],
        evidenceToken: `${identity}-queue-evidence`,
        attributingObservationId: `${identity}-queue-observation`,
        emittedAt: '2026-07-16T00:00:00.000Z',
      },
    })
    expect(outcome.kind).toBe('enqueued')
    if (outcome.kind !== 'enqueued') {
      throw new Error(`expected ${identity} queue admission, got ${outcome.kind}`)
    }
    return outcome.candidateId
  }

  it('removes the complete committed bundle directory', () => {
    const target = publish('bundle-tree', [
      { t: 'el', role: 'button', name: 'Purge bundle tree' },
      { t: 'page', route: '/purge/bundle-tree' },
      { t: 'platform', platform: 'web' },
    ])
    expect(existsSync(target.dir)).toBe(true)

    expect(purge(target.id).kind).toBe('purged')

    expect(existsSync(target.dir)).toBe(false)
  })

  it('deletes records, anchors, FTS, vec, and graph rows immediately and after rebuild', async () => {
    const targetAnchors = [
      { t: 'el', role: 'button', name: 'Purge every projection' },
      { t: 'page', route: '/purge/projections' },
      { t: 'platform', platform: 'web' },
    ] satisfies Anchor[]
    const target = publish('every-projection', targetAnchors)
    const neighbor = publish(
      'incoming-edge-neighbor',
      [
        { t: 'el', role: 'link', name: 'Purge projection neighbor' },
        { t: 'page', route: '/purge/projections/neighbor' },
        { t: 'platform', platform: 'web' },
      ],
      {
        relations: [
          {
            type: 'relates-to',
            targetId: target.id,
            addedAtOrdinal: 43,
            curationJobId: 'purge-incoming-edge-job',
          },
        ],
      },
    )
    await knowledgeLocal.rebuildIndex({ knowledgeRoot, embedder: makeFakeEmbedder() })

    const before = knowledgeLocal.openIndexReaderConnection(knowledgeRoot)
    const targetRow = before.db
      .prepare('SELECT record_rowid FROM records WHERE bundle_id = ?')
      .get(target.id)
    expect(targetRow).toBeDefined()
    const targetRowid = Number(targetRow?.record_rowid)
    before.db.close()

    expect(purge(target.id).kind).toBe('purged')

    const recordNodeId = graphNodeId('fact', target.id)
    function expectAbsentFromEveryProjection(): void {
      const reader = knowledgeLocal.openIndexReaderConnection(knowledgeRoot)
      try {
        expect(
          reader.db.prepare('SELECT 1 FROM records WHERE bundle_id = ?').get(target.id),
        ).toBeUndefined()
        expect(
          reader.db
            .prepare('SELECT 1 FROM anchors WHERE record_rowid = ?')
            .get(targetRowid),
        ).toBeUndefined()
        expect(
          reader.db.prepare('SELECT 1 FROM fts_records WHERE rowid = ?').get(targetRowid),
        ).toBeUndefined()
        if (reader.vec === 'vec0') {
          expect(
            reader.db
              .prepare(`
                SELECT 1
                FROM ${knowledgeLocal.vecTableName(DEFAULT_EMBEDDING_PROFILE)}
                WHERE record_rowid = ?
              `)
              .get(BigInt(targetRowid)),
          ).toBeUndefined()
        }
        expect(
          reader.db
            .prepare(`
              SELECT 1
              FROM graph_edges
              WHERE record_rowid = ? OR src_node_id = ? OR dst_node_id = ?
              LIMIT 1
            `)
            .get(targetRowid, recordNodeId, recordNodeId),
        ).toBeUndefined()
        expect(
          reader.db.prepare('SELECT 1 FROM graph_nodes WHERE node_id = ?').get(recordNodeId),
        ).toBeUndefined()
        expect(
          reader.db.prepare('SELECT 1 FROM records WHERE bundle_id = ?').get(neighbor.id),
        ).toBeDefined()
      } finally {
        reader.db.close()
      }
    }

    expectAbsentFromEveryProjection()
    await knowledgeLocal.rebuildIndex({ knowledgeRoot, embedder: makeFakeEmbedder() })
    expectAbsentFromEveryProjection()
  })

  it('sweeps only queue payloads whose normalized anchors intersect the purged record', () => {
    const sharedAnchor = {
      t: 'el',
      role: 'button',
      name: 'Queue intersection target',
    } satisfies Anchor
    const target = publish('queue-target', [
      sharedAnchor,
      { t: 'page', route: '/purge/queue/target' },
      { t: 'platform', platform: 'web' },
    ])
    const matchingCandidateId = enqueue('queue-matching', [
      sharedAnchor,
      { t: 'page', route: '/purge/queue/different-page' },
      { t: 'platform', platform: 'web' },
    ])
    const unrelatedCandidateId = enqueue('queue-unrelated', [
      { t: 'el', role: 'button', name: 'Unrelated queue payload' },
      { t: 'page', route: '/purge/queue/unrelated' },
      { t: 'platform', platform: 'web' },
    ])

    expect(purge(target.id).kind).toBe('purged')

    expect(
      existsSync(knowledgeLocal.queuedCandidateDir(knowledgeRoot, matchingCandidateId)),
    ).toBe(false)
    expect(
      existsSync(knowledgeLocal.queuedCandidateDir(knowledgeRoot, unrelatedCandidateId)),
    ).toBe(true)
  })

  it('clears the complete embed cache and later rebuild work repopulates it', async () => {
    const target = publish('cache-target', [
      { t: 'el', role: 'button', name: 'Purge cache target' },
      { t: 'page', route: '/purge/cache/target' },
      { t: 'platform', platform: 'web' },
    ])
    publish('cache-live-before', [
      { t: 'el', role: 'button', name: 'Cache live before' },
      { t: 'page', route: '/purge/cache/live-before' },
      { t: 'platform', platform: 'web' },
    ])
    await knowledgeLocal.rebuildIndex({ knowledgeRoot, embedder: makeFakeEmbedder() })

    const cacheWriter = knowledgeLocal.openIndexWriter(knowledgeRoot)
    knowledgeLocal.ensureEmbedCacheTable(cacheWriter.db)
    knowledgeLocal.putCachedEmbedding({
      db: cacheWriter.db,
      profile: DEFAULT_EMBEDDING_PROFILE,
      leg: 'doc',
      rendering: 'purged rendering cache row',
      vector: await makeFakeEmbedder().embedDocument('purged rendering cache row'),
    })
    cacheWriter.close()

    const before = knowledgeLocal.openIndexReaderConnection(knowledgeRoot)
    expect(before.db.prepare('SELECT COUNT(*) AS count FROM embed_cache').get()?.count)
      .toBeGreaterThan(0)
    before.db.close()

    expect(purge(target.id).kind).toBe('purged')

    const afterPurge = knowledgeLocal.openIndexReaderConnection(knowledgeRoot)
    expect(afterPurge.db.prepare('SELECT COUNT(*) AS count FROM embed_cache').get()?.count)
      .toBe(0)
    afterPurge.db.close()

    publish('cache-live-after', [
      { t: 'el', role: 'button', name: 'Cache live after' },
      { t: 'page', route: '/purge/cache/live-after' },
      { t: 'platform', platform: 'web' },
    ])
    const base = makeFakeEmbedder()
    let documentCalls = 0
    const cacheDb = new DatabaseSync(knowledgeLocal.indexDbPath(knowledgeRoot))
    try {
      const cachedEmbedder = knowledgeLocal.wrapEmbedderWithCache({
        db: cacheDb,
        profile: DEFAULT_EMBEDDING_PROFILE,
        mode: 'check-and-store',
        embedder: {
          async embedDocument(rendering) {
            documentCalls += 1
            return base.embedDocument(rendering)
          },
          embedQuery: (rendering) => base.embedQuery(rendering),
        },
      })
      await knowledgeLocal.rebuildIndex({
        knowledgeRoot,
        embedder: cachedEmbedder,
      })
    } finally {
      cacheDb.close()
    }

    expect(documentCalls).toBeGreaterThan(0)
    const afterRebuild = knowledgeLocal.openIndexReaderConnection(knowledgeRoot)
    expect(afterRebuild.db.prepare('SELECT COUNT(*) AS count FROM embed_cache').get()?.count)
      .toBeGreaterThan(0)
    afterRebuild.db.close()
  })

  it('leaves no includeSuperseded audit result, unlike structural scrub', async () => {
    const anchor = { t: 'flow', name: 'Purge audit distinction' } satisfies Anchor
    const replacement = publish('audit-replacement', [
      anchor,
      { t: 'platform', platform: 'web' },
    ])
    const target = publish(
      'audit-target',
      [anchor, { t: 'platform', platform: 'web' }],
      {
        createdAtOrdinal: 30,
        initialEvents: [
          BundleOutcomeEventSchema.parse({
            type: 'superseded',
            evidenceToken: 'purge-audit-superseded',
            curationJobId: 'purge-audit-superseded-job',
            buildOrdinal: 50,
            byRecordId: replacement.id,
          }),
        ],
      },
    )
    await knowledgeLocal.rebuildIndex({ knowledgeRoot })

    async function auditIds(): Promise<string[]> {
      const reader = knowledgeLocal.openKnowledgeReader(knowledgeRoot)
      try {
        const entries = await knowledgeLocal.retrieve(
          reader,
          { intent: '', anchors: [anchor] },
          {
            n: 10,
            product: PRODUCT,
            asOfBuild: 60,
            includeSuperseded: true,
          },
        )
        return entries.map(({ id }) => id)
      } finally {
        reader.close()
      }
    }

    expect(await auditIds()).toContain(target.id)
    expect(purge(target.id).kind).toBe('purged')
    expect(await auditIds()).not.toContain(target.id)
  })
})
