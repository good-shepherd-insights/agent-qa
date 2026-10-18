// C444-CRASH, C444-PENDING-AT-EXIT, C444-RESUME (444-19, D-20, D-37): crash, pending-at-exit and
// retained-state resume on real `agent-qa` processes in one project, so every resume runs in the
// workspace its run left behind.

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { DRAIN_BUDGET_MS } from '@vostride/agent-qa-agent-local'
import { orphanSummary, resolveDashboardDbPath } from '@vostride/agent-qa-dashboard'
import { generateRunId, generateTestId } from '@vostride/agent-qa-ids'
import { POST_PROCESSING_SKIP_REASON_WORDS } from '@vostride/agent-qa-schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  openDashboardScene,
  printedRunIds,
  refuseWithoutRecordingTools,
  type DashboardScene,
} from './433-door-fixture.js'
import { chromiumDescendants, livePids, livePidsAfter } from './444-process-tree.js'
import {
  POPULATED_BUTTON_LABEL,
  POPULATED_FAILURE_STEP_MARKER,
  POPULATED_FAILURE_STEP_TEXT,
  POPULATED_PASSING_STEP_TEXT,
  POPULATED_SECOND_TEST_PATH,
  POPULATED_TARGET_NAME,
  populatedRunFixtureProject,
  populatedRunSpawnEnv,
  startStubModelServer,
  startTargetPageServer,
  type FixtureServer,
  type PopulatedRunProject,
  type StubModelServer,
} from './populated-run-fixture.js'
import { CLI_ENTRY, cleanupTempRoots, hermeticEnv } from './spawned-chat.js'

const LEG_BUDGET_MS = 300_000
const SPAWN_BUDGET_MS = 240_000
const HOLD_BUDGET_MS = 120_000
const BROWSER_SELF_EXIT_MS = 10_000
const POLL_MS = 50
const PENDING_BUDGET_MS = 600_000
// The stalled leg refuses its held author once the tail's budget has passed since the request
// arrived; the bound is a ceiling on that wait, never the wait itself.
const STALL_BOUND_MS = DRAIN_BUDGET_MS + 60_000
const EXIT_AFTER_REFUSAL_BOUND_MS = 30_000

// The child's execution context is resolved from the environment this file builds for it (stdio
// is piped, so never a TTY): `CI` is forwarded from this process and nothing else is.
const FORWARDED_CI = process.env.CI
const CHILD_CONTEXT = isTruthy(FORWARDED_CI) ? 'ci' : 'local-headless'

const CRASH_TEST_PATH = 'tests/444-crash.test.yaml'
const CRASH_HOLD_MARKER = 'once the operator lifts the crash hold'
const BROWSER_CLOSED_SENTENCE = 'The browser closed before this test finished.'
const PENDING_FILE = 'post-verdict-pending.json'

// D-22, `post-run-tail.ts`'s `CI_PENDING_SUFFIX` and `STAGE_DRAINER`. Outside `ci` the suffix comes
// from the drain's posture, and `detached`, `retry-scheduled` and `budget-exhausted` all map to `none`.
const CI_PENDING_SUFFIX = {
  'any-host': " (resumes only if this workspace's .agent-qa/ is kept and a later run or the daemon picks it up)",
  'masked-leg-only': " (resumes only if this workspace's .agent-qa/ is kept and a later local run picks it up)",
} as const
const STAGE_DRAINER = { analysis: 'any-host', curation: 'masked-leg-only' } as const
type Stage = keyof typeof STAGE_DRAINER
// The Completed tab's request (D-02): every finished word.
const FINISHED_WORDS = ['passed', 'healed', 'failed', 'timeout', 'cancelled'] as const

interface Envelope {
  readonly runId?: string
  readonly seq: number
  readonly ts: number
  readonly type: string
  readonly payload?: unknown
}

interface RowView {
  readonly status: string
  readonly endedAt: string | null
  readonly duration: number
  readonly failureSummary: string | null
}

interface Spawned {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

interface OverviewRead {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

interface CrashFacts {
  runId?: string
  pid?: number
  reached?: 'held' | 'ended' | 'timeout'
  eventsAtKill?: string[]
  rowAtKill?: RowView | string
  chromiumAtKill?: number[]
  exit?: { code: number | null; signal: NodeJS.Signals | null }
  chromiumSelfExit?: { boundMs: number; aliveAfterBound: number[]; goneAfterMs?: number }
  chromiumKilledByCell?: number[]
  chromiumAliveAtCellEnd?: number[]
  rowAfterKill?: RowView | string
  eventsAfterKill?: string[]
  handoffAfterKill?: boolean
  overviewBeforeCleanup?: OverviewRead
  overviewUnknownId?: OverviewRead
  rowAfterCleanup?: RowView | string
  artifactErrors?: unknown
  completed?: { status: number; runs?: Array<{ id: string; status: string }> }
  postProcessing?: { status: number; body: unknown }
  postProcessingUnknownId?: { status: number; body: unknown }
  overviewAfterCleanup?: OverviewRead
  output?: string
  error?: string
}

interface FileHash {
  readonly path: string
  readonly sha256: string
  readonly bytes: number
}

interface RunSnapshot {
  readonly label: string
  readonly runDir?: string
  readonly files: FileHash[]
  readonly pendingPreparation: boolean
  readonly eventsThroughRunFinished?: { readonly lines: number; readonly sha256: string }
  readonly row: RowView | string
}

interface JobRow {
  readonly kind: string
  readonly status: string
  readonly attempts: number
  readonly lastFailureKind: string | null
}

interface PostProcessingRead {
  readonly status: number
  readonly body: unknown
}

interface PendingLeg {
  readonly key: 'stalled' | 'detached'
  readonly runId: string
  readonly testPath: string
  readonly flags: readonly string[]
  startedAt?: number
  reached?: 'held' | 'ended' | 'timeout'
  heldAt?: number
  refuseAt?: number
  refusedAt?: number
  refused?: number
  aliveAtRefuse?: boolean
  analysisRequestsAtRefuse?: Array<{ kind: string; status: number }>
  exitedAt?: number
  exit?: { code: number | null; signal: NodeJS.Signals | null }
  exitLines?: string[]
  exitLineStreams?: string[]
  printed?: boolean
  recordedVerdict?: unknown
  analysisRequestsAtExit?: Array<{ kind: string; status: number }>
  jobsAtExit?: JobRow[] | string
  atExit?: RunSnapshot
  postProcessingAtExit?: PostProcessingRead
  output?: string
  error?: string
}

interface Shared {
  readonly project: PopulatedRunProject
  readonly model: StubModelServer
  readonly target: FixtureServer
}

let shared: Shared | undefined
const children: ChildProcess[] = []
const scenes: DashboardScene[] = []
const strayChromium = new Set<number>()

function isTruthy(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized !== undefined && normalized !== '' && normalized !== '0' && normalized !== 'false'
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// One project for every leg: the failing step drives analysis, the passing step a passed run, and
// the crash test's step carries the marker the stub parks.
async function sharedProject(): Promise<Shared> {
  if (shared !== undefined) return shared
  const target = await startTargetPageServer()
  const model = await startStubModelServer({
    plannerOutcome: 'stepFailed',
    failOnlyStepText: POPULATED_FAILURE_STEP_MARKER,
    holdOnlyStepText: CRASH_HOLD_MARKER,
    holdAnalysis: true,
  })
  const project = populatedRunFixtureProject('444-crash-pending-resume', {
    modelBaseUrl: model.baseUrl,
    targetUrl: target.url,
  }, { stepText: POPULATED_FAILURE_STEP_TEXT, secondStepText: POPULATED_PASSING_STEP_TEXT })
  writeFileSync(
    join(project.root, CRASH_TEST_PATH),
    'name: The crash probe\n'
    + `test-id: ${generateTestId()}\n`
    + `target: ${POPULATED_TARGET_NAME}\n`
    + 'steps:\n'
    + `  - Click the ${POPULATED_BUTTON_LABEL} button ${CRASH_HOLD_MARKER}.\n`,
    'utf8',
  )
  shared = { project, model, target }
  return shared
}

function childEnv(project: PopulatedRunProject, runId?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...hermeticEnv(project.root),
    ...populatedRunSpawnEnv(),
    ...(FORWARDED_CI === undefined ? {} : { CI: FORWARDED_CI }),
    NO_COLOR: '1',
    DO_NOT_TRACK: '1',
  }
  if (runId !== undefined) env.AGENT_QA_RUN_ID = runId
  return env
}

function startCli(project: PopulatedRunProject, args: readonly string[], runId?: string): {
  readonly child: ChildProcess
  readonly closed: Promise<Spawned>
} {
  const child = spawn(process.execPath, [CLI_ENTRY, '--config', project.configPath, ...args], {
    cwd: project.root,
    env: childEnv(project, runId),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  const budget = setTimeout(() => { child.kill('SIGKILL') }, SPAWN_BUDGET_MS)
  const closed = new Promise<Spawned>((settle, fail) => {
    child.once('error', fail)
    child.once('close', (code, signal) => {
      clearTimeout(budget)
      settle({ code, signal, stdout, stderr })
    })
  })
  return { child, closed }
}

async function cli(project: PopulatedRunProject, args: readonly string[], runId?: string): Promise<Spawned> {
  return startCli(project, args, runId).closed
}

function exited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

function runDirOf(project: PopulatedRunProject, runId: string): string | undefined {
  const runs = join(project.agentQaRoot, 'runs')
  if (!existsSync(runs)) return undefined
  for (const entry of readdirSync(runs, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const log = join(runs, entry.name, 'events.jsonl')
    if (!existsSync(log)) continue
    const first = readFileSync(log, 'utf8').split('\n').find((line) => line.trim() !== '')
    if (first !== undefined && (JSON.parse(first) as Envelope).runId === runId) return join(runs, entry.name)
  }
  return undefined
}

function loggedEvents(project: PopulatedRunProject, runId: string): Envelope[] {
  const dir = runDirOf(project, runId)
  if (dir === undefined) return []
  return readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').filter((line) => line.trim() !== '')
    .flatMap((line) => {
      try { return [JSON.parse(line) as Envelope] } catch { return [] }
    })
}

// A run may still be writing runs.db from another process; the read waits out its write lock, and
// one that still fails is recorded as unreadable, which no cell accepts as a row (444-17).
function readRow(project: PopulatedRunProject, runId: string): RowView | string {
  const dbPath = resolveDashboardDbPath({ configDir: project.root })
  if (!existsSync(dbPath)) return 'absent: no runs.db'
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5_000 })
    try {
      const row = db.prepare('SELECT status, ended_at, duration, failure_summary FROM runs WHERE id = ?')
        .get(runId) as
        | { status: string; ended_at: string | null; duration: number; failure_summary: string | null }
        | undefined
      return row === undefined
        ? 'absent: no row'
        : { status: row.status, endedAt: row.ended_at, duration: row.duration, failureSummary: row.failure_summary }
    } finally {
      db.close()
    }
  } catch (error) {
    return `unreadable: ${message(error)}`
  }
}

async function overview(project: PopulatedRunProject, runId: string): Promise<OverviewRead> {
  const read = await cli(project, ['runs', 'overview', runId])
  return { code: read.code, stdout: read.stdout, stderr: read.stderr.trim() }
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

function listFiles(dir: string, prefix = ''): FileHash[] {
  const files: FileHash[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort(byName)) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFiles(full, path))
    } else if (entry.isFile()) {
      const bytes = readFileSync(full)
      files.push({ path, sha256: sha256(bytes), bytes: bytes.length })
    } else {
      files.push({ path, sha256: 'not a regular file', bytes: -1 })
    }
  }
  return files
}

function eventsThroughRunFinished(dir: string): RunSnapshot['eventsThroughRunFinished'] {
  const lines = readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n')
  const index = lines.findIndex((line) => {
    try { return (JSON.parse(line) as Envelope).type === 'runFinished' } catch { return false }
  })
  if (index < 0) return undefined
  return { lines: index + 1, sha256: sha256(`${lines.slice(0, index + 1).join('\n')}\n`) }
}

// Every file under the run's directory with its sha256, the log through `runFinished` and the
// row; whether preparation was still pending is read beside them (D-37's precondition).
function snapshotRun(project: PopulatedRunProject, runId: string, label: string): RunSnapshot {
  const dir = runDirOf(project, runId)
  if (dir === undefined) return { label, files: [], pendingPreparation: false, row: readRow(project, runId) }
  return {
    label,
    runDir: dir.slice(project.agentQaRoot.length + 1),
    files: listFiles(dir),
    pendingPreparation: existsSync(join(dir, PENDING_FILE)),
    eventsThroughRunFinished: eventsThroughRunFinished(dir),
    row: readRow(project, runId),
  }
}

function jobRows(project: PopulatedRunProject, runId: string): JobRow[] | string {
  const path = join(project.agentQaRoot, 'agent-jobs.db')
  if (!existsSync(path)) return 'absent: no agent-jobs.db'
  try {
    const db = new DatabaseSync(path, { readOnly: true, timeout: 5_000 })
    try {
      const rows = db.prepare(
        `SELECT kind, status, attempts, last_failure_kind FROM jobs
         WHERE json_extract(payload, '$.runId') = ? ORDER BY created_at, kind`,
      ).all(runId) as Array<{ kind: string; status: string; attempts: number; last_failure_kind: string | null }>
      return rows.map((row) => ({
        kind: row.kind,
        status: row.status,
        attempts: Number(row.attempts),
        lastFailureKind: row.last_failure_kind,
      }))
    } finally {
      db.close()
    }
  } catch (error) {
    return `unreadable: ${message(error)}`
  }
}

function analysisRequests(model: StubModelServer, from: number): Array<{ kind: string; status: number }> {
  return model.requests.slice(from)
    .filter((request) => request.kind === 'held-analysis' || request.kind === 'analysis')
    .map(({ kind, status }) => ({ kind, status }))
}

async function postProcessingReads(
  project: PopulatedRunProject,
  runIds: readonly string[],
): Promise<PostProcessingRead[]> {
  const scene = await openDashboardScene(project)
  scenes.push(scene)
  try {
    const reads: PostProcessingRead[] = []
    for (const runId of runIds) {
      reads.push(await getJson(`${scene.origin}/api/runs/${encodeURIComponent(runId)}/post-processing`))
    }
    return reads
  } finally {
    await scene.close()
  }
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url)
  const text = await response.text()
  try {
    return { status: response.status, body: JSON.parse(text) as unknown }
  } catch {
    return { status: response.status, body: text }
  }
}

async function untilHeld(model: StubModelServer, already: number, ended: () => boolean): Promise<'held' | 'ended' | 'timeout'> {
  const deadline = Date.now() + HOLD_BUDGET_MS
  for (;;) {
    if (model.held.count() > already) return 'held'
    if (ended()) return 'ended'
    if (Date.now() >= deadline) return 'timeout'
    await new Promise((tick) => setTimeout(tick, POLL_MS))
  }
}

// A SIGKILLed CLI cannot close its browser. Whether Chromium leaves on its own (its pipe closed) is
// measured within a bound and recorded; whatever is left is killed here, so none outlives the cell.
async function measureChromiumAfterKill(facts: CrashFacts): Promise<void> {
  const pids = facts.chromiumAtKill ?? []
  const killedAt = Date.now()
  const alive = await livePidsAfter(pids, BROWSER_SELF_EXIT_MS)
  facts.chromiumSelfExit = {
    boundMs: BROWSER_SELF_EXIT_MS,
    aliveAfterBound: alive,
    ...(alive.length === 0 ? { goneAfterMs: Date.now() - killedAt } : {}),
  }
  for (const pid of alive) {
    strayChromium.add(pid)
    try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
  }
  facts.chromiumKilledByCell = alive
  facts.chromiumAliveAtCellEnd = await livePidsAfter(pids, 5_000)
}

const crash: CrashFacts = {}

async function driveCrash(): Promise<void> {
  const { project, model } = await sharedProject()
  const runId = generateRunId()
  crash.runId = runId
  const held = model.held.count()
  const run = startCli(project, ['run', CRASH_TEST_PATH], runId)
  crash.pid = run.child.pid
  crash.reached = await untilHeld(model, held, () => exited(run.child))
  if (crash.reached !== 'held') {
    const ended = await run.closed
    crash.output = `${ended.stdout}\n${ended.stderr}`.slice(-2_000)
    return
  }
  crash.eventsAtKill = loggedEvents(project, runId).map((event) => event.type)
  crash.rowAtKill = readRow(project, runId)
  crash.chromiumAtKill = chromiumDescendants(run.child.pid!)
  run.child.kill('SIGKILL')
  const ended = await run.closed
  crash.exit = { code: ended.code, signal: ended.signal }
  crash.output = `${ended.stdout}\n${ended.stderr}`.slice(-2_000)
  await measureChromiumAfterKill(crash)

  crash.rowAfterKill = readRow(project, runId)
  crash.eventsAfterKill = loggedEvents(project, runId).map((event) => event.type)
  const dir = runDirOf(project, runId)
  crash.handoffAfterKill = dir !== undefined && existsSync(join(dir, 'handoff.json'))
  // The CLI host's reader before any cleanup: an in-flight row, and an id with no row at all.
  crash.overviewBeforeCleanup = await overview(project, runId)
  crash.overviewUnknownId = await overview(project, generateRunId())

  // Starting the dashboard runs 442's orphan cleanup over the project's runs.db.
  const scene = await openDashboardScene(project)
  scenes.push(scene)
  try {
    crash.rowAfterCleanup = readRow(project, runId)
    crash.artifactErrors = scene.db.getRunArtifact(runId)?.payload.errors
    const query = FINISHED_WORDS.map((word) => `status=${word}`).join('&')
    const completed = await getJson(`${scene.origin}/api/runs?${query}&limit=500`)
    crash.completed = {
      status: completed.status,
      runs: ((completed.body as { runs?: Array<{ id: string; status: string }> }).runs ?? [])
        .map(({ id, status }) => ({ id, status })),
    }
    crash.postProcessing = await getJson(`${scene.origin}/api/runs/${encodeURIComponent(runId)}/post-processing`)
    crash.postProcessingUnknownId = await getJson(
      `${scene.origin}/api/runs/${encodeURIComponent(generateRunId())}/post-processing`,
    )
  } finally {
    await scene.close()
  }
  crash.overviewAfterCleanup = await overview(project, runId)
}

const pending: { stalled?: PendingLeg; detached?: PendingLeg; error?: string } = {}

function pendingLeg(key: PendingLeg['key'], testPath: string, flags: readonly string[]): PendingLeg {
  return { key, runId: generateRunId(), testPath, flags }
}

function readExit(project: PopulatedRunProject, leg: PendingLeg, ended: Spawned): void {
  leg.exit = { code: ended.code, signal: ended.signal }
  const exitLine = (line: string): boolean => line.startsWith('post-processing — ')
  leg.exitLines = [...ended.stdout.split('\n'), ...ended.stderr.split('\n')].filter(exitLine)
  leg.exitLineStreams = [
    ...ended.stdout.split('\n').filter(exitLine).map(() => 'stdout'),
    ...ended.stderr.split('\n').filter(exitLine).map(() => 'stderr'),
  ]
  const output = `${ended.stdout}\n${ended.stderr}`
  leg.printed = printedRunIds(output).includes(leg.runId)
  leg.recordedVerdict = loggedEvents(project, leg.runId).find((event) => event.type === 'verdict')?.payload
  leg.jobsAtExit = jobRows(project, leg.runId)
  leg.atExit = snapshotRun(project, leg.runId, 'at exit')
  leg.output = output.slice(-3_000)
}

// D-56: a failed run whose analyze-run author is held. Once the tail's budget has passed since the
// request arrived, the request is refused; attempt 1 becomes a retry and the tail starts nothing more.
async function driveStalled(): Promise<void> {
  const { project, model } = await sharedProject()
  const leg = pendingLeg('stalled', project.testPath, [])
  pending.stalled = leg
  const held = model.held.count()
  const fromRequest = model.requests.length
  leg.startedAt = Date.now()
  const run = startCli(project, ['run', leg.testPath, ...leg.flags], leg.runId)
  leg.reached = await untilHeld(model, held, () => exited(run.child))
  if (leg.reached !== 'held') {
    readExit(project, leg, await run.closed)
    return
  }
  leg.heldAt = model.requests.slice(fromRequest).filter((request) => request.kind === 'held-analysis').at(-1)?.at
  if (leg.heldAt === undefined) throw new Error('the held turn is not the analyze-run author')
  leg.refuseAt = leg.heldAt + DRAIN_BUDGET_MS
  while (Date.now() <= leg.refuseAt) {
    if (exited(run.child)) break
    if (Date.now() >= leg.heldAt + STALL_BOUND_MS) throw new Error('the stall bound passed before the refusal')
    await new Promise((tick) => setTimeout(tick, 25))
  }
  leg.aliveAtRefuse = !exited(run.child)
  leg.analysisRequestsAtRefuse = analysisRequests(model, fromRequest)
  leg.refusedAt = Date.now()
  leg.refused = model.held.refuse()
  const ended = await run.closed
  leg.exitedAt = Date.now()
  leg.analysisRequestsAtExit = analysisRequests(model, fromRequest)
  readExit(project, leg, ended)
  ;[leg.postProcessingAtExit] = await postProcessingReads(project, [leg.runId])
}

async function driveDetached(): Promise<void> {
  const { project, model } = await sharedProject()
  const leg = pendingLeg('detached', POPULATED_SECOND_TEST_PATH, ['--detach'])
  pending.detached = leg
  const fromRequest = model.requests.length
  leg.startedAt = Date.now()
  const ended = await cli(project, ['run', leg.testPath, ...leg.flags], leg.runId)
  leg.exitedAt = Date.now()
  leg.analysisRequestsAtExit = analysisRequests(model, fromRequest)
  readExit(project, leg, ended)
  ;[leg.postProcessingAtExit] = await postProcessingReads(project, [leg.runId])
}

function pendingWord(stage: Stage): string {
  return `pending${CHILD_CONTEXT === 'ci' ? CI_PENDING_SUFFIX[STAGE_DRAINER[stage]] : ''}`
}

function stageWords(line: string | undefined): { analysis?: string; curation?: string } {
  return {
    analysis: /analysis: ([a-z-]+)/u.exec(line ?? '')?.[1],
    curation: /curation: ([a-z-]+)/u.exec(line ?? '')?.[1],
  }
}

function chipsOf(read: PostProcessingRead | undefined): unknown {
  return (read?.body as { status?: { chips?: unknown } } | undefined)?.status?.chips
}

function hasSkipped(read: PostProcessingRead | undefined): boolean {
  const status = (read?.body as { status?: Record<string, unknown> } | undefined)?.status
  return status !== undefined && 'skipped' in status
}

function expectPendingAtExit(leg: PendingLeg | undefined, verdict: 'passed' | 'failed', at: string): PendingLeg {
  expect(pending.error, at).toBeUndefined()
  expect(leg, at).toBeDefined()
  const run = leg as PendingLeg
  expect(run.error, at).toBeUndefined()
  expect(run.recordedVerdict, `${run.key}'s verdict\n${at}`).toEqual({ verdict })
  expect(run.exit, `${run.key} exits with its verdict's code\n${at}`)
    .toEqual({ code: verdict === 'passed' ? 0 : 1, signal: null })
  expect(run.printed, `${run.key}'s run id was printed\n${at}`).toBe(true)
  expect(run.exitLines?.length, `${run.key}'s one exit line\n${at}`).toBe(1)
  expect(run.exitLines?.[0]?.startsWith(
    `post-processing — analysis: ${pendingWord('analysis')} · curation: ${pendingWord('curation')} · `,
  ), `${run.key}'s exit line (${CHILD_CONTEXT})\n${at}`).toBe(true)
  expect(run.postProcessingAtExit?.status, at).toBe(200)
  expect(hasSkipped(run.postProcessingAtExit), `${run.key} has no skipped fact\n${at}`).toBe(false)
  return run
}

function seen(facts: unknown): string {
  return JSON.stringify(facts, null, 2)
}

function expectCrashDrove(): string {
  const at = seen(crash)
  expect(crash.error, at).toBeUndefined()
  expect(crash.reached, `the run was parked inside its step\n${at}`).toBe('held')
  return at
}

function rowOf(value: RowView | string | undefined, at: string): RowView {
  expect(typeof value, `a readable row\n${at}`).toBe('object')
  return value as RowView
}

afterAll(async () => {
  shared?.model.held.release()
  for (const child of children) if (!exited(child)) child.kill('SIGKILL')
  for (const scene of scenes.splice(0)) await scene.close().catch(() => undefined)
  for (const pid of livePids([...strayChromium])) {
    try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
  }
  await shared?.model.close().catch(() => undefined)
  await shared?.target.close().catch(() => undefined)
  cleanupTempRoots()
}, 120_000)

describe('C444-CRASH', () => {
  beforeAll(async () => {
    refuseWithoutRecordingTools()
    if (process.platform === 'win32') throw new Error('POSIX run lifecycle required; never skip')
    try {
      await driveCrash()
    } catch (error) {
      crash.error = message(error)
    }
    console.info(`C444-CRASH (${CHILD_CONTEXT}): ${JSON.stringify(crash)}`)
  }, LEG_BUDGET_MS)

  it("a killed run's row stays running until a starting dashboard finalizes it failed", () => {
    const at = expectCrashDrove()
    expect(crash.eventsAtKill, `the run was inside its step at the kill\n${at}`).toContain('stepStarted')
    expect(crash.eventsAtKill, `the run had no verdict at the kill\n${at}`).not.toContain('verdict')
    expect(rowOf(crash.rowAtKill, at).status, at).toBe('running')
    expect(crash.chromiumAtKill?.length ?? 0, `a parked run with a live browser\n${at}`).toBeGreaterThan(0)
    expect(crash.exit, `SIGKILL ended the run's own process\n${at}`).toEqual({ code: null, signal: 'SIGKILL' })
    expect(crash.chromiumAliveAtCellEnd, `no Chromium from the run outlives the cell\n${at}`).toEqual([])

    const afterKill = rowOf(crash.rowAfterKill, at)
    expect(afterKill, `nothing wrote the row after the kill\n${at}`).toEqual(crash.rowAtKill)
    expect(afterKill, at).toMatchObject({ status: 'running', failureSummary: null })
    expect(crash.eventsAfterKill, at).not.toContain('verdict')
    expect(crash.eventsAfterKill, at).not.toContain('runFinished')
    expect(crash.handoffAfterKill, at).toBe(false)

    const closed = rowOf(crash.rowAfterCleanup, at)
    expect(closed.status, at).toBe('failed')
    expect(closed.failureSummary, `442 D-04's orphan sentence\n${at}`).toBe(orphanSummary(crash.pid!))
    expect(closed.failureSummary, `no browser-closed guess (D-53)\n${at}`).not.toBe(BROWSER_CLOSED_SENTENCE)
    expect(Date.parse(closed.endedAt ?? ''), `the cleanup wrote its own end time\n${at}`)
      .toBeGreaterThan(Date.parse(afterKill.endedAt ?? ''))
    expect(crash.artifactErrors, at).toEqual([
      { code: 'owner-gone', phase: 'orphan-cleanup', message: orphanSummary(crash.pid!) },
    ])
  })

  it('the finalized run is in the Completed request', () => {
    const at = expectCrashDrove()
    expect(crash.completed?.status, at).toBe(200)
    const listed = crash.completed?.runs ?? []
    expect(listed.length, `the Completed request lists something\n${at}`).toBeGreaterThan(0)
    expect(listed.filter((run) => run.id === crash.runId), at).toEqual([{ id: crash.runId, status: 'failed' }])
    for (const run of listed) expect(FINISHED_WORDS, at).toContain(run.status)
  })

  it("the finalized run's post-processing reads skipped (no verdict)", () => {
    const at = expectCrashDrove()
    expect(crash.postProcessing?.status, at).toBe(200)
    const status = (crash.postProcessing?.body as { status?: { skipped?: { reason?: string } } }).status
    // The fact is derived only from a bound `readRecord` that found the closed row (D-14); an
    // unknown id on the same dashboard derives none, so the reader answered for this row.
    expect(status?.skipped, at).toEqual({ reason: 'no-verdict' })
    expect(`skipped (${POST_PROCESSING_SKIP_REASON_WORDS[status!.skipped!.reason as 'no-verdict']})`, at)
      .toBe('skipped (no verdict)')
    const unknown = (crash.postProcessingUnknownId?.body as { status?: Record<string, unknown> } | undefined)?.status
    expect(crash.postProcessingUnknownId?.status, at).toBe(200)
    expect(unknown !== undefined && 'skipped' in unknown, `an unknown id derives no skipped fact\n${at}`).toBe(false)
  })

  it('agent-qa runs overview answers that the run ended before a verdict', () => {
    const at = expectCrashDrove()
    const runId = crash.runId!
    // Before the cleanup the CLI host's reader saw the row running, and an id with no row is still
    // not found: the reader is bound and answers by the row.
    expect(crash.overviewBeforeCleanup, at).toEqual({
      code: 1,
      stdout: '',
      stderr: `agent-qa runs overview: Run ${runId} has not reached a verdict yet.`,
    })
    expect(crash.overviewUnknownId?.code, at).toBe(1)
    expect(crash.overviewUnknownId?.stderr, at).toContain('No completed run recorded for id:')
    expect(crash.overviewAfterCleanup, at).toEqual({
      code: 1,
      stdout: '',
      stderr: `agent-qa runs overview: Run ${runId} ended before it reached a verdict. Its record is in the dashboard.`,
    })
  })
})

describe('C444-PENDING-AT-EXIT', () => {
  beforeAll(async () => {
    refuseWithoutRecordingTools()
    if (process.platform === 'win32') throw new Error('POSIX run lifecycle required; never skip')
    try {
      await driveStalled()
      await driveDetached()
    } catch (error) {
      pending.error = message(error)
    }
    console.info(`C444-PENDING-AT-EXIT (${CHILD_CONTEXT}): ${JSON.stringify(pending)}`)
  }, PENDING_BUDGET_MS)

  it("a stalled drainer's run exits with its verdict's code and reports its stages as durable state does", () => {
    const at = seen(pending)
    const run = expectPendingAtExit(pending.stalled, 'failed', at)
    expect(run.reached, `the analyze-run author was held\n${at}`).toBe('held')
    // The refusal came only once the tail's budget had passed since the request arrived, with the
    // run still waiting on it.
    expect(run.aliveAtRefuse, at).toBe(true)
    expect(run.refusedAt! > run.heldAt! + DRAIN_BUDGET_MS, at).toBe(true)
    expect(run.analysisRequestsAtRefuse, at).toEqual([{ kind: 'held-analysis', status: 0 }])
    expect(run.refused, `exactly the held author was refused\n${at}`).toBe(1)
    // Attempt 1 became a retry and the tail started nothing more: one refused request, and the
    // run left promptly.
    expect(run.analysisRequestsAtExit, at).toEqual([{ kind: 'held-analysis', status: 0 }, { kind: 'analysis', status: 400 }])
    expect(run.exitedAt! - run.refusedAt!, at).toBeLessThan(EXIT_AFTER_REFUSAL_BOUND_MS)
    expect(Array.isArray(run.jobsAtExit), at).toBe(true)
    expect((run.jobsAtExit as JobRow[]).filter((job) => job.kind === 'analyze-run'), at).toEqual([
      { kind: 'analyze-run', status: 'queued', attempts: 1, lastFailureKind: 'retry' },
    ])
    // The CLI line's words are the dashboard's post-exit read, and neither is a finished word.
    const words = stageWords(run.exitLines?.[0])
    expect(chipsOf(run.postProcessingAtExit), at).toEqual(words)
    for (const word of [words.analysis, words.curation]) {
      expect(['complete', 'failed'], at).not.toContain(word)
    }
    expect(words, at).toEqual({ analysis: 'pending', curation: 'pending' })
  })

  it('a detached run exits with its verdict\'s code and reads pending on the CLI and the dashboard', () => {
    const at = seen(pending)
    const run = expectPendingAtExit(pending.detached, 'passed', at)
    expect(run.analysisRequestsAtExit, `a detached run spends nothing on its chain\n${at}`).toEqual([])
    expect(chipsOf(run.postProcessingAtExit), at).toEqual({ analysis: 'pending', curation: 'pending' })
    expect(Array.isArray(run.jobsAtExit), at).toBe(true)
    expect((run.jobsAtExit as JobRow[]).filter((job) => job.kind === 'analyze-run'), at).toEqual([
      { kind: 'analyze-run', status: 'queued', attempts: 0, lastFailureKind: null },
    ])
  })

  it('neither run left preparation pending at exit', () => {
    const at = seen(pending)
    expect(pending.error, at).toBeUndefined()
    for (const run of [pending.stalled, pending.detached]) {
      expect(run?.atExit?.runDir, at).toBeDefined()
      expect(run?.atExit?.pendingPreparation, `${run?.key}: ${PENDING_FILE} absent at exit\n${at}`).toBe(false)
      expect(run?.atExit?.files.map((file) => file.path), at).not.toContain(PENDING_FILE)
      expect(run?.atExit?.files.map((file) => file.path), at).toContain('handoff.json')
    }
  })
})
