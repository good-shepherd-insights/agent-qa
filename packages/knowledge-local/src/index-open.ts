/**
 * Derived-index SQLite host for IDX-01.
 *
 * D-10 keeps the records.embedding BLOB canonical even when vec0 is unavailable;
 * D-11/D-12 isolate native loading behind a capability flag and test seam; D-13
 * keeps WAL/lock/checkpoint tuning as internal constants. The database lives in
 * the gitignored memory/index partition (Research Pitfall 10), so these derived
 * writes intentionally do not pass through the committed-bundle egress gate.
 */
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  canonicalJson,
  DEFAULT_EMBEDDING_PROFILE,
  STATIC_FLOOR_EMBEDDING_PROFILE,
} from '@vostride/agent-qa-schema'
import type { EmbeddingProfile } from '@vostride/agent-qa-schema'

import { getLoadablePath } from './sqlite-vec-loadable.js'

export const INDEX_DB_FILE = 'knowledge.db'

export const INDEX_SCHEMA_VERSION = 1
export const MIN_READABLE_INDEX_SCHEMA_VERSION = 1
export const INDEX_RENDERING_SCHEMA_VERSION = 1

/**
 * Projection tables every readable index must expose.
 *
 * Per-profile vec tables are deliberately excluded: vec0 is a conditional
 * capability, while operation-time failover and the next rebuild heal a lost
 * capability-specific table.
 */
export const REQUIRED_INDEX_TABLES = [
  'records',
  'fts_records',
  'anchors',
  'graph_nodes',
  'graph_edges',
  'meta',
] as const

/**
 * Writer busy timeout in milliseconds.
 *
 * PROVISIONAL 2000 pending Phase 375 contention measurements. The value may be
 * tuned, but the constant-driven shape remains internal and config-free.
 */
export const WRITER_BUSY_TIMEOUT_MS = 2000

/**
 * Reader busy timeout in milliseconds.
 *
 * PROVISIONAL 500 pending Phase 375 contention measurements. The value may be
 * tuned, but the constant-driven shape remains internal and config-free.
 */
export const READER_BUSY_TIMEOUT_MS = 500

/**
 * Number of committed bundles between passive WAL checkpoints.
 *
 * PROVISIONAL 32 pending Phase 375 write-volume measurements. The value may be
 * tuned, but the constant-driven shape remains internal and config-free.
 */
export const CHECKPOINT_EVERY_N_BUNDLES = 32

export type VecCapability = 'vec0' | 'brute'

export interface IndexWriterHandle {
  db: DatabaseSync
  vec: VecCapability
  checkpointPassive(): void
  close(): void
}

export interface IndexReaderConnection {
  db: DatabaseSync
  vec: VecCapability
}

export type IndexHealth =
  | { ok: true }
  | {
      ok: false
      probe: 'quick-check' | 'projection-schema' | 'schema-version'
      reason: string
    }

interface IndexOpenOptions {
  /** D-12 test seam. Production callers resolve sqlite-vec's pinned prebuild. */
  vecLoadablePath?: string
}

export function indexDbPath(knowledgeRoot: string): string {
  return join(knowledgeRoot, 'memory', 'index', INDEX_DB_FILE)
}

export function resolveVecCapability(
  db: DatabaseSync,
  loadablePath?: string,
): VecCapability {
  try {
    db.loadExtension(loadablePath ?? getLoadablePath())
    return 'vec0'
  } catch {
    return 'brute'
  }
}

export function vecTableName(profile: EmbeddingProfile): string {
  const identity = `${profile.model_id}_${profile.revision}_${profile.dtype}_${profile.dim}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (identity === '') throw new Error('embedding profile produced an empty vec table identity')
  return `vec_${identity}`
}

/** Stable identity persisted in meta and used to select a closed-list profile. */
export function embeddingProfileKey(profile: EmbeddingProfile): string {
  return canonicalJson({
    model_id: profile.model_id,
    revision: profile.revision,
    dtype: profile.dtype,
    dim: profile.dim,
  })
}

function readEmbeddingProfileStamp(db: DatabaseSync): string | undefined {
  try {
    const row = db
      .prepare("SELECT v FROM meta WHERE k = 'embedding_profile'")
      .get()
    return typeof row?.v === 'string' ? row.v : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the one active profile authority from the derived index's meta stamp.
 *
 * This is RESEARCH Pattern 5 step 1: Plan 07 flips this stamp atomically. D-18
 * keeps M2 selection closed to schema-owned constants, so absent, unknown, or
 * pre-bootstrap metadata always falls back to the ratified default.
 */
export function resolveActiveProfile(db: DatabaseSync): EmbeddingProfile {
  const stamp = readEmbeddingProfileStamp(db)

  const knownProfiles = [
    DEFAULT_EMBEDDING_PROFILE,
    STATIC_FLOOR_EMBEDDING_PROFILE,
  ] as const
  return knownProfiles.find((profile) => embeddingProfileKey(profile) === stamp)
    ?? DEFAULT_EMBEDDING_PROFILE
}

function bootstrapSchema(
  db: DatabaseSync,
  vec: VecCapability,
  activeProfile: EmbeddingProfile,
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      record_rowid INTEGER PRIMARY KEY,
      bundle_id TEXT NOT NULL UNIQUE,
      product TEXT NOT NULL,
      mutable_state_hash TEXT NOT NULL,
      kind TEXT NOT NULL,
      subtype TEXT,
      scope_tier TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      status TEXT NOT NULL,
      trust REAL NOT NULL,
      confirmed INTEGER NOT NULL,
      contradicted INTEGER NOT NULL,
      helpful INTEGER NOT NULL,
      harmful INTEGER NOT NULL,
      opened_at_ordinal REAL NOT NULL,
      closed_at_ordinal REAL,
      created_at_ordinal REAL NOT NULL,
      origin_class TEXT NOT NULL,
      summary TEXT NOT NULL,
      embedding_input TEXT NOT NULL,
      embed_status TEXT NOT NULL DEFAULT 'pending',
      embedding BLOB
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS fts_records USING fts5(
      identity,
      content,
      tokenize = "unicode61 tokenchars '#-_./:[]=>@'"
    );

    CREATE TABLE IF NOT EXISTS anchors (
      record_rowid INTEGER NOT NULL,
      product TEXT NOT NULL,
      t TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      normalized_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS graph_nodes (
      node_id TEXT PRIMARY KEY,
      node_type TEXT NOT NULL,
      natural_key_json TEXT NOT NULL,
      product TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS graph_edges (
      src_node_id TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      dst_node_id TEXT NOT NULL,
      record_rowid INTEGER NOT NULL,
      product TEXT NOT NULL,
      UNIQUE(src_node_id, edge_type, dst_node_id, record_rowid)
    );

    CREATE TABLE IF NOT EXISTS meta (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
  `)

  if (vec === 'vec0') {
    const tableName = vecTableName(activeProfile)
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName} USING vec0(
        record_rowid integer primary key,
        product text partition key,
        embedding float[${activeProfile.dim}] distance_metric=cosine
      );
    `)
  }
}

function stampMeta(db: DatabaseSync, activeProfile: EmbeddingProfile): void {
  const upsert = db.prepare(`
    INSERT INTO meta (k, v) VALUES (?, ?)
    ON CONFLICT(k) DO UPDATE SET v = excluded.v
  `)

  upsert.run('index_schema_version', String(INDEX_SCHEMA_VERSION))
  upsert.run('embedding_profile', embeddingProfileKey(activeProfile))
  upsert.run('rendering_schema_version', String(INDEX_RENDERING_SCHEMA_VERSION))
}

/**
 * Close the pre-lock D-07 relabeling gap before a new profile stamp is written.
 *
 * Writer open previously replaced the former `main` revision stamp with the locked revision while
 * leaving canonical bytes present. Ordinary rebuild then skipped those rows and reconciliation
 * copied them into the locked revision's vec table. Pending rows instead ride D-19's benign-lag
 * path through the unchanged backfill selector. Old revision vec tables remain disposable
 * projections, embed-cache rows remain inert under their revision key, and no embedding work runs
 * during open, so a write never stalls on the transition.
 */
function invalidateMismatchedProfileEmbeddings(db: DatabaseSync): void {
  db.prepare(`
    UPDATE records
    SET embedding = NULL, embed_status = 'pending'
    WHERE embedding IS NOT NULL OR embed_status = 'present'
  `).run()
}

function closeAfterOpenFailure(db: DatabaseSync): void {
  try {
    db.close()
  } catch {
    // Preserve the original open/bootstrap failure.
  }
}

export function openIndexWriter(
  knowledgeRoot: string,
  opts: IndexOpenOptions = {},
): IndexWriterHandle {
  const path = indexDbPath(knowledgeRoot)
  mkdirSync(dirname(path), { recursive: true })

  const db = new DatabaseSync(path, {
    allowExtension: true,
    timeout: WRITER_BUSY_TIMEOUT_MS,
  })

  try {
    const vec = resolveVecCapability(db, opts.vecLoadablePath)
    const storedStamp = readEmbeddingProfileStamp(db)
    const activeProfile = resolveActiveProfile(db)
    db.exec('PRAGMA journal_mode=WAL')
    bootstrapSchema(db, vec, activeProfile)
    if (storedStamp !== embeddingProfileKey(activeProfile)) {
      db.exec('BEGIN IMMEDIATE')
      try {
        invalidateMismatchedProfileEmbeddings(db)
        stampMeta(db, activeProfile)
        db.exec('COMMIT')
      } catch (error) {
        try {
          db.exec('ROLLBACK')
        } catch {
          // Preserve the transition error that caused the rollback.
        }
        throw error
      }
    } else {
      stampMeta(db, activeProfile)
    }

    let closed = false
    return {
      db,
      vec,
      checkpointPassive(): void {
        db.exec('PRAGMA wal_checkpoint(PASSIVE)')
      },
      close(): void {
        if (closed) return
        try {
          db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
        } finally {
          closed = true
          db.close()
        }
      },
    }
  } catch (error) {
    closeAfterOpenFailure(db)
    throw error
  }
}

export function openIndexReaderConnection(
  knowledgeRoot: string,
  opts: IndexOpenOptions = {},
): IndexReaderConnection {
  const db = new DatabaseSync(indexDbPath(knowledgeRoot), {
    readOnly: true,
    allowExtension: true,
    timeout: READER_BUSY_TIMEOUT_MS,
  })

  try {
    const vec = resolveVecCapability(db, opts.vecLoadablePath)
    db.exec('PRAGMA query_only=1')
    return { db, vec }
  } catch (error) {
    closeAfterOpenFailure(db)
    throw error
  }
}

export function probeIndexHealth(db: DatabaseSync): IndexHealth {
  try {
    const row = db.prepare('PRAGMA quick_check').get()
    const result = row?.quick_check
    if (result !== 'ok') {
      return {
        ok: false,
        probe: 'quick-check',
        reason: `PRAGMA quick_check returned ${String(result)}`,
      }
    }
  } catch (error) {
    return {
      ok: false,
      probe: 'quick-check',
      reason: error instanceof Error ? error.message : String(error),
    }
  }

  try {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
    const present = new Set(rows.map((row) => String(row.name)))
    const missing = REQUIRED_INDEX_TABLES.filter((table) => !present.has(table))
    if (missing.length > 0) {
      return {
        ok: false,
        probe: 'projection-schema',
        reason: `required projection tables missing: ${missing.join(', ')}`,
      }
    }
  } catch (error) {
    return {
      ok: false,
      probe: 'projection-schema',
      reason: error instanceof Error ? error.message : String(error),
    }
  }

  try {
    const row = db
      .prepare("SELECT v FROM meta WHERE k = 'index_schema_version'")
      .get()
    const version = Number(row?.v)
    if (
      row === undefined
      || !Number.isFinite(version)
      || version < MIN_READABLE_INDEX_SCHEMA_VERSION
    ) {
      return {
        ok: false,
        probe: 'schema-version',
        reason: `index schema version ${String(row?.v)} is not readable`,
      }
    }
  } catch (error) {
    return {
      ok: false,
      probe: 'schema-version',
      reason: error instanceof Error ? error.message : String(error),
    }
  }

  return { ok: true }
}
