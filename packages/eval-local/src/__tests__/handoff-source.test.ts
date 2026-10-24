import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  FsHandoffStore,
  HANDOFF_FILE,
  RUNS_SUBDIR,
  slugBranch,
} from '@vostride/agent-qa-runner-local'
import { HandoffVersionError } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FsHandoffSource } from '../handoff-source.js'
import { LOCAL_FIXTURE_RUN_ID, makeLocalV2Handoff } from './fixtures/local-handoff-fixture.js'

describe('FsHandoffSource (D-02)', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eval-local-handoff-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('loads the exact runner-local handoff path for the same root and run id', async () => {
    const handoff = makeLocalV2Handoff()
    new FsHandoffStore({ root, runId: LOCAL_FIXTURE_RUN_ID }).save(handoff)

    const expectedPath = join(
      root,
      RUNS_SUBDIR,
      slugBranch(LOCAL_FIXTURE_RUN_ID),
      HANDOFF_FILE,
    )
    await expect(stat(expectedPath)).resolves.toMatchObject({ isFile: expect.any(Function) })

    const loaded = new FsHandoffSource({ root, runId: LOCAL_FIXTURE_RUN_ID }).load()
    expect(loaded).toEqual(handoff)
  })

  it('propagates HandoffVersionError for a pre-instrumentation document', async () => {
    const dir = join(root, RUNS_SUBDIR, slugBranch(LOCAL_FIXTURE_RUN_ID))
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, HANDOFF_FILE),
      JSON.stringify(makeLocalV2Handoff({ schemaVersion: 1 })),
      'utf8',
    )

    const source = new FsHandoffSource({ root, runId: LOCAL_FIXTURE_RUN_ID })
    expect(() => source.load()).toThrowError(HandoffVersionError)
  })
})
