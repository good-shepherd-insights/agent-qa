// C444-PRE-FIX (Phase 444 plan 01; D-28, V2-RUN-03).
//
// The three verify-first questions, asked once with real processes on the code as it stands:
// WINDOWS #519 (the Completed tab), WINDOWS #549 (a multi-test run's name and status while it runs)
// and the queue's pre-written cancel (D-11). Each question gets its own project and stub, driven in
// `beforeAll`; the cells assert on what was recorded, so a question whose drive broke fails.
// A CLI run's id is minted here and handed over through AGENT_QA_RUN_ID, because `agent-qa run`
// prints it only at the end and the cells read the row while the run is held.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { DashboardDatabase, resolveDashboardDbPath } from '@vostride/agent-qa-dashboard'
import { generateRunId, generateTestId } from '@vostride/agent-qa-ids'
import { chromium } from 'playwright-core'
import type { Browser, Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// 2026-10-19 (444.1-21, D-36): each in-process drive's own tail and member executions (a member's
// finally writes its working-memory flush) are awaited before the roots are removed.
const inFlight = vi.hoisted(() => ({
  tails: [] as Array<Promise<void>>,
  members: [] as Array<Promise<unknown>>,
}))

vi.mock('../../composition/in-process-run-execution.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../composition/in-process-run-execution.js')>()
  return {
    ...original,
    runInProcessCliRun: async (...args: Parameters<typeof original.runInProcessCliRun>) => {
      const outcome = await original.runInProcessCliRun(...args)
      if (outcome.settled !== undefined) inFlight.tails.push(outcome.settled)
      return outcome
    },
  }
})

vi.mock('../../commands/run.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../commands/run.js')>()
  return {
    ...original,
    produceMembersFromPatterns: async (
      ...args: Parameters<typeof original.produceMembersFromPatterns>
    ) => {
      const produced = await original.produceMembersFromPatterns(...args)
      return {
        ...produced,
        executor: (...run: Parameters<typeof produced.executor>) => {
          const execution = produced.executor(...run)
          inFlight.members.push(execution)
          return execution
        },
      }
    },
  }
})

import {
  openDashboardScene,
  printedRunIds,
  refuseWithoutRecordingTools,
  runStoreEvents,
  type DashboardScene,
} from './433-door-fixture.js'
import {
  POPULATED_BUTTON_LABEL,
  POPULATED_FAILURE_STEP_MARKER,
  POPULATED_FAILURE_STEP_TEXT,
  POPULATED_PASSING_STEP_TEXT,
  POPULATED_TARGET_NAME,
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

const FILE_BUDGET_MS = 1_500_000
const RUN_BUDGET_MS = 240_000
const HOLD_BUDGET_MS = 120_000
const PAGE_BUDGET_MS = 20_000
const CANCEL_SETTLE_MS = 60_000
const HOLD_MARKER = 'once the operator lifts the hold'
const HOLD_STEP_TEXT = `Click the ${POPULATED_BUTTON_LABEL} button ${HOLD_MARKER}.`

type Reached = 'held' | 'exited' | 'timeout'

interface TestSpec {
  readonly file: string
  readonly name: string
  readonly step: string
}

interface WrittenTest extends TestSpec {
  readonly testId: string
}

interface RowView {
  readonly name: string
  readonly status: string
  readonly testId: string | null
}

interface ExitView {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly text: string
}

interface TabView {
  readonly shown: string[]
  readonly selected: boolean
  readonly waitFailure?: string
}

interface Rig {
  readonly project: PopulatedRunProject
  readonly model: StubModelServer
  readonly target: FixtureServer
}

interface Run519 {
  readonly label: 'passed' | 'failed' | 'cancelled'
  readonly test: WrittenTest
  readonly runId: string
  reached?: Reached
  exit?: ExitView
  printed?: boolean
  row?: RowView
  events?: string[]
}

interface Scene519 {
  rig?: Rig
  runs: Run519[]
  all?: TabView
  completed?: TabView
  error?: string
}

interface Scene549 {
  rig?: Rig
  tests: WrittenTest[]
  runId?: string
  reached?: Reached
  atHold?: RowView
  atEnd?: RowView
  exit?: ExitView
  printed?: boolean
  members?: Array<{ testId?: string; name?: string; outcome?: string }>
  error?: string
}

interface Sample {
  readonly status: string
  readonly verdict: boolean
}

interface SceneCancel {
  rig?: Rig
  scene?: DashboardScene
  runId?: string
  enqueue?: string
  reached?: Reached
  atHold?: RowView
  cancelAnswer?: string
  atAnswer?: RowView
  verdictAtAnswer?: boolean
  abortedAtAnswer?: number
  samples?: Sample[]
  finished?: boolean
  final?: RowView
  finalVerdict?: string
  abortedAtEnd?: number
  finalSummary?: string | null
  artifactErrors?: unknown
  error?: string
}

const rigs: Rig[] = []
const scene519: Scene519 = { runs: [] }
const scene549: Scene549 = { tests: [] }
const sceneCancel: SceneCancel = {}
let dashboard: SpawnedDashboard | undefined
let browser: Browser | undefined
let savedCi: string | undefined
let savedBrowsers: string | undefined

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function dbPathOf(project: PopulatedRunProject): string {
  return resolveDashboardDbPath({ configDir: project.root })
}

async function openRig(
  label: string,
  tests: readonly TestSpec[],
): Promise<Rig & { tests: WrittenTest[] }> {
  const target = await startTargetPageServer()
  const model = await startStubModelServer({
    plannerOutcome: 'stepFailed',
    failOnlyStepText: POPULATED_FAILURE_STEP_MARKER,
    holdOnlyStepText: HOLD_MARKER,
  })
  const rig = {
    project: populatedRunFixtureProject(label, {
      modelBaseUrl: model.baseUrl,
      targetUrl: target.url,
    }),
    model,
    target,
  }
  rigs.push(rig)
  const written = tests.map((spec) => {
    const testId = generateTestId()
    const file = join(rig.project.root, spec.file)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(
      file,
      `name: ${spec.name}\ntest-id: ${testId}\ntarget: ${POPULATED_TARGET_NAME}\n`
        + `steps:\n  - ${spec.step}\n`,
      'utf8',
    )
    return { ...spec, testId }
  })
  return { ...rig, tests: written }
}

interface StartedRun {
  exited(): boolean
  interrupt(): void
  readonly done: Promise<ExitView>
}

function startCli(
  project: PopulatedRunProject,
  args: readonly string[],
  runId: string,
): StartedRun {
  if (!existsSync(CLI_ENTRY)) {
    throw new Error(`The built CLI is missing at ${CLI_ENTRY}; run pnpm build first`)
  }
  const env: NodeJS.ProcessEnv = {
    ...hermeticEnv(project.root),
    ...populatedRunSpawnEnv(),
    CI: 'true',
    NO_COLOR: '1',
    DO_NOT_TRACK: '1',
    AGENT_QA_CANCEL_GRACE_MS: '120000',
    AGENT_QA_RUN_ID: runId,
  }
  const child = spawn(process.execPath, [CLI_ENTRY, '--config', project.configPath, ...args], {
    cwd: project.root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let text = ''
  child.stdout.on('data', (chunk: Buffer) => { text += chunk.toString('utf8') })
  child.stderr.on('data', (chunk: Buffer) => { text += chunk.toString('utf8') })
  const budget = setTimeout(() => { child.kill('SIGKILL') }, RUN_BUDGET_MS)
  const done = new Promise<ExitView>((settle, fail) => {
    child.once('error', fail)
    child.once('close', (code, signal) => settle({ code, signal, text }))
  }).finally(() => { clearTimeout(budget) })
  return {
    exited: () => child.exitCode !== null || child.signalCode !== null,
    interrupt: () => { child.kill('SIGINT') },
    done,
  }
}

async function untilHeld(
  model: StubModelServer,
  ended: () => boolean,
  budgetMs: number,
): Promise<Reached> {
  const deadline = Date.now() + budgetMs
  for (;;) {
    if (model.held.count() > 0) return 'held'
    if (ended()) return 'exited'
    if (Date.now() >= deadline) return 'timeout'
    await new Promise((tick) => setTimeout(tick, 50))
  }
}

function readRow(project: PopulatedRunProject, runId: string): RowView | undefined {
  const dbPath = dbPathOf(project)
  if (!existsSync(dbPath)) return undefined
  const db = new DashboardDatabase({ dbPath })
  try {
    const row = db.getRun(runId)
    return row === undefined
      ? undefined
      : { name: row.name, status: row.status, testId: row.testId }
  } finally {
    db.close()
  }
}

function readMembers(project: PopulatedRunProject, runId: string): Scene549['members'] {
  const db = new DashboardDatabase({ dbPath: dbPathOf(project) })
  try {
    return (db.readRunDetailRows(runId)?.members ?? []).map((member) => ({
      ...(member.testId === undefined ? {} : { testId: member.testId }),
      ...(member.name === undefined ? {} : { name: member.name }),
      ...(member.outcome === undefined ? {} : { outcome: member.outcome }),
    }))
  } finally {
    db.close()
  }
}

function loggedEvents(
  project: PopulatedRunProject,
  runId: string,
): Array<{ type: string; payload?: unknown }> {
  try {
    return runStoreEvents(project, runId) as Array<{ type: string; payload?: unknown }>
  } catch {
    return []
  }
}

function eventTypes(project: PopulatedRunProject, runId: string): string[] {
  return loggedEvents(project, runId).map((event) => event.type)
}

async function shownNames(page: Page, names: readonly string[]): Promise<string[]> {
  const text = await page.locator('body').innerText().catch(() => '')
  return names.filter((name) => text.includes(name))
}

// Waits for the tab's own list request (one other than the page's first), then for the names it
// shows to hold still; records, never throws.
async function observeTab(
  page: Page,
  tabName: string,
  names: readonly string[],
  previousList?: string,
): Promise<TabView> {
  let waitFailure: string | undefined
  const tab = page.getByRole('tab', { name: tabName })
  const listed = previousList === undefined
    ? undefined
    : page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/runs'
        && response.request().method() === 'GET'
        && response.url() !== previousList,
      { timeout: PAGE_BUDGET_MS },
    )
  try {
    await tab.click({ timeout: PAGE_BUDGET_MS })
    await listed
  } catch (error) {
    waitFailure = message(error)
    listed?.catch(() => undefined)
  }
  const deadline = Date.now() + PAGE_BUDGET_MS
  let shown = await shownNames(page, names)
  let steady = 0
  while (Date.now() < deadline && shown.length < names.length && steady < 6) {
    await new Promise((tick) => setTimeout(tick, 500))
    const next = await shownNames(page, names)
    steady = next.join('\n') === shown.join('\n') ? steady + 1 : 0
    shown = next
  }
  const selected = (await tab.getAttribute('aria-selected').catch(() => null)) === 'true'
  return { shown, selected, ...(waitFailure === undefined ? {} : { waitFailure }) }
}

async function drive519(): Promise<void> {
  const rig = await openRig('444-pre-fix-519', [
    {
      file: 'tests/519/passing.test.yaml',
      name: 'Completed tab passing probe',
      step: POPULATED_PASSING_STEP_TEXT,
    },
    {
      file: 'tests/519/failing.test.yaml',
      name: 'Completed tab failing probe',
      step: POPULATED_FAILURE_STEP_TEXT,
    },
    {
      file: 'tests/519/cancelled.test.yaml',
      name: 'Completed tab cancelled probe',
      step: HOLD_STEP_TEXT,
    },
  ])
  scene519.rig = rig
  const labels = ['passed', 'failed', 'cancelled'] as const
  for (const [index, label] of labels.entries()) {
    const test = rig.tests[index]!
    const run: Run519 = { label, test, runId: generateRunId() }
    scene519.runs.push(run)
    const started = startCli(rig.project, ['run', test.file], run.runId)
    if (label === 'cancelled') {
      run.reached = await untilHeld(rig.model, started.exited, HOLD_BUDGET_MS)
      if (run.reached === 'held') started.interrupt()
    }
    run.exit = await started.done
    run.printed = printedRunIds(run.exit.text).includes(run.runId)
    run.row = readRow(rig.project, run.runId)
    run.events = eventTypes(rig.project, run.runId)
  }
  rig.model.held.release()

  const port = await reserveEphemeralPort()
  dashboard = await spawnDashboard(
    rig.project.root,
    rig.project.configPath,
    port,
    60_000,
    populatedRunSpawnEnv(),
  )
  if (!dashboard.stdout().includes('Dashboard running at')) {
    throw new Error(`the spawned dashboard never said it was listening: ${dashboard.stderr()}`)
  }
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const names = scene519.runs.map((run) => run.test.name)
  let firstList: string | undefined
  page.on('response', (response) => {
    if (firstList !== undefined) return
    if (new URL(response.url()).pathname === '/api/runs') firstList = response.url()
  })
  await page.goto(`${dashboard.origin}/runs`)
  await page.getByRole('tab', { name: 'All' })
    .waitFor({ state: 'visible', timeout: PAGE_BUDGET_MS })
  scene519.all = await observeTab(page, 'All', names)
  scene519.completed = await observeTab(page, 'Completed', names, firstList ?? '')
}

async function drive549(): Promise<void> {
  const rig = await openRig('444-pre-fix-549', [
    { file: 'tests/549/a-login.test.yaml', name: 'a-login', step: POPULATED_PASSING_STEP_TEXT },
    { file: 'tests/549/b-checkout.test.yaml', name: 'b-checkout', step: HOLD_STEP_TEXT },
    { file: 'tests/549/c-search.test.yaml', name: 'c-search', step: POPULATED_PASSING_STEP_TEXT },
  ])
  scene549.rig = rig
  scene549.tests = rig.tests
  const runId = generateRunId()
  scene549.runId = runId
  // 2026-10-17 (444-01): `run tests/549/` is refused as unmatched by the workspace patterns.
  const started = startCli(rig.project, ['run', ...rig.tests.map((test) => test.file)], runId)
  try {
    scene549.reached = await untilHeld(rig.model, started.exited, HOLD_BUDGET_MS)
    if (scene549.reached === 'held') scene549.atHold = readRow(rig.project, runId)
  } finally {
    rig.model.held.release()
  }
  scene549.exit = await started.done
  scene549.printed = printedRunIds(scene549.exit.text).includes(runId)
  scene549.atEnd = readRow(rig.project, runId)
  scene549.members = readMembers(rig.project, runId)
}

async function postText(url: string, body?: unknown): Promise<{ status: number; text: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, text: await response.text() }
}

async function driveCancel(): Promise<void> {
  const rig = await openRig('444-pre-fix-cancel', [
    { file: 'tests/cancel/held.test.yaml', name: 'Queue cancel held probe', step: HOLD_STEP_TEXT },
  ])
  sceneCancel.rig = rig
  savedCi = process.env.CI
  savedBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH
  process.env.CI = 'true'
  const browsers = populatedRunSpawnEnv().PLAYWRIGHT_BROWSERS_PATH
  if (browsers !== undefined) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers
  const scene = await openDashboardScene(rig.project)
  sceneCancel.scene = scene
  const enqueued = await postText(`${scene.origin}/api/runs/trigger`, {
    file: rig.tests[0]!.file,
  })
  sceneCancel.enqueue = `${String(enqueued.status)} ${enqueued.text}`
  const runId = (JSON.parse(enqueued.text) as { runId?: unknown }).runId
  if (typeof runId !== 'string') {
    throw new Error(`the queue route answered no run id: ${sceneCancel.enqueue}`)
  }
  sceneCancel.runId = runId
  const finished = (): boolean => eventTypes(rig.project, runId).includes('runFinished')
  sceneCancel.reached = await untilHeld(rig.model, finished, HOLD_BUDGET_MS)
  if (sceneCancel.reached !== 'held') return
  sceneCancel.atHold = readRow(rig.project, runId)
  // The verdict can land before the route's answer arrives, so the row is sampled on every turn of
  // this process's event loop (the dashboard runs here) from before the cancel until the verdict.
  const reader = new DashboardDatabase({ dbPath: dbPathOf(rig.project) })
  const samples: Sample[] = []
  sceneCancel.samples = samples
  const sample = (): Sample => {
    const next = {
      status: reader.getRun(runId)?.status ?? 'absent',
      verdict: eventTypes(rig.project, runId).includes('verdict'),
    }
    const last = samples.at(-1)
    if (last?.status !== next.status || last.verdict !== next.verdict) samples.push(next)
    return next
  }
  let sampling = true
  const sampled = (async () => {
    const until = Date.now() + CANCEL_SETTLE_MS
    while (sampling && Date.now() < until && !sample().verdict) {
      await new Promise((turn) => setImmediate(turn))
    }
  })()
  try {
    sample()
    const cancelUrl = `${scene.origin}/api/runs/${encodeURIComponent(runId)}/cancel`
    const answer = await postText(cancelUrl)
    sceneCancel.atAnswer = readRow(rig.project, runId)
    sceneCancel.verdictAtAnswer = eventTypes(rig.project, runId).includes('verdict')
    sceneCancel.abortedAtAnswer = rig.model.held.aborted()
    sceneCancel.cancelAnswer = `${String(answer.status)} ${answer.text}`
    await sampled
  } finally {
    sampling = false
    await sampled
    reader.close()
  }
  const deadline = Date.now() + CANCEL_SETTLE_MS
  while (!finished() && Date.now() < deadline) {
    await new Promise((tick) => setTimeout(tick, 100))
  }
  sceneCancel.finished = finished()
  sceneCancel.final = readRow(rig.project, runId)
  const verdict = loggedEvents(rig.project, runId).find((event) => event.type === 'verdict')
  sceneCancel.finalVerdict = verdict === undefined
    ? undefined
    : JSON.stringify(verdict.payload).slice(0, 300)
  sceneCancel.abortedAtEnd = rig.model.held.aborted()
  const db = new DashboardDatabase({ dbPath: dbPathOf(rig.project) })
  try {
    sceneCancel.finalSummary = db.getRun(runId)?.failureSummary ?? null
    const payload = db.getRunArtifact(runId)?.payload as { errors?: unknown } | undefined
    sceneCancel.artifactErrors = payload?.errors
  } finally {
    db.close()
  }
}

function withoutHandles(key: string, field: unknown): unknown {
  return key === 'rig' || key === 'scene' ? undefined : field
}

function report(label: string, value: unknown): void {
  const line = JSON.stringify(value, (key, field: unknown) => {
    if (key === 'text' && typeof field === 'string') return field.slice(-1_500)
    return withoutHandles(key, field)
  })
  console.info(`C444-PRE-FIX ${label}: ${line}`)
}

function seen(value: unknown): string {
  return JSON.stringify(value, withoutHandles, 2)
}

describe('C444-PRE-FIX', () => {
  beforeAll(async () => {
    refuseWithoutRecordingTools()
    try {
      await drive519()
    } catch (error) {
      scene519.error = message(error)
    }
    report('WINDOWS #519', scene519)
    try {
      await drive549()
    } catch (error) {
      scene549.error = message(error)
    }
    report('WINDOWS #549', scene549)
    try {
      await driveCancel()
    } catch (error) {
      sceneCancel.error = message(error)
    }
    report('queue cancel', sceneCancel)
  }, FILE_BUDGET_MS)

  afterAll(async () => {
    for (const rig of rigs) rig.model.held.release()
    await browser?.close().catch(() => undefined)
    await dashboard?.stop().catch(() => undefined)
    await sceneCancel.scene?.close().catch(() => undefined)
    for (const rig of rigs) {
      await rig.model.close().catch(() => undefined)
      await rig.target.close().catch(() => undefined)
    }
    if (savedCi === undefined) delete process.env.CI
    else process.env.CI = savedCi
    if (savedBrowsers === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH
    else process.env.PLAYWRIGHT_BROWSERS_PATH = savedBrowsers
    try {
      while (inFlight.tails.length + inFlight.members.length > 0) {
        await Promise.allSettled([...inFlight.tails.splice(0), ...inFlight.members.splice(0)])
      }
    } finally {
      cleanupTempRoots()
    }
  }, 120_000)

  it('the instruments see every seeded run on the All tab', () => {
    const facts = seen(scene519)
    expect(scene519.error, facts).toBeUndefined()
    expect(scene519.runs.map((run) => run.label), facts).toEqual(['passed', 'failed', 'cancelled'])
    expect(scene519.runs.find((run) => run.label === 'cancelled')?.reached, facts).toBe('held')
    for (const run of scene519.runs) {
      expect(run.row?.status, `${run.label}'s row has left running\n${facts}`).toBe(run.label)
      expect(run.events, `${run.label}'s events.jsonl holds its verdict\n${facts}`)
        .toContain('verdict')
    }
    expect(scene519.all?.shown, facts).toEqual(scene519.runs.map((run) => run.test.name))
  })

  it('the Completed tab lists a finished passed, failed and cancelled run (WINDOWS #519)', () => {
    const facts = seen(scene519)
    expect(scene519.error, facts).toBeUndefined()
    expect(scene519.runs.length, facts).toBe(3)
    expect(scene519.completed?.selected, facts).toBe(true)
    expect(scene519.completed?.shown, facts).toEqual(scene519.runs.map((run) => run.test.name))
  })

  it(
    'a three-test run keeps one name and stays running until its verdict, with every member listed (WINDOWS #549)',
    () => {
      const facts = seen(scene549)
      expect(scene549.error, facts).toBeUndefined()
      expect(scene549.reached, facts).toBe('held')
      expect(scene549.atHold, facts).toBeDefined()
      expect(scene549.atEnd, facts).toBeDefined()
      expect(scene549.atHold?.name, `the name at the hold equals the name at the end\n${facts}`)
        .toBe(scene549.atEnd?.name)
      expect(scene549.atHold?.status, `the row reads running while member 2 is held\n${facts}`)
        .toBe('running')
      expect(scene549.atEnd?.testId, `the finished row names no test id\n${facts}`).toBeNull()
      expect((scene549.members ?? []).map((member) => member.testId).sort(), facts)
        .toEqual(scene549.tests.map((test) => test.testId).sort())
    },
  )

  it(
    "a dashboard cancel leaves the row running until the run's verdict (the queue's pre-written cancel)",
    () => {
      const facts = seen(sceneCancel)
      expect(sceneCancel.error, facts).toBeUndefined()
      expect(sceneCancel.reached, facts).toBe('held')
      expect(sceneCancel.cancelAnswer, facts).toBeDefined()
      const samples = sceneCancel.samples ?? []
      expect(samples[0], `the row read running before the cancel\n${facts}`)
        .toEqual({ status: 'running', verdict: false })
      expect(samples.some((at) => at.verdict), `the run reached its verdict\n${facts}`).toBe(true)
      expect(
        samples.filter((at) => !at.verdict),
        `the row reads running until the verdict exists\n${facts}`,
      ).toEqual([{ status: 'running', verdict: false }])
      if (sceneCancel.verdictAtAnswer === false) {
        expect(sceneCancel.atAnswer?.status, `the row reads running at the answer\n${facts}`)
          .toBe('running')
      }
    },
  )
})
