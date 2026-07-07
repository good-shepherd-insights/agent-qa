// Wave-0 RED scaffold (361-01, Task 3). Pins the D-18 buildOrdinal counter BEFORE any
// implementation exists — RED strictly on the unresolved import of the not-yet-existing
// `../build-ordinal.js` module (right-reason RED). Turns green in the runner-local impl plan.
//
// Contract source: 361-CONTEXT.md D-18 (project-local .agent-qa state file, per-product
// key, read → write-temp → atomic-rename increment; monotonic best-effort, corrupt/missing
// state restarts at 1, never throws; no lockfile) + eval-and-core-types.md §A8 buildOrdinal.
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { nextBuildOrdinal, BUILD_ORDINALS_FILE } from '../build-ordinal.js'

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
