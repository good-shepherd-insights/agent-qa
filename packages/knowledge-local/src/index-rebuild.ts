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
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import {
  anchorGraphNode,
  canonicalJson,
  guardDistilledObservation,
  recordGraphNode,
} from '@vostride/agent-qa-schema'
import type {
  DistilledObservation,
  EmbeddingProfile,
  GraphNodeNaturalKey,
  GraphNodeType,
  Platform,
} from '@vostride/agent-qa-schema'

import { deriveBundleTrust, loadBundle, verifyBundleIntegrity } from './bundle-read.js'
import type { LoadedBundle } from './bundle-read.js'
import { enumerateBundleDirs } from './bundle-scan.js'
import {
  buildSituatingLine,
  computeRenderingDrift,
  renderContextual,
} from './contextual-rendering.js'
import type { EmbedderPort } from './embedder-port.js'
import {
  deriveEquivalentToBridges,
  deriveLocatesViaEdges,
  deriveObservationEdges,
} from './graph-derive.js'
import type {
  DerivedGraphEdge,
  DerivedGraphNode,
  GraphDerivation,
  GraphDerivationContext,
} from './graph-derive.js'
import {
  CHECKPOINT_EVERY_N_BUNDLES,
  openIndexWriter,
  resolveActiveProfile,
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
  dir: string
  product: string
}

type AnchorNode = NonNullable<ReturnType<typeof anchorGraphNode>>

interface InsertableGraphNode {
  nodeId: string
  type: GraphNodeType
  naturalKey: GraphNodeNaturalKey
}

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

function embeddingBuffer(vector: Float32Array, activeProfile: EmbeddingProfile): Buffer {
  if (vector.length !== activeProfile.dim) {
    throw new RangeError(
      `embedder returned ${vector.length} dimensions; expected ${activeProfile.dim}`,
    )
  }
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)
}

interface VecRowMetadata {
  product: string
  scopeTier: string
  scopeKey: string
  status: string
}

function recordVecMetadata(db: DatabaseSync, recordRowid: number): VecRowMetadata {
  const row = db
    .prepare(`
      SELECT product, scope_tier, scope_key, status
      FROM records
      WHERE record_rowid = ?
    `)
    .get(recordRowid)
  if (row === undefined) {
    throw new Error(`vec metadata source record ${recordRowid} is missing`)
  }
  return {
    product: String(row.product),
    scopeTier: String(row.scope_tier),
    scopeKey: String(row.scope_key),
    status: String(row.status),
  }
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
  node: InsertableGraphNode,
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
    recencyOrdinal: number
  },
): void {
  db.prepare(`
    INSERT OR IGNORE INTO graph_edges (
      src_node_id, edge_type, dst_node_id, record_rowid, product, recency_ordinal
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    edge.srcNodeId,
    edge.edgeType,
    edge.dstNodeId,
    edge.recordRowid,
    edge.product,
    edge.recencyOrdinal,
  )
}

function insertGraphDerivation(db: DatabaseSync, projection: GraphDerivation): void {
  for (const node of projection.nodes) insertGraphNode(db, node, node.product)
  for (const edge of projection.edges) insertGraphEdge(db, edge)
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
      closed_at_ordinal, created_at_ordinal, origin_class, summary, embedding_input,
      situating_line, contextual_rendering
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    '',
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
  const rendering = db
    .prepare('SELECT situating_line FROM records WHERE record_rowid = ?')
    .get(recordRowid)
  if (rendering === undefined) {
    throw new Error(`FTS projection source record ${recordRowid} is missing`)
  }
  db.prepare('DELETE FROM fts_records WHERE rowid = ?').run(recordRowid)
  db.prepare(`
    INSERT INTO fts_records (rowid, identity, content, context)
    VALUES (?, ?, ?, ?)
  `).run(
    recordRowid,
    identityText(bundle),
    bundle.manifest.embeddingInput,
    String(rendering.situating_line),
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
      recencyOrdinal: bundle.frontmatter.createdAtOrdinal,
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
        recencyOrdinal: bundle.frontmatter.createdAtOrdinal,
      })
    }
  }

  insertGraphDerivation(
    db,
    deriveLocatesViaEdges(
      bundle.frontmatter.anchors.map(({ normalized }) => normalized),
      platform,
      {
        bundleId: bundle.manifest.id,
        recordRowid,
        product,
        createdAtOrdinal: bundle.frontmatter.createdAtOrdinal,
      },
    ),
  )
}

function storeEmbedding(
  db: DatabaseSync,
  vec: VecCapability,
  recordRowid: number,
  vector: Float32Array,
  activeProfile: EmbeddingProfile,
): void {
  const bytes = embeddingBuffer(vector, activeProfile)
  db.prepare(`
    UPDATE records
    SET embedding = ?, embed_status = 'present'
    WHERE record_rowid = ?
  `).run(bytes, recordRowid)

  if (vec === 'vec0') {
    const metadata = recordVecMetadata(db, recordRowid)
    const tableName = vecTableName(activeProfile)
    db.prepare(`DELETE FROM ${tableName} WHERE record_rowid = ?`).run(BigInt(recordRowid))
    db.prepare(`
      INSERT INTO ${tableName} (
        record_rowid, product, scope_tier, scope_key, status, embedding
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      BigInt(recordRowid),
      metadata.product,
      metadata.scopeTier,
      metadata.scopeKey,
      metadata.status,
      bytes,
    )
  }
}

function refreshVecMetadata(
  db: DatabaseSync,
  vec: VecCapability,
  recordRowid: number,
  activeProfile: EmbeddingProfile,
): void {
  if (vec !== 'vec0') return
  const metadata = recordVecMetadata(db, recordRowid)
  db.prepare(`
    UPDATE ${vecTableName(activeProfile)}
    SET scope_tier = ?, scope_key = ?, status = ?
    WHERE record_rowid = ?
  `).run(
    metadata.scopeTier,
    metadata.scopeKey,
    metadata.status,
    BigInt(recordRowid),
  )
}

function projectBundle(
  db: DatabaseSync,
  vec: VecCapability,
  projected: ProjectedBundle,
  activeProfile: EmbeddingProfile,
): void {
  transaction(db, () => {
    const recordRowid = upsertRecord(db, projected.bundle, projected.product)
    refreshVecMetadata(db, vec, recordRowid, activeProfile)
    replaceFtsAndAnchors(db, projected.bundle, projected.product, recordRowid)
    replaceAnchorGraph(db, projected.bundle, projected.product, recordRowid)
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
          recencyOrdinal: relation.addedAtOrdinal,
        })
      }
    }
  })
}

function safeObservationPath(
  knowledgeRoot: string,
  source: ProjectedBundle,
): string | undefined {
  const bundleDir = basename(source.dir)
  if (
    source.product === ''
    || source.product === '.'
    || source.product === '..'
    || source.product !== basename(source.product)
    || bundleDir === ''
    || bundleDir === '.'
    || bundleDir === '..'
    || source.dir !== join(knowledgeRoot, 'memory', source.product, 'bundles', bundleDir)
  ) {
    return undefined
  }
  return join(source.dir, 'observations.jsonl')
}

function loadObservations(
  knowledgeRoot: string,
  source: ProjectedBundle,
  scanIssues: string[],
): DistilledObservation[] {
  const observationPath = safeObservationPath(knowledgeRoot, source)
  if (observationPath === undefined) {
    scanIssues.push(`${source.dir}: observations.jsonl: unsafe bundle path`)
    return []
  }
  if (!existsSync(observationPath)) return []

  let text: string
  try {
    text = readFileSync(observationPath, 'utf8')
  } catch (error) {
    scanIssues.push(`${observationPath}: ${errorMessage(error)}`)
    return []
  }

  const observations: DistilledObservation[] = []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  for (const [index, line] of lines.entries()) {
    try {
      observations.push(guardDistilledObservation(JSON.parse(line)))
    } catch (error) {
      scanIssues.push(`${observationPath}:${index + 1}: ${errorMessage(error)}`)
    }
  }
  return observations
}

function deleteObservationEdges(db: DatabaseSync, recordRowid: number): void {
  db.prepare(`
    DELETE FROM graph_edges
    WHERE record_rowid = ?
      AND EXISTS (
        SELECT 1
        FROM graph_nodes AS source
        WHERE source.node_id = graph_edges.src_node_id
          AND (
            (graph_edges.edge_type = 'contains' AND source.node_type = 'test')
            OR (
              graph_edges.edge_type = 'composed-of'
              AND source.node_type = 'procedure'
            )
            OR (
              graph_edges.edge_type IN ('uses', 'on', 'part-of')
              AND source.node_type = 'step'
            )
            OR (graph_edges.edge_type = 'precedes' AND source.node_type = 'flow')
            OR (graph_edges.edge_type = 'caused-by' AND source.node_type = 'error')
          )
      )
  `).run(recordRowid)
}

/** Re-read every valid bundle so fixture/live observation changes do not depend on bundle hashes. */
function emitObservationEdges(
  db: DatabaseSync,
  knowledgeRoot: string,
  sources: readonly ProjectedBundle[],
  scanIssues: string[],
): void {
  const prepared: GraphDerivation[] = []
  const recordRowids: number[] = []
  for (const source of sources) {
    const row = db
      .prepare('SELECT record_rowid FROM records WHERE bundle_id = ?')
      .get(source.bundle.manifest.id)
    if (row === undefined) continue
    const recordRowid = Number(row.record_rowid)
    const context: GraphDerivationContext = {
      bundleId: source.bundle.manifest.id,
      recordRowid,
      product: source.product,
      createdAtOrdinal: source.bundle.frontmatter.createdAtOrdinal,
    }
    recordRowids.push(recordRowid)
    prepared.push(
      deriveObservationEdges(
        loadObservations(knowledgeRoot, source, scanIssues),
        context,
      ),
    )
  }

  transaction(db, () => {
    for (const recordRowid of recordRowids) deleteObservationEdges(db, recordRowid)
    for (const projection of prepared) insertGraphDerivation(db, projection)
  })
}

interface UsesEdgeRow {
  src_node_id: string
  dst_node_id: string
  record_rowid: number
  product: string
  recency_ordinal: number
  bundle_id: string
  node_type: GraphNodeType
  natural_key_json: string
}

function accumulatedUsesEdges(db: DatabaseSync): {
  nodes: DerivedGraphNode[]
  edges: DerivedGraphEdge[]
} {
  const rows = db.prepare(`
    SELECT
      edge.src_node_id,
      edge.dst_node_id,
      edge.record_rowid,
      edge.product,
      edge.recency_ordinal,
      records.bundle_id,
      target.node_type,
      target.natural_key_json
    FROM graph_edges AS edge
    JOIN records ON records.record_rowid = edge.record_rowid
    JOIN graph_nodes AS target ON target.node_id = edge.dst_node_id
    WHERE edge.edge_type = 'uses'
    ORDER BY
      edge.src_node_id,
      edge.edge_type,
      edge.dst_node_id,
      edge.record_rowid
  `).all() as unknown as UsesEdgeRow[]

  const nodes = new Map<string, DerivedGraphNode>()
  const edges: DerivedGraphEdge[] = []
  for (const row of rows) {
    if (!nodes.has(row.dst_node_id)) {
      nodes.set(row.dst_node_id, {
        nodeId: row.dst_node_id,
        type: row.node_type,
        naturalKey: JSON.parse(row.natural_key_json) as GraphNodeNaturalKey,
        product: row.product,
      })
    }
    edges.push({
      srcNodeId: row.src_node_id,
      edgeType: 'uses',
      dstNodeId: row.dst_node_id,
      recordRowid: Number(row.record_rowid),
      bundleId: row.bundle_id,
      product: row.product,
      recencyOrdinal: Number(row.recency_ordinal),
    })
  }
  return { nodes: [...nodes.values()], edges }
}

function emitEquivalentToBridges(db: DatabaseSync): void {
  const accumulated = accumulatedUsesEdges(db)
  const bridges = deriveEquivalentToBridges(accumulated.nodes, accumulated.edges)

  transaction(db, () => {
    db.exec(`
      DELETE FROM graph_edges
      WHERE edge_type = 'equivalent-to'
        AND EXISTS (
          SELECT 1
          FROM graph_nodes AS source
          JOIN graph_nodes AS target
            ON target.node_id = graph_edges.dst_node_id
          WHERE source.node_id = graph_edges.src_node_id
            AND source.node_type = 'web-element'
            AND target.node_type = 'mobile-element'
        )
    `)
    for (const edge of bridges) insertGraphEdge(db, edge)
  })
}

function removeOrphanGraphNodes(db: DatabaseSync): void {
  transaction(db, () => {
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

/** Recompute graph-derived prose only after every graph-producing pass has converged. */
function refreshContextualRenderings(db: DatabaseSync, force = false): number {
  const rows = db.prepare(`
    SELECT record_rowid, embedding_input, contextual_rendering
    FROM records
    ORDER BY record_rowid
  `).all()
  let refreshed = 0

  for (const row of rows) {
    const recordRowid = Number(row.record_rowid)
    const situatingLine = buildSituatingLine(db, recordRowid)
    const contextualRendering = renderContextual(
      String(row.embedding_input),
      situatingLine,
    )
    if (
      !force
      && !computeRenderingDrift(
        contextualRendering,
        String(row.contextual_rendering),
      )
    ) {
      continue
    }

    transaction(db, () => {
      const fts = db
        .prepare('SELECT identity FROM fts_records WHERE rowid = ?')
        .get(recordRowid)
      if (fts === undefined) {
        throw new Error(`contextual FTS row ${recordRowid} is missing`)
      }
      db.prepare(`
        UPDATE records
        SET
          situating_line = ?,
          contextual_rendering = ?,
          embed_status = 'pending',
          embedding = NULL
        WHERE record_rowid = ?
      `).run(situatingLine, contextualRendering, recordRowid)
      db.prepare('DELETE FROM fts_records WHERE rowid = ?').run(recordRowid)
      db.prepare(`
        INSERT INTO fts_records (rowid, identity, content, context)
        VALUES (?, ?, ?, ?)
      `).run(
        recordRowid,
        String(fts.identity),
        String(row.embedding_input),
        situatingLine,
      )
    })
    refreshed += 1
  }
  return refreshed
}

function removeMissingBundles(
  db: DatabaseSync,
  vec: VecCapability,
  seenBundleIds: ReadonlySet<string>,
  activeProfile: EmbeddingProfile,
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
      ? vecTableName(activeProfile)
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
  activeProfile: EmbeddingProfile,
  newlyProjectedBundleIds: ReadonlySet<string>,
): Promise<number> {
  if (embedder === undefined) return 0

  const pending = db
    .prepare(`
      SELECT record_rowid, bundle_id, contextual_rendering
      FROM records
      WHERE embed_status != 'present'
      ORDER BY record_rowid
    `)
    .all()
  let backfilled = 0
  for (const row of pending) {
    let vector: Float32Array
    try {
      vector = await embedder.embedDocument(String(row.contextual_rendering))
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
        Number(row.record_rowid),
        vector,
        activeProfile,
      )
    })
    // Keep RebuildReport.backfilled's established meaning: rows carried pending into this rebuild.
    if (!newlyProjectedBundleIds.has(String(row.bundle_id))) backfilled += 1
  }
  return backfilled
}

function reconcileVecRows(
  db: DatabaseSync,
  vec: VecCapability,
  activeProfile: EmbeddingProfile,
): void {
  if (vec !== 'vec0') return
  const tableName = vecTableName(activeProfile)
  const vecRows = new Map(
    db.prepare(`
      SELECT record_rowid, scope_tier, scope_key, status
      FROM ${tableName}
    `).all().map((row) => [
      Number(row.record_rowid),
      {
        scopeTier: String(row.scope_tier),
        scopeKey: String(row.scope_key),
        status: String(row.status),
      },
    ]),
  )
  /**
   * Writer open verifies the meta stamp before any present canonical bytes are trusted, so the
   * stamp is their profile provenance without adding a per-row profile column. Status and exact
   * byte length remain defense-in-depth gates: the active vec table must never receive bytes that
   * the active profile could not have produced.
   */
  const canonical = db
    .prepare(`
      SELECT record_rowid, product, scope_tier, scope_key, status, embedding
      FROM records
      WHERE embedding IS NOT NULL
        AND embed_status = 'present'
        AND length(embedding) = ?
      ORDER BY record_rowid
    `)
    .all(activeProfile.dim * Float32Array.BYTES_PER_ELEMENT)
  const canonicalRowids = new Set(canonical.map((row) => Number(row.record_rowid)))

  transaction(db, () => {
    const deleteVec = db.prepare(`DELETE FROM ${tableName} WHERE record_rowid = ?`)
    for (const recordRowid of vecRows.keys()) {
      if (!canonicalRowids.has(recordRowid)) deleteVec.run(BigInt(recordRowid))
    }

    const insertVec = db.prepare(`
      INSERT INTO ${tableName} (
        record_rowid, product, scope_tier, scope_key, status, embedding
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    const updateMetadata = db.prepare(`
      UPDATE ${tableName}
      SET scope_tier = ?, scope_key = ?, status = ?
      WHERE record_rowid = ?
    `)
    for (const row of canonical) {
      const recordRowid = Number(row.record_rowid)
      const scopeTier = String(row.scope_tier)
      const scopeKey = String(row.scope_key)
      const status = String(row.status)
      const vecRow = vecRows.get(recordRowid)
      if (vecRow === undefined) {
        insertVec.run(
          BigInt(recordRowid),
          String(row.product),
          scopeTier,
          scopeKey,
          status,
          row.embedding as Uint8Array,
        )
        continue
      }
      if (
        vecRow.scopeTier !== scopeTier
        || vecRow.scopeKey !== scopeKey
        || vecRow.status !== status
      ) {
        updateMetadata.run(scopeTier, scopeKey, status, BigInt(recordRowid))
      }
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
  const activeProfile = resolveActiveProfile(writer.db)
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
      const item = { bundle: outcome.bundle, dir: entry.dir, product: entry.product }
      relationSources.push(item)
      const current = writer.db
        .prepare(`
          SELECT mutable_state_hash
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

      projectBundle(writer.db, writer.vec, item, activeProfile)
      projected.push(item)
      report.projected += 1
      if (processedBundles % CHECKPOINT_EVERY_N_BUNDLES === 0) {
        writer.checkpointPassive()
      }
    }

    report.removed = removeMissingBundles(
      writer.db,
      writer.vec,
      seenBundleIds,
      activeProfile,
    )
    emitRelationEdges(writer.db, relationSources)
    emitObservationEdges(writer.db, opts.knowledgeRoot, relationSources, report.scanIssues)
    emitEquivalentToBridges(writer.db)
    removeOrphanGraphNodes(writer.db)
    refreshContextualRenderings(writer.db)
    report.backfilled = await backfillPendingEmbeddings(
      writer.db,
      writer.vec,
      opts.embedder,
      activeProfile,
      new Set(projected.map(({ bundle }) => bundle.manifest.id)),
    )
    reconcileVecRows(writer.db, writer.vec, activeProfile)
    clearRebuildRequest(opts.knowledgeRoot)
    return report
  } finally {
    writer.close()
  }
}
