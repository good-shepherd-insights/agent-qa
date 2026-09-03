import { describe, expect, it, vi } from 'vitest'

import {
  createTransformersJsEmbedder,
  detectBenchmarkRuntime,
} from '../transformers-js-backend'
import { candidateProfile, type BenchCandidate } from '../runner'

const staticCandidate: BenchCandidate = {
  id: 'static-fixture',
  model_id: 'fixture/static',
  backend: 'static',
  artifact: 'fixture',
  revision: '0123456789abcdef0123456789abcdef01234567',
  dtype: 'q8',
  dim: 2,
  pooling: 'mean',
  normalize: true,
  max_tokens: 16,
  query_prefix: '',
  doc_prefix: '',
}

describe('Transformers.js benchmark backend', () => {
  it('records the exact current Transformers.js runtime and CPU execution contract', async () => {
    const runtime = await detectBenchmarkRuntime()

    expect(runtime).toMatchObject({
      engine: '@huggingface/transformers',
      transformersJsVersion: '4.2.0',
      pipeline: 'feature-extraction',
      device: 'cpu',
      nodeVersion: process.version,
    })
    expect(runtime.logicalCpuCount).toBeGreaterThan(0)
    expect(runtime.totalMemoryBytes).toBeGreaterThan(0)
  })

  it('refuses to route a static candidate through Transformers.js', async () => {
    await expect(
      createTransformersJsEmbedder(staticCandidate, candidateProfile(staticCandidate), {
        allowDownload: false,
      }),
    ).rejects.toThrow('backend static')
  })

  it('loads pinned tokenizer and model components without a mutable registry preflight', async () => {
    const tokenizer = { _tokenizerConfig: { model_max_length: 100 } }
    const model = { fixture: 'model' }
    const extract = vi.fn(async () => ({ data: Float32Array.of(1, 0) }))
    Object.assign(extract, { tokenizer })
    const fromTokenizer = vi.fn(async () => tokenizer)
    const fromModel = vi.fn(async () => model)
    let pipelineOptions: unknown
    class FakeFeatureExtractionPipeline {
      constructor(options: unknown) {
        pipelineOptions = options
        return extract as unknown as FakeFeatureExtractionPipeline
      }
    }
    const fakeTransformers = {
      env: {
        allowRemoteModels: true,
        cacheDir: '',
        remotePathTemplate: '{model}/resolve/{revision}/',
        version: '4.2.0',
      },
      AutoTokenizer: { from_pretrained: fromTokenizer },
      AutoModel: { from_pretrained: fromModel },
      FeatureExtractionPipeline: FakeFeatureExtractionPipeline,
    }
    const candidate: BenchCandidate = {
      ...staticCandidate,
      id: 'cls-fixture',
      model_id: 'fixture/cls',
      backend: 'node',
      pooling: 'cls',
      query_prefix: 'query: ',
      doc_prefix: 'passage: ',
    }

    const embedder = await createTransformersJsEmbedder(
      candidate,
      candidateProfile(candidate),
      {
        allowDownload: false,
        loadTransformers: async () =>
          fakeTransformers as unknown as typeof import('@huggingface/transformers'),
      },
    )
    await expect(embedder.embedDocument('document')).resolves.toEqual(
      Float32Array.of(1, 0),
    )

    expect(fromTokenizer).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`fixture/cls/${candidate.revision.replaceAll('.', '\\.')}$`, 'u'),
      ),
      expect.objectContaining({
        local_files_only: true,
        revision: candidate.revision,
      }),
    )
    expect(fromModel).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`fixture/cls/${candidate.revision.replaceAll('.', '\\.')}$`, 'u'),
      ),
      expect.objectContaining({
        device: 'cpu',
        dtype: 'q8',
        local_files_only: true,
        revision: candidate.revision,
      }),
    )
    expect(pipelineOptions).toEqual({
      task: 'feature-extraction',
      model,
      tokenizer,
    })
    expect(tokenizer._tokenizerConfig.model_max_length).toBe(candidate.max_tokens)
    expect(extract).toHaveBeenCalledWith('passage: document', {
      pooling: 'cls',
      normalize: true,
    })
    expect(fakeTransformers.env.allowRemoteModels).toBe(true)
    expect(fakeTransformers.env.remotePathTemplate).toBe(
      '{model}/resolve/{revision}/',
    )
  })

  it('pins the v4.2 metadata URL during online acquisition and restores the environment', async () => {
    const candidate: BenchCandidate = {
      ...staticCandidate,
      id: 'online-fixture',
      model_id: 'fixture/online',
      backend: 'node',
    }
    const tokenizer = { _tokenizerConfig: { model_max_length: 16 } }
    const model = { dispose: vi.fn(async () => undefined) }
    const observedTemplates: string[] = []
    const environment = {
      allowRemoteModels: true,
      cacheDir: '',
      remotePathTemplate: '{model}/resolve/{revision}/',
      version: '4.2.0',
    }
    const extract = Object.assign(
      vi.fn(async () => ({ data: Float32Array.of(1, 0) })),
      { tokenizer },
    )
    class FakeFeatureExtractionPipeline {
      constructor() {
        return extract as unknown as FakeFeatureExtractionPipeline
      }
    }
    const fakeTransformers = {
      env: environment,
      AutoTokenizer: {
        from_pretrained: vi.fn(async () => {
          observedTemplates.push(environment.remotePathTemplate)
          return tokenizer
        }),
      },
      AutoModel: {
        from_pretrained: vi.fn(async () => {
          observedTemplates.push(environment.remotePathTemplate)
          return model
        }),
      },
      FeatureExtractionPipeline: FakeFeatureExtractionPipeline,
    }

    await createTransformersJsEmbedder(candidate, candidateProfile(candidate), {
      allowDownload: true,
      loadTransformers: async () =>
        fakeTransformers as unknown as typeof import('@huggingface/transformers'),
    })

    expect(observedTemplates).toEqual([
      `{model}/resolve/${candidate.revision}/`,
      `{model}/resolve/${candidate.revision}/`,
    ])
    expect(fakeTransformers.AutoTokenizer.from_pretrained).toHaveBeenCalledWith(
      candidate.model_id,
      expect.objectContaining({ revision: candidate.revision }),
    )
    expect(environment.remotePathTemplate).toBe('{model}/resolve/{revision}/')
  })
})
