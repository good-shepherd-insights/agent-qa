// THE post-processing chip vocabulary (Phase 388, D-14 / D-15).
//
// One exported closed union, in one place, because the vocabulary appears in three: the bus
// chip events the in-process tail emits, the read op that projects durable job state, and
// the CLI's exit summary line. Three spellings of five words is not a duplication a reviewer
// catches — it is the state in which the dashboard says "queued" while the CLI says
// "pending" about the same row, and nothing is wrong with either of them.
//
// `reserved` is the member that is not in the spec's chip vocabulary. It exists because the
// issues chip has to answer honestly while the triage slot is unfilled, and neither of the
// spec's candidates is honest: `pending` says a job is coming and `done` says one happened.
// The divergence is recorded as a dated reconciliation in REQUIREMENTS.md rather than as a
// spec edit; when the issue engine lands, `reserved` stops being PRODUCED and the closed
// union keeps the member, so no consumer has to be rebuilt to stop understanding it.

import type { RunNotification } from './run-notification'

/**
 * Declared in the order a stage passes through them, with the structural member last.
 *
 * A runtime array rather than a bare type, because the projection and its tests both need to
 * enumerate the vocabulary, and a union that only exists at compile time cannot be walked.
 */
export const POST_PROCESSING_CHIP_STATUSES = [
  'pending',
  'running',
  'done',
  'failed',
  'reserved',
] as const

export type PostProcessingChipStatus = (typeof POST_PROCESSING_CHIP_STATUSES)[number]

/**
 * The three chips, named rather than indexed.
 *
 * Fixed members instead of a record keyed by stage name: the chip set is ratified and closed
 * (spec §4 — notify is not a chip), so a surface that renders all three should fail to
 * compile when a fourth arrives rather than silently render two thirds of the truth.
 */
export interface PostProcessingChips {
  analysis: PostProcessingChipStatus
  curation: PostProcessingChipStatus
  issues: PostProcessingChipStatus
}

export interface PostProcessingStatus {
  runId: string
  chips: PostProcessingChips
  /**
   * Present only once the chain reached its terminal and wrote its one row (D-09). Absent is
   * the ordinary state of a chain still in flight — never rendered as a failure.
   */
  notification?: RunNotification
}

export function isPostProcessingChipStatus(value: unknown): value is PostProcessingChipStatus {
  return (
    typeof value === 'string' &&
    (POST_PROCESSING_CHIP_STATUSES as readonly string[]).includes(value)
  )
}
