// The two envelope payload arms 394 lands (D-05 / D-11 · WTST-01, WTST-04).
//
// EVERY LOOP OUTCOME BECOMES SOMETHING A HUMAN DECIDES ON. D-05 is blunt about it: keep-eligible
// never auto-writes, so a verified draft is a PROPOSAL, and D-11 says a correctly-failing draft is
// a proposal too — a different kind, carrying the evidence that the application rather than the
// test is what looks wrong. Both ride 391's envelope, so the inbox, the digest, the decision trail,
// accept-with-always and expiry all come free and none of them learns anything new.
//
// WHY `finding` IS A KIND AND NOT A FIELD ON THE TEST-DRAFT ARM. `PROPOSAL_KINDS` feeds two
// exhaustive `Record<ProposalKind, …>` sites — the accept verb's apply routes and the digest's
// required-decision strings — so a discriminated kind gets compile-time coverage at both of them
// for free. A boolean or an enum FIELD on one payload gets none: the accept route would be the
// test-draft route, the digest line would read as a test-draft's, and nothing would fail to
// compile. The two artifacts also want opposite decisions — one is applied, the other is
// acknowledged — which is a difference in what accepting MEANS rather than in what is attached.
//
// MAP, NOT TERRITORY (391 D-18). Both arms carry refs and one-liners. The draft bytes stay on the
// shelf, the receipt stays in the receipts store, and the run evidence stays in the run's own
// durable records — an envelope is what a person reads before deciding, not a copy of everything
// the decision is about.
//
// THERE IS NO SEPARATE `receiptRef`. The receipts store keys a receipt by
// `draftRef.contentDigest`, so a `receiptRef` field would be that same string a second time, and
// 391's envelope already records what two copies of one link cost: one of them starts pointing at
// nothing. The draft ref IS the receipt's address.

import { z } from 'zod'

import { DRAFT_DISPOSITIONS } from './disposition'
import { DraftRefSchema } from './draft-receipt'

/** Version 1: the first shape of both arms. No envelope of either kind exists on disk yet. */
export const CURRENT_AUTHORING_PROPOSAL_SCHEMA_VERSION = 1

/**
 * Which durable record an evidence coordinate addresses.
 *
 * THE ONE CHANNEL VOCABULARY. The router builds these coordinates and the finding arm carries
 * them, and the two are the same thing seen from either side of a store — so the words are spelled
 * here, in `schema`, and the router imports them. A second spelling inside `agent` would be free to
 * drift from the one a stored finding was written with, which is the drift a wire projection can
 * never detect because both halves would parse.
 */
export const RUN_EVIDENCE_CHANNELS = ['step-trace', 'state-before', 'state-after'] as const

export type RunEvidenceChannel = (typeof RUN_EVIDENCE_CHANNELS)[number]

/**
 * A COORDINATE into a run's own durable records. Never a payload.
 *
 * `.strict()` is the refusal surface: a screen state, an element tree or a rendered snapshot
 * copied onto a finding fails to parse here rather than becoming a durable record nobody meant to
 * write. The key set is additionally pinned by equality in `router.test-d.ts`.
 */
export const RunEvidenceRefSchema = z.object({
  runId: z.string().min(1),
  filePath: z.string().min(1),
  testName: z.string().min(1),
  stepIndex: z.number().int().nonnegative(),
  /** Absent on the `step-trace` channel, which addresses the whole step. */
  subActionIndex: z.number().int().nonnegative().optional(),
  channel: z.enum(RUN_EVIDENCE_CHANNELS),
}).strict()

export type RunEvidenceRef = z.infer<typeof RunEvidenceRefSchema>

/**
 * The verdict path that produced a definitive answer, as the run recorded it.
 *
 * Kept as a free string rather than an enum: the run's own `VerdictSource` vocabulary is owned by
 * the handoff schema and grows there, and a second closed copy here would refuse to store a
 * finding produced by a newer runner — refusing to record a real application defect because the
 * verdict came through a path this file had not heard of.
 */
const VerdictSourceTextSchema = z.string().min(1)

/** Where the failure was observed, in the run's own words. */
export const FindingFailurePointSchema = z.object({
  runId: z.string().min(1),
  stepIndex: z.number().int().nonnegative(),
  /** Pre-interpolation step text — post-interpolation text can carry resolved secrets. */
  stepText: z.string(),
  /** The verifier's own reasoning for saying no. */
  reasoning: z.string(),
  verdictSource: VerdictSourceTextSchema.optional(),
}).strict()

export type FindingFailurePoint = z.infer<typeof FindingFailurePointSchema>

/**
 * A draft that earned a decision: the loop verified it and a human says whether it joins the suite.
 *
 * `disposition` is the value `computeDraftDisposition` produced, copied off the receipt rather than
 * re-derived — one derivation, and a surface that recomputed it would answer differently the day N
 * is retuned.
 *
 * `runsPreviewed` AND `runsConsumed` RIDE THIS ARM TOGETHER, and that pairing is WTST-08 (394-08,
 * D-03). The preview promises a bound before dispatch; this reports what was actually spent. The
 * actual figure ALONE would leave the disclosure unfalsifiable — nothing to compare it against —
 * and the preview alone is the defect the requirement exists to prevent. One reader, one arm, both
 * numbers.
 *
 * They replace plan 06's single `actualRuns`, which was `gateRuns.length + repairIterations`. That
 * count was wrong in the direction that matters: a repair iteration whose patch is FENCED consumes
 * an iteration and starts no run at all (D-09), so an invocation that spent 3 runs could report 6.
 * An over-count hides a real preview breach behind a number that looks worse than reality, which is
 * the one way an honesty field can lie while appearing conservative. `runsConsumed` counts DISTINCT
 * run ids, so it can neither over-count a fenced iteration nor double-count a run that served as
 * both the last probe and part of the final stability gate.
 */
export const TestDraftProposalV1Schema = z.object({
  schemaVersion: z.literal(CURRENT_AUTHORING_PROPOSAL_SCHEMA_VERSION),
  draftRef: DraftRefSchema,
  disposition: z.enum(DRAFT_DISPOSITIONS),
  /** The upper bound the dispatch confirm disclosed: initial N + K probes + final N. */
  runsPreviewed: z.number().int().nonnegative(),
  /** Distinct runs this draft really consumed — gate runs AND repair probes, counted once each. */
  runsConsumed: z.number().int().nonnegative(),
  /** Repair iterations spent. `0` for a draft that was never routed to repair. */
  repairIterations: z.number().int().nonnegative(),
  /** One line a person reads in an inbox list. Never the draft's bytes. */
  summaryLine: z.string().min(1),
}).strict()

export type TestDraftProposalV1 = z.infer<typeof TestDraftProposalV1Schema>

/**
 * A draft that failed for the right reason: the application looks wrong, and here is the evidence.
 *
 * ACCEPTING ONE IS AN ACKNOWLEDGEMENT (D-11, record-and-surface). There is no issue filed and no
 * file written; the decision trail 391 already keeps is the whole of what accepting does. That is
 * deliberate rather than unfinished — the Issue lifecycle engine supersedes this artifact class
 * and consumes it, and filing into a system that does not exist yet would be inventing a second
 * half of a contract nobody can honour.
 *
 * THE RETAINED DRAFT IS THE POINT, so a later reader does not garbage-collect it: a correctly
 * failing test IS the regression test for the defect it found, and `draftRef` is what the Issue
 * engine later anchors a bug-repro to. Deleting the draft because "it failed" would throw away the
 * most valuable artifact the loop produced.
 */
export const FindingProposalV1Schema = z.object({
  schemaVersion: z.literal(CURRENT_AUTHORING_PROPOSAL_SCHEMA_VERSION),
  /** The correctly-failing draft, retained as the regression-test seed. */
  draftRef: DraftRefSchema,
  /** The router's own class, so a reader knows whether this was definitive or ambiguous. */
  signalClass: z.string().min(1),
  /** `null` for a member-level failure with no step to point at. */
  failurePoint: FindingFailurePointSchema.nullable(),
  /** The exact trace and the a11y snapshots at the failure point, as coordinates. */
  evidenceRefs: z.array(RunEvidenceRefSchema).readonly(),
  /**
   * The LLM's evidence-linked explanation of what the application appears to be doing wrong.
   *
   * The MODEL writes this and never decides the branch — the routing is `routeRepairOrFinding`'s,
   * over run evidence alone. Prose about a decision already taken is the one thing a model is
   * genuinely better at here, and it is stored as prose so nothing downstream parses it.
   */
  explanation: z.string(),
}).strict()

export type FindingProposalV1 = z.infer<typeof FindingProposalV1Schema>
