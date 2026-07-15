import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  FTS_WEIGHT_CONTENT,
  FTS_WEIGHT_CONTEXT,
  FTS_WEIGHT_IDENTITY,
  TAU_LEX,
} from '../retrieval/constants.js'
import { LEXICAL_MATCH_SEMANTICS } from '../retrieval/fts-match.js'

interface TauLexReceipt {
  schemaVersion: number
  tauLex: number
  percentile05: number
  rule: string
  signConvention: string
  weights: {
    identity: number
    content: number
    context: number
  }
  ftsShape: {
    columns: string[]
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
  pairs: Array<{ bm25Positive: number }>
  unmatchedPairs: Array<{ queryId: string; goldId: string }>
}

const receipt = JSON.parse(
  readFileSync(
    new URL(
      '../../../../tools/embedding-bench/reports/tau-lex-receipt.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as TauLexReceipt

describe('TAU_LEX calibration receipt', () => {
  it('pins the exported admission floor to the deterministic recorded p05', () => {
    const scores = receipt.pairs.map(({ bm25Positive }) => bm25Positive).sort((a, b) => a - b)
    const position = (scores.length - 1) * 0.05
    const lowerIndex = Math.floor(position)
    const upperIndex = Math.ceil(position)
    const percentile05 = Number(
      (
        scores[lowerIndex]! +
        (scores[upperIndex]! - scores[lowerIndex]!) * (position - lowerIndex)
      ).toFixed(12),
    )
    const floor = Math.floor(percentile05 * 100 + 1e-12) / 100

    expect(receipt.rule).toBe('p05-linear-floor2')
    expect(receipt.percentile05).toBe(percentile05)
    expect(receipt.tauLex).toBe(floor)
    expect(TAU_LEX).toBe(receipt.tauLex)
  })

  it('guards the final three-column FTS weights and positive-scale sign convention', () => {
    expect(receipt.schemaVersion).toBe(2)
    expect(receipt.ftsShape.columns).toEqual(['identity', 'content', 'context'])
    expect(receipt.ftsShape.querySemantics).toBe('quoted-token-or-v1')
    expect(receipt.ftsShape.querySemantics).toBe(LEXICAL_MATCH_SEMANTICS)
    expect(receipt.ftsShape.productionQuerySource).toBe(
      'packages/knowledge-local/src/retrieval/fts-match.ts',
    )
    expect(receipt.weights).toEqual({
      identity: FTS_WEIGHT_IDENTITY,
      content: FTS_WEIGHT_CONTENT,
      context: FTS_WEIGHT_CONTEXT,
    })
    expect(receipt.signConvention).toContain('negated raw scores')
    expect(receipt.signConvention).toContain('bm25Positive = -bm25')
    expect(receipt.pairs.length).toBeGreaterThanOrEqual(30)
    expect(receipt.pairs.every(({ bm25Positive }) => bm25Positive > 0)).toBe(true)
  })

  it('records non-zero recall and non-degenerate admission from actual MATCH candidates', () => {
    const replay = receipt.servingReplay
    const admittedGoldPairs = receipt.pairs.filter(
      ({ bm25Positive }) => bm25Positive >= TAU_LEX,
    ).length

    expect(receipt.pairs.length).toBe(replay.matchedGoldPairs)
    expect(receipt.pairs.length + receipt.unmatchedPairs.length).toBe(replay.goldPairs)
    expect(replay.admittedGoldPairs).toBe(admittedGoldPairs)
    expect(replay.goldRecall).toBe(replay.matchedGoldPairs / replay.goldPairs)
    expect(replay.matchedGoldPairs).toBeGreaterThan(0)
    expect(replay.goldRecall).toBeGreaterThan(0)
    expect(replay.admittedCandidates).toBeGreaterThan(0)
    expect(replay.admittedCandidates).toBeLessThan(replay.matchedCandidates)
    expect(replay.matchedCandidates).toBeLessThanOrEqual(replay.evaluatedCandidates)
    expect(replay.admittedGoldPairs).toBeLessThanOrEqual(replay.matchedGoldPairs)
    expect(replay.admittedGoldPairs).toBeLessThanOrEqual(replay.admittedCandidates)
  })
})
