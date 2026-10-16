// 2026-10-17 (443-08, D-03/D-05/D-26): `agent-qa run` records every run it starts in runs.db,
// whatever the config holds, refuses a run it cannot record, and files a failure under the id it
// prints.

import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { DashboardDatabase } from '@vostride/agent-qa-dashboard'
import { generateRunId } from '@vostride/agent-qa-ids'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  CountingTarget,
  createInProcessFixture,
} from '../../composition/__tests__/in-process-run-fixture.js'
import type { InProcessFixture } from '../../composition/__tests__/in-process-run-fixture.js'
import { refuseWithoutPosixRunLifecycle, startCliRun } from './442-run-fixture.js'
import type { CliRunExit } from './442-run-fixture.js'

const CELL_BUDGET_MS = 300_000
const NOT_STARTED = 'The run was not started.'
const TERMINAL = ['passed', 'failed', 'skipped', 'cancelled']

interface RunRowRead {
  readonly id: string
  readonly status: string
  readonly ownerPid: number | null
  readonly attributes: Record<string, string>
}

const target = new CountingTarget()

beforeAll(async () => { await target.listen() })
afterAll(async () => { await target.close() })

function project(environment: 'local' | 'production' = 'local'): InProcessFixture {
  refuseWithoutPosixRunLifecycle()
  const created = createInProcessFixture({ origin: target.origin, environment })
  mkdirSync(join(created.project, 'no-browsers'), { recursive: true })
  return created
}

async function run(
  at: InProcessFixture,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): Promise<CliRunExit & { pid: number }> {
  const started = startCliRun(at, args, {
    PLAYWRIGHT_BROWSERS_PATH: join(at.project, 'no-browsers'),
    ...env,
  })
  return { ...(await started.done), pid: started.pid }
}

function runsDbOf(at: InProcessFixture): string {
  return join(at.agentQaRoot, 'runs.db')
}

function printedRunIds(stdout: string): string[] {
  return [...stdout.matchAll(/^Run ID: (\S+)$/gmu)].map((match) => match[1]!)
}

function namedRunIds(exit: CliRunExit): string[] {
  return [...new Set(`${exit.stdout}\n${exit.stderr}`.match(/\br_[a-z]+(?:-[a-z]+)+/gu) ?? [])]
}

function runDirectories(at: InProcessFixture): string[] {
  const runs = join(at.agentQaRoot, 'runs')
  return existsSync(runs) ? readdirSync(runs) : []
}

function rows(at: InProcessFixture): RunRowRead[] {
  const db = new DatabaseSync(runsDbOf(at), { readOnly: true })
  try {
    return (db.prepare('SELECT id, status, owner_pid, attributes FROM runs ORDER BY id').all() as Array<{
      id: string
      status: string
      owner_pid: number | null
      attributes: string | null
    }>).map((row) => ({
      id: row.id,
      status: row.status,
      ownerPid: row.owner_pid,
      attributes: row.attributes === null ? {} : JSON.parse(row.attributes) as Record<string, string>,
    }))
  } finally {
    db.close()
  }
}

function rawRow(path: string, runId: string): string {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return JSON.stringify(db.prepare('SELECT * FROM runs WHERE id = ?').all(runId))
  } finally {
    db.close()
  }
}

const flat = (text: string): string => text.replace(/\s*\n\s*/gu, ' | ').slice(0, 800)

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

const PLUGIN_MARKER = 'plugin-loaded.marker'

function declareMarkerAuthPlugin(at: InProcessFixture): string {
  writeFileSync(join(at.project, 'marker-auth-plugin.mjs'), [
    "import { writeFileSync } from 'node:fs'",
    `writeFileSync(new URL('./${PLUGIN_MARKER}', import.meta.url), String(process.pid))`,
    'export const providers = []',
    '',
  ].join('\n'))
  appendFileSync(at.configPath, 'plugins:\n  auth:\n    - path: ./marker-auth-plugin.mjs\n')
  return join(at.project, PLUGIN_MARKER)
}

function writeVersion4RunsDb(at: InProcessFixture): string {
  const path = runsDbOf(at)
  mkdirSync(at.agentQaRoot, { recursive: true })
  const old = new DatabaseSync(path)
  old.exec('CREATE TABLE runs (id TEXT PRIMARY KEY); PRAGMA user_version = 4')
  old.close()
  return path
}

describe('C443-CLI-ROW', () => {
  it('a single-test run with no dashboard block writes its row under the printed id', async () => {
    const at = project()
    expect(readFileSync(at.configPath, 'utf8').includes('dashboard'), 'the config names a dashboard block').toBe(false)

    const exit = await run(at, ['run', at.testPattern])

    const ids = namedRunIds(exit)
    expect(ids.length, `printed run ids: ${flat(exit.stdout)} | ${flat(exit.stderr)}`).toBe(1)
    expect(existsSync(runsDbOf(at)), `no runs.db after the run: ${flat(exit.stderr)}`).toBe(true)
    const recorded = rows(at)
    expect(recorded.map((row) => row.id).join(','), 'the rows under runs.db').toBe(ids[0])
    expect(recorded[0]!.ownerPid, 'the row owner pid').toBe(exit.pid)
    expect(recorded[0]!.attributes['agent-qa.trigger'], 'the row trigger').toBe('cli')
    expect(TERMINAL.includes(recorded[0]!.status), `the row status ${recorded[0]!.status}`).toBe(true)
  }, CELL_BUDGET_MS)

  it('a suite run with no dashboard block writes one row under the printed id', async () => {
    const at = project()
    expect(readFileSync(at.configPath, 'utf8').includes('dashboard'), 'the config names a dashboard block').toBe(false)

    const exit = await run(at, ['run', '--suite', at.suitePattern])

    const ids = namedRunIds(exit)
    expect(ids.length, `printed run ids: ${flat(exit.stdout)} | ${flat(exit.stderr)}`).toBe(1)
    expect(existsSync(runsDbOf(at)), `no runs.db after the suite run: ${flat(exit.stderr)}`).toBe(true)
    const recorded = rows(at)
    expect(recorded.map((row) => row.id).join(','), 'the rows under runs.db').toBe(ids[0])
    expect(recorded[0]!.ownerPid, 'the row owner pid').toBe(exit.pid)
    expect(recorded[0]!.attributes['agent-qa.trigger'], 'the row trigger').toBe('cli')
  }, CELL_BUDGET_MS)
})

describe('C443-RECORD-REFUSAL', () => {
  it('agent-qa run refuses a run whose runs.db cannot be opened, exit 2, no id', async () => {
    const at = project()
    const path = writeVersion4RunsDb(at)
    const before = sha256(path)

    const exit = await run(at, ['run', at.testPattern])

    expect(exit.code, `exit code; stderr: ${flat(exit.stderr)}`).toBe(2)
    expect(exit.stderr.includes(path), `stderr names the file: ${flat(exit.stderr)}`).toBe(true)
    expect(exit.stderr.includes(NOT_STARTED), `stderr says the run was not started: ${flat(exit.stderr)}`).toBe(true)
    expect(printedRunIds(exit.stdout).join(','), 'printed run ids').toBe('')
    expect(namedRunIds(exit).join(','), 'run ids the command named').toBe('')
    expect(runDirectories(at).join(','), 'run directories').toBe('')
    expect(sha256(path) === before, 'the version-4 file changed').toBe(true)
  }, CELL_BUDGET_MS)

  it('a refused production agent-qa run creates no runs.db file', async () => {
    const at = project('production')
    appendFileSync(at.configPath, 'services:\n  dashboard: {}\n')

    const exit = await run(at, ['run', at.testPattern])

    expect(exit.code, `exit code; stderr: ${flat(exit.stderr)}`).toBe(2)
    expect(exit.stderr.includes('Run denied:'), `stderr carries the production sentence: ${flat(exit.stderr)}`).toBe(true)
    expect(existsSync(runsDbOf(at)), 'a runs.db file exists').toBe(false)
    expect(runDirectories(at).join(','), 'run directories').toBe('')
  }, CELL_BUDGET_MS)

  it('a suite run whose runs.db cannot be opened is refused before its plugins load', async () => {
    const at = project()
    const marker = declareMarkerAuthPlugin(at)
    const path = writeVersion4RunsDb(at)
    const before = sha256(path)

    const exit = await run(at, ['run', '--suite', at.suitePattern])

    expect(exit.code, `exit code; stderr: ${flat(exit.stderr)}`).toBe(2)
    expect(exit.stderr.includes(path), `stderr names the file: ${flat(exit.stderr)}`).toBe(true)
    expect(exit.stderr.includes(NOT_STARTED), `stderr says the run was not started: ${flat(exit.stderr)}`).toBe(true)
    expect(printedRunIds(exit.stdout).join(','), 'printed run ids').toBe('')
    expect(namedRunIds(exit).join(','), 'run ids the command named').toBe('')
    expect(runDirectories(at).join(','), 'run directories').toBe('')
    expect(existsSync(marker), 'the auth plugin loaded').toBe(false)
    expect(sha256(path) === before, 'the version-4 file changed').toBe(true)
  }, CELL_BUDGET_MS)
})

describe('C443-HANDED-ROW', () => {
  it('a parse error writes one failed row under the printed id', async () => {
    const at = project()
    writeFileSync(join(at.project, at.testPattern), 'name: [an unclosed list\nsteps:\n  - Verify\n')

    const exit = await run(at, ['run', at.testPattern])

    expect(exit.code, `exit code; stderr: ${flat(exit.stderr)}`).toBe(2)
    const ids = namedRunIds(exit)
    expect(ids.length, `printed run ids: ${flat(exit.stdout)}`).toBe(1)
    expect(existsSync(runsDbOf(at)), `no runs.db after the parse error: ${flat(exit.stderr)}`).toBe(true)
    const recorded = rows(at)
    expect(recorded.map((row) => `${row.id}:${row.status}`).join(','), 'the rows under runs.db').toBe(`${ids[0]}:failed`)
  }, CELL_BUDGET_MS)

  it('a suite preparation failure writes one failed row under the printed id', async () => {
    const at = project()
    const suiteFile = join(at.project, at.suitePattern)
    writeFileSync(suiteFile, readFileSync(suiteFile, 'utf8').replace('test: tests/member.yaml', 'test: ../outside.yaml'))

    const exit = await run(at, ['run', '--suite', at.suitePattern])

    expect(exit.code, `exit code; stderr: ${flat(exit.stderr)}`).toBe(2)
    expect(exit.stderr.includes('Path traversal rejected'), `stderr names the refusal: ${flat(exit.stderr)}`).toBe(true)
    const ids = namedRunIds(exit)
    expect(ids.length, `printed run ids: ${flat(exit.stdout)}`).toBe(1)
    expect(existsSync(runsDbOf(at)), `no runs.db after the preparation failure: ${flat(exit.stderr)}`).toBe(true)
    const recorded = rows(at)
    expect(recorded.map((row) => `${row.id}:${row.status}`).join(','), 'the rows under runs.db').toBe(`${ids[0]}:failed`)
  }, CELL_BUDGET_MS)

  it('an AGENT_QA_RUN_ID naming another process\'s row is refused and the row is untouched', async () => {
    const at = project()
    const path = runsDbOf(at)
    const runId = generateRunId()
    const elsewhere = new DashboardDatabase({
      dbPath: path,
      runOwnership: {
        self: { pid: 4343, incarnation: 'proc-starttime:elsewhere', host: 'elsewhere' },
        probe: { isAlive: () => true, incarnationOf: () => undefined },
      },
    })
    elsewhere.insertRun({
      id: runId,
      name: 'owned elsewhere',
      status: 'running',
      duration: 0,
      startedAt: '2026-10-17T00:00:00.000Z',
      endedAt: '2026-10-17T00:00:00.000Z',
      platform: 'web',
    })
    elsewhere.close()
    const before = rawRow(path, runId)

    const exit = await run(at, ['run', at.testPattern], { AGENT_QA_RUN_ID: runId })

    expect(exit.code, `exit code; stderr: ${flat(exit.stderr)}`).toBe(2)
    expect(exit.stderr.includes('that id already names a run'), `stderr carries the in-use sentence: ${flat(exit.stderr)}`).toBe(true)
    expect(rawRow(path, runId) === before, 'the other process row changed').toBe(true)
    expect(runDirectories(at).join(','), 'run directories').toBe('')
  }, CELL_BUDGET_MS)
})
