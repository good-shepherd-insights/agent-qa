import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  FTS_WEIGHT_CONTENT,
  FTS_WEIGHT_CONTEXT,
  FTS_WEIGHT_IDENTITY,
  TAU_LEX,
} from '../retrieval/constants.js'

interface TauLexReceipt {
  tauLex: number
  percentile05: number
  rule: string
  signConvention: string
  weights: {
    identity: number
    content: number
    context: number
  }
  ftsShape: { columns: string[] }
  pairs: Array<{ bm25Positive: number }>
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
    expect(receipt.ftsShape.columns).toEqual(['identity', 'content', 'context'])
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

  it('admits neither zero nor every combined gold and background candidate', () => {
    const backgroundNonMatches = [0, 0.05, 0.25, 1]
    const candidates = [
      ...receipt.pairs.map(({ bm25Positive }) => bm25Positive),
      ...backgroundNonMatches,
    ]
    const admitted = candidates.filter((bm25Positive) => bm25Positive >= TAU_LEX).length

    expect(admitted).toBeGreaterThan(0)
    expect(admitted).toBeLessThan(candidates.length)
  })
})
