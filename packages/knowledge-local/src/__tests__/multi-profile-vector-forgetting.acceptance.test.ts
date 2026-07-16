import { rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import {
  BundleOutcomeEventSchema,
  DEFAULT_EMBEDDING_PROFILE,
  STATIC_FLOOR_EMBEDDING_PROFILE,
  slugBranch,
} from '@vostride/agent-qa-schema'
import type { EmbeddingProfile } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const vecLoadable = vi.hoisted(() => ({ override: undefined as string | undefined }))

vi.mock('../sqlite-vec-loadable.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sqlite-vec-loadable.js')>()
  return {
    ...actual,
    getLoadablePath: () => vecLoadable.override ?? actual.getLoadablePath(),
  }
})

import * as knowledgeLocal from '../index.js'
import * as indexOpen from '../index-open.js'
import { projectBundleIndexRow } from '../index-rebuild.js'
import type {
  BundleStoreConfig,
  PublishBundleInput,
  PublishBundleOutcome,
} from '../index.js'
import {
  makeBundleDraftFixture,
  makeDiscriminantFixture,
  makeScreenStateFixture,
  scaffoldKnowledgeRoot,
} from './fixtures/bundle-fixture.js'
import { makeFakeEmbedder } from './fixtures/fake-embedder.js'

type PublishedBundle = Extract<PublishBundleOutcome, { kind: 'published' }>

interface SchemaVecAuthorityApi {
  SCHEMA_OWNED_EMBEDDING_PROFILES: readonly [EmbeddingProfile, EmbeddingProfile]
  materializedSchemaVecTableNames(db: DatabaseSync): string[]
  deleteRecordFromAllSchemaVecTables(db: DatabaseSync, recordRowid: number): void
}

function schemaVecAuthorityApi(): SchemaVecAuthorityApi {
  const candidate = indexOpen as unknown as Partial<SchemaVecAuthorityApi>
  if (
    candidate.SCHEMA_OWNED_EMBEDDING_PROFILES === undefined
    || typeof candidate.materializedSchemaVecTableNames !== 'function'
    || typeof candidate.deleteRecordFromAllSchemaVecTables !== 'function'
  ) {
    throw new Error('schema-owned vec table authority is not implemented')
  }
  return candidate as SchemaVecAuthorityApi
}

function tableRows(
  db: DatabaseSync,
  profile: EmbeddingProfile,
): Array<{ recordRowid: number; bundleId: string }> {
  return db.prepare(`
    SELECT vec.record_rowid, records.bundle_id
    FROM ${knowledgeLocal.vecTableName(profile)} AS vec
    JOIN records ON records.record_rowid = vec.record_rowid
    ORDER BY records.bundle_id
  `).all().map((row) => ({
    recordRowid: Number(row.record_rowid),
    bundleId: String(row.bundle_id),
  }))
}

describe('multi-profile vector forgetting acceptance', () => {
  let root: string
  let knowledgeRoot: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'knowledge-multi-profile-forgetting-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    scaffoldKnowledgeRoot(knowledgeRoot)
    vecLoadable.override = undefined
  })

  afterEach(() => {
    vecLoadable.override = undefined
    rmSync(root, { recursive: true, force: true })
  })

  function config(productKey = 'Multi Profile Product'): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey,
      auditBaseDir: join(root, '.agent-qa'),
      commitArtifacts: 'none',
    }
  }

  function input(label: string): PublishBundleInput {
    const key = slugBranch(label)
    return {
      draft: makeBundleDraftFixture({
        anchors: [
          { t: 'el', role: 'Button', name: label },
          { t: 'page', route: `/multi-profile/${key}` },
          { t: 'platform', platform: 'web' },
        ],
        scope: { tier: 'product', key },
        summary: `${label} multi-profile control`,
        body: `Selecting ${label} exercises the multi-profile forgetting fixture.`,
      }),
      discriminant: makeDiscriminantFixture(),
      originClass: 'agent-verified',
      createdAtOrdinal: 42,
      screenStates: [makeScreenStateFixture()],
      initialEvents: [],
      relations: [],
      provenance: {
        mode: 'run-linked',
        runId: `multi-profile-${key}-run`,
        testId: `multi-profile-${key}-test`,
        stepIndex: 0,
      },
      artifacts: [],
    }
  }

  function publish(label: string): PublishedBundle {
    const outcome = knowledgeLocal.publishBundle(config(), input(label))
    expect(outcome.kind).toBe('published')
    if (outcome.kind !== 'published') {
      throw new Error(`expected publication, got ${outcome.kind}`)
    }
    return outcome
  }

  async function migrateTwoRecords(): Promise<{
    target: PublishedBundle
    live: PublishedBundle
    targetRowid: number
    liveRowid: number
  }> {
    const target = publish('Target record')
    const live = publish('Live neighbor')
    await expect(knowledgeLocal.rebuildIndex({
      knowledgeRoot,
      embedder: makeFakeEmbedder(DEFAULT_EMBEDDING_PROFILE.dim),
    })).resolves.toMatchObject({ vec: 'vec0', projected: 2, pendingEmbeddings: 0 })

    const writer = knowledgeLocal.openIndexWriter(knowledgeRoot)
    try {
      expect(writer.vec).toBe('vec0')
      await expect(knowledgeLocal.setActiveEmbeddingProfile({
        db: writer.db,
        vec: writer.vec,
        target: {
          profile: STATIC_FLOOR_EMBEDDING_PROFILE,
          embedder: makeFakeEmbedder(STATIC_FLOOR_EMBEDDING_PROFILE.dim),
        },
      })).resolves.toEqual({
        flipped: true,
        profileKey: knowledgeLocal.embeddingProfileKey(STATIC_FLOOR_EMBEDDING_PROFILE),
      })

      const recordRows = new Map(
        writer.db
          .prepare('SELECT bundle_id, record_rowid FROM records ORDER BY bundle_id')
          .all()
          .map((row) => [String(row.bundle_id), Number(row.record_rowid)] as const),
      )
      const targetRowid = recordRows.get(target.id)
      const liveRowid = recordRows.get(live.id)
      if (targetRowid === undefined || liveRowid === undefined) {
        throw new Error('migrated record rowids are missing')
      }

      for (const profile of [
        DEFAULT_EMBEDDING_PROFILE,
        STATIC_FLOOR_EMBEDDING_PROFILE,
      ]) {
        expect(tableRows(writer.db, profile).map(({ bundleId }) => bundleId)).toEqual(
          [live.id, target.id].sort(),
        )
      }
      return { target, live, targetRowid, liveRowid }
    } finally {
      writer.close()
    }
  }

  function deprecate(target: PublishedBundle): void {
    expect(knowledgeLocal.appendOutcomeEvent(
      config(),
      target.id,
      BundleOutcomeEventSchema.parse({
        type: 'deprecated',
        evidenceToken: 'multi-profile-structural-scrub',
        curationJobId: 'multi-profile-structural-scrub-job',
        buildOrdinal: 50,
        reason: 'withdraw multi-profile target',
      }),
    )).toEqual({ kind: 'appended' })
  }

  it('materialized table authority is closed, ordered, capability-independent, and idempotent', async () => {
    const authority = schemaVecAuthorityApi()
    const migrated = await migrateTwoRecords()
    expect(authority.SCHEMA_OWNED_EMBEDDING_PROFILES).toEqual([
      DEFAULT_EMBEDDING_PROFILE,
      STATIC_FLOOR_EMBEDDING_PROFILE,
    ])

    const writer = knowledgeLocal.openIndexWriter(knowledgeRoot)
    try {
      writer.db.exec(`
        CREATE TABLE vec_non_schema_sentinel (
          record_rowid INTEGER PRIMARY KEY,
          marker TEXT NOT NULL
        )
      `)
      writer.db
        .prepare('INSERT INTO vec_non_schema_sentinel (record_rowid, marker) VALUES (?, ?)')
        .run(migrated.targetRowid, 'preserve')
      expect(authority.materializedSchemaVecTableNames(writer.db)).toEqual([
        knowledgeLocal.vecTableName(DEFAULT_EMBEDDING_PROFILE),
        knowledgeLocal.vecTableName(STATIC_FLOOR_EMBEDDING_PROFILE),
      ])

      authority.deleteRecordFromAllSchemaVecTables(writer.db, Number.MAX_SAFE_INTEGER)
      for (const profile of authority.SCHEMA_OWNED_EMBEDDING_PROFILES) {
        expect(tableRows(writer.db, profile)).toHaveLength(2)
      }
      expect(
        writer.db
          .prepare('SELECT marker FROM vec_non_schema_sentinel WHERE record_rowid = ?')
          .get(migrated.targetRowid)?.marker,
      ).toBe('preserve')
    } finally {
      writer.close()
    }

    vecLoadable.override = join(root, 'missing-sqlite-vec-extension')
    const brute = knowledgeLocal.openIndexWriter(knowledgeRoot)
    try {
      expect(brute.vec).toBe('brute')
      expect(authority.materializedSchemaVecTableNames(brute.db)).toEqual([
        knowledgeLocal.vecTableName(DEFAULT_EMBEDDING_PROFILE),
        knowledgeLocal.vecTableName(STATIC_FLOOR_EMBEDDING_PROFILE),
      ])
    } finally {
      brute.close()
    }

    const empty = new (await import('node:sqlite')).DatabaseSync(':memory:')
    try {
      expect(authority.materializedSchemaVecTableNames(empty)).toEqual([])
    } finally {
      empty.close()
    }
  })

  it('structural scrub removes the target from outgoing and active vec0 tables only', async () => {
    const migrated = await migrateTwoRecords()
    deprecate(migrated.target)

    projectBundleIndexRow({ knowledgeRoot, bundleId: migrated.target.id })

    const reader = knowledgeLocal.openIndexReaderConnection(knowledgeRoot)
    try {
      for (const profile of [
        DEFAULT_EMBEDDING_PROFILE,
        STATIC_FLOOR_EMBEDDING_PROFILE,
      ]) {
        expect(tableRows(reader.db, profile)).toEqual([
          { recordRowid: migrated.liveRowid, bundleId: migrated.live.id },
        ])
      }
      expect(
        reader.db
          .prepare('SELECT status, embed_status, embedding FROM records WHERE bundle_id = ?')
          .get(migrated.target.id),
      ).toMatchObject({ status: 'deprecated', embed_status: 'suppressed', embedding: null })
      expect(
        reader.db
          .prepare('SELECT COUNT(*) AS count FROM anchors WHERE record_rowid = ?')
          .get(migrated.targetRowid)?.count,
      ).toBe(3)
    } finally {
      reader.db.close()
    }
  })

  it('structural scrub fails closed and rolls back when migrated vec0 tables are unloaded', async () => {
    const migrated = await migrateTwoRecords()
    deprecate(migrated.target)
    vecLoadable.override = join(root, 'missing-sqlite-vec-extension')

    expect(() => projectBundleIndexRow({
      knowledgeRoot,
      bundleId: migrated.target.id,
    })).toThrow(/schema-owned vec table/u)

    vecLoadable.override = undefined
    const reader = knowledgeLocal.openIndexReaderConnection(knowledgeRoot)
    try {
      for (const profile of [
        DEFAULT_EMBEDDING_PROFILE,
        STATIC_FLOOR_EMBEDDING_PROFILE,
      ]) {
        expect(tableRows(reader.db, profile).map(({ bundleId }) => bundleId)).toEqual(
          [migrated.live.id, migrated.target.id].sort(),
        )
      }
      expect(
        reader.db
          .prepare('SELECT status FROM records WHERE bundle_id = ?')
          .get(migrated.target.id)?.status,
      ).toBe('active')
      expect(
        reader.db
          .prepare('SELECT 1 FROM fts_records WHERE rowid = ?')
          .get(migrated.targetRowid),
      ).toBeDefined()
    } finally {
      reader.db.close()
    }
  })
})
