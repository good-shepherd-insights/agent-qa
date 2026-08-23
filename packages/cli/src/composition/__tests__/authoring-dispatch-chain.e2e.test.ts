// D-08's WHOLE CHAIN, DRIVEN FROM THE AUTHORING LOOP (Phase 401 — UAT item 9, review finding WR-03).
//
// WHAT WAS UNMEASURED BEFORE THIS FILE. Two cells shipped in 401-13 and neither of them drives the
// segment D-08's benefit actually rests on:
//
//   `agent/src/authoring/__tests__/dispatch-grant-scope.test.ts` binds a FAKE `within` that pushes
//   `'enter'`/`'exit'` onto a trace. It asserts trace ORDERING. There is no `AsyncLocalStorage` in
//   it at all, so it cannot observe a lost store.
//
//   `composition/__tests__/dispatch-grant-gate.e2e.test.ts` uses the REAL overlay, but its positive
//   arm calls `invokeRunsStart(...)` from the test body inside `dispatchGrants.within(...)`. It
//   measures the run door's own frames — which is genuinely valuable — and never enters through
//   `runAuthoringLoop`.
//
// So the invariant CR-03's fix introduced — the store set at `loop.ts`'s `scope.within(dispatch)`
// must survive every frame down to `dispatch-grants.ts`'s `grantsFor` — held only by inspection.
// A queue, a worker hop, an `EventEmitter` listener or a stored callback introduced anywhere on
// that chain would revert D-08 to "one human ask, N refusals" and both cells would stay green.
//
// WHAT THIS FILE DRIVES, end to end, with nothing on the grant path substituted:
//
//   invokeFunction('authoring.draft.write')   ← the ONE human ask, at the op gate
//     → runAuthoringLoop  (brief, dedup, compile, D-18 refinement, credential screen)
//       → scope.within(dispatch)              ← loop.ts — the store is set HERE
//         → runAuthoringLoopDispatch → shelf.verifyDraft
//           → invokeFunction('authoring.draft.verify') → openEvaluation → evaluateDraft
//             → runStabilityGates → draftShelf.runs.start
//               → invokeFunction('runs.start') → createLocalRunInvocation.start
//                 → local-agent-host's `execute` — TWO `await import`s and
//                   `await resolveRunInvocationInputs`, the frames WR-03 names by line
//                   → runInProcessCliRun → the core's ONE `evaluate()`
//                     → resolveAsk step (c) → grantsFor                ← the store is READ here
//
// THE ONLY SUBSTITUTIONS ARE THE MODEL AND THE CONFIRM, and neither is on that path. The model is
// a fixture document (the loop must not reach a live LLM); the confirm is a recording port, which
// is how "exactly one human ask" becomes a countable fact rather than a claim.
//
// THE CONFIRM PORT IS WHAT MAKES THE POSITIVE ARM FALSIFIABLE, and that is the whole reason this
// cell runs the dispatch in `local-interactive` rather than in `local-headless`. It approves
// `fn:authoring.draft.write` and REFUSES everything else. So if the store were lost anywhere on the
// chain above, each gate run would fall past step (c) to step (e), be refused, and record
// `prompted-denied` — a red, on the row, naming the failure. A confirm that said yes to everything
// would have made a broken chain indistinguishable from a working one.
//
// AND THE TWO CALLERS ARE ASKED AT ONE INSTANT, THROUGH ONE HOST (401-13's own two-sided law). The
// probe host is composed once, `local-headless`, with no confirm — a caller it cannot satisfy is
// fail-closed. It is driven twice while the dispatch is provably open:
//
//   from INSIDE  the dispatch's own tree (a gate run's `flush`)  → allowed, `standing-approval`
//   from OUTSIDE it (this test body)                             → `fail-closed-denied`
//
// One overlay, one host, one moment, two answers. Either half alone is satisfied by a degenerate
// implementation: an overlay that granted everybody passes the first, and one that granted nobody
// passes the second.
//
// HOW THE MOMENT IS HELD, and why it is not a sleep. `runBridge.subscribers` is a shipped seam —
// the drive awaits `flush()` at the end of a run — so the first gate run's `flush` parks on a
// promise this test body resolves. The dispatch is therefore blocked INSIDE its own tree while both
// probes are taken, and `openScopes` is asserted at both. Nothing about the grant path is faked by
// this: `flush` neither supplies nor forwards a reader, it only holds the frame still.
//
// A DENIAL AND A NEVER-GOT-THERE LOOK IDENTICAL, so the gate is asserted REACHED — a `run:start`
// row that EXISTS and carries a real `riskTier` — before any verdict claim is made about it.
// 401-12 shipped a fixture that read `auditRows: []` on both legs because it died at config
// validation: a perfect vacuous green.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { invokeFunction } from '@vostride/agent-qa-agent'
import { RunDeniedError, createDispatchGrants } from '@vostride/agent-qa-agent-local'
import type { DispatchGrants } from '@vostride/agent-qa-agent-local'
import { generateTestId } from '@vostride/agent-qa-ids'
import { DRAFT_STABILITY_RUNS_N } from '@vostride/agent-qa-schema'
import type { RiskActionDescriptor } from '@vostride/agent-qa-schema'

import { CLI_FUNCTION_CALLER, composeCliLocalAgent } from '../local-agent-host.js'
import { CountingTarget, createInProcessFixture, runDirs } from './in-process-run-fixture.js'
import { IN_PROCESS_TARGET_NAME } from './in-process-run-fixture.js'

/** The one action a person approves here — D-03's single ask, spelled as the gate names it. */
const THE_ONE_ASK = 'fn:authoring.draft.write'

/**
 * The draft the fixture model returns.
 *
 * It names the fixture's OWN target through the fixture's own constant, so a rename cannot leave
 * this cell authoring against a target the project does not declare.
 */
const MODEL_DOCUMENT = [
  `test-id: ${generateTestId()}`,
  'name: Submit the in-process thing',
  `target: ${IN_PROCESS_TARGET_NAME}`,
  'steps:',
  '  - Click the Submit button',
  '  - Verify the page says "Example"',
  '',
].join('\n')

type Fixture = ReturnType<typeof createInProcessFixture>

interface GateRow {
  readonly action?: string
  readonly outcome?: string
  readonly verdict?: string
  readonly trustSource?: string
  readonly riskTier?: string
  readonly runId?: string
  readonly executionContext?: string
  readonly reason?: string
}

/** Every `run:start` decision this project recorded, each read out of its own run dir. */
function gateRows(fixture: Fixture): GateRow[] {
  return runDirs(fixture).flatMap((dir) => {
    const path = join(dir, 'execution_audit.jsonl')
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as GateRow)
      .filter((row) => row.action === 'run:start')
  })
}

function rowFor(fixture: Fixture, runId: string): GateRow {
  const rows = gateRows(fixture).filter((row) => row.runId === runId)
  expect(rows).toHaveLength(1)
  return rows[0]!
}

/** The durable ledger this overlay must never write. */
function grantsLedgerBytes(fixture: Fixture): string | undefined {
  const path = join(fixture.project, 'agent-qa-knowledge', 'grants.jsonl')
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

interface ProbeResult {
  readonly ack?: { readonly runId: string }
  readonly error?: unknown
}

describe('one human ask, N gated runs, driven from the authoring loop (D-08 · UAT 9 · WR-03)', () => {
  it('THE STORE SURVIVES EVERY PRODUCTION FRAME — and reaches nobody outside the dispatch', async () => {
    const target = new CountingTarget()
    await target.listen()
    let releaseProbes: (() => void) | undefined
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'shared' })
      // An empty browsers root, so a member's failure is a property of the fixture and not of the
      // machine. The runs still START, which is the only thing the run gate decides about.
      process.env.PLAYWRIGHT_BROWSERS_PATH = join(fixture.project, 'no-browsers')

      // ONE overlay, shared by both compositions. This is the shape `compose-local-agent`'s own
      // doc names: a composition root that wants ONE dispatch scope across the agents it composes.
      const dispatchGrants: DispatchGrants = createDispatchGrants()
      const ledgerBefore = grantsLedgerBytes(fixture)

      // THE PROBE HOST. Composed ONCE, before the dispatch opens, so nothing about the probe's own
      // construction can be inside anybody's async tree. `local-headless` with no confirm port: an
      // ask this host cannot satisfy at step (c) is fail-closed at step (d).
      const { registry: probeRegistry } = composeCliLocalAgent({
        agentQaRoot: fixture.agentQaRoot,
        configPath: fixture.configPath,
        dispatchGrants,
        resolveExecutionContext: () => 'local-headless',
      })
      const probe = async (): Promise<ProbeResult> => {
        try {
          return {
            ack: await invokeFunction(
              probeRegistry,
              'runs.start',
              { patterns: [fixture.testPattern] },
              CLI_FUNCTION_CALLER,
            ) as { runId: string },
          }
        } catch (error) {
          return { error }
        }
      }

      let signalDispatchLive: (() => void) | undefined
      const dispatchLive = new Promise<void>((resolve) => { signalDispatchLive = resolve })
      const probesDone = new Promise<void>((resolve) => { releaseProbes = resolve })
      let flushes = 0
      let insider: ProbeResult | undefined
      let openScopesAtInsider = -1

      const asked: string[] = []
      const { registry } = composeCliLocalAgent({
        agentQaRoot: fixture.agentQaRoot,
        configPath: fixture.configPath,
        dispatchGrants,
        resolveExecutionContext: () => 'local-interactive',
        // Approves the ONE ask and refuses everything else — see the header. This is the control
        // that makes a lost store a red rather than a silent second prompt.
        confirm: (action: RiskActionDescriptor) => {
          asked.push(action.name)
          return action.name === THE_ONE_ASK
        },
        model: () => ({
          modelId: 'fixture:authoring-dispatch-chain',
          generate: () => Promise.resolve({ text: MODEL_DOCUMENT }),
        }) as never,
        runBridge: {
          // The shipped subscriber seam, used to HOLD A FRAME STILL and for nothing else. The
          // drive awaits this `flush()` at the end of a run, so parking here parks the dispatch
          // inside its own call tree with `openScopes` at 1 and both probes still to take.
          subscribers: () => ({
            flush: async (): Promise<void> => {
              flushes += 1
              if (flushes !== 1) return
              // THE INSIDER. The same probe host, driven from inside the dispatch's own tree.
              insider = await probe()
              openScopesAtInsider = dispatchGrants.openScopes
              signalDispatchLive!()
              await probesDone
            },
          }),
        },
      })

      const authoring = invokeFunction(
        registry,
        'authoring.draft.write',
        { intent: 'Check that submitting the in-process thing shows the confirmation banner' },
        CLI_FUNCTION_CALLER,
      ) as Promise<{ readonly receipt: { readonly gateRuns: readonly { readonly runId: string }[] } }>
      const settled = authoring.then(
        (value) => ({ value }),
        (thrown: unknown) => ({ thrown }),
      )

      // The window opens when a gate run parks. A dispatch that ended first would make every
      // assertion below vacuous, so that race is a LOUD failure rather than a skipped probe.
      await Promise.race([
        dispatchLive,
        settled.then(() => {
          // THE GUARD REPORTS WHY. A lost store denies the FIRST gate run, so no run ever reaches
          // `flush` and the window never opens — this is the shape a continuity break takes here,
          // and a bare "window never opened" would send a reader looking at the harness instead of
          // at the chain. The two facts that discriminate are the confirm ledger and the rows.
          throw new Error(
            'the dispatch closed before the probe window opened — asks: '
            + `${JSON.stringify(asked)}; run:start rows: `
            + JSON.stringify(gateRows(fixture).map((row) => ({
              outcome: row.outcome, trustSource: row.trustSource, context: row.executionContext,
            }))),
          )
        }),
      ])

      const hitsBeforeProbe = target.hits.length
      const openBeforeProbe = dispatchGrants.openScopes
      const outsider = await probe()
      const openAfterProbe = dispatchGrants.openScopes
      const hitsAfterProbe = target.hits.length
      releaseProbes!()
      releaseProbes = undefined

      const result = await settled as {
        readonly value?: { readonly receipt: { readonly gateRuns: readonly { readonly runId: string }[] } }
        readonly thrown?: unknown
      }
      expect(result.thrown).toBeUndefined()
      const gateRunIds = result.value!.receipt.gateRuns.map((run) => run.runId)

      // ---- (1) ONE HUMAN ASK -------------------------------------------------------------------
      // The dispatch confirm fired exactly once, and `run:start` was never put to a person at all.
      // A chain that lost the store would show N more entries here, every one of them `run:start`.
      expect(asked).toEqual([THE_ONE_ASK])

      // ---- (2) N GATE RUNS, EVERY ONE OF THEM ATTRIBUTED ---------------------------------------
      // The loop actually spent runs — an empty receipt would make the rest of this cell vacuous.
      expect(gateRunIds.length).toBeGreaterThanOrEqual(DRAFT_STABILITY_RUNS_N)
      for (const runId of gateRunIds) {
        const row = rowFor(fixture, runId)
        // REACHED before decided: a real tier on a row that exists.
        expect(row.riskTier).toBe('mutating-shared')
        expect(row.outcome).toBe('proceeded')
        expect(row.verdict).toBe('allow')
        // THE ATTRIBUTION, and the whole of D-08's claim: allowed BY THE GRANT, at step (c). A run
        // allowed by the confirm would read `prompted-approved`/`tty-prompt`; one that fell past
        // (c) with this confirm port would read `prompted-denied`.
        expect(row.trustSource).toBe('standing-approval')
        expect(row.executionContext).toBe('local-interactive')
      }

      // ---- (3) THE TWO CALLERS, AT ONE INSTANT -------------------------------------------------
      // The dispatch was open for both, and open at 1 — so no answer below is explained by expiry.
      expect(openScopesAtInsider).toBe(1)
      expect(openBeforeProbe).toBe(1)
      expect(openAfterProbe).toBe(1)

      // THE INSIDER. Same host, same overlay, `local-headless` — the context that fail-closes —
      // and it PROCEEDS, on the grant, because the call was made inside the dispatch's own tree.
      // This is what proves the store reaches all the way through a gate run's own frames.
      expect(insider?.error).toBeUndefined()
      const insiderRow = rowFor(fixture, insider!.ack!.runId)
      expect(insiderRow.riskTier).toBe('mutating-shared')
      expect(insiderRow.executionContext).toBe('local-headless')
      expect(insiderRow.outcome).toBe('proceeded')
      expect(insiderRow.trustSource).toBe('standing-approval')

      // THE OUTSIDER. Everything above, differing in exactly one thing: where the call was made
      // from. The five denial artifacts (401-03 Mutation B), never an exit code or a message.
      expect(outsider.ack).toBeUndefined()
      expect(outsider.error).toBeInstanceOf(RunDeniedError)
      const denial = outsider.error as RunDeniedError
      expect(denial.remedies.length).toBeGreaterThan(0)
      const outsiderRow = gateRows(fixture).find((row) => row.outcome === 'fail-closed-denied')!
      // (a) reached, then refused — and NO attribution on the row, which is the repudiation half
      expect(outsiderRow.riskTier).toBe('mutating-shared')
      expect(outsiderRow.executionContext).toBe('local-headless')
      expect(outsiderRow.verdict).toBe('deny')
      expect(outsiderRow.trustSource).toBeUndefined()
      // (b) the refusal reached the caller as the row's OWN reason, read back off it
      expect(denial.reason).toBe(outsiderRow.reason)
      // (c) nothing was started for it — no run dir of its own carries an event
      expect(gateRows(fixture).filter((row) => row.runId === outsiderRow.runId)).toHaveLength(1)
      // (d) nobody knocked on the target on its behalf. A DELTA rather than an absolute: the
      //     dispatch's own runs are live in this same project and do knock.
      expect(hitsAfterProbe).toBe(hitsBeforeProbe)
      // (e) it never became a human ask either — the confirm ledger is still the one entry
      expect(asked).toEqual([THE_ONE_ASK])

      // ---- (4) THE GRANT DIES WITH THE DISPATCH ------------------------------------------------
      expect(dispatchGrants.openScopes).toBe(0)
      const afterClose = await probe()
      expect(afterClose.ack).toBeUndefined()
      expect(afterClose.error).toBeInstanceOf(RunDeniedError)
      const afterCloseRows = gateRows(fixture).filter((row) => row.outcome === 'fail-closed-denied')
      expect(afterCloseRows).toHaveLength(2)
      for (const row of afterCloseRows) expect(row.trustSource).toBeUndefined()

      // THE ONE-MINT LAW. `grants.jsonl` has exactly one writer and this overlay is not it.
      expect(grantsLedgerBytes(fixture)).toEqual(ledgerBefore)
    } finally {
      releaseProbes?.()
      await target.close()
    }
  }, 300_000)
})
