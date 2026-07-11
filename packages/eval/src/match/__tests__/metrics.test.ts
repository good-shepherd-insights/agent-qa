import { asRef } from '@vostride/agent-qa-schema'
import type { ModelIdentity } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import type { CassetteLabelLeg } from '../../cassette/label-leg'
import type {
  DecisionReplayResult,
  LeafReplayResult,
  ReplayRefusal,
  ReplaySample,
} from '../../replay/result'
import { MATCHER_CONFIG } from '../config'
import type { LoopVerdict } from '../loop'
import {
  buildEvalReport,
  computeBatchKey,
} from '../metrics'
import type { ScoredBatchEntry } from '../metrics'
import type { SideEffectVerdict } from '../risk'
import type {
  DecisionPartialBreakdown,
  DecisionScore,
  ValueAxisVerdict,
} from '../score'
import type { ElementIdentityVerdict, OpClassVerdict } from '../tiers'

const identity = {
  opClass: 'click',
  target: { role: 'button', nameNormalized: 'log in', ordinal: 0 },
} as const
const action = { type: 'click', ref: asRef('e2') } as const

function sample(
  sampleIndex: number,
  durationMs: number,
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number },
): ReplaySample {
  return {
    sampleIndex,
    outcome: { kind: 'decision', action, identity },
    durationMs,
    ...(tokenUsage === undefined ? {} : { tokenUsage }),
  }
}

interface ReplayOptions {
  samples?: ReplaySample[]
  promptDrift?: boolean
  agreementRate?: number
  noConsensus?: boolean
  recordedModel?: ModelIdentity
  replayedModel?: { provider: string; modelId: string }
}

function leafOutcome(cassetteId: string, options: ReplayOptions = {}): LeafReplayResult {
  const samples = options.samples ?? [sample(0, 10)]
  const harnessErrorCount = samples.filter(item => item.outcome.kind === 'harness-error').length
  return {
    granularity: 'leaf',
    cassetteId,
    samples,
    agreement: {
      k: samples.length,
      agreementRate: options.agreementRate ?? 1,
      noConsensus: options.noConsensus ?? false,
      harnessErrorCount,
    },
    promptDrift: {
      drift: options.promptDrift ?? false,
      recordedHash: 'recorded-hash',
      recomputedHash: options.promptDrift ? 'different-hash' : 'recorded-hash',
    },
    ...(options.recordedModel === undefined ? {} : { recordedModel: options.recordedModel }),
    replayedModel: options.replayedModel ?? { provider: 'test', modelId: 'model-1' },
    unconsumedExchanges: [],
    totalDurationMs: samples.reduce((total, item) => total + item.durationMs, 0),
  }
}

interface BreakdownOptions {
  elementIdentity?: ElementIdentityVerdict
  opClass?: OpClassVerdict
  value?: ValueAxisVerdict
  sideEffect?: SideEffectVerdict
  loop?: LoopVerdict
  tierReached?: 1 | 2 | 3
}

function breakdown(options: BreakdownOptions = {}): DecisionPartialBreakdown {
  return {
    axes: {
      elementIdentity: options.elementIdentity ?? {
        kind: 'scored',
        level: 'full',
        numeric: 1,
        tier: 2,
      },
      opClass: options.opClass ?? { kind: 'match', opClass: 'activate' },
      value: options.value ?? { kind: 'not-applicable' },
    },
    sideEffect: options.sideEffect ?? { kind: 'none' },
    loop: options.loop ?? { kind: 'none' },
    tierReached: options.tierReached ?? 2,
  }
}

function settledScore(options: BreakdownOptions = {}): DecisionScore {
  return {
    kind: 'scored',
    ...breakdown(options),
    matcherVersion: MATCHER_CONFIG.matcherVersion,
  }
}

function tieScore(
  cause: Extract<DecisionScore, { kind: 'unresolved-tie' }>['cause'],
  options: BreakdownOptions = {},
): DecisionScore {
  return {
    kind: 'unresolved-tie',
    cause,
    partial: breakdown(options),
    matcherVersion: MATCHER_CONFIG.matcherVersion,
  }
}

function scoredEntry(
  cassetteId: string,
  score: DecisionScore,
  options: ReplayOptions = {},
  label?: CassetteLabelLeg,
): ScoredBatchEntry {
  return {
    cassetteId,
    outcome: leafOutcome(cassetteId, options),
    score: {
      kind: 'leaf',
      cassetteId,
      entry: { kind: 'decision', decisionOrdinal: 0, score },
    },
    ...(label === undefined ? {} : { label }),
  }
}

function neverScoredEntry(cassetteId: string, samples: ReplaySample[]): ScoredBatchEntry {
  return {
    cassetteId,
    outcome: leafOutcome(cassetteId, { samples }),
    score: {
      kind: 'leaf',
      cassetteId,
      entry: {
        kind: 'never-scored',
        decisionOrdinal: 0,
        reason: 'all-samples-harness-error',
        matcherVersion: MATCHER_CONFIG.matcherVersion,
      },
    },
  }
}

function refusalEntry(cassetteId: string, reason: ReplayRefusal['reason']): ScoredBatchEntry {
  return {
    cassetteId,
    outcome: {
      kind: 'integrity-refusal',
      cassetteId,
      reason,
      detail: `refused: ${reason}`,
    },
  }
}

describe('buildEvalReport', () => {
  it('uses an explicit settled-decision denominator and keeps ties/exclusions separate', () => {
    const harnessSample: ReplaySample = {
      sampleIndex: 0,
      outcome: { kind: 'harness-error', message: 'provider unavailable' },
      durationMs: 10,
    }
    const report = buildEvalReport([
      scoredEntry('full', settledScore()),
      scoredEntry(
        'hard-miss',
        settledScore({
          elementIdentity: { kind: 'not-evaluated' },
          opClass: { kind: 'mismatch', goldClass: 'activate', candidateClass: 'value-entry' },
          value: { kind: 'not-evaluated' },
          tierReached: 1,
        }),
      ),
      scoredEntry('failure', {
        kind: 'miss-by-failure',
        reason: 'step_failed',
        matcherVersion: MATCHER_CONFIG.matcherVersion,
      }),
      scoredEntry('tie', tieScore('partial-identity')),
      scoredEntry(
        'unscorable',
        settledScore({ elementIdentity: { kind: 'unscorable', cause: 'no-gold-evidence' } }),
      ),
      refusalEntry('refusal', 'guard-failed'),
      neverScoredEntry('harness-only', [harnessSample]),
    ])

    expect(report.headline.firstAttemptDecisionAccuracy).toEqual({
      numerator: 1,
      denominator: 3,
      rate: 1 / 3,
    })
    expect(report.honesty.tieCounts['partial-identity']).toBe(1)
    expect(report.honesty.unscorableIdentityCounts['no-gold-evidence']).toBe(1)
    expect(report.honesty.refusalCounts['guard-failed']).toBe(1)
    expect(report.honesty.harnessErrorCount).toBe(1)
    expect(report.honesty.missByFailureCounts).toEqual({ step_failed: 1 })
  })

  it('reports every tie, unscorable, refusal, and miss-by-failure cause', () => {
    const refusalReasons: ReplayRefusal['reason'][] = [
      'guard-failed',
      'completeness',
      'missing-blob',
      'action-tool-collision',
      'unsupported-brief',
      'parse-failed',
    ]
    const entries: ScoredBatchEntry[] = [
      scoredEntry('tie-partial', tieScore('partial-identity')),
      scoredEntry('tie-value', tieScore('value-mid-band')),
      scoredEntry('tie-consensus', tieScore('no-consensus')),
      scoredEntry(
        'unscorable-gold',
        settledScore({ elementIdentity: { kind: 'unscorable', cause: 'no-gold-evidence' } }),
      ),
      scoredEntry(
        'unscorable-candidate',
        settledScore({
          elementIdentity: { kind: 'unscorable', cause: 'no-candidate-geometry' },
        }),
      ),
      scoredEntry(
        'unscorable-space',
        settledScore({
          elementIdentity: { kind: 'unscorable', cause: 'coordspace-mismatch' },
        }),
      ),
      scoredEntry('failure-planner', {
        kind: 'miss-by-failure',
        reason: 'step_failed',
        matcherVersion: MATCHER_CONFIG.matcherVersion,
      }),
      scoredEntry('failure-tool', {
        kind: 'miss-by-failure',
        reason: 'unservable-divergence:lookup',
        matcherVersion: MATCHER_CONFIG.matcherVersion,
      }),
      ...refusalReasons.map((reason, index) => refusalEntry(`refusal-${index}`, reason)),
    ]

    const report = buildEvalReport(entries)

    expect(report.honesty.tieCounts).toEqual({
      'partial-identity': 1,
      'value-mid-band': 1,
      'no-consensus': 1,
    })
    expect(report.honesty.unscorableIdentityCounts).toEqual({
      'no-gold-evidence': 1,
      'no-candidate-geometry': 1,
      'coordspace-mismatch': 1,
    })
    expect(report.honesty.refusalCounts).toEqual({
      'guard-failed': 1,
      completeness: 1,
      'missing-blob': 1,
      'action-tool-collision': 1,
      'unsupported-brief': 1,
      'parse-failed': 1,
    })
    expect(report.honesty.missByFailureCounts).toEqual({
      step_failed: 1,
      'unservable-divergence:lookup': 1,
    })
  })

  it('aggregates sample cost and upstream replay statistics without fabricating usage', () => {
    const report = buildEvalReport([
      scoredEntry('escalated', settledScore(), {
        samples: [
          sample(0, 10, { promptTokens: 10, completionTokens: 5, totalTokens: 15 }),
          sample(1, 20, { promptTokens: 20, completionTokens: 10, totalTokens: 30 }),
          sample(2, 30),
        ],
        promptDrift: true,
        agreementRate: 2 / 3,
        recordedModel: { provider: 'openai', modelId: 'recorded-model' },
        replayedModel: { provider: 'openai', modelId: 'replayed-model' },
      }),
      scoredEntry('single', settledScore(), {
        samples: [sample(0, 40, { promptTokens: 5, completionTokens: 2, totalTokens: 7 })],
      }),
    ])

    expect(report.totalCost).toEqual({
      sampleCount: 4,
      samplesMissingTokenUsage: 1,
      promptTokens: 35,
      completionTokens: 17,
      totalTokens: 52,
      durationMs: 100,
    })
    expect(report.headline.perDecisionCost).toEqual({
      decisionCount: 2,
      promptTokens: 17.5,
      completionTokens: 8.5,
      totalTokens: 26,
      durationMs: 50,
    })
    expect(report.promptDriftRate).toEqual({ numerator: 1, denominator: 2, rate: 0.5 })
    expect(report.kEscalation).toEqual({
      decisionCount: 2,
      escalatedCount: 1,
      noConsensusCount: 0,
      meanAgreementRate: 2 / 3,
    })
    expect(report.modelMismatchCount).toBe(1)
  })

  it('keeps named per-axis distributions instead of a combined scalar', () => {
    const report = buildEvalReport([
      scoredEntry(
        'full',
        settledScore({ value: { kind: 'scored', f1: 1, band: 'full' } }),
      ),
      scoredEntry(
        'ordinal',
        tieScore('partial-identity', {
          elementIdentity: {
            kind: 'scored',
            level: 'ordinal-only-differs',
            numeric: 0.75,
            tier: 2,
          },
          value: { kind: 'scored', f1: 0.6, band: 'mid' },
        }),
      ),
      scoredEntry(
        'role',
        tieScore('partial-identity', {
          elementIdentity: {
            kind: 'scored',
            level: 'role-matches-name-differs',
            numeric: 0.4,
            tier: 2,
          },
          value: { kind: 'scored', f1: 0.1, band: 'low' },
        }),
      ),
      scoredEntry(
        'name',
        tieScore('partial-identity', {
          elementIdentity: {
            kind: 'scored',
            level: 'name-matches-role-differs',
            numeric: 0.25,
            tier: 2,
          },
        }),
      ),
      scoredEntry(
        'tolerance',
        tieScore('partial-identity', {
          elementIdentity: {
            kind: 'scored',
            level: 'within-tolerance',
            numeric: 0.6,
            tier: 3,
          },
          value: { kind: 'not-evaluated' },
          tierReached: 3,
        }),
      ),
      scoredEntry(
        'miss',
        settledScore({
          elementIdentity: { kind: 'scored', level: 'miss', numeric: 0, tier: 2 },
          opClass: { kind: 'mismatch', goldClass: 'activate', candidateClass: 'value-entry' },
          value: { kind: 'not-evaluated' },
          sideEffect: {
            kind: 'flagged',
            reason: 'candidate risk exceeds gold risk',
            riskFamily: 'destructive',
          },
          loop: { kind: 'flagged', priorStepIndex: 0 },
        }),
      ),
    ])

    expect(report.axisDistributions).toEqual({
      elementIdentity: {
        full: 1,
        'ordinal-only-differs': 1,
        'role-matches-name-differs': 1,
        'name-matches-role-differs': 1,
        'within-tolerance': 1,
        miss: 1,
      },
      value: { full: 1, mid: 1, low: 1, 'not-applicable': 1, 'not-evaluated': 2 },
      opClass: { match: 5, mismatch: 1 },
      sideEffect: { none: 5, flagged: 1 },
      loop: { 'not-applicable': 0, none: 5, flagged: 1 },
    })
    expect(Object.hasOwn(report, 'score')).toBe(false)
    expect(Object.hasOwn(report, 'overall')).toBe(false)
  })

  it('computes recovery only for real scored pairs and states zero pairings explicitly', () => {
    const positiveLabel = (pairedCassetteId: string): CassetteLabelLeg => ({
      sourceChannel: 'self-heal-pair',
      tier: 'near-gold',
      pairing: { pairedCassetteId, relation: 'contrastive-positive' },
    })
    const negativeLabel = (pairedCassetteId: string): CassetteLabelLeg => ({
      sourceChannel: 'self-heal-pair',
      tier: 'near-gold',
      pairing: { pairedCassetteId, relation: 'contrastive-negative' },
    })
    const report = buildEvalReport([
      scoredEntry('positive-1', settledScore(), {}, positiveLabel('negative-1')),
      scoredEntry('negative-1', settledScore(), {}, negativeLabel('positive-1')),
      scoredEntry(
        'positive-2',
        settledScore({ elementIdentity: { kind: 'scored', level: 'miss', numeric: 0, tier: 2 } }),
        {},
        positiveLabel('negative-2'),
      ),
      scoredEntry('negative-2', settledScore(), {}, negativeLabel('positive-2')),
    ])

    expect(report.recovery).toEqual({
      selfHealPairCount: 2,
      recoveredPositiveCount: 1,
      eligiblePositiveCount: 2,
      recoveryAccuracy: 0.5,
    })

    const pairless = buildEvalReport([scoredEntry('unpaired', settledScore())])
    expect(pairless.recovery).toEqual({
      selfHealPairCount: 0,
      recoveredPositiveCount: 0,
      eligiblePositiveCount: 0,
    })
    expect(Object.hasOwn(pairless.recovery, 'recoveryAccuracy')).toBe(false)
  })

  it('derives an order-insensitive batch key and stamps matcherVersion on every report', () => {
    const first = computeBatchKey(['cassette-b', 'cassette-a'])
    const second = computeBatchKey(['cassette-a', 'cassette-b'])
    const repeated = computeBatchKey(['cassette-b', 'cassette-a'])
    const report = buildEvalReport([
      scoredEntry('cassette-b', settledScore()),
      scoredEntry('cassette-a', settledScore()),
    ])

    expect(first).toBe(second)
    expect(first).toBe(repeated)
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(report.matcherVersion).toBe(MATCHER_CONFIG.matcherVersion)
    expect(report.batchKey).toBe(first)
  })
})
