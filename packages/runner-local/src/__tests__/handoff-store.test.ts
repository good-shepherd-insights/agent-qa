// Wave-0 RED scaffold (361-01, Task 3). Pins the D-17/D-19 fs handoff store BEFORE any
// implementation exists — RED strictly on the unresolved import of the not-yet-existing
// `../handoff-store.js` module (right-reason RED). Turns green in the runner-local impl plan.
//
// Contract source: 361-CONTEXT.md D-17 (handoff.json in the run's .agent-qa dir beside
// events.jsonl, one JSON document) + D-19 (the read side loadCompletedRunHandoff:
// parse → version-check → reject newer with a typed error) + eval-and-core-types.md §A8.
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FsHandoffStore, loadCompletedRunHandoff } from '../handoff-store.js'
import { slugBranch } from '../branch-resolver.js'
import { RUNS_SUBDIR } from '../event-log.js'
import type { CompletedRunHandoff } from '@vostride/agent-qa-schema'

function makeHandoff(schemaVersion = 1): CompletedRunHandoff {
  return {
    schemaVersion,
    runId: 'run-1' as CompletedRunHandoff['runId'],
    scope: { tier: 'suite', key: 'checkout' },
    buildOrdinal: 1,
    executionContext: 'ci',
    aggregateVerdict: 'passed',
    configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_010_000,
    tests: [],
  }
}

describe('FsHandoffStore + loadCompletedRunHandoff (D-17/D-19)', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'fs-handoff-store-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('save writes handoff.json beside events.jsonl and round-trips a v1 document', async () => {
    const store = new FsHandoffStore({ root, runId: 'run-1' })
    const handoff = makeHandoff()
    await store.save(handoff)

    const file = join(root, RUNS_SUBDIR, slugBranch('run-1'), 'handoff.json')
    const loaded = await loadCompletedRunHandoff(file)
    expect(loaded).toEqual(handoff)
  })

  it('loadCompletedRunHandoff rejects a schemaVersion 2 document with the typed schema guard error', async () => {
    const dir = join(root, RUNS_SUBDIR, slugBranch('run-1'))
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'handoff.json')
    await writeFile(file, JSON.stringify(makeHandoff(2)), 'utf8')

    let thrown: unknown
    try {
      await loadCompletedRunHandoff(file)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeDefined()
    expect((thrown as { name: string }).name).toBe('HandoffVersionError')
    expect((thrown as { foundVersion: number }).foundVersion).toBe(2)
  })
})
