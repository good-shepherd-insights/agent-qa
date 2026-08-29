// THE KNOWLEDGE PROJECTION — the whole distance between what `runs.knowledge` said and what a
// person reads in the Knowledge tab.
//
// Phase 407-02 · LERN-01, D-01 / D-03 / D-04 / D-06 / D-16.
//
// IT IS PURE AND TOTAL. No I/O, no clock, no React. Its only input is a `KnowledgeRead` — the
// client's own bytes — so a state the panel paints can never be one the op did not say, and every
// read maps to exactly one view, including the reads nobody wants: a refused door, a pruned
// handoff, a project with no knowledge root, a run that served nothing. A projection with a hole
// in it renders blank, and a blank pane behind a tab someone pressed `7` to reach is the exact
// dishonesty D-04 was written against.
//
// THE SUMMARY LINE IS A DERIVATION, NEVER A SECOND READ (D-03). Every count below is folded from
// the step rows this same view already carries. Asking the op for an aggregate it could compute
// from rows already on the wire would create a second number that can disagree with the first.
//
// EVERY PUBLISHED SENTENCE IS AN EXPORTED CONSTANT (403-05 D-5). The cells assert against the
// constants and the components import them, so copy moves in one place; prose inlined in a
// component is prose that drifts from prose inlined in a test, and both of them stay green while
// the two disagree.
//
// SOME CONSTANTS BELOW HAVE NO READER YET, ON PURPOSE. The channel eyebrows, the why-trigger, the
// trace line and the cut-candidates label are the words 407-06 / 407-09 / 407-10 will paint.
// Publishing them here — with the shape of the `ready` arm they hang off — is what keeps those
// plans pure additions to a proven module rather than three private spellings of one contract.

import { TRACE_TRUNCATION_TOP_K } from '@vostride/agent-qa-schema'
import type {
  BriefWhyNoTraceReason,
  PostProcessingChipStatus,
  RecordChange,
  RecordedRetrievalRung,
  RetrievalRung,
  RetrievalRungReason,
  RetrievalTraceLeg,
  RunKnowledgeCanaryAttribution,
  RunKnowledgePlanSource,
  RunKnowledgeStep,
  RunKnowledgeTrace,
  TraceLine,
} from '@vostride/agent-qa-schema'

import type { KnowledgeRead } from './api'

// ─────────────────────────────────────────────────────────────────────────────
// Page-level copy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the tab says when this project has no knowledge store at all (D-16).
 *
 * NOT A RUNG, AND NOT AN EMPTY RESULT. A run executed with no reader bound never asked retrieval
 * anything, so "nothing was served" would describe a search that came back empty — a different
 * fact, and one that would send an operator looking for a broken index instead of a missing
 * config key.
 */
export const NO_STORE_HEADING = 'No knowledge store configured for this project'

/** The no-store body: what this means, and the one thing that changes it. */
export const NO_STORE_BODY =
  'Runs in this project are executed without a brief. Add a knowledge root to your config to start serving one.'

/** What the tab says when the read itself failed or was refused — never a blank pane. */
export const READ_FAILED_HEADING = 'Knowledge could not be read'

/**
 * The read-failed body: the producer's own masked reason, then what to do about it.
 *
 * THE ERROR IS FORWARDED WITHOUT A SINGLE SLICE (T-407-07). It is the client's masked `request()`
 * message — a status name, never a stack and never a path — and truncating it here would leave a
 * reader with half a word to search for. The component renders it as a text node inside a
 * `break-words` paragraph, so a long one wraps rather than eating the doctor pointer.
 */
export function readFailedBody(error: string): string {
  return `${error}. Try reloading the page; if it persists, run \`agent-qa doctor\`.`
}

/**
 * What the Used half says when the run has NO STEPS to describe at all.
 *
 * Deliberately a different sentence from {@link NO_BRIEF_LINES_TEXT}. This one says nothing ever
 * asked; that one says retrieval ran on every step and served nothing back. One is a run with no
 * briefed work in it, the other is an empty store or a failing retriever — two different things
 * to go and look at.
 */
export const NO_BRIEF_SERVED_TEXT = 'No brief was served on this run.'

// ─────────────────────────────────────────────────────────────────────────────
// Used half
// ─────────────────────────────────────────────────────────────────────────────

/** The Used half's heading — one `<h4>`, 16px/500 (UI-SPEC Typography). */
export const USED_HEADING = 'Used'

/** The summary line when every derived segment is zero. See {@link NO_BRIEF_SERVED_TEXT}. */
export const NO_BRIEF_LINES_TEXT = 'No brief lines were served on this run.'

/** What a step row says instead of badges when that step served nothing (muted, not a Badge). */
export const STEP_NO_BRIEF_TEXT = 'no brief served'

/** The fact badge counting a row's served lines. */
export function briefLinesFact(count: number): string {
  return `${String(count)} brief ${count === 1 ? 'line' : 'lines'}`
}

/**
 * The fact badge counting a row's canary lines.
 *
 * `canary` does not inflect: it is the MARKER's name being counted, not a plural noun phrase, and
 * the Copywriting Contract spells it `{k} canary` at every k.
 */
export function canaryFact(count: number): string {
  return `${String(count)} canary`
}

/** The fact badge on a step whose plan came from a replayed procedure (D-07). */
export const REPLAY_FACT = 'replay'

/** The fact badge on a step whose plan was hinted by a procedure (D-07). */
export const HINT_FACT = 'hint'

/** One step row's title: the ONE-BASED ordinal a person counts by, then the step's own text. */
export function stepRowTitle(stepIndex: number, stepText: string): string {
  return `Step ${String(stepIndex + 1)} — ${stepText}`
}

/** The four derived counts the summary line is folded from (D-03). */
export interface UsedCounts {
  readonly stepsBriefed: number
  readonly canaryLines: number
  readonly replays: number
  readonly hints: number
}

/**
 * The run-level count line, DERIVED from the rows the panel already holds (D-03).
 *
 * A ZERO SEGMENT IS OMITTED, not printed as a zero. `0 canary lines served` claims somebody
 * measured canary attribution on this run and found none; the absent segment says the subject
 * never came up. The whole-line fallback exists for exactly the case where every segment would
 * have been dropped, because a bare `·` separator with nothing around it is not a sentence.
 */
export function usedSummaryLine(counts: UsedCounts): string {
  const segments: string[] = []

  if (counts.stepsBriefed > 0) {
    segments.push(`${String(counts.stepsBriefed)} ${counts.stepsBriefed === 1 ? 'step' : 'steps'} briefed`)
  }
  if (counts.canaryLines > 0) {
    segments.push(`${String(counts.canaryLines)} canary ${counts.canaryLines === 1 ? 'line' : 'lines'} served`)
  }

  // Replays and hints share ONE segment separated by a comma — the sentence of record reads
  // `1 procedure replay, 2 hints`, so a run with both does not spend two middots on one subject.
  const procedure: string[] = []
  if (counts.replays > 0) {
    procedure.push(`${String(counts.replays)} procedure ${counts.replays === 1 ? 'replay' : 'replays'}`)
  }
  if (counts.hints > 0) {
    procedure.push(`${String(counts.hints)} ${counts.hints === 1 ? 'hint' : 'hints'}`)
  }
  if (procedure.length > 0) segments.push(procedure.join(', '))

  if (segments.length === 0) return NO_BRIEF_LINES_TEXT
  return segments.join(' · ')
}

// ─────────────────────────────────────────────────────────────────────────────
// Reserved copy — published now, painted by 407-06 / 407-09 / 407-10
// ─────────────────────────────────────────────────────────────────────────────

/** The three served channels, as the eyebrow captions inside an expanded step row (407-06). */
export const CHANNEL_EYEBROWS = {
  1: 'CHANNEL 1 · BRIEF',
  2: 'CHANNEL 2 · READ TRACES',
  3: 'CHANNEL 3 · CAUTIONS',
} as const

/** The per-line trace expander's trigger (D-04, 407-06). */
export const WHY_TRIGGER_TEXT = 'Why this line?'

/**
 * One answered trace line: which leg ranked it, where, and how strongly (D-04, 407-06).
 *
 * Three decimal places because that is the resolution at which two adjacent candidates stop
 * looking identical; rendered `tabular-nums` so a column of them does not jitter.
 */
export function traceLineText(leg: string, rank: number, score: number): string {
  return `leg ${leg} · rank ${String(rank)} · score ${score.toFixed(3)}`
}

/**
 * The truncated-ledger disclosure (D-04, 407-06).
 *
 * THE CAP IS IMPORTED, NEVER TYPED. `TRACE_TRUNCATION_TOP_K` is the producer's own bound; a
 * literal `20` here would be a second copy of it that goes silently wrong the day the producer
 * moves.
 */
export function cutCandidatesLabel(count: number): string {
  return `Cut candidates (${String(count)} of top ${String(TRACE_TRUNCATION_TOP_K)})`
}

/** The `pre-trace-run` no-trace arm, stated rather than dropped (D-04). */
export const PRE_TRACE_TEXT = 'no trace was captured for this run'

/** The `step-not-found` no-trace arm, stated rather than dropped (D-04). */
export const STEP_NOT_FOUND_TEXT = 'no evidence recorded for this step'

/** The serve-time canary marker, worn by every canary line whatever curation did with it (D-08). */
export const CANARY_BADGE_TEXT = 'canary'

/**
 * What a canary line says while curation is still `pending` or `running` (D-08).
 *
 * NOT BLANK, AND NOT AN OUTCOME. "Nobody has decided yet" is a different fact from "the fold ran
 * and attributed nothing", and a line that rendered neither would read as though the canary had
 * simply not mattered.
 */
export const ATTRIBUTION_PENDING_TEXT = 'attribution pending'

/** What a canary line says when curation FAILED, or settled and attributed nothing to it (D-08). */
export const NOT_ATTRIBUTED_TEXT = 'not attributed'

/** The plan-source sentence for a step whose plan a procedure only HINTED at (D-07). */
export const PROCEDURE_HINT_TEXT = 'procedure hint'

/**
 * The hint sentence for a hint that was a REPLAY RECOMMENDATION first (D-07, G-381-4).
 *
 * The distinction is the whole reason `demotion` is on the wire: a demoted replay and an ordinary
 * served hint are byte-identical in what they served, and only the recorded demotion tells a
 * reader that the procedure was trusted enough to replay and then was not.
 */
export const PROCEDURE_HINT_DEMOTED_TEXT = 'procedure hint (demoted from replay)'

/** The replay sentence when the guard passed every check it had (D-07). */
export function replayedText(checksPassed: number, total: number): string {
  return `replayed ${String(checksPassed)}/${String(total)}`
}

/**
 * The three ways a replay guard can break, in the words the Copywriting Contract spells.
 *
 * `executionFailure` reads `adapter failure` rather than its member name because the member names
 * the layer that failed and the sentence names what a person can act on — an adapter that could
 * not perform the recorded action.
 */
export const BROKE_CAUSE_LABELS = {
  miss: 'miss',
  executionFailure: 'adapter failure',
  verifierRejection: 'verifier rejection',
} as const

export type BrokeCause = keyof typeof BROKE_CAUSE_LABELS

/** The replay sentence when the guard broke — `k` is ONE-BASED, the ordinal a person counts by. */
export function brokeAtText(step: number, cause: BrokeCause): string {
  return `broke at step ${String(step)}: ${BROKE_CAUSE_LABELS[cause]}`
}

/** How many lines of one channel render before the rest go behind a disclosure (UI-SPEC). */
export const CHANNEL_PAGE_SIZE = 50

/**
 * The paging trigger, counting the WHOLE channel rather than the hidden remainder.
 *
 * A reader deciding whether to open it is deciding how much they are about to be shown, which is
 * the total; the remainder is arithmetic they would have to do against a number that is not on
 * screen.
 */
export function showAllLinesLabel(total: number): string {
  return `Show all ${String(total)} lines`
}

/** The Learned half's heading — one `<h4>`, 16px/500 (407-09). */
export const LEARNED_HEADING = 'Learned'

// ─────────────────────────────────────────────────────────────────────────────
// The view
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where a step's plan came from, flattened to the RAW WORD the row's `data-plan-source` carries.
 *
 * `none` is a member of the vocabulary rather than an absent attribute, because a DOM cell
 * asserting "this step replayed nothing" needs something to read; an absent attribute is
 * indistinguishable from a row the component forgot to stamp.
 */
export type StepPlanSourceWord = 'none' | 'procedure-replay' | 'procedure-hint'

// ─────────────────────────────────────────────────────────────────────────────
// The expanded step row — channels, why-traces, cut ledger, plan source (407-06)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WHY this line was served — the trace's own answer, or the NAMED absence of one (D-04).
 *
 * EXACTLY TWO KINDS. Either the serve-time trace recorded this record and the panel prints what it
 * recorded, or it did not and the panel prints which of the three absences applies. There is no
 * third kind, because a third kind would be a rendering with no evidence behind it — and the one
 * thing this surface must never do is compute a rank or a score of its own. The numbers below are
 * READ from `trace.servedLines`; re-deriving them would answer about the index as it stands now
 * rather than about the moment the brief was assembled (KREV-02's founding argument).
 */
export type LineWhy =
  | {
      readonly kind: 'answered'
      readonly leg: RetrievalTraceLeg
      readonly rank: number
      readonly score: number
    }
  | { readonly kind: 'no-trace'; readonly reason: BriefWhyNoTraceReason }

/** The word a canary line wears — one of six, and never blank (D-08). */
export type CanaryOutcomeWord =
  | 'confirmed'
  | 'contradicted'
  | 'helpful'
  | 'harmful'
  | 'pending'
  | 'not-attributed'

/** One channel-1 line, with its trace answer and (if it is a canary) its outcome word. */
export interface BriefLineView {
  readonly id: string
  readonly kind: string
  readonly summary: string
  readonly trust: number
  readonly status: string
  readonly servedAsCanary: boolean
  readonly tier: string
  readonly why: LineWhy
  /** Present exactly when {@link servedAsCanary} — a non-canary line has no outcome to report. */
  readonly canaryOutcome?: CanaryOutcomeWord
}

/** One channel-2 read trace, as the row renders it. `bodyDigest` is storage identity, not shown. */
export interface ReadTraceView {
  readonly id: string
  readonly detailLevel: string
}

/** One channel-3 caution, as the row renders it. */
export interface CautionView {
  readonly id: string
  readonly summary: string
}

/** The truncated ledger — the answer to "why did it NOT say X" (D-04). */
export interface CutCandidatesView {
  readonly label: string
  readonly lines: readonly TraceLine[]
}

/** The replay/hint row: the sentence of record and the tone the badge is tinted by. */
export interface PlanSourceView {
  readonly kind: 'procedure-replay' | 'procedure-hint'
  readonly sentence: string
  readonly tone: 'ok' | 'broke' | 'hint'
}

/** Everything an EXPANDED step row shows. Empty channels are empty arrays, never absent. */
export interface StepDetailView {
  readonly channel1: readonly BriefLineView[]
  readonly channel2: readonly ReadTraceView[]
  readonly channel3: readonly CautionView[]
  /** Present only on an `answered` trace — see {@link cutCandidates}. */
  readonly cut?: CutCandidatesView
  /** Present only on a step whose evidence recorded a procedure plan source. */
  readonly planSource?: PlanSourceView
}

/** One page of a channel, plus the trigger that reveals the rest. */
export interface ChannelPage<T> {
  readonly lines: readonly T[]
  /** Absent when nothing is held back — an absent key, never a zero somebody counted. */
  readonly hiddenCount?: number
  readonly showAllLabel?: string
}

/**
 * The channel-1 lines with their trace answers, matched by `recordId` (D-04, LERN-01).
 *
 * THE TRACE IS PASSED EXPLICITLY, beside the step it belongs to, so the join is visible at every
 * call site rather than buried one dereference deep.
 *
 * THE `step-not-found` MAPPING IS THE ONE JUDGEMENT HERE. A trace that ANSWERED the step but
 * carries no `servedLines` entry for this record is a PER-LINE absence: the run recorded evidence
 * for the step and none for the line. That is the same situation `step-not-found` names one level
 * up — evidence exists, the thing being asked about is not in it — so the line borrows that arm
 * rather than inventing a fourth word no other surface renders. It is deliberately NOT
 * `artifact-missing` (nothing was pruned) and NOT `pre-trace-run` (a trace plainly exists).
 */
export function briefLineViews(
  step: RunKnowledgeStep,
  trace: RunKnowledgeTrace,
): readonly BriefLineView[] {
  return step.served.channel1.map(line => ({ ...line, why: lineWhy(line.id, trace) }))
}

function lineWhy(recordId: string, trace: RunKnowledgeTrace): LineWhy {
  if (trace.kind === 'no-trace') return { kind: 'no-trace', reason: trace.reason }

  const served = trace.trace.servedLines.find(candidate => candidate.recordId === recordId)
  if (served === undefined) return { kind: 'no-trace', reason: 'step-not-found' }

  return { kind: 'answered', leg: served.leg, rank: served.rank, score: served.score }
}

/**
 * The cut ledger, present ONLY where a trace answered (D-04).
 *
 * An answered trace that truncated nothing still gets the disclosure, reading `(0 of top 20)`:
 * "the budget cut nothing" is a fact the trace recorded, and it is a different answer from "there
 * is no trace to ask". Where there is no trace there is no ledger at all — an empty one would
 * claim a measurement nobody took.
 */
export function cutCandidates(trace: RunKnowledgeTrace): CutCandidatesView | undefined {
  if (trace.kind === 'no-trace') return undefined
  return { label: cutCandidatesLabel(trace.trace.truncated.length), lines: trace.trace.truncated }
}

/**
 * What a canary line says, from the curation word and the attribution — never blank (D-08).
 *
 * ORDER MATTERS. An unsettled chain is read FIRST, so a stale attribution from an earlier fold
 * cannot be presented as this run's answer while the current one is still running; and a FAILED
 * chain reads `not attributed` even where a row exists, because a fold that fell over did not
 * finish deciding.
 */
export function canaryOutcomeWord(
  curationStatus: PostProcessingChipStatus,
  attribution: RunKnowledgeCanaryAttribution | undefined,
): CanaryOutcomeWord {
  if (curationStatus === 'pending' || curationStatus === 'running') return 'pending'
  if (curationStatus === 'done' && attribution !== undefined) return attribution.outcome
  return 'not-attributed'
}

/**
 * The replay or hint sentence a step's plan source states (D-07).
 *
 * A GUARD MEMBER BEATS THE COUNT. `checksPassed === total` alongside a recorded `verifierRejection`
 * is a guard that got through its checks and was refused anyway; printing `replayed 5/5` there
 * would report a replay that did not happen. Precedence is miss → adapter → verifier: the earliest
 * point at which the replay stopped being possible is the one worth naming.
 */
export function planSourceSentence(planSource: RunKnowledgePlanSource): string {
  if (planSource.kind === 'procedure-hint') {
    return planSource.demotion === undefined ? PROCEDURE_HINT_TEXT : PROCEDURE_HINT_DEMOTED_TEXT
  }

  const broke = brokeAt(planSource.guard)
  if (broke !== undefined) return brokeAtText(broke.step + 1, broke.cause)

  return replayedText(planSource.guard.checksPassed, planSource.guard.total)
}

function brokeAt(
  guard: Extract<RunKnowledgePlanSource, { kind: 'procedure-replay' }>['guard'],
): { readonly step: number; readonly cause: BrokeCause } | undefined {
  if (guard.miss !== undefined) return { step: guard.miss.procedureStepIndex, cause: 'miss' }
  if (guard.executionFailure !== undefined) {
    return { step: guard.executionFailure.procedureStepIndex, cause: 'executionFailure' }
  }
  if (guard.verifierRejection !== undefined) {
    return { step: guard.verifierRejection.procedureStepIndex, cause: 'verifierRejection' }
  }
  return undefined
}

/** The plan-source row: its sentence and the tone the UI-SPEC tints its badge by. */
export function planSourceView(planSource: RunKnowledgePlanSource): PlanSourceView {
  const sentence = planSourceSentence(planSource)
  if (planSource.kind === 'procedure-hint') {
    return { kind: 'procedure-hint', sentence, tone: 'hint' }
  }
  return {
    kind: 'procedure-replay',
    sentence,
    tone: brokeAt(planSource.guard) === undefined ? 'ok' : 'broke',
  }
}

/**
 * The first {@link CHANNEL_PAGE_SIZE} lines of a channel, and the trigger for the rest.
 *
 * NO VIRTUALISATION, by design (UI-SPEC): step rows render collapsed, so the tab's DOM is bounded
 * by the number of steps rather than by the number of lines. This bounds the one case that is not
 * — a single step served hundreds of lines — without introducing a scroll owner inside a scroll
 * owner.
 */
export function channelPage<T>(lines: readonly T[]): ChannelPage<T> {
  if (lines.length <= CHANNEL_PAGE_SIZE) return { lines }
  return {
    lines: lines.slice(0, CHANNEL_PAGE_SIZE),
    hiddenCount: lines.length - CHANNEL_PAGE_SIZE,
    showAllLabel: showAllLinesLabel(lines.length),
  }
}

/** One collapsed step row, ready to paint. */
export interface StepRowView {
  readonly testIndex: number
  readonly stepIndex: number
  /** {@link stepRowTitle} applied — one-based ordinal, em dash, the step's own text. */
  readonly title: string
  /** Lines this step was served across ALL THREE channels — the same fold "briefed" is judged by. */
  readonly briefLines: number
  /** Channel-1 lines carrying the serve-time canary marker (D-08). */
  readonly canaryLines: number
  readonly planSource: StepPlanSourceWord
  /** The outline badges, in render order. Empty exactly when {@link noBrief} is set. */
  readonly facts: readonly string[]
  /** Present only on a step that served nothing; the row renders {@link STEP_NO_BRIEF_TEXT}. */
  readonly noBrief?: true
  /**
   * What the row shows when it is EXPANDED (407-06).
   *
   * Required, not optional: a row whose detail could be absent is a row a component has to guard,
   * and the guard would render blank for the one case D-04 exists to prevent. A step that served
   * nothing carries three empty channels — an answer, not a hole.
   */
  readonly detail: StepDetailView
}

/**
 * The Learned half, as the panel will paint it.
 *
 * DECLARED NOW, FILLED BY 407-09. The members are the DTO's own, so the plan that paints them
 * adds a projection body and no new shape — and the `ready` arm below does not have to grow a
 * member (which every consumer would have to be re-typed against) on the day it does.
 */
export interface LearnedView {
  readonly changes: readonly RecordChange[]
  readonly canaryAttributions: readonly RunKnowledgeCanaryAttribution[]
}

/** The rung that served THIS run, if the evidence recorded one (D-13). */
export interface RungView {
  readonly rung: RetrievalRung
  readonly reason?: RetrievalRungReason
}

/**
 * The whole tab, as one of four states — and `loading` is not among them.
 *
 * THE FIFTH STATE IS THE PAGE'S `undefined`, deliberately. "The first read has not landed" is a
 * fact about the client, not about the run: this module never sees a pending read because there
 * is nothing in a pending read to project. The component renders skeletons for `undefined` and
 * this union for everything else, which is why no arm here can be mistaken for "not yet known".
 */
export type KnowledgeView =
  | { readonly state: 'error'; readonly heading: string; readonly body: string }
  | { readonly state: 'evidence-incomplete' }
  | { readonly state: 'empty-no-store'; readonly heading: string; readonly body: string }
  | {
      readonly state: 'ready'
      readonly used: { readonly summary: string; readonly steps: readonly StepRowView[] }
      readonly rung?: RungView
      readonly learned?: LearnedView
    }

/** Did this step get served anything at all, on any channel? The one fold "briefed" means. */
function servedLineCount(step: RunKnowledgeStep): number {
  return step.served.channel1.length + step.served.channel2.length + step.served.channel3.length
}

function canaryLineCount(step: RunKnowledgeStep): number {
  return step.served.channel1.filter(line => line.servedAsCanary).length
}

function stepRow(
  step: RunKnowledgeStep,
  curationStatus: PostProcessingChipStatus,
  attributions: readonly RunKnowledgeCanaryAttribution[],
): StepRowView {
  const briefLines = servedLineCount(step)
  const canaryLines = canaryLineCount(step)
  const planSource: StepPlanSourceWord = step.planSource?.kind ?? 'none'

  const facts: string[] = []
  if (briefLines > 0) facts.push(briefLinesFact(briefLines))
  if (canaryLines > 0) facts.push(canaryFact(canaryLines))
  if (planSource === 'procedure-replay') facts.push(REPLAY_FACT)
  if (planSource === 'procedure-hint') facts.push(HINT_FACT)

  return {
    testIndex: step.testIndex,
    stepIndex: step.stepIndex,
    title: stepRowTitle(step.stepIndex, step.stepText),
    briefLines,
    canaryLines,
    planSource,
    facts,
    // A step that served nothing keeps its row and says so. Dropping it would make a run look
    // shorter than it was, and D-04's whole posture is that nothing silently drops.
    ...(briefLines === 0 ? { noBrief: true as const } : {}),
    detail: stepDetail(step, curationStatus, attributions),
  }
}

/**
 * The expanded body of one step row — THE ONLY PLACE THE CANARY OUTCOME WORD IS DECIDED.
 *
 * The join is on all three of `testIndex`, `stepIndex` and `recordId`. `stepIndex` is numbered per
 * member test, so a run with two tests has two step 0s; joining on the pair alone would attribute
 * one member's canary outcome to another member's line, which is the exact wrong-attribution
 * failure D-10 was written against one layer down.
 */
function stepDetail(
  step: RunKnowledgeStep,
  curationStatus: PostProcessingChipStatus,
  attributions: readonly RunKnowledgeCanaryAttribution[],
): StepDetailView {
  const channel1 = briefLineViews(step, step.trace).map(line =>
    line.servedAsCanary
      ? {
          ...line,
          canaryOutcome: canaryOutcomeWord(
            curationStatus,
            attributions.find(
              row =>
                row.testIndex === step.testIndex &&
                row.stepIndex === step.stepIndex &&
                row.recordId === line.id,
            ),
          ),
        }
      : line,
  )

  const cut = cutCandidates(step.trace)

  return {
    channel1,
    channel2: step.served.channel2.map(line => ({ id: line.id, detailLevel: line.detailLevel })),
    channel3: step.served.channel3.map(line => ({ id: line.id, summary: line.summary })),
    ...(cut === undefined ? {} : { cut }),
    ...(step.planSource === undefined ? {} : { planSource: planSourceView(step.planSource) }),
  }
}

/**
 * The read, as the tab — or as the named state that stopped there being one.
 *
 * FOUR ARMS, AND THREE OF THEM ARE ABSENCES. That ratio is the point: `runs.knowledge` answers
 * `evidence-incomplete` as a RESULT (D-06), a project with no store answers `ready` with an
 * unbound reader (D-16), and a refused door answers through the client's `unavailable` arm. Each
 * sends a reader somewhere different, so each keeps its own sentence.
 */
export function projectKnowledgeView(read: KnowledgeRead): KnowledgeView {
  if (read.kind === 'unavailable') {
    return { state: 'error', heading: READ_FAILED_HEADING, body: readFailedBody(read.error) }
  }

  const projection = read.projection
  if (projection.kind === 'evidence-incomplete') return { state: 'evidence-incomplete' }

  // Checked BEFORE the steps are read: a run with no reader bound may still have steps, and every
  // one of them served nothing. Describing that as "retrieval served no lines" would be true and
  // useless — the actionable fact is that there is no store to serve from.
  if (projection.knowledgeStore === 'unbound') {
    return { state: 'empty-no-store', heading: NO_STORE_HEADING, body: NO_STORE_BODY }
  }

  const steps = projection.steps.map(step =>
    stepRow(step, projection.curation.status, projection.learned.canaryAttributions),
  )
  const summary = steps.length === 0
    ? NO_BRIEF_SERVED_TEXT
    : usedSummaryLine({
        stepsBriefed: steps.filter(row => row.briefLines > 0).length,
        canaryLines: steps.reduce((total, row) => total + row.canaryLines, 0),
        replays: steps.filter(row => row.planSource === 'procedure-replay').length,
        hints: steps.filter(row => row.planSource === 'procedure-hint').length,
      })

  return {
    state: 'ready',
    used: { summary, steps },
    ...(projection.retrievalRung === undefined ? {} : { rung: rungView(projection.retrievalRung) }),
  }
}

/**
 * The recorded rung, minus its storage stamp.
 *
 * `schemaVersion` is dropped rather than carried: it states which contract the value was WRITTEN
 * under, which is a fact about the handoff and not about the run, and a view member nothing
 * paints is a member a component can accidentally paint.
 */
function rungView(recorded: RecordedRetrievalRung): RungView {
  return {
    rung: recorded.rung,
    ...(recorded.reason === undefined ? {} : { reason: recorded.reason }),
  }
}
