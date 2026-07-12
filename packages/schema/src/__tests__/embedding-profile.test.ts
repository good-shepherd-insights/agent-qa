import { describe, expect, it } from 'vitest'
import { DEFAULT_EMBEDDING_PROFILE } from '../index'

describe('DEFAULT_EMBEDDING_PROFILE', () => {
  it('pins the ratified v51 embedding defaults', () => {
    expect(DEFAULT_EMBEDDING_PROFILE).toEqual({
      model_id: 'Xenova/bge-small-en-v1.5',
      revision: 'main',
      dim: 384,
      dtype: 'q8',
      pooling: 'mean',
      normalize: true,
      query_prefix: 'Represent this sentence for searching relevant passages: ',
      doc_prefix: '',
      backend: 'node',
      session_options: {
        intraOpNumThreads: 2,
        extra: {
          session: { intra_op: { allow_spinning: '0' } },
          optimization: { enable_gelu_approximation: '1' },
        },
      },
      tau_dense: 0.6,
    })
  })

  it('pins the exact BGE query prefix on the query side only', () => {
    expect(DEFAULT_EMBEDDING_PROFILE.query_prefix).toBe(
      'Represent this sentence for searching relevant passages: ',
    )
    expect(DEFAULT_EMBEDDING_PROFILE.doc_prefix).toBe('')
  })

  it('pins the spec-verbatim nested session_options object', () => {
    expect(DEFAULT_EMBEDDING_PROFILE.session_options).toEqual({
      intraOpNumThreads: 2,
      extra: {
        session: { intra_op: { allow_spinning: '0' } },
        optimization: { enable_gelu_approximation: '1' },
      },
    })
  })

  it('pins the provisional tau_dense admission floor', () => {
    expect(DEFAULT_EMBEDDING_PROFILE.tau_dense).toBe(0.6)
  })
})
