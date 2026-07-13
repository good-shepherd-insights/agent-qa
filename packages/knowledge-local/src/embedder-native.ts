import type { FeatureExtractionPipeline, PretrainedModelOptions } from '@huggingface/transformers'
import type { EmbeddingProfile } from '@vostride/agent-qa-schema'

import type { EmbedderPort } from './embedder-port.js'
import { resolveModelCacheDir } from './model-cache-dir.js'

const nativePipelines = new Map<string, Promise<FeatureExtractionPipeline>>()

export class NativeEmbeddingModuleLoadError extends Error {
  constructor(cause: unknown) {
    super('Native embedding module could not be loaded', { cause })
    this.name = 'NativeEmbeddingModuleLoadError'
  }
}

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

function validateMaxTokens(maxTokens: number | undefined): number | undefined {
  if (maxTokens === undefined) return undefined
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) {
    throw new RangeError('maxTokens must be a positive safe integer')
  }
  return maxTokens
}

function pipelineKey(profile: EmbeddingProfile, maxTokens: number | undefined): string {
  return `${profile.model_id}@${profile.revision}:${profile.dtype}:max=${maxTokens ?? 'model'}`
}

function acquirePipeline(
  profile: EmbeddingProfile,
  allowDownload: boolean,
  maxTokens: number | undefined,
): Promise<FeatureExtractionPipeline> {
  const key = pipelineKey(profile, maxTokens)
  const existing = nativePipelines.get(key)
  if (existing) return existing

  const pending = (async () => {
    let transformers: typeof import('@huggingface/transformers')
    try {
      transformers = await import('@huggingface/transformers')
    } catch (error) {
      throw new NativeEmbeddingModuleLoadError(error)
    }
    transformers.env.cacheDir = resolveModelCacheDir()

    const extractor = await transformers.pipeline('feature-extraction', profile.model_id, {
      device: 'cpu',
      dtype: profile.dtype,
      revision: profile.revision,
      session_options:
        profile.session_options as PretrainedModelOptions['session_options'],
      local_files_only: !allowDownload,
    })
    if (maxTokens !== undefined) {
      const tokenizer = extractor.tokenizer
      const tokenizerConfig = tokenizer._tokenizerConfig as
        | Record<string, unknown>
        | null
        | undefined
      const modelMaximum = Number(tokenizerConfig?.model_max_length)
      // Transformers v4's feature-extraction pipeline hard-codes truncation and reads this
      // getter-backed config value; some pinned tokenizers expose a null config, so initialize it.
      tokenizer._tokenizerConfig = {
        ...(tokenizerConfig ?? {}),
        model_max_length:
          Number.isSafeInteger(modelMaximum) && modelMaximum > 0
            ? Math.min(modelMaximum, maxTokens)
            : maxTokens,
      }
    }
    return extractor
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
  /** Optional caller-owned cap; a distinct pipeline preserves the process-lifetime session law. */
  maxTokens?: number
}): Promise<EmbedderPort> {
  const { profile, allowDownload } = options
  const maxTokens = validateMaxTokens(options.maxTokens)
  const extractor = await acquirePipeline(profile, allowDownload, maxTokens)

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
