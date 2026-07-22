// Wave-0 RED scaffold (361-01, Task 3). Pins the D-18 buildOrdinal counter BEFORE any
// implementation exists — RED strictly on the unresolved import of the not-yet-existing
// `../build-ordinal.js` module (right-reason RED). Turns green in the runner-local impl plan.
//
// Contract source: 361-CONTEXT.md D-18 (project-local .agent-qa state file, per-product
// key, read → write-temp → atomic-rename increment; monotonic best-effort, corrupt/missing
// state restarts at 1, never throws; no lockfile) + eval-and-core-types.md §A8 buildOrdinal.
import { readFileSync, readdirSync } from 'node:fs'
import { mkdtemp, readFile, rm, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  BuildOrdinalReservationError,
  nextBuildOrdinal,
  reserveBuildOrdinalForProducts,
  BUILD_ORDINALS_FILE,
} from '../build-ordinal.js'

describe('nextBuildOrdinal (D-18)', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'build-ordinal-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('first call for a product returns 1 and creates the state file', async () => {
    const first = await nextBuildOrdinal({ root, product: 'web-app' })
    expect(first).toBe(1)
    const files = await readdir(root)
    expect(files).toContain(BUILD_ORDINALS_FILE)
  })

  it('successive calls increment monotonically per product key', async () => {
    expect(await nextBuildOrdinal({ root, product: 'web-app' })).toBe(1)
    expect(await nextBuildOrdinal({ root, product: 'web-app' })).toBe(2)
    expect(await nextBuildOrdinal({ root, product: 'web-app' })).toBe(3)
  })

  it('tracks independent products independently', async () => {
    expect(await nextBuildOrdinal({ root, product: 'web-app' })).toBe(1)
    expect(await nextBuildOrdinal({ root, product: 'ios-app' })).toBe(1)
    expect(await nextBuildOrdinal({ root, product: 'web-app' })).toBe(2)
    expect(await nextBuildOrdinal({ root, product: 'ios-app' })).toBe(2)
  })

  it('restarts at 1 on a corrupt/missing state file — never throws', async () => {
    await writeFile(join(root, BUILD_ORDINALS_FILE), '{ not valid json', 'utf8')
    await expect(nextBuildOrdinal({ root, product: 'web-app' })).resolves.toBe(1)
  })

  it('writes via temp-file + atomic rename — no lingering .tmp after completion', async () => {
    await nextBuildOrdinal({ root, product: 'web-app' })
    await nextBuildOrdinal({ root, product: 'web-app' })
    const files = await readdir(root)
    expect(files.some(file => file.endsWith('.tmp'))).toBe(false)
  })
})

describe('reserveBuildOrdinalForProducts', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'build-ordinal-reservation-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('canonicalizes products and atomically advances every affected axis to one ordinal', async () => {
    await writeFile(
      join(root, BUILD_ORDINALS_FILE),
      `${JSON.stringify({ untouched: 4, web: 7, ios: 11 })}\n`,
      'utf8',
    )
    const prepared: Array<{ products: readonly string[]; ordinal: number }> = []

    const ordinal = await reserveBuildOrdinalForProducts({
      root,
      products: ['web', 'ios', 'web'],
      beforePersist: reservation => prepared.push(reservation),
    })

    expect(ordinal).toBe(12)
    expect(prepared).toEqual([{ products: ['ios', 'web'], ordinal: 12 }])
    await expect(readFile(join(root, BUILD_ORDINALS_FILE), 'utf8')).resolves.toBe(
      `${JSON.stringify({ untouched: 4, web: 12, ios: 12 })}\n`,
    )
    expect((await readdir(root)).some(file => file.endsWith('.tmp'))).toBe(false)
  })

  it('returns an explicit no-op for an empty affected set without creating state', async () => {
    await expect(reserveBuildOrdinalForProducts({ root, products: [] })).resolves.toBeUndefined()
    await expect(readdir(root)).resolves.toEqual([])
  })

  it('refuses missing and exhausted counters without rewriting the original file', async () => {
    const file = join(root, BUILD_ORDINALS_FILE)
    const missingRaw = '{\n  "web": 7,\n  "untouched": 4\n}\n'
    await writeFile(file, missingRaw, 'utf8')

    await expect(
      reserveBuildOrdinalForProducts({ root, products: ['web', 'ios'] }),
    ).rejects.toMatchObject({
      code: 'missing-counter',
      product: 'ios',
    } satisfies Partial<BuildOrdinalReservationError>)
    await expect(readFile(file, 'utf8')).resolves.toBe(missingRaw)
    expect(readdirSync(root).some(entry => entry.endsWith('.tmp'))).toBe(false)

    const exhaustedRaw = `${JSON.stringify({ web: Number.MAX_SAFE_INTEGER })}\n`
    await writeFile(file, exhaustedRaw, 'utf8')
    await expect(
      reserveBuildOrdinalForProducts({ root, products: ['web'] }),
    ).rejects.toMatchObject({
      code: 'counter-exhausted',
      product: 'web',
    } satisfies Partial<BuildOrdinalReservationError>)
    await expect(readFile(file, 'utf8')).resolves.toBe(exhaustedRaw)
    expect(readdirSync(root).some(entry => entry.endsWith('.tmp'))).toBe(false)
  })

  it('runs beforePersist after temp preparation and cleans up on refusal before rename', async () => {
    const file = join(root, BUILD_ORDINALS_FILE)
    const original = '{\n  "web": 7,\n  "ios": 11\n}\n'
    await writeFile(file, original, 'utf8')
    const refusal = new Error('writer authority lost')

    await expect(
      reserveBuildOrdinalForProducts({
        root,
        products: ['web', 'ios'],
        beforePersist: reservation => {
          expect(reservation).toEqual({ products: ['ios', 'web'], ordinal: 12 })
          expect(readFileSync(file, 'utf8')).toBe(original)
          expect(JSON.parse(readFileSync(`${file}.tmp`, 'utf8'))).toEqual({ web: 12, ios: 12 })
          throw refusal
        },
      }),
    ).rejects.toBe(refusal)

    expect(readFileSync(file, 'utf8')).toBe(original)
    expect(readdirSync(root)).toEqual([BUILD_ORDINALS_FILE])
  })
})
