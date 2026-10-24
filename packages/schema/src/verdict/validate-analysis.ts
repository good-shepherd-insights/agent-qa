// The cross-document analysis validation boundary (Phase 389, plan 04 — D-05/D-07).
//
// An authored `RunAnalysisArtifact` is UNTRUSTED input: it crosses from model output into a
// durable artifact, and this function is the one gate on that crossing. It validates the
// artifact AGAINST the run's own handoff — a check zod cannot express, because a refinement
// sees one document and this boundary needs two. Hence a pure FUNCTION over both documents,
// not a schema: every cited step must exist in the test it is cited for, every grounding
// quote must be verbatim-present in the cited step's captured evidence (an invented
// observation cannot validate — the D-05 anti-hallucination pin), every class must belong to
// the closed §A9 union, confidence must sit inside [0,1] exactly (a reject, never a clamp),
// every link must parse through the one `agentqa://` codec, and a no-trust-change class must
// have honestly ruled memory misdirection out when candidate or low-trust memory was served
// on the failing path (spec §A9 / memory.md §7.2).
//
// Rejects are PER TEST — `perTest` is the join key — so one confused answer never fails its
// siblings, and each reason string names the test's specific failure because those strings
// feed the D-03 repair round-trip verbatim.
//
// Link RESOLUTION is deliberately not here: `parseEntityUri` is the pure codec half of the
// check; resolving a parsed address against the entity directory is a host concern that
// happens at read time (plan 05), never inside schema.

import { canonicalJson } from '../determinism/canonical-json'
import { parseEntityUri } from '../entity/uri'
import type { CompletedRunHandoff } from '../handoff/completed-run-handoff'
import type { PerTestOutcome } from '../handoff/per-test-outcome'
import type { StepEvidence } from '../handoff/step-evidence'
import type { RunAnalysisArtifact } from './analysis-artifact'
import { failingStepOf } from './fingerprint-input'
import {
  aggregateMisdirectionEvidence,
  deriveMemoryOnPath,
  deriveMemoryOnPathSites,
  misdirectionSourceDigest,
} from './misdirection-evidence'
import type {
  MemoryOnPathEntry,
  MemoryOnPathSite,
  MisdirectionRootPosture,
} from './misdirection-evidence'
import type { VerdictSentenceParts } from './sentence-parts'
import { isVerdictClass, VERDICT_CLASSES } from './verdict'
import type { Verdict } from './verdict'

/**
 * The verbatim-presence searched set for a step-cited grounding quote (RESEARCH A5).
 *
 * PINNED as the exact list — too narrow churns the D-03 repair loop on honest quotes, too
 * wide weakens the anti-hallucination check. A quote must be a contiguous substring of at
 * least one of these fields of the CITED step:
 *
 *   - `stepText` — the authored step instruction
 *   - `verifierVerdict.reasoning` — the verifier's own words
 *   - any `subActions[i].plan` — a planning turn's stated intent
 *   - any `subActions[i].result.error` — a captured failure message
 *   - the `canonicalJson` rendering of the step's `reportedValue`, `aiJudgment`,
 *     `assertOutcome` or `termination` block, when present
 *
 * The canonicalJson members exist because those blocks are structured evidence: quoting
 * `"passed":false` out of an assertValue outcome is quoting captured bytes, and the
 * canonical rendering is the one deterministic spelling of them. Retune from operational
 * evidence only — a field joins this list when real repair transcripts show honest quotes
 * drawn from it being rejected; never widen it to make a failing author pass.
 */
export const QUOTE_SEARCHED_STEP_FIELDS = [
  'stepText',
  'verifierVerdict.reasoning',
  'subActions[].plan',
  'subActions[].result.error',
  'canonicalJson(reportedValue)',
  'canonicalJson(aiJudgment)',
  'canonicalJson(assertOutcome)',
  'canonicalJson(termination)',
] as const

/**
 * The searched set for the zero-step (`source: 'test-outcome'`) quote variant: a test that
 * captured no steps has exactly its recorded outcome to quote — the same field the
 * deterministic template quotes — and nothing is fabricated beyond it.
 */
export const QUOTE_SEARCHED_TEST_OUTCOME_FIELDS = ['outcome'] as const

/** One per-test reject; `reason` feeds the D-03 repair message verbatim. */
export interface AnalysisValidationReject {
  readonly perTest: number
  readonly reason: string
}

export type AnalysisValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly rejects: readonly AnalysisValidationReject[] }

/**
 * The caller-declared posture this validation runs under (422 D-19/D-20). Both members are
 * FAIL-CLOSED by default: an unstated root posture is an ordinary `'eval-root'` (so the BYOM
 * exemption is never granted by silence), and an unstated producer is HISTORICAL (so bytes
 * written before 422 keep their boolean-only acceptance exactly as Phase 389 wrote it).
 */
export interface AnalysisValidationOptions {
  /**
   * D-19. `'no-eval-root'` — the run had no evaluation root, so nothing COULD be
   * cross-checked and `backing: 'declared-only'` is admitted. `'broken-eval-root'` — a root
   * existed but could not be used; the evidence is equally empty and the posture is unbacked,
   * so `declared-only` is refused. `'eval-root'` (default) — an ordinary gated run.
   */
  readonly rootPosture?: MisdirectionRootPosture
  /**
   * D-20. True when the artifact was authored by a CURRENT gated producer, which must ship a
   * complete per-record cross-check for every record the run put on the failing path. False
   * (default) preserves historical boolean-only wire acceptance.
   */
  readonly gatedProducerEvidence?: boolean
}

/**
 * The classes whose §A9 routing moves NO trust: app_bug/flake/environment/config_error all
 * mean "the memory was not the problem" — which is exactly the claim a misdirected author
 * would make to shield the record that misled it, so these are the classes the
 * `memoryMisdirectionRuledOut` obligation guards (memory.md §7.2).
 */
const NO_TRUST_CHANGE_CLASSES: ReadonlySet<string> = new Set([
  'app_bug',
  'flake',
  'environment',
  'config_error',
])

/**
 * The searched texts of one step, in {@link QUOTE_SEARCHED_STEP_FIELDS} order. Exported so
 * the author can restate the honest quote sources in a repair message and the tests can pin
 * the set member-for-member.
 */
export function searchedQuoteTexts(step: StepEvidence): string[] {
  const texts: string[] = [step.stepText, step.verifierVerdict.reasoning]
  for (const subAction of step.subActions) texts.push(subAction.plan)
  for (const subAction of step.subActions) {
    if (typeof subAction.result.error === 'string') texts.push(subAction.result.error)
  }
  if (step.reportedValue !== undefined) texts.push(canonicalJson(step.reportedValue))
  if (step.aiJudgment !== undefined) texts.push(canonicalJson(step.aiJudgment))
  if (step.assertOutcome !== undefined) texts.push(canonicalJson(step.assertOutcome))
  if (step.termination !== undefined) texts.push(canonicalJson(step.termination))
  return texts
}

/** The zero-step searched texts, in {@link QUOTE_SEARCHED_TEST_OUTCOME_FIELDS} order. */
export function searchedTestOutcomeTexts(test: PerTestOutcome): string[] {
  return [test.outcome]
}

/** Bound a quoted string for a reject reason — the reason names the quote, not reprints it. */
function quoteForReason(quote: string): string {
  return quote.length <= 80 ? quote : `${quote.slice(0, 80)}…`
}

/**
 * The steps a verdict's evidence touches: `citedSteps`, the grounding quote's own step, and —
 * the 422 D-17 widening — the run's ACTUAL failing step, whether or not the author cited it.
 *
 * The widening is the whole point. Before it, an author could dodge the misdirection gate by
 * citing a clean neighbouring step and never mentioning the step that actually failed with a
 * candidate record in its brief. `failingStepOf` is the one exported spelling of "which step
 * this failure is about" (390 FLAK-01), so the gate and the failure fingerprint agree about
 * the step by construction rather than by coincidence.
 *
 * Returned in the test's own step order, deduplicated — steps, not indexes, because every
 * caller below needs the served brief.
 */
function pathStepsOf(
  verdict: Verdict,
  parts: VerdictSentenceParts | undefined,
  test: PerTestOutcome,
): StepEvidence[] {
  const indexes = new Set<number>(verdict.evidence.citedSteps)
  if (parts !== undefined && 'stepIndex' in parts.groundingQuote) {
    indexes.add(parts.groundingQuote.stepIndex)
  }
  const failing = failingStepOf(test)
  if (failing !== undefined) indexes.add(failing.stepIndex)
  return test.steps.filter((step) => indexes.has(step.stepIndex))
}

/** Render an on-path set for a reject reason: `rec_a(candidate), rec_b(low-trust-active)`. */
function renderMemoryOnPath(entries: readonly MemoryOnPathEntry[]): string {
  if (entries.length === 0) return 'no low-trust record'
  return entries.map((entry) => `${entry.recordId}(${entry.trust})`).join(', ')
}

/** Order-insensitive equality of a declared `memoryOnPath` against the recomputed set. */
function sameMemoryOnPath(
  declared: readonly MemoryOnPathEntry[],
  recomputed: readonly MemoryOnPathEntry[],
): boolean {
  const key = (entries: readonly MemoryOnPathEntry[]): string =>
    entries
      .map((entry) => `${entry.recordId} ${entry.trust}`)
      .slice()
      .sort()
      .join('')
  return declared.length === recomputed.length && key(declared) === key(recomputed)
}

/** What the per-test walk needs beyond the two documents' per-test slices. */
interface ValidationContext {
  readonly runId: string
  readonly handoffBaseDigest: string
  readonly options: AnalysisValidationOptions
}

/**
 * The 422 circularity gate, applied once the class is known to move no trust AND the run's own
 * briefs put at least one low-trust record on the verdict's failing path.
 *
 * The order is the law's order: the D-19 absence exemption is decided FIRST (a run with no
 * evaluation root never had rows to ship, so demanding them would refuse the only honest
 * answer it can give), historical bytes then keep Phase 389's boolean-only acceptance, and
 * only a declared CURRENT gated producer is held to the complete D-20 ledger.
 */
function validateMisdirectionEvidence(
  verdict: Verdict,
  perTest: number,
  verdictClass: string,
  sites: readonly MemoryOnPathSite[],
  context: ValidationContext,
  reject: (reason: string) => void,
): void {
  const block = verdict.misdirectionRuledOut
  const posture = context.options.rootPosture ?? 'eval-root'

  if (block?.backing === 'declared-only') {
    if (posture !== 'no-eval-root') {
      reject(
        'misdirectionRuledOut.backing "declared-only" is available only to a run with no ' +
          `evaluation root; this run's posture is "${posture}", so the claim is unbacked — ` +
          'cross-check every record on the failing path or answer unknown',
      )
    }
    return
  }

  if (context.options.gatedProducerEvidence !== true) return

  if (block === undefined) {
    reject(
      `class "${verdictClass}" claims no trust change while candidate/low-trust memory was ` +
        'served on the failing path, but no misdirectionRuledOut evidence accompanies the ' +
        'claim — cross-check every record this run put on that path',
    )
    return
  }

  const aggregate = aggregateMisdirectionEvidence({
    runId: context.runId,
    perTest,
    handoffBaseDigest: context.handoffBaseDigest,
    sites,
    results: block.results,
  })
  switch (aggregate.outcome) {
    case 'held':
      return
    case 'flipped':
      reject(
        `the misdirection cross-check FLIPPED for ${aggregate.suspect.join(', ')} — the ` +
          `served memory is suspect, so class "${verdictClass}" cannot claim no trust ` +
          'change; answer unknown and let the record take the harm',
      )
      return
    case 'unknown':
      reject(
        'the misdirection cross-check did not resolve for every record on the failing path ' +
          `(inconclusive: ${aggregate.inconclusive.join(', ') || 'none'}; not-run: ` +
          `${aggregate.notRun.join(', ') || 'none'}; unchecked: ` +
          `${aggregate.unchecked.join(', ') || 'none'}) — an unresolved sibling is not a held ` +
          'exoneration',
      )
      return
    case 'evidence-refused':
      reject(
        'misdirectionRuledOut evidence failed key integrity: ' + aggregate.problems.join('; '),
      )
  }
}

function validateOneTest(
  verdict: Verdict,
  parts: VerdictSentenceParts | undefined,
  test: PerTestOutcome | undefined,
  context: ValidationContext,
  rejects: AnalysisValidationReject[],
): void {
  const perTest = verdict.perTest
  const reject = (reason: string): void => {
    rejects.push({ perTest, reason })
  }

  if (test === undefined) {
    reject(`no member test with testIndex ${perTest} exists in the handoff`)
    return
  }

  const verdictClass: string = verdict.class
  if (!isVerdictClass(verdictClass)) {
    reject(
      `class "${verdictClass}" is not a member of the closed verdict union ` +
        `(${VERDICT_CLASSES.join(', ')})`,
    )
  }

  if (!(verdict.confidence >= 0 && verdict.confidence <= 1)) {
    reject(
      `confidence ${String(verdict.confidence)} is outside [0, 1] — answer a value inside ` +
        'the interval, it is never clamped',
    )
  }

  const stepIndexes = new Set(test.steps.map((step) => step.stepIndex))
  for (const cited of verdict.evidence.citedSteps) {
    if (!stepIndexes.has(cited)) {
      reject(
        `citedSteps names step ${cited}, which does not exist in this test's captured steps`,
      )
    }
  }

  if (parts === undefined) {
    reject('no sentence-parts record joins this verdict by perTest')
  } else {
    validateGroundingQuote(parts, test, reject)
    for (const link of parts.links) {
      if (parseEntityUri(link) === undefined) {
        reject(`link "${link}" is not a parseable agentqa:// entity URI`)
      }
    }
  }

  // 422 D-17: membership is RECOMPUTED from the run's own served briefs, over the cited
  // steps, the grounding step AND the actual failing step. A declared `memoryOnPath` is
  // compared against it and never substituted for it.
  const pathSteps = pathStepsOf(verdict, parts, test)
  const sites = deriveMemoryOnPathSites(pathSteps)
  const recomputed = deriveMemoryOnPath(pathSteps)

  if (verdict.memoryOnPath !== undefined && !sameMemoryOnPath(verdict.memoryOnPath, recomputed)) {
    reject(
      `memoryOnPath declares ${renderMemoryOnPath(verdict.memoryOnPath)} but this run's own ` +
        `served briefs put ${renderMemoryOnPath(recomputed)} on the failing path — ` +
        'membership is recomputed from the briefs, never taken from the verdict',
    )
  }

  if (NO_TRUST_CHANGE_CLASSES.has(verdictClass) && sites.length > 0) {
    if (verdict.memoryMisdirectionRuledOut !== true) {
      reject(
        `class "${verdictClass}" claims no trust change while candidate/low-trust memory ` +
          'was served on the failing path, but memoryMisdirectionRuledOut is not true — ' +
          'rule misdirection out explicitly or answer unknown',
      )
    } else {
      validateMisdirectionEvidence(verdict, perTest, verdictClass, sites, context, reject)
    }
  }
}

function validateGroundingQuote(
  parts: VerdictSentenceParts,
  test: PerTestOutcome,
  reject: (reason: string) => void,
): void {
  const quote = parts.groundingQuote
  if (quote.quote === '') {
    reject('groundingQuote is empty — a sentence must quote captured evidence verbatim')
    return
  }

  if ('stepIndex' in quote) {
    if (test.steps.length === 0) {
      reject(
        `groundingQuote cites step ${quote.stepIndex} but this test captured zero steps — ` +
          'use the test-outcome quote variant',
      )
      return
    }
    const step = test.steps.find((candidate) => candidate.stepIndex === quote.stepIndex)
    if (step === undefined) {
      reject(
        `groundingQuote cites step ${quote.stepIndex}, which does not exist in this test's ` +
          'captured steps',
      )
      return
    }
    if (!searchedQuoteTexts(step).some((text) => text.includes(quote.quote))) {
      reject(
        `quote not found: "${quoteForReason(quote.quote)}" is not verbatim-present in any ` +
          `searched field of step ${quote.stepIndex} ` +
          `(${QUOTE_SEARCHED_STEP_FIELDS.join(', ')})`,
      )
    }
    return
  }

  if (!searchedTestOutcomeTexts(test).some((text) => text.includes(quote.quote))) {
    reject(
      `quote not found: "${quoteForReason(quote.quote)}" is not verbatim-present in the ` +
        "test's outcome fields",
    )
  }
}

/**
 * Validate an analysis artifact against the run's handoff — pure and synchronous over its
 * arguments, per-test granular, reject reasons shaped for the repair loop.
 *
 * `options` is additive and fail-closed (422): omitting it reproduces the pre-422 acceptance
 * surface exactly, so every existing caller keeps compiling and keeps its answers.
 */
export function validateAnalysisAgainstHandoff(
  artifact: RunAnalysisArtifact,
  handoff: CompletedRunHandoff,
  options: AnalysisValidationOptions = {},
): AnalysisValidationResult {
  const rejects: AnalysisValidationReject[] = []
  const context: ValidationContext = {
    runId: handoff.runId,
    handoffBaseDigest: misdirectionSourceDigest(handoff),
    options,
  }
  const testsByIndex = new Map(handoff.tests.map((test) => [test.testIndex, test]))
  // Duplicate perTest entries are refused upstream by `guardRunAnalysisArtifact` — the
  // rule's one owner (G-389-3B / WR-02). This two-document boundary deliberately does not
  // re-spell uniqueness (a Map here silently keeps the last duplicate, and that is fine);
  // the executable non-owner pin lives in this module's test suite.
  const partsByPerTest = new Map(artifact.parts.map((parts) => [parts.perTest, parts]))

  for (const verdict of artifact.verdicts) {
    validateOneTest(
      verdict,
      partsByPerTest.get(verdict.perTest),
      testsByIndex.get(verdict.perTest),
      context,
      rejects,
    )
  }

  return rejects.length === 0 ? { ok: true } : { ok: false, rejects }
}
