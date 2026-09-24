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

import {
  CURATION_BREAKDOWN_BUCKETS,
  ProposalIdSchema,
  TRACE_TRUNCATION_TOP_K,
  canonicalJson,
  formatEntityUri,
  parseShortId,
} from '@vostride/agent-qa-schema'
import type {
  BriefWhyNoTraceReason,
  CurationBreakdown,
  PostProcessingChipStatus,
  PromotionPath,
  RecordChange,
  RecordedRetrievalRung,
  RetrievalRung,
  RetrievalRungReason,
  RetrievalTraceLeg,
  RunKnowledgeCanaryAttribution,
  RunKnowledgePlanSource,
  RunKnowledgeProjection,
  RunKnowledgeStep,
  RunKnowledgeTrace,
  TraceLine,
} from '@vostride/agent-qa-schema'

import { entityRefRoute } from '@/chat/entity-card'
import {
  BREAKDOWN_NOT_RECORDED_TEXT,
  BREAKDOWN_WITHHELD_TEXT,
  COUNTS_NOT_RECORDED_TEXT,
  curationBreakdownLine,
  legacyCurationPairText,
} from './post-processing-view'

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
export const NO_BRIEF_SERVED_TEXT = 'This run used no stored knowledge: no step asked for a brief.'

// ─────────────────────────────────────────────────────────────────────────────
// Used half
// ─────────────────────────────────────────────────────────────────────────────

/** The Knowledge used section's heading — one `<h4>`, 16px/500 (UI-SPEC Typography). */
export const USED_HEADING = 'Knowledge used'

/** The summary line when every derived segment is zero. See {@link NO_BRIEF_SERVED_TEXT}. */
export const NO_BRIEF_LINES_TEXT = 'This run used no stored knowledge: retrieval ran and found nothing that applied.'

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
// The four-section tab and its grouped used rows (427 · D-02, D-04, D-05, D-07, D-19)
// ─────────────────────────────────────────────────────────────────────────────

export type KnowledgeSection = 'used' | 'effect' | 'changes' | 'retrieval-details'

// prettier-ignore
export const KNOWLEDGE_SECTIONS = [
  'used',
  'effect',
  'changes',
  'retrieval-details',
] as const satisfies readonly KnowledgeSection[]

export type UseVerb = 'given' | 'opened' | 'caution' | 'replayed' | 'hint'

// prettier-ignore
export const USE_VERBS = [
  'given',
  'opened',
  'caution',
  'replayed',
  'hint',
] as const satisfies readonly UseVerb[]

export const USE_VERB_PHRASES = {
  given: { lead: 'Given in', follow: 'given in' },
  opened: { lead: 'Opened by the agent in', follow: 'opened in' },
  caution: { lead: 'Given as a caution in', follow: 'given as a caution in' },
  replayed: { lead: 'Replayed in', follow: 'replayed in' },
  hint: { lead: 'Used as a hint in', follow: 'used as a hint in' },
} satisfies Record<UseVerb, { readonly lead: string; readonly follow: string }>

export const EFFECT_HEADING = 'Effect on this run'

export const RETRIEVAL_DETAILS_LABEL = 'Retrieval details'

export const EFFECT_NOTHING_MEASURED_TEXT = 'Nothing was measured on this run. Only knowledge on trial and procedure replays are measured.'

export const EFFECT_NOTHING_USED_TEXT = 'Nothing to measure: this run used no stored knowledge.'

export function usedCountLine(count: number): string {
  return count === 1 ? '1 record' : `${String(count)} records`
}

export interface StepAddress {
  readonly testIndex: number
  readonly stepIndex: number
}

export type StepRefSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'step'; readonly address: StepAddress; readonly label: string }

function compareAddresses(a: StepAddress, b: StepAddress): number {
  return a.testIndex - b.testIndex || a.stepIndex - b.stepIndex
}

function stepSegment(address: StepAddress): StepRefSegment {
  return { kind: 'step', address, label: String(address.stepIndex + 1) }
}

// Every number is its own segment so a later plan can make it a control without re-parsing text.
// Only a contiguous run of three or more compresses to a range; two neighbours read "1 and 2".
export function formatStepRefs(addresses: readonly StepAddress[]): readonly StepRefSegment[] {
  const sorted = [...addresses]
    .sort(compareAddresses)
    .filter((address, index, all) => index === 0 || compareAddresses(all[index - 1]!, address) !== 0)
  if (sorted.length === 0) return []

  const runs: StepAddress[][] = []
  for (const address of sorted) {
    const run = runs.at(-1)
    const last = run?.at(-1)
    const continues =
      last !== undefined &&
      last.testIndex === address.testIndex &&
      address.stepIndex === last.stepIndex + 1
    if (run !== undefined && continues) {
      run.push(address)
    } else {
      runs.push([address])
    }
  }
  const items = runs.flatMap(run => (run.length >= 3 ? [run] : run.map(address => [address])))

  const segments: StepRefSegment[] = [{ kind: 'text', text: sorted.length === 1 ? 'step ' : 'steps ' }]
  items.forEach((item, index) => {
    if (index > 0) segments.push({ kind: 'text', text: index === items.length - 1 ? ' and ' : ', ' })
    segments.push(stepSegment(item[0]!))
    if (item.length > 1) {
      segments.push({ kind: 'text', text: '–' })
      segments.push(stepSegment(item.at(-1)!))
    }
  })
  return segments
}

export interface UseView {
  readonly verb: UseVerb
  readonly addresses: readonly StepAddress[]
}

// `key` is the record's first-use position, never its id: no id leaves the grouping map.
export interface UsedRecordView {
  readonly key: string
  readonly primary: string
  readonly uses: readonly UseView[]
}

// Steps are sorted explicitly rather than trusting wire order (RESEARCH A3); a Map keeps first-use order.
export function usedRecordViews(
  projection: Extract<RunKnowledgeProjection, { kind: 'ready' }>,
): readonly UsedRecordView[] {
  const steps = [...projection.steps].sort(compareAddresses)
  const byId = new Map<string, { primary: string; addresses: StepAddress[] }>()
  for (const step of steps) {
    const address: StepAddress = { testIndex: step.testIndex, stepIndex: step.stepIndex }
    for (const line of step.served.channel1) {
      const entry = byId.get(line.id)
      if (entry === undefined) {
        byId.set(line.id, { primary: line.summary, addresses: [address] })
      } else if (compareAddresses(entry.addresses.at(-1)!, address) !== 0) {
        entry.addresses.push(address)
      }
    }
  }
  return [...byId.values()].map((entry, index) => ({
    key: String(index),
    primary: entry.primary,
    uses: [{ verb: 'given', addresses: entry.addresses }],
  }))
}

export interface UsedSectionView {
  readonly records: readonly UsedRecordView[]
  readonly countLine?: string
  readonly absence?: string
}

export interface EffectSectionView {
  readonly absence: string
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

/**
 * What a canary line says when the store was consulted and answered no (D-08 · 407-22).
 *
 * ONE WORLD ONLY, AND IT IS A MEASUREMENT: the curation chain SETTLED, the store walk COMPLETED,
 * and no surviving outcome carried this line's observation id. It no longer covers a failed chain
 * — a chain that fell over is a fact about the chain, reported by the chip, and it cannot
 * un-commit an outcome the store already served (owner ruling 2026-08-30, UAT item 11). Nor does
 * it cover a partial read; {@link ATTRIBUTION_UNKNOWN_TEXT} is the word for the absence of an
 * answer.
 */
export const NOT_ATTRIBUTED_TEXT = 'not attributed'

/**
 * What a canary line says when the read that would have answered it was PARTIAL (407-18 · WR-02).
 *
 * THE SIBLING ABOVE IS A POSITIVE CLAIM. `not attributed` says the store was consulted and no
 * outcome survived for this line — a fact somebody measured. This one says the opposite kind of
 * thing: nobody could finish looking. 407-14's op ships `canaryAttributions: []` whenever the
 * attribution scan folded a `KnowledgeMaintenanceScanError`, so without this word every served
 * canary on a partial read asserted a `no` the store never gave — while the same projection was
 * telling the Learned half that nobody could look. One wire member, one story on both halves.
 *
 * A SECOND WORLD REACHES IT SINCE 407-22: a FAILED chain over an unreadable part of the store,
 * with no row served. A failed chain is exactly as unable to answer "was anything attributed?" as
 * a settled one when nobody could finish the walk — so it is the FLAG that decides the word here,
 * never the chip. The chain's failure is evidence about the chain; how much of the store could be
 * read is a separate fact, and it is the one this word reports.
 */
export const ATTRIBUTION_UNKNOWN_TEXT = 'attribution unknown'

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

/** The Memory changes section's heading — one `<h4>`, 16px/500 (427 D-02, was the Learned half). */
export const MEMORY_CHANGES_HEADING = 'Memory changes'

// ─────────────────────────────────────────────────────────────────────────────
// The Learned half's copy (407-09 · LERN-02, D-09 / D-10 / D-11 / D-12)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the half says while curation has not settled (D-12).
 *
 * A SENTENCE, NOT A SKELETON. A skeleton claims bytes are on their way and will arrive shortly;
 * curation is a chain a daemon may not have picked up yet, and 404's own posture text exists
 * because "pending" can mean hours. The sentence names the CONDITION the deltas depend on, which
 * is the only thing a reader can act on — and it is the same sentence for `pending` and `running`
 * because the reader is waiting on one fact either way.
 */
export const DELTAS_PENDING_TEXT = 'Deltas land when curation settles.'

/**
 * What the half says when curation failed (D-12).
 *
 * IT STATES THE CONSEQUENCE, not just the failure. An empty record list under a `failed` chip
 * reads as "curation ran and changed nothing" to anyone not staring at the chip — the exact
 * collapse between a failure and a settled no-op that D-12 was written against.
 */
export const CURATION_FAILED_TEXT = 'Curation failed — nothing was learned from this run.'

/**
 * The note that rides BESIDE records a failed chain had already committed (407-26 · G-407-12).
 *
 * A NOTE, NEVER A REPLACEMENT. It is published in {@link LearnedView.chainNote} rather than in
 * `sentence`, whose own contract is "absent exactly when rows is non-empty": a sentence printed
 * over painted rows is a second, quieter account of the same records, which is the thing CR-04
 * forbids. This one rides UNDER them, exactly as {@link STORE_READ_INCOMPLETE_TEXT} rides under
 * an answer whose read was partial.
 *
 * ITS SIBLING ABOVE COULD NOT SIMPLY BE REUSED. `Curation failed — nothing was learned from this
 * run.` is a positive, falsifiable claim; printed over records the same `RunKnowledgeProjection`
 * carries, it is a claim that projection disproves (REVIEW CR-01). Relocating it beside the rows
 * would relocate the falsehood, not retire it. So the stronger sentence is kept for the one arm
 * where nothing falsifies it — `rows.length === 0` — and this weaker pair of facts, both true at
 * once, is what a reader gets when there is something to list.
 *
 * ITS WORDING IS NOT SETTLED. The string is the round-3 review's own proposed wording, verbatim,
 * so the owner rules on a sentence already in front of them — but it JOINS UAT item 10's open
 * copy decision rather than arriving approved, and the UI-SPEC row it belongs beside is still to
 * be written (407-27).
 */
export const CURATION_FAILED_PARTIAL_TEXT =
  'Curation failed — these records were committed before it stopped.'

/**
 * The heading's sentence when a settled row committed no counts (D-12).
 *
 * The chip's {@link COUNTS_NOT_RECORDED_TEXT} says the same fact as a fragment beside a badge;
 * this is the sentence form, in the half that has room for one. Both are published, neither is
 * derived from the other by casing, and the cells pin both — a sentence built by upper-casing a
 * fragment is a sentence that breaks the day the fragment gains a leading noun.
 */
export const COUNTS_NOT_RECORDED_SENTENCE = 'Counts not recorded for this run.'

/**
 * What the half says when the counts moved but no change record reached this run (D-10).
 *
 * `yet` is load-bearing. The run link is stamped on the change record by the reader's own
 * `diffSince`, and a change whose attribution is not derivable carries no run id at all rather
 * than a guessed one. So "no rows" here is an absence of ATTRIBUTION, not an absence of change —
 * and the counts beside it, which did move, stay on screen to say so.
 */
export const CHANGES_NOT_AVAILABLE_TEXT = 'Change records for this run are not available yet.'

/**
 * What the half says when the knowledge store could not be READ at all (407-14 · 407-15).
 *
 * A DIFFERENT ABSENCE FROM ITS SIBLING ABOVE, and the distinction is the whole reason it exists.
 * {@link CHANGES_NOT_AVAILABLE_TEXT} names an absence of ATTRIBUTION — the store answered and no
 * change carried this run's id. This one names an absence of a READABLE STORE: 407-14's op folded
 * a `KnowledgeMaintenanceScanError` and published `learned.scanIncomplete` rather than letting the
 * failure masquerade as an empty list. Telling that reader to wait — `yet` — would send them back
 * to a page that will never fill on its own, so this sentence sends them to the one door that
 * grades the same fold instead.
 */
export const CHANGES_UNREADABLE_TEXT = 'Change records could not be read from the knowledge store. Run `agent-qa doctor`.'

/**
 * The note that rides BESIDE an answer whose read was only partly successful (407-18 · CR-01).
 *
 * A DIFFERENT CLAIM FROM ITS SIBLING ABOVE, and the difference is the whole point.
 * {@link CHANGES_UNREADABLE_TEXT} stands ALONE: there was nothing to list and nobody could look,
 * so the sentence IS the answer. This one never stands alone — it rides under rows the store did
 * serve, or under an unsettled-chain sentence, and says the answer on screen is real while the
 * read behind it was partial. 407-14's op folds its two Learned enrichments INDEPENDENTLY, so
 * `{ scanIncomplete: true, changes: [<a row>] }` is a sanctioned shape; the flag DECORATES the
 * answer and never replaces it. Same door as every other degradation in this tab, because it is
 * the same fold `doctor` grades.
 */
export const STORE_READ_INCOMPLETE_TEXT = 'The knowledge store could not be fully read. Run `agent-qa doctor`.'

/** What the half says when curation settled having moved neither count (D-12). */
export const CHANGED_NOTHING_TEXT = 'Curation ran and changed nothing.'

/**
 * The reconciliation's LAST cause, when the read justifies none of the others (425-06 · D-19).
 *
 * NEVER SILENT, NEVER A GUESS. A snapshot that counted more changes than the half can show is a
 * disagreement between two producers, and the one thing this module must not do is pick whichever
 * number looks tidier. Its two siblings — {@link CURATION_FAILED_PARTIAL_TEXT} and
 * {@link CHANGES_UNREADABLE_TEXT} — are causes the read PROVED; this one is what honest ignorance
 * sounds like, and it is a sentence rather than an absence precisely because a reader who can see
 * the gap deserves to be told nobody could account for it.
 */
export const RECONCILIATION_UNATTRIBUTED_TEXT =
  "The difference could not be attributed to this run's rows."

/**
 * `{counted} changes counted · {shown} shown` — the gap itself, before its cause (D-19).
 *
 * THE NOUN AGREES WITH THE COUNT and the second number is bare, the same idiom the breakdown line
 * uses: `1 change counted · 0 shown` reads as a sentence, and `1 changes` reads as a bug.
 */
export function reconciliationCountText(counted: number, shown: number): string {
  return `${String(counted)} ${counted === 1 ? 'change' : 'changes'} counted · ${String(shown)} shown`
}

/** The one CTA in the whole tab (D-11) — where proposals are reviewed, never a proposal itself. */
export const REVIEW_PROPOSALS_CTA = 'Review proposals'

/**
 * The runnable review command for every pending proposal (423 D-19 · SC5).
 *
 * `agent-qa proposals list` is the terminal door over the registry's `proposals.list` op. There is
 * no dashboard inbox and this module mints no route, so the CTA hands a reader the command itself.
 */
export const PENDING_PROPOSALS_REVIEW_COMMAND = 'agent-qa proposals list --status pending'

/**
 * The runnable review command for one drafted proposal, over the `proposals.show` op.
 *
 * ONLY A CANONICAL ID IS INTERPOLATED. The mark receipt's `proposalId` is a plain string on the
 * wire; a value that is not a `prop_` id (a masked marker, or anything with shell metacharacters)
 * never reaches a copied command, and the reader is pointed at the pending list instead.
 */
export function proposalReviewCommand(proposalId: string): string {
  return ProposalIdSchema.safeParse(proposalId).success
    ? `agent-qa proposals show ${proposalId}`
    : PENDING_PROPOSALS_REVIEW_COMMAND
}

/** The accessible purpose of a mark's review control; the command itself follows it. */
export const COPY_REVIEW_COMMAND_LABEL = 'Copy review command'

/** Announced when the review command reached the clipboard. */
export const REVIEW_COMMAND_COPIED_TEXT = 'Review command copied to the clipboard'

/** Announced when it did not, with the command spelled out so it can still be run. */
export function reviewCommandCopyFailedText(command: string): string {
  return `Could not copy the review command. Run: ${command}`
}

/**
 * The pending-proposals line (D-11).
 *
 * THE VERB AGREES WITH THE COUNT, not just the noun. `1 proposals awaiting` and `1 proposal
 * awaiting` are both wrong; the singular is its own sentence, which is why this is a function and
 * not a template with an `s`.
 */
export function pendingProposalsLine(count: number): string {
  return count === 1
    ? '1 proposal awaits your decision'
    : `${String(count)} proposals awaiting your decision`
}

/**
 * The change kinds the Learned half paints — FIVE of the record's six (D-10, widened by 407-15).
 *
 * `added` IS WHAT THE RUN TAUGHT THE STORE. 407-04 stamps `sourceRunId` onto the synthetic `added`
 * change from the bundle's own `provenance.runId` precisely so a run-linked record's birth is
 * attributable to the run that produced it: a fact that exists because this run ran is this run's
 * teaching, not the store's bookkeeping. Under the earlier four-kind table the commonest curation
 * outcome — one new fact, nothing deprecated — was served by the op, correctly attributed, then
 * dropped here, and the half printed `Change records for this run are not available yet.` beside
 * a count line saying one fact had been curated (REVIEW CR-04, VERIFICATION gap 2).
 *
 * `purged` stays out: a deletion is a maintenance action taken ON the store, never something a run
 * taught it. `promoted` is in — it is the promotions kind D-10 names.
 *
 * THE WIDENING BENDS A LOCKED DECISION and says so. D-10 enumerates four kinds; this table carries
 * five as reconciliation R-407-15-01, pending the user's ruling alongside UAT items 6–8. If the
 * ruling goes the other way the revert is this entry, one `KIND_LOOK` arm and one sentence arm —
 * the widening was made only at the view, never in the schema, the op or the store.
 *
 * A closed `as const` table rather than a predicate, so the component's badge switch and the cells
 * both spell the vocabulary once and a sixth kind is a compile error rather than a silent drop.
 */
export const LEARNED_CHANGE_KINDS = ['added', 'confirmed', 'superseded', 'deprecated', 'promoted'] as const

export type LearnedChangeKind = (typeof LEARNED_CHANGE_KINDS)[number]

const PROMOTION_PATH_LABELS = {
  'deterministic-verdict-floor': 'deterministic-verdict-floor',
  'gate1-lower-trust': 'gate1-lower-trust',
  'gate1+gate2': 'gate1+gate2',
  'user-sovereign': 'user-sovereign',
} satisfies Record<PromotionPath, string>

export function promotionPathLabel(path: PromotionPath): string {
  return PROMOTION_PATH_LABELS[path]
}

const LEARNED_CHANGE_KIND_SET: ReadonlySet<string> = new Set(LEARNED_CHANGE_KINDS)

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

/**
 * The word a canary line wears — one of SEVEN, and never blank (D-08, widened by REVIEW WR-02).
 *
 * `unknown` is the seventh and it is not a shade of `not-attributed`: one says the fold answered
 * and found nothing, the other says the read behind the answer was partial (407-18).
 */
export type CanaryOutcomeWord =
  | 'confirmed'
  | 'contradicted'
  | 'helpful'
  | 'harmful'
  | 'pending'
  | 'not-attributed'
  | 'unknown'

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
 * What a canary line says, from the curation word, the attribution and the READ — never blank.
 *
 * ORDER MATTERS, AND THERE ARE THREE ARMS (D-08 · REVIEW WR-02 · 407-22, owner ruling 2026-08-30).
 * The chain's own word is consulted on exactly ONE line of this function — the first — and nowhere
 * else. Three movements, in this order:
 *
 *   1. AN UNSETTLED CHAIN IS READ FIRST. `pending` and `running` mean nobody has decided yet, and
 *      that outranks both a stale row from an earlier fold and a partial read: presenting a
 *      previous fold's attribution as this run's answer while the current one is still working
 *      would be the page answering a question that is still open.
 *
 *   2. THEN A ROW THAT WAS READ WINS — ON EITHER SETTLED ARM, WITH NO STATUS CONJUNCT. An
 *      attribution the store served is a real answer whatever else the scan could not reach, and a
 *      chain that fell over cannot un-commit an outcome event it already appended. The chip beside
 *      this line is where the chain's fate is reported; repeating it here as `not attributed`
 *      would be a SECOND and different claim — that the store was consulted and said no — made
 *      while this very projection holds the row that disproves it. Same `rows win` law the Learned
 *      half follows — a claim this sentence made from 407-22 until 407-26, when
 *      {@link learnedView}'s own `failed` arm was finally moved below its rows fold and the two
 *      halves stopped disagreeing (REVIEW CR-01 · G-407-12).
 *
 *   3. THEN, WITH NO ROW, THE READ DECIDES. `unknown` when the flag is set, because nobody could
 *      finish looking; `not attributed` when it is clear, because the walk completed and no
 *      surviving outcome carried this line's observation id — a fact somebody measured.
 *
 * THE FOURTH ARM WAS DELETED, NOT REORDERED. From 407-06 (`a795316e`) to 407-21 a standalone arm
 * answered `not attributed` for a FAILED chain, and 407-18's must_haves restated it. Once the row
 * is consulted first, the only case that arm still governed is the NO-row case — and that case is
 * properly decided by the READ, which is the fact that actually determines whether anybody was
 * able to answer, where the chain's failure is evidence about the chain. The owner ruled the arm
 * out on 2026-08-30 (UAT item 11 / G-407-11 / REVIEW CR-01); this function's own law, two
 * paragraphs above, had said as much since 407-06 while the code below it said otherwise.
 *
 * `scanIncomplete` DEFAULTS TO FALSE so every existing caller keeps the word it had.
 */
export function canaryOutcomeWord(
  curationStatus: PostProcessingChipStatus,
  attribution: RunKnowledgeCanaryAttribution | undefined,
  scanIncomplete = false,
): CanaryOutcomeWord {
  if (curationStatus === 'pending' || curationStatus === 'running') return 'pending'
  if (attribution !== undefined) return attribution.outcome
  return scanIncomplete ? 'unknown' : 'not-attributed'
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
 * The five words the Learned half's root can carry (D-12).
 *
 * FOUR OF THEM MIRROR THE CURATION CHIP and the fifth is the one the chip cannot say. A reader
 * looking at the header and the panel at once must not see two different accounts of the same
 * chain; `counts-absent` is the extra state because "settled, and nobody wrote the numbers down"
 * is a fact about the frozen row rather than about the chain, and collapsing it into `done` would
 * make an unrecorded run indistinguishable from one that changed nothing.
 */
export type LearnedState = 'pending' | 'running' | 'done' | 'failed' | 'counts-absent'

/**
 * One record this run's curation changed (D-10).
 *
 * `ref` AND `href` ARE TWO DIFFERENT ABSENCES. `ref` is missing when the record id is not an
 * addressable entity short-ID at all — most record ids are content-derived bundle ids, and minting
 * an entity URI for one would be hand-formatting an address to a thing the scheme does not name.
 * `href` is missing when the reference IS canonical but this dashboard has no page for its kind
 * (`ENTITY_KIND_ROUTES.MEM` is `null` under the DASH-03 contract). The row is addressable by
 * `recordId` in both cases; neither absence is ever a guess.
 */
export interface LearnedRowView {
  /**
   * The row's identity across a re-render — TOTAL BY CONSTRUCTION (407-26 · REVIEW WR-04).
   *
   * ONE RECORD CAN CARRY SEVERAL CHANGES IN ONE RUN. `diffSince` emits one `RecordChange` per
   * surviving outcome event, so a bundle confirmed at ordinal 12 and superseded at 13 crosses the
   * op's run filter twice and lands here as two near-identical rows. `recordId` alone is not
   * unique, and React would warn and reconcile one of the two away on the re-render that fires as
   * curation settles — which is exactly when the second row appears.
   *
   * NO PROJECTION OF `RecordChange`'S OWN MEMBERS CAN REPRODUCE THE PRODUCER'S IDENTITY, and every
   * form of this key before 407-26 claimed to (round-2 WR-05, re-raised as REVIEW WR-04 and open
   * across three rounds). `survivingOutcomeEvents` dedupes on
   * `eventDedupKey = \`${evidenceToken}:${curationJobId}\``, and `curationJobId` reaches this DTO
   * nowhere: `RecordChangeSchema` is `.strict()` and does not carry it. `deriveEvidenceToken`
   * hashes `(attributingObservationId, anchor, buildOrdinal)` and deliberately EXCLUDES the
   * candidate id, while `confirmedEvent` stamps `curationJobId: job.candidateId` — so one evidence
   * token with two job ids is reachable by construction, both events survive the dedupe, and the
   * two changes that arrive here are identical in all five members the old key spelled. A key
   * built from those members is therefore not the producer's identity; it is a guess that happens
   * to hold until that shape appears.
   *
   * SO THE INDEX IS THE TIE-BREAK, AND IT IS SOUND HERE SPECIFICALLY. The list is re-derived from
   * the projection on every render by {@link learnedView}'s fold and handed to a plain `.map` in
   * `knowledge-learned.tsx` — never spliced, never sorted in place, never memoised across a
   * projection change. Within a render pass the index IS the row, and across one it is a total
   * order over rows that were all rebuilt together. The record members are retained after it
   * purely so a key read in DevTools still names the record it belongs to.
   */
  readonly key: string
  readonly kind: LearnedChangeKind
  /** Receipt attribution copied from the producer, never inferred from the badge. */
  readonly promotionPath?: PromotionPath
  readonly promotionReceiptDigest?: string
  /** The record's own id, VERBATIM — the row addresses a record, not a title. */
  readonly recordId: string
  /** The canonical entity URI, built by the schema's own codec. Never hand-formatted here. */
  readonly ref?: string
  /** Where the reference goes in THIS build, when it goes anywhere. Never a minted route. */
  readonly href?: string
  /**
   * Which of the op's two sections this change is in (423 D-15). Present only beside a recorded
   * snapshot: without one there is nothing to section against, and the half says so instead.
   */
  readonly section?: LearnedRowSection
}

export type LearnedRowSection = 'curation' | 'since-then'

/** The fixed curation snapshot, as far as this half reads it (423 D-15). */
export interface LearnedSnapshotView {
  /** Copied verbatim from the checkpoint; never re-counted from rows. */
  readonly breakdown: CurationBreakdown
  /** `learned.sinceThen.count`, verbatim. Absent when the op served no since-then section. */
  readonly sinceThenCount?: number
  /**
   * The snapshot's total against the curation rows this half can show (425-06 · D-19).
   *
   * PRESENT EXACTLY WHEN THEY DISAGREE. A heading that quietly printed five counted changes over
   * two painted rows would leave the reader to spot the arithmetic themselves — and to guess at
   * the reason if they did. So the gap is stated in `count` and accounted for in `cause`, and when
   * the two numbers agree the member is absent rather than a line saying so: a reconciliation
   * nobody needs is noise on every healthy run in the project.
   */
  readonly reconciliation?: { readonly count: string; readonly cause: string }
}

/**
 * The Learned half, as the panel paints it (407-09).
 *
 * `rows` IS REQUIRED AND `sentence` IS NOT, which is the shape of the contract rather than a
 * convenience: every state has a list (empty for four of them) and exactly the states with nothing
 * to list carry a sentence. A half with neither would render blank, and a blank half beside a
 * populated Used half is the dishonesty D-12 exists to forbid — so `learnedView` below is total
 * and every arm sets one or the other.
 */
export interface LearnedView {
  readonly state: LearnedState
  /** The chip's own count line, from the chip's own function — one number, one wording (D-09). */
  readonly countLine?: string
  /**
   * What the count line above could NOT record, labelled (425-06 · D-18).
   *
   * A SECOND ELEMENT, NOT A SECOND CLAUSE. `2 curated · 0 deprecated` is a measurement; `Breakdown
   * not recorded for this run` is a fact about the measurement, and a reader scanning counts should
   * not have to parse the second out of the first. Present only beside a coarser or withheld
   * record; absent beside a recorded breakdown, which needs no apology.
   */
  readonly countNote?: string
  /** The state sentence. Absent exactly when {@link LearnedView.rows} is non-empty. */
  readonly sentence?: string
  readonly rows: readonly LearnedRowView[]
  /**
   * Present only when the op could not READ the knowledge store (407-14).
   *
   * True or absent, never `false` — the same idiom the wire flag it mirrors is typed with
   * (`z.literal(true).optional()`). The component stamps `data-learned-read="incomplete"` from it,
   * so a degraded half is addressable by a cell rather than inferred from its sentence.
   */
  readonly scanIncomplete?: true
  /**
   * {@link STORE_READ_INCOMPLETE_TEXT}, for the renderings where a PERSON must see the partiality.
   *
   * Present exactly when {@link LearnedView.scanIncomplete} is true AND the half is not already
   * printing {@link CHANGES_UNREADABLE_TEXT} — that sentence names the store itself, and a note
   * repeating the same door beneath it would be a nag rather than news. Absent otherwise, never
   * an empty string: `data-learned-read` is the cell-visible half of this fact, and the note is
   * the person-visible half (D-04, D-12).
   */
  readonly readNote?: string
  /**
   * {@link CURATION_FAILED_PARTIAL_TEXT}, when a SETTLED-AND-FAILED chain has rows to list.
   *
   * THE SIBLING OF {@link LearnedView.readNote}, AND DELIBERATELY NOT THAT SLOT. The chain's fate
   * and the store's readability are two independent producers — 407-14's op folds `curation` and
   * `learned` separately, and the conformance file's `attributed-failed` world carries
   * `{ status: 'failed', scanIncomplete: true }` at once — so one slot could only ever report one
   * of them, and whichever it reported would be silently speaking for the other. That is the
   * coupling round-2 WR-03 named; two notes is the fix, not one flag with two meanings.
   *
   * Present exactly when `state` is `failed` AND {@link LearnedView.rows} is non-empty; absent
   * everywhere else, including the no-rows `failed` arm, which keeps {@link CURATION_FAILED_TEXT}
   * in `sentence` unchanged. It never carries a fact about the store read (407-26 · G-407-12).
   */
  readonly chainNote?: string
  /**
   * Present exactly when the op served curation's fixed snapshot (423 D-15). Absent for a failed
   * or pre-423 chain, and the component states that absence rather than painting zero counts.
   */
  readonly curationSnapshot?: LearnedSnapshotView
}

/** The pending-proposals line: a COUNT and a door, never any proposal content (D-11). */
export interface ProposalsView {
  readonly count: number
  readonly line: string
  readonly ctaText: string
  /** A runnable CLI command (423 D-19), never a route: there is no dashboard proposals inbox. */
  readonly command: string
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
      readonly used: UsedSectionView
      readonly effect: EffectSectionView
      readonly ledger: LedgerView
      readonly rung?: RungView
      readonly learned: LearnedView
      readonly proposals?: ProposalsView
    }

/** The per-step ledger Retrieval details holds — the shipped summary line and step rows, moved (D-19). */
export interface LedgerView {
  readonly summary: string
  readonly steps: readonly StepRowView[]
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
  scanIncomplete: boolean,
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
    detail: stepDetail(step, curationStatus, attributions, scanIncomplete),
  }
}

/**
 * The expanded body of one step row — THE ONLY PLACE THE CANARY OUTCOME WORD IS DECIDED.
 *
 * The join is on all three of `testIndex`, `stepIndex` and `recordId`. `stepIndex` is numbered per
 * member test, so a run with two tests has two step 0s; joining on the pair alone would attribute
 * one member's canary outcome to another member's line, which is the exact wrong-attribution
 * failure D-10 was written against one layer down.
 *
 * `scanIncomplete` IS A FACT ABOUT THE STORE READ, AND IT REACHES BOTH HALVES FROM ONE WIRE MEMBER
 * (REVIEW WR-02). `learned.scanIncomplete` is where the op records that it could not finish
 * looking, and the empty `canaryAttributions` list beside it is a CONSEQUENCE of that, not an
 * answer. Threading the flag down here is what stops this half asserting a `no` the other half is
 * simultaneously saying nobody was able to give.
 */
function stepDetail(
  step: RunKnowledgeStep,
  curationStatus: PostProcessingChipStatus,
  attributions: readonly RunKnowledgeCanaryAttribution[],
  scanIncomplete: boolean,
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
            scanIncomplete,
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
 * The canonical entity URI for a changed record, or nothing (D-10).
 *
 * BUILT BY THE SCHEMA'S CODEC, NEVER BY CONCATENATION. `formatEntityUri` is the one place the
 * scheme, the kind segment and the short-ID canonicalisation live; a template literal here would
 * be a second spelling of an address format that three other surfaces already publish, and it
 * would go on producing well-formed-looking URIs after the codec moved.
 *
 * MOST RECORD IDS ARE NOT ENTITY ADDRESSES, and this is the honest answer to that. A change record
 * carries a record-grain id — content-derived, like `fact-page-https-example-com-0f9a` — while the
 * entity URI scheme names a MEM-ordinal short-ID minted by the entity ledger, which this
 * dashboard has no access to. So the reference is built only for an id that ALREADY is a MEM
 * short-ID, and every other row renders its id and no reference. Feeding a bundle id to the codec
 * would throw; guessing an ordinal for it would mint an address to a different record.
 */
function learnedRecordRef(recordId: string): string | undefined {
  return parseShortId(recordId)?.kind === 'MEM' ? formatEntityUri('MEM', recordId) : undefined
}

function learnedRow(row: RecordChange, index: number, section?: LearnedRowSection): LearnedRowView {
  const ref = learnedRecordRef(row.recordId)
  const href = ref === undefined ? undefined : entityRefRoute(ref)
  return {
    key: `${String(index)}:${row.recordId}:${row.change}:${String(row.atOrdinal)}`,
    kind: row.change as LearnedChangeKind,
    recordId: row.recordId,
    ...(row.promotionPath === undefined ? {} : { promotionPath: row.promotionPath }),
    ...(row.promotionReceiptDigest === undefined ? {} : { promotionReceiptDigest: row.promotionReceiptDigest }),
    ...(ref === undefined ? {} : { ref }),
    ...(href === undefined ? {} : { href }),
    ...(section === undefined ? {} : { section }),
  }
}

/**
 * The Learned half, as one of five states — and every one of them says something (D-12).
 *
 * THE ORDER OF THE ARMS IS THE ORDER OF THE QUESTIONS. Is the chain still moving? Did it fail?
 * Could the store even be read? Did any of it reach this run? Did the frozen row record what it
 * did? Did it do anything? Each answer stops there, because each sends a reader somewhere
 * different, and a single collapsed "no rows" arm would send all of them to the same shrug.
 *
 * ROWS COME BEFORE SENTENCES, once curation has settled (407-15 · REVIEW CR-04). The earlier arm
 * order asked the COUNTS first and only reached the rows if the counts had moved, so a run whose
 * settled row recorded `0 / 0` — or recorded nothing at all — silently discarded change records
 * the op had already served and attributed. A half that denies a record it was handed is worse
 * than one that shows a disagreement between two producers: the disagreement is the news.
 *
 * THE COUNTS COME ONLY FROM THE SETTLED ROW (D-09). An unsettled chain has no counts to show — not
 * zeros, not a stale pair from a previous read — so `countLine` is absent for `pending`, `running`
 * and `failed`, and the chip beside it is silent for exactly the same reason. TWO of those arms —
 * `pending` and `running` — also list NOTHING even when the projection carries rows: a chain that
 * has not settled has not finished deciding what it changed, so listing its interim rows would
 * date-stamp a claim it has not made (D-12).
 *
 * A SETTLED-AND-FAILED CHAIN IS NOT ONE OF THEM, AND USED TO BE TREATED AS IF IT WERE (407-26 ·
 * REVIEW CR-01 · G-407-12, owner ruling 2026-08-31). `failed` HAS settled, so the justification
 * above never described it; the arm nonetheless returned `rows: []` eleven lines above the fold
 * and printed {@link CURATION_FAILED_TEXT} — `nothing was learned from this run` — over change
 * records the op had served and stamped with this run's own id. `learned.changes` comes from the
 * `diffSince` walk over the COMMITTED store; `curation.status` comes from a different sibling op;
 * a stage that committed records and then fell over later in the chain produces exactly that
 * shape. A chain that fell over cannot un-commit what it already wrote, so the records are
 * PAINTED and the failure is stated beside them in {@link LearnedView.chainNote}. This is the
 * third instance of one rule, now consistent across the tab: 407-18 moved the fold above the
 * scan-incomplete FLAG arm, 407-22 made a served attribution row beat `canaryOutcomeWord`'s
 * settled arms, and this moves it above the CHAIN-STATUS arm.
 *
 * WHICH IS WHY THE FOLD IS HOISTED RATHER THAN COPIED INTO THE ARM. An arm that returns before
 * the fold is an arm that can deny a record without ever having looked at it; the only way to
 * make that structurally impossible is to leave no code between the fold and the returns. Every
 * arm below therefore chooses only WHAT TO SAY about rows it can already see.
 *
 * THE STORE READ IS A FACT ABOUT THE READ, AND IT DECORATES EVERY ARM (407-18 · REVIEW CR-01 /
 * WR-05). `learned.scanIncomplete` used to be asked ABOVE the row fold and answered with
 * `rows: []` plus {@link CHANGES_UNREADABLE_TEXT} unconditionally — but 407-14's op folds its two
 * Learned enrichments INDEPENDENTLY, so `{ scanIncomplete: true, changes: [<this run's record>] }`
 * is a sanctioned, op-tested output. On it the half asserted the store could not be read while
 * holding the record that proves it could: the same denial 407-15's `rows win` law was written
 * against, committed by the commit that wrote the law. So the flag is now computed ONCE and spread
 * into every return, including the three unsettled arms it used to return past (WR-05), and the
 * SENTENCE form is reached only where there is genuinely nothing to list. A view handed rows
 * paints them, whatever else it was told; the degradation rides beside them as the flag and
 * {@link STORE_READ_INCOMPLETE_TEXT}.
 */
export function learnedView(
  projection: Extract<RunKnowledgeProjection, { kind: 'ready' }>,
): LearnedView {
  const { status, counts } = projection.curation

  // COMPUTED ONCE, SPREAD EVERYWHERE (WR-05). Absent rather than `false` on a clean read — the
  // same true-or-absent idiom the wire flag it mirrors is typed with.
  const degraded = projection.learned.scanIncomplete === true ? { scanIncomplete: true as const } : {}
  const readNote =
    projection.learned.scanIncomplete === true ? { readNote: STORE_READ_INCOMPLETE_TEXT } : {}

  // ALREADY FILTERED TO THIS RUN by `runs.knowledge` (407-04's run-link stamping and canary
  // observation join, never a since-ordinal window). This module narrows the KINDS and nothing
  // else — re-filtering by run here would be a second, weaker copy of that join.
  //
  // HOISTED ABOVE THE WHOLE STATUS LADDER (407-26 · REVIEW CR-01 · G-407-12). An arm that returns
  // before this fold is an arm that can deny a record without having looked at it, and no comment
  // prevents the next arm from being written above it — leaving no code between the fold and the
  // returns does.
  //
  // SECTIONED BY THE OP'S OWN LISTS (423 D-15). `sinceThen.changes` is a filter over the same
  // `changes` array, so membership is whole-row equality; this module never re-derives the
  // snapshot identity rule the op applied.
  const { curationSnapshot, sinceThen } = projection.learned
  const sinceThenRows = new Set((sinceThen?.changes ?? []).map(row => canonicalJson(row)))
  const sectionOf = (row: RecordChange): LearnedRowSection | undefined =>
    curationSnapshot === undefined
      ? undefined
      : sinceThenRows.has(canonicalJson(row)) ? 'since-then' : 'curation'
  const rows = projection.learned.changes
    .filter(row => LEARNED_CHANGE_KIND_SET.has(row.change))
    .map((row, index) => learnedRow(row, index, sectionOf(row)))
  const snapshotView: LearnedSnapshotView | undefined = curationSnapshot === undefined
    ? undefined
    : {
        breakdown: curationSnapshot.breakdown,
        ...(sinceThen === undefined ? {} : { sinceThenCount: sinceThen.count }),
      }
  const snapshot = snapshotView === undefined ? {} : { curationSnapshot: snapshotView }

  // THE TWO NUMBERS THE HEADING PUTS SIDE BY SIDE (425-06 · D-19).
  //
  // `counted` IS THE SNAPSHOT'S, NEVER RE-DERIVED. The breakdown is curation's own fixed record
  // (423 D-15); re-counting it from rows would replace the producer's measurement with this
  // module's, and then there would be no disagreement left to report.
  //
  // `shown` IS THE CURATION SECTION ONLY. 423 D-15 gives since-then rows their own counted line,
  // so folding them in here would let a later promotion quietly close a gap it had nothing to do
  // with — the exact silence D-19 was written against.
  const counted = snapshotView === undefined
    ? 0
    : CURATION_BREAKDOWN_BUCKETS.reduce((total, bucket) => total + snapshotView.breakdown[bucket], 0)
  const shown = rows.filter(row => row.section === 'curation').length

  /**
   * The snapshot spread, with the gap stated when there is one and the member absent when there
   * is not. The CAUSE is passed in by the arm, because only the arm knows which fact the read
   * already proved — this function never picks one.
   */
  const reconciled = (cause: string) =>
    snapshotView === undefined || counted === shown
      ? snapshot
      : {
          curationSnapshot: {
            ...snapshotView,
            reconciliation: { count: reconciliationCountText(counted, shown), cause },
          },
        }

  if (status === 'pending' || status === 'running') {
    // `rows: []` here is now a STATEMENT, not a consequence of ordering: the rows are in scope and
    // this arm declines to list them, because an unsettled chain has not finished deciding (D-12).
    return { state: status, sentence: DELTAS_PENDING_TEXT, rows: [], ...degraded, ...readNote, ...snapshot }
  }

  if (status === 'failed') {
    // A SETTLED chain that fell over cannot un-commit what it already wrote. With records to list,
    // the failure is a note BESIDE them; with none, the arm is the object that shipped before.
    // THE CAUSE THE READ ALREADY PROVED (425-06 · D-19). A chain that stopped mid-commit is the
    // plainest account there is of a snapshot that counted more than the half can list, and it is
    // the same fact `chainNote` already states beneath the rows — so the reconciliation borrows it
    // rather than falling to the sentence for a gap nobody could explain.
    return rows.length > 0
      ? {
          state: 'failed',
          rows,
          chainNote: CURATION_FAILED_PARTIAL_TEXT,
          ...degraded,
          ...readNote,
          ...reconciled(CURATION_FAILED_PARTIAL_TEXT),
        }
      : { state: 'failed', sentence: CURATION_FAILED_TEXT, rows: [], ...degraded, ...readNote, ...snapshot }
  }

  const state: LearnedState = counts === undefined ? 'counts-absent' : 'done'

  // A SETTLED ARM'S CAUSE, IN THE ORDER THE READ JUSTIFIES THEM (425-06 · D-19). An incomplete
  // store scan is a proven reason rows are missing; with a clean read there is no proven reason at
  // all, and the half says exactly that rather than picking one.
  const settledCause = projection.learned.scanIncomplete === true
    ? CHANGES_UNREADABLE_TEXT
    : RECONCILIATION_UNATTRIBUTED_TEXT

  // THE HEADING AND THE CURATION CARD SPELL ONE NUMBER ONE WAY (425-06 · D-16/D-17). The line is
  // `curationBreakdownLine` over the SAME persisted snapshot the card reads (423 D-15), so the two
  // surfaces agree by construction rather than by two spellings that happen to match today.
  //
  // THE LADDER IS THE CARD'S LADDER, IN THE CARD'S ORDER (D-18, `curationCompleteText`). Snapshot
  // outranks the legacy pair; the pair is printed AS a pair and told, on its own line, that no
  // breakdown exists; a withheld snapshot names the category the read refused on; a settled row
  // with neither keeps its own fragment. FIVE BUCKETS ARE NEVER SYNTHESIZED FROM TWO — a pre-423
  // pair is a coarser measurement, not a breakdown with three buckets missing.
  const breakdown = curationSnapshot?.breakdown
  const withheld = projection.learned.curationSnapshotWithheld
  const countLine =
    breakdown !== undefined
      ? curationBreakdownLine(breakdown)
      : counts !== undefined
        ? legacyCurationPairText(counts.curated, counts.deprecated)
        : COUNTS_NOT_RECORDED_TEXT
  const countNote =
    breakdown !== undefined
      ? {}
      : counts !== undefined
        ? { countNote: BREAKDOWN_NOT_RECORDED_TEXT }
        : withheld !== undefined
          ? { countNote: BREAKDOWN_WITHHELD_TEXT[withheld.reason] }
          : {}

  // ROWS BEFORE SENTENCES, AND BEFORE THE FLAG (REVIEW CR-01). A record the store served is the
  // answer; the partial read is a note beside it.
  if (rows.length > 0) {
    return { state, countLine, ...countNote, rows, ...degraded, ...readNote, ...reconciled(settledCause) }
  }

  // NOTHING TO LIST AND NOBODY COULD LOOK — the one arm where the sentence IS the answer, so it
  // carries no note: a second door beneath a sentence that already names one is a nag (407-14).
  if (projection.learned.scanIncomplete === true) {
    return {
      state,
      countLine,
      ...countNote,
      sentence: CHANGES_UNREADABLE_TEXT,
      rows: [],
      scanIncomplete: true,
      ...reconciled(CHANGES_UNREADABLE_TEXT),
    }
  }

  // Below here the read was CLEAN — the flag would have been answered above — so no spread is
  // needed on the three-sentence ladder, and adding one would only suggest it could be reached.
  //
  // THE SENTENCE FOLLOWS THE SAME RECORD THE COUNT LINE DID (425-06). A snapshot-bearing run whose
  // buckets are all zero HAS a record saying curation changed nothing, whether or not the legacy
  // pair was also written — so it reads its own sentence rather than falling to the counts-absent
  // one, which describes a row that recorded no measurement at all.
  if (breakdown !== undefined) {
    return counted === 0
      ? { state, countLine, ...countNote, sentence: CHANGED_NOTHING_TEXT, rows: [], ...reconciled(settledCause) }
      : { state, countLine, ...countNote, sentence: CHANGES_NOT_AVAILABLE_TEXT, rows: [], ...reconciled(settledCause) }
  }

  if (counts === undefined) {
    return { state, countLine, ...countNote, sentence: COUNTS_NOT_RECORDED_SENTENCE, rows: [], ...snapshot }
  }

  return counts.curated === 0 && counts.deprecated === 0
    ? { state, countLine, ...countNote, sentence: CHANGED_NOTHING_TEXT, rows: [], ...snapshot }
    : { state, countLine, ...countNote, sentence: CHANGES_NOT_AVAILABLE_TEXT, rows: [], ...snapshot }
}

/**
 * The pending-proposals line, or nothing at all (D-11).
 *
 * TWO ABSENCES COLLAPSE HERE, AND THAT IS DELIBERATE. `undefined` means this host owns no
 * proposals inbox; `0` means the inbox answered and there is nothing waiting. Both render no line,
 * because a line reading "0 proposals awaiting your decision" is a nag about an empty queue — and
 * a reader who has nothing to decide does not need to be told which of the two reasons applies.
 *
 * THE PANEL CARRIES NO PROPOSAL CONTENT (T-407-22). A count and a door; the inbox owns the rest.
 */
function proposalsView(count: number | undefined): ProposalsView | undefined {
  if (count === undefined || count === 0) return undefined
  return {
    count,
    line: pendingProposalsLine(count),
    ctaText: REVIEW_PROPOSALS_CTA,
    // No dashboard inbox route exists and this module mints none; the run-detail CTA no longer
    // targets Chat (423 D-19 · SC5). It carries the terminal command over `proposals.list`.
    command: PENDING_PROPOSALS_REVIEW_COMMAND,
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
    stepRow(
      step,
      projection.curation.status,
      projection.learned.canaryAttributions,
      projection.learned.scanIncomplete === true,
    ),
  )
  const summary = steps.length === 0
    ? NO_BRIEF_SERVED_TEXT
    : usedSummaryLine({
        stepsBriefed: steps.filter(row => row.briefLines > 0).length,
        canaryLines: steps.reduce((total, row) => total + row.canaryLines, 0),
        replays: steps.filter(row => row.planSource === 'procedure-replay').length,
        hints: steps.filter(row => row.planSource === 'procedure-hint').length,
      })

  const records = usedRecordViews(projection)
  const used: UsedSectionView = records.length > 0
    ? { records, countLine: usedCountLine(records.length) }
    : { records, absence: steps.length === 0 ? NO_BRIEF_SERVED_TEXT : NO_BRIEF_LINES_TEXT }
  const effect: EffectSectionView = {
    absence: records.length === 0 ? EFFECT_NOTHING_USED_TEXT : EFFECT_NOTHING_MEASURED_TEXT,
  }

  const proposals = proposalsView(projection.pendingProposalCount)

  return {
    state: 'ready',
    used,
    effect,
    ledger: { summary, steps },
    ...(projection.retrievalRung === undefined ? {} : { rung: rungView(projection.retrievalRung) }),
    learned: learnedView(projection),
    ...(proposals === undefined ? {} : { proposals }),
  }
}

/**
 * The recorded rung, minus its storage stamp.
 *
 * `schemaVersion` is dropped rather than carried: it states which contract the value was WRITTEN
 * under, which is a fact about the handoff and not about the run, and a view member nothing
 * paints is a member a component can accidentally paint.
 *
 * Both arms are folded explicitly (423 D-22) and neither translates its reason: a v1
 * `index-unavailable` stays that word and renders as a historical cause-not-recorded, never as
 * one of the v2 causes a pre-423 run could not have named.
 */
function rungView(recorded: RecordedRetrievalRung): RungView {
  switch (recorded.schemaVersion) {
    case 1:
    case 2:
      return {
        rung: recorded.rung,
        ...(recorded.reason === undefined ? {} : { reason: recorded.reason }),
      }
    default: {
      const unreachable: never = recorded
      return unreachable
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The rung banner's copy of record (407-10 · TRST-01, D-13/D-14/D-15/D-16)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The three degraded rungs, as a person reads them — and `memidex` is deliberately not a key.
 *
 * TYPED WITHOUT THE TOP RUNG so the absence is structural rather than remembered. A table with a
 * `memidex` label in it is a table a future caller can print, and printing anything for the top
 * rung would put an amber strip across every healthy run's header. `Exclude` makes "there is no
 * label for memidex" a compile error at the call site instead of a judgement call.
 */
export const RUNG_LABELS: Record<Exclude<RetrievalRung, 'memidex'>, string> = {
  'bundle-scan': 'bundle scan',
  'static-floor': 'static-floor embeddings',
  'lexical-only': 'lexical-only retrieval',
}

/**
 * WHY the ladder degraded, as a person reads it — a TOTAL map, never a switch with a default.
 *
 * BYTE-IDENTICAL TO `cli/src/commands/doctor-knowledge-checks.ts`, ON PURPOSE AND BY NECESSITY.
 * The dashboard and the CLI share no UI module — `packages/cli` cannot import a React package's
 * lib — so the labels are spelled twice and 407-11 asserts the two tables equal. Three of
 * them (`model-not-downloaded`, `embedder-load-failed`, `profile-static-configured`) are NOT in
 * UI-SPEC's five: the recorded enum has eight arms because `cold-artifact`, `load-failure` and a
 * `static` PREFERRED profile are three distinct operator situations, and 407-08 chose the wording
 * for them first. This table follows that one rather than the spec where the two differ.
 *
 * A new `RetrievalRungReason` becomes a compile error here instead of a blank cause printed
 * after an em dash.
 *
 * 423 D-22: a banner states what a run RECORDED. The three index causes are what post-423 runs
 * record; `index-unavailable` is only ever read off a pre-423 run and says so ("cause not
 * recorded") rather than guessing which of the three it was. Current health is `agent-qa doctor`.
 */
export const RUNG_CAUSE_LABELS: Record<RetrievalRungReason, string> = {
  'native-runtime-unavailable': 'native ONNX runtime unavailable',
  'profile-unresolved': 'embedder profile unresolved (deferred)',
  'low-ram-deferral': 'embedding deferred on low memory',
  'model-not-downloaded': 'embedding model not downloaded',
  'embedder-load-failed': 'embedder failed to load',
  'index-unavailable': 'knowledge index unavailable (cause not recorded), scanning bundles',
  'floor-disabled': 'static floor disabled',
  'profile-static-configured': 'static profile configured',
  'index-not-built': 'knowledge index not built yet, scanning bundles',
  'index-locked': 'knowledge index locked by another process, scanning bundles',
  'index-corrupt': 'knowledge index corrupt, rebuild requested, scanning bundles',
}

/**
 * Where the banner sends a reader who wants to know more.
 *
 * ONE DOOR, AND IT IS THE ONE THAT GRADES THE SAME FOLD (D-18). The banner states a fact about a
 * run that already happened; `doctor` reads the host as it is now. Sending the reader there is
 * what makes the banner actionable without letting it pretend to be a live probe (D-13).
 */
export const DOCTOR_HINT_TEXT = 'Run `agent-qa doctor`.'

/**
 * The whole banner sentence, or `undefined` when there is no banner to render.
 *
 * TWO ABSENCES, ONE ANSWER. `memidex` is not a degradation and `undefined` is "nobody has said
 * yet" — a live header before the first evidence-carrying frame, or a run whose evidence predates
 * 407. Both render no element, because an amber strip saying "retrieval is fine" and one saying
 * "unknown" are each a claim this surface has no business making.
 *
 * THE CAUSE CLAUSE IS DROPPED, NOT BLANKED, when a degraded rung carries no reason. The fold that
 * mints these values never does that — `reason` is absent IFF the rung is `memidex` — but the
 * schema types it optional on every arm so the shape is reachable from a historical handoff, and
 * an em dash with nothing after it is worse than a shorter sentence.
 */
export function rungBannerText(rung: RungView | undefined): string | undefined {
  if (rung === undefined || rung.rung === 'memidex') return undefined
  const cause = rung.reason === undefined ? '' : ` — ${RUNG_CAUSE_LABELS[rung.reason]}`
  return `Retrieval degraded: ${RUNG_LABELS[rung.rung]}${cause}. ${DOCTOR_HINT_TEXT}`
}

/**
 * The rung the run-detail header should paint, read off the DURABLE projection (D-13).
 *
 * THE JOIN LIVES HERE AND NOT IN THE PAGE, because three of its four silences are judgements
 * about the read rather than about the header. A refused door and a pruned handoff have said
 * nothing about retrieval; a project with no knowledge store bound never asked retrieval anything
 * at all, so it was not served on a rung and a "degraded" strip would send an operator hunting a
 * broken index instead of a missing config key (D-16). The tab states that case in its own words;
 * the header stays silent.
 *
 * IT NEVER PROBES. The value is the one the evidence recorded at serve time, so a run served on
 * the static floor stays labelled that way after the host is fixed. Fixing the machine must not
 * rewrite what a past run's header says.
 */
export function bannerRung(read: KnowledgeRead | undefined): RecordedRetrievalRung | undefined {
  if (read === undefined || read.kind !== 'read') return undefined
  const projection = read.projection
  if (projection.kind !== 'ready' || projection.knowledgeStore === 'unbound') return undefined
  return projection.retrievalRung
}
