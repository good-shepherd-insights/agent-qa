import { expectTypeOf } from 'vitest'
import { DEFAULT_EMBEDDING_PROFILE } from '../index'
import type { EmbeddingProfile } from '../index'
import type { ModelProfile } from '../model-profile/index'

const base: EmbeddingProfile = {
  model_id: 'Xenova/all-mpnet-base-v2',
  dim: 768,
  dtype: 'q8',
  pooling: 'mean',
  normalize: true,
  query_prefix: '',
  doc_prefix: '',
  backend: 'wasm',
  threads: 1,
}

const defaultProfile: EmbeddingProfile = DEFAULT_EMBEDDING_PROFILE

expectTypeOf<keyof EmbeddingProfile>().toEqualTypeOf<
  | 'model_id'
  | 'dim'
  | 'dtype'
  | 'pooling'
  | 'normalize'
  | 'query_prefix'
  | 'doc_prefix'
  | 'backend'
  | 'threads'
>()

// @ts-expect-error dtype is locked to the benchmarked q8 profile.
const badDtype: EmbeddingProfile = { ...base, dtype: 'fp32' }
// @ts-expect-error pooling is locked to mean pooling.
const badPooling: EmbeddingProfile = { ...base, pooling: 'cls' }
// @ts-expect-error backend is locked to the browser-safe wasm backend.
const badBackend: EmbeddingProfile = { ...base, backend: 'webgpu' }
// @ts-expect-error normalize is locked so cosine ranking matches dot-product ranking.
const badNormalize: EmbeddingProfile = { ...base, normalize: false }

expectTypeOf<EmbeddingProfile>().not.toHaveProperty('provider')
expectTypeOf<EmbeddingProfile>().not.toHaveProperty('auth')
expectTypeOf<EmbeddingProfile>().not.toHaveProperty('capabilities')
expectTypeOf<ModelProfile>().not.toHaveProperty('model_id')
expectTypeOf<ModelProfile>().not.toHaveProperty('dim')

// @ts-expect-error EmbeddingProfile is structurally separate from chat ModelProfile.
const crossed: ModelProfile = base

void base
void defaultProfile
void badDtype
void badPooling
void badBackend
void badNormalize
void crossed
