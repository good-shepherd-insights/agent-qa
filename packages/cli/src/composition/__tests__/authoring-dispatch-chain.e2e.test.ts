// D-08's WHOLE CHAIN, DRIVEN FROM THE AUTHORING LOOP (Phase 401 — UAT item 9, review finding WR-03).
//
// RE-SPELLED 2026-09-30 (432-13, D-14/D-15). The chain below ended in the run core's `evaluate()`
// reading the dispatch grant; neither the op gate nor the run gate exists any more. What this file
// still drives end to end is the same composed road — `authoring.draft.write` → the loop → its gate
// runs → `runs.start` → the in-process drive — and it now pins that nobody is asked anywhere on it,
// that the loop still spends its gate runs, that a run started from outside the dispatch starts the
// same way, and that the overlay still mints nothing durable. The history below is kept as written.
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

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { invokeFunction } from '@vostride/agent-qa-agent'
import { RunDeniedError, createDispatchGrants } from '@vostride/agent-qa-agent-local'
import type { DispatchGrants } from '@vostride/agent-qa-agent-local'
import { generateTestId } from '@vostride/agent-qa-ids'
import { DRAFT_STABILITY_RUNS_N, authoredSuiteTargetPath } from '@vostride/agent-qa-schema'
import type { RiskActionDescriptor } from '@vostride/agent-qa-schema'

import { CLI_FUNCTION_CALLER, composeCliLocalAgent } from '../local-agent-host.js'
import { CountingTarget, createInProcessFixture, runDirs } from './in-process-run-fixture.js'
import { IN_PROCESS_TARGET_NAME } from './in-process-run-fixture.js'

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
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'shared' })
      process.env.PLAYWRIGHT_BROWSERS_PATH = join(fixture.project, 'no-browsers')

      const dispatchGrants: DispatchGrants = createDispatchGrants()
      const ledgerBefore = grantsLedgerBytes(fixture)

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

      // A confirm that records every ask and refuses it: since 432-13 it must never be consulted.
      const asked: string[] = []
      const { registry } = composeCliLocalAgent({
        agentQaRoot: fixture.agentQaRoot,
        configPath: fixture.configPath,
        dispatchGrants,
        resolveExecutionContext: () => 'local-interactive',
        // 432-16 (D-14): the input declares no confirm, so the recording port is smuggled past the
        // type; nothing may read it.
        ...{
          confirm: {
            surface: 'tty-prompt',
            ask: (action: RiskActionDescriptor) => {
              asked.push(action.name)
              return false
            },
          },
        } as object,
        model: () => ({
          modelId: 'fixture:authoring-dispatch-chain',
          generate: () => Promise.resolve({ text: MODEL_DOCUMENT }),
        }) as never,
      })

      const answered = await invokeFunction(
        registry,
        'authoring.draft.write',
        { intent: 'Check that submitting the in-process thing shows the confirmation banner' },
        CLI_FUNCTION_CALLER,
      ) as {
        readonly outcome: string
        readonly draftRef?: { readonly filePath: string; readonly testName: string }
        readonly receipt: { readonly disposition: string; readonly gateRuns: readonly { readonly runId: string }[] }
        readonly written?: { readonly file: { readonly kind: string; readonly filePath?: string } }
      }
      const gateRunIds = answered.receipt.gateRuns.map((run) => run.runId)

      // ---- (1) NOBODY WAS ASKED ----------------------------------------------------------------
      expect(asked).toEqual([])

      // ---- (2) N GATE RUNS, AND NO DECISION ROW FOR ANY OF THEM --------------------------------
      expect(gateRunIds.length).toBeGreaterThanOrEqual(DRAFT_STABILITY_RUNS_N)
      expect(gateRows(fixture)).toEqual([])
      for (const runId of gateRunIds) {
        expect(runDirs(fixture).map((dir) => dir.split('/').pop())).toContain(runId)
      }

      // ---- (2b) 432 D-06: THE FINAL WRITE, THROUGH THE REAL HOST WRITER ------------------------
      const suiteTarget = authoredSuiteTargetPath(
        answered.draftRef?.filePath ?? 'tests/.agent-qa-drafts/none.yaml',
        answered.draftRef?.testName ?? 'none',
      )
      if (answered.outcome === 'drafted' || answered.outcome === 'repaired') {
        const writes = answered.receipt.disposition !== 'rejected'
        expect(answered.written?.file.kind).toBe(writes ? 'written' : 'not-written')
        expect(existsSync(join(fixture.project, suiteTarget))).toBe(writes)
        if (writes) {
          expect(answered.written?.file.filePath).toBe(suiteTarget)
          expect(readFileSync(join(fixture.project, suiteTarget))
            .equals(readFileSync(join(fixture.project, answered.draftRef!.filePath)))).toBe(true)
        }
      } else {
        expect(answered.written).toBeUndefined()
        expect(existsSync(join(fixture.project, suiteTarget))).toBe(false)
      }

      // ---- (3) A RUN FROM OUTSIDE THE DISPATCH STARTS THE SAME WAY -----------------------------
      expect(dispatchGrants.openScopes).toBe(0)
      const outsider = await probe()
      expect(outsider.error).toBeUndefined()
      expect(outsider.error).not.toBeInstanceOf(RunDeniedError)
      expect(outsider.ack?.runId).toMatch(/^r_/)
      expect(gateRows(fixture)).toEqual([])

      // THE ONE-MINT LAW. `grants.jsonl` has exactly one writer and this overlay is not it.
      expect(grantsLedgerBytes(fixture)).toEqual(ledgerBefore)
    } finally {
      await target.close()
    }
  }, 300_000)

  // 432-04 (D-18): the same composed chain, with the fixture's one target declared production and
  // no opt-in. The confirm approves EVERYTHING, so the old run gate cannot be what stops a run: the
  // only refusal left on the path is the core's production refusal, reached from the loop's first
  // gate run. Nothing starts — no run directory, no gate row, no knock on the target — and since
  // 432-13 the person is not asked at all.
  it('a production target refuses the loop at its first gate run: no run starts and the target is never reached', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'shared' })
      const shared = readFileSync(fixture.configPath, 'utf8')
      const production = shared.replace('      environment: shared\n', '      environment: production\n')
      expect(production).not.toBe(shared)
      writeFileSync(fixture.configPath, production)
      process.env.PLAYWRIGHT_BROWSERS_PATH = join(fixture.project, 'no-browsers')

      const asked: string[] = []
      const { registry } = composeCliLocalAgent({
        agentQaRoot: fixture.agentQaRoot,
        configPath: fixture.configPath,
        resolveExecutionContext: () => 'local-interactive',
        // 432-16 (D-14): the input declares no confirm, so the recording port is smuggled past the
        // type; nothing may read it.
        ...{
          confirm: {
            surface: 'tty-prompt',
            ask: (action: RiskActionDescriptor) => {
              asked.push(action.name)
              return true
            },
          },
        } as object,
        model: () => ({
          modelId: 'fixture:authoring-dispatch-chain',
          generate: () => Promise.resolve({ text: MODEL_DOCUMENT }),
        }) as never,
      })

      let thrown: unknown
      try {
        await invokeFunction(
          registry,
          'authoring.draft.write',
          { intent: 'Check that submitting the in-process thing shows the confirmation banner' },
          CLI_FUNCTION_CALLER,
        )
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RunDeniedError)
      const denial = thrown as RunDeniedError
      expect(denial.reason).toContain(`"${IN_PROCESS_TARGET_NAME}"`)
      expect(denial.reason).toContain('environment: production')
      expect(denial.reason).toContain('allowProduction: true')
      expect(denial.remedies).toEqual([])
      // 432-13: not even the dispatch is put to the person now.
      expect(asked).toEqual([])
      // Nothing started: no run directory, so no gate row, and nobody knocked on the target.
      expect(runDirs(fixture)).toEqual([])
      expect(gateRows(fixture)).toEqual([])
      expect(target.hits).toEqual([])
    } finally {
      await target.close()
    }
  }, 300_000)
})
