import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readLatestBuildOrdinal } from '../build-ordinal-read.js'
import {
  applyValidity,
  resolveAsOfBuild,
} from '../retrieval/validity.js'
import type { ValidityCandidate } from '../retrieval/validity.js'

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

const ELEMENT_A = { t: 'el' as const, role: 'button', name: 'Continue' }
const ELEMENT_B = { t: 'el' as const, role: 'textbox', name: 'Email' }

function candidate(
  bundleId: string,
  overrides: Partial<ValidityCandidate> = {},
): ValidityCandidate {
  return {
    bundleId,
    anchors: [ELEMENT_A],
    openedAtOrdinal: 1,
    closedAtOrdinal: null,
    createdAtOrdinal: 1,
    status: 'active',
    product: 'storefront',
    ...overrides,
  }
}

describe('resolveAsOfBuild', () => {
  let runtimeRoot: string

  beforeEach(async () => {
    runtimeRoot = await mkdtemp(join(tmpdir(), 'knowledge-resolve-as-of-'))
    await writeFile(
      join(runtimeRoot, BUILD_ORDINALS_FILE),
      '{"storefront":30}\n',
      'utf8',
    )
  })

  afterEach(async () => {
    await rm(runtimeRoot, { recursive: true, force: true })
  })

  it('uses explicit, injected, disk, then index-known ordinals in strict precedence order', () => {
    const candidates = [
      candidate('older', { openedAtOrdinal: 12 }),
      candidate('newer', { openedAtOrdinal: 40 }),
    ]
    let resolverCalls = 0
    const resolveLatestOrdinal = () => {
      resolverCalls += 1
      return 20
    }

    expect(
      resolveAsOfBuild({
        product: 'storefront',
        candidates,
        asOfBuild: 10,
        resolveLatestOrdinal,
        runtimeRoot,
      }),
    ).toBe(10)
    expect(resolverCalls).toBe(0)

    expect(
      resolveAsOfBuild({
        product: 'storefront',
        candidates,
        resolveLatestOrdinal,
        runtimeRoot,
      }),
    ).toBe(20)
    expect(resolverCalls).toBe(1)

    expect(
      resolveAsOfBuild({ product: 'storefront', candidates, runtimeRoot }),
    ).toBe(30)
    expect(resolveAsOfBuild({ product: 'storefront', candidates })).toBe(40)
  })
})

describe('applyValidity', () => {
  it('uses the half-open build window before reranking', () => {
    const bounded = candidate('bounded', {
      anchors: [],
      openedAtOrdinal: 3,
      closedAtOrdinal: 7,
    })

    expect(applyValidity([bounded], 2)).toEqual([])
    expect(applyValidity([bounded], 3)).toMatchObject([
      { bundleId: 'bounded', servedAs: 'current' },
    ])
    expect(applyValidity([bounded], 6)).toMatchObject([
      { bundleId: 'bounded', servedAs: 'current' },
    ])
    expect(applyValidity([bounded], 7)).toEqual([])
    expect(applyValidity([bounded], 20)).toEqual([])
  })

  it('selects one deterministic prior hypothesis per closed anchor beside current anchors', () => {
    const candidates = [
      candidate('a-early', {
        openedAtOrdinal: 1,
        closedAtOrdinal: 7,
        createdAtOrdinal: 20,
      }),
      candidate('a-old-created', {
        openedAtOrdinal: 2,
        closedAtOrdinal: 8,
        createdAtOrdinal: 4,
      }),
      candidate('a-new-z', {
        openedAtOrdinal: 3,
        closedAtOrdinal: 8,
        createdAtOrdinal: 5,
      }),
      candidate('a-new-a', {
        openedAtOrdinal: 3,
        closedAtOrdinal: 8,
        createdAtOrdinal: 5,
      }),
      candidate('b-closed', {
        anchors: [ELEMENT_B],
        openedAtOrdinal: 1,
        closedAtOrdinal: 6,
        createdAtOrdinal: 9,
      }),
      candidate('b-current', {
        anchors: [ELEMENT_B],
        openedAtOrdinal: 9,
        closedAtOrdinal: null,
        createdAtOrdinal: 10,
      }),
    ]

    expect(applyValidity(candidates, 10)).toMatchObject([
      { bundleId: 'a-new-a', servedAs: 'prior-build-hypothesis' },
      { bundleId: 'b-current', servedAs: 'current' },
    ])
  })

  it('re-admits every range-overlapping status with typed audit state', () => {
    const candidates = [
      candidate('superseded-overlap', {
        openedAtOrdinal: 1,
        closedAtOrdinal: 5,
        status: 'superseded',
      }),
      candidate('deprecated-overlap', {
        openedAtOrdinal: 3,
        closedAtOrdinal: 7,
        status: 'deprecated',
      }),
      candidate('current-overlap', {
        anchors: [ELEMENT_B],
        openedAtOrdinal: 6,
        closedAtOrdinal: null,
        status: 'active',
      }),
      candidate('closed-at-range-start', {
        openedAtOrdinal: 1,
        closedAtOrdinal: 4,
      }),
      candidate('future', { openedAtOrdinal: 9, closedAtOrdinal: null }),
    ]

    const result = applyValidity(candidates, 8, { asOfRange: { lo: 4, hi: 8 } })

    expect(result.map(({ bundleId }) => bundleId)).toEqual([
      'superseded-overlap',
      'deprecated-overlap',
      'current-overlap',
    ])
    expect(result).toMatchObject([
      {
        bundleId: 'superseded-overlap',
        audit: { status: 'superseded', openedAtOrdinal: 1, closedAtOrdinal: 5 },
      },
      {
        bundleId: 'deprecated-overlap',
        audit: { status: 'deprecated', openedAtOrdinal: 3, closedAtOrdinal: 7 },
      },
      {
        bundleId: 'current-overlap',
        servedAs: 'current',
        audit: { status: 'active', openedAtOrdinal: 6, closedAtOrdinal: null },
      },
    ])
  })

  it('allows a born-active deterministic drift correction through without a candidate gate', () => {
    const driftCorrection = candidate('drift-correction', {
      openedAtOrdinal: 14,
      createdAtOrdinal: 14,
      status: 'active',
    })

    expect(applyValidity([driftCorrection], 14)).toMatchObject([
      { bundleId: 'drift-correction', status: 'active', servedAs: 'current' },
    ])
  })
})
