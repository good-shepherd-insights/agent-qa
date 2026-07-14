import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readLatestBuildOrdinal } from '../build-ordinal-read.js'

const BUILD_ORDINALS_FILE = 'build-ordinals.json'

describe('readLatestBuildOrdinal', () => {
  let runtimeRoot: string

  beforeEach(async () => {
    runtimeRoot = await mkdtemp(join(tmpdir(), 'knowledge-build-ordinal-'))
  })

  afterEach(async () => {
    await rm(runtimeRoot, { recursive: true, force: true })
  })

  it('reads the current finite ordinal for the requested product', async () => {
    await writeFile(
      join(runtimeRoot, BUILD_ORDINALS_FILE),
      `${JSON.stringify({ storefront: 12, payments: 4 })}\n`,
      'utf8',
    )

    expect(readLatestBuildOrdinal(runtimeRoot, 'storefront')).toBe(12)
  })

  it('returns undefined for absent, corrupt, non-object, or missing-product state', async () => {
    expect(readLatestBuildOrdinal(runtimeRoot, 'storefront')).toBeUndefined()

    const file = join(runtimeRoot, BUILD_ORDINALS_FILE)
    await writeFile(file, '{broken', 'utf8')
    expect(readLatestBuildOrdinal(runtimeRoot, 'storefront')).toBeUndefined()

    await writeFile(file, '[]\n', 'utf8')
    expect(readLatestBuildOrdinal(runtimeRoot, 'storefront')).toBeUndefined()

    await writeFile(file, '{"payments":4}\n', 'utf8')
    expect(readLatestBuildOrdinal(runtimeRoot, 'storefront')).toBeUndefined()

    await writeFile(file, '{"storefront":"12"}\n', 'utf8')
    expect(readLatestBuildOrdinal(runtimeRoot, 'storefront')).toBeUndefined()
  })

  it('does not create or modify any runtime-root file', async () => {
    const file = join(runtimeRoot, BUILD_ORDINALS_FILE)
    const original = '{"storefront":9}\n'
    await writeFile(file, original, 'utf8')
    const before = await stat(file)
    const beforeEntries = await readdir(runtimeRoot)

    expect(readLatestBuildOrdinal(runtimeRoot, 'storefront')).toBe(9)

    const after = await stat(file)
    expect(await readdir(runtimeRoot)).toEqual(beforeEntries)
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(after.size).toBe(before.size)
    expect(after.mtimeMs).toBe(before.mtimeMs)
  })
})
