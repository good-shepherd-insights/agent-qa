import { cpus, release, totalmem } from 'node:os'
import { resolve, sep } from 'node:path'

import type {
  FeatureExtractionPipeline,
  PretrainedModelOptions,
} from '@huggingface/transformers'
import { resolveModelCacheDir } from '@vostride/agent-qa-knowledge-local'

import type {
  BenchCandidate,
  BenchEmbedder,
  BenchEmbeddingProfile,
} from './runner'

export interface BenchmarkRuntime {
  engine: '@huggingface/transformers'
  transformersJsVersion: string
  pipeline: 'feature-extraction'
  device: 'cpu'
  nodeVersion: string
  osRelease: string
  cpuModel: string
  logicalCpuCount: number
  totalMemoryBytes: number
}

export interface TransformersJsBackendOptions {
  allowDownload: boolean
  /** Test seam; production callers use the bench-owned package import. */
  loadTransformers?: () => Promise<typeof import('@huggingface/transformers')>
}

export class BenchmarkEmbeddingDimensionError extends RangeError {
  readonly actual: number
  readonly expected: number

  constructor(actual: number, expected: number) {
    super(`Embedding dimension ${actual} does not match configured dimension ${expected}`)
    this.name = 'BenchmarkEmbeddingDimensionError'
    this.actual = actual
    this.expected = expected
  }
}

function validateCandidate(candidate: BenchCandidate): void {
  if (candidate.backend !== 'node') {
    throw new TypeError(
      `Transformers.js backend cannot load ${candidate.id} with backend ${candidate.backend}`,
    )
  }
  if (
    candidate.max_tokens !== null &&
    (!Number.isSafeInteger(candidate.max_tokens) || candidate.max_tokens <= 0)
  ) {
    throw new RangeError(`${candidate.id} max_tokens must be a positive safe integer`)
  }
}

function pinnedModelDirectory(
  cacheDir: string,
  profile: BenchEmbeddingProfile,
): string {
  const root = resolve(cacheDir)
  const directory = resolve(root, profile.model_id, profile.revision)
  if (directory === root || !directory.startsWith(`${root}${sep}`)) {
    throw new TypeError(`${profile.model_id} cannot be resolved safely inside the model cache`)
  }
  return directory
}

function capTokenizer(extractor: FeatureExtractionPipeline, maxTokens: number): void {
  const tokenizer = extractor.tokenizer
  const tokenizerConfig = tokenizer._tokenizerConfig as
    | Record<string, unknown>
    | null
    | undefined
  const modelMaximum = Number(tokenizerConfig?.model_max_length)
  tokenizer._tokenizerConfig = {
    ...(tokenizerConfig ?? {}),
    model_max_length:
      Number.isSafeInteger(modelMaximum) && modelMaximum > 0
        ? Math.min(modelMaximum, maxTokens)
        : maxTokens,
  }
}

function toEmbedding(data: unknown, expectedDimension: number): Float32Array {
  const vector =
    data instanceof Float32Array
      ? data
      : Float32Array.from(data as ArrayLike<number>)
  if (vector.length !== expectedDimension) {
    throw new BenchmarkEmbeddingDimensionError(vector.length, expectedDimension)
  }
  return vector
}

/**
 * Create the benchmark's native embedder with the same Transformers.js execution semantics as
 * agent-qa's production memory engine: CPU feature extraction, a pinned model revision and dtype,
 * candidate-defined pooling, L2 normalization, asymmetric prefixes, and the shared model cache.
 *
 * The dependency is owned by this tool so a future Transformers.js release can be benchmarked
 * before the production package is upgraded.
 */
export async function createTransformersJsEmbedder(
  candidate: BenchCandidate,
  profile: BenchEmbeddingProfile,
  options: TransformersJsBackendOptions,
): Promise<BenchEmbedder> {
  validateCandidate(candidate)
  const transformers = await (options.loadTransformers?.() ??
    import('@huggingface/transformers'))
  const cacheDir = resolveModelCacheDir()
  transformers.env.cacheDir = cacheDir
  const sharedOptions = {
    cache_dir: cacheDir,
    local_files_only: !options.allowDownload,
    revision: profile.revision,
  }
  const modelSource = options.allowDownload
    ? profile.model_id
    : pinnedModelDirectory(cacheDir, profile)
  const originalRemotePathTemplate = transformers.env.remotePathTemplate
  const originalAllowRemoteModels = transformers.env.allowRemoteModels

  if (options.allowDownload) {
    // v4.2's tokenizer metadata probe drops its options. Pinning the process-local
    // URL template makes even that probe address this exact immutable revision.
    transformers.env.remotePathTemplate = `{model}/resolve/${encodeURIComponent(profile.revision)}/`
  } else {
    // The v4.2 metadata probe also drops local_files_only. A pinned local directory
    // plus this process-local switch guarantees that --offline performs no fetch.
    transformers.env.allowRemoteModels = false
  }

  // Transformers.js 4.2's pipeline() registry preflight does not forward revision or
  // local_files_only. Loading the exact components directly keeps offline runs offline
  // and prevents a pinned benchmark from consulting mutable `main` metadata.
  let extractor: FeatureExtractionPipeline
  try {
    const [tokenizerResult, modelResult] = await Promise.allSettled([
      transformers.AutoTokenizer.from_pretrained(modelSource, sharedOptions),
      transformers.AutoModel.from_pretrained(modelSource, {
        ...sharedOptions,
        device: 'cpu',
        dtype: profile.dtype,
        session_options:
          profile.session_options as PretrainedModelOptions['session_options'],
      }),
    ])
    if (tokenizerResult.status === 'rejected') {
      if (modelResult.status === 'fulfilled') {
        await modelResult.value.dispose().catch(() => undefined)
      }
      throw tokenizerResult.reason
    }
    if (modelResult.status === 'rejected') throw modelResult.reason
    const tokenizer = tokenizerResult.value
    const model = modelResult.value
    try {
      extractor = new transformers.FeatureExtractionPipeline({
        task: 'feature-extraction',
        model,
        tokenizer,
      })
      if (candidate.max_tokens !== null) capTokenizer(extractor, candidate.max_tokens)
    } catch (error) {
      await model.dispose().catch(() => undefined)
      throw error
    }
  } finally {
    transformers.env.remotePathTemplate = originalRemotePathTemplate
    transformers.env.allowRemoteModels = originalAllowRemoteModels
  }

  async function embed(text: string, prefix: string): Promise<Float32Array> {
    const output = await extractor(`${prefix}${text}`, {
      pooling: profile.pooling,
      normalize: profile.normalize,
    })
    return toEmbedding(output.data, profile.dim)
  }

  return {
    embedDocument: (text) => embed(text, profile.doc_prefix),
    embedQuery: (text) => embed(text, profile.query_prefix),
  }
}

export async function detectBenchmarkRuntime(): Promise<BenchmarkRuntime> {
  const { env } = await import('@huggingface/transformers')
  const cpuList = cpus()
  return {
    engine: '@huggingface/transformers',
    transformersJsVersion: env.version,
    pipeline: 'feature-extraction',
    device: 'cpu',
    nodeVersion: process.version,
    osRelease: release(),
    cpuModel: cpuList[0]?.model ?? 'unknown',
    logicalCpuCount: cpuList.length,
    totalMemoryBytes: totalmem(),
  }
}
