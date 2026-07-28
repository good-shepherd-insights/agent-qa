import type { ScopeKey } from '../identity/scope-key'
import type { RunId } from '../run/run-id'
import type { ExecutionContext, RunStatus } from '../run/run-status'
import type { PerTestOutcome } from './per-test-outcome'

export const CURRENT_HANDOFF_SCHEMA_VERSION = 4

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
  /**
   * D-10 carrier for verify-before-present gate runs (Phase 384, 2026-07-28). Marks a run
   * as an M4 verification gate run so 388 can propagate it onto the `analyze-run` job
   * payload and 393 can set it, with no second breaking handoff-schema change.
   *
   * C8-ratified: gate runs DO feed curation. This is a DISTINCT axis from
   * `excludedFromOutcomes` above — neither marker implies the other, and v51's
   * run-outcome projection continues to read `excludedFromOutcomes` alone. The
   * exclusion semantics of a gate run land in 388/393; 384 mints only the carrier.
   *
   * Only the literal marker is meaningful; absence denotes an ordinary run.
   */
  gateRun?: true
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
