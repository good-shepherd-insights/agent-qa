import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_EMBEDDING_PROFILE,
  type EmbeddingProfile,
} from '@vostride/agent-qa-schema'

import {
  MODEL_CACHE_DIR_ENV_VAR,
  resolveModelCacheDir,
} from '../model-cache-dir.js'
import {
  NativeEmbeddingDimensionError,
  createNativeEmbedder,
} from '../embedder-native.js'

const transformers = vi.hoisted(() => ({
  env: {
    allowRemoteModels: true,
    cacheDir: '',
    remotePathTemplate: '{model}/resolve/{revision}/',
  },
  AutoTokenizer: { from_pretrained: vi.fn() },
  AutoModel: { from_pretrained: vi.fn() },
  FeatureExtractionPipeline: vi.fn(),
  pipeline: vi.fn(),
}))

vi.mock('@huggingface/transformers', () => transformers)

const originalCacheDir = process.env[MODEL_CACHE_DIR_ENV_VAR]
const originalXdgCacheHome = process.env.XDG_CACHE_HOME
let profileSequence = 0

function profile(overrides: Partial<EmbeddingProfile> = {}): EmbeddingProfile {
  profileSequence += 1
  return {
    ...DEFAULT_EMBEDDING_PROFILE,
    model_id: `test/native-embedder-${profileSequence}`,
    ...overrides,
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function installPipeline(options: {
  data?: Float32Array
  tokenizerConfig?: Record<string, unknown> | null
} = {}) {
  const tokenizer = {
    _tokenizerConfig:
      options.tokenizerConfig === undefined
        ? { model_max_length: 8_192 }
        : options.tokenizerConfig,
  }
  const model = { dispose: vi.fn(async () => undefined) }
  const extractor = Object.assign(
    vi.fn().mockResolvedValue({ data: options.data ?? new Float32Array([1, 0]) }),
    { tokenizer },
  )
  const construction: { options?: unknown } = {}
  transformers.AutoTokenizer.from_pretrained.mockResolvedValue(tokenizer)
  transformers.AutoModel.from_pretrained.mockResolvedValue(model)
  transformers.FeatureExtractionPipeline.mockImplementation(
    function FakeFeatureExtractionPipeline(pipelineOptions: unknown) {
      construction.options = pipelineOptions
      return extractor
    },
  )
  return { construction, extractor, model, tokenizer }
}

describe('resolveModelCacheDir', () => {
  afterEach(() => {
    restoreEnv(MODEL_CACHE_DIR_ENV_VAR, originalCacheDir)
    restoreEnv('XDG_CACHE_HOME', originalXdgCacheHome)
  })

  it('prefers the agent-qa override over XDG_CACHE_HOME', () => {
    process.env[MODEL_CACHE_DIR_ENV_VAR] = join('tmp', 'agent-qa-models')
    process.env.XDG_CACHE_HOME = join('tmp', 'xdg-cache')

    expect(resolveModelCacheDir()).toBe(join('tmp', 'agent-qa-models'))
  })

  it('uses XDG_CACHE_HOME before the homedir fallback', () => {
    delete process.env[MODEL_CACHE_DIR_ENV_VAR]
    process.env.XDG_CACHE_HOME = join('tmp', 'xdg-cache')

    expect(resolveModelCacheDir()).toBe(join('tmp', 'xdg-cache', 'agent-qa', 'models'))

    delete process.env.XDG_CACHE_HOME
    expect(resolveModelCacheDir()).toBe(join(homedir(), '.cache', 'agent-qa', 'models'))
  })
})

describe('createNativeEmbedder', () => {
  beforeEach(() => {
    transformers.AutoTokenizer.from_pretrained.mockReset()
    transformers.AutoModel.from_pretrained.mockReset()
    transformers.FeatureExtractionPipeline.mockReset()
    transformers.pipeline.mockReset()
    transformers.env.allowRemoteModels = true
    transformers.env.cacheDir = ''
    transformers.env.remotePathTemplate = '{model}/resolve/{revision}/'
    process.env[MODEL_CACHE_DIR_ENV_VAR] = join('tmp', 'native-model-cache')
  })

  afterEach(() => {
    restoreEnv(MODEL_CACHE_DIR_ENV_VAR, originalCacheDir)
  })

  it('holds one pipeline for repeated acquisitions of the same profile', async () => {
    const { extractor } = installPipeline()
    const selectedProfile = profile({ dim: 2 })

    const [first, second] = await Promise.all([
      createNativeEmbedder({ profile: selectedProfile, allowDownload: false }),
      createNativeEmbedder({ profile: selectedProfile, allowDownload: false }),
    ])

    await first.embedDocument('first')
    await second.embedDocument('second')

    expect(transformers.AutoTokenizer.from_pretrained).toHaveBeenCalledTimes(1)
    expect(transformers.AutoModel.from_pretrained).toHaveBeenCalledTimes(1)
    expect(transformers.FeatureExtractionPipeline).toHaveBeenCalledTimes(1)
    expect(transformers.pipeline).not.toHaveBeenCalled()
    expect(extractor).toHaveBeenCalledTimes(2)
    expect(transformers.env.cacheDir).toBe(join('tmp', 'native-model-cache'))
  })

  it('pins the online metadata URL and passes CPU construction options verbatim', async () => {
    const { construction, model, tokenizer } = installPipeline()
    const observedTemplates: string[] = []
    transformers.AutoTokenizer.from_pretrained.mockImplementation(async () => {
      observedTemplates.push(transformers.env.remotePathTemplate)
      return tokenizer
    })
    transformers.AutoModel.from_pretrained.mockImplementation(async () => {
      observedTemplates.push(transformers.env.remotePathTemplate)
      return model
    })
    const sessionOptions = {
      intraOpNumThreads: 3,
      extra: { session: { intra_op: { allow_spinning: '0' } } },
    }
    const selectedProfile = profile({
      dim: 2,
      revision: '0123456789abcdef',
      session_options: sessionOptions,
    })

    await createNativeEmbedder({ profile: selectedProfile, allowDownload: true })

    expect(observedTemplates).toEqual([
      `{model}/resolve/${selectedProfile.revision}/`,
      `{model}/resolve/${selectedProfile.revision}/`,
    ])
    expect(transformers.AutoTokenizer.from_pretrained).toHaveBeenCalledWith(
      selectedProfile.model_id,
      expect.objectContaining({
        revision: selectedProfile.revision,
        local_files_only: false,
      }),
    )
    expect(transformers.AutoModel.from_pretrained).toHaveBeenCalledWith(
      selectedProfile.model_id,
      expect.objectContaining({
        device: 'cpu',
        dtype: selectedProfile.dtype,
        revision: selectedProfile.revision,
        session_options: sessionOptions,
        local_files_only: false,
      }),
    )
    expect(transformers.AutoModel.from_pretrained.mock.calls[0]?.[1]?.session_options).toBe(
      sessionOptions,
    )
    expect(construction.options).toEqual({
      task: 'feature-extraction',
      model,
      tokenizer,
    })
    expect(transformers.pipeline).not.toHaveBeenCalled()
    expect(transformers.env.allowRemoteModels).toBe(true)
    expect(transformers.env.remotePathTemplate).toBe('{model}/resolve/{revision}/')
  })

  it('serializes first acquisitions so different revisions cannot race global URL state', async () => {
    const { model, tokenizer } = installPipeline()
    const firstProfile = profile({
      dim: 2,
      revision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })
    const secondProfile = profile({
      dim: 2,
      revision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    })
    const observations: Array<{ source: string; template: string }> = []
    let releaseFirstModel!: () => void
    const firstModelGate = new Promise<void>((resolvePending) => {
      releaseFirstModel = resolvePending
    })
    let modelCallCount = 0
    transformers.AutoTokenizer.from_pretrained.mockImplementation(async (source: string) => {
      observations.push({ source, template: transformers.env.remotePathTemplate })
      return tokenizer
    })
    transformers.AutoModel.from_pretrained.mockImplementation(async (source: string) => {
      observations.push({ source, template: transformers.env.remotePathTemplate })
      modelCallCount += 1
      if (modelCallCount === 1) await firstModelGate
      return model
    })

    const first = createNativeEmbedder({
      profile: firstProfile,
      allowDownload: true,
    })
    await vi.waitFor(() =>
      expect(transformers.AutoModel.from_pretrained).toHaveBeenCalledTimes(1),
    )
    const second = createNativeEmbedder({
      profile: secondProfile,
      allowDownload: true,
    })
    await new Promise<void>((resolvePending) => setImmediate(resolvePending))

    expect(transformers.AutoTokenizer.from_pretrained).toHaveBeenCalledTimes(1)
    expect(transformers.AutoModel.from_pretrained).toHaveBeenCalledTimes(1)
    expect(transformers.env.remotePathTemplate).toBe(
      `{model}/resolve/${firstProfile.revision}/`,
    )

    releaseFirstModel()
    await Promise.all([first, second])

    expect(observations).toEqual([
      {
        source: firstProfile.model_id,
        template: `{model}/resolve/${firstProfile.revision}/`,
      },
      {
        source: firstProfile.model_id,
        template: `{model}/resolve/${firstProfile.revision}/`,
      },
      {
        source: secondProfile.model_id,
        template: `{model}/resolve/${secondProfile.revision}/`,
      },
      {
        source: secondProfile.model_id,
        template: `{model}/resolve/${secondProfile.revision}/`,
      },
    ])
    expect(transformers.env.remotePathTemplate).toBe('{model}/resolve/{revision}/')
  })

  it('loads the exact local revision directory with remote access disabled', async () => {
    const { model, tokenizer } = installPipeline()
    const observedRemoteFlags: boolean[] = []
    transformers.AutoTokenizer.from_pretrained.mockImplementation(async () => {
      observedRemoteFlags.push(transformers.env.allowRemoteModels)
      return tokenizer
    })
    transformers.AutoModel.from_pretrained.mockImplementation(async () => {
      observedRemoteFlags.push(transformers.env.allowRemoteModels)
      return model
    })
    const selectedProfile = profile({ dim: 2 })
    const cacheDir = join('tmp', 'native-model-cache')
    const expectedSource = resolve(
      cacheDir,
      selectedProfile.model_id,
      selectedProfile.revision,
    )

    await createNativeEmbedder({ profile: selectedProfile, allowDownload: false })

    expect(observedRemoteFlags).toEqual([false, false])
    expect(transformers.AutoTokenizer.from_pretrained).toHaveBeenCalledWith(
      expectedSource,
      expect.objectContaining({
        cache_dir: cacheDir,
        local_files_only: true,
        revision: selectedProfile.revision,
      }),
    )
    expect(transformers.AutoModel.from_pretrained).toHaveBeenCalledWith(
      expectedSource,
      expect.objectContaining({
        cache_dir: cacheDir,
        device: 'cpu',
        dtype: 'q8',
        local_files_only: true,
        revision: selectedProfile.revision,
      }),
    )
    expect(transformers.pipeline).not.toHaveBeenCalled()
    expect(transformers.env.allowRemoteModels).toBe(true)
    expect(transformers.env.remotePathTemplate).toBe('{model}/resolve/{revision}/')
  })

  it('restores Transformers.js globals and disposes a model after partial loading fails', async () => {
    const { model } = installPipeline()
    const failure = new Error('tokenizer failed')
    transformers.AutoTokenizer.from_pretrained.mockRejectedValue(failure)
    transformers.env.allowRemoteModels = true
    transformers.env.remotePathTemplate = 'original/{model}/'

    await expect(
      createNativeEmbedder({ profile: profile({ dim: 2 }), allowDownload: false }),
    ).rejects.toBe(failure)

    expect(model.dispose).toHaveBeenCalledTimes(1)
    expect(transformers.env.allowRemoteModels).toBe(true)
    expect(transformers.env.remotePathTemplate).toBe('original/{model}/')
  })

  it('disposes a loaded model when pipeline construction fails', async () => {
    const { model } = installPipeline()
    const failure = new Error('pipeline construction failed')
    transformers.FeatureExtractionPipeline.mockImplementation(function FailingPipeline() {
      throw failure
    })

    await expect(
      createNativeEmbedder({ profile: profile({ dim: 2 }), allowDownload: true }),
    ).rejects.toBe(failure)

    expect(model.dispose).toHaveBeenCalledTimes(1)
    expect(transformers.env.allowRemoteModels).toBe(true)
    expect(transformers.env.remotePathTemplate).toBe('{model}/resolve/{revision}/')
  })

  it('holds one pipeline when uncapped and capped callers conflict for the same profile', async () => {
    const tokenizerConfig = { model_max_length: 8_192 }
    const { extractor } = installPipeline({ tokenizerConfig })
    const selectedProfile = profile({
      dim: 2,
      doc_prefix: 'document: ',
      query_prefix: 'query: ',
    })

    const accepted = await createNativeEmbedder({
      profile: selectedProfile,
      allowDownload: false,
    })
    const failure = await createNativeEmbedder({
      profile: selectedProfile,
      allowDownload: false,
      maxTokens: 512,
    }).catch((error) => error)

    expect(failure).toBeInstanceOf(RangeError)
    expect(failure).toMatchObject({
      message: `Native embedding pipeline budget conflict for ${selectedProfile.model_id}@${selectedProfile.revision}:${selectedProfile.dtype}: existing maxTokens=uncapped, requested maxTokens=512; one process-lifetime session per model identity permits only the first budget`,
    })
    expect(transformers.FeatureExtractionPipeline).toHaveBeenCalledTimes(1)
    expect(extractor.tokenizer._tokenizerConfig).toBe(tokenizerConfig)
    expect(tokenizerConfig.model_max_length).toBe(8_192)

    await expect(accepted.embedDocument('checkout button')).resolves.toEqual(
      new Float32Array([1, 0]),
    )
    await expect(accepted.embedQuery('find checkout')).resolves.toEqual(
      new Float32Array([1, 0]),
    )
    expect(extractor).toHaveBeenNthCalledWith(1, 'document: checkout button', {
      pooling: 'mean',
      normalize: true,
    })
    expect(extractor).toHaveBeenNthCalledWith(2, 'query: find checkout', {
      pooling: 'mean',
      normalize: true,
    })
    expect(extractor.tokenizer._tokenizerConfig).toBe(tokenizerConfig)
    expect(tokenizerConfig.model_max_length).toBe(8_192)
  })

  it('shares one bounded pipeline for repeated callers with the same token budget', async () => {
    const tokenizerConfig = { model_max_length: 8_192 }
    const { extractor } = installPipeline({ tokenizerConfig })
    const selectedProfile = profile({ dim: 2 })

    const first = await createNativeEmbedder({
      profile: selectedProfile,
      allowDownload: false,
      maxTokens: 512,
    })
    const [second, third] = await Promise.all([
      createNativeEmbedder({
        profile: selectedProfile,
        allowDownload: false,
        maxTokens: 512,
      }),
      createNativeEmbedder({
        profile: selectedProfile,
        allowDownload: false,
        maxTokens: 512,
      }),
    ])

    await Promise.all([
      first.embedDocument('first'),
      second.embedDocument('second'),
      third.embedQuery('third'),
    ])

    expect(transformers.FeatureExtractionPipeline).toHaveBeenCalledTimes(1)
    expect(extractor).toHaveBeenCalledTimes(3)
    expect(extractor.tokenizer._tokenizerConfig).toMatchObject({ model_max_length: 512 })
  })

  it('constructs one pipeline under concurrent conflicting acquisitions', async () => {
    const tokenizerConfig = { model_max_length: 8_192 }
    const { extractor, model } = installPipeline({ tokenizerConfig })
    let resolveModel!: (value: typeof model) => void
    const pendingModel = new Promise<typeof model>((resolvePending) => {
      resolveModel = resolvePending
    })
    transformers.AutoModel.from_pretrained.mockReturnValue(pendingModel)
    const selectedProfile = profile({ dim: 2 })

    const acceptedPromise = createNativeEmbedder({
      profile: selectedProfile,
      allowDownload: false,
    })
    await vi.waitFor(() =>
      expect(transformers.AutoModel.from_pretrained).toHaveBeenCalledTimes(1),
    )
    const conflictPromise = createNativeEmbedder({
      profile: selectedProfile,
      allowDownload: false,
      maxTokens: 512,
    })
    resolveModel(model)
    const [accepted, conflict] = await Promise.allSettled([
      acceptedPromise,
      conflictPromise,
    ])

    expect(accepted.status).toBe('fulfilled')
    expect(conflict.status).toBe('rejected')
    expect(conflict.status === 'rejected' ? conflict.reason : undefined).toMatchObject({
      name: 'RangeError',
      message: expect.stringContaining('existing maxTokens=uncapped, requested maxTokens=512'),
    })
    expect(transformers.AutoModel.from_pretrained).toHaveBeenCalledTimes(1)
    expect(transformers.FeatureExtractionPipeline).toHaveBeenCalledTimes(1)
    expect(extractor.tokenizer._tokenizerConfig).toBe(tokenizerConfig)
    expect(tokenizerConfig.model_max_length).toBe(8_192)
  })

  it('allows different profile identities to select independent token budgets', async () => {
    const uncappedTokenizerConfig = { model_max_length: 8_192 }
    const cappedTokenizerConfig = { model_max_length: 8_192 }
    const { extractor: uncappedExtractor } = installPipeline({
      tokenizerConfig: uncappedTokenizerConfig,
    })
    const uncappedProfile = profile({ dim: 2 })
    const cappedProfile = {
      ...uncappedProfile,
      revision: `${uncappedProfile.revision}-independent`,
    }

    const uncapped = await createNativeEmbedder({
      profile: uncappedProfile,
      allowDownload: false,
    })
    const { extractor: cappedExtractor } = installPipeline({
      data: new Float32Array([0, 1]),
      tokenizerConfig: cappedTokenizerConfig,
    })
    const capped = await createNativeEmbedder({
      profile: cappedProfile,
      allowDownload: false,
      maxTokens: 512,
    })

    await expect(uncapped.embedDocument('uncapped')).resolves.toEqual(
      new Float32Array([1, 0]),
    )
    await expect(capped.embedDocument('capped')).resolves.toEqual(new Float32Array([0, 1]))
    expect(transformers.FeatureExtractionPipeline).toHaveBeenCalledTimes(2)
    expect(uncappedExtractor).toHaveBeenCalledTimes(1)
    expect(cappedExtractor).toHaveBeenCalledTimes(1)
    expect(uncappedExtractor.tokenizer._tokenizerConfig).toBe(uncappedTokenizerConfig)
    expect(cappedExtractor.tokenizer._tokenizerConfig).toMatchObject({
      model_max_length: 512,
    })
  })

  it('initializes a missing tokenizer config when applying the token budget', async () => {
    const { extractor } = installPipeline({ tokenizerConfig: null })

    await createNativeEmbedder({
      profile: profile({ dim: 2 }),
      allowDownload: false,
      maxTokens: 512,
    })

    expect(extractor.tokenizer._tokenizerConfig).toEqual({ model_max_length: 512 })
  })

  it('applies document and query prefixes inside the frozen port', async () => {
    const { extractor } = installPipeline()
    const selectedProfile = profile({
      dim: 2,
      doc_prefix: 'document: ',
      query_prefix: 'query: ',
    })
    const embedder = await createNativeEmbedder({
      profile: selectedProfile,
      allowDownload: false,
    })

    await embedder.embedDocument('checkout button')
    await embedder.embedQuery('find checkout')

    expect(extractor).toHaveBeenNthCalledWith(1, 'document: checkout button', {
      pooling: 'mean',
      normalize: true,
    })
    expect(extractor).toHaveBeenNthCalledWith(2, 'query: find checkout', {
      pooling: 'mean',
      normalize: true,
    })
  })

  it('throws a typed error that names actual and expected dimensions', async () => {
    installPipeline({ data: new Float32Array([1, 0, 0]) })
    const selectedProfile = profile({ dim: 2 })
    const embedder = await createNativeEmbedder({
      profile: selectedProfile,
      allowDownload: false,
    })

    const failure = await embedder.embedDocument('wrong dimensions').catch((error) => error)

    expect(failure).toBeInstanceOf(NativeEmbeddingDimensionError)
    expect(failure).toMatchObject({ actualDim: 3, expectedDim: 2 })
    expect(String(failure)).toContain('3')
    expect(String(failure)).toContain('2')
  })
})
