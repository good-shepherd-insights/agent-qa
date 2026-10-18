// C444-PASS-RATE (444-24, D-59, D-34): one test passes in one real `agent-qa run` and is
// abort-skipped in a second, which is cancelled with one SIGINT while an earlier member is held.
// The shipped dashboard is then read in headless Chromium: the Tests page's Pass rate cell and the
// test viewer's Pass Rate must agree, and a test whose only outcome is cancelled has no rate.

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { DashboardDatabase, resolveDashboardDbPath } from '@vostride/agent-qa-dashboard'
import { generateRunId, generateTestId } from '@vostride/agent-qa-ids'
import { chromium } from 'playwright-core'
import type { Browser, Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { printedRunIds, refuseWithoutRecordingTools } from './433-door-fixture.js'
import {
  POPULATED_BUTTON_LABEL,
  populatedRunFixtureProject,
  populatedRunSpawnEnv,
  startStubModelServer,
  startTargetPageServer,
  type FixtureServer,
  type PopulatedRunProject,
  type StubModelServer,
} from './populated-run-fixture.js'
import {
  CLI_ENTRY,
  cleanupTempRoots,
  hermeticEnv,
  reserveEphemeralPort,
  spawnDashboard,
  type SpawnedDashboard,
} from './spawned-chat.js'

const FILE_BUDGET_MS = 900_000
const RUN_BUDGET_MS = 240_000
const HOLD_BUDGET_MS = 120_000
const PAGE_BUDGET_MS = 30_000
const HOLD_MARKER = 'once the operator lifts the hold'
const HOLD_STEP_TEXT = `Click the ${POPULATED_BUTTON_LABEL} button ${HOLD_MARKER}.`
const EM_DASH = '—'

type Key = 'a-parked' | 'b-steady'

interface Written {
  readonly key: Key
  readonly file: string
  readonly name: string
  readonly testId: string
}

interface MemberRow {
  readonly testId?: string
  readonly outcome?: string
}

interface Seeded {
  readonly label: 'run 1' | 'run 2'
  readonly runId: string
  readonly args: readonly string[]
  reached?: 'held' | 'exited' | 'timeout'
  exit?: { code: number | null; signal: NodeJS.Signals | null }
  printed?: boolean
  output?: string
  members?: MemberRow[]
  unreadable?: string
}

interface Reading {
  cells?: string[]
  text?: string
  error?: string
}

interface Scene {
  tests: Written[]
  runs: Seeded[]
  testsPage: Partial<Record<Key, Reading>>
  viewer: Partial<Record<Key, Reading>>
  error?: string
}

const scene: Scene = { tests: [], runs: [], testsPage: {}, viewer: {} }
const children: ChildProcess[] = []
let model: StubModelServer | undefined
let target: FixtureServer | undefined
let dashboard: SpawnedDashboard | undefined
let browser: Browser | undefined

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function seen(): string {
  return JSON.stringify(scene, null, 2)
}

function written(key: Key): Written {
  const test = scene.tests.find((candidate) => candidate.key === key)
  if (test === undefined) throw new Error(`no ${key} test was written\n${seen()}`)
  return test
}

// Each test is the fixture's own test file with its own id and name; a-parked's step carries the
// hold marker, b-steady keeps the fixture's passing step.
function writeTests(project: PopulatedRunProject): Written[] {
  const source = readFileSync(join(project.root, project.testPath), 'utf8')
  const tests: Written[] = []
  for (const key of ['a-parked', 'b-steady'] as const) {
    const testId = generateTestId()
    const name = `Pass rate ${key} probe`
    const file = `tests/pass-rate/${key}.test.yaml`
    let text = source
      .replace(/^name: .*$/m, `name: ${name}`)
      .replace(/^test-id: .*$/m, `test-id: ${testId}`)
    if (key === 'a-parked') text = text.replace(/^steps:\n {2}- .*$/m, `steps:\n  - ${HOLD_STEP_TEXT}`)
    if (key === 'a-parked' && !text.includes(HOLD_MARKER)) throw new Error(`a-parked lost its hold marker:\n${text}`)
    if (key === 'b-steady' && text.includes(HOLD_MARKER)) throw new Error(`b-steady carries the hold marker:\n${text}`)
    mkdirSync(join(project.root, 'tests', 'pass-rate'), { recursive: true })
    writeFileSync(join(project.root, file), text, 'utf8')
    tests.push({ key, file, name, testId })
  }
  return tests
}

async function seed(
  project: PopulatedRunProject,
  stub: StubModelServer,
  seeded: Seeded,
  interruptAtHold: boolean,
): Promise<void> {
  if (!existsSync(CLI_ENTRY)) throw new Error(`The built CLI is missing at ${CLI_ENTRY}; run pnpm build first`)
  const child = spawn(process.execPath, [CLI_ENTRY, '--config', project.configPath, 'run', ...seeded.args], {
    cwd: project.root,
    env: {
      ...hermeticEnv(project.root),
      ...populatedRunSpawnEnv(),
      CI: 'true',
      NO_COLOR: '1',
      DO_NOT_TRACK: '1',
      AGENT_QA_CANCEL_GRACE_MS: '120000',
      AGENT_QA_RUN_ID: seeded.runId,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
  child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
  const budget = setTimeout(() => { child.kill('SIGKILL') }, RUN_BUDGET_MS)
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((settle, fail) => {
    child.once('error', fail)
    child.once('close', (code, signal) => { settle({ code, signal }) })
  }).finally(() => { clearTimeout(budget) })
  try {
    if (interruptAtHold) {
      let wait: NodeJS.Timeout | undefined
      seeded.reached = await Promise.race([
        stub.held.arrived().then(() => 'held' as const),
        closed.then(() => 'exited' as const, () => 'exited' as const),
        new Promise<'timeout'>((settle) => { wait = setTimeout(() => { settle('timeout') }, HOLD_BUDGET_MS) }),
      ])
      clearTimeout(wait)
      if (seeded.reached === 'held') child.kill('SIGINT')
    }
    seeded.exit = await closed
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    seeded.output = output.slice(-1_500)
  }
  seeded.printed = printedRunIds(output).includes(seeded.runId)
}

// A fresh read of runs.db once both runs have exited; a read that fails is recorded as unreadable,
// never as a pass.
function readMembers(project: PopulatedRunProject, seeded: Seeded): void {
  let db: DashboardDatabase | undefined
  try {
    db = new DashboardDatabase({ dbPath: resolveDashboardDbPath({ configDir: project.root }) })
    seeded.members = (db.readRunDetailRows(seeded.runId)?.members ?? []).map((member) => ({
      ...(member.testId === undefined || member.testId === null ? {} : { testId: member.testId }),
      ...(member.outcome === undefined || member.outcome === null ? {} : { outcome: member.outcome }),
    }))
  } catch (error) {
    seeded.unreadable = message(error)
  } finally {
    db?.close()
  }
}

async function settle<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + PAGE_BUDGET_MS
  let value = await read()
  let steady = 0
  while (Date.now() < deadline && steady < 4) {
    await new Promise((tick) => setTimeout(tick, 500))
    const next = await read()
    steady = done(next) && JSON.stringify(next) === JSON.stringify(value) ? steady + 1 : 0
    value = next
  }
  return value
}

async function readTestsPage(page: Page, tests: readonly Written[]): Promise<Scene['testsPage']> {
  await page.goto(`${dashboard!.origin}/tests`)
  const read = async (): Promise<Scene['testsPage']> => {
    const heads = (await page.locator('thead th').allTextContents()).map((text) => text.trim())
    const column = heads.findIndex((text) => text.startsWith('Pass rate'))
    const readings: Scene['testsPage'] = {}
    for (const test of tests) {
      const row = page.locator('tbody tr', { hasText: `pass-rate/${test.key}.test.yaml` })
      if (column < 0 || await row.count() !== 1) {
        readings[test.key] = { error: `column ${String(column)}, ${String(await row.count())} rows` }
        continue
      }
      const cell = row.locator('td').nth(column)
      readings[test.key] = {
        cells: (await cell.locator(':scope > div > div').allTextContents()).map((text) => text.trim()),
        text: (await cell.textContent())?.trim() ?? '',
      }
    }
    return readings
  }
  return settle(read, (readings) => tests.every((test) => readings[test.key]?.cells !== undefined))
}

async function readViewer(page: Page, test: Written): Promise<Reading> {
  await page.goto(`${dashboard!.origin}/test/${test.testId}`)
  const sidebar = page.locator('[data-testid="test-detail-analytics-sidebar"]')
  const read = async (): Promise<Reading> => {
    if (await sidebar.count() === 0) return { error: 'no analytics sidebar' }
    const values = await sidebar
      .locator('xpath=.//*[normalize-space(text())="Pass Rate"]/following-sibling::*[1]')
      .allTextContents()
    return { cells: values.map((value) => value.trim()), text: (await sidebar.first().textContent()) ?? '' }
  }
  return settle(read, (reading) => (reading.cells?.length ?? 0) > 0)
}

async function drive(): Promise<void> {
  target = await startTargetPageServer()
  model = await startStubModelServer({ holdOnlyStepText: HOLD_MARKER })
  const project = populatedRunFixtureProject('444-pass-rate', {
    modelBaseUrl: model.baseUrl,
    targetUrl: target.url,
  })
  scene.tests = writeTests(project)
  const parked = written('a-parked')
  const steady = written('b-steady')

  const first: Seeded = { label: 'run 1', runId: generateRunId(), args: [steady.file] }
  scene.runs.push(first)
  await seed(project, model, first, false)

  // 2026-10-17 (444-01): `run tests/<dir>/` is refused as unmatched by the workspace patterns,
  // so the directory's two files are named in order, still as one invocation.
  const second: Seeded = { label: 'run 2', runId: generateRunId(), args: [parked.file, steady.file] }
  scene.runs.push(second)
  try {
    await seed(project, model, second, true)
  } finally {
    model.held.release()
  }
  for (const run of scene.runs) readMembers(project, run)

  const port = await reserveEphemeralPort()
  const spawned = await spawnDashboard(project.root, project.configPath, port, 60_000, populatedRunSpawnEnv())
  dashboard = spawned
  if (!spawned.ready) throw new Error(`the spawned dashboard never said it was listening: ${spawned.stderr()}`)
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  scene.testsPage = await readTestsPage(page, scene.tests)
  for (const test of scene.tests) scene.viewer[test.key] = await readViewer(page, test)
}

function memberOf(label: Seeded['label'], key: Key): MemberRow | undefined {
  const testId = written(key).testId
  return scene.runs.find((run) => run.label === label)?.members?.find((member) => member.testId === testId)
}

function expectPrecondition(): void {
  expect(scene.error, seen()).toBeUndefined()
  const [first, second] = scene.runs
  expect(first?.exit, `run 1 exits 0\n${seen()}`).toEqual({ code: 0, signal: null })
  expect(second?.reached, `run 2 reached the hold\n${seen()}`).toBe('held')
  expect(second?.exit, `run 2 exits 130 after one SIGINT\n${seen()}`).toEqual({ code: 130, signal: null })
  for (const run of scene.runs) {
    expect(run.unreadable, `${run.label}'s member rows are readable\n${seen()}`).toBeUndefined()
    expect(run.printed, `${run.label}'s run id was printed\n${seen()}`).toBe(true)
  }
  expect(first?.members, `run 1's member rows\n${seen()}`).toEqual([{ testId: written('b-steady').testId, outcome: 'passed' }])
  expect(second?.members?.length, `run 2's member rows\n${seen()}`).toBe(2)
  expect(memberOf('run 2', 'a-parked')?.outcome, `run 2's a-parked member is cancelled\n${seen()}`).toBe('cancelled')
  expect(memberOf('run 2', 'b-steady')?.outcome, `run 2's b-steady member is abort-skipped\n${seen()}`).toBe('skipped')
}

describe('C444-PASS-RATE', () => {
  beforeAll(async () => {
    refuseWithoutRecordingTools()
    if (process.platform === 'win32') throw new Error('POSIX run lifecycle required; never skip')
    try {
      await drive()
    } catch (error) {
      scene.error = message(error)
    }
    console.info(`C444-PASS-RATE scene: ${JSON.stringify(scene)}`)
  }, FILE_BUDGET_MS)

  afterAll(async () => {
    model?.held.release()
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    await browser?.close().catch(() => undefined)
    await dashboard?.stop().catch(() => undefined)
    await model?.close().catch(() => undefined)
    await target?.close().catch(() => undefined)
    cleanupTempRoots()
  }, 120_000)

  it('a test that passed once and was abort-skipped once reads 100% on the Tests page and in its viewer', () => {
    expectPrecondition()
    expect(scene.testsPage['b-steady']?.cells, `the Tests page's Pass rate cell for b-steady\n${seen()}`)
      .toEqual(['100%', '1/1'])
    expect(scene.viewer['b-steady']?.cells, `the test viewer's Pass Rate for b-steady\n${seen()}`)
      .toEqual(['100%'])
  })

  it('a test whose only outcome is cancelled reads an em dash in its viewer', () => {
    expectPrecondition()
    expect(scene.viewer['a-parked']?.cells, `the test viewer's Pass Rate for a-parked\n${seen()}`)
      .toEqual([EM_DASH])
    expect(scene.viewer['a-parked']?.cells?.join(' '), seen()).not.toContain('%')
  })

  it('a test whose only outcome is cancelled reads an em dash on the Tests page', () => {
    expectPrecondition()
    expect(scene.testsPage['a-parked']?.cells, `the Tests page's Pass rate cell for a-parked\n${seen()}`)
      .toEqual([EM_DASH, '0 completed'])
    expect(scene.testsPage['a-parked']?.text, seen()).not.toContain('0%')
  })
})
