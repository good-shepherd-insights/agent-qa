// Phase 431 plan 01 (D-03 tracer, D-08): completed-run discovery through the SHIPPED `fn` door.
//
// Every cell spawns the built `dist/cli.js` against a real project on disk whose completed runs were
// written by the runner's own handoff store under ids minted by the canonical generator. Run
// `pnpm build` at the repository root first; the freshness guard refuses a stale build by name.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { generateRunId } from '@vostride/agent-qa-ids'
import { FsHandoffStore } from '@vostride/agent-qa-runner-local'
import { CURRENT_HANDOFF_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import type { CompletedRunHandoff, PerTestOutcome, RunStatus } from '@vostride/agent-qa-schema'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  CLI_ENTRY,
  REBUILD_INSTRUCTION,
  buildFreshness,
  cleanupTempRoots,
  fixtureProject,
  spawnCollecting,
} from './conformance/spawned-chat.js'

interface ListedRow {
  runId: string
  endedAt: number
  aggregateVerdict: string
  testCount: number
  tests: { testIndex: number; testId: string; testName: string }[]
  recordedTargets: { status: string; names?: string[] }
}

interface Project {
  root: string
  configPath: string
  agentQaRoot: string
}

// An empty secrets file, as `init` writes one: without it the cold read scope has no masking
// source and every listed title is the display marker.
function project(label: string): Project {
  const { root, configPath } = fixtureProject(`431-01-${label}`)
  writeFileSync(join(root, '.env.secrets.local'), '')
  return { root, configPath, agentQaRoot: join(root, '.agent-qa') }
}

function member(testIndex: number, testId: string, testName: string): PerTestOutcome {
  return { testId, testName, filePath: `tests/${testId}.yaml`, testIndex, outcome: 'passed', steps: [] }
}

function complete(
  target: Project,
  input: { endedAt: number; verdict?: RunStatus; buildOrdinal?: number; tests?: PerTestOutcome[] },
): string {
  const runId = generateRunId()
  const handoff: CompletedRunHandoff = {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: runId as CompletedRunHandoff['runId'],
    scope: { tier: 'product', key: 'shop' },
    buildOrdinal: input.buildOrdinal ?? 1,
    executionContext: 'local-headless',
    aggregateVerdict: input.verdict ?? 'passed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: input.endedAt - 50,
    endedAt: input.endedAt,
    tests: input.tests ?? [member(0, 't-checkout', 'Checkout completes')],
  }
  new FsHandoffStore({ root: target.agentQaRoot, runId }).save(handoff)
  return runId
}

async function listRuns(target: Project, input?: unknown): Promise<{
  code: number | null
  rows: ListedRow[] | undefined
  stderr: string
}> {
  const outcome = await spawnCollecting(target.root, [
    CLI_ENTRY,
    '--config',
    target.configPath,
    'fn',
    'runs.list',
    '--json',
    ...(input === undefined ? [] : ['--input', JSON.stringify(input)]),
  ])
  return {
    code: outcome.code,
    rows: outcome.code === 0 ? (JSON.parse(outcome.stdout) as ListedRow[]) : undefined,
    stderr: outcome.stderr,
  }
}

describe('LIST-FN-TRACER: agent-qa fn runs.list reaches real completed-run storage', () => {
  beforeAll(() => {
    expect(buildFreshness(), REBUILD_INSTRUCTION).toEqual({ missing: [], stale: [] })
  })

  afterEach(() => {
    cleanupTempRoots()
  })

  it('returns the latest completed run first with its test identity, capped at 20', async () => {
    const target = project('tracer')
    const written = Array.from({ length: 21 }, (_, index) =>
      complete(target, {
        endedAt: 1_700_000_000_000 + index * 1_000,
        buildOrdinal: 100 - index,
        tests: [member(0, `t-${index}`, `Checkout ${index}`), member(1, 't-cart', 'Cart totals')],
      }))

    const listed = await listRuns(target)

    expect(listed.stderr).toBe('')
    expect(listed.code).toBe(0)
    expect(listed.rows).toHaveLength(20)
    expect(listed.rows![0]).toMatchObject({
      runId: written[20],
      endedAt: 1_700_000_020_000,
      testCount: 2,
      tests: [
        { testIndex: 0, testId: 't-20', testName: 'Checkout 20' },
        { testIndex: 1, testId: 't-cart', testName: 'Cart totals' },
      ],
      recordedTargets: { status: 'unknown' },
    })
    expect(listed.rows!.map((row) => row.runId)).toEqual([...written].reverse().slice(0, 20))
  })

  it('returns [] for a project with no completed runs', async () => {
    const listed = await listRuns(project('empty'))

    expect(listed.code).toBe(0)
    expect(listed.rows).toEqual([])
  })

  it('returns one run for limit 1 and orders tied completions by runId descending', async () => {
    const target = project('ties')
    const tied = [complete(target, { endedAt: 5_000 }), complete(target, { endedAt: 5_000 })]
    complete(target, { endedAt: 4_000 })
    const newestTie = [...tied].sort().reverse()

    const all = await listRuns(target)
    const one = await listRuns(target, { limit: 1 })

    expect(all.rows!.slice(0, 2).map((row) => row.runId)).toEqual(newestTie)
    expect(one.rows!.map((row) => row.runId)).toEqual([newestTie[0]])
  })

  it('refuses an out-of-range limit and a fractional since through the door', async () => {
    const target = project('refusals')
    complete(target, { endedAt: 5_000 })

    const tooMany = await listRuns(target, { limit: 201 })
    const fractional = await listRuns(target, { since: 1.5 })

    expect(tooMany.code).toBe(1)
    expect(tooMany.stderr).toContain('FunctionInputError')
    expect(fractional.code).toBe(1)
    expect(fractional.stderr).toContain('FunctionInputError')
  })
})

describe('DIGEST-LATEST: agent-qa digest picks the newest completion runs.list names first', () => {
  beforeAll(() => {
    expect(buildFreshness(), REBUILD_INSTRUCTION).toEqual({ missing: [], stale: [] })
  })

  afterEach(() => {
    cleanupTempRoots()
  })

  it('agrees with runs.list beyond the default cap, against build ordinals, and in a tie', async () => {
    const target = project('digest-latest')
    Array.from({ length: 23 }, (_, index) =>
      complete(target, { endedAt: 10_000 + index * 100, buildOrdinal: 1_000 - index }))
    const tied = [
      complete(target, { endedAt: 20_000, buildOrdinal: 5 }),
      complete(target, { endedAt: 20_000, buildOrdinal: 4 }),
    ]
    const newest = [...tied].sort().reverse()[0]

    const digest = await spawnCollecting(target.root, [
      CLI_ENTRY, '--config', target.configPath, 'digest', '--json',
    ])
    const listed = await listRuns(target)

    expect(digest.stderr).toBe('')
    expect(digest.code).toBe(0)
    expect((JSON.parse(digest.stdout) as { runId: string }).runId).toBe(newest)
    expect(listed.rows![0]!.runId).toBe(newest)
  })
})
