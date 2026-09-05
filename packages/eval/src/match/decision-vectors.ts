import { z } from 'zod'
import { BRIEF_SOURCES } from '../replay/brief-tiers'
import { FLOOR_AXES } from '../stats/decision-vector'
import type { AxisCorrectness, DecisionCorrectnessVector } from '../stats/decision-vector'
import { breakdownFor, isHeadlineApplicable, scoreEntries } from './metrics'
import type { ScoredBatchEntry } from './metrics'
import { isDecisionFullMatch } from './score'

function correctness(correct: boolean): AxisCorrectness {
  return correct ? 'correct' : 'incorrect'
}

/**
 * Pairing requires a known replay source. Historical unstamped decisions remain in report
 * metrics but are omitted here, never assigned fabricated provenance. Every scored modern
 * decision, including a failure or unresolved tie, retains its own applicable axes.
 */
export function decisionCorrectnessVectors(
  entries: readonly ScoredBatchEntry[],
  partitionsById?: ReadonlyMap<string, string>,
): DecisionCorrectnessVector[] {
  const vectors: DecisionCorrectnessVector[] = []
  for (const entry of entries) {
    const outcome = entry.outcome
    if ('kind' in outcome) continue
    for (const scoreEntry of scoreEntries(entry.score)) {
      if (scoreEntry.kind !== 'decision') continue
      // Leaf replay results do not carry ordinals; the score entry retains that recorded ID.
      // Procedure results have their identity on the enclosing step, so join both components.
      const step = outcome.granularity === 'procedure'
        ? outcome.steps.find(candidate =>
            candidate.kind === 'decision' &&
            candidate.stepIndex === scoreEntry.stepIndex &&
            candidate.decisionOrdinal === scoreEntry.decisionOrdinal,
          )
        : undefined
      const result = outcome.granularity === 'leaf'
        ? outcome
        : step?.kind === 'decision'
          ? step.result
          : undefined
      if (result === undefined || !BRIEF_SOURCES.includes(result.briefSource)) continue

      const { score, decisionOrdinal, stepIndex } = scoreEntry
      const breakdown = breakdownFor(score)
      const identity = breakdown?.axes.elementIdentity
      const value = breakdown?.axes.value
      const equivalentAxis = score.kind === 'scored' && score.judgeSettled?.resolution === 'equivalent'
        ? score.judgeSettled.axis
        : undefined
      const isContrastiveNegative = entry.label?.pairing?.relation === 'contrastive-negative'
      vectors.push({
        key: `${entry.cassetteId}#${stepIndex ?? '-'}#${decisionOrdinal}`,
        cassetteId: entry.cassetteId,
        ...(stepIndex === undefined ? {} : { stepIndex }),
        decisionOrdinal,
        product: entry.product ?? partitionsById?.get(entry.cassetteId) ?? 'default',
        briefSource: result.briefSource,
        axes: {
          headline: isHeadlineApplicable(score, isContrastiveNegative)
            ? correctness(isDecisionFullMatch(score))
            : 'not-applicable',
          elementIdentity: identity?.kind === 'scored'
            ? correctness(identity.level === 'full' || equivalentAxis === 'element-identity')
            : 'not-applicable',
          value: value?.kind === 'scored'
            ? correctness(value.band === 'full' || equivalentAxis === 'value')
            : 'not-applicable',
          opClass: breakdown === undefined
            ? 'not-applicable'
            : correctness(breakdown.axes.opClass.kind === 'match'),
          sideEffect: breakdown === undefined
            ? 'not-applicable'
            : correctness(breakdown.sideEffect.kind === 'none'),
          loop: breakdown === undefined || breakdown.loop.kind === 'not-applicable'
            ? 'not-applicable'
            : correctness(breakdown.loop.kind === 'none'),
        },
      })
    }
  }
  return vectors
}

export const DECISION_VECTORS_SCHEMA_VERSION = 1 as const

export interface DecisionVectorsDocument {
  schemaVersion: 1
  batchKey: string
  matcherVersion: number
  vectors: readonly DecisionCorrectnessVector[]
}

const decisionVectorSchema = z
  .object({
    key: z.string().min(1),
    cassetteId: z.string().min(1),
    stepIndex: z.number().int().nonnegative().optional(),
    decisionOrdinal: z.number().int().nonnegative(),
    product: z.string().min(1),
    briefSource: z.enum(BRIEF_SOURCES),
    axes: z.record(z.enum(FLOOR_AXES), z.enum(['correct', 'incorrect', 'not-applicable'])),
  })
  .strict()

/** Committed pairing data has no prompt content or visibility metadata at any level. */
export const decisionVectorsDocumentSchema = z
  .object({
    schemaVersion: z.literal(DECISION_VECTORS_SCHEMA_VERSION),
    batchKey: z.string().min(1),
    matcherVersion: z.number().int().nonnegative(),
    vectors: z.array(decisionVectorSchema),
  })
  .strict()

export function guardDecisionVectorsDocument(
  value: unknown,
): { kind: 'ok'; document: DecisionVectorsDocument } | { kind: 'rejected'; reason: string } {
  const parsed = decisionVectorsDocumentSchema.safeParse(value)
  if (!parsed.success) {
    return {
      kind: 'rejected',
      reason: parsed.error.issues
        .map(issue => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
        .join('; '),
    }
  }
  return { kind: 'ok', document: parsed.data }
}

export function projectDecisionVectorsDocument(input: {
  batchKey: string
  matcherVersion: number
  vectors: readonly DecisionCorrectnessVector[]
}): DecisionVectorsDocument {
  const result = guardDecisionVectorsDocument({
    schemaVersion: DECISION_VECTORS_SCHEMA_VERSION,
    batchKey: input.batchKey,
    matcherVersion: input.matcherVersion,
    vectors: input.vectors,
  })
  if (result.kind === 'rejected') throw new TypeError(`Decision vectors rejected: ${result.reason}`)
  return result.document
}
