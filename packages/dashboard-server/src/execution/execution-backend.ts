import type { RunAttributes } from '@vostride/agent-qa-core'
import type { GateRemedy } from '@vostride/agent-qa-schema'
import type { EventEmitter } from 'node:events'

/**
 * One live-execution event as the SSE route serves it (`GET /api/execution/events`).
 *
 * DECLARED HERE SINCE 401-07 rather than beside a producer. It is the consumer-facing shape — an
 * `id` the browser sends back as `Last-Event-ID`, a `type` it selects on, and whatever the producer
 * pushed — so it belongs with the interface both producers implement, not with either one of them.
 */
export interface LiveExecutionEvent {
  id: number
  type: string
  [key: string]: unknown
}

export interface ExecuteOptions {
  runId: string
  args: string[]
  source: string
  attributes?: RunAttributes
  timeout?: number
  /**
   * The Appium lease URL for a mobile run, AS DATA (401-07, D-01/D-12).
   *
   * The bundled Appium spawn is design-of-record and stays exactly where it is; what changed is the
   * DELIVERY. It used to ride `AGENT_QA_APPIUM_URL` in a child's environment, and a child env is
   * something only a child has. The run happens in this process now, so the lease travels as an
   * argument and is handed to the run through an injected resolver.
   */
  appiumUrl?: string
  /**
   * The browser this run's ask-tier questions go to (401-09, D-11).
   *
   * A CONFIRM SCOPE MINTED BY THE PERSON'S OWN CHANNEL, carried from the trigger request through
   * the queued row to here — the successor to nothing, because the retiring wire could not ask a
   * question at all: it spawned a child whose stdin was a pipe, so an ask-tier dashboard run had
   * no reachable human by construction and denied fail-closed every time.
   *
   * ABSENT IS THE HONEST DEFAULT. A trigger with no channel — the person navigated away, or a
   * caller that is not a browser — leaves the run `local-headless`, which is what a run nobody can
   * be asked about IS. It is never defaulted to "somebody is probably there".
   */
  confirmScope?: string
}

/**
 * A run has reached a terminal state (401-07, D-04/D-12).
 *
 * THE TYPED SUCCESSOR TO THE CHILD'S `close` EVENT. The host reconciles a db row still reading
 * `running`, releases the run's Appium lease and frees the queue slot off this — exactly what it did
 * off the process exit — but the status is now the bus's own ground truth and the `details` carry
 * the failure's REASON rather than a scraped tail of stderr.
 *
 * `'run-settled'` and `'execution-event'` are the whole of this emitter's contract.
 */
export interface RunSettledDetails {
  /** A human-readable reason when the run did not simply finish. */
  readonly reason?: string
  /**
   * What the refused caller can actually DO about it, typed (401-09, D-15).
   *
   * ALREADY PROJECTED FOR THIS SURFACE. The gate mints the full set and every door runs it through
   * `remediesRenderableBy` before rendering, because the gate cannot write prose that is
   * simultaneously right for a terminal, a chat transcript, an MCP client and a browser — which is
   * the whole argument for the vocabulary being data. What reaches here is the `dashboard` slice,
   * so a consumer renders what it is given and filters nothing.
   *
   * ABSENT WHERE THE FAILURE IS NOT A REFUSAL, and empty where a refusal has no way forward this
   * surface can offer. Honest absence is a supported answer; it is never filled with guidance.
   */
  readonly remedies?: readonly GateRemedy[]
  /**
   * The run NEVER BEGAN — the gate or the host refused it (401-18, G-401-16).
   *
   * A FACT, NOT AN INFERENCE. `settle` has always known this — a rejection with no started session
   * is a denial, a refused request field or an input error — and threw the knowledge away, leaving
   * the host's reconciliation to guess from a regex over the diagnostic lines. It guessed
   * `Process exited before test completed`, which is a sentence about a process, for a run where
   * nothing was ever started to exit.
   *
   * DELIBERATELY A BOOLEAN AND NOT A CLASS. Which refusal it was — `fail-closed-denied`, `blocked`,
   * `session-pin-denied`, an unrecognised request field, a plain input error — is not something the
   * reconciliation branches on, and a prose name for it here would be the same defect one layer
   * down. If a class is ever needed it arrives as a closed-set value owned by `schema`, the way the
   * remedy vocabulary already does.
   *
   * ABSENT ON A RUN THAT STARTED, including one that started and then failed. That asymmetry is the
   * scope guarantee: every other arm of the reconciliation reads exactly what it read before.
   */
  readonly refusedBeforeStart?: true
  /**
   * The refusal said without naming any surface's affordance (401-18, G-401-16).
   *
   * THE PROSE HALF OF THE SAME REPAIR THE REMEDIES ARE THE TYPED HALF OF. The gate composes two
   * sentences per decision: the canonical one, which names `--trust-session` and lands in the
   * execution-audit row, and the neutral one, which stops at the classification and the outcome.
   * A browser reader was being handed the first, so the record's only account of why a run never
   * happened told them to pass a flag to a command they were not running.
   *
   * READ STRUCTURALLY OFF THE REJECTION, on `dashboardRemediesOf`'s precedent, and ABSENT where the
   * rejection carries no neutral form — an input error is not a gate decision and has no second
   * phrasing. The consumer then falls back to the rejection's own message, which for those refusals
   * names no surface's affordance either.
   */
  readonly neutralReason?: string
  /** Diagnostic lines — a rejection's own message. The typed successor to scraped stderr. */
  readonly output: readonly string[]
}

export type RunSettledStatus = 'completed' | 'failed' | 'cancelled' | 'timeout'

export interface ExecutionBackend extends EventEmitter {
  execute(opts: ExecuteOptions): void
  kill(runId: string): boolean
  killAll(): void
  getActiveExecutions(): { runId: string; status: string; startedAt: string; duration: number }[]
  /**
   * The per-run replay buffer the SSE route serves on connect and on `Last-Event-ID` reconnect.
   *
   * ON THE INTERFACE SINCE 401-07. `routes.ts` has always depended on it; it just depended on it
   * through the CONCRETE class, which is how a seam that reads as an adapter boundary turns out to
   * have one implementation it cannot be swapped away from.
   */
  getBufferedEvents(runId: string): LiveExecutionEvent[]
}
