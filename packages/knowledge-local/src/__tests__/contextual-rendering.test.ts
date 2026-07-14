import { DatabaseSync } from 'node:sqlite'

import { canonicalJson, graphNodeId } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  buildSituatingLine,
  computeRenderingDrift,
  renderContextual,
} from '../contextual-rendering.js'
import { SITUATING_LINE_MAX_CHARS } from '../retrieval/constants.js'

type RecordKind = 'fact' | 'procedure' | 'caution'

describe('RETR-02 deterministic contextual rendering', () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    db.exec(`
      CREATE TABLE records (
        record_rowid INTEGER PRIMARY KEY,
        bundle_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        trust REAL NOT NULL
      );
      CREATE TABLE graph_nodes (
        node_id TEXT PRIMARY KEY,
        node_type TEXT NOT NULL,
        natural_key_json TEXT NOT NULL,
        product TEXT NOT NULL
      );
      CREATE TABLE graph_edges (
        src_node_id TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        dst_node_id TEXT NOT NULL,
        record_rowid INTEGER NOT NULL,
        product TEXT NOT NULL,
        recency_ordinal INTEGER NOT NULL
      );
    `)
  })

  afterEach(() => {
    db.close()
  })

  function insertRecord(
    recordRowid: number,
    bundleId: string,
    kind: RecordKind,
    summary: string,
    trust: number,
  ): string {
    db.prepare(`
      INSERT INTO records (record_rowid, bundle_id, kind, summary, trust)
      VALUES (?, ?, ?, ?, ?)
    `).run(recordRowid, bundleId, kind, summary, trust)
    return insertNode(kind, bundleId)
  }

  function insertNode(type: string, naturalKey: unknown): string {
    const nodeId = graphNodeId(type as never, naturalKey as never)
    db.prepare(`
      INSERT INTO graph_nodes (node_id, node_type, natural_key_json, product)
      VALUES (?, ?, ?, ?)
    `).run(nodeId, type, canonicalJson(naturalKey as never), 'checkout')
    return nodeId
  }

  function insertEdge(input: {
    source: string
    type: string
    target: string
    recordRowid: number
    recency: number
  }): void {
    db.prepare(`
      INSERT INTO graph_edges (
        src_node_id, edge_type, dst_node_id, record_rowid, product, recency_ordinal
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.source,
      input.type,
      input.target,
      input.recordRowid,
      'checkout',
      input.recency,
    )
  }

  it('renders owning page and flow, one lineage neighbor, and one attached caution', () => {
    const current = insertRecord(1, 'current-fact', 'fact', 'Current checkout fact', 0.7)
    const previous = insertRecord(2, 'previous-fact', 'fact', 'Previous checkout selector', 0.9)
    const caution = insertRecord(
      3,
      'checkout-caution',
      'caution',
      'Confirm the cart total first',
      0.8,
    )
    const element = insertNode('web-element', { role: 'button', name: 'Continue' })
    const page = insertNode('web-page', '/checkout')
    const flow = insertNode('flow', 'checkout')

    insertEdge({ source: current, type: 'about', target: element, recordRowid: 1, recency: 10 })
    insertEdge({ source: element, type: 'part-of', target: page, recordRowid: 1, recency: 11 })
    insertEdge({ source: element, type: 'part-of', target: flow, recordRowid: 1, recency: 12 })
    insertEdge({ source: current, type: 'supersedes', target: previous, recordRowid: 1, recency: 13 })
    insertEdge({ source: current, type: 'relates-to', target: caution, recordRowid: 1, recency: 14 })

    const line = buildSituatingLine(db, 1)

    expect(line).toContain('Page: /checkout.')
    expect(line).toContain('Flow: checkout.')
    expect(line).toContain('Supersession: Previous checkout selector.')
    expect(line).toContain('Caution: Confirm the cart total first.')
    expect(line.length).toBeLessThanOrEqual(SITUATING_LINE_MAX_CHARS)
  })

  it('orders candidates by trust, recency ordinal, and node id before whole-clause truncation', () => {
    const current = insertRecord(1, 'current-fact', 'fact', 'Current checkout fact', 0.5)
    const element = insertNode('web-element', { role: 'button', name: 'Continue' })
    insertEdge({ source: current, type: 'about', target: element, recordRowid: 1, recency: 1 })

    const high = `high-${'a'.repeat(88)}`
    const newer = `newer-${'b'.repeat(88)}`
    const lower = `lower-${'c'.repeat(88)}`
    const highPage = insertNode('web-page', high)
    const newerPage = insertNode('web-page', newer)
    const lowerPage = insertNode('web-page', lower)
    insertRecord(2, 'high-support', 'fact', 'high support', 0.9)
    insertRecord(3, 'newer-support', 'fact', 'newer support', 0.8)
    insertRecord(4, 'lower-support', 'fact', 'lower support', 0.8)
    insertEdge({ source: element, type: 'part-of', target: highPage, recordRowid: 2, recency: 5 })
    insertEdge({ source: element, type: 'part-of', target: newerPage, recordRowid: 3, recency: 9 })
    insertEdge({ source: element, type: 'part-of', target: lowerPage, recordRowid: 4, recency: 3 })

    const first = buildSituatingLine(db, 1)
    const second = buildSituatingLine(db, 1)

    expect(first).toBe(second)
    expect(first).toBe(`Page: ${high}. Page: ${newer}.`)
    expect(first).not.toContain(lower)
    expect(first.length).toBeLessThanOrEqual(SITUATING_LINE_MAX_CHARS)
  })

  it('keeps self fields byte-identical when no qualifying neighbor exists', () => {
    insertRecord(1, 'isolated-fact', 'fact', 'Isolated fact', 0.5)

    expect(buildSituatingLine(db, 1)).toBe('')
    expect(renderContextual('self fields', '')).toBe('self fields')
  })

  it('assembles two parts without whitespace drift and compares stored bytes strictly', () => {
    expect(renderContextual('self fields', 'Page: /checkout.')).toBe(
      'self fields\nPage: /checkout.',
    )
    expect(computeRenderingDrift('same bytes', 'same bytes')).toBe(false)
    expect(computeRenderingDrift('same bytes\n', 'same bytes')).toBe(true)
  })
})
