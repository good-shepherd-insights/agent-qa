// The ONE envelope payload arm 394 lands, and the ONE evidence-ref vocabulary (D-05 · WTST-01).
//
// A KEEP-ELIGIBLE DRAFT BECOMES SOMETHING A HUMAN DECIDES ON. D-05 is blunt about it: keep-eligible
// never auto-writes, so a verified draft is a PROPOSAL. It rides 391's envelope, so the inbox, the
// digest, the decision trail, accept-with-always and expiry all come free and none of them learns
// anything new.
//
// WHY `test-draft` IS A KIND AND NOT A FIELD ON THE KNOWLEDGE ARM. `PROPOSAL_KINDS` feeds two
// exhaustive `Record<ProposalKind, …>` sites — the accept verb's apply routes and the digest's
// required-decision strings — so a discriminated kind gets compile-time coverage at both of them
// for free. A boolean or an enum FIELD on one payload gets none: the accept route would be the
// knowledge route, the digest line would read as a knowledge proposal's, and nothing would fail to
// compile. The artifacts also want different decisions — one is applied to a knowledge store, the
// other writes a file — which is a difference in what accepting MEANS rather than in what is
// attached.
//
// 2026-09-02 (Phase 411): the proposal arm for a correctly-failing draft left with the Issue-slot
// cleanup — see `DELETION-INVENTORY.md`. What it used to carry is now reported on the op's own
// result and nothing is minted; the run-evidence coordinate vocabulary below survives it, because
// that result carries the same coordinates.
//
// MAP, NOT TERRITORY (391 D-18). The arm carries refs and one-liners. The draft bytes stay on the
// shelf, the receipt stays in the receipts store, and the run evidence stays in the run's own
// durable records — an envelope is what a person reads before deciding, not a copy of everything
// the decision is about.
//
// THERE IS NO SEPARATE `receiptRef`. The receipts store keys a receipt by
// `draftRef.contentDigest`, so a `receiptRef` field would be that same string a second time, and
// 391's envelope already records what two copies of one link cost: one of them starts pointing at
// nothing. The draft ref IS the receipt's address.

import { z } from 'zod'

import { slugBranch } from '../ids/slug'
import { DRAFT_DISPOSITIONS } from './disposition'
import { DraftRefSchema } from './draft-receipt'

/**
 * How long a slugged test name may be before it is cut.
 *
 * RETUNE: raise it if real authored names are being truncated into collisions — the apply refuses
 * a target that already exists, so a collision costs a refusal rather than an overwrite, which is
 * the direction to fail in but not a direction to sit in. It may not become unbounded: this value
 * becomes a filename, and some filesystems still cap a component at 255 bytes.
 */
export const AUTHORED_SUITE_SLUG_MAX_LENGTH = 60

/** The name a draft whose test name slugs to nothing at all is filed under. */
const AUTHORED_SUITE_FALLBACK_SLUG = 'authored-test'

/**
 * Where an accepted draft is written, derived from where its DRAFT already lives.
 *
 * THE SUITE DIRECTORY IS NOT GUESSED, it is read off the shelf path. A draft is staged at
 * `<suiteDir>/<shelfDir>/<digest>.yaml`, so walking two segments up recovers the directory this
 * project's `workspace.testMatch` actually admits — and a project whose tests live under `e2e/`
 * gets `e2e/<slug>.yaml` without this function knowing that any such project exists. A hardcoded
 * `tests/` here would be a second spelling of a CONFIGURABLE fact, and the first project to
 * configure it differently would have every accepted draft written somewhere its own suite
 * discovery cannot see.
 *
 * The slug goes through {@link slugBranch}, which is the ONE security-reviewed path-segment
 * sanitizer — a model-authored test name reaches this function, so the value that becomes a
 * filename must not be able to name a separator, a parent directory or a hidden file.
 */
export function authoredSuiteTargetPath(draftShelfPath: string, testName: string): string {
  const segments = draftShelfPath.split('/').filter((segment) => segment.length > 0)
  const suiteDirectory = segments.slice(0, Math.max(segments.length - 2, 0)).join('/')
  const slug = slugBranch(testName)
    .toLowerCase()
    .slice(0, AUTHORED_SUITE_SLUG_MAX_LENGTH)
    .replace(/[.\-]+$/, '')
  const name = `${slug.length > 0 ? slug : AUTHORED_SUITE_FALLBACK_SLUG}.yaml`
  return suiteDirectory.length > 0 ? `${suiteDirectory}/${name}` : name
}

/** Version 1: the first shape of the arm. No envelope of this kind exists on disk yet. */
export const CURRENT_AUTHORING_PROPOSAL_SCHEMA_VERSION = 1

/**
 * Which durable record an evidence coordinate addresses.
 *
 * THE ONE CHANNEL VOCABULARY. The router builds these coordinates and `authoring.draft.write`'s
 * `stop` arm carries them (411 D-07), and the two are the same thing seen from either side of the
 * result — so the words are spelled here, in `schema`, and the router imports them. A second
 * spelling inside `agent` would be free to drift from the one a caller was answered with, which is
 * the drift a wire projection can never detect because both halves would parse.
 */
export const RUN_EVIDENCE_CHANNELS = ['step-trace', 'state-before', 'state-after'] as const

export type RunEvidenceChannel = (typeof RUN_EVIDENCE_CHANNELS)[number]

/**
 * A COORDINATE into a run's own durable records. Never a payload.
 *
 * `.strict()` is the refusal surface: a screen state, an element tree or a rendered snapshot
 * copied onto a stop payload fails to parse here rather than becoming a durable record nobody meant
 * to write. The key set is additionally pinned by equality in `router.test-d.ts`.
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
  /**
   * Where accepting writes this draft — workspace-relative, boundary-checked at the apply.
   *
   * IT RIDES THE ARM RATHER THAN BEING DERIVED AT ACCEPT TIME, and the reason is {@link
   * TestDraftProposalV1Schema.shape.sourceDigest} directly below it: a digest is a claim about the
   * bytes at a PATH, so a path recomputed later by a second recipe could disagree with the one the
   * digest was taken over, and the re-check would then be comparing a file nobody looked at. The
   * two fields are one fact and they travel together.
   */
  targetPath: z.string().min(1),
  /**
   * sha256 of the target's bytes as the proposal read them; ABSENT when the target did not exist.
   *
   * The map-not-territory posture the whole arm keeps: a digest is a ref, never a copy of the
   * bytes. The loop's own drafts are new files and carry no digest at all; `authoring.draft.edit`
   * proposes against an EXISTING committed test and carries that file's digest, which is what
   * makes the absent case a claim about absence rather than the common case wearing a waiver.
   */
  sourceDigest: z.string().min(1).optional(),
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
