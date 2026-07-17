import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
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
  LoadedBundle,
  PublishBundleInput,
  PublishBundleOutcome,
} from '../index.js'
import * as purgeModule from '../purge.js'
import {
  candidateProjectionFixture,
  enqueueArtifactFreeCandidateProjection,
} from './fixtures/curation-candidate-fixture.js'
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
  receipt?: PurgeReceipt
  detections?: readonly { label: string; detector: string }[]
}

interface PurgeReceipt {
  schemaVersion: number
  purgedRecordId: string
  purgedAtOrdinal: number
  initiator: string
  affectedPaths: string[]
  firstCommittedOrdinal: number
}

interface PurgeReceiptSchemaApi {
  PURGE_RECEIPT_SCHEMA_VERSION: number
  purgeReceiptSchema: {
    safeParse(value: unknown): { success: boolean }
  }
  guardPurgeReceipt(value: unknown): PurgeReceipt
}

interface PurgeApi {
  purgeRecord(input: PurgeRecordInput): PurgeRecordOutcome
}

interface QueueSweepTarget {
  candidateDir: string
  candidateId: string
}

interface QueueSweepApi {
  resolveQueueSweepTargets(
    knowledgeRoot: string,
    matches: readonly { dir: string; bundle: LoadedBundle }[],
  ): QueueSweepTarget[]
}

const PRODUCT = 'purge-storefront'

function purgeApi(): PurgeApi {
  const candidate = knowledgeLocal as unknown as Partial<PurgeApi>
  if (typeof candidate.purgeRecord !== 'function') {
    throw new Error('purgeRecord public API is not implemented')
  }
  return candidate as PurgeApi
}

function queueSweepApi(): QueueSweepApi {
  const candidate = purgeModule as unknown as Partial<QueueSweepApi>
  if (typeof candidate.resolveQueueSweepTargets !== 'function') {
    throw new Error('resolveQueueSweepTargets public API is not implemented')
  }
  return candidate as QueueSweepApi
}

function purgeReceiptSchemaApi(): PurgeReceiptSchemaApi {
  const candidate = knowledgeLocal as unknown as Partial<PurgeReceiptSchemaApi>
  if (
    typeof candidate.PURGE_RECEIPT_SCHEMA_VERSION !== 'number'
    || candidate.purgeReceiptSchema === undefined
    || typeof candidate.guardPurgeReceipt !== 'function'
  ) {
    throw new Error('purge receipt schema public API is not implemented')
  }
  return candidate as PurgeReceiptSchemaApi
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

  function enqueue(
    identity: string,
    anchors: readonly Anchor[],
    seeds: { summarySeed?: string; bodySeed?: string } = {},
  ): string {
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
        summarySeed: seeds.summarySeed ?? `${identity} queue summary`,
        bodySeed: seeds.bodySeed ?? `${identity} queue body`,
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

  function loadedMatch(dir: string): { dir: string; bundle: LoadedBundle } {
    const outcome = knowledgeLocal.loadBundle(dir)
    if (outcome.kind !== 'loaded') {
      throw new Error(`expected a loaded bundle at ${dir}, got ${outcome.kind}`)
    }
    return { dir, bundle: outcome.bundle }
  }

  function sortedTargets(candidateIds: readonly string[]): QueueSweepTarget[] {
    return candidateIds
      .map((candidateId) => ({
        candidateDir: knowledgeLocal.queuedCandidateDir(knowledgeRoot, candidateId),
        candidateId,
      }))
      .sort((left, right) =>
        left.candidateDir < right.candidateDir
          ? -1
          : left.candidateDir > right.candidateDir
            ? 1
            : 0,
      )
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

  it('deletes queue payloads carrying the purged content under entirely different anchors', () => {
    const purgedSummary = 'Confirmed-sensitive queue summary replicated verbatim'
    const purgedBody =
      'Confirmed-sensitive queue body replicated verbatim into the curation queue.'
    const targetAnchors = [
      { t: 'el', role: 'button', name: 'Same content target' },
      { t: 'page', route: '/purge/queue/same-content' },
      { t: 'platform', platform: 'web' },
    ] satisfies Anchor[]
    const target = publish('queue-same-content', targetAnchors, {
      draft: makeBundleDraftFixture({
        anchors: [...targetAnchors],
        scope: { tier: 'product', key: PRODUCT },
        summary: purgedSummary,
        body: purgedBody,
      }),
    })
    const bodyMatchId = enqueue(
      'queue-body-match',
      [
        { t: 'el', role: 'link', name: 'Entirely different control' },
        { t: 'page', route: '/purge/queue/disjoint-body' },
        { t: 'platform', platform: 'web' },
      ],
      { bodySeed: purgedBody },
    )
    const summaryMatchId = enqueue(
      'queue-summary-match',
      [
        { t: 'el', role: 'link', name: 'Another entirely different control' },
        { t: 'page', route: '/purge/queue/disjoint-summary' },
        { t: 'platform', platform: 'web' },
      ],
      { summarySeed: purgedSummary },
    )
    const survivorId = enqueue('queue-content-survivor', [
      { t: 'el', role: 'button', name: 'Unrelated queue payload' },
      { t: 'page', route: '/purge/queue/unrelated' },
      { t: 'platform', platform: 'web' },
    ])

    const targets = queueSweepApi().resolveQueueSweepTargets(knowledgeRoot, [
      loadedMatch(target.dir),
    ])
    expect(targets).toEqual(sortedTargets([bodyMatchId, summaryMatchId]))

    expect(purge(target.id).kind).toBe('purged')

    expect(readdirSync(knowledgeLocal.queuedRoot(knowledgeRoot)).sort()).toEqual([survivorId])
    expect(existsSync(knowledgeLocal.jobStatePath(knowledgeRoot, bodyMatchId))).toBe(false)
    expect(existsSync(knowledgeLocal.jobStatePath(knowledgeRoot, summaryMatchId))).toBe(false)
    expect(existsSync(knowledgeLocal.jobStatePath(knowledgeRoot, survivorId))).toBe(true)
  })

  it('preserves a queue payload sharing page and element anchors but carrying different content', () => {
    const sharedElement = {
      t: 'el',
      role: 'button',
      name: 'Shared anchor control',
    } satisfies Anchor
    const sharedPage = { t: 'page', route: '/purge/queue/shared-anchor' } satisfies Anchor
    const target = publish('queue-anchor-only', [
      sharedElement,
      sharedPage,
      { t: 'platform', platform: 'web' },
    ])
    const survivorId = enqueue('queue-anchor-survivor', [
      sharedElement,
      sharedPage,
      { t: 'platform', platform: 'web' },
    ])
    const survivorDir = knowledgeLocal.queuedCandidateDir(knowledgeRoot, survivorId)
    const payloadBytesBefore = readFileSync(join(survivorDir, 'payload.json'))

    expect(purge(target.id).kind).toBe('purged')

    expect(readdirSync(knowledgeLocal.queuedRoot(knowledgeRoot))).toEqual([survivorId])
    expect(readFileSync(join(survivorDir, 'payload.json'))).toEqual(payloadBytesBefore)
    expect(existsSync(knowledgeLocal.jobStatePath(knowledgeRoot, survivorId))).toBe(true)
  })

  it('deletes a queue payload whose candidateId is the purged record curation-job lineage', () => {
    const lineageId = enqueue('queue-lineage', [
      { t: 'el', role: 'link', name: 'Lineage payload control' },
      { t: 'page', route: '/purge/queue/lineage' },
      { t: 'platform', platform: 'web' },
    ])
    const survivorId = enqueue('queue-lineage-survivor', [
      { t: 'el', role: 'link', name: 'Lineage survivor control' },
      { t: 'page', route: '/purge/queue/lineage-survivor' },
      { t: 'platform', platform: 'web' },
    ])
    const target = publish(
      'queue-lineage-target',
      [
        { t: 'el', role: 'button', name: 'Lineage target' },
        { t: 'page', route: '/purge/queue/lineage-target' },
        { t: 'platform', platform: 'web' },
      ],
      {
        provenance: {
          mode: 'run-linked',
          runId: 'purge-queue-lineage-run',
          testId: 'purge-queue-lineage-test',
          stepIndex: 0,
          sourceBuildOrdinal: 42,
          curationJobId: lineageId,
        },
      },
    )

    expect(purge(target.id).kind).toBe('purged')

    expect(readdirSync(knowledgeLocal.queuedRoot(knowledgeRoot))).toEqual([survivorId])
    expect(existsSync(knowledgeLocal.jobStatePath(knowledgeRoot, lineageId))).toBe(false)
    expect(existsSync(knowledgeLocal.jobStatePath(knowledgeRoot, survivorId))).toBe(true)
  })

  it('deletes a queue payload sharing an artifact digest with the purged manifests', () => {
    const target = publish('queue-digest-target', [
      { t: 'el', role: 'button', name: 'Digest target' },
      { t: 'page', route: '/purge/queue/digest-target' },
      { t: 'platform', platform: 'web' },
    ])
    const digest = loadedMatch(target.dir).bundle.manifest.contentHashes['record.md']
    if (digest === undefined) {
      throw new Error('expected record.md digest in the purged manifest')
    }
    const sourcePath = join(root, 'digest-artifact-source.bin')
    copyFileSync(join(target.dir, 'record.md'), sourcePath)
    const enqueued = knowledgeLocal.enqueueCurationCandidateProjection({
      knowledgeRoot,
      projection: candidateProjectionFixture({
        sourceRunId: 'purge-queue-digest-match',
        scope: { tier: 'product', key: PRODUCT },
        buildOrdinal: 43,
        executionContext: 'local-interactive',
        secretFlagged: false,
        injectionFlagged: false,
        kind: 'fact',
        subtype: 'selector',
        anchors: [
          { t: 'el', role: 'link', name: 'Digest payload control' },
          { t: 'page', route: '/purge/queue/digest-payload' },
          { t: 'platform', platform: 'web' },
        ],
        summarySeed: 'queue-digest-match queue summary',
        bodySeed: 'queue-digest-match queue body',
        distilledObservations: [],
        evidenceToken: 'queue-digest-match-queue-evidence',
        attributingObservationId: 'queue-digest-match-queue-observation',
        emittedAt: '2026-07-16T00:00:00.000Z',
        artifactDescriptors: [
          {
            ref: { id: 'queue-digest-match-artifact', sha: digest },
            stepIndex: 0,
            role: 'opaque-evidence',
            originalName: 'record-copy.bin',
          },
        ],
        captureEvidence: { elements: [] },
        stepInteractions: [],
      }),
      artifactSources: [
        { artifactId: 'queue-digest-match-artifact', sourcePath },
      ],
    })
    expect(enqueued.kind).toBe('enqueued')
    if (enqueued.kind !== 'enqueued') {
      throw new Error(`expected digest payload admission, got ${enqueued.kind}`)
    }
    const digestMatchId = enqueued.candidateId
    const survivorId = enqueue('queue-digest-survivor', [
      { t: 'el', role: 'link', name: 'Digest survivor control' },
      { t: 'page', route: '/purge/queue/digest-survivor' },
      { t: 'platform', platform: 'web' },
    ])

    expect(purge(target.id).kind).toBe('purged')

    expect(readdirSync(knowledgeLocal.queuedRoot(knowledgeRoot))).toEqual([survivorId])
    expect(existsSync(knowledgeLocal.jobStatePath(knowledgeRoot, digestMatchId))).toBe(false)
    expect(existsSync(knowledgeLocal.jobStatePath(knowledgeRoot, survivorId))).toBe(true)
  })

  it('resolves an empty queue sweep and deletes no payload or job state', () => {
    const target = publish('queue-empty-target', [
      { t: 'el', role: 'button', name: 'Empty resolution target' },
      { t: 'page', route: '/purge/queue/empty-target' },
      { t: 'platform', platform: 'web' },
    ])
    const firstId = enqueue('queue-empty-first', [
      { t: 'el', role: 'link', name: 'Empty resolution first payload' },
      { t: 'page', route: '/purge/queue/empty-first' },
      { t: 'platform', platform: 'web' },
    ])
    const secondId = enqueue('queue-empty-second', [
      { t: 'el', role: 'link', name: 'Empty resolution second payload' },
      { t: 'page', route: '/purge/queue/empty-second' },
      { t: 'platform', platform: 'web' },
    ])

    const targets = queueSweepApi().resolveQueueSweepTargets(knowledgeRoot, [
      loadedMatch(target.dir),
    ])
    expect(targets).toEqual([])

    expect(purge(target.id).kind).toBe('purged')

    expect(existsSync(target.dir)).toBe(false)
    expect(readdirSync(knowledgeLocal.queuedRoot(knowledgeRoot)).sort()).toEqual(
      [firstId, secondId].sort(),
    )
    expect(existsSync(knowledgeLocal.jobStatePath(knowledgeRoot, firstId))).toBe(true)
    expect(existsSync(knowledgeLocal.jobStatePath(knowledgeRoot, secondId))).toBe(true)
    expect(
      existsSync(join(knowledgeRoot, 'memory', 'receipts', `purge-${target.id}.json`)),
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

  it('writes a strict provenance receipt containing paths and ordinals but no bundle content', () => {
    const plantedMarker = 'PURGED-BUNDLE-BODY-MARKER-DO-NOT-COPY'
    const anchorName = 'Receipt anchor must stay out of receipt bytes'
    const anchors = [
      { t: 'el', role: 'button', name: anchorName },
      { t: 'page', route: '/purge/receipt-content' },
      { t: 'platform', platform: 'web' },
    ] satisfies Anchor[]
    const target = publish('receipt-content', anchors, {
      draft: makeBundleDraftFixture({
        anchors,
        scope: { tier: 'product', key: PRODUCT },
        summary: 'Receipt summary must stay out of receipt bytes',
        body: `Confirmed-sensitive body ${plantedMarker}`,
      }),
      initialEvents: [
        BundleOutcomeEventSchema.parse({
          type: 'confirmed',
          evidenceToken: 'purge-receipt-confirmed',
          curationJobId: 'purge-receipt-confirmed-job',
          buildOrdinal: 47,
          origin: 'agent-verified',
        }),
      ],
    })

    const outcome = purge(target.id)

    expect(outcome.kind).toBe('purged')
    expect(outcome.receipt).toBeDefined()
    const receiptPath = join(
      knowledgeRoot,
      'memory',
      'receipts',
      `purge-${target.id}.json`,
    )
    const receiptText = readFileSync(receiptPath, 'utf8')
    const receipt = JSON.parse(receiptText) as PurgeReceipt
    const bundleRelPath = relative(knowledgeRoot, target.dir)
    expect(receipt).toEqual({
      schemaVersion: 1,
      purgedRecordId: target.id,
      purgedAtOrdinal: 47,
      initiator: 'user',
      affectedPaths: expect.arrayContaining([
        bundleRelPath,
        `${bundleRelPath}/record.md`,
        `${bundleRelPath}/provenance.json`,
        `${bundleRelPath}/manifest.json`,
      ]),
      firstCommittedOrdinal: 42,
    })
    expect(outcome.receipt).toEqual(receipt)
    expect(receiptText).not.toContain(plantedMarker)
    expect(receiptText).not.toContain(anchorName)
    expect(receiptText).not.toContain('Receipt summary must stay out of receipt bytes')

    const schemaApi = purgeReceiptSchemaApi()
    expect(schemaApi.PURGE_RECEIPT_SCHEMA_VERSION).toBe(1)
    expect(schemaApi.purgeReceiptSchema.safeParse(receipt).success).toBe(true)
    expect(
      schemaApi.purgeReceiptSchema.safeParse({ ...receipt, unexpected: plantedMarker })
        .success,
    ).toBe(false)
    expect(() => schemaApi.guardPurgeReceipt({ ...receipt, schemaVersion: 2 })).toThrow(
      /schemaVersion 2 is not supported/u,
    )
  })

  it('refuses a detector-shaped receipt input before deleting any surface', () => {
    const awsKey = 'AKIAIOSFODNN7EXAMPLE'
    const target = publish('receipt-egress-refusal', [
      { t: 'el', role: 'button', name: 'Receipt egress refusal' },
      { t: 'page', route: '/purge/receipt-egress-refusal' },
      { t: 'platform', platform: 'web' },
    ])
    const receiptPath = join(
      knowledgeRoot,
      'memory',
      'receipts',
      `purge-${target.id}.json`,
    )

    const blocked = purgeApi().purgeRecord({
      knowledgeRoot,
      recordId: target.id,
      initiator: awsKey,
    })

    expect(blocked.kind).toBe('egress-blocked')
    expect(blocked.detections).toContainEqual({
      label: `memory/receipts/purge-${target.id}.json`,
      detector: 'awsKey',
    })
    expect(existsSync(target.dir)).toBe(true)
    expect(existsSync(receiptPath)).toBe(false)
    expect(readFileSync(join(root, '.agent-qa', 'guardrail_audit.jsonl'), 'utf8'))
      .toContain('knowledge-bundle:memory/receipts/purge-')
  })

  it('returns a typed noop and preserves the original receipt on repeat purge', () => {
    const target = publish('receipt-idempotent', [
      { t: 'el', role: 'button', name: 'Receipt idempotent' },
      { t: 'page', route: '/purge/receipt-idempotent' },
      { t: 'platform', platform: 'web' },
    ])
    const receiptDir = join(knowledgeRoot, 'memory', 'receipts')
    const receiptPath = join(receiptDir, `purge-${target.id}.json`)

    const first = purgeApi().purgeRecord({
      knowledgeRoot,
      recordId: target.id,
      initiator: 'user',
    })
    const firstBytes = readFileSync(receiptPath)
    const second = purgeApi().purgeRecord({
      knowledgeRoot,
      recordId: target.id,
      initiator: 'different-user-must-not-overwrite',
    })

    expect(first.kind).toBe('purged')
    expect(second.kind).toBe('already-purged')
    expect(second.receipt).toEqual(first.receipt)
    expect(readFileSync(receiptPath)).toEqual(firstBytes)
    expect(readdirSync(receiptDir)).toEqual([`purge-${target.id}.json`])
  })
})
