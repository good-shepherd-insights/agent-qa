import { describe, expect, it } from 'vitest'

import {
  measureAllCandidates,
  parseCandidateChildJson,
} from '../measure-bench'
import type {
  AuthoredQueries,
  BenchCandidate,
  BenchCorpus,
  CandidateBenchResult,
} from '../runner'

function candidate(id: string): BenchCandidate {
  return {
    id,
    model_id: `fixture/${id}`,
    backend: 'node',
    artifact: 'fixture',
    revision: '0123456789abcdef0123456789abcdef01234567',
    dtype: 'q8',
    dim: 2,
    pooling: 'mean',
    normalize: true,
    max_tokens: 512,
    query_prefix: '',
    doc_prefix: '',
  }
}

const corpus: BenchCorpus = {
  documents: [],
  recordedQueries: [],
}

const authored: AuthoredQueries = {
  provenance: { slice: 'fixture' },
  queries: [],
}

describe('isolated candidate measurement', () => {
  it('parses the final JSON row after native-library diagnostics', () => {
    expect(
      parseCandidateChildJson(
        'native warning\n{"candidateId":"fixture","status":"error","error":{"name":"Error","message":"failed"}}\n',
      ),
    ).toMatchObject({ candidateId: 'fixture', status: 'error' })
  })

  it('measures candidates sequentially and preserves truthful errors', async () => {
    let active = 0
    let maximumActive = 0
    const order: string[] = []
    const result = await measureAllCandidates(
      { candidates: [candidate('first'), candidate('second')], corpus, authored },
      {
        measureCandidate: async (entry): Promise<CandidateBenchResult> => {
          active += 1
          maximumActive = Math.max(maximumActive, active)
          order.push(entry.id)
          await Promise.resolve()
          active -= 1
          return {
            candidateId: entry.id,
            status: 'error',
            error: { name: 'Error', message: `${entry.id} failed` },
          }
        },
      },
    )

    expect(maximumActive).toBe(1)
    expect(order).toEqual(['first', 'second'])
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[1]).toMatchObject({
      candidateId: 'second',
      status: 'error',
      error: { message: 'second failed' },
    })
  })
})
