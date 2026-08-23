// D-08's DISPATCH GRANT AT THE REAL RUN GATE (Phase 401 plan 08 — RESEARCH Pitfall 6).
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

function theRunGateRow(fixture: Fixture): GateAuditRow {
  const rows = (auditRows(fixture) as GateAuditRow[]).filter((row) => row.action === 'run:start')
  expect(rows).toHaveLength(1)
  return rows[0]!
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
  it('THE ORDERING EDGE — an open dispatch satisfies TWO ask-tier runs in a fail-closed context', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      // `shared` is the ask tier; `local-headless` is fail-closed. Without the grant this run
      // denies at step (d), which is exactly what the negative control below measures.
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'shared' })
      pinAmbient('local-interactive', false)
      const dispatchGrants = createDispatchGrants()
      const ledgerBefore = grantsLedgerBytes(fixture)

      // 401-13: the two runs are started INSIDE the dispatch's own scope, which is what makes them
      // the dispatch's OWN gate-runs rather than merely concurrent with it. Every await between
      // here and `grantsFor` — `invokeFunction`, the op gate, the bound invocation, the async
      // `resolveRunGrants`, the core's `evaluate()` — is inside this callback's async tree, and a
      // green here is the measurement that the scope reaches all of them.
      const { first, second } = await dispatchGrants.within(async () => {
        const firstRun = await invokeRunsStart(fixture, dispatchGrants, { patterns: [fixture.testPattern] })
        const secondRun = await invokeRunsStart(fixture, dispatchGrants, { patterns: [fixture.testPattern] })
        return { first: firstRun, second: secondRun }
      })

      expect(first.error).toBeUndefined()
      expect(second.error).toBeUndefined()
      expect(first.ack?.runId).not.toBe(second.ack?.runId)

      // N RUNS, N ROWS, EACH IN ITS OWN FILE. Not one row with a count on it and not a single
      // aggregate: D-08's sentence is that every child run is still gated and attributable, so the
      // proof is one `run:start` decision per run dir.
      const perDir = runGateRowsPerDir(fixture).filter((rows) => rows.length > 0)
      expect(perDir).toHaveLength(2)
      for (const rows of perDir) {
        expect(rows).toHaveLength(1)
        expect(rows[0]!.outcome).toBe('proceeded')
        expect(rows[0]!.verdict).toBe('allow')
        // THE ATTRIBUTION. `standing-approval` is what `resolveAsk` stamps at step (c) — so this
        // is not merely "the run was allowed", it is "the run was allowed BY THE GRANT". A run
        // allowed on its tier would read `proceeded` with no `trustSource` at all.
        expect(rows[0]!.trustSource).toBe('standing-approval')
        expect(rows[0]!.riskTier).toBe('mutating-shared')
        expect(rows[0]!.executionContext).toBe('local-headless')
      }

      // NO STRUCTURAL BYPASS. Two rows exist because two runs called `evaluate()`; a grant that
      // made a run skip the gate would leave the run dirs with events and NO decision in them.
      expect(eventTypes(fixture)).toContain('runStarted')

      // THE ONE-MINT LAW. `grants.jsonl` has exactly one writer and this overlay is not it: the
      // dispatch grant lives in memory and dies with the closure.
      expect(grantsLedgerBytes(fixture)).toEqual(ledgerBefore)
      expect(dispatchGrants.openScopes).toBe(0)
    } finally {
      await target.close()
    }
  }, 300_000)

  it('THE SAME RUN WITHOUT THE DISPATCH — fail-closed, on all five artifacts', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      // Everything above, minus `dispatchGrants.open()`. One field different.
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'shared' })
      pinAmbient('local-interactive', false)
      const dispatchGrants = createDispatchGrants()

      const { ack, error } = await invokeRunsStart(
        fixture,
        dispatchGrants,
        { patterns: [fixture.testPattern] },
      )

      expect(ack).toBeUndefined()
      expect(error).toBeInstanceOf(RunDeniedError)
      const denial = error as RunDeniedError
      expect(denial.remedies.length).toBeGreaterThan(0)

      // (a) the row's OUTCOME field, never a message substring
      const row = theRunGateRow(fixture)
      expect(row.outcome).toBe('fail-closed-denied')
      expect(row.verdict).toBe('deny')
      expect(row.trustSource).toBeUndefined()
      // (b) no run events — nothing started
      expect(eventTypes(fixture)).toEqual([])
      // (c) the build-ordinal ledger did not advance
      expect(buildOrdinalsExist(fixture)).toBe(false)
      // (d) nobody knocked on the target
      expect(target.hits).toEqual([])
      // (e) the reason the caller sees is the row's own, read BACK off it rather than typed here
      expect(denial.reason).toBe(row.reason)
    } finally {
      await target.close()
    }
  }, 300_000)

  it('THE GRANT DIES WITH THE DISPATCH — the same run denies again once the scope closes', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'shared' })
      pinAmbient('local-interactive', false)
      const dispatchGrants = createDispatchGrants()

      // The dispatch happened and ENDED. T-401-22: an approval that outlived its dispatch would be
      // an elevation with no expiry, and since 401-13 the scope's own `finally` is what closes it —
      // the loop can no longer forget to.
      await dispatchGrants.within(async () => {
        expect(dispatchGrants.openScopes).toBe(1)
        await Promise.resolve()
      })
      expect(dispatchGrants.openScopes).toBe(0)

      const { ack, error } = await invokeRunsStart(
        fixture,
        dispatchGrants,
        { patterns: [fixture.testPattern] },
      )

      expect(ack).toBeUndefined()
      expect(error).toBeInstanceOf(RunDeniedError)
      const row = theRunGateRow(fixture)
      expect(row.outcome).toBe('fail-closed-denied')
      expect(row.trustSource).toBeUndefined()
      expect(eventTypes(fixture)).toEqual([])
      expect(buildOrdinalsExist(fixture)).toBe(false)
      expect(target.hits).toEqual([])
    } finally {
      await target.close()
    }
  }, 300_000)

  it('AN UNRELATED CALLER DURING AN OPEN DISPATCH — refused, on all five artifacts (CR-03)', async () => {
    // THE CELL THIS FILE NEVER HAD, and the one the verification gap is about. Its RED is recorded
    // verbatim in 401-13's SUMMARY: on the pre-fix overlay this exact scene produced
    //   {"outcome":"proceeded","verdict":"allow","trustSource":"standing-approval",
    //    "riskTier":"mutating-shared","executionContext":"local-headless"}
    // — a caller that had approved nothing collecting a row byte-identical to one that had, which
    // is what made the widening unattributable in the record.
    //
    // NOT AN EXPIRY MEASUREMENT. The dispatch is parked on an externally-released promise and
    // `openScopes` is asserted to be 1 at the moment the outsider is refused, so the denial cannot
    // be explained by "the dispatch had already ended" — the difference is the CALLER and nothing
    // else. `THE GRANT DIES WITH THE DISPATCH` above is where expiry is measured.
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

      // The outsider: an async context that never entered the scope above. Nothing about this call
      // differs from the positive arm's two except where it was made from.
      const { ack, error } = await invokeRunsStart(
        fixture,
        dispatchGrants,
        { patterns: [fixture.testPattern] },
      )

      // THE GATE WAS REACHED, asserted BEFORE any verdict claim. "Denied" and "never got there"
      // produce the same-looking absence on every one of the five artifacts below, and 401-12
      // shipped a fixture an hour ago that read `auditRows: []` on both legs because it died at
      // config validation. A `run:start` row carrying a real `riskTier` is the proof that the
      // decision under test was actually taken.
      const row = theRunGateRow(fixture)
      expect(row.riskTier).toBe('mutating-shared')
      expect(row.executionContext).toBe('local-headless')

      // AND THE DISPATCH IS STILL OPEN as the denial lands.
      expect(dispatchGrants.openScopes).toBe(1)

      // The five artifacts (401-03 Mutation B), never an exit code or a message substring.
      expect(ack).toBeUndefined()
      expect(error).toBeInstanceOf(RunDeniedError)
      const denial = error as RunDeniedError
      expect(denial.remedies.length).toBeGreaterThan(0)
      // (a) the row's OUTCOME field — and NO attribution on it, which is the repudiation half
      expect(row.outcome).toBe('fail-closed-denied')
      expect(row.verdict).toBe('deny')
      expect(row.trustSource).toBeUndefined()
      // (b) no run events — nothing started
      expect(eventTypes(fixture)).toEqual([])
      // (c) the build-ordinal ledger did not advance
      expect(buildOrdinalsExist(fixture)).toBe(false)
      // (d) nobody knocked on the target
      expect(target.hits).toEqual([])
      // (e) the reason the caller sees is the row's own, read BACK off it rather than typed here
      expect(denial.reason).toBe(row.reason)

      // The overlay minted nothing durable while refusing, either.
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
