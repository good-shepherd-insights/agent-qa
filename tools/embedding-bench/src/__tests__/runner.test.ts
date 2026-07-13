import { describe, expect, it } from 'vitest'

import {
  runBench,
  type AuthoredQueries,
  type BenchCandidate,
  type BenchCorpus,
  type BenchEmbedder,
  type CandidateBenchSuccess,
} from '../runner'

const candidate = (id = 'fixture'): BenchCandidate => ({
  id,
  model_id: `fixture/${id}`,
  backend: 'node',
  artifact: 'fixture',
  revision: '0123456789abcdef0123456789abcdef01234567',
  dtype: 'q8',
  dim: 2,
  pooling: 'mean',
  normalize: true,
  query_prefix: '',
  doc_prefix: '',
})

const authored: AuthoredQueries = {
  provenance: { slice: 'authored', reviewStatus: 'fixture' },
  queries: [],
}

function unitVector(cosine: number): Float32Array {
  return Float32Array.of(cosine, Math.sqrt(1 - cosine * cosine))
}

function fixtureCorpus(goldDocumentId: string): BenchCorpus {
  return {
    documents: [
      ['doc-1', 0.9],
      ['doc-2', 0.8],
      ['doc-3', 0.7],
      ['doc-4', 0.6],
      ['doc-5', 0.5],
    ].map(([id]) => ({
      id: String(id),
      kind: 'element' as const,
      text: String(id),
      apps: ['fixture-app'],
      sourcePaths: ['fixture.json'],
    })),
    recordedQueries: [
      {
        id: 'query-1',
        app: 'fixture-app',
        query: 'query',
        goldDocIds: [goldDocumentId],
        sourceCassetteId: 'fixture-cassette',
        sourcePath: 'fixture.json',
      },
    ],
  }
}

function fixtureEmbedder(): BenchEmbedder {
  const vectors = new Map<string, Float32Array>([
    ['query', Float32Array.of(1, 0)],
    ['doc-1', unitVector(0.9)],
    ['doc-2', unitVector(0.8)],
    ['doc-3', unitVector(0.7)],
    ['doc-4', unitVector(0.6)],
    ['doc-5', unitVector(0.5)],
  ])
  const get = (text: string): Float32Array => {
    const vector = vectors.get(text)
    if (vector === undefined) throw new Error(`missing fixture vector for ${text}`)
    return vector
  }
  return {
    embedDocument: async (text) => get(text),
    embedQuery: async (text) => get(text),
  }
}

function successful(result: Awaited<ReturnType<typeof runBench>>): CandidateBenchSuccess {
  const entry = result.candidates[0]
  expect(entry?.status).toBe('ok')
  if (entry?.status !== 'ok') throw new Error('expected successful fixture candidate')
  return entry
}

describe('runBench', () => {
  it('scores a nearest gold document as hit@1, hit@3, and hit@5', async () => {
    const result = await runBench({
      candidates: [candidate()],
      corpus: fixtureCorpus('doc-1'),
      authored,
      createEmbedder: async () => fixtureEmbedder(),
    })

    expect(successful(result).slices.recorded.perApp['fixture-app']).toEqual({
      queries: 1,
      hitAt1: 1,
      hitAt3: 1,
      hitAt5: 1,
    })
  })

  it('scores a fourth-ranked gold document as hit@5 only', async () => {
    const result = await runBench({
      candidates: [candidate()],
      corpus: fixtureCorpus('doc-4'),
      authored,
      createEmbedder: async () => fixtureEmbedder(),
    })

    expect(successful(result).slices.recorded.macro).toEqual({
      queries: 1,
      hitAt1: 0,
      hitAt3: 0,
      hitAt5: 1,
    })
  })

  it('records a candidate failure without aborting the remaining candidates', async () => {
    const result = await runBench({
      candidates: [candidate('missing-model'), candidate('working-model')],
      corpus: fixtureCorpus('doc-1'),
      authored,
      createEmbedder: async (entry) => {
        if (entry.id === 'missing-model') throw new Error('404 model artifact not found')
        return fixtureEmbedder()
      },
    })

    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0]).toMatchObject({
      candidateId: 'missing-model',
      status: 'error',
      error: { message: '404 model artifact not found' },
    })
    expect(result.candidates[1]).toMatchObject({
      candidateId: 'working-model',
      status: 'ok',
    })
  })
})
