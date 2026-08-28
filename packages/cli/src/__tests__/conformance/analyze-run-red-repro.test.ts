// WHAT `analyze-run` ACTUALLY THROWS ON A RED RUN — THE MEASUREMENT, NOT THE FIX (406-02 · D-13).
//
// THIS FILE ENCODES A DEFECT'S SIGNATURE AND IS EXPECTED GREEN WHILE THE DEFECT EXISTS. Every cell
// below asserts that `analyze-run` FAILS on a run it exists to explain. That is the opposite of an
// acceptance cell, and it is deliberate: `399-friction-analyze-run-fails-on-red` recorded a
// signature (~1 ms attempts, `handlerInvoked: true`, `checkpointsPublished: 0`, 0/4 on red) with no
// stack and no error body, and a fix written against a signature fixes whatever its author guessed.
// 406-07 owns the fix and DELETES this file the moment its change inverts these assertions; the
// acceptance for that fix is 406-10's `failure-view-dom.test.ts`, never this one.
//
// WHY IT HAS TO BE THE SHIPPED BINARY. RESEARCH measured the pure `packages/agent` handler
// completing in ~40 ms over the real 399 handoff with benign capabilities — so the throw is not in
// the handler. It lives in a HOST-BOUND seam reached only on the author path: `readTestHistory`
// (C1, a read-only SQLite open under the knowledge root), `readEvidenceBlob` (C2, the evidence
// store's non-ENOENT rethrow), or the provider adapter's prelude and call (C3). Only the
// dashboard's in-process post-run pump and the shipped `agent-qa daemon` bind those three; the jiti
// `daemon.fixture.ts` binds a DEGRADING STUB model and cannot reach C3 at all. This file therefore
// drives the real `agent-qa dashboard`, over 405-09's stub `openai-compatible` server, and reads
// what the engine wrote to `jobs.last_failure_reason` — the one place the real text survives
// (`agent/src/jobs/engine.ts` builds `handler-threw: <message>` and hands it to `recordFailure`).
//
// TWO ARMS, IN ONE PROJECT, AND THE SECOND IS WHAT SEEDS C1. `readProjectedTestHistory` returns
// `undefined` without opening anything when `indexDbPath(knowledgeRoot)` is absent, and in a fresh
// fixture project it IS absent until the first run's CURATION writes it — curation runs after
// analysis, so arm A's `analyze-run` cannot have reached C1. Arm B drives a second failing run in
// the same project, by which time the index exists, and is therefore the first arm on which C1 is
// reachable at all. Each arm records the index's presence at its own drive time rather than
// asserting it, so a red names which seams the run it measured could possibly have touched.
//
// A BROWSER THAT CANNOT LAUNCH IS A RED, NEVER A SKIP — 404-08's law, carried verbatim from
// `run-detail-failure-dom.test.ts`. There is no conditional skip here. A suite that exits 0 having
// measured nothing is indistinguishable from one that measured everything, and what this file
// measures is whether the product's explanation step works at all.
//
// THE DRIVES HAPPEN ONCE, IN `beforeAll`, AND RECORD WITHOUT ASSERTING. The cells read what they
// recorded, off whichever arm reproduced the throw — or, when none did, off the last arm run, with
// the whole ladder printed. (r4) exists so the measurement reaches the vitest output whichever way
// the others go: it prints every arm's row and the stub's request trail in its own failure message.

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { slugBranch } from '@vostride/agent-qa-schema'
import { readDaemonEventLedger } from '../../daemon/events.js'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  POPULATED_FAILURE_STEP_TEXT,
  POPULATED_RUN_ANCHORED_BUILDS,
  RUN_BUDGET_MS,
  drivePopulatedRun,
  populatedRunFixtureProject,
  populatedRunSpawnEnv,
  startStubModelServer,
  startTargetPageServer,
} from './populated-run-fixture.js'
import type {
  FixtureServer,
  PopulatedRunProject,
  StubModelServer,
} from './populated-run-fixture.js'
import {
  CLI_ENTRY,
  buildFreshness,
  cleanupTempRoots,
  hermeticEnv,
  reserveEphemeralPort,
  spawnCollecting,
  spawnDashboard,
} from './spawned-chat.js'
import type { SpawnedDashboard } from './spawned-chat.js'

// NO PLATFORM SKIP — `run-detail-failure-dom.test.ts`'s refusal, applied to the same class of drive.
const WINDOWS_REFUSAL =
  'the spawned-binary cells in this directory are POSIX-only: the dashboard child is stopped with '
  + 'SIGTERM and the run writes a POSIX runtime root. This file reds rather than skipping on '
  + 'Windows, because a suite that exits 0 having measured nothing is indistinguishable from one '
  + 'that measured everything.'

const REBUILD_INSTRUCTION =
  'these cells drive the BUILT `agent-qa dashboard` and the built packages it resolves as external '
  + 'workspace dependencies: run `pnpm turbo run build --force` from the agent-qa root first. '
  + '`--force` is required — a mutation script restores its subjects byte-identically, which turbo '
  + 'treats as a cache hit, so a plain build reports FULL TURBO and refreshes no dist mtime.'

const BROWSER_INSTALL_INSTRUCTION =
  'these cells drive REAL runs in a real Chromium so the real `analyze-run` handler is entered '
  + 'with the real host capabilities and the real provider adapter: run '
  + '`pnpm exec playwright install chromium` and re-run. THEY MUST NOT BE SKIPPED WHEN THE BROWSER '
  + 'IS ABSENT — this is the only measurement of the 399 defect that exists, and a skip would '
  + 'leave 406-07 fixing a hypothesis.'

/**
 * The job store's file name under the agent-qa root.
 *
 * Spelled here rather than imported because `AGENT_JOB_STORE_DB_FILE` is internal to
 * `agent-local/src/store/sqlite-job-store.ts` and not on that package's barrel. A drift makes this
 * file's poll find nothing, which reds (r2) with the row absent — never a silent pass.
 */
const AGENT_JOB_STORE_DB_FILE = 'agent-jobs.db'

/** The busy-retry window the store itself opens with, restated for a READ-ONLY companion open. */
const JOB_STORE_BUSY_TIMEOUT_MS = 2_000

/** How long the in-process post-run pump is given to claim, run and land one `analyze-run` job. */
const PUMP_BUDGET_MS = 90_000

/** How long the detached post-run tail is given before the dashboard is stopped. */
const TAIL_GRACE_MS = 2_000

/** The `jobs` row this file exists to read, as the cells consume it. */
interface AnalyzeRunRow {
  readonly id: string
  readonly status: string
  readonly attempts: number
  readonly lastFailureKind: string | null
  readonly lastFailureReason: string | null
}

/** The floor member's classification, read out of the run's own handoff. */
interface RecordedRootCause {
  readonly class?: unknown
  readonly producer?: unknown
  readonly confidence?: unknown
}

/** Everything one rung of the ladder measured. The note transcribes this table verbatim. */
interface ArmRecord {
  readonly arm: string
  readonly what: string
  runId?: string
  /** C1's precondition, read at THIS arm's drive time: does a knowledge index db exist yet. */
  knowledgeIndexPresent?: boolean
  row?: AnalyzeRunRow
  rowPollNote?: string
  rootCause?: RecordedRootCause
  analysisJsonPresent?: boolean
  /** C2's precondition: how many decision-screenshot refs the handoff carried, and blobs on disk. */
  screenshotRefs?: number
  blobs?: number
  /** C3's evidence: the stub request kinds THIS arm added. `text` is an author call. */
  stubRequestKinds?: readonly string[]
  chips?: Record<string, string>
  eventTypes?: readonly string[]
  analysisFailedError?: string
  /**
   * The daemon ledger's own `job-claimed`/`job-completed` rows FOR THIS RUN.
   *
   * Attributable at all only because Task 1 of this plan put `runId` on both kinds (D-16) — the
   * substrate gap `399-friction-daemon-events-no-runid` filed beside the defect, used here for the
   * first time to say which host drained which run without correlating sub-second timestamps.
   */
  daemonJobEvents?: readonly Record<string, unknown>[]
}

const recorded: {
  failure?: string
  browserPresent?: boolean
  jobStoreUserVersion?: number
  dashboardStderr?: string
  daemonNote?: string
  daemonStderr?: string
  knowledgeDbFiles?: readonly string[]
  readonly arms: ArmRecord[]
} = { arms: [] }

let targetServer: FixtureServer | undefined
let stubServer: StubModelServer | undefined
let dashboard: (SpawnedDashboard & { readonly ready: boolean }) | undefined
let daemonChild: ChildProcess | undefined
let daemonStderr = ''

/**
 * Start the SHIPPED `agent-qa daemon` over a project and wait for its own status to say `running`.
 *
 * The readiness is the command's OWN answer (`daemon status --json`), never a sleep and never a
 * poll of a file this test picked: a sleep would be a number somebody guessed and a file check
 * would go green against a registration the host wrote before it opened its queues.
 */
async function startShippedDaemon(project: PopulatedRunProject): Promise<boolean> {
  // `TMPDIR` IS PUT BACK, AND ONLY FOR THIS CHILD. `hermeticEnv` points it INTO the fixture project
  // so nothing the child writes escapes the directory cleanup deletes — right for the dashboard,
  // fatal here: the daemon mints its control socket under `TMPDIR`, and a unix socket path is
  // bounded at 104 bytes, so the nested fixture root makes the shipped binary refuse to start with
  // "OS temporary directory is too deep for an agent-qa daemon socket". That refusal is a property
  // of where the fixture puts its root, not of the code under measurement, and letting it stand
  // would have recorded "the daemon did not run" as if it were evidence about `analyze-run`.
  const child = spawn(process.execPath, [CLI_ENTRY, '--config', project.configPath, 'daemon'], {
    cwd: project.root,
    env: { ...hermeticEnv(project.root), TMPDIR: tmpdir() },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  daemonChild = child
  child.stderr?.on('data', (chunk: Buffer) => { daemonStderr += chunk.toString('utf8') })
  child.stdout?.on('data', (chunk: Buffer) => { daemonStderr += chunk.toString('utf8') })

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const status = await spawnCollecting(
      project.root,
      [CLI_ENTRY, '--config', project.configPath, 'daemon', 'status', '--json'],
      { TMPDIR: tmpdir() },
    )
    if (status.stdout.includes('"state":"running"')) return true
    await new Promise<void>((tick) => { setTimeout(tick, 500) })
  }
  return false
}

/**
 * The `analyze-run` row for ONE run, or `undefined` while it does not exist.
 *
 * READ-ONLY AND OVER A SEPARATE CONNECTION, the `post-processing-reader.ts` idiom: the dashboard
 * process owns the writer and this poll must never take its lock. The `PRAGMA user_version` read is
 * kept because a database another build stamped is bytes this reader cannot interpret, and a poll
 * that answered "no row" from one would be indistinguishable from a job that was never enqueued.
 * Keyed on the PAYLOAD's runId rather than on recency, because arm B leaves two rows behind and a
 * measurement attributed to the wrong run is worse than no measurement.
 */
function readAnalyzeRunRow(agentQaRoot: string, runId: string): AnalyzeRunRow | undefined {
  const path = join(agentQaRoot, AGENT_JOB_STORE_DB_FILE)
  if (!existsSync(path)) return undefined
  const db = new DatabaseSync(path, { readOnly: true, timeout: JOB_STORE_BUSY_TIMEOUT_MS })
  try {
    const stamp = db.prepare('PRAGMA user_version').get() as { user_version?: unknown } | undefined
    recorded.jobStoreUserVersion = Number(stamp?.user_version ?? 0)
    const row = db
      .prepare(
        'SELECT id, status, attempts, last_failure_kind, last_failure_reason '
        + "FROM jobs WHERE kind = 'analyze-run' AND payload LIKE ? LIMIT 1",
      )
      .get(`%${runId}%`) as Record<string, unknown> | undefined
    if (row === undefined) return undefined
    const text = (value: unknown): string | null =>
      value === null || value === undefined ? null : String(value)
    return {
      id: String(row.id),
      status: String(row.status),
      attempts: Number(row.attempts),
      lastFailureKind: text(row.last_failure_kind),
      lastFailureReason: text(row.last_failure_reason),
    }
  } finally {
    db.close()
  }
}

/** Every `*.db`/`*.sqlite` under a root, recursively — C1 is reached only if one exists. */
function databaseFilesUnder(root: string): string[] {
  if (!existsSync(root)) return []
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      let isDirectory = false
      try {
        isDirectory = statSync(full).isDirectory()
      } catch {
        continue
      }
      if (isDirectory) {
        walk(full)
        continue
      }
      if (/\.(?:db|sqlite)(?:-[a-z]+)?$/u.test(entry)) found.push(full.slice(root.length + 1))
    }
  }
  walk(root)
  return found
}

/** Whether the projection index `readProjectedTestHistory` opens exists under a knowledge root. */
function knowledgeIndexPresent(knowledgeRoot: string): boolean {
  return existsSync(join(knowledgeRoot, 'memory', 'index', 'knowledge.db'))
}

/** Drive one failing run and record everything one rung of the ladder needs. */
async function driveArm(
  arm: ArmRecord,
  project: PopulatedRunProject,
  origin: string,
  stubRequestsSeen: number,
): Promise<number> {
  recorded.arms.push(arm)
  arm.knowledgeIndexPresent = knowledgeIndexPresent(join(project.root, 'agent-qa-knowledge'))

  const drive = await drivePopulatedRun({ origin }, project, RUN_BUDGET_MS)
  arm.runId = drive.runId

  // THE PUMP IS IN THE DASHBOARD PROCESS AND THE RUN STREAM DOES NOT WAIT ON IT. `runFinished` says
  // the RUN ended; the post-run tail then composes the real capabilities and drains `analyze-run`.
  // Poll the store until it has spoken — a recorded failure, or a terminal status. A budget
  // exhaustion is recorded and reds (r2), never skipped.
  const deadline = Date.now() + PUMP_BUDGET_MS
  for (;;) {
    try {
      arm.row = readAnalyzeRunRow(project.agentQaRoot, drive.runId)
    } catch (error) {
      arm.rowPollNote =
        `the job store could not be read: ${error instanceof Error ? error.message : String(error)}`
      break
    }
    const row = arm.row
    if (
      row !== undefined
      && (row.lastFailureReason !== null
        || row.status === 'done'
        || row.status === 'failed'
        || row.status === 'cancelled')
    ) {
      break
    }
    if (Date.now() >= deadline) {
      arm.rowPollNote = `the analyze-run row never settled inside ${String(PUMP_BUDGET_MS)}ms`
      break
    }
    await new Promise<void>((tick) => { setTimeout(tick, 250) })
  }

  const chain = await fetch(
    `${origin}/api/runs/${encodeURIComponent(drive.runId)}/post-processing`,
  ).then(
    async (response) => await response.json() as { status?: { chips?: Record<string, string> } },
    () => undefined,
  )
  arm.chips = chain?.status?.chips

  const seen = stubServer?.requests.length ?? stubRequestsSeen
  arm.stubRequestKinds = (stubServer?.requests ?? [])
    .slice(stubRequestsSeen)
    .map((request) => request.kind)

  const runDir = join(project.agentQaRoot, 'runs', slugBranch(drive.runId))
  arm.analysisJsonPresent = existsSync(join(runDir, 'analysis.json'))
  const blobsDir = join(runDir, 'blobs')
  arm.blobs = existsSync(blobsDir) ? readdirSync(blobsDir).length : 0

  const handoffPath = join(runDir, 'handoff.json')
  if (existsSync(handoffPath)) {
    const raw = readFileSync(handoffPath, 'utf8')
    const handoff = JSON.parse(raw) as { tests?: { rootCause?: RecordedRootCause }[] }
    arm.rootCause = handoff.tests?.[0]?.rootCause
    arm.screenshotRefs = (raw.match(/decisionScreenshotRef/gu) ?? []).length
  }

  const ledger = readDaemonEventLedger(project.agentQaRoot)
  arm.daemonJobEvents = ledger.events.filter(
    (event) =>
      (event.kind === 'job-claimed' || event.kind === 'job-completed')
      && event.runId === drive.runId,
  )

  const eventsPath = join(runDir, 'events.jsonl')
  if (existsSync(eventsPath)) {
    const envelopes = readFileSync(eventsPath, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type: string; payload?: { error?: unknown } })
    arm.eventTypes = envelopes.map((envelope) => envelope.type)
    const failed = envelopes.find((envelope) => envelope.type === 'analysisFailed')
    if (failed?.payload?.error !== undefined) arm.analysisFailedError = String(failed.payload.error)
  }

  return seen
}

/** The first arm on which the handler actually threw, if any did. */
function reproducingArm(): ArmRecord | undefined {
  return recorded.arms.find(
    (arm) => arm.row?.lastFailureReason !== null && arm.row?.lastFailureReason !== undefined,
  )
}

/** The arm the cells assert on: the one that reproduced, else the last one run. */
function subject(): ArmRecord | undefined {
  return reproducingArm() ?? recorded.arms[recorded.arms.length - 1]
}

/** The whole ladder on one line, for the failure message every cell can afford. */
function ladderLine(): string {
  const arms = recorded.arms
    .map((arm) => [
      `[${arm.arm}: ${arm.what}`,
      `runId=${String(arm.runId)}`,
      `row=${arm.row === undefined ? '(absent)' : `${arm.row.status}/attempts:${String(arm.row.attempts)}`}`,
      `lastFailureKind=${String(arm.row?.lastFailureKind)}`,
      `lastFailureReason=${JSON.stringify(arm.row?.lastFailureReason)}`,
      `rootCause=${String(arm.rootCause?.class)}/${String(arm.rootCause?.producer)}`,
      `analysisJson=${String(arm.analysisJsonPresent)}`,
      `C1-knowledgeIndex=${String(arm.knowledgeIndexPresent)}`,
      `C2-screenshotRefs=${String(arm.screenshotRefs)}/blobs=${String(arm.blobs)}`,
      `C3-stubRequests=${JSON.stringify(arm.stubRequestKinds)}`,
      `chips=${JSON.stringify(arm.chips)}`,
      `daemonJobEvents=${JSON.stringify(arm.daemonJobEvents)}`,
      `analysisFailedError=${JSON.stringify(arm.analysisFailedError)}`,
      `pollNote=${String(arm.rowPollNote)}]`,
    ].join(' '))
    .join(' || ')
  return (
    `${arms} || knowledgeDbs=${JSON.stringify(recorded.knowledgeDbFiles)}`
    + ` || daemonNote=${String(recorded.daemonNote)}`
    + ` || daemonOutput=${JSON.stringify((recorded.daemonStderr ?? '').slice(-1_200))}`
  )
}

describe('406-02 · D-13: `analyze-run` on REAL red runs, measured on the shipped binary', () => {
  beforeAll(async () => {
    if (process.platform === 'win32') {
      recorded.failure = WINDOWS_REFUSAL
      return
    }
    try {
      recorded.browserPresent = existsSync(chromium.executablePath())
    } catch {
      recorded.browserPresent = false
    }
    if (recorded.browserPresent !== true) {
      recorded.failure = BROWSER_INSTALL_INSTRUCTION
      return
    }

    // FIRST, AND BEFORE ANYTHING IS SPAWNED: a stale dist measures the previous commit, and what
    // this file claims to measure is the code at HEAD.
    const freshness = buildFreshness(POPULATED_RUN_ANCHORED_BUILDS)
    if (freshness.missing.length > 0 || freshness.stale.length > 0) {
      recorded.failure =
        `${REBUILD_INSTRUCTION} missing: ${freshness.missing.join(', ') || '(none)'}; `
        + `stale: ${freshness.stale.join(', ') || '(none)'}`
      return
    }

    targetServer = await startTargetPageServer()
    stubServer = await startStubModelServer({ plannerOutcome: 'stepFailed' })

    const project = populatedRunFixtureProject(
      'analyze-run-red-repro',
      { modelBaseUrl: stubServer.baseUrl, targetUrl: targetServer.url },
      { stepText: POPULATED_FAILURE_STEP_TEXT },
    )

    const port = await reserveEphemeralPort()
    dashboard = await spawnDashboard(
      project.root,
      project.configPath,
      port,
      60_000,
      populatedRunSpawnEnv(),
    )
    if (!dashboard.ready) {
      recorded.dashboardStderr = dashboard.stderr()
      recorded.failure = 'the spawned `agent-qa dashboard` never said it was listening'
      return
    }

    try {
      let daemonStarted = false
      let seen = await driveArm(
        {
          arm: 'A',
          what: 'first failing run in a fresh project (no knowledge index yet — C1 unreachable)',
        },
        project,
        dashboard.origin,
        0,
      )
      if (reproducingArm() === undefined) {
        seen = await driveArm(
          {
            arm: 'B',
            what: "second failing run, after arm A's curation seeded the knowledge index (C1 reachable)",
          },
          project,
          dashboard.origin,
          seen,
        )
      }
      if (reproducingArm() === undefined) {
        // ARM C — the SHIPPED DAEMON's own bindings, not the dashboard's in-process pump.
        // Started BEFORE the drive so it holds the writer lease: the post-run tail then finds the
        // lease taken, nudges the daemon instead of draining in-process, and the job runs under
        // `commands/daemon.ts`'s `model: () => resolveCliJobModel(configPath)` — the one binding
        // that differs from the tail's, which wraps the same resolution in a catch.
        daemonStarted = await startShippedDaemon(project)
        if (!daemonStarted) {
          recorded.daemonNote = 'the shipped `agent-qa daemon` never reported `running`'
        } else {
          seen = await driveArm(
            {
              arm: 'C',
              what: 'third failing run, drained by the SHIPPED `agent-qa daemon` holding the writer lease',
            },
            project,
            dashboard.origin,
            seen,
          )
        }
      }
    } catch (error) {
      recorded.failure = error instanceof Error ? error.message : String(error)
    }

    if (daemonChild !== undefined) {
      recorded.daemonStderr = daemonStderr
      daemonChild.kill('SIGTERM')
      await new Promise<void>((tick) => { setTimeout(tick, 1_000) })
      recorded.daemonStderr = daemonStderr
    }

    // The detached tail is given a moment before its writer is taken away.
    await new Promise<void>((tick) => { setTimeout(tick, TAIL_GRACE_MS) })
    recorded.dashboardStderr = dashboard.stderr()
    await dashboard.stop()

    recorded.knowledgeDbFiles = databaseFilesUnder(join(project.root, 'agent-qa-knowledge'))
  }, RUN_BUDGET_MS * 2 + PUMP_BUDGET_MS * 2 + 120_000)

  afterAll(async () => {
    daemonChild?.kill('SIGKILL')
    await dashboard?.stop().catch(() => undefined)
    await stubServer?.close().catch(() => undefined)
    await targetServer?.close().catch(() => undefined)
    cleanupTempRoots()
  })

  it('(r1) takes the AUTHOR path: the floor member is classified `unknown`', () => {
    expect(recorded.failure, `the drive did not complete — ${ladderLine()}`).toBeUndefined()
    expect(subject()?.rootCause, `no handoff member was recorded — ${ladderLine()}`).toBeDefined()
    expect(subject()?.rootCause?.class).toBe('unknown')
    expect(subject()?.rootCause?.producer).toBe('deterministic-classifier')
  })

  it('(r2) the `analyze-run` job recorded a `handler-threw:` failure on a spent attempt', () => {
    expect(subject()?.row, `no analyze-run row was written — ${ladderLine()}`).toBeDefined()
    expect(subject()?.row?.attempts ?? 0).toBeGreaterThanOrEqual(1)
    expect(
      subject()?.row?.lastFailureReason,
      `the handler did not throw on any arm — ${ladderLine()}`,
    ).toEqual(expect.stringContaining('handler-threw:'))
  })

  it('(r3) no analysis artifact was persisted for the run the handler was given', () => {
    expect(subject()?.analysisJsonPresent, `unexpected analysis.json — ${ladderLine()}`).toBe(false)
  })

  it('(r4) prints the measurement: every arm, its row, the seams reached and the stub trail', () => {
    expect(recorded.failure, `MEASUREMENT — ${ladderLine()}`).toBeUndefined()
    expect(recorded.arms.length, `MEASUREMENT — ${ladderLine()}`).toBeGreaterThan(0)
  })
})
