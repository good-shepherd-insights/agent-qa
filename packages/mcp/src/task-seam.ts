// The dormant JobView -> Task projection (Phase 396 plan 03, D-12 · MCPS-06).
//
// WHY THIS FILE EXISTS, AND WHY IT DOES NOTHING. MCPS-06 asks for the seam between agent-qa's job
// queue and MCP's long-running-task vocabulary to EXIST, so that the day the vocabulary settles the
// work is a registration and not a re-derivation. It does not ask for the seam to be wired, and
// wiring it today would be wiring this surface to something that is not there.
//
// C-MCP-3, dated 2026-07-28 — the deferral, with its evidence:
//   * Tasks were REMOVED from the core protocol into an official extension,
//     `io.modelcontextprotocol/tasks` (SEP-2663). `tasks/result` became polling `tasks/get` +
//     `tasks/update`, and `tasks/list` was removed outright.
//   * That extension ships no npm package, and its own README calls it unofficial.
//   * The SDK this package builds on (`@modelcontextprotocol/server` 2.0.0) carries the older
//     vocabulary marked, verbatim: "@deprecated 2025-11-25 wire vocabulary with no SDK runtime;
//     kept importable for interoperability only" — and excludes `tasks/*` from its typed method
//     maps, so there is no runtime to register against even if one wanted to.
//   * No conformance tier requires tasks (SEP-1730).
// Four independent reasons pointing the same way. A projection written against a vocabulary in that
// state is worth having; a REGISTRATION against it is a public promise this server cannot keep.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT DO. It registers nothing, advertises nothing and routes
// nothing. `catalog.ts` does not import it — that absence is import-anchored by an acceptance grep
// rather than asserted in prose, because a comment cannot hold a coupling shut. It reaches no port,
// no host API and no sibling module: one exported pure function, one exported table, one type.
//
// IT CONSUMES THE PUBLIC READ DTO AND NOTHING ELSE. `Job` — the schema package's published job
// record, which is what D-12 calls the JobView — is the whole input. The JobQueue CONTRACT (claim,
// heartbeat, bounded retry, the `attempts`-at-claim discipline) never crosses into this package,
// and that is the coupling MCPS-06 is actually about: a seam that took the queue port would make
// every queue change an MCP change.
//
// THE MAPPING IS LOSSY, AND THE LOSS IS THE RECONCILIATION. agent-qa's four non-terminal statuses
// are CHECKPOINT BOUNDARIES, chosen so that a job resumed after a crash never re-invokes the LLM
// for work it already paid for; MCP's states are what a REMOTE POLLER needs, and a poller is asking
// exactly one question — "may I stop polling yet?". `queued`, `authored`, `bundling` and
// `committing` are four different answers to a question the poller is not asking, so they collapse
// onto `working`. The three terminal statuses stay distinct, because "someone stopped this" and
// "this is broken" are not the same answer.
//
// THE RESULT IS NOT A WIRE `Task`, AND IS NOT TYPED AS ONE. It carries the wire's FIELD NAMES so
// that the eventual registration is a pass-through rather than a rename, but it omits `ttl` and
// `pollInterval` — transport-lifecycle facts that a projection of a job record cannot know and must
// not invent — and it does not import the SDK's deprecated `Task` type, because importing a type
// marked "no SDK runtime" would be this package taking a dependency on a vocabulary it has just
// finished arguing is not ready. The type is mcp-local for the same reason it is small: it crosses
// no package boundary, so the DTO house law (mint shared vocabulary in `schema`) does not reach it.
//
// Protocol grounding: SEP-2663 (tasks moved out of core into the tasks extension; polling model),
// SEP-2575 (the stateless protocol that made a pollable handle the only shape a long-running
// operation can take).

import type { Job, JobStatus } from '@vostride/agent-qa-schema'

/**
 * The MCP task states this projection can produce.
 *
 * Four of the wire's five. The fifth, `input_required`, is deliberately absent from the table
 * below and NOT from this union: it is a real state of the protocol that no agent-qa job status
 * currently means, and a future status that did mean it should be able to say so by adding one row
 * rather than by widening a type.
 */
export type McpTaskState = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled'

/**
 * The whole mapping, as data.
 *
 * `as const satisfies Record<JobStatus, McpTaskState>` is what makes this exhaustive AT COMPILE
 * TIME: add an eighth member to `JobStatus` and this object stops satisfying the record, so the
 * build fails at the one place that has to make a decision about it. The alternative — a `switch`
 * with a `default` — is the same table with a hole in it, and the hole answers `working` for a
 * status nobody has thought about yet, which is the wrong answer precisely when it matters.
 *
 * Exported because the table IS the reconciliation D-12 asks to be pinned, and a later phase
 * registering the extension will read it rather than restate it.
 */
export const JOB_STATUS_TO_MCP_TASK_STATE = {
  // The four checkpoint boundaries. One answer, four times, on purpose.
  queued: 'working',
  authored: 'working',
  bundling: 'working',
  committing: 'working',
  // The three terminal states, kept apart.
  done: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
} as const satisfies Record<JobStatus, McpTaskState>

/**
 * What one job looks like to a remote poller.
 *
 * Field names are the wire's (`taskId`, `statusMessage`, `lastUpdatedAt`) rather than the job
 * record's, because this record's whole purpose is to be handed OUT: naming it after the source
 * would push the rename onto the registration, which is the step this seam exists to make trivial.
 * `lastUpdatedAt` carries `Job.updatedAt` verbatim; only the label differs.
 */
export interface McpTaskProjection {
  readonly taskId: string
  readonly status: McpTaskState
  /** The job's own one-line summary. The only prose that crosses. */
  readonly statusMessage: string
  readonly createdAt: string
  readonly lastUpdatedAt: string
}

/**
 * Project one job record into the task view.
 *
 * Total, pure, synchronous, and deliberately narrow. `attempts`, `kind`, `runRef` and
 * `conclusionKind` are NOT carried, and their absence is asserted by an exact-key cell rather than
 * left to be noticed: `attempts` is the retry discipline's private counter, and `conclusionKind` is
 * internal vocabulary (`knowledge_skipped_draft`, `insufficient_model_output`) that means nothing to
 * a caller outside this system. A projection that leaks the source record's shape is not a
 * projection; it is the coupling with an extra step.
 *
 * NOTHING IS MASKED HERE, and that is a statement rather than an oversight. This function is called
 * by nothing — it registers no handler and returns no result to any transport — so there is no
 * output channel to mask. Whoever eventually registers it inherits the masking obligation every
 * other handler in this package carries, because `statusMessage` is a job's own summary text and
 * summaries are prose somebody may one day interpolate a resolved value into.
 */
export function projectJobAsTask(job: Job): McpTaskProjection {
  return {
    taskId: job.id,
    status: JOB_STATUS_TO_MCP_TASK_STATE[job.status],
    statusMessage: job.summary,
    createdAt: job.createdAt,
    lastUpdatedAt: job.updatedAt,
  }
}
