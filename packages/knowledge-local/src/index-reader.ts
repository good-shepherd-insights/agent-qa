/**
 * D-06/D-07/D-08 degrading reader facade for IDX-02 and memory.md §8.2.
 *
 * Index health is resolved at open and every later index operation is guarded. Any unhealthy state
 * permanently swaps the facade to an authoritative bundle scan plus a durable rebuild request,
 * while healthy readers stay read-only and query-only through openIndexReaderConnection. This
 * module never acquires the writer role or rebuilds inline.
 */
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import {
  canonicalJson,
  normalizeAnchor,
} from '@vostride/agent-qa-schema'
import type { Anchor } from '@vostride/agent-qa-schema'

import { deriveBundleTrust, loadBundle, verifyBundleIntegrity } from './bundle-read.js'
import {
  isServable,
  scanBundleById,
  scanBundles,
} from './bundle-scan.js'
import type { KnowledgeHit } from './bundle-scan.js'
import {
  indexDbPath,
  openIndexReaderConnection,
  probeIndexHealth,
  resolveActiveProfile,
  vecTableName,
} from './index-open.js'
import type { IndexReaderConnection, VecCapability } from './index-open.js'
import { requestRebuild } from './rebuild-marker.js'
import type { RebuildReason } from './rebuild-marker.js'

export interface KnowledgeSearchOptions {
  product?: string
  k?: number
}

export interface DenseSearchOptions extends KnowledgeSearchOptions {
  k: number
}

export type DenseHit = KnowledgeHit & { distance: number }

export interface KnowledgeReader {
  /** Current serving face; permanently changes to scan after an index operation failure. */
  readonly source: 'index' | 'scan'
  /** Current vector capability; changes to none when the serving face degrades to scan. */
  readonly vec: VecCapability | 'none'
  getById(bundleId: string): KnowledgeHit | undefined
  searchLexical(text: string, opts?: KnowledgeSearchOptions): KnowledgeHit[]
  lookupAnchor(anchor: Anchor, opts?: KnowledgeSearchOptions): KnowledgeHit[]
  searchDense(embedding: Float32Array, opts: DenseSearchOptions): DenseHit[]
  recheck(hits: readonly KnowledgeHit[]): KnowledgeHit[]
  close(): void
}

interface IndexedRecord {
  hit: KnowledgeHit
  recordRowid: number
}

type RefreshedHit<THit extends KnowledgeHit> = Omit<THit, keyof KnowledgeHit> & KnowledgeHit

const RECORD_COLUMNS = `
  r.record_rowid,
  r.bundle_id,
  r.product,
  r.kind,
  r.subtype,
  r.status,
  r.trust,
  r.opened_at_ordinal,
  r.closed_at_ordinal,
  r.summary,
  r.embedding_input
`

const MAX_SQL_LIMIT = 2_147_483_647

export interface OpenKnowledgeReaderOptions {
  /** D-12 test seam. Production callers resolve sqlite-vec's pinned prebuild. */
  vecLoadablePath?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function lockedReason(detail: string): boolean {
  return /locked|busy/i.test(detail)
}

function requestRebuildBestEffort(
  knowledgeRoot: string,
  reason: RebuildReason,
  detail: string,
): void {
  try {
    requestRebuild({ knowledgeRoot, reason, detail })
  } catch {
    // D-07 is an operations signal, not a serving gate. Bundle truth remains available.
  }
}

function closeBestEffort(connection: IndexReaderConnection): void {
  try {
    connection.db.close()
  } catch {
    // Preserve the health failure that selected authoritative scan mode.
  }
}

function queryLimit(k: number | undefined): number {
  if (k === undefined || k === Number.POSITIVE_INFINITY) return MAX_SQL_LIMIT
  if (!Number.isFinite(k)) return 0
  return Math.min(MAX_SQL_LIMIT, Math.max(0, Math.floor(k)))
}

function rowToIndexedRecord(row: Record<string, unknown>): IndexedRecord {
  const closedAt = row.closed_at_ordinal
  return {
    recordRowid: Number(row.record_rowid),
    hit: {
      bundleId: String(row.bundle_id),
      product: String(row.product),
      kind: String(row.kind) as KnowledgeHit['kind'],
      subtype: row.subtype === null || row.subtype === undefined
        ? null
        : String(row.subtype),
      status: String(row.status) as KnowledgeHit['status'],
      trust: Number(row.trust),
      validity: {
        openedAtOrdinal: Number(row.opened_at_ordinal),
        ...(closedAt === null || closedAt === undefined
          ? {}
          : { closedAtOrdinal: Number(closedAt) }),
      },
      summary: String(row.summary),
      embeddingInput: String(row.embedding_input),
    },
  }
}

function safeBundleDir(knowledgeRoot: string, hit: KnowledgeHit): string | undefined {
  if (
    hit.product === ''
    || hit.product === '.'
    || hit.product === '..'
    || hit.product !== basename(hit.product)
    || hit.bundleId === ''
    || hit.bundleId === '.'
    || hit.bundleId === '..'
    || hit.bundleId !== basename(hit.bundleId)
  ) {
    return undefined
  }
  return join(knowledgeRoot, 'memory', hit.product, 'bundles', hit.bundleId)
}

/** D-09: refresh mutable truth from a digest-verified bundle and preserve ranking metadata. */
function recheckHits<THit extends KnowledgeHit>(
  knowledgeRoot: string,
  hits: readonly THit[],
): Array<RefreshedHit<THit>> {
  const refreshed: Array<RefreshedHit<THit>> = []
  for (const hit of hits) {
    const bundleDir = safeBundleDir(knowledgeRoot, hit)
    if (bundleDir === undefined) continue

    try {
      if (!verifyBundleIntegrity(bundleDir).ok) continue
      const outcome = loadBundle(bundleDir)
      if (outcome.kind !== 'loaded' || outcome.bundle.manifest.id !== hit.bundleId) continue
      const trust = deriveBundleTrust(outcome.bundle)
      if (!isServable(trust)) continue

      refreshed.push({
        ...hit,
        kind: outcome.bundle.frontmatter.kind,
        subtype: outcome.bundle.frontmatter.subtype ?? null,
        status: trust.status,
        trust: trust.trust,
        validity: trust.validity,
        summary: outcome.bundle.summary,
        embeddingInput: outcome.bundle.manifest.embeddingInput,
      } as RefreshedHit<THit>)
    } catch {
      // A changing, unreadable, or invalid bundle is never safe to serve from a stale index row.
    }
  }
  return refreshed
}

function quoteFtsTokens(text: string): string {
  return text
    .split(/\s+/)
    .filter((token) => token !== '')
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(' ')
}

function recordByRowid(db: DatabaseSync, recordRowid: number): IndexedRecord | undefined {
  const row = db.prepare(`
    SELECT ${RECORD_COLUMNS}
    FROM records r
    WHERE r.record_rowid = ?
  `).get(recordRowid)
  return row === undefined
    ? undefined
    : rowToIndexedRecord(row as Record<string, unknown>)
}

function float32View(value: unknown): Float32Array | undefined {
  if (!(value instanceof Uint8Array) || value.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    return undefined
  }
  const alignedCopy = Uint8Array.from(value)
  return new Float32Array(alignedCopy.buffer)
}

function cosineDistance(query: Float32Array, candidate: Float32Array): number | undefined {
  if (candidate.length !== query.length) return undefined
  let dot = 0
  for (let index = 0; index < query.length; index += 1) {
    dot += query[index]! * candidate[index]!
  }
  return 1 - dot
}

function scanReader(knowledgeRoot: string): KnowledgeReader {
  return {
    source: 'scan',
    vec: 'none',
    getById(bundleId): KnowledgeHit | undefined {
      return scanBundleById({ knowledgeRoot, bundleId })
    },
    searchLexical(text, opts = {}): KnowledgeHit[] {
      return scanBundles({ knowledgeRoot, text, ...opts })
    },
    lookupAnchor(anchor, opts = {}): KnowledgeHit[] {
      // D-16: vec:none is the only reader rung allowed to widen beyond full identity.
      // Normalize through the schema authority before the scan compares role + name.
      return scanBundles({ knowledgeRoot, anchor: normalizeAnchor(anchor), ...opts })
    },
    searchDense(): DenseHit[] {
      return []
    },
    recheck(hits): KnowledgeHit[] {
      return recheckHits(knowledgeRoot, hits)
    },
    close(): void {},
  }
}

function indexReader(
  knowledgeRoot: string,
  connection: IndexReaderConnection,
): KnowledgeReader {
  let closed = false
  const { db } = connection
  const activeProfile = resolveActiveProfile(db)

  function recheckCurrent<THit extends KnowledgeHit>(
    hits: readonly THit[],
  ): Array<RefreshedHit<THit>> {
    return recheckHits(knowledgeRoot, hits)
  }

  function denseVec0(embedding: Float32Array, opts: DenseSearchOptions): DenseHit[] {
    const k = queryLimit(opts.k)
    if (k === 0) return []

    const products = opts.product === undefined
      ? db.prepare(`
          SELECT DISTINCT r.product
          FROM records r
          WHERE r.embedding IS NOT NULL
          ORDER BY r.product
        `).all().map((row) => String(row.product))
      : [opts.product]
    const queryBlob = Buffer.from(
      embedding.buffer,
      embedding.byteOffset,
      embedding.byteLength,
    )
    const tableName = vecTableName(activeProfile)
    const knn = db.prepare(`
      SELECT record_rowid, distance
      FROM ${tableName}
      WHERE embedding MATCH ? AND product = ? AND k = ?
      ORDER BY distance
    `)
    const candidates: Array<{ distance: number; recordRowid: number }> = []
    for (const product of products) {
      for (const row of knn.all(queryBlob, product, k)) {
        candidates.push({
          recordRowid: Number(row.record_rowid),
          distance: Number(row.distance),
        })
      }
    }
    candidates.sort(
      (left, right) => left.distance - right.distance || left.recordRowid - right.recordRowid,
    )

    const hits = candidates.slice(0, k).flatMap(({ distance, recordRowid }) => {
      const record = recordByRowid(db, recordRowid)
      return record === undefined ? [] : [{ ...record.hit, distance }]
    })
    return hits
  }

  function denseBrute(embedding: Float32Array, opts: DenseSearchOptions): DenseHit[] {
    const k = queryLimit(opts.k)
    if (k === 0) return []

    const rows = opts.product === undefined
      ? db.prepare(`
          SELECT ${RECORD_COLUMNS}, r.embedding
          FROM records r
          WHERE r.embedding IS NOT NULL
          ORDER BY r.record_rowid
        `).all()
      : db.prepare(`
          SELECT ${RECORD_COLUMNS}, r.embedding
          FROM records r
          WHERE r.embedding IS NOT NULL AND r.product = ?
          ORDER BY r.record_rowid
        `).all(opts.product)
    const candidates: Array<{ distance: number; record: IndexedRecord }> = []
    for (const row of rows) {
      const vector = float32View(row.embedding)
      if (vector === undefined) continue
      const distance = cosineDistance(embedding, vector)
      if (distance === undefined) continue
      candidates.push({
        record: rowToIndexedRecord(row as Record<string, unknown>),
        distance,
      })
    }
    candidates.sort(
      (left, right) => left.distance - right.distance
        || left.record.recordRowid - right.record.recordRowid,
    )
    const hits = candidates
      .slice(0, k)
      .map(({ distance, record }) => ({ ...record.hit, distance }))
    return hits
  }

  return {
    source: 'index',
    vec: connection.vec,
    getById(bundleId): KnowledgeHit | undefined {
      const row = db.prepare(`
        SELECT ${RECORD_COLUMNS}
        FROM records r
        WHERE r.bundle_id = ?
      `).get(bundleId)
      if (row === undefined) return undefined
      return recheckCurrent([rowToIndexedRecord(row as Record<string, unknown>).hit])[0]
    },
    searchLexical(text, opts = {}): KnowledgeHit[] {
      const k = queryLimit(opts.k)
      if (k === 0) return []
      const match = quoteFtsTokens(text)
      const rows = match === ''
        ? opts.product === undefined
          ? db.prepare(`
              SELECT ${RECORD_COLUMNS}
              FROM records r
              ORDER BY r.record_rowid
              LIMIT ?
            `).all(k)
          : db.prepare(`
              SELECT ${RECORD_COLUMNS}
              FROM records r
              WHERE r.product = ?
              ORDER BY r.record_rowid
              LIMIT ?
            `).all(opts.product, k)
        : opts.product === undefined
          ? db.prepare(`
              SELECT ${RECORD_COLUMNS}
              FROM fts_records
              JOIN records r ON r.record_rowid = fts_records.rowid
              WHERE fts_records MATCH ?
              ORDER BY bm25(fts_records), r.record_rowid
              LIMIT ?
            `).all(match, k)
          : db.prepare(`
              SELECT ${RECORD_COLUMNS}
              FROM fts_records
              JOIN records r ON r.record_rowid = fts_records.rowid
              WHERE fts_records MATCH ? AND r.product = ?
              ORDER BY bm25(fts_records), r.record_rowid
              LIMIT ?
            `).all(match, opts.product, k)
      return recheckCurrent(
        rows.map((row) => rowToIndexedRecord(row as Record<string, unknown>).hit),
      )
    },
    lookupAnchor(anchor, opts = {}): KnowledgeHit[] {
      const k = queryLimit(opts.k)
      if (k === 0) return []
      const normalized = canonicalJson(normalizeAnchor(anchor))
      const rows = opts.product === undefined
        ? db.prepare(`
            SELECT DISTINCT ${RECORD_COLUMNS}
            FROM anchors a
            JOIN records r ON r.record_rowid = a.record_rowid
            WHERE a.normalized_json = ?
            ORDER BY r.record_rowid
            LIMIT ?
          `).all(normalized, k)
        : db.prepare(`
            SELECT DISTINCT ${RECORD_COLUMNS}
            FROM anchors a
            JOIN records r ON r.record_rowid = a.record_rowid
            WHERE a.normalized_json = ? AND r.product = ?
            ORDER BY r.record_rowid
            LIMIT ?
          `).all(normalized, opts.product, k)
      return recheckCurrent(
        rows.map((row) => rowToIndexedRecord(row as Record<string, unknown>).hit),
      )
    },
    searchDense(embedding, opts): DenseHit[] {
      const hits = connection.vec === 'vec0'
        ? denseVec0(embedding, opts)
        : denseBrute(embedding, opts)
      return recheckCurrent(hits)
    },
    recheck(hits): KnowledgeHit[] {
      return recheckCurrent(hits)
    },
    close(): void {
      if (closed) return
      closed = true
      connection.db.close()
    },
  }
}

/**
 * Keep index failures behind a live facade so callers retain one reader while
 * its source and vector capability permanently degrade to authoritative scans.
 */
function operationDegradingReader(
  knowledgeRoot: string,
  connection: IndexReaderConnection,
): KnowledgeReader {
  let delegate = indexReader(knowledgeRoot, connection)
  let closed = false

  function invoke<TResult>(operation: (reader: KnowledgeReader) => TResult): TResult {
    if (delegate.source === 'scan') return operation(delegate)

    try {
      return operation(delegate)
    } catch (error) {
      closeBestEffort(connection)
      requestRebuildBestEffort(
        knowledgeRoot,
        'corrupt',
        `derived index operation failed: ${errorMessage(error)}`,
      )
      delegate = scanReader(knowledgeRoot)
      return operation(delegate)
    }
  }

  return {
    get source(): 'index' | 'scan' {
      return delegate.source
    },
    get vec(): VecCapability | 'none' {
      return delegate.vec
    },
    getById(bundleId): KnowledgeHit | undefined {
      return invoke((reader) => reader.getById(bundleId))
    },
    searchLexical(text, opts = {}): KnowledgeHit[] {
      return invoke((reader) => reader.searchLexical(text, opts))
    },
    lookupAnchor(anchor, opts = {}): KnowledgeHit[] {
      return invoke((reader) => reader.lookupAnchor(anchor, opts))
    },
    searchDense(embedding, opts): DenseHit[] {
      return invoke((reader) => reader.searchDense(embedding, opts))
    },
    recheck(hits): KnowledgeHit[] {
      return invoke((reader) => reader.recheck(hits))
    },
    close(): void {
      if (closed) return
      closed = true
      try {
        delegate.close()
      } catch {
        closeBestEffort(connection)
      }
    },
  }
}

function degrade(
  knowledgeRoot: string,
  reason: RebuildReason,
  detail: string,
): KnowledgeReader {
  requestRebuildBestEffort(knowledgeRoot, reason, detail)
  return scanReader(knowledgeRoot)
}

export function openKnowledgeReader(
  knowledgeRoot: string,
  opts: OpenKnowledgeReaderOptions = {},
): KnowledgeReader {
  if (!existsSync(indexDbPath(knowledgeRoot))) {
    return degrade(knowledgeRoot, 'absent', 'derived index file is absent')
  }

  let connection: IndexReaderConnection
  try {
    connection = openIndexReaderConnection(knowledgeRoot, opts)
  } catch (error) {
    const detail = errorMessage(error)
    return degrade(knowledgeRoot, lockedReason(detail) ? 'locked' : 'corrupt', detail)
  }

  const health = probeIndexHealth(connection.db)
  if (!health.ok) {
    closeBestEffort(connection)
    let reason: RebuildReason
    if (health.probe === 'schema-version') {
      reason = 'schema-version'
    } else if (health.probe === 'projection-schema') {
      reason = 'corrupt'
    } else {
      reason = lockedReason(health.reason) ? 'locked' : 'corrupt'
    }
    return degrade(knowledgeRoot, reason, health.reason)
  }

  return operationDegradingReader(knowledgeRoot, connection)
}
