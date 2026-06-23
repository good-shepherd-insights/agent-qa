import type { RunId } from './run-id'
import type { RunStatus, ExecutionContext } from './run-status'

/**
 * Provisional minimal run session DTO.
 *
 * @remarks This is NOT the final replayable event-bus session. The Runner milestone
 * expands this contract; downstream consumers must not key replay behavior on this
 * three-field shape.
 */
export interface RunSession {
  id: RunId
  status: RunStatus
  executionContext: ExecutionContext
}
