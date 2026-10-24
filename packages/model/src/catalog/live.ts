import type { CatalogEntry } from './catalog.js'
import { matchFamily } from '../capability/family-table.js'

interface LiveCacheEntry {
  entries: CatalogEntry[]
  expiresAt: number
}

export interface FetchLiveModelsOptions {
  baseURL: string
  headers?: Record<string, string>
  fetchImpl?: typeof globalThis.fetch
  timeoutMs?: number
  ttlMs?: number
}

const liveCache = new Map<string, LiveCacheEntry>()
const DEFAULT_TIMEOUT_MS = 2500
const DEFAULT_TTL_MS = 60_000
const MAX_LIVE_MODELS = 1000

function normalizeBaseURL(baseURL: string): string {
  return baseURL.trim().replace(/\/+$/, '')
}

function cacheKey(baseURL: string): string {
  return normalizeBaseURL(baseURL).toLowerCase()
}

function liveEntry(id: string): CatalogEntry {
  return {
    id,
    label: id,
    vision: matchFamily(id)?.vision ?? false,
  }
}

function parseLiveBody(body: unknown): CatalogEntry[] {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { data?: unknown }).data)) {
    return []
  }

  return (body as { data: unknown[] }).data
    .slice(0, MAX_LIVE_MODELS)
    .flatMap((model) => {
      if (!model || typeof model !== 'object') return []
      const id = (model as { id?: unknown }).id
      return typeof id === 'string' && id.trim() ? [liveEntry(id)] : []
    })
}

export async function fetchLiveModels(opts: FetchLiveModelsOptions): Promise<CatalogEntry[]> {
  const normalized = normalizeBaseURL(opts.baseURL)
  if (!normalized) return []

  const now = Date.now()
  const key = cacheKey(normalized)
  const cached = liveCache.get(key)
  if (cached && cached.expiresAt > now) return cached.entries

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const doFetch = opts.fetchImpl ?? globalThis.fetch
    const res = await doFetch(`${normalized}/models`, {
      signal: controller.signal,
      ...(opts.headers ? { headers: opts.headers } : {}),
    })

    if (!res.ok) return []

    const entries = parseLiveBody(await res.json())
    liveCache.set(key, {
      entries,
      expiresAt: Date.now() + (opts.ttlMs ?? DEFAULT_TTL_MS),
    })
    return entries
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
}

export function mergeCatalog(staticEntries: CatalogEntry[], live: CatalogEntry[]): CatalogEntry[] {
  const seen = new Set(staticEntries.map(entry => entry.id.toLowerCase()))
  return [...staticEntries, ...live.filter(entry => !seen.has(entry.id.toLowerCase()))]
}
