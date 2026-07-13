import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { DEFAULT_EMBEDDING_PROFILE } from '@vostride/agent-qa-schema'
import type { EmbeddingProfile } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  dropEmbedCacheForModel,
  ensureEmbedCacheTable,
  getCachedEmbedding,
  wrapEmbedderWithCache,
} from '../embed-cache.js'
import type { EmbedderPort } from '../embedder-port.js'
import { makeFakeEmbedder } from './fixtures/fake-embedder.js'

interface CountingEmbedder {
  embedder: EmbedderPort
  calls: {
    document: number
    query: number
  }
}

function profileWith(overrides: Partial<EmbeddingProfile> = {}): EmbeddingProfile {
  return {
    ...DEFAULT_EMBEDDING_PROFILE,
    ...overrides,
  }
}

function makeCountingEmbedder(profile: EmbeddingProfile): CountingEmbedder {
  const base = makeFakeEmbedder(profile.dim)
  const calls = { document: 0, query: 0 }

  return {
    calls,
    embedder: {
      async embedDocument(rendering: string): Promise<Float32Array> {
        calls.document += 1
        return base.embedDocument(`${profile.doc_prefix}${rendering}`)
      },
      async embedQuery(rendering: string): Promise<Float32Array> {
        calls.query += 1
        return base.embedQuery(`${profile.query_prefix}${rendering}`)
      },
    },
  }
}

function byteView(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength)
}

describe('content-hash embed cache', () => {
  let root: string
  let dbPath: string
  let db: DatabaseSync

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-embed-cache-'))
    dbPath = join(root, 'knowledge.db')
    db = new DatabaseSync(dbPath)
    ensureEmbedCacheTable(db)
  })

  afterEach(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('short-circuits a repeated document embed and returns identical bytes', async () => {
    const profile = profileWith()
    const counting = makeCountingEmbedder(profile)
    const cached = wrapEmbedderWithCache({
      embedder: counting.embedder,
      profile,
      db,
      mode: 'check-and-store',
    })

    const first = await cached.embedDocument('exact canonical rendering')
    const second = await cached.embedDocument('exact canonical rendering')

    expect(counting.calls).toEqual({ document: 1, query: 0 })
    expect(byteView(second)).toEqual(byteView(first))
    expect(db.prepare('SELECT count(*) AS count FROM embed_cache').get()?.count).toBe(1)
  })

  it('keeps document and query rows separate for the same raw rendering', async () => {
    const profile = profileWith()
    const counting = makeCountingEmbedder(profile)
    const cached = wrapEmbedderWithCache({
      embedder: counting.embedder,
      profile,
      db,
      mode: 'check-and-store',
    })

    const document = await cached.embedDocument('shared rendering')
    const query = await cached.embedQuery('shared rendering')
    expect(byteView(query)).not.toEqual(byteView(document))

    expect(byteView(await cached.embedDocument('shared rendering'))).toEqual(byteView(document))
    expect(byteView(await cached.embedQuery('shared rendering'))).toEqual(byteView(query))
    expect(counting.calls).toEqual({ document: 1, query: 1 })
    expect(
      db
        .prepare('SELECT leg FROM embed_cache ORDER BY leg')
        .all()
        .map((row) => row.leg),
    ).toEqual(['doc', 'query'])
  })

  it('drops rows only for the selected model id', async () => {
    const firstProfile = profileWith({ model_id: 'fixture/model-one' })
    const secondProfile = profileWith({ model_id: 'fixture/model-two' })
    const first = wrapEmbedderWithCache({
      embedder: makeCountingEmbedder(firstProfile).embedder,
      profile: firstProfile,
      db,
      mode: 'check-and-store',
    })
    const second = wrapEmbedderWithCache({
      embedder: makeCountingEmbedder(secondProfile).embedder,
      profile: secondProfile,
      db,
      mode: 'check-and-store',
    })

    await first.embedDocument('first model row')
    await second.embedDocument('second model row')
    dropEmbedCacheForModel(db, firstProfile.model_id)

    expect(
      getCachedEmbedding({
        db,
        profile: firstProfile,
        leg: 'doc',
        rendering: 'first model row',
      }),
    ).toBeUndefined()
    expect(
      getCachedEmbedding({
        db,
        profile: secondProfile,
        leg: 'doc',
        rendering: 'second model row',
      }),
    ).toBeInstanceOf(Float32Array)
  })

  it('checks and embeds on a query-only connection without attempting a write', async () => {
    const profile = profileWith()
    const counting = makeCountingEmbedder(profile)
    const reader = new DatabaseSync(dbPath, { readOnly: true })
    reader.exec('PRAGMA query_only=1')

    try {
      const cached = wrapEmbedderWithCache({
        embedder: counting.embedder,
        profile,
        db: reader,
        mode: 'check-only',
      })

      await expect(cached.embedQuery('read-only cache miss')).resolves.toBeInstanceOf(
        Float32Array,
      )
      expect(counting.calls).toEqual({ document: 0, query: 1 })
      expect(db.prepare('SELECT count(*) AS count FROM embed_cache').get()?.count).toBe(0)
    } finally {
      reader.close()
    }
  })

  it('keys the row from the exact raw rendering before prefix application', async () => {
    const profile = profileWith()
    const rendering = 'raw rendering with trailing space '
    const cached = wrapEmbedderWithCache({
      embedder: makeCountingEmbedder(profile).embedder,
      profile,
      db,
      mode: 'check-and-store',
    })

    await cached.embedQuery(rendering)

    const row = db
      .prepare('SELECT rendering_sha256 FROM embed_cache')
      .get()
    expect(row?.rendering_sha256).toBe(
      createHash('sha256').update(rendering).digest('hex'),
    )
    expect(row?.rendering_sha256).not.toBe(
      createHash('sha256').update(`${profile.query_prefix}${rendering}`).digest('hex'),
    )
  })
})
