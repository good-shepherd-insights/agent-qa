// THE IN-PROCESS EXECUTION BACKEND (Phase 401 plan 07 — D-01/D-04/D-09/D-12, INVK-01).
//
// WHAT THIS REPLACES. `TestRunner` started a dashboard run by SPAWNING `agent-qa run` and learned
// what happened by scraping `AGENT_QA_EVENT:<json>` lines off the child's stdout. Everything a
// caller could not express became an argv operand, every policy denial died in the child's stderr,
// and liveness had to be inferred from silence — hence a staleness timer and a `treeKill`. This
// backend starts the run IN THIS PROCESS through the gated `runs.start` op and subscribes the
// started run's `RunSession` bus. There is no child, so there is nothing to scrape, nothing to
// SIGKILL and no process group to walk.
//
// THE CONSUMER SURFACE IS UNTOUCHED, AND THAT IS THE POINT (D-09's build-order pin). The per-run
// buffer, the monotonic `id`, the `run-start` / `run-complete` bookends and the `execution-event`
// emission are byte-for-byte what the scrape produced — pinned by a golden captured from the OLD
// wire before it was deleted (`__tests__/__fixtures__/envelope-parity-golden.json`). The queue, the
// db writes, the live SSE and the CURRENT step projection consume the same events they consumed
// yesterday; 405 rebuilds the projection against the bus directly.
//
// ENVELOPES ARE CARRIED, NEVER RE-MINTED (T-401-20). The bus already publishes the frozen §2.2
// shape `{seq, ts, runId, type, payload}`. This module adds the buffer's `id` and copies; it parses
// nothing, reshapes nothing and invents no field.
//
// SUBSCRIBE FROM THE START — replay-then-live. The session arrives through the run door's
// `onSession` hook, which fires while the run is starting; a subscriber attached at the first seq
// receives everything already published before it, in seq order, and then the live tail. So the
// buffer is whole regardless of how late the bridge attaches, which is what makes the attach a
// wiring detail rather than a race.
//
// AND THE FIRST SEQ IS 1, NOT 0 (401-07, Rule 1 — measured on the live bus). `RunEventBus.subscribe`
// resolves `fromSeq ?? 1` and then REFUSES to serve a gap: a request from below the earliest
// retained seq is answered by reading the event log for the missing prefix, and a prefix it cannot
// supply raises `ReplayIncompleteError` rather than silently starting late (D-07). Seq numbering
// starts at 1, so seq 0 is a prefix that can never exist, and `subscribe(0, …)` therefore throws on
// EVERY run — empty window or not:
//
//   ReplayIncomplete: events before seq 1 are no longer available (replay requested from seq 0)
//
// The bridge attaches inside the core's `onSession`, so that throw would surface as a failure of
// every dashboard-triggered run. `REPLAY_FROM_START` below is the same constant, and the same
// value, `run-session-composition.ts` has always used for this.
//
// IT DEPENDS ON NO AGENT PACKAGE. The run-starter is INJECTED — the whole implementation that names
// `runs.start`, `invokeFunction` and the composed host lives in the CLI's `dashboard` command and is
// handed to `startServer`, exactly as `agentHost` already is. `packages/dashboard-server` may not
// import `agent`, `agent-local` or `safety`, and `pnpm validate:arch` is the mechanical proof.

import { EventEmitter } from 'node:events'

import type { RunEventEnvelope, RunSession } from '@vostride/agent-qa-schema'

import type { ExecuteOptions, ExecutionBackend, LiveExecutionEvent } from './execution-backend.js'

/** How long a finished run's replay buffer stays available to a reconnecting SSE client. */
const DEFAULT_HANDLE_RETENTION_MS = 5 * 60 * 1000

/**
 * The seq a bridge attaches at to receive the whole run. See the header: the bus numbers from 1 and
 * refuses to serve a prefix it cannot produce, so 0 is not "earlier", it is unserveable.
 */
const REPLAY_FROM_START = 1

export type InProcessRunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout'

type TerminalProcessStatus = 'completed' | 'failed' | 'cancelled'

/**
 * Map a bus `testFinished.outcome` / `verdict` / `runFinished.aggregateVerdict` value (the frozen
 * §2.2 envelope vocabulary) onto the run-status ground truth the dashboard's db reconciliation
 * reads. `passed`/`healed` → completed, `cancelled` → cancelled, `failed`/`timeout` → failed.
 * `skipped` (a member-only outcome) is ignored — an all-skipped run is vacuously passed at the
 * aggregate level (D-15). Anything else returns undefined, so the caller leaves the status alone.
 *
 * CARRIED VERBATIM FROM `test-runner.ts`. It is a bus-vocabulary reading and always was; the scrape
 * was only how the envelope reached it.
 */
function mapOutcomeToRunStatus(outcome: unknown): TerminalProcessStatus | undefined {
  switch (outcome) {
    case 'passed':
    case 'healed':
      return 'completed'
    case 'cancelled':
      return 'cancelled'
    case 'failed':
    case 'timeout':
      return 'failed'
    default:
      return undefined
  }
}

/**
 * Derive the run-status ground truth from one envelope. `testFinished.outcome` is the per-member
 * signal; `verdict.verdict` and `runFinished.aggregateVerdict` are authoritative at the run level
 * and arrive last, so last-writer-wins yields the aggregate. Every other type — `heartbeat`,
 * `stepFinalized`, hooks, anything unrecognised — returns undefined.
 */
export function runStatusFromEnvelope(envelope: RunEventEnvelope): TerminalProcessStatus | undefined {
  const payload = envelope.payload as Record<string, unknown> | undefined
  switch (envelope.type) {
    case 'testFinished':
      return mapOutcomeToRunStatus(payload?.outcome)
    case 'verdict':
      return mapOutcomeToRunStatus(payload?.verdict)
    case 'runFinished':
      return mapOutcomeToRunStatus(payload?.aggregateVerdict)
    default:
      return undefined
  }
}

/** What the injected starter is handed: the request as data, and where to hand the session back. */
export interface InProcessRunStartInput {
  readonly opts: ExecuteOptions
  /**
   * Called with the started session, as early as the run door can name it.
   *
   * A run that is DENIED never calls this, and that asymmetry is load-bearing: it is how the
   * backend distinguishes "the policy gate refused" from "the run started and then failed".
   */
  readonly onSession: (session: RunSession) => void
}

/**
 * Start one run and resolve when it is over.
 *
 * REJECTION IS NOT "the run failed" — a failing run resolves. A rejection is a denial, a refused
 * request field, an input error or a crash, and its message is what the dashboard shows as the
 * failure summary. That is the whole user-visible win of the retirement: on the retiring wire a
 * policy denial and a run that never started were the same nothing.
 */
export type InProcessRunStarter = (input: InProcessRunStartInput) => Promise<void>

/** What the settled run tells its host, replacing the child's `close` event (D-04's successor). */
export interface RunSettledDetails {
  /** A human-readable reason when the run did not simply finish. */
  readonly reason?: string
  /** Diagnostic lines — a rejection's message, split. The typed successor to scraped stderr. */
  readonly output: readonly string[]
}

export interface InProcessExecutionBackendOptions {
  readonly startRun: InProcessRunStarter
  /**
   * Fired once per run, after `run-complete` is on the wire.
   *
   * THE TYPED SUCCESSOR TO `onProcessClose`. The host uses it for exactly what it used the child's
   * exit for: reconcile a db row still reading `running`, release the run's Appium lease, and free
   * the queue slot. It is not a second completion vocabulary — the status handed over is the same
   * bus-derived ground truth the `run-complete` event carries.
   */
  readonly onRunSettled?: (
    runId: string,
    status: InProcessRunStatus,
    details: RunSettledDetails,
  ) => void
  /** Applied when an `ExecuteOptions` carries no `timeout` of its own. */
  readonly defaultTimeout?: number
  /** How long a finished run's replay buffer survives. */
  readonly retentionMs?: number
}

interface RunHandle {
  runId: string
  status: InProcessRunStatus
  startedAt: Date
  output: string[]
  session?: RunSession
  completionReason?: string
  /** Set the moment a cancel is requested, so the settle path cannot overwrite it with a verdict. */
  cancelRequested: boolean
  timeoutTimer?: ReturnType<typeof setTimeout>
}

/**
 * The dashboard's in-process `ExecutionBackend`.
 *
 * A CLASS, matching the shape the interface already declared (`extends EventEmitter`), with a
 * factory beside it so a composing host names a function rather than a constructor — nothing here
 * is meant to be subclassed, and nothing needs the `resolveCliBin`-style static the retiring class
 * carried for its binary.
 */
export class InProcessExecutionBackend extends EventEmitter implements ExecutionBackend {
  private readonly options: InProcessExecutionBackendOptions
  private readonly handles = new Map<string, RunHandle>()
  private readonly eventBuffers = new Map<string, LiveExecutionEvent[]>()
  private readonly eventCounters = new Map<string, number>()
  private readonly retentionMs: number

  constructor(options: InProcessExecutionBackendOptions) {
    super()
    this.options = options
    this.retentionMs = options.retentionMs ?? DEFAULT_HANDLE_RETENTION_MS
  }

  execute(opts: ExecuteOptions): void {
    const handle: RunHandle = {
      runId: opts.runId,
      status: 'running',
      startedAt: new Date(),
      output: [],
      cancelRequested: false,
    }
    this.handles.set(opts.runId, handle)
    this.eventBuffers.set(opts.runId, [])
    this.eventCounters.set(opts.runId, 0)

    this.pushEvent(opts.runId, { type: 'run-start', runId: opts.runId, status: 'running' })

    // D-12: a per-run timeout aborts the SESSION. There is no process to signal and no grace period
    // to wait out — `cancel()` is the run's own orderly stop, and the run's terminal verdict then
    // arrives on the bus like any other.
    const timeoutMs = opts.timeout ?? this.options.defaultTimeout
    if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      const timer = setTimeout(() => {
        if (handle.status !== 'running') return
        handle.cancelRequested = true
        handle.status = 'timeout'
        handle.completionReason = `run timeout after ${String(timeoutMs)}ms`
        handle.session?.cancel()
      }, timeoutMs)
      timer.unref()
      handle.timeoutTimer = timer
    }

    void this.options
      .startRun({
        opts,
        onSession: (session) => {
          handle.session = session
          // REPLAY-THEN-LIVE FROM THE FIRST SEQ. Everything published before this attach arrives
          // first, in seq order, and the live tail follows — so the buffer is whole regardless of
          // when the door names the session.
          session.subscribe(REPLAY_FROM_START, (envelope) => {
            const mapped = runStatusFromEnvelope(envelope)
            if (mapped !== undefined && !handle.cancelRequested) handle.status = mapped
            this.pushEvent(handle.runId, envelope as unknown as Record<string, unknown>)
          })
          // A cancel or a timeout that landed BEFORE the session existed still has to be honoured;
          // otherwise a run cancelled during startup runs to completion.
          if (handle.cancelRequested) session.cancel()
        },
      })
      .then(
        () => { this.settle(handle) },
        (error: unknown) => { this.settle(handle, error) },
      )
  }

  kill(runId: string): boolean {
    const handle = this.handles.get(runId)
    if (!handle || handle.status !== 'running') return false
    handle.cancelRequested = true
    handle.status = 'cancelled'
    handle.completionReason = 'cancelled'
    handle.session?.cancel()
    return true
  }

  killAll(): void {
    for (const handle of this.handles.values()) {
      if (handle.status !== 'running') continue
      handle.cancelRequested = true
      handle.status = 'cancelled'
      handle.completionReason = 'cancelled'
      handle.session?.cancel()
    }
  }

  getBufferedEvents(runId: string): LiveExecutionEvent[] {
    return this.eventBuffers.get(runId) ?? []
  }

  getActiveExecutions(): {
    runId: string
    status: string
    startedAt: string
    duration: number
    testName?: string
  }[] {
    const active: {
      runId: string
      status: string
      startedAt: string
      duration: number
      testName?: string
    }[] = []
    for (const handle of this.handles.values()) {
      if (handle.status !== 'running') continue
      // 401-07 (Rule 1): the retiring class looked this up as `test-start`, a v1 reporter name the
      // frozen §2.2 vocabulary does not emit — so `/api/execution/active` has been serving
      // `testName: undefined` for every run since the bus wire landed. The envelope type is
      // `testStarted`, and its `payload.name` is the test's name.
      const events = this.eventBuffers.get(handle.runId) ?? []
      const started = events.find((event) => event.type === 'testStarted')
      const payload = started?.payload as Record<string, unknown> | undefined
      const testName = typeof payload?.name === 'string' ? payload.name : undefined
      active.push({
        runId: handle.runId,
        status: handle.status,
        startedAt: handle.startedAt.toISOString(),
        duration: Date.now() - handle.startedAt.getTime(),
        ...(testName === undefined ? {} : { testName }),
      })
    }
    return active
  }

  private pushEvent(runId: string, payload: Record<string, unknown>): void {
    const counter = (this.eventCounters.get(runId) ?? 0) + 1
    this.eventCounters.set(runId, counter)
    const event = { ...payload, id: counter } as LiveExecutionEvent
    this.eventBuffers.get(runId)?.push(event)
    this.emit('execution-event', runId, event)
  }

  private settle(handle: RunHandle, error?: unknown): void {
    if (handle.timeoutTimer) clearTimeout(handle.timeoutTimer)
    if (error !== undefined) {
      const message = error instanceof Error ? error.message : String(error)
      for (const line of message.split('\n')) handle.output.push(line)
      // A rejection reaching here without a started session is a denial / refusal / input error —
      // the run never began. With one, it is a post-start framework error on a run that did.
      handle.completionReason = handle.session === undefined
        ? message
        : `Run failed after start: ${message}`
      if (!handle.cancelRequested) handle.status = 'failed'
    }
    if (handle.status === 'running') {
      handle.status = 'failed'
      handle.completionReason = handle.completionReason ?? 'Run ended before a verdict was reached'
    }

    const duration = Date.now() - handle.startedAt.getTime()
    this.pushEvent(handle.runId, {
      type: 'run-complete',
      runId: handle.runId,
      status: handle.status,
      duration,
      ...(handle.completionReason ? { reason: handle.completionReason } : {}),
    })

    this.options.onRunSettled?.(handle.runId, handle.status, {
      ...(handle.completionReason === undefined ? {} : { reason: handle.completionReason }),
      output: [...handle.output],
    })

    const cleanup = setTimeout(() => {
      this.handles.delete(handle.runId)
      this.eventBuffers.delete(handle.runId)
      this.eventCounters.delete(handle.runId)
    }, this.retentionMs)
    cleanup.unref()
  }
}

export function createInProcessExecutionBackend(
  options: InProcessExecutionBackendOptions,
): InProcessExecutionBackend {
  return new InProcessExecutionBackend(options)
}
