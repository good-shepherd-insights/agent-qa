// The per-run digest — a READ-TIME projection, never a record (Phase 391, D-16 / D-18).
//
// Minted here, beside `run-notification.ts`, and deliberately NOT inside it. The notification
// row is the chain's one DURABLE artifact: counts-only, exact-key-guarded, read by chat and by
// the dashboard, and frozen (388 D-11). The digest is what a HUMAN is shown once per run — the
// sentences, the chain, the decisions waiting on them — composed live from four already-shipped
// read paths every time somebody asks. Widening the row to carry any of that would have made
// one payload answer two questions, and `guardRunNotification`'s sorted-key comparison would
// hard-fail every reader on the first field. So the two shapes sit side by side in one
// directory, and this one has no `schemaVersion`: nothing persists a digest, so there is no
// build boundary for a version stamp to describe. A stamp here would be an invitation to store
// one, which is precisely the second representation D-16 refuses.
//
// EXACTLY ONE DIGEST PER RUN IS STRUCTURAL, not a rule anyone enforces. The projection is keyed
// by `runId`; a projection keyed by a run cannot fire per event, which is PROP-04's whole
// complaint ("an approval UX that fires 40 times per nightly run is a worse product than one
// that fires once") answered by a shape rather than by a throttle.
//
// REFS AND COUNTS ONLY (D-18, T-391-17). Nothing on this DTO carries evidence bytes, receipt
// bytes, rationale prose or masked content: a proposal is a short id, a one-line summary built
// from its own refs and delta COUNT, and the decision it is waiting for; candidates and
// quarantine are counts plus identity refs. Full receipts are one `proposals.show` away, which
// is a verb with its own gate. That is a privacy boundary rather than a size budget — this
// value is rendered directly by a terminal, a chat and a dashboard, and a payload that COULD
// carry a secret would need a masking boundary at each of them.

import { z } from 'zod'

import { AnalysisClusterViewSchema } from '../functions/analysis-get'
import type { AnalysisClusterView } from '../functions/analysis-get'
import { runIdSchema } from '../run/run-id'
import { POST_PROCESSING_CHIP_STATUSES } from './post-processing-status'
import type { PostProcessingChipStatus } from './post-processing-status'
import type { RunNotificationOutcome } from './run-notification'

/** `runs.digest` addresses exactly one run by id — the `runs.postprocessing` shape. */
export const RunsDigestInputSchema = z.object({
  runId: runIdSchema,
}).strict()

export type RunsDigestInput = z.infer<typeof RunsDigestInputSchema>

/**
 * One proposal this run minted, as a person meets it in a digest (D-18).
 *
 * FOUR FIELDS, and the pair of ids is the only one that looks redundant and is not. `shortId`
 * is what the rendered line carries so a list of five stays readable; `id` is the key every
 * decision verb takes, so a surface built on this DTO can offer "accept" without a second
 * lookup. Dropping `id` would have made the digest a thing you read and then had to go and
 * re-enumerate to act on, and dropping `shortId` would have put a uuid in every line.
 *
 * `summaryLine` is composed from the proposal's own refs and COUNTS — never from its deltas'
 * content, never from a forget receipt's tombstones. `requiredDecision` names what the human
 * owes it, in the vocabulary of the verbs that discharge it.
 */
export interface RunDigestProposalRow {
  id: string
  shortId: string
  summaryLine: string
  requiredDecision: string
}

/**
 * The chain's per-stage outcomes, in the ONE chip vocabulary (388 D-14/C13).
 *
 * The three chips are the `runs.postprocessing` values verbatim — not a synonym, not a
 * control-flow word — because three spellings of five words is the state in which the CLI and
 * the dashboard disagree about a row neither of them got wrong.
 *
 * `outcome` is present exactly once the chain wrote its terminal row, and it is a fact about
 * the CHAIN rather than about the run (the row's own note): a failed run whose analysis and
 * curation both succeeded reads `done`.
 */
export interface RunDigestChainOutcomes {
  analysis: PostProcessingChipStatus
  curation: PostProcessingChipStatus
  issues: PostProcessingChipStatus
  outcome?: RunNotificationOutcome
}

/**
 * Curator candidates staged this run, as COUNTS (D-13).
 *
 * The digest REPORTS; the KREV verbs review. Candidates stay candidate-status truth inside
 * bundles and are never listed as proposals, so nothing here addresses one for a decision.
 *
 * NO REFS, and the absence is measured rather than an omission: the only run-scoped, durable
 * record of what a run curated is the chain-terminal notification row, which is counts-only BY
 * CONSTRUCTION (388 D-11) and may not be widened (D-18, T-391-18). A ref list would therefore
 * have had to come from somewhere else — a new port over the run directory's curation receipt —
 * and inventing one so a field could be populated is a larger change than the field is worth.
 * Stated here so a later reader does not read the gap as a bug.
 */
export interface RunDigestCandidateReport {
  curated: number
  deprecated: number
}

/**
 * Quarantine as counts + identity refs.
 *
 * STATE, NOT TRANSITIONS, and the difference is a fact about the ledger rather than a shortcut.
 * A quarantine entry records the test's three identity legs, its window and its history; it
 * carries NO run attribution, because auto-quarantine is code-authored operational state keyed
 * by a failure fingerprint and not by whoever happened to be running (390 C15). So there is no
 * honest way to compute "transitions caused by this run" from what is committed, and a number
 * presented as one would be a fabrication. What the digest can say truthfully is what the
 * ledger holds when the digest is read, which is also what a person acts on.
 *
 * `refs` are `product/filePath::testName` — the durable identity legs, never `testId`, which is
 * per-run and would address nothing tomorrow.
 */
export interface RunDigestQuarantineReport {
  quarantined: number
  expired: number
  refs: string[]
}

/**
 * The whole digest: structured sections, plus the bytes a surface prints.
 *
 * `lines` exists so that no surface composes a sentence. The tail, the CLI verb, 392's chat and
 * M5 all print these strings; the structured sections are for a surface that wants to lay the
 * same facts out differently (a dashboard card, a chat block) without re-deriving any of them.
 * Carrying both is what keeps "one renderer" true for the terminal without making every other
 * surface parse strings.
 *
 * `verdictClusters` are the `analysis.get` cluster views VERBATIM — the same value, the same
 * type, the same already-composed representative sentence. The digest re-renders nothing: 389
 * D-05/D-10 put one renderer and one accessor behind that op, and a second composition here
 * would be exactly the drift those decisions exist to prevent.
 */
export interface RunDigest {
  runId: string
  verdictClusters: AnalysisClusterView[]
  chain: RunDigestChainOutcomes
  /** Ordered by the proposals store's own law — minted-at, then id. Never re-sorted here. */
  proposalsMintedThisRun: RunDigestProposalRow[]
  /** Across the WHOLE store, not just this run: what is waiting on a human right now. */
  pendingProposalCount: number
  /**
   * Whether an empty {@link proposalsMintedThisRun} is a MEASUREMENT or an absence of data.
   *
   * True when the store is empty (nothing was minted, which is measurable and true) or when at
   * least one entry carries run attribution (so the filter had a populated key to range over).
   * False means no entry in a NON-EMPTY store carries a run, so the digest cannot distinguish
   * a run that minted nothing (a measurement) from a store where nobody wrote down which run
   * minted what (an absence of data) — and it says exactly that rather than picking the
   * affirmative negative and hoping (T-391-21).
   */
  runAttributionAvailable: boolean
  candidates: RunDigestCandidateReport
  quarantine: RunDigestQuarantineReport
  lines: string[]
}

export const RunDigestProposalRowSchema = z.object({
  id: z.string().min(1),
  shortId: z.string().min(1),
  summaryLine: z.string().min(1),
  requiredDecision: z.string().min(1),
}).strict() satisfies z.ZodType<RunDigestProposalRow>

/**
 * The chip enums are CONSTRUCTED from the exported vocabulary rather than respelled (C13), so a
 * fourth chip status cannot arrive with this contract still admitting three.
 */
export const RunDigestChainOutcomesSchema = z.object({
  analysis: z.enum(POST_PROCESSING_CHIP_STATUSES),
  curation: z.enum(POST_PROCESSING_CHIP_STATUSES),
  issues: z.enum(POST_PROCESSING_CHIP_STATUSES),
  outcome: z.enum(['done', 'failed']).optional(),
}).strict() satisfies z.ZodType<RunDigestChainOutcomes>

export const RunDigestCandidateReportSchema = z.object({
  curated: z.number().int().nonnegative(),
  deprecated: z.number().int().nonnegative(),
}).strict() satisfies z.ZodType<RunDigestCandidateReport>

export const RunDigestQuarantineReportSchema = z.object({
  quarantined: z.number().int().nonnegative(),
  expired: z.number().int().nonnegative(),
  refs: z.array(z.string().min(1)),
}).strict() satisfies z.ZodType<RunDigestQuarantineReport>

/**
 * The `runs.digest` result.
 *
 * `AnalysisClusterViewSchema` is IMPORTED, not restated: the digest's verdict section is the
 * analysis op's cluster view, and a second declaration of that shape here would be free to
 * agree today and drop `members` after the first change to either.
 */
export const RunDigestSchema = z.object({
  runId: z.string(),
  verdictClusters: z.array(AnalysisClusterViewSchema),
  chain: RunDigestChainOutcomesSchema,
  proposalsMintedThisRun: z.array(RunDigestProposalRowSchema),
  pendingProposalCount: z.number().int().nonnegative(),
  runAttributionAvailable: z.boolean(),
  candidates: RunDigestCandidateReportSchema,
  quarantine: RunDigestQuarantineReportSchema,
  lines: z.array(z.string()),
}).strict() satisfies z.ZodType<RunDigest>
