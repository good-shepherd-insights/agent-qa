import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import {
  calibrateTauLex,
  deriveTauLex,
  type TauLexCorpus,
} from '../tau-lex'

interface ProductionMatchModule {
  LEXICAL_MATCH_SEMANTICS: string
  buildLexicalMatchExpression(text: string): string
}

interface SchemaV2ReceiptView {
  schemaVersion: number
  ftsShape: {
    querySemantics: string
    productionQuerySource: string
  }
  servingReplay: {
    evaluatedCandidates: number
    matchedCandidates: number
    admittedCandidates: number
    goldPairs: number
    matchedGoldPairs: number
    admittedGoldPairs: number
    goldRecall: number
  }
}

const FTS_TOKENIZER = "unicode61 tokenchars '#-_./:[]=>@'"

async function productionMatchModule(): Promise<ProductionMatchModule> {
  return await import(
    new URL(
      '../../../../packages/knowledge-local/src/retrieval/fts-match.ts',
      import.meta.url,
    ).href
  ) as ProductionMatchModule
}

function scoreWithProductionMatch(
  fixture: TauLexCorpus,
  queryId: string,
  goldId: string,
  buildMatch: (text: string) => string,
): number {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`
      CREATE VIRTUAL TABLE fts_records USING fts5(
        identity,
        content,
        context,
        tokenize = "${FTS_TOKENIZER}"
      )
    `)
    const insert = db.prepare(`
      INSERT INTO fts_records (rowid, identity, content, context)
      VALUES (?, ?, ?, ?)
    `)
    fixture.documents.forEach((document, index) => {
      const identity = document.text
        .split(/\r?\n/u)
        .filter((line) => line.startsWith('anchor: '))
        .join('\n')
      insert.run(index + 1, identity, document.text, '')
    })
    const query = fixture.recordedQueries.find(({ id }) => id === queryId)
    const rowid = fixture.documents.findIndex(({ id }) => id === goldId) + 1
    if (query === undefined || rowid === 0) throw new Error('invalid fixture identity')
    if (!fixture.documents[rowid - 1]!.apps.includes(query.app)) {
      throw new Error(`fixture gold document ${goldId} is not in app ${query.app}`)
    }
    // Score the full MATCH set before selecting the gold row. A rowid-constrained
    // FTS scan can return a different candidate on SQLite 3.51.3.
    const rows = db.prepare(`
      SELECT rowid AS record_rowid, -bm25(fts_records, 10, 5, 1) AS bm25_positive
      FROM fts_records
      WHERE fts_records MATCH ?
    `).all(buildMatch(query.query))
    const row = rows.find((candidate) => Number(candidate.record_rowid) === rowid)
    if (row === undefined) throw new Error('production MATCH did not recall the fixture gold')
    return Number(Number(row.bm25_positive).toFixed(12))
  } finally {
    db.close()
  }
}

const corpus: TauLexCorpus = {
  documents: [
    {
      id: 'doc-checkout',
      kind: 'element',
      text: [
        'button "Checkout now"',
        '',
        'role: button',
        'name: Checkout now',
        'anchor: el:button:checkout now:0',
      ].join('\n'),
      apps: ['shop'],
      sourcePaths: ['fixture.json'],
    },
    {
      id: 'doc-search',
      kind: 'element',
      text: [
        'textbox "Search places"',
        '',
        'role: textbox',
        'name: Search places',
        'anchor: el:textbox:search places:0',
      ].join('\n'),
      apps: ['maps'],
      sourcePaths: ['fixture.json'],
    },
    {
      id: 'doc-background',
      kind: 'page',
      text: [
        'page "Complete account search settings"',
        '',
        'This long background page mentions complete and search among unrelated settings.',
        'anchor: page:/settings',
      ].join('\n'),
      apps: ['shop', 'maps'],
      sourcePaths: ['fixture.json'],
    },
    {
      id: 'doc-syntax-gold',
      kind: 'element',
      text: [
        'button "Literal OR token"',
        '',
        'The operator-shaped OR token is inert document content.',
        'anchor: fixture:syntax-gold',
      ].join('\n'),
      apps: ['syntax'],
      sourcePaths: ['fixture.json'],
    },
    {
      id: 'doc-syntax-background',
      kind: 'page',
      text: [
        'page "Literal background"',
        '',
        'A long unrelated background document with only the literal overlap token.',
        'anchor: fixture:syntax-background',
      ].join('\n'),
      apps: ['syntax'],
      sourcePaths: ['fixture.json'],
    },
  ],
  recordedQueries: [
    {
      id: 'query-checkout',
      app: 'shop',
      query: 'Complete checkout now',
      goldDocIds: ['doc-checkout'],
      sourceCassetteId: 'cassette-shop',
      sourcePath: 'fixture.json',
    },
    {
      id: 'query-search',
      app: 'maps',
      query: 'Search for a place',
      goldDocIds: ['doc-search'],
      sourceCassetteId: 'cassette-maps',
      sourcePath: 'fixture.json',
    },
    {
      id: 'query-syntax',
      app: 'syntax',
      query: 'literal literal a"b OR AND NOT NEAR',
      goldDocIds: ['doc-syntax-gold'],
      sourceCassetteId: 'cassette-syntax',
      sourcePath: 'fixture.json',
    },
  ],
}

describe('tau lexical calibration', () => {
  it('uses linear-interpolated p05 followed by a floor to two decimals', () => {
    expect(deriveTauLex([0.109, 0.211, 0.5])).toEqual({
      percentile05: 0.1192,
      tauLex: 0.11,
    })
  })

  it('writes deterministic JSON and markdown receipts from weighted positive BM25 scores', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tau-lex-'))
    try {
      const jsonPath = join(directory, 'tau-lex-receipt.json')
      const markdownPath = join(directory, 'TAU-LEX-RECEIPT.md')
      const options = {
        corpus,
        corpusPath: 'fixture/corpus.json',
        jsonPath,
        markdownPath,
        calibrationDate: '2026-07-15',
      } as const

      const first = await calibrateTauLex(options)
      const firstJson = await readFile(jsonPath, 'utf8')
      const firstMarkdown = await readFile(markdownPath, 'utf8')
      const second = await calibrateTauLex(options)
      const production = await productionMatchModule()
      const receiptV2 = first.receipt as unknown as SchemaV2ReceiptView

      expect(await readFile(jsonPath, 'utf8')).toBe(firstJson)
      expect(await readFile(markdownPath, 'utf8')).toBe(firstMarkdown)
      expect(second.receipt).toEqual(first.receipt)
      expect(receiptV2.schemaVersion).toBe(2)
      expect(receiptV2.ftsShape.querySemantics).toBe('quoted-token-or-v1')
      expect(receiptV2.ftsShape.querySemantics).toBe(production.LEXICAL_MATCH_SEMANTICS)
      expect(receiptV2.ftsShape.productionQuerySource).toBe(
        'packages/knowledge-local/src/retrieval/fts-match.ts',
      )
      expect(first.receipt.rule).toBe('p05-linear-floor2')
      expect(first.receipt.signConvention).toContain('negated')
      expect(first.receipt.weights).toEqual({ identity: 10, content: 5, context: 1 })
      expect(first.receipt.pairs.map(({ queryId, goldId }) => [queryId, goldId])).toEqual([
        ['query-checkout', 'doc-checkout'],
        ['query-search', 'doc-search'],
        ['query-syntax', 'doc-syntax-gold'],
      ])
      expect(first.receipt.pairs.every(({ bm25Positive }) => bm25Positive > 0)).toBe(true)
      expect(production.buildLexicalMatchExpression('literal literal a"b OR AND NOT NEAR'))
        .toBe('"literal" OR "a""b" OR "OR" OR "AND" OR "NOT" OR "NEAR"')
      for (const pair of first.receipt.pairs) {
        expect(pair.bm25Positive).toBe(
          scoreWithProductionMatch(
            corpus,
            pair.queryId,
            pair.goldId,
            production.buildLexicalMatchExpression,
          ),
        )
      }
      expect(receiptV2.servingReplay.matchedGoldPairs).toBeGreaterThan(0)
      expect(receiptV2.servingReplay.goldRecall).toBeGreaterThan(0)
      expect(receiptV2.servingReplay.admittedCandidates).toBeGreaterThan(0)
      expect(receiptV2.servingReplay.admittedCandidates).toBeLessThan(
        receiptV2.servingReplay.matchedCandidates,
      )
      expect(receiptV2.servingReplay.matchedCandidates).toBeLessThanOrEqual(
        receiptV2.servingReplay.evaluatedCandidates,
      )
      expect(receiptV2.servingReplay.admittedGoldPairs).toBeLessThanOrEqual(
        receiptV2.servingReplay.matchedGoldPairs,
      )
      expect(receiptV2.servingReplay.goldPairs).toBe(3)
      expect(firstMarkdown).toContain('p05 linear interpolation')
      expect(firstMarkdown).toContain('2026-07-15')
      expect(firstMarkdown).toContain('quoted-token-or-v1')
      expect(firstMarkdown).toContain('Serving Replay')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('scores overlapping background golds independently without changing the indexed corpus', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tau-lex-background-'))
    try {
      const backgroundGolds: TauLexCorpus = {
        ...corpus,
        recordedQueries: corpus.recordedQueries.map((query) => ({
          ...query,
          goldDocIds: [
            ...query.goldDocIds,
            query.app === 'syntax' ? 'doc-syntax-background' : 'doc-background',
          ],
        })),
      }
      const production = await productionMatchModule()
      const { receipt } = await calibrateTauLex({
        corpus: backgroundGolds,
        corpusPath: 'fixture/corpus.json',
        jsonPath: join(directory, 'tau-lex-receipt.json'),
        markdownPath: join(directory, 'TAU-LEX-RECEIPT.md'),
      })

      expect(receipt.pairs).toEqual(
        backgroundGolds.recordedQueries.flatMap((query) =>
          [...query.goldDocIds].sort().map((goldId) => ({
            queryId: query.id,
            goldId,
            bm25Positive: scoreWithProductionMatch(
              backgroundGolds,
              query.id,
              goldId,
              production.buildLexicalMatchExpression,
            ),
          })),
        ),
      )
      expect(receipt.servingReplay.matchedCandidates).toBe(6)
      expect(receipt.servingReplay.evaluatedCandidates).toBe(6)
      expect(receipt.unmatchedPairs).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('fails closed when a recorded gold member is absent from the corpus', async () => {
    const missingGold: TauLexCorpus = {
      ...corpus,
      recordedQueries: [
        {
          ...corpus.recordedQueries[0]!,
          goldDocIds: ['doc-does-not-exist'],
        },
      ],
    }

    await expect(
      calibrateTauLex({
        corpus: missingGold,
        corpusPath: 'fixture/corpus.json',
        jsonPath: join(tmpdir(), 'unused-tau-lex.json'),
        markdownPath: join(tmpdir(), 'unused-tau-lex.md'),
        calibrationDate: '2026-07-15',
      }),
    ).rejects.toThrow('missing gold document doc-does-not-exist')
  })
})
