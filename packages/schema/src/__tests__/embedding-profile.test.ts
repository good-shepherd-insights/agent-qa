import { describe, expect, it } from 'vitest'
import { DEFAULT_EMBEDDING_PROFILE } from '../index'

describe('DEFAULT_EMBEDDING_PROFILE', () => {
  it('pins the locked embedding defaults', () => {
    expect(DEFAULT_EMBEDDING_PROFILE).toEqual({
      model_id: 'Xenova/all-mpnet-base-v2',
      dim: 768,
      dtype: 'q8',
      pooling: 'mean',
      normalize: true,
      query_prefix: '',
      doc_prefix: '',
      backend: 'wasm',
      threads: 1,
    })
  })
})
