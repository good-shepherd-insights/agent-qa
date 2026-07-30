import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_EMBEDDING_PROFILE,
  STATIC_FLOOR_EMBEDDING_PROFILE,
  type EmbeddingProfile,
} from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  EMBEDDER_MIN_AVAILABLE_BYTES,
  acquireEmbedder,
  resetEmbedderCapability,
  resolveEmbedderCapability,
  type EmbedderProbes,
} from '../embedder-acquire.js'
import { ensureEmbedCacheTable } from '../embed-cache.js'
import type { EmbedderPort } from '../embedder-port.js'
import { makeFakeEmbedder } from './fixtures/fake-embedder.js'

const HEALTHY_MEMORY = EMBEDDER_MIN_AVAILABLE_BYTES + 1

afterEach(() => resetEmbedderCapability())

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

  it('re-probes a staged artifact after reset while the no-reset control stays deferred', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'agent-qa-embedder-reset-'))
    const artifact = join(fixtureDir, 'model.onnx')
    const native = makeFakeEmbedder(DEFAULT_EMBEDDING_PROFILE.dim)
    const createNativeEmbedder = vi.fn(async () => {
      if (!existsSync(artifact)) throw coldArtifactError()
      return native
    })
    const injected = probes({ createNativeEmbedder })
    const options = {
      preferredProfile: DEFAULT_EMBEDDING_PROFILE,
      allowDownload: false,
      probes: injected,
    } as const

    try {
      const firstDrain = await resolveEmbedderCapability(options)
      expect(firstDrain).toEqual({ kind: 'deferred', reason: 'cold-artifact' })

      writeFileSync(artifact, 'staged model artifact', 'utf8')
      const stickyControl = await resolveEmbedderCapability(options)
      expect(stickyControl).toBe(firstDrain)
      expect(stickyControl).toEqual({ kind: 'deferred', reason: 'cold-artifact' })
      expect(createNativeEmbedder).toHaveBeenCalledTimes(1)

      resetEmbedderCapability(DEFAULT_EMBEDDING_PROFILE)
      const secondDrain = await resolveEmbedderCapability(options)
      expect(secondDrain).toEqual({
        kind: 'ready',
        rung: 'native',
        profile: DEFAULT_EMBEDDING_PROFILE,
        embedder: native,
      })
      expect(createNativeEmbedder).toHaveBeenCalledTimes(2)
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  })

  it('clears only the named profile or every profile when no profile is supplied', async () => {
    const secondProfile: EmbeddingProfile = {
      ...DEFAULT_EMBEDDING_PROFILE,
      model_id: `${DEFAULT_EMBEDDING_PROFILE.model_id}-reset-control`,
    }
    const createNativeEmbedder = vi.fn().mockResolvedValue(makeFakeEmbedder())
    const injected = probes({ createNativeEmbedder })
    const resolve = (preferredProfile: EmbeddingProfile) =>
      resolveEmbedderCapability({
        preferredProfile,
        allowDownload: false,
        probes: injected,
      })

    const firstDefault = await resolve(DEFAULT_EMBEDDING_PROFILE)
    const firstControl = await resolve(secondProfile)
    expect(createNativeEmbedder).toHaveBeenCalledTimes(2)

    resetEmbedderCapability(DEFAULT_EMBEDDING_PROFILE)
    const secondDefault = await resolve(DEFAULT_EMBEDDING_PROFILE)
    const stickyControl = await resolve(secondProfile)
    expect(secondDefault).not.toBe(firstDefault)
    expect(stickyControl).toBe(firstControl)
    expect(createNativeEmbedder).toHaveBeenCalledTimes(3)

    resetEmbedderCapability()
    const thirdDefault = await resolve(DEFAULT_EMBEDDING_PROFILE)
    const secondControl = await resolve(secondProfile)
    expect(thirdDefault).not.toBe(secondDefault)
    expect(secondControl).not.toBe(firstControl)
    expect(createNativeEmbedder).toHaveBeenCalledTimes(5)
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
