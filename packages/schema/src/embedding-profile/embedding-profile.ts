import type { JsonObject } from '../run/run-artifact'

export interface EmbeddingProfile {
  /** Embedding model id selected by the memidex profile. */
  model_id: string
  /**
   * Model revision pinned for index identity.
   *
   * Phase 376's embed cache is keyed (model_id, dtype, revision,
   * sha256(rendering)) and the per-model vec0 table identity includes it.
   * Defaults to 'main'; the Phase 376 bench may pin an exact commit hash
   * with the profile lock.
   */
  revision: string
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
   * BGE-family models require the asymmetric instruction on the query side
   * only; documents are embedded raw. Symmetric alternates (e.g.
   * gte-modernbert-base) set both prefixes empty, so a model swap stays
   * purely declarative.
   */
  query_prefix: string
  /**
   * Text prepended to document inputs before embedding.
   *
   * Symmetric models use an empty prefix. BGE-family models embed documents
   * raw, so this remains an empty string while query_prefix carries the
   * query-side instruction.
   */
  doc_prefix: string
  /**
   * Execution backend.
   *
   * 'node' is the onnxruntime-node native CPU path (transformers.js v4's
   * default device in Node). 'static' is the bundled potion-retrieval-32M
   * pure-TS floor profile; only the vocabulary ships now — its runtime
   * arrives with Phase 376.
   */
  backend: 'node' | 'static'
  /**
   * ORT session tuning passed through verbatim by the embedding runtime.
   *
   * Loose JSON by design: schema is host-API-free and never imports
   * onnxruntime types; knowledge-local hands this object to ORT unchanged.
   */
  session_options: JsonObject
  /**
   * Per-leg dense admission floor for this model.
   *
   * PROVISIONAL 0.6 pending the Phase 376 bench gate (memory.md §14.2
   * open #1); BGE-family cosine mass sits in ≈[0.6, 1] per the official
   * model card, so 0.6 is the permissive admission floor. The bench updates
   * the value, never the shape — Phase 377 reads it unconditionally.
   */
  tau_dense: number
}

export const DEFAULT_EMBEDDING_PROFILE = {
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
} as const satisfies EmbeddingProfile
