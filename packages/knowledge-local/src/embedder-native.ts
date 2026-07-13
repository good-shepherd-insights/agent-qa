import type { FeatureExtractionPipeline, PretrainedModelOptions } from '@huggingface/transformers'
import type { EmbeddingProfile } from '@vostride/agent-qa-schema'

import type { EmbedderPort } from './embedder-port.js'
import { resolveModelCacheDir } from './model-cache-dir.js'

const nativePipelines = new Map<string, Promise<FeatureExtractionPipeline>>()

export class NativeEmbeddingDimensionError extends RangeError {
  readonly actualDim: number
  readonly expectedDim: number

  constructor(actualDim: number, expectedDim: number) {
    super(`Native embedding dimension ${actualDim} does not match profile dimension ${expectedDim}`)
    this.name = 'NativeEmbeddingDimensionError'
    this.actualDim = actualDim
    this.expectedDim = expectedDim
  }
}

function pipelineKey(profile: EmbeddingProfile): string {
  return `${profile.model_id}@${profile.revision}:${profile.dtype}`
}

function acquirePipeline(
  profile: EmbeddingProfile,
  allowDownload: boolean,
): Promise<FeatureExtractionPipeline> {
  const key = pipelineKey(profile)
  const existing = nativePipelines.get(key)
  if (existing) return existing

  const pending = (async () => {
    const transformers = await import('@huggingface/transformers')
    transformers.env.cacheDir = resolveModelCacheDir()

    return transformers.pipeline('feature-extraction', profile.model_id, {
      device: 'cpu',
      dtype: profile.dtype,
      revision: profile.revision,
      session_options:
        profile.session_options as PretrainedModelOptions['session_options'],
      local_files_only: !allowDownload,
    })
  })()

  nativePipelines.set(key, pending)
  return pending
}

function toEmbedding(data: unknown, expectedDim: number): Float32Array {
  const vector =
    data instanceof Float32Array
      ? data
      : Float32Array.from(data as ArrayLike<number>)

  if (vector.length !== expectedDim) {
    throw new NativeEmbeddingDimensionError(vector.length, expectedDim)
  }

  return vector
}

export async function createNativeEmbedder(options: {
  profile: EmbeddingProfile
  allowDownload: boolean
}): Promise<EmbedderPort> {
  const { profile, allowDownload } = options
  const extractor = await acquirePipeline(profile, allowDownload)

  async function embed(text: string, prefix: string): Promise<Float32Array> {
    const output = await extractor(`${prefix}${text}`, {
      pooling: 'mean',
      normalize: true,
    })

    return toEmbedding(output.data, profile.dim)
  }

  return {
    embedDocument: (rendering) => embed(rendering, profile.doc_prefix),
    embedQuery: (rendering) => embed(rendering, profile.query_prefix),
  }
}
