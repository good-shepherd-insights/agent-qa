// D-08's DISPATCH GRANT AT THE REAL RUN GATE (Phase 401 plan 08 — RESEARCH Pitfall 6).
//
// RE-SPELLED 2026-09-30 (432-13, D-14/D-15). The run gate this file measured is gone: the run core
// evaluates nothing and the door forwards no reader, so a dispatch grant has nothing to satisfy. A
// shared-target run starts in the fail-closed `local-headless` context with the dispatch open, closed
// or never opened, from inside the dispatch's call tree or outside it — and no `run:start` row, and
// therefore no `trustSource`, is written in any of them. The overlay itself survives until its own
// deletion plan; what is kept here is that it still mints nothing durable. The history below is
// kept as written.
//
// WHAT IS UNDER TEST is the whole shipped path: `composeCliLocalAgent` → the 384 registry →
// `invokeFunction` → the op gate → the bound run invocation → the composition's per-run grant
// resolution → this host's default in-process drive → the core's ONE `evaluate()`. Nothing is
// substituted. The only thing a cell varies is whether a dispatch scope is OPEN.
//
// PITFALL 6, PROVEN BOTH WAYS. `resolveAsk`'s ladder is (a) trust mode, (b) credential, (c)
// STANDING GRANTS, (d) fail-closed, (e) confirm. D-08's approval has to be consulted at (c) or it
// is never consulted at all in the contexts D-08 exists for. So the positive arm is an ask-tier run
// in `local-headless` PROCEEDING on the grant, and the negative arm is the identical run — same
// fixture shape, same door, same context, same request — DENYING fail-closed with no dispatch open.
// One direction is half a proof: an implementation that granted unconditionally passes the first
// and an implementation that grants nothing passes the second.
//
// AND SINCE 401-13, A THIRD AXIS: THE CALLER (verification gap CR-03). The three arms below this
// file shipped with all varied WHETHER A DISPATCH WAS RUNNING; none of them varied WHO WAS ASKING,
// and every one of them asked from the test body — which is to say all three were the unrelated
// caller, and the positive arm's green was the defect. The last cell holds a dispatch provably OPEN
// and drives `runs.start` from outside its call tree: the dashboard-run-button / MCP-caller shape.
// It is the two-sided pair with the first cell, in one file: the dispatch's own runs still carry
// `trustSource: standing-approval`, and the outsider's row carries none at all.
//
// THE RED THIS REPLACES. Before this plan the door passed NO reader to the run gate at all, so the
// positive arm's run denied exactly like the negative one — one human approval at the authoring
// confirm, then N fail-closed refusals. Mutation 1 in the SUMMARY's ledger IS that pre-change door
// (the `gate?.reader` spread removed) and it reds the positive arms and nothing else.
//
// A DENIAL'S ASSERTION SURFACE IS FIVE ARTIFACTS (401-03 Mutation B), never an exit code or a
// message: the audit row's `outcome`, no run events, no build-ordinal ledger, zero requests at the
// target, and the reason read BACK off the row.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { invokeFunction } from '@vostride/agent-qa-agent'
import { RunDeniedError, createDispatchGrants } from '@vostride/agent-qa-agent-local'
import type { DispatchGrants } from '@vostride/agent-qa-agent-local'
import {
  getActiveExecutionContext,
  setActiveExecutionContextResolver,
} from '@vostride/agent-qa-safety'
import type { RunStartAcknowledgement, RunsStartInput } from '@vostride/agent-qa-schema'

import { CLI_FUNCTION_CALLER, composeCliLocalAgent } from '../local-agent-host.js'
import {
  CountingTarget,
  auditRows,
  buildOrdinalsExist,
  createInProcessFixture,
  eventTypes,
  runDirs,
} from './in-process-run-fixture.js'
import type { AuditRow } from './in-process-run-fixture.js'

/** The one field a consumed grant leaves on a row — the whole of the attribution claim. */
type GateAuditRow = AuditRow & { readonly trustSource?: string }

type Fixture = ReturnType<typeof createInProcessFixture>

/** The `run:start` rows, in run-dir order — one per run, each in its OWN file. */
function runGateRowsPerDir(fixture: Fixture): GateAuditRow[][] {
  return runDirs(fixture).map((dir) => {
    const path = join(dir, 'execution_audit.jsonl')
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as GateAuditRow)
      .filter((row) => row.action === 'run:start')
  })
}

/** The durable ledger this overlay must never write. */
function grantsLedgerBytes(fixture: Fixture): string | undefined {
  const path = join(fixture.project, 'agent-qa-knowledge', 'grants.jsonl')
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

/** An empty browsers root, so a member's failure is a property of the fixture, not of the machine. */
function pinEmptyBrowsersRoot(fixture: Fixture): void {
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(fixture.project, 'no-browsers')
}

/**
 * Invoke `runs.start` through the SHIPPED dispatcher, on a host composed with this overlay.
 *
 * `dispatchGrants` is the ONLY thing supplied beyond what 401-05's cells supply. The door resolves
 * the reader itself, per run, through the composition — which is the seam under test.
 */
async function invokeRunsStart(
  fixture: Fixture,
  dispatchGrants: DispatchGrants,
  request: RunsStartInput,
): Promise<{ ack?: RunStartAcknowledgement; error?: unknown }> {
  pinEmptyBrowsersRoot(fixture)
  const { registry } = composeCliLocalAgent({
    agentQaRoot: fixture.agentQaRoot,
    configPath: fixture.configPath,
    dispatchGrants,
    resolveExecutionContext: () => 'local-headless',
  })
  try {
    return {
      ack: await invokeFunction(
        registry,
        'runs.start',
        request,
        CLI_FUNCTION_CALLER,
      ) as RunStartAcknowledgement,
    }
  } catch (error) {
    return { error }
  }
}

// The ambient channels, varied against the door's own answer on 401-05's precedent: the arm that
// agrees with the harness's own posture passes for free.
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

describe('one human ask, N gated runs, every one of them gated (D-08)', () => {
  /** The start artifacts every arm below asserts, identically. */
  function expectStartedWithNoDecision(fixture: Fixture, outcome: { ack?: RunStartAcknowledgement; error?: unknown }): void {
    expect(outcome.error, `runs.start refused: ${String(outcome.error)}`).toBeUndefined()
    expect(outcome.error).not.toBeInstanceOf(RunDeniedError)
    expect(outcome.ack?.runId).toMatch(/^r_/)
    expect(runGateRowsPerDir(fixture).flat()).toEqual([])
    expect((auditRows(fixture) as GateAuditRow[]).map((row) => row.trustSource).filter(Boolean)).toEqual([])
  }

  it('THE ORDERING EDGE — two shared runs inside an open dispatch start, with no decision row', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'shared' })
      pinAmbient('local-interactive', false)
      const dispatchGrants = createDispatchGrants()
      const ledgerBefore = grantsLedgerBytes(fixture)

      const { first, second } = await dispatchGrants.within(async () => {
        const firstRun = await invokeRunsStart(fixture, dispatchGrants, { patterns: [fixture.testPattern] })
        const secondRun = await invokeRunsStart(fixture, dispatchGrants, { patterns: [fixture.testPattern] })
        return { first: firstRun, second: secondRun }
      })

      expectStartedWithNoDecision(fixture, first)
      expectStartedWithNoDecision(fixture, second)
      expect(first.ack?.runId).not.toBe(second.ack?.runId)
      expect(eventTypes(fixture)).toContain('runStarted')
      expect(buildOrdinalsExist(fixture)).toBe(true)

      // THE ONE-MINT LAW still holds: the overlay writes nothing durable.
      expect(grantsLedgerBytes(fixture)).toEqual(ledgerBefore)
      expect(dispatchGrants.openScopes).toBe(0)
    } finally {
      await target.close()
    }
  }, 300_000)

  it('THE SAME RUN WITHOUT THE DISPATCH — starts too: there was never a grant to need', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'shared' })
      pinAmbient('local-interactive', false)
      const dispatchGrants = createDispatchGrants()

      const outcome = await invokeRunsStart(fixture, dispatchGrants, { patterns: [fixture.testPattern] })

      expectStartedWithNoDecision(fixture, outcome)
      expect(eventTypes(fixture)).toContain('runStarted')
      expect(buildOrdinalsExist(fixture)).toBe(true)
      expect(target.hits).toEqual(['/in-process-thing'])
    } finally {
      await target.close()
    }
  }, 300_000)

  it('THE GRANT DIES WITH THE DISPATCH — and the run after it starts all the same', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'shared' })
      pinAmbient('local-interactive', false)
      const dispatchGrants = createDispatchGrants()

      await dispatchGrants.within(async () => {
        expect(dispatchGrants.openScopes).toBe(1)
        await Promise.resolve()
      })
      expect(dispatchGrants.openScopes).toBe(0)

      const outcome = await invokeRunsStart(fixture, dispatchGrants, { patterns: [fixture.testPattern] })

      expectStartedWithNoDecision(fixture, outcome)
      expect(eventTypes(fixture)).toContain('runStarted')
    } finally {
      await target.close()
    }
  }, 300_000)

  it('AN UNRELATED CALLER DURING AN OPEN DISPATCH — starts, and no row borrows the dispatch (CR-03)', async () => {
    // CR-03's claim was that an outsider could not collect a row byte-identical to the dispatch's
    // own. With no row written at all, there is nothing to borrow; the dispatch is held open while
    // the outsider's run starts so the scope is provably live throughout.
    const target = new CountingTarget()
    await target.listen()
    let release: (() => void) | undefined
    let dispatch: Promise<void> | undefined
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'shared' })
      pinAmbient('local-interactive', false)
      const dispatchGrants = createDispatchGrants()
      const ledgerBefore = grantsLedgerBytes(fixture)

      const held = new Promise<void>((resolve) => { release = resolve })
      dispatch = dispatchGrants.within(async () => { await held })
      await Promise.resolve()
      expect(dispatchGrants.openScopes).toBe(1)

      const outcome = await invokeRunsStart(fixture, dispatchGrants, { patterns: [fixture.testPattern] })

      expect(dispatchGrants.openScopes).toBe(1)
      expectStartedWithNoDecision(fixture, outcome)
      expect(eventTypes(fixture)).toContain('runStarted')
      expect(grantsLedgerBytes(fixture)).toEqual(ledgerBefore)

      release!()
      await dispatch
      expect(dispatchGrants.openScopes).toBe(0)
    } finally {
      release?.()
      await dispatch
      await target.close()
    }
  }, 300_000)
})
