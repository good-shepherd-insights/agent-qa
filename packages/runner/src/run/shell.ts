// The run shell — `startRun` and the RunSession it returns (D-01, SESSION-01/02/04/05). This is
// the run lifecycle every later surface attaches to: it owns the bus, seq, ordered member
// iteration, group-scoped fail-fast skip production (absorbed from suite/runner.ts:530-554),
// run-level cancel + wall-clock budget (D-03), the aggregate-verdict emission, and the one-per-run
// handoff assembly + persistence (D-17). It carries ZERO verdict logic (deriveMemberOutcome/
// deriveAggregateVerdict own it) and ZERO fs/provider access (validate:arch storageNeutral) —
// per-test execution stays behind the injected `executor` port, every I/O leg behind a run port.
//
// Terminal sequence is owned by ONE code path (RESEARCH Pitfall 7): compute the aggregate verdict,
// publish `verdict` EXACTLY once (before any post-processing event, SESSION-02), set the terminal
// status, assemble + persist the handoff (a store failure degrades with a runWarning and NEVER
// gates `done`, D-07), resolve `done` (which NEVER rejects, D-13/D-17), then publish `runFinished`
// LAST with `disposition: 'detached'` and `finalSeq` equal to its own seq, and close the bus.
//
// The nine post-processing chip events have no producer here (M1b/M2 own them, deferred).

import type {
  MaskFn,
  MaskingContext,
  MemberTestOutcome,
  PerTestOutcome,
  RunCompletion,
  RunSession,
  RunStatus,
} from '@vostride/agent-qa-schema'
import { CURRENT_BUS_SCHEMA_VERSION, projectTestFinished } from '@vostride/agent-qa-schema'
import { createRunEventBus } from './bus.js'
import { deriveAggregateVerdict, deriveMemberOutcome } from './verdict.js'
import { createMemberEventSink } from './event-sink.js'
import { assembleHandoff, assemblePerTestOutcome, skippedPerTestOutcome } from './handoff-assembly.js'
import type { MemberEvidenceContext, RunConfig } from './ports.js'
import type { TestResult } from '../result.js'

// Re-export the port contracts the Wave-0 `run-shell.test.ts` imports through `../shell.js`.
export type {
  RunConfig,
  RunMemberDescriptor,
  MemberTestExecutor,
  MemberTestRunContext,
} from './ports.js'

/** Identity masking used pre-362 when no run-scope MaskingContext is seeded (D-09). */
const IDENTITY_MASKING: MaskingContext = {
  mask: (text: string) => text,
  unmask: (text: string) => text,
}

/**
 * Start a run (D-01). Constructs the session SYNCHRONOUSLY — the bus, `runStarted` at seq 1, the
 * run-budget arm, the run-level AbortController — then kicks the async member-iteration loop whose
 * settled result feeds `done`. Returns the addressable {@link RunSession} immediately.
 */
export function startRun(config: RunConfig): RunSession {
  const masking = config.masking ?? IDENTITY_MASKING
  const mask: MaskFn = (text: string) => masking.mask(text)
  const ports = config.ports ?? {}
  const timer = ports.timer

  // The bus heartbeat runs on its own default clock — the injected `ports.timer` is reserved for
  // the run-budget so that firing it in a test is unambiguous (heartbeat re-arm on every publish
  // would otherwise clobber the budget on a single shared fake timer).
  const bus = createRunEventBus({ runId: config.runId, eventLog: ports.eventLog })

  const startedAt = timer?.now() ?? Date.now()

  // runStarted — seq 1, carrying the bus schema version + the D-04 header fields.
  bus.publish('runStarted', {
    busSchemaVersion: CURRENT_BUS_SCHEMA_VERSION,
    scope: config.scope,
    executionContext: config.executionContext,
    buildOrdinal: config.buildOrdinal,
    configDigests: config.configDigests,
    memberTestCount: config.members.length,
  })

  // D-08: stage the config + source artifact snapshot into the run dir once, right after
  // runStarted. Fire-and-forget (sync) — a store throw degrades with a runWarning and NEVER gates
  // the run (D-07). Absent store ⇒ no-op; absent snapshot ⇒ an empty (schema-version-only) stage.
  try {
    ports.runArtifactStore?.stage(config.runArtifact ?? {})
  } catch (error) {
    bus.publish('runWarning', {
      code: 'artifact-stage-failed',
      message: error instanceof Error ? error.message : String(error),
    })
  }

  let status: 'running' | RunStatus = 'running'
  let runCancelled = false
  let runBudgetExpired = false
  const runController = new AbortController()

  // Run-budget clock (D-03): expiry aborts the active member and rolls up to a `timeout` verdict.
  //
  // Pause-aware expiry (D-10, the run-budget half): human confirm time is never charged to the
  // app under test. When the budget fires but `ports.confirmPausedMs` reports human-confirm time
  // that has not yet been credited, re-arm for exactly the un-credited delta instead of aborting.
  // `creditedPauseMs` monotonically tracks what we have already extended for, so successive
  // confirms credit cumulatively and the delta is never double-counted. Absent supplier or an
  // unarmed budget ⇒ byte-identical to the one-shot abort. Each re-arm reassigns `cancelBudget`
  // so the terminal sequence's `cancelBudget?.()` still cancels the live handle.
  let cancelBudget: (() => void) | undefined
  if (config.runBudgetMs !== undefined && timer) {
    let creditedPauseMs = 0
    const onBudgetExpiry = (): void => {
      const pausedMs = ports.confirmPausedMs?.() ?? 0
      const uncreditedPauseMs = pausedMs - creditedPauseMs
      if (uncreditedPauseMs > 0) {
        creditedPauseMs = pausedMs
        cancelBudget = timer.schedule(uncreditedPauseMs, onBudgetExpiry)
        return
      }
      runBudgetExpired = true
      runController.abort()
    }
    cancelBudget = timer.schedule(config.runBudgetMs, onBudgetExpiry)
  }

  const done: Promise<RunCompletion> = (async (): Promise<RunCompletion> => {
    const outcomes: PerTestOutcome[] = []
    const memberOutcomes: MemberTestOutcome[] = []
    const poisonedGroups = new Set<string>()

    for (let i = 0; i < config.members.length; i += 1) {
      const member = config.members[i]
      const testIndex = member.testIndex ?? i
      const name = member.name ?? member.testId

      // Run aborted (cancel or budget) — skip the rest without invoking the executor (D-03).
      if (runController.signal.aborted) {
        const skip = skippedPerTestOutcome(member, testIndex)
        outcomes.push(skip)
        memberOutcomes.push('skipped')
        continue
      }

      // Group fail-fast (D-15): a poisoned same-group predecessor skips this member — shell-owned
      // skip production absorbed from suite/runner.ts:530-554; the executor is never invoked.
      if (member.failFastGroup !== undefined && poisonedGroups.has(member.failFastGroup)) {
        const skip = skippedPerTestOutcome(member, testIndex)
        outcomes.push(skip)
        memberOutcomes.push('skipped')
        bus.publish('testFinished', projectTestFinished(skip, mask))
        continue
      }

      // 363 D-01: enrich testStarted with the member descriptor's parity fields (filePath, suite
      // grouping, totalSteps). Suite grouping rides testStarted — the shell stays suite-agnostic
      // (no suite lifecycle events); reporters derive boundaries by watching the grouping change.
      // Absent optionals are omitted via conditional spread so no undefined-hole survives round-trip.
      // These are structural identity fields (not captured streams) — unmasked, matching testId/name.
      bus.publish('testStarted', {
        testId: member.testId,
        testIndex,
        name,
        ...(member.filePath !== undefined ? { filePath: member.filePath } : {}),
        ...(member.suiteId !== undefined ? { suiteId: member.suiteId } : {}),
        ...(member.suiteName !== undefined ? { suiteName: member.suiteName } : {}),
        ...(member.suiteIndex !== undefined ? { suiteIndex: member.suiteIndex } : {}),
        ...(member.suiteTotal !== undefined ? { suiteTotal: member.suiteTotal } : {}),
        ...(member.totalSteps !== undefined ? { totalSteps: member.totalSteps } : {}),
      })

      // Member abort chained to the run controller so run-level cancel/budget aborts the active test.
      const memberController = new AbortController()
      const onRunAbort = (): void => memberController.abort()
      if (runController.signal.aborted) memberController.abort()
      else runController.signal.addEventListener('abort', onRunAbort, { once: true })

      const events = createMemberEventSink({ bus, masking, testIndex })
      let evidenceContext: MemberEvidenceContext | undefined

      // Race the executor against member-abort (SESSION-04). A member wedged on a genuinely-
      // pending async op that never observes `ctx.abortSignal` (the planner's retry-without-image
      // window) would otherwise block `await config.executor(...)` forever, so `done` never settles,
      // the terminal sequence never runs, and `bus.close()` never clears the heartbeat — the live
      // Ctrl+C hang. Racing lets the loop finalize the wedged member as `cancelled` and reach the
      // ONE terminal sequence even when the executor never settles. The unit suite missed this
      // because its `abortableExecutor` resolves the instant abort fires (executor-settles branch).
      type RaceOutcome =
        | { kind: 'result'; result: TestResult }
        | { kind: 'error'; error: unknown }
        | { kind: 'aborted' }

      // The `.then(onResolve, onReject)` mapping attaches a rejection handler to the executor promise
      // synchronously, so a member that settles (or rejects) AFTER the run raced past it can never
      // surface as an unhandled rejection — the swallow is structural, no extra `.catch` needed.
      const executorRaced: Promise<RaceOutcome> = config
        .executor(member, {
          abortSignal: memberController.signal,
          testIndex,
          events,
          setEvidenceContext(context) {
            evidenceContext = context
          },
          evidenceArtifacts: ports.evidenceArtifacts,
        })
        .then(
          (r): RaceOutcome => ({ kind: 'result', result: r }),
          (error): RaceOutcome => ({ kind: 'error', error }),
        )

      let onMemberAbort: (() => void) | undefined
      const abortRaced: Promise<RaceOutcome> = memberController.signal.aborted
        ? Promise.resolve<RaceOutcome>({ kind: 'aborted' })
        : new Promise<RaceOutcome>((resolve) => {
            onMemberAbort = (): void => resolve({ kind: 'aborted' })
            memberController.signal.addEventListener('abort', onMemberAbort, { once: true })
          })

      let raced: RaceOutcome
      try {
        raced = await Promise.race([executorRaced, abortRaced])
      } finally {
        runController.signal.removeEventListener('abort', onRunAbort)
        if (onMemberAbort) memberController.signal.removeEventListener('abort', onMemberAbort)
      }

      let result: TestResult
      if (raced.kind === 'result') {
        result = raced.result
      } else if (raced.kind === 'error') {
        // An executor throw is never silent and never crashes the run (T-361-10): a runWarning
        // plus a synthesized failed result keep termination on the verdict + runFinished path.
        bus.publish('runWarning', {
          code: 'member-executor-error',
          message: raced.error instanceof Error ? raced.error.message : String(raced.error),
        })
        result = {
          name: member.testId,
          filePath: `${member.testId}.test.ts`,
          status: 'failed',
          steps: [],
          duration: 0,
        }
      } else {
        // Abort won the race — the member did not settle after run-level cancel/budget. Finalize it
        // as `cancelled` through the SAME deriveMemberOutcome/assemblePerTestOutcome helpers below so
        // the "exactly one handoff / verdict once / runFinished last" invariants stay intact. The
        // aggregate verdict is still run-level-first (deriveAggregateVerdict: cancel⇒cancelled,
        // budget⇒timeout), so this member's own 'cancelled' outcome never changes the aggregate.
        result = {
          name,
          filePath: `${member.testId}.test.ts`,
          status: 'cancelled',
          steps: [],
          duration: 0,
        }
      }

      const outcome = deriveMemberOutcome(result)
      if ((outcome === 'failed' || outcome === 'timeout') && member.failFastGroup !== undefined) {
        poisonedGroups.add(member.failFastGroup)
      }

      const perTest = assemblePerTestOutcome(member, result, outcome, {
        testIndex,
        scope: config.scope,
        buildOrdinal: config.buildOrdinal,
        mask,
        ...evidenceContext,
      })
      outcomes.push(perTest)
      memberOutcomes.push(outcome)
      // 363 D-01: enrich testFinished with the TestResult the shell already holds at assembly —
      // durationMs, retryCount, and the masked failureSummary (masked by projectTestFinished's
      // terminal walk, T-363-05). Absent optionals are omitted (Pitfall 2 — sourced from the runner
      // result, never new fields on the §A8 PerTestOutcome DTO).
      bus.publish(
        'testFinished',
        projectTestFinished(perTest, mask, {
          durationMs: result.duration,
          failureSummary: result.failureSummary,
          retryCount: result.retryCount,
        }),
      )
    }

    // ---- Terminal sequence — ONE owner (Pitfall 7) -------------------------------------------
    const verdict = deriveAggregateVerdict({ runCancelled, runBudgetExpired, outcomes: memberOutcomes })

    // verdict EXACTLY once, BEFORE any post-processing event (SESSION-02).
    bus.publish('verdict', { verdict })
    status = verdict

    const endedAt = timer?.now() ?? Date.now()
    const handoff = assembleHandoff(config, outcomes, verdict, { startedAt, endedAt })

    // Persist the one handoff; a store failure degrades with a runWarning and NEVER gates done (D-07).
    try {
      await ports.handoffStore?.save(handoff)
    } catch (error) {
      bus.publish('runWarning', {
        code: 'handoff-write-failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }

    // D-08: finalize the run artifact with the end timestamp before runFinished. Fire-and-forget
    // (sync) — a store throw degrades with a runWarning and NEVER gates done (D-07). The keep/drop
    // table drops the top-level runtime section, so only errors + finalizedAt are merged here.
    try {
      ports.runArtifactStore?.finalize({ finalizedAt: new Date(endedAt).toISOString() })
    } catch (error) {
      bus.publish('runWarning', {
        code: 'artifact-finalize-failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }

    // runFinished LAST, once, detached, finalSeq = its own seq (the next seq the bus will stamp).
    bus.publish('runFinished', {
      aggregateVerdict: verdict,
      disposition: 'detached',
      finalSeq: bus.currentSeq + 1,
    })

    cancelBudget?.()
    bus.close()

    return { verdict, handoff }
  })()

  return {
    id: config.runId,
    get status() {
      return status
    },
    executionContext: config.executionContext,
    subscribe: (fromSeq, handler) => bus.subscribe(fromSeq, handler),
    cancel(): void {
      // Run-level cancel (D-03): abort the active member, skip the rest, aggregate `cancelled`.
      runCancelled = true
      runController.abort()
    },
    done,
  }
}
