// THE DASHBOARD RUN DOOR (Phase 401 plan 07 — D-01/D-09/D-10/D-12, INVK-01).
//
// WHAT IS UNDER TEST is the whole door a browser click reaches: the queue's backend →
// `createDashboardRunDoor`'s starter → the shipped `invokeFunction` → the 384 registry → the REAL
// op-level gate → the composed host's default run execution → the in-process drive → the core's ONE
// `evaluate()` → a real run → the bus. Nothing on that path is substituted.
//
// 2026-08-27 (405-07, D-19): THE OBSERVATION SURFACE MOVED TO THE BUS ITSELF. These cells used to
// read the backend's per-run replay buffer — a re-minted frame shape kept alive for one SSE route,
// deleted with that route. They now subscribe to the run's OWN `RunSession` through the door's
// published `observeSessions`, so what a cell asserts is the frozen §2.2 envelope the run actually
// published rather than a copy of it with an added `id`. Per-run isolation is measured the same way
// and means more: the sessions are distinct objects, not two entries in one map. `composeDashboardDoor` and `createDashboardRunDoor` are the SAME
// composers the `agent-qa dashboard` command calls, which is the whole reason they are published:
// a cell that assembled its own starter would be measuring a door this product does not ship.
//
// THE RED BASELINE, which is the point of the retirement rather than an incidental improvement.
// Before this plan the dashboard's queue spawned `agent-qa run` and read its stdout. A policy
// denial therefore reached the browser as an empty run: the child printed the gate's reason and
// remedies on ITS stderr, exited 2, and the dashboard recorded "Process exited before test
// completed". 401-05 measured the identical loss at the fn door and pasted the reading. Here the
// denial arrives as the gate's own reason, on the run's failure record, which the cells below
// assert by reading it BACK off the audit row rather than typing it in.
//
// A DENIAL'S ASSERTION SURFACE IS FIVE ARTIFACTS (401-03's Mutation B), never an exit code or a
// message alone: the audit row's `outcome`, no run events, no build-ordinal ledger, zero requests at
// the target, and the reason on the surface the caller sees. Every denial cell asserts all five and
// is paired with an allow control differing in EXACTLY ONE field.

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DashboardDatabase } from '@vostride/agent-qa-dashboard'
import type { ExecuteOptions, RunSettledDetails } from '@vostride/agent-qa-dashboard'
import {
  getActiveExecutionContext,
  setActiveExecutionContextResolver,
} from '@vostride/agent-qa-safety'

import {
  composeDashboardDoor,
  createDashboardRunDoor,
  partitionDashboardRunArgs,
} from '../dashboard.js'
import { resolveHostAppiumUrl } from '../run.js'
import {
  CountingTarget,
  auditRows,
  buildOrdinalsExist,
  createInProcessFixture,
  eventTypes,
  runDirs,
} from '../../composition/__tests__/in-process-run-fixture.js'
import type { AuditRow } from '../../composition/__tests__/in-process-run-fixture.js'

type Fixture = ReturnType<typeof createInProcessFixture>

/** The OP-level gate's rows, which land in the host's own sink rather than the run's. */
function opAuditRows(fixture: Fixture): AuditRow[] {
  const path = join(fixture.agentQaRoot, 'execution_audit.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as AuditRow)
}

/** An empty browsers root, so a member's failure is a property of the fixture, not of the machine. */
function pinEmptyBrowsersRoot(fixture: Fixture): void {
  const browsersRoot = join(fixture.project, 'no-browsers')
  if (!existsSync(browsersRoot)) mkdirSync(browsersRoot, { recursive: true })
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersRoot
}

interface Settled {
  runId: string
  status: string
  details: RunSettledDetails
}

interface Driven {
  /** The run's OWN bus envelopes, in seq order, recorded off its session. */
  envelopes(runId: string): { seq: number; type: string; runId: string; [key: string]: unknown }[]
  settled: Settled[]
  backend: Awaited<ReturnType<typeof createDashboardRunDoor>>['backend']
  db: DashboardDatabase
  /** The composed door's own per-run Appium answer, readable while a run is in flight. */
  resolveAppiumUrl(runId: string): string | undefined
}

/** Compose the SHIPPED door pair over a fixture and hand back the surfaces a cell reads. */
async function composeDoor(fixture: Fixture): Promise<Driven> {
  pinEmptyBrowsersRoot(fixture)
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  const runDoor = await createDashboardRunDoor({ db })
  const door = composeDashboardDoor({
    agentQaRoot: fixture.agentQaRoot,
    configPath: fixture.configPath,
    boundOrigin: () => undefined,
    runBridge: runDoor.runBridge,
  })
  runDoor.bindHost(door.host)

  const settled: Settled[] = []
  runDoor.backend.on('run-settled', (runId: string, status: string, details: RunSettledDetails) => {
    settled.push({ runId, status, details })
  })

  // 405-07 (D-19): the run's own bus, watched through the door's published fan-out. `subscribe(1,
  // …)` is replay-then-live from the first seq — the same constant the backend attaches at — so a
  // recorder registered before `execute` sees every envelope regardless of when the door names the
  // session.
  const recorded = new Map<string, { seq: number; type: string; runId: string }[]>()
  runDoor.observeSessions((session) => {
    const id = session.id as unknown as string
    const own: { seq: number; type: string; runId: string }[] = []
    recorded.set(id, own)
    session.subscribe(1, (envelope) => { own.push(envelope as unknown as { seq: number; type: string; runId: string }) })
  })

  return {
    envelopes: (runId) => recorded.get(runId) ?? [],
    settled,
    backend: runDoor.backend,
    db,
    resolveAppiumUrl: (runId) => runDoor.runBridge.resolveAppiumUrl?.(runId),
  }
}

/** Enqueue a row the way the dashboard's queue does, so the ingest has a real row to adopt. */
function enqueue(db: DashboardDatabase, name: string): string {
  return db.insertRun({
    name,
    status: 'pending',
    duration: 0,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    platform: 'web',
  })
}

async function waitFor(assertion: () => void, timeoutMs = 120_000): Promise<void> {
  const startedAt = Date.now()
  let lastError: unknown
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  if (lastError instanceof Error) throw lastError
  throw new Error('Timed out waiting for assertion')
}

/** Drive one run through the backend the queue drives, and wait for it to settle. */
async function runThroughQueue(
  driven: Driven,
  opts: ExecuteOptions,
): Promise<Settled> {
  const before = driven.settled.length
  driven.backend.execute(opts)
  await waitFor(() => { expect(driven.settled.length).toBeGreaterThan(before) })
  return driven.settled[driven.settled.length - 1]!
}

// ---- the ambient channels, varied against the door's own answer (D-07) -----------------------

const shippedExecutionContextResolver = getActiveExecutionContext
let restoreAmbient: (() => void) | undefined

beforeEach(() => { restoreAmbient = undefined })
afterEach(() => {
  restoreAmbient?.()
  restoreAmbient = undefined
})

function pinAmbient(value: 'ci' | 'local-interactive' | 'local-headless', ciMarker: boolean): void {
  const priorGithubActions = process.env.GITHUB_ACTIONS
  setActiveExecutionContextResolver(() => value as never)
  if (ciMarker) process.env.GITHUB_ACTIONS = 'true'
  else delete process.env.GITHUB_ACTIONS
  restoreAmbient = () => {
    setActiveExecutionContextResolver(() => shippedExecutionContextResolver())
    if (priorGithubActions === undefined) delete process.env.GITHUB_ACTIONS
    else process.env.GITHUB_ACTIONS = priorGithubActions
  }
}

describe('a dashboard-triggered run is one more caller of runs.start (401-07, D-10 / INVK-01)', () => {
  it('THE ALLOW ARM — the run happens IN PROCESS, and BOTH gates left a row', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      const driven = await composeDoor(fixture)
      const runId = enqueue(driven.db, 'the parity test')

      const settled = await runThroughQueue(driven, {
        runId,
        args: [fixture.testPattern],
        source: 'dashboard',
      })

      // (a) the run really ran: its own directory, its own event log, the target knocked on once
      expect(runDirs(fixture).map((dir) => dir.split('/').pop())).toContain(runId)
      expect(eventTypes(fixture)).toContain('runStarted')
      expect(target.hits).toEqual(['/in-process-thing'])
      expect(buildOrdinalsExist(fixture)).toBe(true)

      // (b) TWO GATES, TWO ROWS, TWO FILES, TWO ACTION NAMES — no dashboard carve-out (D-10)
      const opRows = opAuditRows(fixture).filter((row) => row.action === 'fn:runs.start')
      const runRows = (auditRows(fixture) as AuditRow[]).filter((row) => row.action === 'run:start')
      expect(opRows).toHaveLength(1)
      expect(runRows).toHaveLength(1)
      expect(runRows[0]!.outcome).toBe('proceeded')
      expect(runRows[0]!.riskTier).toBe('mutating-local')

      // (c) the run's own envelopes reached the door's subscribers, whole and in seq order
      const envelopes = driven.envelopes(runId)
      expect(envelopes[0]!.type).toBe('runStarted')
      expect(envelopes.map((event) => event.type)).toContain('runFinished')
      expect(envelopes.every((event) => event.runId === runId)).toBe(true)
      expect(envelopes.map((event) => event.seq)).toEqual(envelopes.map((_, index) => index + 1))

      // (d) the enqueued ROW was adopted rather than duplicated — the correlation that used to be
      // `AGENT_QA_RUN_ID` in a child's environment is construction data now
      expect(driven.db.getRuns({}).map((row) => row.id)).toEqual([runId])
      expect(driven.db.getRun(runId)?.status).not.toBe('pending')
      expect(settled.runId).toBe(runId)
    } finally {
      await target.close()
    }
  }, 180_000)

  it('THE DENIAL — one field different (no `environment`), five artifacts, and the reason REACHES the dashboard', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      // No `environment:` line at all — the D-06 undeclared case, which classifies SHARED. The cell
      // above writes `environment: local` and changes nothing else.
      const fixture = createInProcessFixture({ origin: target.origin })
      const driven = await composeDoor(fixture)
      const runId = enqueue(driven.db, 'the parity test')

      const settled = await runThroughQueue(driven, {
        runId,
        args: [fixture.testPattern],
        source: 'dashboard',
      })

      // (a) the audit row's OUTCOME field, never a message substring
      const runRows = (auditRows(fixture) as AuditRow[]).filter((row) => row.action === 'run:start')
      expect(runRows).toHaveLength(1)
      const row = runRows[0]!
      expect(row.outcome).toBe('fail-closed-denied')
      expect(row.riskTier).toBe('mutating-shared')
      // (b) THE RUN NEVER STARTED — `runStarted` is seq 1 of any run that began at all
      expect(eventTypes(fixture)).toEqual([])
      // (c) the durable assembly side effect never happened
      expect(buildOrdinalsExist(fixture)).toBe(false)
      // (d) nobody knocked on the target
      expect(target.hits).toEqual([])
      // (e) THE REASON ON THE SURFACE THE CALLER SEES, read BACK off the row rather than typed
      //     here — which pins the door to RENDERING the gate's decision rather than composing one.
      //     This is the whole user-visible win: on the retiring wire this field said "Process
      //     exited before test completed".
      expect(settled.status).toBe('failed')
      expect(settled.details.reason).toContain(row.reason)
      // A DENIAL IS NOT A RUN, and the claim is now structural rather than a count of bookends: no
      // session was ever named, so there are no envelopes at all. The synthetic `run-start` /
      // `run-complete` pair this used to compare against was minted by the backend, not by the run.
      expect(driven.envelopes(runId)).toEqual([])
      expect(settled.details.refusedBeforeStart).toBe(true)
    } finally {
      await target.close()
    }
  }, 180_000)

  it('THE INTERIM POSTURE IS STRUCTURAL — `local-headless` even with the ambient shouting otherwise', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      // Both ambient channels say a person is here: the process-global the OP gate falls back to,
      // and the CI marker the door's own fallback reads. Neither reaches this decision — a queued
      // run is not a turn, so it never enters the asking-session scope, so `postureFor` sees no
      // asker. That is the interim posture holding by CONSTRUCTION rather than by configuration.
      pinAmbient('local-interactive', true)
      const driven = await composeDoor(fixture)
      const runId = enqueue(driven.db, 'the parity test')

      await runThroughQueue(driven, { runId, args: [fixture.testPattern], source: 'dashboard' })

      const row = (auditRows(fixture) as AuditRow[]).find((r) => r.action === 'run:start')!
      expect(row.executionContext).toBe('local-headless')
    } finally {
      await target.close()
    }
  }, 180_000)
})

describe('two concurrent dashboard runs are isolated (401-07, INVK-01 concurrency edge)', () => {
  it('OWN RUN DIR, OWN EVENT LOG, OWN DB ROW, OWN BUFFER', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      const driven = await composeDoor(fixture)
      const runA = enqueue(driven.db, 'run A')
      const runB = enqueue(driven.db, 'run B')

      // GENUINELY CONCURRENT: both are executed before either settles. A sequential pair would not
      // range the isolation claim at all — every per-run map would look correct with one entry.
      driven.backend.execute({ runId: runA, args: [fixture.testPattern], source: 'dashboard' })
      driven.backend.execute({ runId: runB, args: [fixture.testPattern], source: 'dashboard' })
      await waitFor(() => {
        expect(driven.backend.getActiveExecutions().map((execution) => execution.runId).sort())
          .toEqual([runA, runB].sort())
      })
      await waitFor(() => {
        expect(driven.envelopes(runA).some((event) => event.type === 'runStarted')).toBe(true)
        expect(driven.envelopes(runB).some((event) => event.type === 'runStarted')).toBe(true)
      })

      // Each session carries only its own run's envelopes.
      for (const [runId, other] of [[runA, runB], [runB, runA]] as const) {
        const runIds = new Set(driven.envelopes(runId).map((event) => event.runId))
        expect(runIds).toEqual(new Set([runId]))
        expect(runIds.has(other)).toBe(false)
      }

      await waitFor(() => { expect(driven.settled).toHaveLength(2) })

      // Two run directories, each with its OWN event log, keyed by its own run id.
      const dirs = runDirs(fixture).map((dir) => dir.split('/').pop())
      expect(dirs).toContain(runA)
      expect(dirs).toContain(runB)
      for (const runId of [runA, runB]) {
        const log = join(fixture.agentQaRoot, 'runs', runId, 'events.jsonl')
        const owners = new Set(
          readFileSync(log, 'utf8')
            .split('\n')
            .filter((line) => line.trim() !== '')
            .map((line) => (JSON.parse(line) as { runId: string }).runId),
        )
        expect(owners).toEqual(new Set([runId]))
      }

      // Two db rows, each its own, and no third row minted by either.
      expect(driven.db.getRuns({}).map((row) => row.id).sort()).toEqual([runA, runB].sort())
    } finally {
      await target.close()
    }
  }, 240_000)

  it('A CANCEL IS ROUTED TO THE NAMED RUN AND TO NO OTHER', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      const driven = await composeDoor(fixture)
      const cancelled = enqueue(driven.db, 'the cancelled run')
      const survivor = enqueue(driven.db, 'the surviving run')

      driven.backend.execute({ runId: cancelled, args: [fixture.testPattern], source: 'dashboard' })
      driven.backend.execute({ runId: survivor, args: [fixture.testPattern], source: 'dashboard' })
      // Synchronously, which is the only way this is not a race: `execute` returns before the run
      // is anywhere, so the cancel is always taken while the run is live — and it exercises the arm
      // that matters, a cancel landing BEFORE the session exists, which the backend has to remember
      // and apply when `onSession` fires.
      expect(driven.backend.kill(cancelled)).toBe(true)
      expect(driven.backend.kill(survivor === cancelled ? 'impossible' : 'a-run-nobody-started')).toBe(false)

      await waitFor(() => { expect(driven.settled).toHaveLength(2) })
      const byRun = new Map(driven.settled.map((entry) => [entry.runId, entry]))

      // WHAT THIS CELL MEASURES IS ROUTING, and the limit is stated rather than papered over.
      //
      // A door-level cell asserting that the cancelled run's OUTCOME differs would be GREEN AT REST
      // here, and that was measured rather than assumed: in this fixture the member fails its
      // browser check in tens of milliseconds, so a run reaches `runFinished` before an abort can
      // unwind anything. Driven with one run cancelled and one not, both event logs read
      // `runStarted, testStarted, testFinished, verdict, runFinished` and both settle `cancelled`
      // (the missing-browser member's own verdict) — identical on every axis. An assertion drawn
      // there would have discriminated nothing.
      //
      // So the claim here is the one that IS observable at this door: a cancel reaches the run it
      // NAMES. `kill` returning true for the named run and false for a stranger, the door's own
      // cancel reason on that run and only that run. The other half — that the abort reaches that
      // run's SESSION object and no other — is measured in
      // `dashboard-server/src/execution/__tests__/in-process-backend.test.ts` over sessions whose
      // `cancel()` can be counted, where killing A leaves B's count at zero.
      expect(byRun.get(cancelled)!.details.reason).toBe('cancelled')
      expect(byRun.get(survivor)!.details.reason).toBeUndefined()

      // The survivor ran to its own verdict, in its own directory.
      expect(runDirs(fixture).map((dir) => dir.split('/').pop())).toContain(survivor)
      const survivorLog = join(fixture.agentQaRoot, 'runs', survivor, 'events.jsonl')
      expect(readFileSync(survivorLog, 'utf8')).toContain('runFinished')
    } finally {
      await target.close()
    }
  }, 240_000)
})

describe('the queue’s argv operands, read rather than forwarded (401-07)', () => {
  it('PATHS BECOME PATTERNS AND `--disable-cache` BECOMES A FLAG', () => {
    expect(partitionDashboardRunArgs(['tests/a.yaml', '--disable-cache', 'tests/b.yaml']))
      .toEqual({
        patterns: ['tests/a.yaml', 'tests/b.yaml'],
        flags: { disableCache: true },
        unsupported: [],
      })
  })

  it('AN UNRECOGNISED FLAG IS REPORTED, NOT SILENTLY GLOBBED', () => {
    const partition = partitionDashboardRunArgs(['tests/a.yaml', '--headed'])
    expect(partition.unsupported).toEqual(['--headed'])
    expect(partition.patterns).toEqual(['tests/a.yaml'])
  })

  it('AND THE DOOR REFUSES SUCH A RUN BY NAME rather than running a different one', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      const driven = await composeDoor(fixture)
      const runId = enqueue(driven.db, 'unsupported flag')

      const settled = await runThroughQueue(driven, {
        runId,
        args: [fixture.testPattern, '--headed'],
        source: 'dashboard',
      })

      expect(settled.status).toBe('failed')
      expect(settled.details.reason).toContain('--headed')
      // Nothing ran: a refused operand must not become a run that quietly ignored it.
      expect(eventTypes(fixture)).toEqual([])
      expect(target.hits).toEqual([])
    } finally {
      await target.close()
    }
  }, 180_000)
})

describe('the Appium lease travels as data, not as a child’s environment (401-07, truth 5)', () => {
  const priorEnv = process.env.AGENT_QA_APPIUM_URL
  afterEach(() => {
    if (priorEnv === undefined) delete process.env.AGENT_QA_APPIUM_URL
    else process.env.AGENT_QA_APPIUM_URL = priorEnv
  })

  it('PRECEDENCE — injected beats the environment, and the environment beats the bundled default', () => {
    process.env.AGENT_QA_APPIUM_URL = 'http://env:4723'
    expect(resolveHostAppiumUrl(() => 'http://leased:4723')).toBe('http://leased:4723')
    expect(resolveHostAppiumUrl(() => undefined)).toBe('http://env:4723')
    expect(resolveHostAppiumUrl()).toBe('http://env:4723')
    delete process.env.AGENT_QA_APPIUM_URL
    // Nothing injected and nothing in the environment ⇒ `undefined`, which is what makes
    // `acquireAppium` fall through to the BUNDLED auto-start. The three rungs, in order.
    expect(resolveHostAppiumUrl()).toBeUndefined()
    expect(resolveHostAppiumUrl(() => undefined)).toBeUndefined()
  })

  it('THE DOOR ANSWERS PER RUN, WHILE THE RUN IS IN FLIGHT — a lease belongs to one run', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      const driven = await composeDoor(fixture)
      const runA = enqueue(driven.db, 'mobile A')
      const runB = enqueue(driven.db, 'web B')

      // Before either run exists the door knows about neither — the entry is per run and is created
      // by the starter, so a resolver that answered a process-global would be visible right here.
      expect(driven.resolveAppiumUrl(runA)).toBeUndefined()

      driven.backend.execute({
        runId: runA,
        args: [fixture.testPattern],
        source: 'dashboard',
        appiumUrl: 'http://leased-for-a:4723',
      })
      driven.backend.execute({ runId: runB, args: [fixture.testPattern], source: 'dashboard' })

      await waitFor(() => { expect(driven.resolveAppiumUrl(runA)).toBe('http://leased-for-a:4723') })
      // The other concurrent run gets ITS answer, which is that it leased nothing — a shared box
      // would hand a web run the mobile run's Appium.
      expect(driven.resolveAppiumUrl(runB)).toBeUndefined()

      await waitFor(() => { expect(driven.settled).toHaveLength(2) }, 240_000)
      // And the entry is released when the run is over, so a later run cannot inherit it.
      expect(driven.resolveAppiumUrl(runA)).toBeUndefined()
    } finally {
      await target.close()
    }
  }, 240_000)
})
