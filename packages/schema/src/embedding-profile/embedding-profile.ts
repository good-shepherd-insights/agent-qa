export interface EmbeddingProfile {
  /** Embedding model id selected by the memidex profile. */
  model_id: string
  /** Output vector dimensionality for the selected model. */
  dim: number
  /** Quantized weight format locked by the benchmarked default. */
  dtype: 'q8'
  /** Token-to-sentence pooling locked by the benchmarked default. */
  pooling: 'mean'
  /** L2 normalization stays locked so cosine ranking matches dot-product ranking. */
  normalize: true
  /**
   * Text prepended to query inputs before embedding.
   *
   * For a bge-base-en-v1.5-style alternate, this can be set to
   * "Represent this sentence for searching relevant passages: " while documents
   * remain raw. The prefix fields make that swap declarative without shipping a
   * second default profile.
   */
  query_prefix: string
  /**
   * Text prepended to document inputs before embedding.
   *
   * Symmetric models use an empty prefix. A bge-base-en-v1.5-style alternate
   * embeds documents raw, so this remains an empty string while query_prefix
   * carries the query-side instruction.
   */
  doc_prefix: string
  /** Embedding backend locked to the browser-safe WASM path for this profile. */
  backend: 'wasm'
  /** Worker count used by the embedding backend. */
  threads: number
}

// τ_dense is intentionally excluded; the Knowledge milestone owns retrieval-fusion thresholds.
export const DEFAULT_EMBEDDING_PROFILE = {
  model_id: 'Xenova/all-mpnet-base-v2',
  dim: 768,
  dtype: 'q8',
  pooling: 'mean',
  normalize: true,
  query_prefix: '',
  doc_prefix: '',
  backend: 'wasm',
  threads: 1,
} as const satisfies EmbeddingProfile
