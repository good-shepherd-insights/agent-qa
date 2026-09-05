import { sha256hex } from '@vostride/agent-qa-schema'

import { canonicalJson } from '../canonical-json'
import type { CassetteLabelLeg } from '../cassette/label-leg'
import { BRIEF_SOURCES } from '../replay/brief-tiers'
import type { BriefSource } from '../replay/brief-tiers'
import type {
  DecisionReplayResult,
  ReplayCassetteOutcome,
  ReplayRefusal,
} from '../replay/result'
import { MATCHER_CONFIG } from './config'
import { isDecisionFullMatch } from './score'
import type {
  CassetteScore,
  DecisionPartialBreakdown,
  DecisionScore,
  DecisionScoreEntry,
  JudgeIdentityBlock,
  JudgeNotInvokedReason,
  JudgeTokenUsage,
  TieCause,
} from './score'
import type { ElementIdentityVerdict } from './tiers'

type UnscorableIdentityCause = Extract<
  ElementIdentityVerdict,
  { kind: 'unscorable' }
>['cause']
type NeverScoredReason = Extract<DecisionScoreEntry, { kind: 'never-scored' }>['reason']
type SkippedReason = Extract<DecisionScoreEntry, { kind: 'skipped' }>['reason']
type Counts<T extends string> = { [K in T]: number }

interface RateMetric {
  numerator: number
  denominator: number
  rate?: number
}

interface TotalCost {
  sampleCount: number
  samplesMissingTokenUsage: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  durationMs: number
}

interface PerDecisionCost {
  decisionCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  durationMs: number
}

/**
 * D-04 distinct judge cost component. Judge calls are never replay samples, so their usage is
 * aggregated from the outcome stamps alone (Pitfall 8) and stays typed-absent-honest: stamps
 * lacking usage are counted in `outcomesMissingUsage` instead of being fabricated.
 */
interface JudgeCost {
  calls: number
  inputTokens: number
  outputTokens: number
  outcomesMissingUsage: number
}

/**
 * D-04/D-12 judge honesty counters: every judge disposition is a visible count per TieCause,
 * errors stay distinct from calibrated abstentions (D-11), and not-invoked is counted per
 * reason so the no-eligible-judge capability gap headlines loudly.
 */
interface JudgeHonesty {
  invoked: Counts<TieCause>
  settled: Counts<TieCause>
  abstained: Counts<TieCause>
  errors: Counts<TieCause>
  notInvoked: Counts<JudgeNotInvokedReason>
  cost: JudgeCost
}

/** One replay outcome plus its optional matcher and label projections (D-14/D-15). */
export interface ScoredBatchEntry {
  cassetteId: string
  outcome: ReplayCassetteOutcome
  score?: CassetteScore
  label?: CassetteLabelLeg
}

/**
 * Pure D-14 report DTO. Accuracy exposes its denominator, flags remain named distributions,
 * and no field combines the independent matcher axes into a fitness-like scalar.
 */
export interface EvalBatchReport {
  matcherVersion: number
  batchKey: string
  headline: {
    firstAttemptDecisionAccuracy: RateMetric
    perDecisionCost: PerDecisionCost
  }
  honesty: {
    tieCounts: Counts<TieCause>
    unscorableIdentityCounts: Counts<UnscorableIdentityCause>
    refusalCounts: Counts<ReplayRefusal['reason']>
    missByFailureCounts: Readonly<Record<string, number>>
    harnessErrorCount: number
    neverScoredCounts: Counts<NeverScoredReason>
    skippedCounts: Counts<SkippedReason>
    judge: JudgeHonesty
  }
  promptDriftRate: RateMetric
  briefSourceCounts: Counts<BriefSource>
  kEscalation: {
    decisionCount: number
    escalatedCount: number
    noConsensusCount: number
    meanAgreementRate?: number
  }
  modelMismatchCount: number
  axisDistributions: {
    elementIdentity: Counts<
      | 'full'
      | 'ordinal-only-differs'
      | 'role-matches-name-differs'
      | 'name-matches-role-differs'
      | 'within-tolerance'
      | 'miss'
    >
    value: Counts<'full' | 'mid' | 'low' | 'not-applicable' | 'not-evaluated'>
    opClass: Counts<'match' | 'mismatch'>
    sideEffect: Counts<'none' | 'flagged'>
    loop: Counts<'not-applicable' | 'none' | 'flagged'>
  }
  recovery: {
    /** Always present; pairless corpora state zero instead of implying recovery evidence. */
    selfHealPairCount: number
    recoveredPositiveCount: number
    eligiblePositiveCount: number
    recoveryAccuracy?: number
    /**
     * D-08 bucket: a full match on a contrastive-negative repeats the recorded mistake and is
     * excluded from the headline accuracy numerator AND denominator; counted here so the
     * channel is never invisible. Always present; label-free batches state zero.
     */
    negativeDecisionCount: number
    /** Excluded negative decisions whose replay fully matched the recorded mistaken action. */
    negativeFullMatchCount: number
  }
  totalCost: TotalCost
  /** D-16 report-level judge identity receipt; absent when no judge existed for the batch. */
  judge?: JudgeIdentityBlock
  /**
   * 413-15 mixed-identity marker — the D-16 receipt's sibling for the case where one report's
   * persisted score records carried canonically DIFFERING judge identity blocks. Present ONLY
   * then; every non-mixed report carries neither this nor `mixedJudgeModelIds`, so already
   * committed report bytes are unchanged. A mixed batch has no single identity to receipt, and
   * one is never synthesized (T-372-20) — so `judge` is absent whenever this is present.
   */
  judgeIdentity?: 'mixed'
  /**
   * The distinct `judgeModelId`s actually seen across the batch's persisted score records,
   * sorted and deduped. Data copied off the blocks, never a fabricated single identity.
   */
  mixedJudgeModelIds?: readonly string[]
}

function isReplayRefusal(outcome: ReplayCassetteOutcome): outcome is ReplayRefusal {
  return 'kind' in outcome && outcome.kind === 'integrity-refusal'
}

function decisionResults(outcome: ReplayCassetteOutcome): readonly DecisionReplayResult[] {
  if (isReplayRefusal(outcome)) return []
  if (outcome.granularity === 'leaf') return [outcome]
  return outcome.steps.flatMap(step => (step.kind === 'decision' ? [step.result] : []))
}

function scoreEntries(score: CassetteScore | undefined): readonly DecisionScoreEntry[] {
  if (score === undefined || score.kind === 'replay-refusal' || score.kind === 'shape-mismatch') {
    return []
  }
  return score.kind === 'leaf' ? [score.entry] : score.entries
}

function decisionScores(score: CassetteScore | undefined): readonly DecisionScore[] {
  return scoreEntries(score).flatMap(entry => (entry.kind === 'decision' ? [entry.score] : []))
}

function breakdownFor(score: DecisionScore): DecisionPartialBreakdown | undefined {
  if (score.kind === 'scored') return score
  if (score.kind === 'unresolved-tie') return score.partial
  return undefined
}

function addJudgeUsage(cost: JudgeCost, usage: JudgeTokenUsage | undefined): void {
  if (usage === undefined) {
    cost.outcomesMissingUsage++
    return
  }
  cost.calls += usage.calls
  cost.inputTokens += usage.inputTokens ?? 0
  cost.outputTokens += usage.outputTokens ?? 0
}

function zeroTieCauseCounts(): Counts<TieCause> {
  return {
    'partial-identity': 0,
    'value-mid-band': 0,
    'no-consensus': 0,
  }
}

function rateMetric(numerator: number, denominator: number): RateMetric {
  return {
    numerator,
    denominator,
    ...(denominator === 0 ? {} : { rate: numerator / denominator }),
  }
}

function sortedCounts(counts: ReadonlyMap<string, number>): Readonly<Record<string, number>> {
  const result: Record<string, number> = {}
  for (const key of [...counts.keys()].sort()) result[key] = counts.get(key) ?? 0
  return result
}

function pairKey(first: string, second: string): string {
  return canonicalJson([first, second].sort())
}

function hasDecisionScore(entry: ScoredBatchEntry | undefined): boolean {
  return entry !== undefined && decisionScores(entry.score).length > 0
}

/** sha256hex over the canonical sorted cassette-id list (D-13). */
export function computeBatchKey(cassetteIds: readonly string[]): string {
  return sha256hex(canonicalJson([...cassetteIds].sort()))
}

/**
 * Aggregate a scored replay batch without recomputing score, drift, or agreement signals.
 *
 * `identity` (413-15) states that the batch mixed judge identities. A caller may not supply both
 * `judge` and `identity` — a mixed batch by definition has no single block — and if both arrive
 * the identity wins and `judge` is dropped, so the report can never claim one identity while
 * disclosing several.
 */
export function buildEvalReport(
  entries: readonly ScoredBatchEntry[],
  judge?: JudgeIdentityBlock,
  identity?: { judgeIdentity: 'mixed'; judgeModelIds: readonly string[] },
): EvalBatchReport {
  const tieCounts: Counts<TieCause> = {
    'partial-identity': 0,
    'value-mid-band': 0,
    'no-consensus': 0,
  }
  const judgeHonesty: JudgeHonesty = {
    invoked: zeroTieCauseCounts(),
    settled: zeroTieCauseCounts(),
    abstained: zeroTieCauseCounts(),
    errors: zeroTieCauseCounts(),
    notInvoked: { 'no-judge-configured': 0, 'no-eligible-judge': 0 },
    cost: { calls: 0, inputTokens: 0, outputTokens: 0, outcomesMissingUsage: 0 },
  }
  const unscorableIdentityCounts: Counts<UnscorableIdentityCause> = {
    'no-gold-evidence': 0,
    'no-candidate-geometry': 0,
    'coordspace-mismatch': 0,
  }
  const refusalCounts: Counts<ReplayRefusal['reason']> = {
    'guard-failed': 0,
    completeness: 0,
    'missing-blob': 0,
    'action-tool-collision': 0,
    'unsupported-brief': 0,
    'unrenderable-brief': 0,
    'parse-failed': 0,
  }
  const neverScoredCounts: Counts<NeverScoredReason> = {
    'all-samples-harness-error': 0,
    'modal-representative-missing': 0,
    'missing-cassette-decision': 0,
  }
  const skippedCounts: Counts<SkippedReason> = { 'cache-served': 0, synthesized: 0 }
  const missByFailure = new Map<string, number>()
  const axisDistributions: EvalBatchReport['axisDistributions'] = {
    elementIdentity: {
      full: 0,
      'ordinal-only-differs': 0,
      'role-matches-name-differs': 0,
      'name-matches-role-differs': 0,
      'within-tolerance': 0,
      miss: 0,
    },
    value: { full: 0, mid: 0, low: 0, 'not-applicable': 0, 'not-evaluated': 0 },
    opClass: { match: 0, mismatch: 0 },
    sideEffect: { none: 0, flagged: 0 },
    loop: { 'not-applicable': 0, none: 0, flagged: 0 },
  }
  const totalCost: TotalCost = {
    sampleCount: 0,
    samplesMissingTokenUsage: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    durationMs: 0,
  }

  let accuracyNumerator = 0
  let accuracyDenominator = 0
  let negativeDecisionCount = 0
  let negativeFullMatchCount = 0

  for (const entry of entries) {
    if (isReplayRefusal(entry.outcome)) {
      refusalCounts[entry.outcome.reason]++
    }
    // D-08: pair members are leaf cassettes carrying exactly one decision, so the per-entry
    // relation read is exact for every decision the entry contributes.
    const isContrastiveNegative = entry.label?.pairing?.relation === 'contrastive-negative'

    for (const scoreEntry of scoreEntries(entry.score)) {
      if (scoreEntry.kind === 'never-scored') {
        neverScoredCounts[scoreEntry.reason]++
        continue
      }
      if (scoreEntry.kind === 'skipped') {
        skippedCounts[scoreEntry.reason]++
        continue
      }

      const score = scoreEntry.score
      if (score.kind === 'miss-by-failure') {
        if (isContrastiveNegative) negativeDecisionCount++
        else accuracyDenominator++
        missByFailure.set(score.reason, (missByFailure.get(score.reason) ?? 0) + 1)
      } else if (score.kind === 'unresolved-tie') {
        tieCounts[score.cause]++
        const outcome = score.judgeOutcome
        if (outcome !== undefined) {
          if (outcome.kind === 'abstained') {
            judgeHonesty.abstained[score.cause]++
            judgeHonesty.invoked[score.cause]++
            addJudgeUsage(judgeHonesty.cost, outcome.usage)
          } else if (outcome.kind === 'judge-error') {
            judgeHonesty.errors[score.cause]++
            judgeHonesty.invoked[score.cause]++
            addJudgeUsage(judgeHonesty.cost, outcome.usage)
          } else {
            judgeHonesty.notInvoked[outcome.reason]++
          }
        }
      } else {
        const settledStamp = score.judgeSettled
        if (settledStamp !== undefined) {
          judgeHonesty.settled[settledStamp.cause]++
          judgeHonesty.invoked[settledStamp.cause]++
          addJudgeUsage(judgeHonesty.cost, settledStamp.usage)
        }
        if (score.axes.elementIdentity.kind !== 'unscorable') {
          if (isContrastiveNegative) {
            negativeDecisionCount++
            if (isDecisionFullMatch(score)) negativeFullMatchCount++
          } else {
            accuracyDenominator++
            if (isDecisionFullMatch(score)) accuracyNumerator++
          }
        }
      }

      const breakdown = breakdownFor(score)
      if (breakdown === undefined) continue
      const elementIdentity = breakdown.axes.elementIdentity
      if (elementIdentity.kind === 'scored') {
        axisDistributions.elementIdentity[elementIdentity.level]++
      } else if (elementIdentity.kind === 'unscorable') {
        unscorableIdentityCounts[elementIdentity.cause]++
      }

      const value = breakdown.axes.value
      if (value.kind === 'scored') axisDistributions.value[value.band]++
      else axisDistributions.value[value.kind]++
      axisDistributions.opClass[breakdown.axes.opClass.kind]++
      axisDistributions.sideEffect[breakdown.sideEffect.kind]++
      axisDistributions.loop[breakdown.loop.kind]++
    }
  }

  const replayDecisions = entries.flatMap(entry => decisionResults(entry.outcome))
  const briefSourceCounts = Object.fromEntries(
    BRIEF_SOURCES.map(source => [source, 0]),
  ) as Counts<BriefSource>
  let harnessErrorCount = 0
  let driftedCount = 0
  let escalatedCount = 0
  let noConsensusCount = 0
  let escalatedAgreementTotal = 0
  let modelMismatchCount = 0

  for (const result of replayDecisions) {
    briefSourceCounts[result.briefSource]++
    harnessErrorCount += result.agreement.harnessErrorCount
    if (result.promptDrift.drift) driftedCount++
    if (result.agreement.k > 1) {
      escalatedCount++
      escalatedAgreementTotal += result.agreement.agreementRate
    }
    if (result.agreement.noConsensus) noConsensusCount++
    if (
      result.recordedModel !== undefined &&
      (result.recordedModel.provider !== result.replayedModel.provider ||
        result.recordedModel.modelId !== result.replayedModel.modelId)
    ) {
      modelMismatchCount++
    }

    for (const replaySample of result.samples) {
      totalCost.sampleCount++
      totalCost.durationMs += replaySample.durationMs
      if (replaySample.tokenUsage === undefined) {
        totalCost.samplesMissingTokenUsage++
      } else {
        totalCost.promptTokens += replaySample.tokenUsage.promptTokens
        totalCost.completionTokens += replaySample.tokenUsage.completionTokens
        totalCost.totalTokens += replaySample.tokenUsage.totalTokens
      }
    }
  }

  const byCassetteId = new Map(entries.map(entry => [entry.cassetteId, entry]))
  const scoredPairs = new Set<string>()
  for (const entry of entries) {
    const pairing = entry.label?.pairing
    if (pairing === undefined) continue
    const paired = byCassetteId.get(pairing.pairedCassetteId)
    if (hasDecisionScore(entry) && hasDecisionScore(paired)) {
      scoredPairs.add(pairKey(entry.cassetteId, pairing.pairedCassetteId))
    }
  }

  let eligiblePositiveCount = 0
  let recoveredPositiveCount = 0
  for (const entry of entries) {
    const pairing = entry.label?.pairing
    if (
      pairing?.relation !== 'contrastive-positive' ||
      !scoredPairs.has(pairKey(entry.cassetteId, pairing.pairedCassetteId))
    ) {
      continue
    }
    eligiblePositiveCount++
    if (decisionScores(entry.score).some(isDecisionFullMatch)) recoveredPositiveCount++
  }

  const decisionCount = replayDecisions.length
  const recovery: EvalBatchReport['recovery'] = {
    selfHealPairCount: scoredPairs.size,
    recoveredPositiveCount,
    eligiblePositiveCount,
    negativeDecisionCount,
    negativeFullMatchCount,
    ...(eligiblePositiveCount === 0
      ? {}
      : { recoveryAccuracy: recoveredPositiveCount / eligiblePositiveCount }),
  }

  // D-04 fold: judge tokens enter the per-decision headline cost on top of the sample-derived
  // sums, while totalCost stays sample-only (distinct-then-folded; never double-counted).
  const foldedPromptTokens = totalCost.promptTokens + judgeHonesty.cost.inputTokens
  const foldedCompletionTokens = totalCost.completionTokens + judgeHonesty.cost.outputTokens
  const foldedTotalTokens =
    totalCost.totalTokens + judgeHonesty.cost.inputTokens + judgeHonesty.cost.outputTokens

  return {
    matcherVersion: MATCHER_CONFIG.matcherVersion,
    batchKey: computeBatchKey(entries.map(entry => entry.cassetteId)),
    headline: {
      firstAttemptDecisionAccuracy: rateMetric(accuracyNumerator, accuracyDenominator),
      perDecisionCost: {
        decisionCount,
        promptTokens: decisionCount === 0 ? 0 : foldedPromptTokens / decisionCount,
        completionTokens: decisionCount === 0 ? 0 : foldedCompletionTokens / decisionCount,
        totalTokens: decisionCount === 0 ? 0 : foldedTotalTokens / decisionCount,
        durationMs: decisionCount === 0 ? 0 : totalCost.durationMs / decisionCount,
      },
    },
    honesty: {
      tieCounts,
      unscorableIdentityCounts,
      refusalCounts,
      missByFailureCounts: sortedCounts(missByFailure),
      harnessErrorCount,
      neverScoredCounts,
      skippedCounts,
      judge: judgeHonesty,
    },
    promptDriftRate: rateMetric(driftedCount, decisionCount),
    briefSourceCounts,
    kEscalation: {
      decisionCount,
      escalatedCount,
      noConsensusCount,
      ...(escalatedCount === 0
        ? {}
        : { meanAgreementRate: escalatedAgreementTotal / escalatedCount }),
    },
    modelMismatchCount,
    axisDistributions,
    recovery,
    totalCost,
    ...(judge === undefined || identity !== undefined ? {} : { judge }),
    ...(identity === undefined
      ? {}
      : {
          judgeIdentity: identity.judgeIdentity,
          mixedJudgeModelIds: [...new Set(identity.judgeModelIds)].sort(),
        }),
  }
}
