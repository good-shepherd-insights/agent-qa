// CANCELLING ONE OF TWO CONCURRENT DASHBOARD RUNS (401 UAT item 14 / Truth 5, D-12 — INVK-01).
//
// WHAT WAS MISSING, AND WHY THIS FILE EXISTS. 401-07 measured its own door-level cancel cell
// VACUOUS and recorded the measurement (`deferred-items.md` item 7): in every other in-process
// fixture in this phase `PLAYWRIGHT_BROWSERS_PATH` is an empty directory, so the member fails its
// browser check in tens of milliseconds. A run therefore reaches its verdict before an abort can
// unwind anything, both arms produce the identical event log, and both settle the same way — so an
// assertion drawn there discriminates NOTHING. What ships measures ROUTING at the door (a cancel
// reaches the run it names) and the abort's EFFECT only over fake sessions whose `cancel()` can be
// counted. The invariant the truth actually states — **an abort unwinds a LIVE run, and only that
// run** — was exercised by nothing. The deferred item names the missing piece exactly: "a member
// the cell can hold open ... That is a fixture, not a fix." This is that fixture.
//
// THE HOLDABLE MEMBER, AND WHY IT IS NOT A SUBSTITUTION OF THE THING UNDER TEST. Every frame from
// the queue's backend down to the runner shell is the shipped one: `createDashboardRunDoor` →
// `composeDashboardDoor` → the shipped `invokeFunction` → the op gate → the composed host's run
// execution → `runInProcessCliRun` → the core → `startRun` → the real `produceSuiteRunMembers`
// closure → `adapter.setup` → `chromium.launch(...)`. What is stood in for is the BROWSER BINARY —
// the external world, not this product's code. A stand-in executable is planted at the path
// playwright itself reports (`chromium.executablePath()`, under a per-fixture
// `PLAYWRIGHT_BROWSERS_PATH`); it records its arrival and then parks until this cell releases it.
// The member is then genuinely, provably still executing inside the shipped web adapter.
//
// LIVENESS IS ASSERTED, NEVER INFERRED, and never from a clock. There is no `sleep` anywhere in
// the hold: the stand-in writes an arrival file (carrying the argv playwright launched it with)
// and blocks on a release file this cell alone creates. Before the cancel is issued the cell
// asserts (a) BOTH stand-ins arrived, (b) each was launched by playwright (`--remote-debugging-pipe`
// in the recorded argv), (c) NO release has been issued, and (d) each run has published
// `runStarted` + `testStarted` and NEITHER `testFinished` NOR `runFinished`. After the cancelled
// run settles it asserts its release file STILL does not exist — so the member never returned, and
// "cancelled mid-flight" cannot be confused with "already finished before we asked".
//
// WHY A SUITE AND WHY TWO MEMBERS. The truncation has to be real. The direct-test producer wraps
// its executor in a catch that sets a framework error and calls `activeRunSession.cancel()`, so a
// browser-less DIRECT run cancels ITSELF and lands on the same `cancelled` verdict a real abort
// produces — measured, and it is half of why the shipped cell is vacuous. The suite producer
// carries no such wrapper (`takeFrameworkError: () => undefined`), so a released member's throw
// reaches the shell as a member ERROR: `runWarning` + a failed member, which poisons the suite's
// fail-fast group and publishes member 1's `testFinished`. The shell's CANCEL branch, by contrast,
// skips every remaining member SILENTLY (`skippedPerTestOutcome`, no publish). Two members is
// therefore the smallest fixture in which the cancelled run's log is missing work the surviving
// run's log has.

import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DashboardDatabase } from '@vostride/agent-qa-dashboard'
import type { ExecuteOptions, RunSettledDetails } from '@vostride/agent-qa-dashboard'

import { composeDashboardDoor, createDashboardRunDoor } from '../dashboard.js'
import {
  CountingTarget,
  createInProcessFixture,
  runDirs,
} from '../../composition/__tests__/in-process-run-fixture.js'

type Fixture = ReturnType<typeof createInProcessFixture>

interface Settled {
  runId: string
  status: string
  details: RunSettledDetails
}

interface Envelope {
  id: number
  type: string
  seq?: number
  runId?: string
  payload?: Record<string, unknown>
  reason?: string
}

/** The parked stand-in browsers, and the only lever that lets one of them go. */
interface HoldableBrowser {
  /** The path playwright itself named, where the stand-in was planted. */
  readonly execPath: string
  /** One record per launch, in arrival order: the argv playwright spawned it with. */
  arrivals(): string[]
  /** How many releases THIS CELL has issued. Zero until it says otherwise. */
  releasesIssued(): number
  /** Let the n-th arrival go. It exits non-zero, which is what playwright sees. */
  release(ordinal: number): void
  releaseAll(): void
}

/**
 * Plant a stand-in browser executable at the path playwright resolves, and park every launch.
 *
 * THE PATH IS PLAYWRIGHT'S OWN ANSWER, not a hand-spelled one. `chromium.executablePath()` folds
 * the browser revision and the host platform into a path this cell must not try to reproduce — a
 * literal would rot silently on the next playwright bump and leave the plant unused, which is the
 * shape of a cell that goes green having measured nothing. `PLAYWRIGHT_BROWSERS_PATH` is set FIRST
 * so the answer is inside this fixture's own temp tree, and the caller asserts that containment.
 *
 * playwright-core is reached through `@vostride/agent-qa-web`'s own resolution rather than declared
 * here: the web adapter is the module that launches browsers, so its playwright is the one whose
 * answer matters, and a second copy could disagree about the revision.
 */
function plantHoldableBrowser(fixture: Fixture): HoldableBrowser {
  const browsersRoot = join(fixture.project, 'planted-browsers')
  mkdirSync(browsersRoot, { recursive: true })
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersRoot

  const requireFromWeb = createRequire(createRequire(import.meta.url).resolve('@vostride/agent-qa-web'))
  const playwright = requireFromWeb('playwright-core') as { chromium: { executablePath(): string } }
  const execPath = playwright.chromium.executablePath()
  if (!execPath.startsWith(`${browsersRoot}/`)) {
    throw new Error(
      `The planted browsers root was not honoured: playwright resolves ${execPath}, outside ${browsersRoot}. `
      + 'Planting elsewhere would leave this cell measuring a machine-installed browser.',
    )
  }

  const control = join(fixture.project, 'hold-control')
  mkdirSync(control, { recursive: true })

  // The stand-in itself, in two pieces so neither the interpreter path nor the argv needs quoting:
  // a `/bin/sh` trampoline (the file playwright spawns) and the node script that does the parking.
  const holdScript = join(control, 'hold.cjs')
  writeFileSync(
    holdScript,
    [
      "const fs = require('node:fs')",
      `const control = ${JSON.stringify(control)}`,
      '// An ATOMIC ordinal: mkdir either creates the slot or fails, so two concurrent launches can',
      '// never claim the same one. The cell starts its runs one at a time and waits for each',
      '// arrival, so ordinal N belongs to the N-th run it started.',
      'let ordinal = 0',
      'for (; ordinal < 32; ordinal += 1) {',
      "  try { fs.mkdirSync(`${control}/slot-${ordinal}`); break } catch { /* taken */ }",
      '}',
      '// The argv is recorded so the cell can prove PLAYWRIGHT launched this, not something else.',
      'fs.writeFileSync(`${control}/arrived-${ordinal}`, process.argv.slice(2).join(" "))',
      'const parked = () => {',
      '  if (fs.existsSync(`${control}/release-${ordinal}`)) process.exit(1)',
      '  setTimeout(parked, 25)',
      '}',
      'parked()',
      '',
    ].join('\n'),
  )
  mkdirSync(dirname(execPath), { recursive: true })
  // `"$@"` is load-bearing: the cell proves the launch was PLAYWRIGHT's by reading the argv back,
  // so the trampoline has to forward what it was spawned with.
  writeFileSync(
    execPath,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(holdScript)} "$@"\n`,
  )
  chmodSync(execPath, 0o755)

  let issued = 0
  return {
    execPath,
    arrivals: () =>
      readdirSync(control)
        .filter((entry) => entry.startsWith('arrived-'))
        .sort()
        .map((entry) => readFileSync(join(control, entry), 'utf8')),
    releasesIssued: () => issued,
    release: (ordinal) => {
      if (existsSync(join(control, `release-${String(ordinal)}`))) return
      issued += 1
      writeFileSync(join(control, `release-${String(ordinal)}`), '')
    },
    releaseAll: () => {
      for (let ordinal = 0; ordinal < 32; ordinal += 1) {
        if (!existsSync(join(control, `slot-${String(ordinal)}`))) continue
        if (existsSync(join(control, `release-${String(ordinal)}`))) continue
        issued += 1
        writeFileSync(join(control, `release-${String(ordinal)}`), '')
      }
    },
    // The arrival file for an ordinal only exists once that launch is parked, which is what the
    // caller waits on.
  }
}

/** Wait for `assertion`, and FAIL with its own error rather than a bare timeout. */
async function waitFor(assertion: () => void, timeoutMs = 60_000): Promise<void> {
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

/** The event types a run wrote to ITS OWN durable log, in order. */
function loggedTypes(fixture: Fixture, runId: string): string[] {
  return readFileSync(join(fixture.agentQaRoot, 'runs', runId, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => (JSON.parse(line) as { type: string }).type)
}

function loggedEnvelopes(fixture: Fixture, runId: string): Envelope[] {
  return readFileSync(join(fixture.agentQaRoot, 'runs', runId, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Envelope)
}

const priorBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH
let releaseEverything: (() => void) | undefined

beforeEach(() => { releaseEverything = undefined })
afterEach(() => {
  // Never leave a parked stand-in behind: it would outlive the run that spawned it.
  releaseEverything?.()
  releaseEverything = undefined
  if (priorBrowsersPath === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH
  else process.env.PLAYWRIGHT_BROWSERS_PATH = priorBrowsersPath
})

describe('cancelling one of two concurrently executing dashboard runs (401 UAT 14 / truth 5, D-12)', () => {
  it('ABORTS THE NAMED RUN MID-FLIGHT AND LEAVES THE OTHER TO ITS OWN VERDICT, EACH UNDER ITS OWN runId', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({
        origin: target.origin,
        environment: 'local',
        headedBrowser: true,
        secondSuiteMember: true,
      })
      const browsers = plantHoldableBrowser(fixture)
      releaseEverything = browsers.releaseAll

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
      const buffered = (runId: string): Envelope[] =>
        runDoor.backend.getBufferedEvents(runId) as unknown as Envelope[]
      const enqueue = (name: string): string => db.insertRun({
        name,
        status: 'pending',
        duration: 0,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        platform: 'web',
      })

      const cancelled = enqueue('the run that will be cancelled')
      const survivor = enqueue('the run that must not notice')

      // ---- (1) TWO RUNS, BOTH PARKED IN A LIVE MEMBER -----------------------------------------
      //
      // Started ONE AT A TIME, each awaited to its arrival, so the stand-in's atomic ordinal is a
      // NAME for a run rather than a race: ordinal 0 is `cancelled`'s browser, ordinal 1 is
      // `survivor`'s. Both are running before either is touched, which is what makes this a
      // concurrency claim at all.
      runDoor.backend.execute({ runId: cancelled, args: [fixture.suitePattern], source: 'dashboard' } as ExecuteOptions)
      await waitFor(() => { expect(browsers.arrivals()).toHaveLength(1) })
      runDoor.backend.execute({ runId: survivor, args: [fixture.suitePattern], source: 'dashboard' } as ExecuteOptions)
      await waitFor(() => { expect(browsers.arrivals()).toHaveLength(2) })

      // ---- (2) LIVENESS AT THE MOMENT OF THE CANCEL, ASSERTED --------------------------------
      //
      // (a) both stand-ins are parked, and PLAYWRIGHT launched them — the argv is the browser
      //     launch's own, so the member is inside `adapter.setup` and not somewhere else;
      for (const argv of browsers.arrivals()) expect(argv).toContain('--remote-debugging-pipe')
      // (b) NOTHING HAS BEEN RELEASED. This is the difference between a held member and a member
      //     that finished on its own, and it is a fact about what this cell has done, not a timing
      //     guess.
      expect(browsers.releasesIssued()).toBe(0)
      // (c) each run has published its own mid-flight events and NEITHER terminal one;
      for (const runId of [cancelled, survivor]) {
        const types = buffered(runId).map((event) => event.type)
        expect(types).toContain('runStarted')
        expect(types).toContain('testStarted')
        expect(types).not.toContain('testFinished')
        expect(types).not.toContain('runFinished')
      }
      // (d) the backend agrees both are in flight, and nothing has settled.
      expect(runDoor.backend.getActiveExecutions().map((execution) => execution.runId).sort())
        .toEqual([cancelled, survivor].sort())
      expect(settled).toEqual([])

      // ---- (3) THE ABORT UNWINDS THE LIVE RUN IT NAMES ----------------------------------------
      expect(runDoor.backend.kill(cancelled)).toBe(true)
      await waitFor(() => { expect(settled.map((entry) => entry.runId)).toEqual([cancelled]) })

      // THE ASSERTION THAT MAKES THIS NOT THE VACUOUS CELL: the cancelled run settled while its
      // member was STILL PARKED. Nothing released it, so the run cannot have reached its verdict by
      // finishing — the abort is what ended it.
      expect(browsers.releasesIssued()).toBe(0)
      expect(settled[0]!.status).toBe('cancelled')
      expect(settled[0]!.details.reason).toBe('cancelled')

      // ---- (4) AT THAT SAME MOMENT THE OTHER RUN IS UNTOUCHED ---------------------------------
      expect(runDoor.backend.getActiveExecutions().map((execution) => execution.runId)).toEqual([survivor])
      const survivorMidFlight = buffered(survivor).map((event) => event.type)
      expect(survivorMidFlight).not.toContain('runFinished')
      expect(survivorMidFlight).not.toContain('run-complete')
      expect(survivorMidFlight).not.toContain('testFinished')
      expect(buffered(survivor).at(-1)!.reason).toBeUndefined()

      // ---- (5) RELEASE THE SURVIVOR — IT REACHES ITS OWN VERDICT ------------------------------
      browsers.release(1)
      await waitFor(() => { expect(settled).toHaveLength(2) })
      const bySettledRun = new Map(settled.map((entry) => [entry.runId, entry]))
      expect(bySettledRun.get(survivor)!.status).toBe('failed')
      expect(bySettledRun.get(survivor)!.details.reason).toBeUndefined()

      // ---- (6) THE CANCELLED RUN'S LOG IS TRUNCATED, NOT MERELY PRESENT ----------------------
      //
      // Both runs ran the SAME two-member suite, and both `runStarted` envelopes promise two
      // members. The cancelled run's log carries ONE member's events and stops; the survivor's
      // carries the member-0 failure, the `runWarning` that failure raised, and member 1's
      // fail-fast `testFinished`. Every event the cancelled run is missing is work the survivor
      // did — which is the claim, stated as a subset rather than as "both logs are non-empty".
      const cancelledTypes = loggedTypes(fixture, cancelled)
      const survivorTypes = loggedTypes(fixture, survivor)
      expect(cancelledTypes).toEqual(['runStarted', 'testStarted', 'testFinished', 'verdict', 'runFinished'])
      expect(survivorTypes).toEqual([
        'runStarted', 'testStarted', 'runWarning', 'testFinished', 'testFinished', 'verdict', 'runFinished',
      ])
      expect(survivorTypes.length).toBeGreaterThan(cancelledTypes.length)
      // The member count both runs SET OUT to do is the same, so a shorter log is missing work.
      for (const runId of [cancelled, survivor]) {
        const started = loggedEnvelopes(fixture, runId).find((event) => event.type === 'runStarted')!
        expect(started.payload!['memberTestCount']).toBe(2)
      }
      // Named, so a regression that swapped one event type for another cannot pass on length.
      expect(cancelledTypes.filter((type) => type === 'testFinished')).toHaveLength(1)
      expect(survivorTypes.filter((type) => type === 'testFinished')).toHaveLength(2)
      expect(cancelledTypes).not.toContain('runWarning')
      const cancelledEvents = loggedEnvelopes(fixture, cancelled)
      const survivorEvents = loggedEnvelopes(fixture, survivor)
      expect(cancelledEvents.find((event) => event.type === 'verdict')!.payload!['verdict']).toBe('cancelled')
      expect(survivorEvents.find((event) => event.type === 'verdict')!.payload!['verdict']).toBe('failed')
      expect(cancelledEvents.find((event) => event.type === 'testFinished')!.payload!['outcome']).toBe('cancelled')
      // The survivor's own failure is the browser stand-in it was allowed to reach, which is the
      // second half of "released": the member RAN and reported, rather than being unwound.
      expect(survivorEvents.find((event) => event.type === 'runWarning')!.payload!['code'])
        .toBe('member-executor-error')

      // ---- (7) ATTRIBUTION, CHECKED RATHER THAN COUNTED --------------------------------------
      //
      // Cross-attribution is a real defect class here (the two-sided contract pin), so each surface
      // is asked WHOSE the rows are, never how many there are.
      const dirs = runDirs(fixture).map((dir) => dir.split('/').pop())
      expect(dirs.sort()).toEqual([cancelled, survivor].sort())
      for (const [runId, other] of [[cancelled, survivor], [survivor, cancelled]] as const) {
        const owners = new Set(loggedEnvelopes(fixture, runId).map((event) => event.runId))
        expect(owners).toEqual(new Set([runId]))
        // The other run's id appears NOWHERE in this run's log — not as an owner, not in a payload.
        expect(readFileSync(join(fixture.agentQaRoot, 'runs', runId, 'events.jsonl'), 'utf8'))
          .not.toContain(other)
        const bufferedOwners = new Set(
          buffered(runId).filter((event) => typeof event.seq === 'number').map((event) => event.runId),
        )
        expect(bufferedOwners).toEqual(new Set([runId]))
      }
      // Two db rows, each adopted by the run that was enqueued as it — no third row, and no swap.
      expect(db.getRuns({}).map((row) => row.id).sort()).toEqual([cancelled, survivor].sort())
      expect(db.getRun(cancelled)!.status).toBe('cancelled')
      expect(db.getRun(survivor)!.status).toBe('failed')
      // ONE KNOCK PER RUN AND NO MORE: the assembler's baseline probe is the only thing either run
      // reached the target with, because both were parked at the browser before a step could run.
      // A cancelled run that had somehow been restarted, or a survivor that had inherited its
      // sibling's work, would show up as a third.
      expect(target.hits).toEqual(['/in-process-thing', '/in-process-thing'])
    } finally {
      await target.close()
    }
  }, 240_000)
})
