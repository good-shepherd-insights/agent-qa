import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { Anchor } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import * as knowledgeLocal from '../index.js'
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

type PublishedBundle = Extract<PublishBundleOutcome, { kind: 'published' }>

interface ReaderOptions {
  product?: string
  k?: number
}

interface KnowledgeReader {
  source: 'index' | 'scan'
  vec: 'vec0' | 'brute' | 'none'
  getById(bundleId: string): knowledgeLocal.KnowledgeHit | undefined
  searchLexical(text: string, opts?: ReaderOptions): knowledgeLocal.KnowledgeHit[]
  lookupAnchor(anchor: Anchor, opts?: ReaderOptions): knowledgeLocal.KnowledgeHit[]
  searchDense(
    embedding: Float32Array,
    opts: ReaderOptions & { k: number },
  ): Array<knowledgeLocal.KnowledgeHit & { distance: number }>
  recheck(hits: readonly knowledgeLocal.KnowledgeHit[]): knowledgeLocal.KnowledgeHit[]
  close(): void
}

interface KnowledgeReaderApi {
  openKnowledgeReader(
    knowledgeRoot: string,
    opts?: { vecLoadablePath?: string },
  ): KnowledgeReader
}

function readerApi(): KnowledgeReaderApi {
  const candidate = knowledgeLocal as unknown as Partial<KnowledgeReaderApi>
  if (typeof candidate.openKnowledgeReader !== 'function') {
    throw new Error('openKnowledgeReader public API is not implemented')
  }
  return candidate as KnowledgeReaderApi
}

describe('IDX-02 degrading knowledge reader', () => {
  let root: string
  let knowledgeRoot: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'knowledge-index-reader-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    scaffoldKnowledgeRoot(knowledgeRoot)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function config(productKey = 'storefront'): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey,
      auditBaseDir: join(root, '.agent-qa'),
      commitArtifacts: 'none',
    }
  }

  function input(overrides: Partial<PublishBundleInput> = {}): PublishBundleInput {
    return {
      draft: makeBundleDraftFixture({
        anchors: [
          { t: 'el', role: 'Button', name: 'Sign in' },
          { t: 'page', route: '/login' },
          { t: 'selector', literal: '#sign-in' },
          { t: 'platform', platform: 'web' },
        ],
      }),
      discriminant: makeDiscriminantFixture(),
      originClass: 'agent-verified',
      createdAtOrdinal: 42,
      screenStates: [makeScreenStateFixture()],
      initialEvents: [],
      relations: [],
      provenance: {
        mode: 'run-linked',
        runId: 'index-reader-run',
        testId: 'index-reader-test',
        stepIndex: 0,
      },
      artifacts: [],
      ...overrides,
    }
  }

  function publish(overrides: Partial<PublishBundleInput> = {}): PublishedBundle {
    const outcome = publishBundle(config(), input(overrides))
    expect(outcome.kind).toBe('published')
    if (outcome.kind !== 'published') {
      throw new Error(`expected publication, got ${outcome.kind}`)
    }
    return outcome
  }

  function expectMarker(reason: knowledgeLocal.RebuildReason): void {
    expect(knowledgeLocal.readRebuildRequest(knowledgeRoot)).toMatchObject({
      present: true,
      request: { reason },
    })
  }

  function expectScanServes(reader: KnowledgeReader, published: PublishedBundle): void {
    expect(reader).toMatchObject({ source: 'scan', vec: 'none' })
    expect(reader.getById(published.id)).toMatchObject({
      bundleId: published.id,
      product: 'storefront',
      status: 'candidate',
    })
    expect(reader.searchLexical('sign in')).toMatchObject([
      { bundleId: published.id, product: 'storefront' },
    ])
  }

  it('opens a healthy rebuilt index with the connection-local vec0 capability', async () => {
    publish()
    await knowledgeLocal.rebuildIndex({ knowledgeRoot })

    const reader = readerApi().openKnowledgeReader(knowledgeRoot)
    try {
      expect(reader).toMatchObject({ source: 'index', vec: 'vec0' })
      expect(knowledgeLocal.readRebuildRequest(knowledgeRoot)).toEqual({ present: false })
    } finally {
      reader.close()
    }
  })

  it('degrades an absent index, requests rebuild, and serves from bundles', () => {
    const published = publish()

    const reader = readerApi().openKnowledgeReader(knowledgeRoot)
    try {
      expectScanServes(reader, published)
      expectMarker('absent')
    } finally {
      reader.close()
    }
  })

  it('degrades garbage index bytes as corrupt without blocking bundle reads', () => {
    const published = publish()
    const indexPath = knowledgeLocal.indexDbPath(knowledgeRoot)
    mkdirSync(dirname(indexPath), { recursive: true })
    writeFileSync(indexPath, 'not a sqlite database', 'utf8')

    const reader = readerApi().openKnowledgeReader(knowledgeRoot)
    try {
      expectScanServes(reader, published)
      expectMarker('corrupt')
    } finally {
      reader.close()
    }
  })

  it.each([
    {
      name: 'below-minimum',
      mutate(db: DatabaseSync): void {
        db.prepare("UPDATE meta SET v = '0' WHERE k = 'index_schema_version'").run()
      },
    },
    {
      name: 'missing',
      mutate(db: DatabaseSync): void {
        db.prepare("DELETE FROM meta WHERE k = 'index_schema_version'").run()
      },
    },
  ])('degrades a $name schema version and serves the authoritative scan', async ({ mutate }) => {
    const published = publish()
    await knowledgeLocal.rebuildIndex({ knowledgeRoot })
    const writer = knowledgeLocal.openIndexWriter(knowledgeRoot)
    try {
      mutate(writer.db)
    } finally {
      writer.close()
    }

    const reader = readerApi().openKnowledgeReader(knowledgeRoot)
    try {
      expectScanServes(reader, published)
      expectMarker('schema-version')
    } finally {
      reader.close()
    }
  })

  it('degrades a real exclusive-lock timeout as locked and keeps serving', async () => {
    const published = publish()
    await knowledgeLocal.rebuildIndex({ knowledgeRoot })
    const locker = new DatabaseSync(knowledgeLocal.indexDbPath(knowledgeRoot), { timeout: 100 })
    locker.exec('PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE')

    try {
      const reader = readerApi().openKnowledgeReader(knowledgeRoot)
      try {
        expectScanServes(reader, published)
        expectMarker('locked')
      } finally {
        reader.close()
      }
    } finally {
      locker.exec('ROLLBACK')
      locker.close()
    }
  })

  it('preserves the first marker and tolerates repeated degraded opens', () => {
    publish()
    const first = readerApi().openKnowledgeReader(knowledgeRoot)
    first.close()
    expectMarker('absent')

    writeFileSync(knowledgeLocal.indexDbPath(knowledgeRoot), 'garbage', 'utf8')
    expect(() => readerApi().openKnowledgeReader(knowledgeRoot).close()).not.toThrow()
    expect(() => readerApi().openKnowledgeReader(knowledgeRoot).close()).not.toThrow()
    expectMarker('absent')
  })
})
