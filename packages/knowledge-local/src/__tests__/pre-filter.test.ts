import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { openIndexWriter } from '../index-open.js'
import { preFilterPredicate } from '../retrieval/pre-filter.js'
import { scaffoldKnowledgeRoot } from './fixtures/bundle-fixture.js'

const FILTER_OPTIONS = {
  product: 'storefront',
  testKey: 'test:checkout',
  suiteKey: 'suite:smoke',
  productKey: 'product:storefront',
  globalKey: 'global',
} as const

function insertRecord(
  db: DatabaseSync,
  input: {
    bundleId: string
    product: string
    scopeTier: 'global' | 'product' | 'suite' | 'test'
    scopeKey: string
    status: 'active' | 'candidate' | 'deprecated' | 'superseded'
  },
): void {
  db.prepare(`
    INSERT INTO records (
      bundle_id, product, mutable_state_hash, kind, subtype,
      scope_tier, scope_key, status, trust,
      confirmed, contradicted, helpful, harmful,
      opened_at_ordinal, closed_at_ordinal, created_at_ordinal,
      origin_class, summary, embedding_input
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, 0, 0, 0, 1, NULL, 1, ?, ?, ?)
  `).run(
    input.bundleId,
    input.product,
    `hash-${input.bundleId}`,
    'fact',
    input.scopeTier,
    input.scopeKey,
    input.status,
    0.5,
    'agent-observed',
    input.bundleId,
    input.bundleId,
  )
}

function filteredIds(db: DatabaseSync, includeSuperseded = false): string[] {
  const predicate = preFilterPredicate({ ...FILTER_OPTIONS, includeSuperseded })
  return db
    .prepare(`
      SELECT r.bundle_id
      FROM records r
      WHERE ${predicate.sql}
      ORDER BY r.bundle_id
    `)
    .all(...predicate.binds)
    .map((row) => String(row.bundle_id))
}

describe('preFilterPredicate', () => {
  let knowledgeRoot: string
  let db: DatabaseSync
  let close: () => void

  beforeEach(async () => {
    knowledgeRoot = await mkdtemp(join(tmpdir(), 'knowledge-pre-filter-'))
    scaffoldKnowledgeRoot(knowledgeRoot)
    const writer = openIndexWriter(knowledgeRoot, { vecLoadablePath: '' })
    db = writer.db
    close = writer.close

    insertRecord(db, {
      bundleId: 'test-row',
      product: FILTER_OPTIONS.product,
      scopeTier: 'test',
      scopeKey: FILTER_OPTIONS.testKey,
      status: 'active',
    })
    insertRecord(db, {
      bundleId: 'suite-row',
      product: FILTER_OPTIONS.product,
      scopeTier: 'suite',
      scopeKey: FILTER_OPTIONS.suiteKey,
      status: 'candidate',
    })
    insertRecord(db, {
      bundleId: 'product-row',
      product: FILTER_OPTIONS.product,
      scopeTier: 'product',
      scopeKey: FILTER_OPTIONS.productKey,
      status: 'active',
    })
    insertRecord(db, {
      bundleId: 'global-row',
      product: 'shared',
      scopeTier: 'global',
      scopeKey: FILTER_OPTIONS.globalKey,
      status: 'active',
    })
    insertRecord(db, {
      bundleId: 'superseded-row',
      product: FILTER_OPTIONS.product,
      scopeTier: 'test',
      scopeKey: FILTER_OPTIONS.testKey,
      status: 'superseded',
    })
    insertRecord(db, {
      bundleId: 'deprecated-row',
      product: FILTER_OPTIONS.product,
      scopeTier: 'suite',
      scopeKey: FILTER_OPTIONS.suiteKey,
      status: 'deprecated',
    })
    insertRecord(db, {
      bundleId: 'sibling-row',
      product: 'payments',
      scopeTier: 'product',
      scopeKey: FILTER_OPTIONS.productKey,
      status: 'active',
    })
  })

  afterEach(async () => {
    close()
    await rm(knowledgeRoot, { recursive: true, force: true })
  })

  it('admits the four-key scope union while excluding withdrawn and sibling-product rows', () => {
    expect(filteredIds(db)).toEqual([
      'global-row',
      'product-row',
      'suite-row',
      'test-row',
    ])
  })

  it('re-admits withdrawn status without relaxing the product scope wall', () => {
    expect(filteredIds(db, true)).toEqual([
      'deprecated-row',
      'global-row',
      'product-row',
      'suite-row',
      'superseded-row',
      'test-row',
    ])
    expect(filteredIds(db, true)).not.toContain('sibling-row')
  })

  it('binds every caller value and keeps placeholder count aligned with binds', () => {
    const predicate = preFilterPredicate(FILTER_OPTIONS)

    expect(predicate.binds).toEqual([
      FILTER_OPTIONS.product,
      FILTER_OPTIONS.testKey,
      FILTER_OPTIONS.suiteKey,
      FILTER_OPTIONS.productKey,
      FILTER_OPTIONS.globalKey,
    ])
    expect(predicate.sql.match(/\?/gu) ?? []).toHaveLength(predicate.binds.length)
    for (const value of Object.values(FILTER_OPTIONS)) {
      expect(predicate.sql).not.toContain(value)
    }
  })
})
