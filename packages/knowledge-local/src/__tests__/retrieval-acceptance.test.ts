import {
  cpSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BundleOutcomeEventSchema,
  type Anchor,
  type BundleOutcomeEvent,
  type BundleRelation,
  type DistilledObservation,
  type OriginClass,
} from '@vostride/agent-qa-schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  appendRelation,
  buildRetrievalQuery,
  openIndexReaderConnection,
  openKnowledgeReader,
  publishBundle,
  rebuildIndex,
  resolveActiveProfile,
  retrieve,
  vecTableName,
  type BundleStoreConfig,
  type PublishBundleInput,
  type PublishBundleOutcome,
} from '../index.js'
import {
  makeBundleDraftFixture,
  makeScreenStateFixture,
  scaffoldKnowledgeRoot,
} from './fixtures/bundle-fixture.js'
import { makeFakeEmbedder } from './fixtures/fake-embedder.js'
import { publishObservationFixture } from './fixtures/observation-fixture.js'

type PublishedBundle = Extract<PublishBundleOutcome, { kind: 'published' }>

interface AcceptanceIds {
  activeOld: string
  activeNew: string
  user: string
  superseded: string
  sibling: string
  fallbackOld: string
  fallbackNew: string
  conflictLeft: string
  conflictRight: string
  conflictUnknown: string
  expansionSeed: string
  expansionNeighbors: string[]
  poisonedGlobal: string
  curatedBridgeSource: string
  curatedBridgeTarget: string
}

interface AcceptanceFixture {
  tempRoot: string
  canonicalRoot: string
  permutedRoot: string
  vecRoot: string
  bruteRoot: string
  ids: AcceptanceIds
}

interface GraphDumpRow {
  src_node_id: string
  src_type: string
  edge_type: string
  dst_node_id: string
  dst_type: string
  bundle_id: string
  product: string
  recency_ordinal: number
}

interface ProjectionRow {
  embedding_input: string
  situating_line: string
  contextual_rendering: string
  fts_context: string
}

const PRODUCT = 'acceptance-storefront'
const SIBLING_PRODUCT = 'acceptance-payments'
const EXPANSION_FRACTION = 0.25
const FAN_OUT_CAP = 32
const RAW_SELECTOR = '[data-testid="acceptance-checkout"]'
const TEST_DIR = dirname(fileURLToPath(import.meta.url))

const MAIN_ANCHOR = {
  t: 'el',
  role: 'button',
  name: 'Acceptance checkout',
} as const satisfies Anchor
const FALLBACK_ANCHOR = {
  t: 'el',
  role: 'button',
  name: 'Acceptance fallback',
} as const satisfies Anchor
const CONFLICT_ANCHOR = {
  t: 'page',
  route: '/acceptance-conflict',
} as const satisfies Anchor
const EXPANSION_ANCHOR = {
  t: 'flow',
  name: 'Acceptance expansion seed',
} as const satisfies Anchor
const POISON_ANCHOR = {
  t: 'error',
  message: 'Acceptance poison direct match',
} as const satisfies Anchor
const SIBLING_ANCHOR = {
  t: 'page',
  route: '/acceptance-sibling',
} as const satisfies Anchor

let acceptance: AcceptanceFixture | undefined

beforeAll(async () => {
  acceptance = await buildAcceptanceFixture()
}, 120_000)

afterAll(() => {
  if (acceptance !== undefined) {
    rmSync(acceptance.tempRoot, { recursive: true, force: true })
  }
})

function fixture(): AcceptanceFixture {
  if (acceptance === undefined) throw new Error('acceptance fixture is unavailable')
  return acceptance
}

function orderedIds(entries: readonly { id: string }[]): string[] {
  return entries.map(({ id }) => String(id))
}

function dumpGraph(knowledgeRoot: string): GraphDumpRow[] {
  const connection = openIndexReaderConnection(knowledgeRoot)
  try {
    return connection.db.prepare(`
      SELECT
        edge.src_node_id,
        source.node_type AS src_type,
        edge.edge_type,
        edge.dst_node_id,
        target.node_type AS dst_type,
        records.bundle_id,
        edge.product,
        edge.recency_ordinal
      FROM graph_edges AS edge
      JOIN graph_nodes AS source ON source.node_id = edge.src_node_id
      JOIN graph_nodes AS target ON target.node_id = edge.dst_node_id
      JOIN records ON records.record_rowid = edge.record_rowid
      ORDER BY
        edge.src_node_id,
        edge.edge_type,
        edge.dst_node_id,
        records.bundle_id,
        edge.product,
        edge.recency_ordinal
    `).all() as unknown as GraphDumpRow[]
  } finally {
    connection.db.close()
  }
}

function projection(knowledgeRoot: string, bundleId: string): ProjectionRow {
  const connection = openIndexReaderConnection(knowledgeRoot)
  try {
    const row = connection.db.prepare(`
      SELECT
        records.embedding_input,
        records.situating_line,
        records.contextual_rendering,
        fts_records.context AS fts_context
      FROM records
      JOIN fts_records ON fts_records.rowid = records.record_rowid
      WHERE records.bundle_id = ?
    `).get(bundleId)
    if (row === undefined) throw new Error(`missing projection for ${bundleId}`)
    return row as unknown as ProjectionRow
  } finally {
    connection.db.close()
  }
}

function rawVecIds(
  knowledgeRoot: string,
  embedding: Float32Array,
  statusFiltered: boolean,
): string[] {
  const connection = openIndexReaderConnection(knowledgeRoot)
  try {
    expect(connection.vec).toBe('vec0')
    const tableName = vecTableName(resolveActiveProfile(connection.db))
    const statusClause = statusFiltered
      ? "AND status != 'deprecated' AND status != 'superseded'"
      : ''
    const query = Buffer.from(
      embedding.buffer,
      embedding.byteOffset,
      embedding.byteLength,
    )
    const rows = connection.db.prepare(`
      SELECT record_rowid
      FROM ${tableName}
      WHERE embedding MATCH ?
        AND product = ?
        AND scope_key = ?
        ${statusClause}
        AND k = ?
      ORDER BY distance, record_rowid
    `).all(query, PRODUCT, PRODUCT, 128)

    return rows.map((row) => {
      const record = connection.db
        .prepare('SELECT bundle_id FROM records WHERE record_rowid = ?')
        .get(row.record_rowid)
      if (record === undefined) throw new Error('vec row has no projected record')
      return String(record.bundle_id)
    })
  } finally {
    connection.db.close()
  }
}

function phaseSourceFiles(): string[] {
  const retrievalDir = join(TEST_DIR, '..', 'retrieval')
  const retrievalFiles = readdirSync(retrievalDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(retrievalDir, entry.name))
  return [
    ...retrievalFiles,
    join(TEST_DIR, '..', 'graph-derive.ts'),
    join(TEST_DIR, '..', 'contextual-rendering.ts'),
    join(TEST_DIR, '..', 'retrieve.ts'),
    join(TEST_DIR, '..', 'query-helper.ts'),
  ].sort()
}

describe('ROADMAP success criterion 1 — deterministic graph construction', () => {
  it('rebuilds identical bundle-keyed edges with curated and mechanical bridges', async () => {
    const { canonicalRoot, permutedRoot, ids } = fixture()
    const first = dumpGraph(canonicalRoot)

    await expect(rebuildIndex({ knowledgeRoot: canonicalRoot })).resolves.toMatchObject({
      projected: 0,
      scanIssues: [],
    })

    expect(dumpGraph(canonicalRoot)).toEqual(first)
    expect(dumpGraph(permutedRoot)).toEqual(first)

    const bridges = first.filter(({ edge_type }) => edge_type === 'equivalent-to')
    expect(bridges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        src_type: 'fact',
        dst_type: 'fact',
        bundle_id: ids.curatedBridgeSource,
      }),
      expect.objectContaining({ src_type: 'web-element', dst_type: 'mobile-element' }),
    ]))
  })
})

describe('ROADMAP success criterion 2 — bounded one-hop graph expansion', () => {
  it('contains global poison and enforces the fraction and fan-out ceilings', async () => {
    const { canonicalRoot, ids } = fixture()
    const reader = openKnowledgeReader(canonicalRoot)
    const neighborIds = new Set(ids.expansionNeighbors)
    try {
      const small = await retrieve(
        reader,
        { intent: '', anchors: [EXPANSION_ANCHOR] },
        { n: 20, product: PRODUCT, asOfBuild: 1_000 },
      )
      const large = await retrieve(
        reader,
        { intent: '', anchors: [EXPANSION_ANCHOR] },
        { n: 160, product: PRODUCT, asOfBuild: 1_000 },
      )
      const smallExpanded = orderedIds(small).filter((id) => neighborIds.has(id))
      const largeExpanded = orderedIds(large).filter((id) => neighborIds.has(id))

      expect(smallExpanded).toHaveLength(Math.ceil(EXPANSION_FRACTION * 20))
      expect(largeExpanded).toHaveLength(FAN_OUT_CAP)
      expect(orderedIds(small)).not.toContain(ids.poisonedGlobal)
      expect(orderedIds(large)).not.toContain(ids.poisonedGlobal)

      const direct = await retrieve(
        reader,
        { intent: '', anchors: [POISON_ANCHOR] },
        { n: 5, product: PRODUCT, asOfBuild: 1_000 },
      )
      expect(orderedIds(direct)).toContain(ids.poisonedGlobal)
    } finally {
      reader.close()
    }
  })
})

describe('ROADMAP success criterion 3 — fail-closed filters, audit, and fallback', () => {
  it('excludes withdrawn and sibling-product rows before serving and raw vec KNN', async () => {
    const { canonicalRoot, vecRoot, bruteRoot, ids } = fixture()
    const reader = openKnowledgeReader(canonicalRoot)
    try {
      for (const anchors of [[MAIN_ANCHOR], [SIBLING_ANCHOR], [MAIN_ANCHOR, SIBLING_ANCHOR]]) {
        const result = await retrieve(
          reader,
          { intent: '', anchors },
          { n: 128, product: PRODUCT, asOfBuild: 1_000 },
        )
        expect(orderedIds(result)).not.toContain(ids.superseded)
        expect(orderedIds(result)).not.toContain(ids.sibling)
      }
    } finally {
      reader.close()
    }

    const embedder = makeFakeEmbedder()
    const queryEmbedding = await embedder.embedQuery('acceptance raw status-filtered KNN')
    expect(rawVecIds(vecRoot, queryEmbedding, false)).toContain(ids.superseded)
    expect(rawVecIds(vecRoot, queryEmbedding, true)).not.toContain(ids.superseded)
    expect(rawVecIds(vecRoot, queryEmbedding, false)).not.toContain(ids.sibling)

    for (const [root, vecLoadablePath] of [
      [vecRoot, undefined],
      [bruteRoot, join(fixture().tempRoot, 'missing-sqlite-vec')],
    ] as const) {
      const denseReader = openKnowledgeReader(
        root,
        vecLoadablePath === undefined ? {} : { vecLoadablePath },
      )
      try {
        const denseIds = denseReader
          .searchDense(queryEmbedding, { product: PRODUCT, k: 128 })
          .map(({ bundleId }) => bundleId)
        expect(denseIds).not.toContain(ids.superseded)
        expect(denseIds).not.toContain(ids.sibling)
      } finally {
        denseReader.close()
      }
    }
  })

  it('returns typed full-truth audits and the flagged prior-build fallback', async () => {
    const { canonicalRoot, ids } = fixture()
    const reader = openKnowledgeReader(canonicalRoot)
    try {
      const query = { intent: '', anchors: [MAIN_ANCHOR] } as const
      const serving = await retrieve(reader, query, {
        n: 20,
        product: PRODUCT,
        asOfBuild: 1_000,
      })
      const supersededAudit = await retrieve(reader, query, {
        n: 20,
        product: PRODUCT,
        asOfBuild: 1_000,
        includeSuperseded: true,
      })
      const rangeAudit = await retrieve(reader, query, {
        n: 20,
        product: PRODUCT,
        asOfBuild: 1_000,
        asOfRange: { lo: 1, hi: 1_000 },
      })

      expect(orderedIds(supersededAudit)).toEqual(expect.arrayContaining([
        ids.activeOld,
        ids.activeNew,
        ids.user,
        ids.superseded,
      ]))
      expect(orderedIds(rangeAudit)).toEqual(expect.arrayContaining([
        ids.activeOld,
        ids.activeNew,
        ids.user,
      ]))
      expect(supersededAudit.length).toBeGreaterThan(serving.length)
      expect(rangeAudit.length).toBeGreaterThan(serving.length)
      expect([...supersededAudit, ...rangeAudit].every((entry) => entry.audit !== undefined))
        .toBe(true)
      expect(supersededAudit.find(({ id }) => id === ids.superseded)).toMatchObject({
        status: 'superseded',
        validity: 'audit',
        audit: { status: 'superseded' },
      })

      const fallback = await retrieve(
        reader,
        { intent: '', anchors: [FALLBACK_ANCHOR] },
        { n: 10, product: PRODUCT, asOfBuild: 1_000 },
      )
      expect(fallback).toMatchObject([
        {
          id: ids.fallbackNew,
          servedAs: 'prior-build-hypothesis',
          validity: 'prior-build-hypothesis',
        },
      ])
      expect(orderedIds(fallback)).not.toContain(ids.fallbackOld)
    } finally {
      reader.close()
    }
  })
})

describe('ROADMAP success criterion 4 — deterministic hybrid rank and carve-outs', () => {
  it('returns identical ids twice, after permuted rebuild, and across vec capabilities', async () => {
    const { canonicalRoot, permutedRoot, vecRoot, bruteRoot, tempRoot } = fixture()
    const query = { intent: '', anchors: [MAIN_ANCHOR, CONFLICT_ANCHOR] } as const
    const options = { n: 20, product: PRODUCT, asOfBuild: 1_000 } as const
    const canonical = openKnowledgeReader(canonicalRoot)
    const permuted = openKnowledgeReader(permutedRoot)
    const vec = openKnowledgeReader(vecRoot)
    const brute = openKnowledgeReader(bruteRoot, {
      vecLoadablePath: join(tempRoot, 'missing-sqlite-vec'),
    })
    try {
      expect(vec.vec).toBe('vec0')
      expect(brute.vec).toBe('brute')

      const first = orderedIds(await retrieve(canonical, query, options))
      const second = orderedIds(await retrieve(canonical, query, options))
      const permutedIds = orderedIds(await retrieve(permuted, query, options))
      const vecIds = orderedIds(await retrieve(vec, query, options))
      const bruteIds = orderedIds(await retrieve(brute, query, options))

      expect(second).toEqual(first)
      expect(permutedIds).toEqual(first)
      expect(bruteIds).toEqual(vecIds)
    } finally {
      canonical.close()
      permuted.close()
      vec.close()
      brute.close()
    }
  }, 120_000)

  it('preserves user sovereignty and annotates both MintUnknown peers', async () => {
    const { canonicalRoot, ids } = fixture()
    const reader = openKnowledgeReader(canonicalRoot)
    try {
      const collapsed = await retrieve(
        reader,
        { intent: '', anchors: [MAIN_ANCHOR] },
        { n: 20, product: PRODUCT, asOfBuild: 1_000 },
      )
      expect(orderedIds(collapsed)).toContain(ids.user)
      expect(orderedIds(collapsed)).toContain(ids.activeNew)
      expect(orderedIds(collapsed)).not.toContain(ids.activeOld)

      const conflicts = await retrieve(
        reader,
        { intent: '', anchors: [CONFLICT_ANCHOR] },
        { n: 20, product: PRODUCT, asOfBuild: 1_000 },
      )
      expect(conflicts.find(({ id }) => id === ids.conflictLeft)?.conflict).toEqual({
        peerRecordId: ids.conflictRight,
        unknownRecordId: ids.conflictUnknown,
      })
      expect(conflicts.find(({ id }) => id === ids.conflictRight)?.conflict).toEqual({
        peerRecordId: ids.conflictLeft,
        unknownRecordId: ids.conflictUnknown,
      })
      expect(conflicts.find(({ id }) => id === ids.conflictUnknown)).toMatchObject({
        kind: 'unknown',
      })
    } finally {
      reader.close()
    }
  })
})

describe('ROADMAP success criterion 5 — normalized and contextual renderings', () => {
  it('normalizes anchors, keeps selectors lexical-only, and mirrors index-side context', async () => {
    const { canonicalRoot, ids } = fixture()
    const input = {
      intent: 'Complete acceptance checkout',
      anchors: [
        { t: 'selector', literal: RAW_SELECTOR },
        { t: 'el', role: ' BUTTON ', name: ' Acceptance checkout (9) ' },
      ],
      screenState: makeScreenStateFixture(),
    } as const
    const first = buildRetrievalQuery(input)
    const second = buildRetrievalQuery(input)

    expect(second).toEqual(first)
    expect(first.normalizedAnchors[1]).toEqual(MAIN_ANCHOR)
    expect(first.lexicalQuery).toContain(RAW_SELECTOR)
    expect(first.semanticText).not.toContain(RAW_SELECTOR)
    expect(first.fallbackRenderings).toHaveLength(1)

    const reader = openKnowledgeReader(canonicalRoot)
    try {
      const normalized = await retrieve(
        reader,
        { intent: '', anchors: [MAIN_ANCHOR] },
        { n: 20, product: PRODUCT, asOfBuild: 1_000 },
      )
      const messy = await retrieve(
        reader,
        { intent: '', anchors: [input.anchors[1]] },
        { n: 20, product: PRODUCT, asOfBuild: 1_000 },
      )
      expect(orderedIds(messy)).toEqual(orderedIds(normalized))
    } finally {
      reader.close()
    }

    const row = projection(canonicalRoot, ids.activeNew)
    const manifest = JSON.parse(
      readFileSync(
        join(
          canonicalRoot,
          'memory',
          PRODUCT,
          'bundles',
          ids.activeNew,
          'manifest.json',
        ),
        'utf8',
      ),
    ) as { embeddingInput: string }
    expect(row.embedding_input).toBe(manifest.embeddingInput)
    expect(row.situating_line).not.toBe('')
    expect(row.contextual_rendering).toBe(`${manifest.embeddingInput}\n${row.situating_line}`)
    expect(row.fts_context).toBe(row.situating_line)
  })

  it('contains no wall-clock reads in Phase 377 decision modules', () => {
    const wallClockCall = /\b(?:Date\.now|performance\.now)\s*\(|\bnew\s+Date\s*\(/
    for (const file of phaseSourceFiles()) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(wallClockCall)
    }
  })
})

async function buildAcceptanceFixture(): Promise<AcceptanceFixture> {
  throw new Error('retrieval acceptance fixture is not implemented')
}
