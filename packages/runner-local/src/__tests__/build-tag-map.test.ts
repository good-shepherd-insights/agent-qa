// Phase 375 RED contract (D-14/D-16/D-17): durable per-product build-tag resolution
// lives beside build-ordinals.json and preserves the first ordinal seen for each tag.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  BUILD_TAGS_FILE,
  latestBuildOrdinal,
  recordBuildTag,
  resolveBuildTag,
} from '../build-tag-map.js'
import { BUILD_ORDINALS_FILE } from '../build-ordinal.js'

describe('build tag map (D-17)', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'build-tag-map-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('records and resolves the first-seen ordinal for a product tag', async () => {
    await recordBuildTag({ root, product: 'shop', tag: 'v1.2.0', ordinal: 7 })

    expect(resolveBuildTag({ root, product: 'shop', tag: 'v1.2.0' })).toBe(7)
    expect(await readFile(join(root, BUILD_TAGS_FILE), 'utf8')).toBe(
      '{"shop":{"v1.2.0":7}}\n',
    )

    await recordBuildTag({ root, product: 'shop', tag: 'v1.2.0', ordinal: 9 })
    expect(resolveBuildTag({ root, product: 'shop', tag: 'v1.2.0' })).toBe(7)
  })

  it('returns undefined for an unknown product or tag', () => {
    expect(resolveBuildTag({ root, product: 'shop', tag: 'missing' })).toBeUndefined()
    expect(resolveBuildTag({ root, product: 'missing', tag: 'v1.2.0' })).toBeUndefined()
  })

  it('reads the latest ordinal without mutating build-ordinals.json', async () => {
    const ordinalFile = join(root, BUILD_ORDINALS_FILE)
    await writeFile(ordinalFile, '{"shop":12}\n', 'utf8')
    const before = await readFile(ordinalFile)

    expect(latestBuildOrdinal({ root, product: 'shop' })).toBe(12)
    expect(latestBuildOrdinal({ root, product: 'missing' })).toBe(0)
    expect(await readFile(ordinalFile)).toEqual(before)
  })
})
