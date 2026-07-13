/**
 * IDX-01's derived-index writer over canonical Phase 374 bundles.
 *
 * D-02 keeps an absent embedder as a successful all-pending posture; D-05 indexes the bundle's
 * committed embeddingInput; D-10 stores every vector canonically in records before optionally
 * accelerating it through vec0. Per 374 D-03, loadBundle + deriveBundleTrust are the only bundle
 * projection faces. Relation edges are emitted from the complete integrity-valid walk in a second
 * pass so bundle ordering cannot change dangling-target behavior and late targets heal without
 * re-projecting an unchanged source.
 */
import { basename } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import {
  anchorGraphNode,
  canonicalJson,
  DEFAULT_EMBEDDING_PROFILE,
  recordGraphNode,
} from '@vostride/agent-qa-schema'
import type { Platform } from '@vostride/agent-qa-schema'

import { deriveBundleTrust, loadBundle, verifyBundleIntegrity } from './bundle-read.js'
import type { LoadedBundle } from './bundle-read.js'
import { enumerateBundleDirs } from './bundle-scan.js'
import type { EmbedderPort } from './embedder-port.js'
import {
  CHECKPOINT_EVERY_N_BUNDLES,
  openIndexWriter,
  vecTableName,
} from './index-open.js'
import type { VecCapability } from './index-open.js'
import { clearRebuildRequest } from './rebuild-marker.js'

export interface RebuildReport {
  projected: number
  skippedIncomplete: number
  scanIssues: string[]
  removed: number
  backfilled: number
  vec: VecCapability
}

export interface RebuildIndexOptions {
  knowledgeRoot: string
  embedder?: EmbedderPort
  vecLoadablePath?: string
}

interface ProjectedBundle {
  bundle: LoadedBundle
  product: string
}

type AnchorNode = NonNullable<ReturnType<typeof anchorGraphNode>>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function transaction(db: DatabaseSync, operation: () => void): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    operation()
    db.exec('COMMIT')
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // Preserve the projection error that caused the rollback.
    }
    throw error
  }
}

function embeddingBuffer(vector: Float32Array): Buffer {
  if (vector.length !== DEFAULT_EMBEDDING_PROFILE.dim) {
    throw new RangeError(
      `embedder returned ${vector.length} dimensions; expected ${DEFAULT_EMBEDDING_PROFILE.dim}`,
    )
  }
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)
}

function identityText(bundle: LoadedBundle): string {
  return bundle.frontmatter.anchors
    .flatMap(({ raw }) => {
      const serialized = canonicalJson(raw)
      if (raw.t === 'selector') return [serialized, raw.literal]
      if (raw.t === 'error') return [serialized, raw.message]
      return [serialized]
    })
    .join('\n')
}

function bundlePlatform(bundle: LoadedBundle): Platform | undefined {
  for (const { normalized } of bundle.frontmatter.anchors) {
    if (normalized.t === 'platform') return normalized.platform
  }
  return undefined
}

function insertGraphNode(
  db: DatabaseSync,
  node: AnchorNode | ReturnType<typeof recordGraphNode>,
  product: string,
): void {
  db.prepare(`
    INSERT OR IGNORE INTO graph_nodes (
      node_id, node_type, natural_key_json, product
    ) VALUES (?, ?, ?, ?)
  `).run(node.nodeId, node.type, canonicalJson(node.naturalKey), product)
}

function insertGraphEdge(
  db: DatabaseSync,
  edge: {
    srcNodeId: string
    edgeType: string
    dstNodeId: string
    recordRowid: number
    product: string
  },
): void {
  db.prepare(`
    INSERT OR IGNORE INTO graph_edges (
      src_node_id, edge_type, dst_node_id, record_rowid, product
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    edge.srcNodeId,
    edge.edgeType,
    edge.dstNodeId,
    edge.recordRowid,
    edge.product,
  )
}

function upsertRecord(
  db: DatabaseSync,
  bundle: LoadedBundle,
  product: string,
): number {
  const trust = deriveBundleTrust(bundle)
  db.prepare(`
    INSERT INTO records (
      bundle_id, product, mutable_state_hash, kind, subtype, scope_tier, scope_key,
      status, trust, confirmed, contradicted, helpful, harmful, opened_at_ordinal,
      closed_at_ordinal, created_at_ordinal, origin_class, summary, embedding_input
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bundle_id) DO UPDATE SET
      product = excluded.product,
      mutable_state_hash = excluded.mutable_state_hash,
      kind = excluded.kind,
      subtype = excluded.subtype,
      scope_tier = excluded.scope_tier,
      scope_key = excluded.scope_key,
      status = excluded.status,
      trust = excluded.trust,
      confirmed = excluded.confirmed,
      contradicted = excluded.contradicted,
      helpful = excluded.helpful,
      harmful = excluded.harmful,
      opened_at_ordinal = excluded.opened_at_ordinal,
      closed_at_ordinal = excluded.closed_at_ordinal,
      created_at_ordinal = excluded.created_at_ordinal,
      origin_class = excluded.origin_class,
      summary = excluded.summary,
      embedding_input = excluded.embedding_input
  `).run(
    bundle.manifest.id,
    product,
    bundle.manifest.mutableStateHash,
    bundle.frontmatter.kind,
    bundle.frontmatter.subtype ?? null,
    bundle.frontmatter.scope.tier,
    bundle.frontmatter.scope.key,
    trust.status,
    trust.trust,
    trust.counters.confirmed,
    trust.counters.contradicted,
    trust.counters.helpful,
    trust.counters.harmful,
    trust.validity.openedAtOrdinal,
    trust.validity.closedAtOrdinal ?? null,
    bundle.frontmatter.createdAtOrdinal,
    bundle.frontmatter.originClass,
    bundle.summary,
    bundle.manifest.embeddingInput,
  )

  const row = db
    .prepare('SELECT record_rowid FROM records WHERE bundle_id = ?')
    .get(bundle.manifest.id)
  if (row === undefined) throw new Error(`record upsert lost bundle ${bundle.manifest.id}`)
  return Number(row.record_rowid)
}

function replaceFtsAndAnchors(
  db: DatabaseSync,
  bundle: LoadedBundle,
  product: string,
  recordRowid: number,
): void {
  db.prepare('DELETE FROM fts_records WHERE rowid = ?').run(recordRowid)
  db.prepare('INSERT INTO fts_records (rowid, identity, content) VALUES (?, ?, ?)').run(
    recordRowid,
    identityText(bundle),
    bundle.manifest.embeddingInput,
  )

  db.prepare('DELETE FROM anchors WHERE record_rowid = ?').run(recordRowid)
  const insertAnchor = db.prepare(`
    INSERT INTO anchors (
      record_rowid, product, t, raw_json, normalized_json
    ) VALUES (?, ?, ?, ?, ?)
  `)
  for (const anchor of bundle.frontmatter.anchors) {
    insertAnchor.run(
      recordRowid,
      product,
      anchor.normalized.t,
      canonicalJson(anchor.raw),
      canonicalJson(anchor.normalized),
    )
  }
}

function replaceAnchorGraph(
  db: DatabaseSync,
  bundle: LoadedBundle,
  product: string,
  recordRowid: number,
): void {
  db.prepare('DELETE FROM graph_edges WHERE record_rowid = ?').run(recordRowid)

  const recordNode = recordGraphNode(bundle.frontmatter.kind, bundle.manifest.id)
  insertGraphNode(db, recordNode, product)

  const platform = bundlePlatform(bundle)
  const nodes = new Map<string, AnchorNode>()
  for (const { normalized } of bundle.frontmatter.anchors) {
    const node = anchorGraphNode(normalized, platform)
    if (node !== null) nodes.set(node.nodeId, node)
  }

  const elementNodes: AnchorNode[] = []
  const pageNodes: AnchorNode[] = []
  for (const node of nodes.values()) {
    insertGraphNode(db, node, product)
    insertGraphEdge(db, {
      srcNodeId: recordNode.nodeId,
      edgeType: 'about',
      dstNodeId: node.nodeId,
      recordRowid,
      product,
    })
    if (node.type === 'element' || node.type === 'web-element' || node.type === 'mobile-element') {
      elementNodes.push(node)
    }
    if (node.type === 'page' || node.type === 'web-page' || node.type === 'mobile-screen') {
      pageNodes.push(node)
    }
  }

  for (const element of elementNodes) {
    for (const page of pageNodes) {
      insertGraphEdge(db, {
        srcNodeId: element.nodeId,
        edgeType: 'part-of',
        dstNodeId: page.nodeId,
        recordRowid,
        product,
      })
    }
  }
}

function storeEmbedding(
  db: DatabaseSync,
  vec: VecCapability,
  product: string,
  recordRowid: number,
  vector: Float32Array,
): void {
  const bytes = embeddingBuffer(vector)
  db.prepare(`
    UPDATE records
    SET embedding = ?, embed_status = 'present'
    WHERE record_rowid = ?
  `).run(bytes, recordRowid)

  if (vec === 'vec0') {
    const tableName = vecTableName(DEFAULT_EMBEDDING_PROFILE)
    db.prepare(`DELETE FROM ${tableName} WHERE record_rowid = ?`).run(BigInt(recordRowid))
    db.prepare(`
      INSERT INTO ${tableName} (record_rowid, product, embedding)
      VALUES (?, ?, ?)
    `).run(BigInt(recordRowid), product, bytes)
  }
}

function projectBundle(
  db: DatabaseSync,
  vec: VecCapability,
  projected: ProjectedBundle,
  vector: Float32Array | undefined,
): void {
  transaction(db, () => {
    const recordRowid = upsertRecord(db, projected.bundle, projected.product)
    replaceFtsAndAnchors(db, projected.bundle, projected.product, recordRowid)
    replaceAnchorGraph(db, projected.bundle, projected.product, recordRowid)
    if (vector !== undefined) {
      storeEmbedding(db, vec, projected.product, recordRowid, vector)
    }
  })
}

/**
 * Reconcile relations from every integrity-valid bundle in the current walk, including sources
 * skipped by mutable-state hashing. INSERT OR IGNORE keeps unchanged re-emission idempotent, while
 * relations already participate in mutableStateHash, so only target membership can require healing
 * without a source re-projection.
 */
function emitRelationEdges(db: DatabaseSync, relationSources: readonly ProjectedBundle[]): void {
  transaction(db, () => {
    for (const { bundle, product } of relationSources) {
      const sourceRow = db
        .prepare('SELECT record_rowid FROM records WHERE bundle_id = ?')
        .get(bundle.manifest.id)
      if (sourceRow === undefined) continue
      const recordRowid = Number(sourceRow.record_rowid)
      const sourceNode = recordGraphNode(bundle.frontmatter.kind, bundle.manifest.id)

      for (const relation of bundle.relations.relations) {
        const targetRow = db
          .prepare('SELECT kind FROM records WHERE bundle_id = ?')
          .get(relation.targetId)
        if (targetRow === undefined) continue
        const targetKind = targetRow.kind as LoadedBundle['frontmatter']['kind']
        const targetNode = recordGraphNode(targetKind, relation.targetId)
        insertGraphNode(db, targetNode, product)
        insertGraphEdge(db, {
          srcNodeId: sourceNode.nodeId,
          edgeType: relation.type,
          dstNodeId: targetNode.nodeId,
          recordRowid,
          product,
        })
      }
    }

    db.exec(`
      DELETE FROM graph_nodes
      WHERE node_id NOT IN (
        SELECT src_node_id FROM graph_edges
        UNION
        SELECT dst_node_id FROM graph_edges
      )
    `)
  })
}

function removeMissingBundles(
  db: DatabaseSync,
  vec: VecCapability,
  seenBundleIds: ReadonlySet<string>,
): number {
  const missing = db
    .prepare('SELECT record_rowid, bundle_id, kind FROM records ORDER BY record_rowid')
    .all()
    .filter((row) => !seenBundleIds.has(String(row.bundle_id)))
  if (missing.length === 0) return 0

  transaction(db, () => {
    const deleteFts = db.prepare('DELETE FROM fts_records WHERE rowid = ?')
    const deleteAnchors = db.prepare('DELETE FROM anchors WHERE record_rowid = ?')
    const deleteEdges = db.prepare(`
      DELETE FROM graph_edges
      WHERE record_rowid = ? OR src_node_id = ? OR dst_node_id = ?
    `)
    const deleteRecord = db.prepare('DELETE FROM records WHERE record_rowid = ?')
    const tableName = vec === 'vec0'
      ? vecTableName(DEFAULT_EMBEDDING_PROFILE)
      : undefined
    const deleteVec = tableName === undefined
      ? undefined
      : db.prepare(`DELETE FROM ${tableName} WHERE record_rowid = ?`)

    for (const row of missing) {
      const recordRowid = Number(row.record_rowid)
      const bundleId = String(row.bundle_id)
      const kind = row.kind as LoadedBundle['frontmatter']['kind']
      const recordNode = recordGraphNode(kind, bundleId)
      deleteFts.run(recordRowid)
      deleteAnchors.run(recordRowid)
      deleteEdges.run(recordRowid, recordNode.nodeId, recordNode.nodeId)
      deleteVec?.run(BigInt(recordRowid))
      deleteRecord.run(recordRowid)
    }
  })

  return missing.length
}

async function backfillPendingEmbeddings(
  db: DatabaseSync,
  vec: VecCapability,
  embedder: EmbedderPort | undefined,
): Promise<number> {
  if (embedder === undefined) return 0

  const pending = db
    .prepare(`
      SELECT record_rowid, product, bundle_id, embedding_input
      FROM records
      WHERE embed_status != 'present'
      ORDER BY record_rowid
    `)
    .all()
  let backfilled = 0
  for (const row of pending) {
    let vector: Float32Array
    try {
      vector = await embedder.embedDocument(String(row.embedding_input))
    } catch (error) {
      throw new Error(
        `embedding ${String(row.bundle_id)} failed: ${errorMessage(error)}`,
        { cause: error },
      )
    }
    transaction(db, () => {
      storeEmbedding(
        db,
        vec,
        String(row.product),
        Number(row.record_rowid),
        vector,
      )
    })
    backfilled += 1
  }
  return backfilled
}

function reconcileVecRows(db: DatabaseSync, vec: VecCapability): void {
  if (vec !== 'vec0') return
  const tableName = vecTableName(DEFAULT_EMBEDDING_PROFILE)
  const vecRowids = new Set(
    db
      .prepare(`SELECT record_rowid FROM ${tableName}`)
      .all()
      .map((row) => Number(row.record_rowid)),
  )
  const canonical = db
    .prepare(`
      SELECT record_rowid, product, embedding
      FROM records
      WHERE embedding IS NOT NULL
      ORDER BY record_rowid
    `)
    .all()
  const canonicalRowids = new Set(canonical.map((row) => Number(row.record_rowid)))

  transaction(db, () => {
    const deleteVec = db.prepare(`DELETE FROM ${tableName} WHERE record_rowid = ?`)
    for (const recordRowid of vecRowids) {
      if (!canonicalRowids.has(recordRowid)) deleteVec.run(BigInt(recordRowid))
    }

    const insertVec = db.prepare(`
      INSERT INTO ${tableName} (record_rowid, product, embedding)
      VALUES (?, ?, ?)
    `)
    for (const row of canonical) {
      const recordRowid = Number(row.record_rowid)
      if (vecRowids.has(recordRowid)) continue
      insertVec.run(BigInt(recordRowid), String(row.product), row.embedding as Uint8Array)
    }
  })
}

/** Hash-selected projection plus the independent D-02 backfill and D-10 reconciliation passes. */
export async function rebuildIndex(opts: RebuildIndexOptions): Promise<RebuildReport> {
  const writer = openIndexWriter(
    opts.knowledgeRoot,
    opts.vecLoadablePath === undefined
      ? {}
      : { vecLoadablePath: opts.vecLoadablePath },
  )
  const report: RebuildReport = {
    projected: 0,
    skippedIncomplete: 0,
    scanIssues: [],
    removed: 0,
    backfilled: 0,
    vec: writer.vec,
  }
  const projected: ProjectedBundle[] = []
  const relationSources: ProjectedBundle[] = []
  const seenBundleIds = new Set<string>()
  let processedBundles = 0

  try {
    for (const entry of enumerateBundleDirs(opts.knowledgeRoot)) {
      const outcome = loadBundle(entry.dir)
      if (outcome.kind === 'incomplete') {
        seenBundleIds.add(basename(entry.dir))
        report.skippedIncomplete += 1
        continue
      }
      if (outcome.kind !== 'loaded') {
        seenBundleIds.add(basename(entry.dir))
        const reason = 'reason' in outcome ? `: ${outcome.reason}` : ''
        report.scanIssues.push(`${entry.dir}: ${outcome.kind}${reason}`)
        continue
      }

      seenBundleIds.add(outcome.bundle.manifest.id)
      const integrity = verifyBundleIntegrity(entry.dir)
      if (!integrity.ok) {
        report.scanIssues.push(`${entry.dir}: integrity: ${integrity.violations.join('; ')}`)
        continue
      }
      const item = { bundle: outcome.bundle, product: entry.product }
      relationSources.push(item)
      const current = writer.db
        .prepare(`
          SELECT mutable_state_hash, embed_status
          FROM records
          WHERE bundle_id = ?
        `)
        .get(outcome.bundle.manifest.id)
      processedBundles += 1
      if (current?.mutable_state_hash === outcome.bundle.manifest.mutableStateHash) {
        if (processedBundles % CHECKPOINT_EVERY_N_BUNDLES === 0) {
          writer.checkpointPassive()
        }
        continue
      }

      let vector: Float32Array | undefined
      if (opts.embedder !== undefined && current?.embed_status !== 'present') {
        try {
          vector = await opts.embedder.embedDocument(outcome.bundle.manifest.embeddingInput)
        } catch (error) {
          throw new Error(
            `embedding ${outcome.bundle.manifest.id} failed: ${errorMessage(error)}`,
            { cause: error },
          )
        }
      }

      projectBundle(writer.db, writer.vec, item, vector)
      projected.push(item)
      report.projected += 1
      if (processedBundles % CHECKPOINT_EVERY_N_BUNDLES === 0) {
        writer.checkpointPassive()
      }
    }

    report.removed = removeMissingBundles(writer.db, writer.vec, seenBundleIds)
    emitRelationEdges(writer.db, relationSources)
    report.backfilled = await backfillPendingEmbeddings(
      writer.db,
      writer.vec,
      opts.embedder,
    )
    reconcileVecRows(writer.db, writer.vec)
    clearRebuildRequest(opts.knowledgeRoot)
    return report
  } finally {
    writer.close()
  }
}
