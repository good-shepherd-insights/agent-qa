import { homedir } from 'node:os'
import { join } from 'node:path'

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
  env: { cacheDir: '' },
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
    transformers.pipeline.mockReset()
    transformers.env.cacheDir = ''
    process.env[MODEL_CACHE_DIR_ENV_VAR] = join('tmp', 'native-model-cache')
  })

  afterEach(() => {
    restoreEnv(MODEL_CACHE_DIR_ENV_VAR, originalCacheDir)
  })

  it('holds one pipeline for repeated acquisitions of the same profile', async () => {
    const extractor = vi.fn().mockResolvedValue({ data: new Float32Array([1, 0]) })
    transformers.pipeline.mockResolvedValue(extractor)
    const selectedProfile = profile({ dim: 2 })

    const [first, second] = await Promise.all([
      createNativeEmbedder({ profile: selectedProfile, allowDownload: false }),
      createNativeEmbedder({ profile: selectedProfile, allowDownload: false }),
    ])

    await first.embedDocument('first')
    await second.embedDocument('second')

    expect(transformers.pipeline).toHaveBeenCalledTimes(1)
    expect(transformers.env.cacheDir).toBe(join('tmp', 'native-model-cache'))
  })

  it('passes the pinned CPU construction options to transformers v4 verbatim', async () => {
    const extractor = vi.fn().mockResolvedValue({ data: new Float32Array([1, 0]) })
    transformers.pipeline.mockResolvedValue(extractor)
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

    expect(transformers.pipeline).toHaveBeenCalledWith(
      'feature-extraction',
      selectedProfile.model_id,
      expect.objectContaining({
        device: 'cpu',
        dtype: selectedProfile.dtype,
        revision: selectedProfile.revision,
        session_options: sessionOptions,
        local_files_only: false,
      }),
    )
    expect(transformers.pipeline.mock.calls[0]?.[2]?.session_options).toBe(sessionOptions)
  })

  it('disables downloads for local-only acquisitions', async () => {
    transformers.pipeline.mockResolvedValue(
      vi.fn().mockResolvedValue({ data: new Float32Array([1, 0]) }),
    )
    const selectedProfile = profile({ dim: 2 })

    await createNativeEmbedder({ profile: selectedProfile, allowDownload: false })

    expect(transformers.pipeline).toHaveBeenCalledWith(
      'feature-extraction',
      selectedProfile.model_id,
      expect.objectContaining({ local_files_only: true }),
    )
  })

  it('applies document and query prefixes inside the frozen port', async () => {
    const extractor = vi.fn().mockResolvedValue({ data: new Float32Array([1, 0]) })
    transformers.pipeline.mockResolvedValue(extractor)
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
    transformers.pipeline.mockResolvedValue(
      vi.fn().mockResolvedValue({ data: new Float32Array([1, 0, 0]) }),
    )
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
