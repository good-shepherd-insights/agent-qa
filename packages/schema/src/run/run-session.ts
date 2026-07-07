import type { CompletedRunHandoff } from '../handoff/completed-run-handoff'
import type { RunEventEnvelope } from './bus-events'
import type { RunId } from './run-id'
import type { RunStatus, ExecutionContext } from './run-status'

/**
 * The awaitable run completion resolved on {@link RunSession.done} the moment the
 * `verdict` event is emitted (D-13). The CLI awaits this and maps `verdict` → exit code;
 * `handoff` is the durable {@link CompletedRunHandoff} (SESSION-05).
 */
export interface RunCompletion {
  verdict: RunStatus
  handoff: CompletedRunHandoff
}

/**
 * The M1-lite run session (D-13, SESSION-01). A run becomes an addressable in-process
 * handle: identity + status, an optional live `subscribe`/replay seam onto the event bus,
 * run-level `cancel`, and an awaitable `done`. `liveUrl`/arbiter/control members stay
 * ABSENT — they land with Live view (M5).
 *
 * @remarks Expanded from the provisional three-field DTO. `status` widens `RunStatus` with
 * the non-terminal `'running'` locally (the aggregate-verdict {@link RunStatus} stays
 * terminal-only). The bus stamps `seq`/`ts`; the session only exposes the subscribe seam.
 */
export interface RunSession {
  id: RunId
  status: 'running' | RunStatus
  executionContext: ExecutionContext
  /**
   * Attach a subscriber from `fromSeq` (replay-then-live, seq-order delivery). Returns an
   * unsubscribe handle. Bridges 1:1 onto SSE `Last-Event-ID` in M5 (D-08).
   */
  subscribe(fromSeq: number, handler: (event: RunEventEnvelope) => void): () => void
  /** Run-level cancel: abort the active member test, skip the rest, verdict `cancelled` (D-03). */
  cancel(): void
  /** Resolves on the `verdict` event with the terminal verdict + durable handoff (D-13). */
  done: Promise<RunCompletion>
}
