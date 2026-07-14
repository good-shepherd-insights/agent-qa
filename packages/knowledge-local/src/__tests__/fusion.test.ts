import { describe, expect, it } from 'vitest'

import {
  admitCandidate,
  capExpansion,
  fuseWeightedRrf,
} from '../retrieval/fusion.js'
import type {
  FusedCandidate,
  FusionCandidate,
} from '../retrieval/fusion.js'

function candidate(
  bundleId: string,
  overrides: Partial<FusionCandidate> = {},
): FusionCandidate {
  return {
    bundleId,
    source: 'direct',
    legRanks: {},
    rawScores: {},
    ...overrides,
  }
}

function fused(
  bundleId: string,
  fusedScore: number,
  source: FusionCandidate['source'],
): FusedCandidate<FusionCandidate> {
  return {
    ...candidate(bundleId, { source }),
    fusedScore,
  }
}

describe('weighted reciprocal-rank fusion (D-06/D-07)', () => {
  it('sums weighted ranks and orders equal scores by bundle id', () => {
    const ranked = fuseWeightedRrf([
      {
        weight: 2,
        ranked: [
          candidate('r_a', { legRanks: { lexical: 1 } }),
          candidate('r_b', { legRanks: { lexical: 2 } }),
        ],
      },
      {
        weight: 1,
        ranked: [
          candidate('r_b', { legRanks: { dense: 1 } }),
          candidate('r_a', { legRanks: { dense: 2 } }),
        ],
      },
    ])

    expect(ranked.map(({ bundleId }) => bundleId)).toEqual(['r_a', 'r_b'])
    expect(ranked[0]?.fusedScore).toBeCloseTo(2 / 61 + 1 / 62)
    expect(ranked[1]?.fusedScore).toBeCloseTo(2 / 62 + 1 / 61)

    const tied = fuseWeightedRrf([
      { weight: 1, ranked: [candidate('r_b')] },
      { weight: 1, ranked: [candidate('r_a')] },
    ])
    expect(tied.map(({ bundleId }) => bundleId)).toEqual(['r_a', 'r_b'])
  })

  it('discounts expanded contributions without weakening direct contributions', () => {
    const ranked = fuseWeightedRrf([
      {
        weight: 2,
        ranked: [
          candidate('r_expanded', { source: 'expanded' }),
          candidate('r_direct'),
        ],
      },
    ])

    expect(ranked.map(({ bundleId }) => bundleId)).toEqual(['r_direct', 'r_expanded'])
    expect(ranked[0]?.fusedScore).toBeCloseTo(2 / 62)
    expect(ranked[1]?.fusedScore).toBeCloseTo(1 / 61)
  })

  it('retains raw per-leg scores and ranks on the fused candidate', () => {
    const ranked = fuseWeightedRrf([
      {
        weight: 1,
        ranked: [
          candidate('r_one', {
            legRanks: { lexical: 1 },
            rawScores: { bm25Positive: 0.75 },
          }),
        ],
      },
      {
        weight: 1,
        ranked: [
          candidate('r_one', {
            legRanks: { dense: 1 },
            rawScores: { cosine: 0.62, anchorExact: true },
          }),
        ],
      },
    ])

    expect(ranked[0]).toMatchObject({
      legRanks: { lexical: 1, dense: 1 },
      rawScores: { bm25Positive: 0.75, cosine: 0.62, anchorExact: true },
    })
  })
})

describe('pre-fusion admission (D-06)', () => {
  it('admits on any one floor at equality and rejects when every clause fails', () => {
    const floors = { tauDense: 0.38 }

    expect(
      admitCandidate(candidate('r_dense', { rawScores: { cosine: 0.38 } }), floors),
    ).toBe(true)
    expect(
      admitCandidate(
        candidate('r_lexical', { rawScores: { bm25Positive: 0.5 } }),
        floors,
      ),
    ).toBe(true)
    expect(
      admitCandidate(candidate('r_anchor', { rawScores: { anchorExact: true } }), floors),
    ).toBe(true)
    expect(
      admitCandidate(
        candidate('r_junk', {
          rawScores: { cosine: 0.379, bm25Positive: 0.499, anchorExact: false },
        }),
        floors,
      ),
    ).toBe(false)
  })

  it('removes inadmissible candidates before ranks are assigned for fusion', () => {
    const leg = [
      candidate('r_junk', { rawScores: { cosine: 0.1, bm25Positive: 0.1 } }),
      candidate('r_good', { rawScores: { bm25Positive: 0.5 } }),
    ].filter((entry) => admitCandidate(entry, { tauDense: 0.38 }))

    const ranked = fuseWeightedRrf([{ weight: 1, ranked: leg }])

    expect(ranked.map(({ bundleId }) => bundleId)).toEqual(['r_good'])
    expect(ranked[0]?.fusedScore).toBeCloseTo(1 / 61)
  })
})

describe('expansion slot cap (D-07)', () => {
  it('keeps at most ceil(f*N) highest-ranked expanded entries in final top N', () => {
    const ranked = [
      fused('r_d0', 1, 'direct'),
      fused('r_e1', 0.99, 'expanded'),
      fused('r_e2', 0.98, 'expanded'),
      fused('r_e3', 0.97, 'expanded'),
      fused('r_e4', 0.96, 'expanded'),
      ...Array.from({ length: 9 }, (_, index) =>
        fused(`r_d${index + 1}`, 0.95 - index / 100, 'direct'),
      ),
    ]

    const capped = capExpansion(ranked, 10)

    expect(capped).toHaveLength(10)
    expect(
      capped.filter(({ source }) => source === 'expanded').map(({ bundleId }) => bundleId),
    ).toEqual(['r_e1', 'r_e2', 'r_e3'])
    expect(capped.map(({ bundleId }) => bundleId)).not.toContain('r_e4')
    expect(capped.filter(({ source }) => source === 'direct')).toHaveLength(7)
  })
})
