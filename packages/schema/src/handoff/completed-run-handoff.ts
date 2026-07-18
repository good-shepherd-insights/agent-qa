import type { ScopeKey } from '../identity/scope-key'
import type { RunId } from '../run/run-id'
import type { ExecutionContext, RunStatus } from '../run/run-status'
import type { PerTestOutcome } from './per-test-outcome'

export const CURRENT_HANDOFF_SCHEMA_VERSION = 3

export interface CompletedRunHandoff {
  schemaVersion: number
  runId: RunId
  scope: ScopeKey
  buildOrdinal: number
  /**
   * D-14 §6 gate-run exclusion. Internal validation runs (including M4's
   * verify-before-present gate and eval cassette replays) contribute zero run-outcome
   * counter changes. The runner stamps this literal marker before persisting the handoff,
   * making the decision durable and identical for incremental folds and full rebuilds.
   * Absent means an ordinary counted run.
   */
  excludedFromOutcomes?: true
  executionContext: ExecutionContext
  aggregateVerdict: RunStatus
  configDigests: {
    suiteConfigDigest: string
    testConfigDigest: string
  }
  startedAt: number
  endedAt: number
  tests: PerTestOutcome[]
}
