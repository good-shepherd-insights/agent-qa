import type { RunAttributes } from '@vostride/agent-qa-core'
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
  maxRetries?: number
  env?: Record<string, string>
}

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
