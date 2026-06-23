import type { RunId } from './run-id'
import type { RunStatus, ExecutionContext } from './run-status'

export interface RunSession {
  id: RunId
  status: RunStatus
  executionContext: ExecutionContext
}
