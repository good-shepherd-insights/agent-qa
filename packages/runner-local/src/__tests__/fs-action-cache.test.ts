import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CachedPlanValue } from '@vostride/agent-qa-runner'
import type { CacheKey } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CACHE_SCHEMA_VERSION, FsActionCache } from '../fs-action-cache.js'
import type { CachePolicy } from '../write-policy.js'

const KEY = '0123456789abcdef' as CacheKey

function makeValue(outcome: 'passed' | 'failed' = 'passed'): CachedPlanValue {
  return {
    plannedActions: [],
    groundedLocator: [{ role: 'button', nameNormalized: 'submit' }],
    verificationOutcome: outcome,
  }
}

function makePolicy(overrides: Partial<CachePolicy> = {}): CachePolicy {
  return {
    currentBranch: 'main',
    defaultBranch: 'main',
    protectedBranches: [],
    isCI: false,
    saveCache: false,
    disableCache: false,
    ...overrides,
  }
}

describe('FsActionCache', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'fs-action-cache-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('write -> read round-trips within a branch namespace', async () => {
    const cache = new FsActionCache({ root, policy: makePolicy({ currentBranch: 'feature-x' }) })
    const value = makeValue()

    await cache.set(KEY, value)
    const read = await cache.get(KEY)

    expect(read).toEqual(value)
  })

  it('writes exactly <cacheKey>.json under the slugged current-branch dir', async () => {
    const cache = new FsActionCache({ root, policy: makePolicy({ currentBranch: 'feature/login' }) })

    await cache.set(KEY, makeValue())

    // slug replaces the `/` — no nested dir, single safe segment.
    const files = await readdir(join(root, 'feature-login'))
    expect(files).toEqual([`${KEY}.json`])
  })

  it('falls back current-branch miss -> default-branch entry', async () => {
    // Seed the default branch only.
    const defaultCache = new FsActionCache({
      root,
      policy: makePolicy({ currentBranch: 'main', defaultBranch: 'main' }),
    })
    const value = makeValue('failed')
    await defaultCache.set(KEY, value)

    // Read from a feature branch with no entry of its own.
    const featureCache = new FsActionCache({
      root,
      policy: makePolicy({ currentBranch: 'feature-x', defaultBranch: 'main' }),
    })
    const read = await featureCache.get(KEY)

    expect(read).toEqual(value)
  })

  it('never falls default -> feature (feature entry is not visible from main)', async () => {
    const featureCache = new FsActionCache({
      root,
      policy: makePolicy({ currentBranch: 'feature-x', defaultBranch: 'main', saveCache: true }),
    })
    await featureCache.set(KEY, makeValue())

    const mainCache = new FsActionCache({
      root,
      policy: makePolicy({ currentBranch: 'main', defaultBranch: 'main' }),
    })
    expect(await mainCache.get(KEY)).toBeNull()
  })

  it('returns null for a schema-version mismatch (v1 version 9 never read, D-03)', async () => {
    const dir = join(root, 'main')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, `${KEY}.json`),
      JSON.stringify({ schemaVersion: 9, value: makeValue() }),
      'utf-8',
    )

    const cache = new FsActionCache({ root, policy: makePolicy() })
    expect(await cache.get(KEY)).toBeNull()
  })

  it('uses a schema version bumped above the retired v1 (9)', () => {
    expect(CACHE_SCHEMA_VERSION).toBeGreaterThan(9)
  })

  it('returns null for a corrupt entry rather than throwing', async () => {
    const dir = join(root, 'main')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${KEY}.json`), '{ not json', 'utf-8')

    const cache = new FsActionCache({ root, policy: makePolicy() })
    expect(await cache.get(KEY)).toBeNull()
  })

  it('short-circuits get to null when disableCache is set', async () => {
    const writer = new FsActionCache({ root, policy: makePolicy() })
    await writer.set(KEY, makeValue())

    const disabled = new FsActionCache({ root, policy: makePolicy({ disableCache: true }) })
    expect(await disabled.get(KEY)).toBeNull()
  })

  it('set is a no-op when the write policy forbids it (protected, not save, not CI)', async () => {
    const cache = new FsActionCache({
      root,
      policy: makePolicy({ currentBranch: 'main', protectedBranches: ['main'] }),
    })

    await cache.set(KEY, makeValue())
    // Nothing written -> a fresh reader (unprotected) sees a miss.
    const reader = new FsActionCache({ root, policy: makePolicy({ currentBranch: 'main' }) })
    expect(await reader.get(KEY)).toBeNull()
  })

  it('invalidate removes the current-branch entry', async () => {
    const cache = new FsActionCache({ root, policy: makePolicy({ currentBranch: 'feature-x' }) })
    await cache.set(KEY, makeValue())
    expect(await cache.get(KEY)).not.toBeNull()

    await cache.invalidate(KEY)
    expect(await cache.get(KEY)).toBeNull()
  })

  it('invalidate is a no-op (no throw) when the entry is absent', async () => {
    const cache = new FsActionCache({ root, policy: makePolicy() })
    await expect(cache.invalidate(KEY)).resolves.toBeUndefined()
  })

  it('every written filename is exactly <cacheKey>.json (no raw text on disk, D-06)', async () => {
    const cache = new FsActionCache({ root, policy: makePolicy({ currentBranch: 'main' }) })
    await cache.set(KEY, makeValue())

    const files = await readdir(join(root, 'main'))
    expect(files).toHaveLength(1)
    expect(files[0]).toBe(`${KEY}.json`)
    // The whole filename is the hex key — no step text/secret leaks into it.
    const onDisk = await readFile(join(root, 'main', files[0]), 'utf-8')
    expect(files[0].replace('.json', '')).toBe(KEY)
    expect(onDisk).toContain(`"schemaVersion": ${CACHE_SCHEMA_VERSION}`)
  })
})
