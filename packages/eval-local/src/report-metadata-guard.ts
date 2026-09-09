import { z } from 'zod'
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
const current = z.object({
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
  const additions = has(report, 'calibration') || has(report, 'perSplit')
    || has(report.headline, 'verifierFalsePassRate') || has(report.recovery, 'weightSum')
    || has(report.recovery, 'pairsWithoutWeight') || has(report.recovery, 'weightedAccuracy')
  return !additions ? 'legacy' : current.safeParse(value).success ? 'current' : 'invalid'
}

/** Strip only the six named Phase420 additions from a fresh comparison view; never saved bytes. */
export function legacyReportComparison(report: EvalBatchReport): Record<string, unknown> {
  const { calibration: _calibration, perSplit: _perSplit, ...historical } = report
  const { verifierFalsePassRate: _falsePass, ...headline } = report.headline
  const { weightSum: _weightSum, pairsWithoutWeight: _missing, weightedAccuracy: _weighted, ...recovery } = report.recovery
  return { ...historical, headline, recovery }
}
