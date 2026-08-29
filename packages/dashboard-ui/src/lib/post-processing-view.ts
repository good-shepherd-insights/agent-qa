// THE CHIP PROJECTION — the whole distance between what the route said and what a person reads.
//
// Phase 404-07 · LIFE-03, D-17 / D-21 / D-22 / D-23.
//
// THIS FILE NEVER SEES AN ENVELOPE, AND THAT IS THE POINT. D-17 makes a pushed chip event a
// TRIGGER and never a rendering: a frame's arrival means the durable answer moved, and the answer
// itself is always a re-read of `runs.postprocessing`. The structural half of that law is here —
// the only input this module can take is a `PostProcessingRead`, i.e. the read route's own bytes.
// There is no overload, no second entry point, and no bus-envelope type is named anywhere in this
// file (a grep for one is an acceptance criterion), so "a chip can never show a state the store did
// not say" is a fact about the type signature rather than a discipline someone has to keep.
//
// IT IS PURE AND TOTAL. No I/O, no clock, no React. Every read maps to exactly one view, including
// the reads nobody wants: a refusal, a failed stage with no recorded reason, a terminal chain that
// committed no counts. A projection with a hole in it renders blank, and a blank chip beside a red
// verdict badge is the exact dishonesty the folded 399 todo was filed about.
//
// EVERY PUBLISHED SENTENCE IS AN EXPORTED CONSTANT (403-05 D-5). The cells assert against the
// constants, so copy moves in one place and the tests move with it; prose inlined in a component
// is prose that drifts from prose inlined in a test, and both of them stay green.

import type {
  PostProcessingChipStatus,
  PostProcessingDisposition,
} from '@vostride/agent-qa-schema'

import type { PostProcessingRead } from './api'

/** The two stages the chain runs. Named rather than indexed — the set is closed (404 D-01). */
export type PostProcessingStage = 'analysis' | 'curation'

/**
 * One chip, ready to paint.
 *
 * Every optional field is a fact the read either carried or did not. Nothing here is derived from
 * anything the page knows about itself: no process state, no elapsed time, no "it has been pending
 * a while so it is probably stuck".
 */
export interface PostProcessingChipView {
  /** The chip word, VERBATIM from the store. Never re-derived, never defaulted. */
  readonly status: PostProcessingChipStatus
  /** The `pending` parenthetical: who, if anyone, is going to drain this chain (D-22). */
  readonly posture?: string
  /** What a terminal stage committed — curation's `curated N, deprecated M` (D-21). */
  readonly facts?: string
  /** The producer's masked, bounded failure text, forwarded without a single slice (D-21, T-404-01). */
  readonly error?: string
  /** Whether the chain intends to try that stage again. */
  readonly willRetry?: boolean
  /** Why there is no `error` to show, qualified by the posture that explains it (D-21 as narrowed). */
  readonly reasonAbsent?: string
}

export type PostProcessingView =
  | { readonly kind: 'chips'; readonly analysis: PostProcessingChipView; readonly curation: PostProcessingChipView }
  | { readonly kind: 'unavailable'; readonly error: string; readonly reason?: string }

/**
 * What a `pending` chip says about who will move it (D-22).
 *
 * 388-04 D-3's split applied to the dashboard: the WORD is durable chip state and the parenthetical
 * is the run's own `runFinished.disposition`, read through the route. A `detached` chain's chips
 * would otherwise read `pending` forever with no hint that nothing in this process — or any process
 * currently running — is ever going to touch them.
 */
export const PENDING_POSTURE_TEXT: Record<PostProcessingDisposition, string> = {
  handedOff: 'daemon draining',
  drained: 'draining',
  detached: 'not queued for drain — the next CLI run or agent-qa daemon drains it',
}

/**
 * What a `failed` chip says when nobody recorded a reason (D-21 as narrowed in 404-03).
 *
 * THE DURABLE NOTIFICATION ROW CARRIES NO FAILURE TEXT, deliberately: it is stamped by whichever
 * process drains the chain, INCLUDING the daemon's pump, which folds with no run masking context at
 * all (388 D-06's no-masker posture), so a reason stored there could not be guaranteed masked at the
 * moment it was written — and this row is read by surfaces that render it directly. The masked,
 * bounded reason lives instead on the in-process `*Failed` chip envelope, which is durable in the
 * run's `events.jsonl` and reaches the page through the read route's `failures` fold.
 *
 * WHICH LEAVES A REAL GAP, and this constant is what fills it honestly. A chain drained by the
 * daemon (`handedOff`) or by some later process (`detached`) emits no chip envelopes at all, so a
 * failure there has no reason ANYWHERE. The three renderings available are the truth, a blank, and
 * `pending`. Blank is a lie by omission; `pending` is a lie outright. The posture is included
 * because "nobody wrote it down" is only actionable when you know who was holding the pen.
 */
export const FAILED_REASON_ABSENT_TEXT: Record<PostProcessingDisposition | 'unknown', string> = {
  handedOff: 'reason not recorded — drained by the daemon',
  detached: 'reason not recorded — drained by a later process',
  drained: 'reason not recorded',
  unknown: 'reason not recorded',
}

/** The chip area's heading when chip truth could not be read at all (D-23). */
export const CHIPS_UNAVAILABLE_TEXT = 'post-processing status unavailable'

type ReadBody = Extract<PostProcessingRead, { kind: 'read' }>

/**
 * THE COUNT LINE, IN THE WORDING OF RECORD (407-09 · LERN-02, D-09).
 *
 * ONE FUNCTION, TWO SURFACES. The chip renders this string beside the `curation` badge and the
 * Knowledge tab's Learned heading renders the SAME string; `lib/knowledge-view.ts` imports this
 * rather than re-spelling it. Two spellings of one number is how a header and a panel end up
 * disagreeing about a run in front of the person reading both at once.
 *
 * THE NOUN IS PLURALISED AND THE SECOND COUNT IS BARE. `curated 1 fact, deprecated 1` reads as a
 * sentence; `deprecated 1 fact` would read as a second, different measurement of the same nouns.
 *
 * BOTH ZERO IS ITS OWN PHRASE. `curated 0 facts, deprecated 0` is arithmetically true and says
 * nothing a reader can act on; `nothing curated` is the fact.
 */
export function curationFactsText(curated: number, deprecated: number): string {
  if (curated === 0 && deprecated === 0) return 'nothing curated'
  const noun = curated === 1 ? 'fact' : 'facts'
  return `curated ${String(curated)} ${noun}, deprecated ${String(deprecated)}`
}

/**
 * What a settled curation row says when it committed no counts (D-12).
 *
 * NEVER A ZERO. The notification row's counts are optional, and a stage that never got as far as
 * committing reports its status and nothing else. Rendering `0` there would claim somebody counted
 * and found none — which is what `nothing curated` above says, about a genuinely different row.
 */
export const COUNTS_NOT_RECORDED_TEXT = 'counts not recorded for this run'

/** The `curation` chip's hover title once the page wires it as a door (D-01). */
export const CURATION_CHIP_TITLE = 'Open the Knowledge tab (7)'

/**
 * The clickable chip's accessible name — the WORD plus where pressing it goes.
 *
 * The visible badge already reads `curation done`; a screen reader hearing only that would be told
 * a status and not that it is a control. The name carries both, in that order, so the status is
 * still the first thing heard.
 */
export function curationChipAccessibleName(status: PostProcessingChipStatus): string {
  return `curation ${status} — open Knowledge tab`
}

/**
 * Curation's committed counts, as one sentence — or nothing.
 *
 * BOTH COUNTS OR NEITHER. The notification contract says a stage that never got as far as
 * committing reports its status and no counts at all, because zeros would claim it curated nothing,
 * which is a different thing from never having tried. Half a pair is the same ambiguity one field
 * down, so a row carrying one count and not the other says nothing here rather than implying a zero.
 */
function curationFacts(read: ReadBody): string | undefined {
  const curation = read.status.notification?.stages.curation
  if (curation === undefined) return undefined
  const { curated, deprecated } = curation
  if (curated === undefined || deprecated === undefined) return undefined
  return curationFactsText(curated, deprecated)
}

function chipView(stage: PostProcessingStage, read: ReadBody): PostProcessingChipView {
  const status = read.status.chips[stage]

  if (status === 'pending') {
    const posture = read.disposition === undefined ? undefined : PENDING_POSTURE_TEXT[read.disposition]
    return { status, ...(posture === undefined ? {} : { posture }) }
  }

  if (status === 'failed') {
    const failure = read.failures?.[stage]
    const error = failure?.error
    if (error === undefined) {
      // No `*Failed` envelope in the record. See FAILED_REASON_ABSENT_TEXT — this is the honest
      // rendering of an absence, not a fallback for a value we failed to look up.
      return { status, reasonAbsent: FAILED_REASON_ABSENT_TEXT[read.disposition ?? 'unknown'] }
    }
    return {
      status,
      error,
      ...(failure?.willRetry === undefined ? {} : { willRetry: failure.willRetry }),
    }
  }

  if (status === 'done' && stage === 'curation') {
    const facts = curationFacts(read)
    if (facts !== undefined) return { status, facts }
    // A SETTLED ROW THAT COMMITTED NO COUNTS SAYS SO (D-12). There IS a terminal row here — the
    // chain reached its end and froze one — so the absence is a recorded absence, and the honest
    // rendering is that nobody wrote the numbers down. Blank would be indistinguishable from a chip
    // whose read has not landed; `0` would be a measurement nobody made.
    if (read.status.notification !== undefined) return { status, facts: COUNTS_NOT_RECORDED_TEXT }
    // No terminal row at all: the chip word came from `chips.curation` with nothing behind it. The
    // chain contract makes that unreachable, but the type permits it, and inventing a sentence about
    // a row that does not exist is the one thing this module never does.
    return { status }
  }

  // `running`, and `done` on a stage that commits no counts: one word, no parenthetical.
  return { status }
}

/**
 * The read, as two chips — or as the refusal that stopped there being any.
 *
 * A REFUSAL IS ITS OWN STATE (D-23). The 399.1 render contract says `refused` is distinct from
 * `failed`, and neither of them is "not started yet" either. Collapsing an unreadable store into
 * `pending` would tell a person their chain is queued when in fact this build cannot read the queue
 * — which is the one reading that makes them wait instead of acting.
 */
export function projectPostProcessingView(read: PostProcessingRead): PostProcessingView {
  if (read.kind === 'unavailable') {
    return {
      kind: 'unavailable',
      error: read.error,
      ...(read.reason === undefined ? {} : { reason: read.reason }),
    }
  }
  return {
    kind: 'chips',
    analysis: chipView('analysis', read),
    curation: chipView('curation', read),
  }
}
