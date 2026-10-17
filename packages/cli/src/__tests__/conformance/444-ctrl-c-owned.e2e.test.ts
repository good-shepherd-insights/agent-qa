// C444-CTRL-C-OWNED (444-22, D-46, D-30): on `agent-qa run` a signal is answered by the run's own
// shutdown path, not by Playwright's. Each cell holds a real run inside its step (the stub model
// parks the planning turn), sends one signal to the built bin and reads what the run left: the
// exit, `runFinished`, the printed run id, the verdict, the runs.db row and the Chromium it had.
// The grace timer is set to 120 s and the run must end within 30 s, so only the run's own path
// can pass (research Pitfall 4).

import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'

import { DashboardDatabase, resolveDashboardDbPath } from '@vostride/agent-qa-dashboard'
import { generateRunId } from '@vostride/agent-qa-ids'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { printedRunIds, refuseWithoutRecordingTools, runStoreEvents } from './433-door-fixture.js'
import { refuseWithoutPosixRunLifecycle } from './442-run-fixture.js'
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
import { CLI_ENTRY, cleanupTempRoots, hermeticEnv } from './spawned-chat.js'

const CELL_BUDGET_MS = 300_000
const HOLD_BUDGET_MS = 120_000
const KILL_AFTER_MS = 90_000
const OWN_PATH_BOUND_MS = 30_000
const BROWSER_GONE_MS = 10_000
const HOLD_MARKER = 'once the operator lifts the hold'
const HOLD_STEP_TEXT = `Click the ${POPULATED_BUTTON_LABEL} button ${HOLD_MARKER}.`
const FORCED_EXIT_SUMMARY = 'The run was stopped before it reached a verdict.'
const CHROMIUM_COMMAND = /chrom|headless_shell/i

interface Rig {
  readonly project: PopulatedRunProject
  readonly model: StubModelServer
  readonly target: FixtureServer
  child?: ChildProcess
}

interface SignalReport {
  readonly cell: string
  readonly signal: NodeJS.Signals
  readonly runId: string
  reached?: 'held' | 'exited' | 'timeout'
  chromiumAtSignal?: number[]
  elapsedMs?: number
  exit?: { code: number | null; signal: NodeJS.Signals | null }
  walAfterExit?: boolean
  aliveAfterExit?: number[]
  events?: string[]
  verdict?: unknown
  row?: { status: string; failureSummary: string | null }
  printed?: boolean
  output?: string
}

const rigs: Rig[] = []

async function openRig(label: string): Promise<Rig> {
  const target = await startTargetPageServer()
  const model = await startStubModelServer({ holdOnlyStepText: HOLD_MARKER })
  const project = populatedRunFixtureProject(label, {
    modelBaseUrl: model.baseUrl,
    targetUrl: target.url,
  }, { stepText: HOLD_STEP_TEXT })
  const rig: Rig = { project, model, target }
  rigs.push(rig)
  return rig
}

function spawnRun(rig: Rig, args: readonly string[], runId: string): {
  readonly child: ChildProcess
  readonly output: () => string
  readonly closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
} {
  const child = spawn(process.execPath, [CLI_ENTRY, '--config', rig.project.configPath, ...args], {
    cwd: rig.project.root,
    env: {
      ...hermeticEnv(rig.project.root),
      ...populatedRunSpawnEnv(),
      CI: 'true',
      NO_COLOR: '1',
      DO_NOT_TRACK: '1',
      AGENT_QA_CANCEL_GRACE_MS: '120000',
      AGENT_QA_RUN_ID: runId,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  rig.child = child
  let text = ''
  child.stdout?.on('data', (chunk: Buffer) => { text += chunk.toString('utf8') })
  child.stderr?.on('data', (chunk: Buffer) => { text += chunk.toString('utf8') })
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((settle, fail) => {
    child.once('error', fail)
    child.once('close', (code, signal) => { settle({ code, signal }) })
  })
  return { child, output: () => text, closed }
}

function exited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

async function untilHeld(model: StubModelServer, child: ChildProcess): Promise<'held' | 'exited' | 'timeout'> {
  const deadline = Date.now() + HOLD_BUDGET_MS
  for (;;) {
    if (model.held.count() > 0) return 'held'
    if (exited(child)) return 'exited'
    if (Date.now() >= deadline) return 'timeout'
    await new Promise((tick) => setTimeout(tick, 50))
  }
}

function chromiumUnder(pid: number): number[] {
  const listed = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout
  const children = new Map<number, Array<{ pid: number; command: string }>>()
  for (const line of listed.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line)
    if (match === null) continue
    const parent = Number(match[2])
    children.set(parent, [...(children.get(parent) ?? []), { pid: Number(match[1]), command: match[3]! }])
  }
  const found: number[] = []
  const walk = (at: number): void => {
    for (const child of children.get(at) ?? []) {
      if (CHROMIUM_COMMAND.test(child.command)) found.push(child.pid)
      walk(child.pid)
    }
  }
  walk(pid)
  return found
}

function aliveOf(pids: readonly number[]): number[] {
  const listed = spawnSync('ps', ['-A', '-o', 'pid=,stat='], { encoding: 'utf8' }).stdout
  const alive = new Set<number>()
  for (const line of listed.split('\n')) {
    const [pid, stat] = line.trim().split(/\s+/u)
    if (pid === undefined || stat === undefined || stat.startsWith('Z')) continue
    alive.add(Number(pid))
  }
  return pids.filter((pid) => alive.has(pid))
}

async function aliveAfter(pids: readonly number[]): Promise<number[]> {
  const deadline = Date.now() + BROWSER_GONE_MS
  for (;;) {
    const alive = aliveOf(pids)
    if (alive.length === 0 || Date.now() >= deadline) return alive
    await new Promise((tick) => setTimeout(tick, 100))
  }
}

function readRow(project: PopulatedRunProject, runId: string): SignalReport['row'] {
  const dbPath = resolveDashboardDbPath({ configDir: project.root })
  if (!existsSync(dbPath)) return undefined
  const db = new DashboardDatabase({ dbPath })
  try {
    const row = db.getRun(runId)
    return row === undefined ? undefined : { status: row.status, failureSummary: row.failureSummary ?? null }
  } finally {
    db.close()
  }
}

function loggedEvents(project: PopulatedRunProject, runId: string): Array<{ type: string; payload?: unknown }> {
  try {
    return runStoreEvents(project, runId) as Array<{ type: string; payload?: unknown }>
  } catch {
    return []
  }
}

function report(value: SignalReport): void {
  const line = JSON.stringify(value, (key, field: unknown) =>
    key === 'output' && typeof field === 'string' ? field.slice(-1_500) : field)
  console.info(`C444-CTRL-C-OWNED ${value.cell}: ${line}`)
}

async function signalHeldRun(
  cell: string,
  label: string,
  args: readonly string[],
  signal: NodeJS.Signals,
): Promise<SignalReport> {
  refuseWithoutRecordingTools()
  refuseWithoutPosixRunLifecycle()
  const rig = await openRig(label)
  const runId = generateRunId()
  const facts: SignalReport = { cell, signal, runId }
  try {
    const run = spawnRun(rig, args, runId)
    facts.reached = await untilHeld(rig.model, run.child)
    if (facts.reached !== 'held') {
      facts.output = run.output()
      return facts
    }
    facts.chromiumAtSignal = chromiumUnder(run.child.pid!)
    const signalledAt = Date.now()
    run.child.kill(signal)
    const kill = setTimeout(() => { run.child.kill('SIGKILL') }, KILL_AFTER_MS)
    try {
      facts.exit = await run.closed
    } finally {
      clearTimeout(kill)
    }
    facts.elapsedMs = Date.now() - signalledAt
    facts.walAfterExit = existsSync(`${resolveDashboardDbPath({ configDir: rig.project.root })}-wal`)
    facts.aliveAfterExit = await aliveAfter(facts.chromiumAtSignal)
    const events = loggedEvents(rig.project, runId)
    facts.events = events.map((event) => event.type)
    facts.verdict = events.find((event) => event.type === 'verdict')?.payload
    facts.row = readRow(rig.project, runId)
    facts.printed = printedRunIds(run.output()).includes(runId)
    facts.output = run.output()
    return facts
  } finally {
    report(facts)
  }
}

function expectOwnPath(facts: SignalReport): void {
  const seen = JSON.stringify({ ...facts, output: facts.output?.slice(-1_500) }, null, 2)
  expect(facts.reached, seen).toBe('held')
  expect(facts.chromiumAtSignal?.length ?? 0, `a held run with no live browser\n${seen}`).toBeGreaterThan(0)
  expect(facts.exit, seen).toEqual({ code: 130, signal: null })
  expect(facts.elapsedMs ?? Infinity, seen).toBeLessThan(OWN_PATH_BOUND_MS)
  expect(facts.events, `the run reached runFinished\n${seen}`).toContain('runFinished')
  expect(facts.verdict, seen).toMatchObject({ verdict: 'cancelled' })
  expect(facts.printed, `the run id was printed\n${seen}`).toBe(true)
  expect(facts.row?.status, seen).toBe('cancelled')
  expect(facts.row?.failureSummary, seen).not.toBe(FORCED_EXIT_SUMMARY)
  expect(facts.aliveAfterExit, `no Chromium outlived the run\n${seen}`).toEqual([])
}

afterEach(async () => {
  for (const rig of rigs.splice(0)) {
    rig.model.held.release()
    if (rig.child !== undefined && !exited(rig.child)) rig.child.kill('SIGKILL')
    await rig.model.close().catch(() => undefined)
    await rig.target.close().catch(() => undefined)
  }
}, 120_000)

afterAll(() => {
  cleanupTempRoots()
})

describe('C444-CTRL-C-OWNED', () => {
  it("one SIGINT ends a held direct run through agent-qa run's own path", async () => {
    expectOwnPath(await signalHeldRun(
      'direct SIGINT',
      '444-ctrl-c-direct-sigint',
      ['run', 'tests/populated.test.yaml'],
      'SIGINT',
    ))
  }, CELL_BUDGET_MS)

  it("one SIGINT ends a held suite run through agent-qa run's own path", async () => {
    expectOwnPath(await signalHeldRun(
      'suite SIGINT',
      '444-ctrl-c-suite-sigint',
      ['run', '--suite', 'suites/populated.suite.yaml'],
      'SIGINT',
    ))
  }, CELL_BUDGET_MS)

  it("one SIGTERM ends a held direct run through agent-qa run's own path", async () => {
    expectOwnPath(await signalHeldRun(
      'direct SIGTERM',
      '444-ctrl-c-direct-sigterm',
      ['run', 'tests/populated.test.yaml'],
      'SIGTERM',
    ))
  }, CELL_BUDGET_MS)
})
