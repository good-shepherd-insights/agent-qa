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

import type { ServedBrief } from '../brief/served-brief'
import { canonicalJson } from '../determinism/canonical-json'
import { parseEntityUri } from '../entity/uri'
import type { CompletedRunHandoff } from '../handoff/completed-run-handoff'
import type { PerTestOutcome } from '../handoff/per-test-outcome'
import type { StepEvidence } from '../handoff/step-evidence'
import type { RunAnalysisArtifact } from './analysis-artifact'
import type { VerdictSentenceParts } from './sentence-parts'
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

/** The closed §A9 union at runtime — an authored class outside this set is a reject. */
const VERDICT_CLASSES: ReadonlySet<string> = new Set([
  'test_bug',
  'app_bug',
  'environment',
  'flake',
  'config_error',
  'llm_error',
  'unknown',
  'timeout',
])

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

/**
 * The deterministic "candidate/low-trust memory on the failing path" determination
 * (spec §A9 / memory.md §7.2), computed from the served brief's own trust markers:
 * a channel-1 line whose fold status is `'candidate'` (pre-promotion, unconfirmed), or one
 * served as a CANARY (a low-trust record deliberately served on probation to gather
 * outcome evidence). Both are the store's own declarations that the record's trust was
 * not established when it was put on this step's path — no minted threshold, no second
 * spelling of the trust fold.
 */
function briefCarriesCandidateOrLowTrust(brief: ServedBrief): boolean {
  return brief.channel1.some(
    (line) => line.status === 'candidate' || line.servedAsCanary,
  )
}

/** Bound a quoted string for a reject reason — the reason names the quote, not reprints it. */
function quoteForReason(quote: string): string {
  return quote.length <= 80 ? quote : `${quote.slice(0, 80)}…`
}

/**
 * The step a verdict's evidence touches: `citedSteps` plus the grounding quote's own step.
 * The misdirection rule ranges over ALL of them — a served candidate record on any cited
 * step is on the failing path.
 */
function citedStepIndexes(verdict: Verdict, parts: VerdictSentenceParts | undefined): number[] {
  const indexes = [...verdict.evidence.citedSteps]
  if (parts !== undefined && 'stepIndex' in parts.groundingQuote) {
    indexes.push(parts.groundingQuote.stepIndex)
  }
  return indexes
}

function validateOneTest(
  verdict: Verdict,
  parts: VerdictSentenceParts | undefined,
  test: PerTestOutcome | undefined,
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
  if (!VERDICT_CLASSES.has(verdictClass)) {
    reject(
      `class "${verdictClass}" is not a member of the closed verdict union ` +
        `(${[...VERDICT_CLASSES].join(', ')})`,
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

  if (NO_TRUST_CHANGE_CLASSES.has(verdictClass) && verdict.memoryMisdirectionRuledOut !== true) {
    const citedSteps = citedStepIndexes(verdict, parts)
      .map((index) => test.steps.find((step) => step.stepIndex === index))
      .filter((step): step is StepEvidence => step !== undefined)
    if (citedSteps.some((step) => briefCarriesCandidateOrLowTrust(step.servedBrief))) {
      reject(
        `class "${verdictClass}" claims no trust change while candidate/low-trust memory ` +
          'was served on the failing path, but memoryMisdirectionRuledOut is not true — ' +
          'rule misdirection out explicitly or answer unknown',
      )
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
 * two arguments, per-test granular, reject reasons shaped for the repair loop.
 */
export function validateAnalysisAgainstHandoff(
  artifact: RunAnalysisArtifact,
  handoff: CompletedRunHandoff,
): AnalysisValidationResult {
  const rejects: AnalysisValidationReject[] = []
  const testsByIndex = new Map(handoff.tests.map((test) => [test.testIndex, test]))
  const partsByPerTest = new Map(artifact.parts.map((parts) => [parts.perTest, parts]))

  for (const verdict of artifact.verdicts) {
    validateOneTest(
      verdict,
      partsByPerTest.get(verdict.perTest),
      testsByIndex.get(verdict.perTest),
      rejects,
    )
  }

  return rejects.length === 0 ? { ok: true } : { ok: false, rejects }
}
