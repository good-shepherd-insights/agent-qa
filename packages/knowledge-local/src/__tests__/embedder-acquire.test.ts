import { DatabaseSync } from 'node:sqlite'

import {
  DEFAULT_EMBEDDING_PROFILE,
  STATIC_FLOOR_EMBEDDING_PROFILE,
} from '@vostride/agent-qa-schema'
import { describe, expect, it, vi } from 'vitest'

import {
  EMBEDDER_MIN_AVAILABLE_BYTES,
  acquireEmbedder,
  type EmbedderProbes,
} from '../embedder-acquire.js'
import { ensureEmbedCacheTable } from '../embed-cache.js'
import type { EmbedderPort } from '../embedder-port.js'
import { makeFakeEmbedder } from './fixtures/fake-embedder.js'

const HEALTHY_MEMORY = EMBEDDER_MIN_AVAILABLE_BYTES + 1

function moduleUnavailableError(): Error {
  return Object.assign(new Error("Cannot find package '@huggingface/transformers'"), {
    code: 'ERR_MODULE_NOT_FOUND',
  })
}

function coldArtifactError(): Error {
  return Object.assign(new Error('model artifact is not present in the local cache'), {
    code: 'ENOENT',
  })
}

function probes(overrides: Partial<EmbedderProbes> = {}): EmbedderProbes {
  return {
    discoverWorker: vi.fn().mockResolvedValue({ kind: 'no-worker' }),
    availableMemory: vi.fn().mockReturnValue(HEALTHY_MEMORY),
    createNativeEmbedder: vi.fn().mockResolvedValue(makeFakeEmbedder()),
    createFloorEmbedder: vi.fn().mockReturnValue(makeFakeEmbedder(512)),
    ...overrides,
  }
}

describe('acquireEmbedder', () => {
  it('returns the preferred native profile when every capability probe is healthy', async () => {
    const native = makeFakeEmbedder(DEFAULT_EMBEDDING_PROFILE.dim)
    const injected = probes({
      createNativeEmbedder: vi.fn().mockResolvedValue(native),
    })

    const outcome = await acquireEmbedder({
      preferredProfile: DEFAULT_EMBEDDING_PROFILE,
      allowDownload: false,
      probes: injected,
    })

    expect(outcome).toEqual({
      kind: 'ready',
      rung: 'native',
      profile: DEFAULT_EMBEDDING_PROFILE,
      embedder: native,
    })
  })

  it('falls to the static 512-dimensional profile when the native module is unavailable', async () => {
    const floor = makeFakeEmbedder(STATIC_FLOOR_EMBEDDING_PROFILE.dim)
    const injected = probes({
      createNativeEmbedder: vi.fn().mockRejectedValue(moduleUnavailableError()),
      createFloorEmbedder: vi.fn().mockReturnValue(floor),
    })

    const outcome = await acquireEmbedder({
      preferredProfile: DEFAULT_EMBEDDING_PROFILE,
      allowDownload: false,
      probes: injected,
    })

    expect(outcome).toMatchObject({
      kind: 'ready',
      rung: 'floor',
      profile: STATIC_FLOOR_EMBEDDING_PROFILE,
      embedder: floor,
    })
    if (outcome.kind !== 'ready') throw new Error('expected a ready floor outcome')
    await expect(outcome.embedder.embedDocument('floor vector')).resolves.toHaveLength(512)
  })

  it('collapses native-module and floor failures to lexical-only', async () => {
    const outcome = await acquireEmbedder({
      preferredProfile: DEFAULT_EMBEDDING_PROFILE,
      allowDownload: false,
      probes: probes({
        createNativeEmbedder: vi.fn().mockRejectedValue(moduleUnavailableError()),
        createFloorEmbedder: vi.fn().mockRejectedValue(new Error('floor asset corrupt')),
      }),
    })

    expect(outcome).toEqual({ kind: 'lexical-only' })
  })

  it('defers before runtime loading when available memory is below the provisional budget', async () => {
    const createNativeEmbedder = vi.fn().mockResolvedValue(makeFakeEmbedder())
    const createFloorEmbedder = vi.fn().mockReturnValue(makeFakeEmbedder(512))

    const outcome = await acquireEmbedder({
      preferredProfile: DEFAULT_EMBEDDING_PROFILE,
      allowDownload: false,
      probes: probes({
        availableMemory: vi.fn().mockReturnValue(EMBEDDER_MIN_AVAILABLE_BYTES - 1),
        createNativeEmbedder,
        createFloorEmbedder,
      }),
    })

    expect(outcome).toEqual({ kind: 'deferred', reason: 'ram-budget' })
    expect(createNativeEmbedder).not.toHaveBeenCalled()
    expect(createFloorEmbedder).not.toHaveBeenCalled()
  })

  it('defers a missing local artifact when downloads are disallowed', async () => {
    const createFloorEmbedder = vi.fn().mockReturnValue(makeFakeEmbedder(512))
    const outcome = await acquireEmbedder({
      preferredProfile: DEFAULT_EMBEDDING_PROFILE,
      allowDownload: false,
      probes: probes({
        createNativeEmbedder: vi.fn().mockRejectedValue(coldArtifactError()),
        createFloorEmbedder,
      }),
    })

    expect(outcome).toEqual({ kind: 'deferred', reason: 'cold-artifact' })
    expect(createFloorEmbedder).not.toHaveBeenCalled()
  })

  it('defers a non-file native construction failure instead of trying the floor', async () => {
    const createFloorEmbedder = vi.fn().mockReturnValue(makeFakeEmbedder(512))
    const outcome = await acquireEmbedder({
      preferredProfile: DEFAULT_EMBEDDING_PROFILE,
      allowDownload: false,
      probes: probes({
        createNativeEmbedder: vi.fn().mockRejectedValue(new Error('out of memory')),
        createFloorEmbedder,
      }),
    })

    expect(outcome).toEqual({ kind: 'deferred', reason: 'load-failure' })
    expect(createFloorEmbedder).not.toHaveBeenCalled()
  })

  it('memoizes capability resolution per profile and probe seam', async () => {
    const discoverWorker = vi.fn().mockResolvedValue({ kind: 'no-worker' })
    const availableMemory = vi.fn().mockReturnValue(HEALTHY_MEMORY)
    const createNativeEmbedder = vi.fn().mockResolvedValue(makeFakeEmbedder())
    const injected = probes({ discoverWorker, availableMemory, createNativeEmbedder })
    const options = {
      preferredProfile: DEFAULT_EMBEDDING_PROFILE,
      allowDownload: false,
      probes: injected,
    } as const

    const [first, second] = await Promise.all([
      acquireEmbedder(options),
      acquireEmbedder(options),
    ])

    expect(first).toBe(second)
    expect(discoverWorker).toHaveBeenCalledTimes(1)
    expect(availableMemory).toHaveBeenCalledTimes(1)
    expect(createNativeEmbedder).toHaveBeenCalledTimes(1)
  })

  it('composes a ready capability with the content-hash cache binding', async () => {
    const db = new DatabaseSync(':memory:')
    ensureEmbedCacheTable(db)
    let documentCalls = 0
    const native: EmbedderPort = {
      async embedDocument(): Promise<Float32Array> {
        documentCalls += 1
        return new Float32Array(DEFAULT_EMBEDDING_PROFILE.dim).fill(1)
      },
      async embedQuery(): Promise<Float32Array> {
        return new Float32Array(DEFAULT_EMBEDDING_PROFILE.dim).fill(1)
      },
    }

    try {
      const outcome = await acquireEmbedder({
        preferredProfile: DEFAULT_EMBEDDING_PROFILE,
        allowDownload: false,
        cache: { db, mode: 'check-and-store' },
        probes: probes({
          createNativeEmbedder: vi.fn().mockResolvedValue(native),
        }),
      })
      if (outcome.kind !== 'ready') throw new Error('expected a ready cached outcome')

      await outcome.embedder.embedDocument('identical rendering')
      await outcome.embedder.embedDocument('identical rendering')

      expect(documentCalls).toBe(1)
      expect(db.prepare('SELECT count(*) AS count FROM embed_cache').get()?.count).toBe(1)
    } finally {
      db.close()
    }
  })
})
