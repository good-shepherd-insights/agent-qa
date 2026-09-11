import { z } from 'zod'
import {
  ADVERSARIAL_MUTATORS,
  GENERATOR_KINDS,
  GENERATOR_PROVENANCES,
} from '@vostride/agent-qa-eval'
import type { EvalBatchReport } from '@vostride/agent-qa-eval'

const count = z.number().int().nonnegative().safe()
const amount = z.number().finite().nonnegative()
const unit = z.number().finite().min(0).max(1)
const rate = z.object({ numerator: count, denominator: count, rate: unit.optional() })
  .passthrough().refine(row => row.numerator <= row.denominator &&
    (row.denominator === 0 ? row.rate === undefined : row.rate === row.numerator / row.denominator))
const recovery = z.object({ weightSum: z.number().finite().nonnegative(),
  pairsWithoutWeight: count, weightedAccuracy: unit.optional(),
  selfHealPairCount: count, recoveredPositiveCount: count, eligiblePositiveCount: count,
  recoveryAccuracy: unit.optional(), negativeDecisionCount: count, negativeFullMatchCount: count,
}).passthrough()
const cell = z.object({ firstAttemptDecisionAccuracy: rate, verifierFalsePassRate: rate,
  recovery, perDecisionCost: z.object({ decisionCount: count, promptTokens: amount,
    completionTokens: amount, totalTokens: amount, durationMs: amount }).passthrough(),
}).passthrough()
/**
 * 2026-09-12, 422 D-05/D-08: the stored generation mix, validated STRICTLY and additively.
 *
 * A closed-set group is `z.record` keyed on the shipped vocabulary rather than a free string map,
 * so a mutator or provenance arm read off disk that this build does not know is a REFUSAL and not
 * a value that passes through into a disclosure a reader trusts. The open-set groups (table
 * generation, prompt version, authoring model and family) cannot be enumerated — nobody can list
 * the generations that do not exist — so those keep a string key and validate only their counts.
 */
const closedCounts = <T extends string>(values: readonly [T, ...T[]]) =>
  z.record(z.enum(values), count)
const openCounts = z.record(z.string(), count)
const generationMix = z.object({
  total: count,
  metadataUnavailable: count,
  byProvenance: closedCounts(GENERATOR_PROVENANCES),
  byKind: closedCounts(GENERATOR_KINDS),
  byMutator: closedCounts(ADVERSARIAL_MUTATORS),
  byTableVersion: openCounts,
  tableHashesByVersion: z.record(z.string(), z.array(z.string())),
  byPromptVersion: openCounts,
  byAuthoringModel: openCounts,
  byAuthoringFamily: openCounts,
}).strict()

const current = z.object({
  // Additive-optional: absent is the pre-422 shape and stays admissible forever.
  adversarialGenerationMix: generationMix.optional(),
  headline: z.object({ verifierFalsePassRate: rate }).passthrough(),
  recovery,
  calibration: z.discriminatedUnion('status', [
    z.object({ status: z.literal('uncalibrated'), n_gold: count.optional(), verifierFalsePassRate: rate.optional() }).passthrough(),
    z.object({ status: z.literal('calibrated'), n_gold: count, verifierFalsePassRate: rate }).passthrough(),
  ]),
  perSplit: z.object({ natural: cell, 'held-out': z.object({ shared: cell, private: cell }).passthrough(),
    adversarial: cell, unassignedCount: count }).passthrough(),
}).passthrough()

/** Read boundary only: a partially present addition is never evidence of a legacy format. */
export function reportMetadataKind(value: unknown): 'legacy' | 'current' | 'invalid' {
  if (value === null || typeof value !== 'object') return 'invalid'
  const report = value as Record<string, unknown>
  const has = (object: unknown, key: string) => object !== null && typeof object === 'object'
    && Object.hasOwn(object, key)
  // 422: a report carrying the generation mix is certainly not a legacy report, so the mix joins
  // the addition set rather than being ignored — bytes naming it but missing `perSplit` are
  // `invalid`, which is the same "partially present is never evidence of legacy" rule as above.
  const additions = has(report, 'calibration') || has(report, 'perSplit')
    || has(report, 'adversarialGenerationMix')
    || has(report.headline, 'verifierFalsePassRate') || has(report.recovery, 'weightSum')
    || has(report.recovery, 'pairsWithoutWeight') || has(report.recovery, 'weightedAccuracy')
  return !additions ? 'legacy' : current.safeParse(value).success ? 'current' : 'invalid'
}

/**
 * Strip the six named Phase420 additions and 422's generation mix from a fresh comparison view;
 * never saved bytes. The mix joins for exactly the reason the six did: a legacy report predates
 * the field, so leaving it on the candidate would make every legacy report stop reproducing from
 * its own retained records the moment the field shipped.
 */
export function legacyReportComparison(report: EvalBatchReport): Record<string, unknown> {
  const {
    calibration: _calibration,
    perSplit: _perSplit,
    adversarialGenerationMix: _generationMix,
    ...historical
  } = report
  const { verifierFalsePassRate: _falsePass, ...headline } = report.headline
  const { weightSum: _weightSum, pairsWithoutWeight: _missing, weightedAccuracy: _weighted, ...recovery } = report.recovery
  return { ...historical, headline, recovery }
}
