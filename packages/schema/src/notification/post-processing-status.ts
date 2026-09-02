// THE post-processing chip vocabulary (Phase 388, D-14 / D-15; narrowed Phase 404, D-01).
//
// One exported closed union, in one place, because the vocabulary appears in three: the bus
// chip events the in-process tail emits, the read op that projects durable job state, and
// the CLI's exit summary line. Three spellings of four words is not a duplication a reviewer
// catches — it is the state in which the dashboard says "queued" while the CLI says
// "pending" about the same row, and nothing is wrong with either of them.
//
// 2026-08-26 (Phase 404, D-01): the chip set is exactly `{analysis, curation}` and the
// vocabulary is exactly `pending · running · done · failed`. The Issue engine left the spec on
// 2026-08-25, so the structural member that used to answer for the unfilled triage slot has no
// slot left to answer for, and a word no producer can produce is a word every consumer still
// has to render. The chip side stopped reading and rendering the third id then.
// 2026-09-02 (Phase 412): the job-kind layer followed — the reserved sixth job kind, the chain's
// third derived id, the retired entity kind and the retired proposal arm left with the
// Issue-slot cleanup — see `DELETION-INVENTORY.md`.

import type { RunNotification } from './run-notification'

/**
 * Declared in the order a stage passes through them.
 *
 * A runtime array rather than a bare type, because the projection and its tests both need to
 * enumerate the vocabulary, and a union that only exists at compile time cannot be walked.
 */
export const POST_PROCESSING_CHIP_STATUSES = [
  'pending',
  'running',
  'done',
  'failed',
] as const

export type PostProcessingChipStatus = (typeof POST_PROCESSING_CHIP_STATUSES)[number]

/**
 * The two chips, named rather than indexed.
 *
 * Fixed members instead of a record keyed by stage name: the chip set is ratified and closed
 * (spec §4.1 — notify is not a chip), so a surface that renders both should fail to compile
 * when a third arrives rather than silently render half the truth. That compile error is the
 * point: it is what walked this narrowing through every consumer in Phase 404.
 */
export interface PostProcessingChips {
  analysis: PostProcessingChipStatus
  curation: PostProcessingChipStatus
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
