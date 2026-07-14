import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  calibrateTauLex,
  deriveTauLex,
  type TauLexCorpus,
} from '../tau-lex'

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
      text: 'page "Account settings"\n\nanchor: page:/settings',
      apps: ['shop', 'maps'],
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

      expect(await readFile(jsonPath, 'utf8')).toBe(firstJson)
      expect(await readFile(markdownPath, 'utf8')).toBe(firstMarkdown)
      expect(second.receipt).toEqual(first.receipt)
      expect(first.receipt.rule).toBe('p05-linear-floor2')
      expect(first.receipt.signConvention).toContain('negated')
      expect(first.receipt.weights).toEqual({ identity: 10, content: 5, context: 1 })
      expect(first.receipt.pairs.map(({ queryId, goldId }) => [queryId, goldId])).toEqual([
        ['query-checkout', 'doc-checkout'],
        ['query-search', 'doc-search'],
      ])
      expect(first.receipt.pairs.every(({ bm25Positive }) => bm25Positive > 0)).toBe(true)
      expect(firstMarkdown).toContain('p05 linear interpolation')
      expect(firstMarkdown).toContain('2026-07-15')
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
