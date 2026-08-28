// THE FAILURE VIEW'S PROJECTION — what a member's block shows, derived from the op's bytes alone.
//
// Phase 406-01 · DETL-04, D-03 / D-05 / D-10.
//
// THIS FILE COMPOSES NO SENTENCE, AND THAT IS THE POINT. `analysis.get` is THE single producer of
// a run's verdict sentences (389 D-11): the renderer that writes them lives in
// `packages/agent/src/analysis/render-sentence.ts`, and every surface — the CLI print, chat, this
// page — reads its output rather than re-deriving it. A template here would be a second producer
// of one fact, which is the 405 D-01 anti-pattern restated. What this module does is JOIN: the
// op's `verdicts[]` to the op's `sentences[]`, keyed by the member handle, into the map the page
// hands each `MemberGroup`.
//
// IT IS PURE AND TOTAL. No I/O, no clock, no React. The only inputs are the op's own bytes and the
// analysis CHIP STATUS WORD — a pushed `watchPostProcessing` frame is a TRIGGER and never a paint
// input (D-03, 404 D-17 applied a second time). An absent analysis, an empty `verdicts[]` (a green
// run: `resolveRunVerdicts` filters `passed | skipped | cancelled`, so a run with nothing to
// explain answers an empty list) and a verdict whose sentence never arrived all project to the
// same honest answer: no entry, therefore no block.
//
// THE JOIN KEY IS `perTest`, WHICH IS `RunDetailMember.testIndex`. Never `testId` — that is a
// per-run explicit id the projection does not key members by — and never array position, which
// would pair the first verdict with the first sentence whatever member each is about.
//
// EVERY PUBLISHED SENTENCE IS AN EXPORTED CONSTANT (`post-processing-view.ts`'s law). The cells
// assert against the constants, so copy moves in one place and the tests move with it.

import type {
  AnalysisGetOutput,
  AnalysisResolvedVerdict,
  PostProcessingChipStatus,
} from '@vostride/agent-qa-schema'

/** The provenance chip when the model authored this verdict (D-10). */
export const LLM_VERDICT_LABEL = 'LLM verdict'

/** The provenance chip when nothing but the deterministic classifier spoke (D-10). */
export const DETERMINISTIC_FALLBACK_LABEL = 'deterministic fallback'

/**
 * The analysis chip's word, or nothing when the post-processing read has not answered yet.
 *
 * Accepted here — and, in this plan, used for nothing beyond the signature — because it is the
 * input 406-06's provisional and failed MARKERS are keyed off. They are keyed off the CHIP, never
 * off the sentence's text, so the shape that makes that possible is declared with the projection
 * rather than bolted on beside it later.
 */
export type AnalysisChipWord = PostProcessingChipStatus | undefined

/** One member's verdict, ready to paint. Every field is the op's, except `provenance`. */
export interface MemberVerdictView {
  /** The member handle this block belongs under — the op's `perTest`. */
  readonly testIndex: number
  /** The op's sentence, VERBATIM. Never sliced, never re-cased, never re-composed. */
  readonly sentence: string
  readonly producer: AnalysisResolvedVerdict['producer']
  readonly confidence: number
  /** This product's own words about the two fields above (D-10). */
  readonly provenance: string
}

/**
 * The provenance chip's reading (D-10).
 *
 * A CONFIDENCE ONLY WHERE THERE IS ONE TO READ. `analyze-run` authors a number a reader can weigh;
 * the deterministic floor mints `confidence: 0` for every `unknown` it fills in, and printing
 * "deterministic fallback · 0.00" would offer that constant as though it were a measurement.
 */
export function provenanceLabel(
  producer: AnalysisResolvedVerdict['producer'],
  confidence: number,
): string {
  return producer === 'analyze-run'
    ? `${LLM_VERDICT_LABEL} · ${confidence.toFixed(2)}`
    : DETERMINISTIC_FALLBACK_LABEL
}

/**
 * The op's answer, keyed by member handle (D-05).
 *
 * TOTAL over every input the page can hold: `undefined` while the first read is in flight or after
 * a rejected one, an empty `verdicts[]` on a green run, and a verdict the op listed with no
 * matching sentence. All three answer with no entry for that member, and a member with no entry
 * renders no block — which is the honest rendering of "there is nothing to explain here".
 */
export function projectAnalysisView(
  analysis: AnalysisGetOutput | undefined,
  chip: AnalysisChipWord,
): ReadonlyMap<number, MemberVerdictView> {
  void chip
  const view = new Map<number, MemberVerdictView>()
  if (analysis === undefined) return view

  const sentenceByPerTest = new Map(
    analysis.sentences.map((entry) => [entry.perTest, entry.sentence] as const),
  )
  for (const verdict of analysis.verdicts) {
    const sentence = sentenceByPerTest.get(verdict.perTest)
    if (sentence === undefined) continue
    view.set(verdict.perTest, {
      testIndex: verdict.perTest,
      sentence,
      producer: verdict.producer,
      confidence: verdict.confidence,
      provenance: provenanceLabel(verdict.producer, verdict.confidence),
    })
  }
  return view
}
