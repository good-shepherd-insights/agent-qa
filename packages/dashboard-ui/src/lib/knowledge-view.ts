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
  RecordChange,
  RecordedRetrievalRung,
  RetrievalRung,
  RetrievalRungReason,
  RunKnowledgeCanaryAttribution,
  RunKnowledgeStep,
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

function stepRow(step: RunKnowledgeStep): StepRowView {
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

  const steps = projection.steps.map(stepRow)
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
