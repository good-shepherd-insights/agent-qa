// The runner's judge over the verifier's per-condition output (439 D-07, D-09, D-10). Pure: the
// model judges each condition, the runner checks every citation against what the verifier was
// given and computes the pass. Masking is injected; nothing here reads a model or a platform.

import type {
  CitationSource,
  ConditionCitation,
  ConditionEnding,
  ConditionGuard,
  ConditionRecord,
  ConditionVerdictsEvidence,
  OpenDialogAccount,
} from '@vostride/agent-qa-schema'
import type { ConditionJudgment, VerificationResult } from './types.js'

/** The rendered parts of the verification request a citation can point at. */
export type CitationSources = Record<Exclude<CitationSource, 'screenshot'>, string>

export interface JudgeConditionsInput {
  stepText: string
  output: VerificationResult
  sources: CitationSources
  mask: (value: string) => string
  imageAttached: boolean
  ending: ConditionEnding
}

export interface ConditionJudgeResult {
  evidence: ConditionVerdictsEvidence
  pass: boolean
  reason: string
}

const QUOTE_MAX = 300
const REASON_MAX = 200
const RECORDED_CITATIONS_MAX = 10
const MIN_QUOTE_CHARACTERS = 3
const TEXT_SOURCES: readonly (keyof CitationSources)[] = [
  'start-screen',
  'final-screen',
  'action',
  'read',
  'carried',
]

const GUARD_REASONS: Partial<Record<ConditionGuard, string>> = {
  'not-covered': 'the verifier judged no condition of the step',
  'citation-missing': 'no cited evidence was found in what the verifier was given',
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function bound(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function citable(quote: string): boolean {
  return quote.replace(/\s/g, '').length >= MIN_QUOTE_CHARACTERS
}

function checkCitation(
  citation: { source: CitationSource; quote: string },
  haystacks: Record<keyof CitationSources, string>,
  mask: (value: string) => string,
  imageAttached: boolean,
): ConditionCitation {
  const quote = collapse(mask(citation.quote ?? ''))
  const recorded = bound(quote, QUOTE_MAX)
  if (!citable(quote)) return { source: citation.source, quote: recorded, found: false }
  if (citation.source === 'screenshot' && imageAttached) {
    return { source: 'screenshot', quote: recorded, found: 'unchecked' }
  }
  const order =
    citation.source === 'screenshot'
      ? TEXT_SOURCES
      : [citation.source, ...TEXT_SOURCES.filter((source) => source !== citation.source)]
  for (const source of order) {
    if ((haystacks[source] ?? '').includes(quote)) return { source, quote: recorded, found: true }
  }
  return { source: citation.source, quote: recorded, found: false }
}

function guarded(
  quote: string,
  guard: ConditionGuard,
  reason: string,
  citations: ConditionCitation[] = [],
): ConditionRecord {
  return { quote, verdict: 'unverified', guard, reason: bound(reason, REASON_MAX), citations }
}

function judgeOne(
  judgment: ConditionJudgment,
  haystacks: Record<keyof CitationSources, string>,
  input: JudgeConditionsInput,
): ConditionRecord {
  const quote = bound(collapse(input.mask(judgment.quote ?? '')), QUOTE_MAX)
  const reason = bound(collapse(input.mask(judgment.reasoning ?? '')), REASON_MAX)
  const checked = (Array.isArray(judgment.citations) ? judgment.citations : []).map((citation) =>
    checkCitation(citation, haystacks, input.mask, input.imageAttached),
  )
  const citations = checked.slice(0, RECORDED_CITATIONS_MAX)
  const needs =
    judgment.needs !== undefined && judgment.needs !== 'none' ? { needs: judgment.needs } : {}
  if (judgment.verdict === 'met' && !checked.some((citation) => citation.found !== false)) {
    return {
      quote,
      verdict: 'unverified',
      judged: 'met',
      guard: 'citation-missing',
      ...needs,
      reason: GUARD_REASONS['citation-missing']!,
      citations,
    }
  }
  return { quote, verdict: judgment.verdict, ...needs, reason, citations }
}

/**
 * Judge the verifier's output: a verifier error or an empty list is one unverified condition, a met
 * condition needs a citation the runner finds (or a screenshot citation when an image was
 * attached), and the step passes only when there is a condition and every verdict is met.
 */
export function judgeConditions(input: JudgeConditionsInput): ConditionJudgeResult {
  const stepQuote = bound(collapse(input.mask(input.stepText)), QUOTE_MAX)
  const output = input.output
  let conditions: ConditionRecord[]
  if (output.verifierError !== undefined) {
    const error = collapse(input.mask(output.verifierError))
    const reason = `the verifier could not judge the step: ${error}`
    conditions = [guarded(stepQuote, 'verifier-error', reason)]
  } else {
    const haystacks = Object.fromEntries(
      TEXT_SOURCES.map((source) => [source, collapse(input.mask(input.sources[source] ?? ''))]),
    ) as Record<keyof CitationSources, string>
    const judgments = Array.isArray(output.conditions) ? output.conditions : []
    conditions = judgments.map((judgment) => judgeOne(judgment, haystacks, input))
    if (conditions.length === 0) {
      conditions = [guarded(stepQuote, 'not-covered', GUARD_REASONS['not-covered']!)]
    }
  }
  const evidence: ConditionVerdictsEvidence = { ending: input.ending, conditions }
  const pass = conditions.length > 0 && conditions.every((condition) => condition.verdict === 'met')
  return { evidence, pass, reason: pass ? '' : formatUnprovenReason(conditions) }
}

function entry(quote: string, reason: string): string {
  return reason.length > 0 ? `"${quote}" (${reason})` : `"${quote}"`
}

/**
 * The reason a non-passing step reads with: `Not met: …; Unverified: …; Inconclusive: …`,
 * each group in condition order and omitted when empty. The records arrive masked and bounded.
 */
export function formatUnprovenReason(
  conditions: readonly ConditionRecord[],
  openDialogs?: readonly OpenDialogAccount[],
): string {
  const notMet = conditions
    .filter((c) => c.verdict === 'not-met')
    .map((c) => entry(c.quote, c.reason))
  const unverified = conditions
    .filter((c) => c.verdict === 'unverified')
    .map((c) => entry(c.quote, c.reason))
  for (const dialog of openDialogs ?? []) {
    if (dialog.account === 'unaccounted') {
      unverified.push(`dialog "${dialog.name}" (left open and not accounted for)`)
    }
  }
  const inconclusive = conditions
    .filter((c) => c.verdict === 'inconclusive')
    .map((c) => entry(c.quote, c.reason))
  const groups: string[] = []
  if (notMet.length > 0) groups.push(`Not met: ${notMet.join(', ')}`)
  if (unverified.length > 0) groups.push(`Unverified: ${unverified.join(', ')}`)
  if (inconclusive.length > 0) groups.push(`Inconclusive: ${inconclusive.join(', ')}`)
  return groups.join('; ')
}
