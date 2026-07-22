import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  BundleOutcomeEventSchema,
  DEFAULT_EMBEDDING_PROFILE,
  graphNodeId,
} from '@vostride/agent-qa-schema'
import type { Anchor, CanaryOutcome } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import * as knowledgeLocal from '../index.js'
import type {
  BundleStoreConfig,
  LoadedBundle,
  PublishBundleInput,
  PublishBundleOutcome,
} from '../index.js'
import { enqueueCanaryOutcome } from '../canary-emit.js'
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
  hooks?: {
    afterIntentWritten?: () => void
    afterProjectionPurge?: () => void
    afterBundleRemoval?: () => void
    afterQueueSweep?: () => void
    beforeReceiptPublish?: () => void
  }
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

interface PurgeIntent {
  schemaVersion: number
  purgedRecordId: string
  receipt: PurgeReceipt
  receiptCycle: number
  bundleDirs: string[]
  queueCandidateIds: string[]
  queuePayloadDirs: string[]
}

interface PurgeIntentSchemaApi {
  PURGE_INTENT_SCHEMA_VERSION: number
  purgeIntentSchema: {
    safeParse(value: unknown): { success: boolean }
  }
  guardPurgeIntent(value: unknown): PurgeIntent
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

function purgeIntentSchemaApi(): PurgeIntentSchemaApi {
  const candidate = purgeModule as unknown as Partial<PurgeIntentSchemaApi>
  if (
    typeof candidate.PURGE_INTENT_SCHEMA_VERSION !== 'number'
    || candidate.purgeIntentSchema === undefined
    || typeof candidate.guardPurgeIntent !== 'function'
  ) {
    throw new Error('purge intent schema public API is not implemented')
  }
  return candidate as PurgeIntentSchemaApi
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
    knowledgeLocal.writeJobState({
      knowledgeRoot,
      candidateId: outcome.candidateId,
      lifecycle: 'queued',
    })
    return outcome.candidateId
  }

  function enqueueCanary(
    candidateId: CanaryOutcome['candidateId'],
    identity: string,
  ): string {
    const outcome = enqueueCanaryOutcome(knowledgeRoot, {
      candidateId,
      runOutcome: 'positive',
      runId: `purge-canary-${identity}-run`,
      testId: `purge-canary-${identity}-test`,
      testIndex: 0,
      buildOrdinal: 43,
      stepIndex: 0,
      briefDigest: `purge-canary-${identity}-brief`,
      attribution: `Canary attribution for ${identity}`,
      exercisedAnchor: {
        t: 'el',
        role: 'button',
        name: `Canary control ${identity}`,
      },
    })
    expect(outcome.kind).toBe('enqueued')
    if (outcome.kind !== 'enqueued') {
      throw new Error(`expected ${identity} canary admission, got ${outcome.kind}`)
    }
    knowledgeLocal.writeJobState({
      knowledgeRoot,
      candidateId: outcome.entryId,
      lifecycle: 'queued',
    })
    return outcome.entryId
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

  it('deletes a matching canary outcome by lineage and its queue-entry keyed job state', () => {
    const target = publish('queue-canary-target', [
      { t: 'el', role: 'button', name: 'Canary purge target' },
      { t: 'page', route: '/purge/queue/canary-target' },
      { t: 'platform', platform: 'web' },
    ])
    const unrelated = publish('queue-canary-unrelated-record', [
      { t: 'el', role: 'link', name: 'Unrelated canary record' },
      { t: 'page', route: '/purge/queue/canary-unrelated' },
      { t: 'platform', platform: 'web' },
    ])
    const matchedEntryId = enqueueCanary(target.id, 'matching')
    const survivorEntryId = enqueueCanary(unrelated.id, 'survivor')
    const matchedDir = knowledgeLocal.queuedCandidateDir(knowledgeRoot, matchedEntryId)
    const survivorDir = knowledgeLocal.queuedCandidateDir(knowledgeRoot, survivorEntryId)
    const survivorPayloadBytes = readFileSync(join(survivorDir, 'payload.json'))
    const survivorStatePath = knowledgeLocal.jobStatePath(knowledgeRoot, survivorEntryId)
    const survivorStateBytes = readFileSync(survivorStatePath)
    let intentAtPublication: PurgeIntent | undefined

    expect(matchedEntryId).not.toBe(target.id)
    const outcome = purgeApi().purgeRecord({
      knowledgeRoot,
      recordId: target.id,
      initiator: 'user',
      hooks: {
        afterIntentWritten: () => {
          intentAtPublication = purgeIntentSchemaApi().guardPurgeIntent(
            JSON.parse(
              readFileSync(
                join(
                  knowledgeRoot,
                  'memory',
                  'receipts',
                  `purge-${target.id}.intent.json`,
                ),
                'utf8',
              ),
            ),
          )
          expect(existsSync(matchedDir)).toBe(true)
          expect(
            existsSync(knowledgeLocal.jobStatePath(knowledgeRoot, matchedEntryId)),
          ).toBe(true)
        },
      },
    })

    expect(outcome.kind).toBe('purged')
    expect(intentAtPublication?.queueCandidateIds).toEqual([matchedEntryId])
    expect(intentAtPublication?.queuePayloadDirs).toEqual([
      relative(knowledgeRoot, matchedDir),
    ])
    expect(existsSync(matchedDir)).toBe(false)
    expect(existsSync(knowledgeLocal.jobStatePath(knowledgeRoot, matchedEntryId))).toBe(
      false,
    )
    expect(existsSync(survivorDir)).toBe(true)
    expect(readFileSync(join(survivorDir, 'payload.json'))).toEqual(survivorPayloadBytes)
    expect(readFileSync(survivorStatePath)).toEqual(survivorStateBytes)
  })

  it('resumes the persisted canary deletion set without rescanning changed payload bytes', () => {
    const target = publish('queue-canary-resume-target', [
      { t: 'el', role: 'button', name: 'Canary resume target' },
      { t: 'page', route: '/purge/queue/canary-resume' },
      { t: 'platform', platform: 'web' },
    ])
    const matchedEntryId = enqueueCanary(target.id, 'resume-matching')
    const matchedDir = knowledgeLocal.queuedCandidateDir(knowledgeRoot, matchedEntryId)
    const intentFile = join(
      knowledgeRoot,
      'memory',
      'receipts',
      `purge-${target.id}.intent.json`,
    )

    expect(() =>
      purgeApi().purgeRecord({
        knowledgeRoot,
        recordId: target.id,
        initiator: 'user',
        hooks: {
          afterIntentWritten: () => {
            throw new Error('injected crash after canary intent')
          },
        },
      }),
    ).toThrow('injected crash after canary intent')

    const intent = purgeIntentSchemaApi().guardPurgeIntent(
      JSON.parse(readFileSync(intentFile, 'utf8')),
    )
    expect(intent.queueCandidateIds).toEqual([matchedEntryId])
    expect(intent.queuePayloadDirs).toEqual([relative(knowledgeRoot, matchedDir)])

    writeFileSync(join(matchedDir, 'payload.json'), '{"changedAfterIntent":true}\n')

    expect(purge(target.id).kind).toBe('purged')
    expect(existsSync(matchedDir)).toBe(false)
    expect(existsSync(knowledgeLocal.jobStatePath(knowledgeRoot, matchedEntryId))).toBe(
      false,
    )
    expect(existsSync(intentFile)).toBe(false)
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
    knowledgeLocal.writeJobState({
      knowledgeRoot,
      candidateId: digestMatchId,
      lifecycle: 'queued',
    })
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
      purgedAtOrdinal: 48,
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

  it('refuses ordinal exhaustion before intent publication or irreversible mutation', () => {
    const target = publish(
      'ordinal-exhaustion',
      [
        { t: 'el', role: 'button', name: 'Ordinal exhaustion target' },
        { t: 'page', route: '/purge/ordinal-exhaustion' },
        { t: 'platform', platform: 'web' },
      ],
      {
        createdAtOrdinal: Number.MAX_SAFE_INTEGER,
        provenance: {
          mode: 'run-linked',
          runId: 'purge-ordinal-exhaustion-run',
          testId: 'purge-ordinal-exhaustion-test',
          stepIndex: 0,
          sourceBuildOrdinal: Number.MAX_SAFE_INTEGER,
        },
      },
    )
    const receiptsDir = join(knowledgeRoot, 'memory', 'receipts')
    let intentPublished = false

    expect(() =>
      purgeApi().purgeRecord({
        knowledgeRoot,
        recordId: target.id,
        initiator: 'user',
        hooks: {
          afterIntentWritten: () => {
            intentPublished = true
          },
        },
      }),
    ).toThrow(RangeError)

    expect(intentPublished).toBe(false)
    expect(existsSync(target.dir)).toBe(true)
    expect(existsSync(join(receiptsDir, `purge-${target.id}.intent.json`))).toBe(false)
    expect(existsSync(join(receiptsDir, `purge-${target.id}.json`))).toBe(false)
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

  describe('CR-04 crash-durable purge intent', () => {
    const BOUNDARIES = [
      'afterIntentWritten',
      'afterProjectionPurge',
      'afterBundleRemoval',
      'afterQueueSweep',
      'beforeReceiptPublish',
    ] as const
    type CrashBoundary = (typeof BOUNDARIES)[number]

    const bundleSurvivesCrash: Record<CrashBoundary, boolean> = {
      afterIntentWritten: true,
      afterProjectionPurge: true,
      afterBundleRemoval: false,
      afterQueueSweep: false,
      beforeReceiptPublish: false,
    }
    const projectionRowSurvivesCrash: Record<CrashBoundary, boolean> = {
      afterIntentWritten: true,
      afterProjectionPurge: false,
      afterBundleRemoval: false,
      afterQueueSweep: false,
      beforeReceiptPublish: false,
    }
    const matchedPayloadSurvivesCrash: Record<CrashBoundary, boolean> = {
      afterIntentWritten: true,
      afterProjectionPurge: true,
      afterBundleRemoval: true,
      afterQueueSweep: false,
      beforeReceiptPublish: false,
    }

    function intentFilePath(recordId: string): string {
      return join(knowledgeRoot, 'memory', 'receipts', `purge-${recordId}.intent.json`)
    }

    function receiptFilePath(recordId: string): string {
      return join(knowledgeRoot, 'memory', 'receipts', `purge-${recordId}.json`)
    }

    function recordsRowPresent(recordId: string): boolean {
      const reader = knowledgeLocal.openIndexReaderConnection(knowledgeRoot)
      try {
        return (
          reader.db.prepare('SELECT 1 FROM records WHERE bundle_id = ?').get(recordId)
          !== undefined
        )
      } finally {
        reader.db.close()
      }
    }

    interface CrashFixture {
      targetId: string
      targetDir: string
      matchedId: string
      survivorId: string
      sentinels: { summary: string; body: string; anchorName: string }
    }

    async function publishCrashFixture(identity: string): Promise<CrashFixture> {
      const sentinels = {
        summary: `SENTINEL-SUMMARY-${identity} stays out of durable purge artifacts`,
        body: `SENTINEL-BODY-${identity} confirmed-sensitive content never copied forward`,
        anchorName: `Sentinel anchor ${identity}`,
      }
      const anchors = [
        { t: 'el', role: 'button', name: sentinels.anchorName },
        { t: 'page', route: `/purge/crash/${identity}` },
        { t: 'platform', platform: 'web' },
      ] satisfies Anchor[]
      const target = publish(identity, anchors, {
        draft: makeBundleDraftFixture({
          anchors: [...anchors],
          scope: { tier: 'product', key: PRODUCT },
          summary: sentinels.summary,
          body: sentinels.body,
        }),
      })
      const matchedId = enqueue(
        `${identity}-matched`,
        [
          { t: 'el', role: 'link', name: `Disjoint matched control ${identity}` },
          { t: 'page', route: `/purge/crash/${identity}/matched` },
          { t: 'platform', platform: 'web' },
        ],
        { bodySeed: sentinels.body },
      )
      const survivorId = enqueue(`${identity}-survivor`, [
        { t: 'el', role: 'link', name: `Unrelated survivor control ${identity}` },
        { t: 'page', route: `/purge/crash/${identity}/survivor` },
        { t: 'platform', platform: 'web' },
      ])
      await knowledgeLocal.rebuildIndex({ knowledgeRoot, embedder: makeFakeEmbedder() })
      return {
        targetId: target.id,
        targetDir: target.dir,
        matchedId,
        survivorId,
        sentinels,
      }
    }

    function crashingPurge(
      recordId: string,
      boundary: CrashBoundary,
    ): () => PurgeRecordOutcome {
      const hooks: NonNullable<PurgeRecordInput['hooks']> = {}
      hooks[boundary] = () => {
        throw new Error(`injected crash at ${boundary}`)
      }
      return () =>
        purgeApi().purgeRecord({ knowledgeRoot, recordId, initiator: 'user', hooks })
    }

    for (const boundary of BOUNDARIES) {
      it(`recovers to the identical receipt after a crash at ${boundary}`, async () => {
        const fixture = await publishCrashFixture(`crash-${boundary.toLowerCase()}`)
        const matchedDir = knowledgeLocal.queuedCandidateDir(knowledgeRoot, fixture.matchedId)
        const survivorDir = knowledgeLocal.queuedCandidateDir(
          knowledgeRoot,
          fixture.survivorId,
        )

        expect(crashingPurge(fixture.targetId, boundary)).toThrow(
          `injected crash at ${boundary}`,
        )

        expect(existsSync(receiptFilePath(fixture.targetId))).toBe(false)
        const intentText = readFileSync(intentFilePath(fixture.targetId), 'utf8')
        const intent = purgeIntentSchemaApi().guardPurgeIntent(JSON.parse(intentText))
        expect(intent.purgedRecordId).toBe(fixture.targetId)
        expect(intent.queueCandidateIds).toEqual([fixture.matchedId])
        expect(intent.bundleDirs).toEqual([relative(knowledgeRoot, fixture.targetDir)])

        expect(existsSync(fixture.targetDir)).toBe(bundleSurvivesCrash[boundary])
        expect(recordsRowPresent(fixture.targetId)).toBe(projectionRowSurvivesCrash[boundary])
        expect(existsSync(matchedDir)).toBe(matchedPayloadSurvivesCrash[boundary])
        expect(existsSync(knowledgeLocal.jobStatePath(knowledgeRoot, fixture.matchedId))).toBe(
          matchedPayloadSurvivesCrash[boundary],
        )
        expect(existsSync(survivorDir)).toBe(true)

        const retry = purge(fixture.targetId)
        expect(retry.kind).toBe('purged')
        expect(retry.receipt).toEqual(intent.receipt)
        expect(
          JSON.parse(readFileSync(receiptFilePath(fixture.targetId), 'utf8')),
        ).toEqual(intent.receipt)
        expect(existsSync(fixture.targetDir)).toBe(false)
        expect(recordsRowPresent(fixture.targetId)).toBe(false)
        expect(existsSync(matchedDir)).toBe(false)
        expect(
          existsSync(knowledgeLocal.jobStatePath(knowledgeRoot, fixture.matchedId)),
        ).toBe(false)
        expect(existsSync(survivorDir)).toBe(true)
        expect(
          existsSync(knowledgeLocal.jobStatePath(knowledgeRoot, fixture.survivorId)),
        ).toBe(true)
        expect(existsSync(intentFilePath(fixture.targetId))).toBe(false)

        const third = purge(fixture.targetId)
        expect(third.kind).toBe('already-purged')
        expect(third.receipt).toEqual(intent.receipt)
      })
    }

    it('leaves every surface intact when a crash precedes the intent and a plain retry completes', async () => {
      const fixture = await publishCrashFixture('crash-pre-intent')
      const receiptsDir = join(knowledgeRoot, 'memory', 'receipts')
      mkdirSync(join(knowledgeRoot, 'memory'), { recursive: true })
      writeFileSync(receiptsDir, 'blocks the receipts directory so durable publication fails')

      expect(() => purge(fixture.targetId)).toThrow()

      expect(existsSync(fixture.targetDir)).toBe(true)
      expect(recordsRowPresent(fixture.targetId)).toBe(true)
      expect(
        existsSync(knowledgeLocal.queuedCandidateDir(knowledgeRoot, fixture.matchedId)),
      ).toBe(true)
      expect(existsSync(knowledgeLocal.jobStatePath(knowledgeRoot, fixture.matchedId))).toBe(
        true,
      )
      expect(existsSync(intentFilePath(fixture.targetId))).toBe(false)

      rmSync(receiptsDir, { force: true })
      const retry = purge(fixture.targetId)
      expect(retry.kind).toBe('purged')
      expect(existsSync(receiptFilePath(fixture.targetId))).toBe(true)
      expect(existsSync(fixture.targetDir)).toBe(false)
      expect(recordsRowPresent(fixture.targetId)).toBe(false)
      expect(
        existsSync(knowledgeLocal.queuedCandidateDir(knowledgeRoot, fixture.matchedId)),
      ).toBe(false)
      expect(
        existsSync(knowledgeLocal.queuedCandidateDir(knowledgeRoot, fixture.survivorId)),
      ).toBe(true)
      expect(existsSync(intentFilePath(fixture.targetId))).toBe(false)
    })

    it('derives byte-identical intent text over identical store state', async () => {
      const fixture = await publishCrashFixture('intent-determinism')

      expect(crashingPurge(fixture.targetId, 'afterIntentWritten')).toThrow(
        'injected crash at afterIntentWritten',
      )
      const firstIntentText = readFileSync(intentFilePath(fixture.targetId), 'utf8')

      rmSync(intentFilePath(fixture.targetId), { force: true })

      expect(crashingPurge(fixture.targetId, 'afterIntentWritten')).toThrow(
        'injected crash at afterIntentWritten',
      )
      const secondIntentText = readFileSync(intentFilePath(fixture.targetId), 'utf8')

      expect(secondIntentText).toBe(firstIntentText)
    })

    it('keeps purged content out of intent and receipt bytes', async () => {
      const fixture = await publishCrashFixture('intent-content-free')

      expect(crashingPurge(fixture.targetId, 'beforeReceiptPublish')).toThrow(
        'injected crash at beforeReceiptPublish',
      )
      const intentText = readFileSync(intentFilePath(fixture.targetId), 'utf8')
      expect(intentText).not.toContain(fixture.sentinels.summary)
      expect(intentText).not.toContain(fixture.sentinels.body)
      expect(intentText).not.toContain(fixture.sentinels.anchorName)

      const schemaApi = purgeIntentSchemaApi()
      const intent = JSON.parse(intentText) as Record<string, unknown>
      expect(schemaApi.PURGE_INTENT_SCHEMA_VERSION).toBe(2)
      expect(schemaApi.purgeIntentSchema.safeParse(intent).success).toBe(true)
      expect(
        schemaApi.purgeIntentSchema.safeParse({ ...intent, unexpected: 'field' }).success,
      ).toBe(false)
      expect(() => schemaApi.guardPurgeIntent({ ...intent, schemaVersion: 3 })).toThrow(
        /schemaVersion 3 is not supported/u,
      )
      const { receiptCycle: _dropped, ...v1Shape } = intent
      const migrated = schemaApi.guardPurgeIntent({ ...v1Shape, schemaVersion: 1 })
      expect(migrated.schemaVersion).toBe(2)
      expect(migrated.receiptCycle).toBe(1)

      const retry = purge(fixture.targetId)
      expect(retry.kind).toBe('purged')
      const receiptText = readFileSync(receiptFilePath(fixture.targetId), 'utf8')
      expect(receiptText).not.toContain(fixture.sentinels.summary)
      expect(receiptText).not.toContain(fixture.sentinels.body)
      expect(receiptText).not.toContain(fixture.sentinels.anchorName)
    })
  })

  describe('DCAY-05 revive-then-purge receipt series', () => {
    function seriesReceiptPath(recordId: string, cycle: number): string {
      return join(
        knowledgeRoot,
        'memory',
        'receipts',
        cycle === 1 ? `purge-${recordId}.json` : `purge-${recordId}.${cycle}.json`,
      )
    }

    function seriesIntentPath(recordId: string): string {
      return join(knowledgeRoot, 'memory', 'receipts', `purge-${recordId}.intent.json`)
    }

    function projectionRows(recordId: string): {
      records: boolean
      fts: boolean
      anchors: boolean
    } {
      const reader = knowledgeLocal.openIndexReaderConnection(knowledgeRoot)
      try {
        const row = reader.db
          .prepare('SELECT record_rowid FROM records WHERE bundle_id = ?')
          .get(recordId)
        if (row === undefined) return { records: false, fts: false, anchors: false }
        const rowid = Number(row.record_rowid)
        return {
          records: true,
          fts:
            reader.db.prepare('SELECT 1 FROM fts_records WHERE rowid = ?').get(rowid)
            !== undefined,
          anchors:
            reader.db.prepare('SELECT 1 FROM anchors WHERE record_rowid = ?').get(rowid)
            !== undefined,
        }
      } finally {
        reader.db.close()
      }
    }

    const reviveSentinels = {
      summary: 'SENTINEL-REVIVE-SUMMARY stays out of every series member',
      body: 'SENTINEL-REVIVE-BODY confirmed-sensitive content re-learned after purge',
      anchorName: 'Sentinel revive anchor',
    }

    function revivePublishInput(): Parameters<typeof publish> {
      const anchors = [
        { t: 'el', role: 'button', name: reviveSentinels.anchorName },
        { t: 'page', route: '/purge/revive/cycle' },
        { t: 'platform', platform: 'web' },
      ] satisfies Anchor[]
      return [
        'revive-cycle',
        anchors,
        {
          draft: makeBundleDraftFixture({
            anchors: [...anchors],
            scope: { tier: 'product', key: PRODUCT },
            summary: reviveSentinels.summary,
            body: reviveSentinels.body,
          }),
        },
      ]
    }

    function confirmRevived(
      recordId: Parameters<typeof knowledgeLocal.appendOutcomeEvent>[1],
      buildOrdinal: number,
    ): void {
      const appended = knowledgeLocal.appendOutcomeEvent(
        config(),
        recordId,
        BundleOutcomeEventSchema.parse({
          type: 'confirmed',
          evidenceToken: `revive-confirmed-${buildOrdinal}`,
          curationJobId: `revive-confirmed-job-${buildOrdinal}`,
          buildOrdinal,
          origin: 'agent-verified',
        }),
      )
      expect(appended.kind).toBe('appended')
    }

    it('advances a fresh cycle strictly beyond its prior receipt chronology', () => {
      const first = publish(...revivePublishInput())
      const cycleOne = purge(first.id)
      expect(cycleOne.kind).toBe('purged')
      expect(cycleOne.receipt).toBeDefined()

      const revived = publish(...revivePublishInput())
      expect(revived.id).toBe(first.id)
      const cycleTwo = purge(first.id)

      expect(cycleTwo.kind).toBe('purged')
      expect(cycleTwo.receipt?.purgedAtOrdinal).toBe(
        cycleOne.receipt!.purgedAtOrdinal + 1,
      )
    })

    it('runs a fresh destruction cycle over revived live surfaces and appends the cycle-2 receipt', async () => {
      const first = publish(...revivePublishInput())
      await knowledgeLocal.rebuildIndex({ knowledgeRoot, embedder: makeFakeEmbedder() })

      expect(purge(first.id).kind).toBe('purged')
      const cycleOneBytes = readFileSync(seriesReceiptPath(first.id, 1))

      // Revival through the public writer: identical content re-mints the SAME content address.
      const revived = publish(...revivePublishInput())
      expect(revived.id).toBe(first.id)
      confirmRevived(revived.id, 77)
      await knowledgeLocal.rebuildIndex({ knowledgeRoot, embedder: makeFakeEmbedder() })
      expect(projectionRows(first.id)).toEqual({ records: true, fts: true, anchors: true })

      const matchedId = enqueue(
        'revive-matched',
        [
          { t: 'el', role: 'link', name: 'Disjoint revive matched control' },
          { t: 'page', route: '/purge/revive/matched' },
          { t: 'platform', platform: 'web' },
        ],
        { bodySeed: reviveSentinels.body },
      )
      const survivorId = enqueue('revive-survivor', [
        { t: 'el', role: 'link', name: 'Unrelated revive survivor control' },
        { t: 'page', route: '/purge/revive/survivor' },
        { t: 'platform', platform: 'web' },
      ])

      let intentText = ''
      const second = purgeApi().purgeRecord({
        knowledgeRoot,
        recordId: first.id,
        initiator: 'user',
        hooks: {
          afterIntentWritten: () => {
            intentText = readFileSync(seriesIntentPath(first.id), 'utf8')
          },
        },
      })

      // A false already-purged over live surfaces is the defect under test.
      expect(second.kind).toBe('purged')
      expect(existsSync(seriesReceiptPath(first.id, 2))).toBe(true)
      const cycleTwoText = readFileSync(seriesReceiptPath(first.id, 2), 'utf8')
      const cycleTwo = purgeReceiptSchemaApi().guardPurgeReceipt(JSON.parse(cycleTwoText))
      expect(cycleTwo.purgedRecordId).toBe(first.id)
      expect(cycleTwo.purgedAtOrdinal).toBe(78)
      expect(second.receipt).toEqual(cycleTwo)

      // The original audit fact never changes: the series is append-only.
      expect(readFileSync(seriesReceiptPath(first.id, 1))).toEqual(cycleOneBytes)

      expect(existsSync(revived.dir)).toBe(false)
      expect(projectionRows(first.id)).toEqual({ records: false, fts: false, anchors: false })
      expect(
        existsSync(knowledgeLocal.queuedCandidateDir(knowledgeRoot, matchedId)),
      ).toBe(false)
      expect(existsSync(knowledgeLocal.jobStatePath(knowledgeRoot, matchedId))).toBe(false)
      expect(
        existsSync(knowledgeLocal.queuedCandidateDir(knowledgeRoot, survivorId)),
      ).toBe(true)
      expect(existsSync(knowledgeLocal.jobStatePath(knowledgeRoot, survivorId))).toBe(true)

      // Series content-freedom: every member of the deletion trail stays sentinel-free.
      const revivalIntent = purgeIntentSchemaApi().guardPurgeIntent(JSON.parse(intentText))
      expect(revivalIntent.receiptCycle).toBe(2)
      for (const bytes of [cycleTwoText, intentText]) {
        expect(bytes).not.toContain(reviveSentinels.summary)
        expect(bytes).not.toContain(reviveSentinels.body)
        expect(bytes).not.toContain(reviveSentinels.anchorName)
      }
      expect(existsSync(seriesIntentPath(first.id))).toBe(false)
    })

    it('attests already-purged with the latest series receipt over verified-dead surfaces', () => {
      const first = publish(...revivePublishInput())
      expect(purge(first.id).kind).toBe('purged')

      const revived = publish(...revivePublishInput())
      expect(revived.id).toBe(first.id)
      confirmRevived(revived.id, 77)
      expect(purge(first.id).kind).toBe('purged')

      const third = purge(first.id)
      expect(third.kind).toBe('already-purged')
      const cycleTwo = JSON.parse(
        readFileSync(seriesReceiptPath(first.id, 2), 'utf8'),
      ) as PurgeReceipt
      expect(third.receipt).toEqual(cycleTwo)
      expect(third.receipt?.purgedAtOrdinal).toBe(78)
      expect(existsSync(seriesIntentPath(first.id))).toBe(false)
      expect(existsSync(seriesReceiptPath(first.id, 3))).toBe(false)
    })

    it('recovers a crashed revival purge to the intent own cycle with earlier cycles untouched', () => {
      const first = publish(...revivePublishInput())
      expect(purge(first.id).kind).toBe('purged')
      const second = publish(...revivePublishInput())
      expect(second.id).toBe(first.id)
      expect(purge(first.id).kind).toBe('purged')
      const third = publish(...revivePublishInput())
      expect(third.id).toBe(first.id)

      const cycleOneBytes = readFileSync(seriesReceiptPath(first.id, 1))
      const cycleTwoBytes = readFileSync(seriesReceiptPath(first.id, 2))

      expect(() =>
        purgeApi().purgeRecord({
          knowledgeRoot,
          recordId: first.id,
          initiator: 'user',
          hooks: {
            beforeReceiptPublish: () => {
              throw new Error('injected crash at beforeReceiptPublish')
            },
          },
        }),
      ).toThrow('injected crash at beforeReceiptPublish')

      const intent = purgeIntentSchemaApi().guardPurgeIntent(
        JSON.parse(readFileSync(seriesIntentPath(first.id), 'utf8')),
      )
      expect(intent.receiptCycle).toBe(3)
      expect(existsSync(seriesReceiptPath(first.id, 3))).toBe(false)

      const retry = purge(first.id)
      expect(retry.kind).toBe('purged')
      expect(retry.receipt).toEqual(intent.receipt)
      expect(
        JSON.parse(readFileSync(seriesReceiptPath(first.id, 3), 'utf8')),
      ).toEqual(intent.receipt)
      expect(readFileSync(seriesReceiptPath(first.id, 1))).toEqual(cycleOneBytes)
      expect(readFileSync(seriesReceiptPath(first.id, 2))).toEqual(cycleTwoBytes)
      expect(existsSync(seriesIntentPath(first.id))).toBe(false)
      expect(existsSync(third.dir)).toBe(false)
    })

    it('rejects a dotted record id so the receipt series namespace stays injective', () => {
      const target = publish('dotted-guard', [
        { t: 'el', role: 'button', name: 'Dotted guard target' },
        { t: 'page', route: '/purge/revive/dotted-guard' },
        { t: 'platform', platform: 'web' },
      ])

      // Record X's cycle-2 receipt path must never be addressable as record id `X.2`.
      expect(() =>
        purgeApi().purgeRecord({
          knowledgeRoot,
          recordId: `${target.id}.2`,
          initiator: 'user',
        }),
      ).toThrow(TypeError)

      expect(existsSync(target.dir)).toBe(true)
      expect(existsSync(join(knowledgeRoot, 'memory', 'receipts'))).toBe(false)
    })
  })
})
