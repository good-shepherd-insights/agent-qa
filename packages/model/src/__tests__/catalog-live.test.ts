import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CatalogEntry } from '../catalog/catalog.js'
import { fetchLiveModels, mergeCatalog } from '../catalog/live.js'

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response
}

describe('live model catalog helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses /models data into catalog entries with derived vision', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ id: 'qwen2.5-vl' }, { id: 'unknown-live-model' }] }),
    ) as unknown as typeof globalThis.fetch

    const entries = await fetchLiveModels({
      baseURL: 'http://localhost:11434/v1/',
      fetchImpl,
      ttlMs: 0,
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:11434/v1/models',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(entries).toEqual([
      { id: 'qwen2.5-vl', label: 'qwen2.5-vl', vision: true },
      { id: 'unknown-live-model', label: 'unknown-live-model', vision: false },
    ])
  })

  it('returns [] for non-200 and malformed responses', async () => {
    const nonOkFetch = vi.fn(async () => jsonResponse({ data: [{ id: 'qwen2.5-vl' }] }, false))
    const malformedFetch = vi.fn(async () => jsonResponse({ data: { id: 'qwen2.5-vl' } }))

    await expect(
      fetchLiveModels({
        baseURL: 'http://non-ok.example/v1',
        fetchImpl: nonOkFetch as unknown as typeof globalThis.fetch,
        ttlMs: 0,
      }),
    ).resolves.toEqual([])
    await expect(
      fetchLiveModels({
        baseURL: 'http://malformed.example/v1',
        fetchImpl: malformedFetch as unknown as typeof globalThis.fetch,
        ttlMs: 0,
      }),
    ).resolves.toEqual([])
  })

  it('returns [] when the request rejects or times out', async () => {
    const rejectingFetch = vi.fn(async () => {
      throw new Error('econnrefused')
    })
    const timeoutFetch = vi.fn(
      (_url: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )

    await expect(
      fetchLiveModels({
        baseURL: 'http://reject.example/v1',
        fetchImpl: rejectingFetch as unknown as typeof globalThis.fetch,
        ttlMs: 0,
      }),
    ).resolves.toEqual([])
    await expect(
      fetchLiveModels({
        baseURL: 'http://timeout.example/v1',
        fetchImpl: timeoutFetch as unknown as typeof globalThis.fetch,
        timeoutMs: 1,
        ttlMs: 0,
      }),
    ).resolves.toEqual([])
  })

  it('caches live entries by normalized baseURL within the TTL', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ id: 'qwen2.5-vl' }] }))

    const opts = {
      baseURL: 'HTTP://CACHE.EXAMPLE/v1/',
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
      ttlMs: 60_000,
    }

    await expect(fetchLiveModels(opts)).resolves.toHaveLength(1)
    await expect(fetchLiveModels({ ...opts, baseURL: 'http://cache.example/v1' })).resolves.toHaveLength(
      1,
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('merges live entries after static entries while static ids win collisions', () => {
    const staticEntries: CatalogEntry[] = [
      { id: 'deepseek-chat', label: 'DeepSeek Chat', vision: false, notes: 'curated' },
    ]
    const liveEntries: CatalogEntry[] = [
      { id: 'DeepSeek-Chat', label: 'DeepSeek-Chat', vision: true },
      { id: 'extra-live-model', label: 'extra-live-model', vision: false },
    ]

    expect(mergeCatalog(staticEntries, liveEntries)).toEqual([
      { id: 'deepseek-chat', label: 'DeepSeek Chat', vision: false, notes: 'curated' },
      { id: 'extra-live-model', label: 'extra-live-model', vision: false },
    ])
  })
})
