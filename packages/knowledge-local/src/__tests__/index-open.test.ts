import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import {
  canonicalJson,
  DEFAULT_EMBEDDING_PROFILE,
} from '@vostride/agent-qa-schema'
import type { EmbeddingProfile } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import * as knowledgeLocal from '../index.js'
import { scaffoldKnowledgeRoot } from './fixtures/bundle-fixture.js'

type VecCapability = 'vec0' | 'brute'

interface IndexWriterHandle {
  db: DatabaseSync
  vec: VecCapability
  checkpointPassive(): void
  close(): void
}

interface IndexReaderConnection {
  db: DatabaseSync
  vec: VecCapability
}

type IndexHealth =
  | { ok: true }
  | { ok: false; probe: string; reason: string }

interface IndexOpenApi {
  INDEX_DB_FILE: string
  INDEX_SCHEMA_VERSION: number
  MIN_READABLE_INDEX_SCHEMA_VERSION: number
  INDEX_RENDERING_SCHEMA_VERSION: number
  WRITER_BUSY_TIMEOUT_MS: number
  READER_BUSY_TIMEOUT_MS: number
  CHECKPOINT_EVERY_N_BUNDLES: number
  indexDbPath(knowledgeRoot: string): string
  vecTableName(profile: EmbeddingProfile): string
  openIndexWriter(
    knowledgeRoot: string,
    opts?: { vecLoadablePath?: string },
  ): IndexWriterHandle
  openIndexReaderConnection(
    knowledgeRoot: string,
    opts?: { vecLoadablePath?: string },
  ): IndexReaderConnection
  probeIndexHealth(db: DatabaseSync): IndexHealth
}

const REQUIRED_FUNCTIONS = [
  'indexDbPath',
  'vecTableName',
  'openIndexWriter',
  'openIndexReaderConnection',
  'probeIndexHealth',
] as const

function indexApi(): IndexOpenApi {
  const candidate = knowledgeLocal as unknown as Partial<IndexOpenApi>
  const missing = REQUIRED_FUNCTIONS.filter(
    (name) => typeof candidate[name] !== 'function',
  )
  if (missing.length > 0) {
    throw new Error(`index-open public API is not implemented: ${missing.join(', ')}`)
  }
  return candidate as IndexOpenApi
}

function firstValue(db: DatabaseSync, sql: string): unknown {
  const row = db.prepare(sql).get()
  return row === undefined ? undefined : Object.values(row)[0]
}

function tableNames(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name))
}

describe('index-open', () => {
  let knowledgeRoot: string

  beforeEach(async () => {
    knowledgeRoot = await mkdtemp(join(tmpdir(), 'knowledge-index-open-'))
    scaffoldKnowledgeRoot(knowledgeRoot)
  })

  afterEach(async () => {
    await rm(knowledgeRoot, { recursive: true, force: true })
  })

  it('derives a stable vec0 table name from the embedding profile', () => {
    const api = indexApi()

    expect(api.vecTableName(DEFAULT_EMBEDDING_PROFILE)).toBe(
      'vec_xenova_bge_small_en_v1_5_main_q8_384',
    )
  })

  it('opens the WAL writer, bootstraps the full schema, and stamps meta', () => {
    const api = indexApi()
    const writer = api.openIndexWriter(knowledgeRoot)

    try {
      expect(api.INDEX_DB_FILE).toBe('knowledge.db')
      expect(existsSync(api.indexDbPath(knowledgeRoot))).toBe(true)
      expect(writer.vec).toBe('vec0')
      expect(firstValue(writer.db, 'PRAGMA journal_mode')).toBe('wal')
      expect(tableNames(writer.db)).toEqual(
        expect.arrayContaining([
          'records',
          'fts_records',
          'anchors',
          'graph_nodes',
          'graph_edges',
          'meta',
          api.vecTableName(DEFAULT_EMBEDDING_PROFILE),
        ]),
      )

      const recordColumns = writer.db
        .prepare('PRAGMA table_info(records)')
        .all()
        .map((row) => String(row.name))
      expect(recordColumns).toEqual([
        'record_rowid',
        'bundle_id',
        'product',
        'mutable_state_hash',
        'kind',
        'subtype',
        'scope_tier',
        'scope_key',
        'status',
        'trust',
        'confirmed',
        'contradicted',
        'helpful',
        'harmful',
        'opened_at_ordinal',
        'closed_at_ordinal',
        'created_at_ordinal',
        'origin_class',
        'summary',
        'embedding_input',
        'embed_status',
        'embedding',
      ])

      const profileIdentity = {
        model_id: DEFAULT_EMBEDDING_PROFILE.model_id,
        revision: DEFAULT_EMBEDDING_PROFILE.revision,
        dtype: DEFAULT_EMBEDDING_PROFILE.dtype,
        dim: DEFAULT_EMBEDDING_PROFILE.dim,
      }
      const meta = new Map(
        writer.db
          .prepare('SELECT k, v FROM meta')
          .all()
          .map((row) => [String(row.k), String(row.v)]),
      )
      expect(meta.get('index_schema_version')).toBe(String(api.INDEX_SCHEMA_VERSION))
      expect(meta.get('embedding_profile')).toBe(canonicalJson(profileIdentity))
      expect(meta.get('rendering_schema_version')).toBe(
        String(api.INDEX_RENDERING_SCHEMA_VERSION),
      )

      writer.checkpointPassive()
    } finally {
      writer.close()
    }
  })

  it('falls back to brute while retaining every non-vec table', () => {
    const api = indexApi()
    const writer = api.openIndexWriter(knowledgeRoot, {
      vecLoadablePath: '/nonexistent/vec0.dylib',
    })

    try {
      expect(writer.vec).toBe('brute')
      expect(tableNames(writer.db)).toEqual(
        expect.arrayContaining([
          'records',
          'fts_records',
          'anchors',
          'graph_nodes',
          'graph_edges',
          'meta',
        ]),
      )
      expect(tableNames(writer.db)).not.toContain(
        api.vecTableName(DEFAULT_EMBEDDING_PROFILE),
      )
    } finally {
      writer.close()
    }
  })

  it('requires BigInt binds for vec0 integer primary keys', () => {
    const api = indexApi()
    const writer = api.openIndexWriter(knowledgeRoot)

    try {
      expect(writer.vec).toBe('vec0')
      const tableName = api.vecTableName(DEFAULT_EMBEDDING_PROFILE)
      const insert = writer.db.prepare(
        `INSERT INTO ${tableName} (record_rowid, product, embedding) VALUES (?, ?, ?)`,
      )
      const values = new Float32Array(DEFAULT_EMBEDDING_PROFILE.dim)
      values[0] = 1
      const embedding = Buffer.from(values.buffer)

      expect(() => insert.run(1n, 'fixture-product', embedding)).not.toThrow()
      expect(() => insert.run(2, 'fixture-product', embedding)).toThrow()
    } finally {
      writer.close()
    }
  })

  it('reports schema-version health failures after quick_check passes', () => {
    const api = indexApi()
    const writer = api.openIndexWriter(knowledgeRoot)

    try {
      expect(api.probeIndexHealth(writer.db)).toEqual({ ok: true })
      writer.db
        .prepare("UPDATE meta SET v = '0' WHERE k = 'index_schema_version'")
        .run()
      expect(api.probeIndexHealth(writer.db)).toMatchObject({
        ok: false,
        probe: 'schema-version',
      })
    } finally {
      writer.close()
    }
  })

  it('opens an independently resolved read-only query connection', () => {
    const api = indexApi()
    const writer = api.openIndexWriter(knowledgeRoot)
    writer.close()

    const reader = api.openIndexReaderConnection(knowledgeRoot)
    try {
      expect(reader.vec).toBe('vec0')
      expect(firstValue(reader.db, 'PRAGMA query_only')).toBe(1)
      expect(() =>
        reader.db
          .prepare("INSERT INTO meta (k, v) VALUES ('reader-write', 'forbidden')")
          .run(),
      ).toThrow()
    } finally {
      reader.db.close()
    }
  })

  it('keeps hash-prefixed, hyphenated identity atoms distinct in FTS5', () => {
    const api = indexApi()
    const writer = api.openIndexWriter(knowledgeRoot)

    try {
      const insert = writer.db.prepare(
        'INSERT INTO fts_records (rowid, identity, content) VALUES (?, ?, ?)',
      )
      insert.run(1, '#submit', 'exact selector')
      insert.run(2, '#submit-cancel', 'longer selector')

      const rows = writer.db
        .prepare(
          'SELECT rowid FROM fts_records WHERE fts_records MATCH ? ORDER BY rowid',
        )
        .all('"#submit"')
      expect(rows.map((row) => Number(row.rowid))).toEqual([1])
    } finally {
      writer.close()
    }
  })
})
