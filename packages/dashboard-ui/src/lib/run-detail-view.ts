// THE RUN-DETAIL PROJECTION — the whole distance between what the op returned and what a person
// reads.
//
// Phase 405-06 · DETL-01 / DETL-02 / DETL-03, D-06 / D-10 / D-15 / D-16 / D-17 / D-18, RESEARCH D2.
//
// EVERY PUBLISHED SENTENCE IS AN EXPORTED CONSTANT (403-05 D-5, the `post-processing-view.ts`
// idiom). The tree (405-08) and the overview (405-11) assert their copy BY CONSTANT rather than by
// string, so a sentence moves in one place and its cells move with it; prose inlined in a component
// is prose that drifts from prose inlined in a test, and both of them stay green while the page
// says two different things.
//
// IT IS PURE AND TOTAL. No React, no fetch, no clock. The only input any function here takes is the
// op's own `RunDetailProjection` (or a row out of it), so nothing on this page can render a state
// the read did not report — the 399.1 render contract, restated for run detail.
//
// ABSENT IS NOT ZERO, AND IT IS THE LOAD-BEARING RULE OF THIS FILE. `RunTokenTotals` omits its three
// sums entirely when nothing was measured (D-06), because "no step reported usage" and "every step
// reported zero" are different facts about a run. There is deliberately no `?? 0` anywhere below:
// a default would convert "nobody measured this" into "this was free" at the exact layer a person
// reads, which is the one place that lie is unrecoverable.

import type {
  ArtifactRef,
  RunDetailMember,
  RunDetailProjection,
  RunDetailStep,
  RunDetailSubAction,
  RunTokenTotals,
} from '@vostride/agent-qa-schema'

import { formatTokens } from './format'
import { DID_NOT_RUN_NOTE } from './run-stream-reducer'

// ---------------------------------- copy ----------------------------------

/**
 * What a member with no steps renders as (D-16 / D-18).
 *
 * The VALUE is the live reducer's {@link DID_NOT_RUN_NOTE}, not a second spelling of it: the live
 * page and the durable page describe the same member, and two constants that happen to agree today
 * are two constants that can disagree tomorrow.
 */
export const DID_NOT_RUN_LABEL: string = DID_NOT_RUN_NOTE

/** What the token line says when the run carries no measurement at all (D-06). */
export const TOKENS_NOT_MEASURED_LABEL = 'tokens not measured'

/** The chip for a `SECRET` placeholder this host's current config cannot restore (D-10). */
export const MASKED_SECRET_LABEL = "masked secret — not in this host's config"

/**
 * The chip for a masked email (D-10).
 *
 * Email placeholders are minted during masking BY DETECTION and have no source to re-derive from,
 * so this one is never restorable — it is a permanent state, not a misconfiguration.
 */
export const MASKED_EMAIL_LABEL = 'masked email'

/**
 * The honest state for a ref whose blob is gone or was never written (D-15).
 *
 * Never a broken image element, never a silently dropped row. 406 upgrades this to the ratified
 * `evidence-incomplete` rendering without changing the op or this constant's job.
 */
export const SCREENSHOT_UNAVAILABLE_LABEL = 'screenshot unavailable'

/**
 * What the tree says when the durable read itself FAILED (405-08 · D-03).
 *
 * Distinct from an empty projection on purpose. A run that recorded no steps and a run whose
 * detail could not be read are different facts, and rendering both as an empty tree would make a
 * server fault indistinguishable from a quiet test — the exact confusion D-18 removes at the
 * member level, applied one level up.
 */
export const RUN_DETAIL_UNAVAILABLE_LABEL = 'Could not load this run\u2019s steps.'

/** The screen-context affordance when the post-state matched the pre-state (RESEARCH D2). */
export const SCREEN_STATE_UNCHANGED_LABEL = 'state unchanged'

/** The screen-context affordance when a distinct post-state was recorded (RESEARCH D2). */
export const SCREEN_STATE_CHANGED_LABEL = 'state changed'

// -------------------------------- grouping --------------------------------

/** One step with the sub-actions recorded under it, both already in the producer's order. */
export interface RunDetailStepGroup {
  readonly step: RunDetailStep
  readonly subActions: readonly RunDetailSubAction[]
}

/** One member of the run and everything the projection recorded beneath it (D-16). */
export interface RunDetailGroup {
  readonly member: RunDetailMember
  readonly steps: readonly RunDetailStepGroup[]
}

/** The composite key a step and its sub-actions are joined on — the handle plus the ordinal. */
function stepKey(testIndex: number, stepIndex: number): string {
  return `${String(testIndex)} ${String(stepIndex)}`
}

/**
 * Fold the three flat row arrays into the tree the page draws (D-16 / D-18).
 *
 * ONE GROUP PER MEMBER, always — including a member with no steps at all, whose stream began with a
 * terminal event (D-18). Omitting it would render a suite as though it had fewer tests than it ran,
 * and blank rows under a green tick read as "it passed everything", which is a lie about a member
 * that never started.
 *
 * A step whose `testIndex` names no member row is not renderable under a member header and is not
 * given an invented one. That cannot occur on the shipped producer — the subscriber writes a member
 * row for every handle, including a thin one (405-01) — so this is a totality property of the fold
 * rather than a case the page has to explain.
 */
export function groupRunDetail(projection: RunDetailProjection): RunDetailGroup[] {
  const subActionsByStep = new Map<string, RunDetailSubAction[]>()
  for (const sub of projection.subActions) {
    const key = stepKey(sub.testIndex, sub.stepIndex)
    const bucket = subActionsByStep.get(key)
    if (bucket === undefined) subActionsByStep.set(key, [sub])
    else bucket.push(sub)
  }

  const stepsByMember = new Map<number, RunDetailStep[]>()
  for (const step of projection.steps) {
    const bucket = stepsByMember.get(step.testIndex)
    if (bucket === undefined) stepsByMember.set(step.testIndex, [step])
    else bucket.push(step)
  }

  return [...projection.members]
    .sort((a, b) => a.testIndex - b.testIndex)
    .map((member) => ({
      member,
      steps: [...(stepsByMember.get(member.testIndex) ?? [])]
        .sort((a, b) => a.stepIndex - b.stepIndex)
        .map((step) => ({
          step,
          subActions: [...(subActionsByStep.get(stepKey(step.testIndex, step.stepIndex)) ?? [])].sort(
            (a, b) => a.subActionIndex - b.subActionIndex,
          ),
        })),
    }))
}

// --------------------------------- filter ---------------------------------

/** The default: every member, no narrowing (D-16). */
export const MEMBER_FILTER_ALL = 'all'

/** What the member filter can be — the default word, or one member's handle. */
export type MemberFilter = typeof MEMBER_FILTER_ALL | number

/** Narrow the grouped tree to one member, or hand it back whole. */
export function filterGroups(
  groups: readonly RunDetailGroup[],
  filter: MemberFilter,
): RunDetailGroup[] {
  if (filter === MEMBER_FILTER_ALL) return [...groups]
  return groups.filter((group) => group.member.testIndex === filter)
}

/**
 * Read the `member=<testIndex>` query param.
 *
 * IT NEVER THROWS AND IT NEVER GUESSES. A URL is attacker-adjacent and hand-editable; anything that
 * is not a non-negative integer answers {@link MEMBER_FILTER_ALL}, which lands the viewer on the
 * ordinary whole-run view. The failure mode of a wrong answer here is a page showing MORE than the
 * link asked for, never less.
 */
export function parseMemberFilter(raw: string | null | undefined): MemberFilter {
  if (raw === null || raw === undefined || raw === '') return MEMBER_FILTER_ALL
  if (!/^\d+$/.test(raw)) return MEMBER_FILTER_ALL
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) ? parsed : MEMBER_FILTER_ALL
}

// ------------------------------ member copy -------------------------------

/**
 * The note that goes under a member header, or nothing (D-18).
 *
 * Only ONE note exists: a member that produced no step did not run. The member's own
 * `failureSummary` ("skipped by fail-fast", "budget exhausted") is the PRODUCER's sentence and is
 * rendered verbatim beside this one — it is never folded in here, because a note this file wrote
 * and a note the runner wrote are different claims and a reader is entitled to tell them apart.
 */
export function memberNote(
  _member: RunDetailMember,
  group: Pick<RunDetailGroup, 'steps'>,
): string | undefined {
  return group.steps.length === 0 ? DID_NOT_RUN_LABEL : undefined
}

/**
 * What a member header calls the member (D-16).
 *
 * A member row carries a `name` only when the producer knew one; a thin member whose stream began
 * with a terminal event may carry nothing but its handle (D-18). The fallback names the member by
 * its ORDINAL POSITION rather than by an invented identity — "Test 2" is a statement about where
 * this member sits in the run, which is true, where a synthesised title would be a claim about
 * what the test was, which nobody recorded.
 */
export function memberDisplayName(member: Pick<RunDetailMember, 'testIndex' | 'name'>): string {
  return member.name ?? `Test ${String(member.testIndex + 1)}`
}

/**
 * The member's handle, as a person reads it (402 D-10, RESEARCH D4).
 *
 * `testIndex` IS the handle — `handleId(runId, testIndex)` is how the product spells run-scoped
 * member identity — so the header shows the index itself rather than a second numbering. It is
 * NOT `+ 1`: a reader who copies this number into a `?handle=` observation must get the handle the
 * product answers to, and a display ordinal that quietly differed from the addressable one would
 * be the kind of off-by-one nobody can debug from the screen.
 */
export function memberHandleLabel(testIndex: number): string {
  return `#${String(testIndex)}`
}

/**
 * What the member header says about a re-run (D-17).
 *
 * `attempts` is an ORDINAL that starts at 1; the phrase counts RE-RUNS, so it is one less. A member
 * on its first attempt says nothing at all — "re-ran after failure x0" would be a sentence about an
 * event that did not happen.
 */
export function reranLabel(attempts: number): string | undefined {
  return attempts > 1 ? `re-ran after failure ×${String(attempts - 1)}` : undefined
}

// ------------------------------- token line -------------------------------

/**
 * The run's model spend, in one honest sentence (D-06).
 *
 * The sums are ABSENT rather than zero when nothing was measured, so the absence — not a count — is
 * what selects {@link TOKENS_NOT_MEASURED_LABEL}. A step that genuinely spent zero IS a measurement
 * and reads as `0 tokens across 1 of 1 steps`; a run nobody measured reads as "tokens not measured".
 * Those two sentences must never collapse into each other, which is why there is no `?? 0` here.
 */
export function tokenSummaryLine(tokens: RunTokenTotals): string {
  const { measuredSteps, unmeasuredSteps, totalTokens } = tokens
  if (measuredSteps === 0 || totalTokens === undefined) return TOKENS_NOT_MEASURED_LABEL
  const allSteps = measuredSteps + unmeasuredSteps
  return `${formatTokens(totalTokens)} tokens across ${String(measuredSteps)} of ${String(allSteps)} steps`
}

// ----------------------------- screen context -----------------------------

/** How many characters of a screen-state hash a person can usefully compare by eye. */
const SCREEN_STATE_CHIP_LENGTH = 12

/**
 * The screen-state hash, shortened to a chip (RESEARCH D2).
 *
 * The bus carries no screen-context TEXT — only `screenStateHash`, a sha256 over the canonical
 * `ScreenState`. So "screen context" on this page honestly means the hash pair, and a short id is
 * the only form of it a reader can hold in their head long enough to compare two rows.
 */
export function screenStateChip(hash: string): string {
  return hash.slice(0, SCREEN_STATE_CHIP_LENGTH)
}

/**
 * Whether this sub-action moved the screen (RESEARCH D2).
 *
 * Reads the PAIR, not the presence of the field: `screenStateHashAfter` is only recorded when a
 * post-state was captured at all, and a recorded post-state identical to the pre-state is a screen
 * that did not change — the same answer as never having looked, and the honest one either way.
 */
export function screenStateChangeLabel(subAction: RunDetailSubAction): string {
  const after = subAction.screenStateHashAfter
  if (after === undefined || after === subAction.screenStateHash) return SCREEN_STATE_UNCHANGED_LABEL
  return SCREEN_STATE_CHANGED_LABEL
}

// ------------------------------- page chrome ------------------------------

/**
 * Whether the page draws member grouping chrome at all (D-16).
 *
 * A single-member run has nothing to group and nothing to filter; a header and a picker over one
 * item is chrome that asks the reader to make a choice they do not have.
 */
export function showMemberChrome(projection: Pick<RunDetailProjection, 'members'>): boolean {
  return projection.members.length > 1
}

// ------------------------- the decision screenshot -------------------------

/**
 * The id prefix the evidence store mints a decision screenshot under (405-11 · D-14 / D-15).
 *
 * A sub-action's `artifactRefs` is an open list — the producer is free to attach other evidence to
 * the same turn — so the overview SELECTS by this prefix rather than taking the first entry. Taking
 * whatever happened to be first would put an arbitrary blob into an `img` the moment a second
 * channel starts recording, which is a wrong picture rather than a missing one.
 */
export const DECISION_SCREENSHOT_REF_PREFIX = 'decision-screenshot:'

/**
 * The decision screenshot recorded for this sub-action, or nothing.
 *
 * ONE SHOT PER TURN, not a before/after pair. The bus records the screen the planner LOOKED AT when
 * it decided; there is no post-action capture on the same sub-action, so there is no second side to
 * select. Deriving an "after" from the next sub-action's shot would be a join nobody recorded — the
 * screen may have moved for reasons this action did not cause, and a caption claiming otherwise is
 * a lie a reader cannot check.
 */
export function decisionScreenshotRef(
  subAction: Pick<RunDetailSubAction, 'artifactRefs'>,
): ArtifactRef | undefined {
  return subAction.artifactRefs?.find((ref) => ref.id.startsWith(DECISION_SCREENSHOT_REF_PREFIX))
}

/**
 * One step's spend, in the shape {@link tokenSummaryLine} reads (D-06).
 *
 * ABSENT STAYS ABSENT. A step that reported no usage becomes one UNMEASURED step and carries no
 * sums at all, so the line says "tokens not measured" rather than `0 tokens across 0 of 1 steps`.
 * A step that genuinely reported zero becomes one MEASURED step whose sums are zero, and reads as
 * the measurement it is. There is no `?? 0` on this path and none can be added without reddening a
 * cell — which is the entire reason the run-level totals were given this shape upstream.
 */
export function stepTokenTotals(step: Pick<RunDetailStep, 'tokenUsage'>): RunTokenTotals {
  const usage = step.tokenUsage
  if (usage === undefined) return { measuredSteps: 0, unmeasuredSteps: 1 }
  return {
    measuredSteps: 1,
    unmeasuredSteps: 0,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
  }
}
