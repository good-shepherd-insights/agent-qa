import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  expandOneHop,
  type ExpansionQueryScope,
  type ExpansionSeed,
} from '../retrieval/expansion.js'
import {
  FAN_OUT_CAP,
  HUB_DEGREE_THRESHOLD,
} from '../retrieval/constants.js'

const QUERY_SCOPE = {
  product: 'storefront',
  testKey: 'test:checkout',
  suiteKey: 'suite:smoke',
  productKey: 'product:storefront',
  globalKey: 'scope:global',
} as const satisfies ExpansionQueryScope

type ScopeTier = 'global' | 'product' | 'suite' | 'test'
type RecordStatus = 'active' | 'candidate' | 'deprecated' | 'superseded'

interface InsertRecordOptions {
  product?: string
  scopeTier?: ScopeTier
  scopeKey?: string
  status?: RecordStatus
  trust?: number
}

interface RankedNeighbor {
  bundleId: string
  nodeId: string
  trust: number
  recencyOrdinal: number
}

describe('GRPH-01 deterministic one-hop expansion', () => {
  let db: DatabaseSync
  let nextRecordRowid: number
  let recordRowids: Map<string, number>

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    db.exec(`
      CREATE TABLE records (
        record_rowid INTEGER PRIMARY KEY,
        bundle_id TEXT NOT NULL UNIQUE,
        product TEXT NOT NULL,
        scope_tier TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        status TEXT NOT NULL,
        trust REAL NOT NULL
      );
      CREATE TABLE graph_edges (
        src_node_id TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        dst_node_id TEXT NOT NULL,
        record_rowid INTEGER NOT NULL,
        product TEXT NOT NULL,
        recency_ordinal INTEGER NOT NULL,
        UNIQUE(src_node_id, edge_type, dst_node_id, record_rowid)
      );
    `)
    nextRecordRowid = 1
    recordRowids = new Map()
  })

  afterEach(() => {
    db.close()
  })

  function insertRecord(bundleId: string, options: InsertRecordOptions = {}): number {
    const recordRowid = nextRecordRowid
    nextRecordRowid += 1
    db.prepare(`
      INSERT INTO records (
        record_rowid, bundle_id, product, scope_tier, scope_key, status, trust
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      recordRowid,
      bundleId,
      options.product ?? QUERY_SCOPE.product,
      options.scopeTier ?? 'test',
      options.scopeKey ?? QUERY_SCOPE.testKey,
      options.status ?? 'active',
      options.trust ?? 0.5,
    )
    recordRowids.set(bundleId, recordRowid)
    return recordRowid
  }

  function insertEdge(input: {
    source: string
    target: string
    candidateBundleId: string
    recencyOrdinal: number
    edgeType?: string
  }): void {
    const recordRowid = recordRowids.get(input.candidateBundleId)
    if (recordRowid === undefined) {
      throw new Error(`missing candidate record ${input.candidateBundleId}`)
    }
    db.prepare(`
      INSERT INTO graph_edges (
        src_node_id, edge_type, dst_node_id, record_rowid, product, recency_ordinal
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.source,
      input.edgeType ?? 'about',
      input.target,
      recordRowid,
      QUERY_SCOPE.product,
      input.recencyOrdinal,
    )
  }

  function expand(seeds: readonly ExpansionSeed[], n = 10) {
    return expandOneHop(db, seeds, QUERY_SCOPE, n)
  }

  it('returns incoming and outgoing one-hop records without feeding candidates into a second hop', () => {
    insertRecord('seed', { trust: 1 })
    insertRecord('one-hop-outgoing', { trust: 0.9 })
    insertRecord('one-hop-incoming', { trust: 0.8 })
    insertRecord('two-hops-away', { trust: 0.99 })

    insertEdge({
      source: 'node:seed',
      target: 'node:one-hop',
      candidateBundleId: 'one-hop-outgoing',
      recencyOrdinal: 20,
    })
    insertEdge({
      source: 'node:incoming',
      target: 'node:seed',
      candidateBundleId: 'one-hop-incoming',
      recencyOrdinal: 19,
    })
    insertEdge({
      source: 'node:one-hop',
      target: 'node:two-hop',
      candidateBundleId: 'two-hops-away',
      recencyOrdinal: 30,
    })

    expect(expand([{ bundleId: 'seed', nodeIds: ['node:seed'] }])).toMatchObject([
      { bundleId: 'one-hop-outgoing', source: 'expanded', seedBundleIds: ['seed'] },
      { bundleId: 'one-hop-incoming', source: 'expanded', seedBundleIds: ['seed'] },
    ])
  })

  it('caps each seed node at the deterministic trust, recency, then node-id top 32', () => {
    insertRecord('seed', { trust: 1 })
    const neighbors: RankedNeighbor[] = Array.from({ length: 40 }, (_, index) => {
      const suffix = String(index).padStart(2, '0')
      return {
        bundleId: `neighbor:${suffix}`,
        nodeId: `neighbor:${suffix}`,
        trust: (index % 4) / 10 + 0.5,
        recencyOrdinal: Math.floor(index / 4),
      }
    })
    for (const neighbor of neighbors) {
      insertRecord(neighbor.bundleId, { trust: neighbor.trust })
      insertEdge({
        source: 'node:seed',
        target: neighbor.nodeId,
        candidateBundleId: neighbor.bundleId,
        recencyOrdinal: neighbor.recencyOrdinal,
      })
    }

    const expected = [...neighbors]
      .sort(
        (left, right) =>
          right.trust - left.trust
          || right.recencyOrdinal - left.recencyOrdinal
          || left.nodeId.localeCompare(right.nodeId),
      )
      .slice(0, FAN_OUT_CAP)
      .map(({ bundleId }) => bundleId)

    const first = expand([{ bundleId: 'seed', nodeIds: ['node:seed'] }], 100)
    const second = expand([{ bundleId: 'seed', nodeIds: ['node:seed'] }], 100)

    expect(first).toHaveLength(FAN_OUT_CAP)
    expect(first.map(({ bundleId }) => bundleId)).toEqual(expected)
    expect(second).toEqual(first)
  })

  it('skips a hub as both the seed-side node and the opposite endpoint', () => {
    insertRecord('seed', { trust: 1 })
    insertRecord('hub-adjacent', { trust: 0.99 })
    insertRecord('hub-only-target', { trust: 0.98 })
    insertEdge({
      source: 'node:seed',
      target: 'node:hub',
      candidateBundleId: 'hub-adjacent',
      recencyOrdinal: 100,
    })
    for (let index = 0; index < HUB_DEGREE_THRESHOLD; index += 1) {
      insertEdge({
        source: 'node:hub',
        target: `node:hub-spoke:${index}`,
        candidateBundleId: 'hub-only-target',
        recencyOrdinal: index,
        edgeType: `spoke:${index}`,
      })
    }

    expect(expand([{ bundleId: 'seed', nodeIds: ['node:seed'] }])).toEqual([])
    expect(expand([{ bundleId: 'seed', nodeIds: ['node:hub'] }], 100)).toEqual([])
  })

  it('applies the shared fail-closed pre-filter before admitting an expanded record', () => {
    insertRecord('seed', { trust: 1 })
    insertRecord('admitted', { trust: 0.7 })
    insertRecord('superseded', { status: 'superseded', trust: 0.9 })
    insertRecord('sibling-product', {
      product: 'payments',
      scopeTier: 'product',
      scopeKey: QUERY_SCOPE.productKey,
      trust: 0.8,
    })
    for (const [index, bundleId] of ['admitted', 'superseded', 'sibling-product'].entries()) {
      insertEdge({
        source: 'node:seed',
        target: `node:${bundleId}`,
        candidateBundleId: bundleId,
        recencyOrdinal: 10 - index,
      })
    }

    expect(expand([{ bundleId: 'seed', nodeIds: ['node:seed'] }])).toMatchObject([
      { bundleId: 'admitted' },
    ])
  })
})
