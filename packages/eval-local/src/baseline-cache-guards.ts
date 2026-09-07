// Admission for the leaf-only baseline cache. Validate without replacing the persisted
// objects: publication digests must still cover the complete original record values.
import { z } from 'zod'
import {
  actionWireSchema,
  BRIEF_SOURCES,
  TURN_MATCHES,
  REPLAY_REFUSAL_REASONS,
  projectMatcherConfigContract,
} from '@vostride/agent-qa-eval'
import { TIER_ORDER } from '@vostride/agent-qa-safety'

const integer = z.number().int().nonnegative().safe()
const ratio = z.number().min(0).max(1)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const identity = z.object({
  opClass: z.string(),
  target: z.object({ role: z.string(), nameNormalized: z.string(), ordinal: integer }).optional(),
  value: z.string().optional(),
})
const model = z.object({ provider: z.string(), modelId: z.string() })
const drift = z.object({
  drift: z.boolean(),
  harnessDrift: z.boolean(),
  recordedHash: hash,
  recomputedHash: hash,
  declaredDelta: z.object({ kind: z.enum(['injected', 'removed']), id: z.string() }).optional(),
})
const agreement = z.object({
  k: integer.min(1),
  agreementRate: ratio,
  noConsensus: z.boolean(),
  harnessErrorCount: integer,
  modal: z.object({ identity, count: integer.min(1) }).optional(),
})
const sample = z.object({
  sampleIndex: integer,
  durationMs: z.number().nonnegative(),
  unsupportedFeatures: z.array(z.string()).optional(),
  providerFingerprint: z.string().optional(),
  tokenUsage: z
    .object({ promptTokens: integer, completionTokens: integer, totalTokens: integer })
    .optional(),
  outcome: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('decision'), action: actionWireSchema, identity }),
    z.object({ kind: z.literal('planner-failure'), reason: z.string(), message: z.string() }),
    z.object({
      kind: z.literal('unservable-divergence'),
      tool: z.string(),
      args: z.record(z.string(), z.unknown()),
    }),
    z.object({ kind: z.literal('harness-error'), message: z.string() }),
  ]),
})
const refusal = z.object({
  kind: z.literal('integrity-refusal'),
  granularity: z.never().optional(),
  cassetteId: z.string().min(1),
  reason: z.enum(REPLAY_REFUSAL_REASONS),
  detail: z.string(),
})
const leafReplay = z
  .object({
    kind: z.never().optional(),
    granularity: z.literal('leaf'),
    cassetteId: z.string().min(1),
    samples: z.array(sample).min(1),
    agreement,
    modalDecision: identity.optional(),
    promptDrift: drift,
    briefSource: z.enum(BRIEF_SOURCES),
    turnMatch: z.enum(TURN_MATCHES).optional(),
    replayedModel: model,
    recordedModel: model.optional(),
    totalDurationMs: z.number().nonnegative(),
    unconsumedExchanges: z.array(
      z.object({ tool: z.string(), args: z.record(z.string(), z.unknown()) }),
    ),
    executionSeed: z.number().int().safe().optional(),
  })
  .refine(
    (value) =>
      value.agreement.k === value.samples.length &&
      value.samples.every((row, index) => row.sampleIndex === index) &&
      value.agreement.harnessErrorCount <= value.samples.length &&
      (value.agreement.modal?.count ?? 0) <= value.samples.length,
    'sample indices and agreement must describe the stored sample array',
  )

export const baselineReplaySchema = z.union([refusal, leafReplay])

const matcherConfig = projectMatcherConfigContract().config
const identityLevels =
  'identityLadder' in matcherConfig ? Object.keys(matcherConfig.identityLadder) : []

const breakdown = z.object({
  tierReached: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  axes: z.object({
    opClass: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('match'), opClass: z.string() }),
      z.object({ kind: z.literal('mismatch'), goldClass: z.string(), candidateClass: z.string() }),
    ]),
    elementIdentity: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('scored'),
        level: z.enum(identityLevels),
        numeric: ratio,
        tier: z.union([z.literal(2), z.literal(3)]),
      }),
      z.object({
        kind: z.literal('unscorable'),
        cause: z.enum(['no-gold-evidence', 'no-candidate-geometry', 'coordspace-mismatch']),
      }),
      z.object({ kind: z.literal('not-evaluated') }),
    ]),
    value: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('scored'), f1: ratio, band: z.enum(['full', 'mid', 'low']) }),
      z.object({ kind: z.literal('not-evaluated') }),
      z.object({ kind: z.literal('not-applicable') }),
    ]),
  }),
  sideEffect: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('flagged'), reason: z.string(), riskFamily: z.enum(TIER_ORDER) }),
  ]),
  loop: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('not-applicable') }),
    z.object({ kind: z.literal('flagged'), priorStepIndex: integer }),
  ]),
})
const confidence = z.enum(['high', 'medium', 'low'])
const tieCause = z.enum(['partial-identity', 'value-mid-band', 'no-consensus'])
const judgeStamp = z.object({
  judgeId: z.string(),
  judgeVersion: integer,
  usage: z
    .object({ calls: integer, inputTokens: integer.optional(), outputTokens: integer.optional() })
    .optional(),
})
const decisionScore = z.discriminatedUnion('kind', [
  breakdown.extend({
    kind: z.literal('scored'),
    matcherVersion: integer,
    judgeSettled: judgeStamp
      .extend({
        axis: z.enum(['element-identity', 'value']),
        resolution: z.enum(['equivalent', 'different']),
        cause: tieCause,
        confidence,
      })
      .optional(),
  }),
  z.object({ kind: z.literal('miss-by-failure'), reason: z.string(), matcherVersion: integer }),
  z.object({
    kind: z.literal('unresolved-tie'),
    cause: tieCause,
    partial: breakdown.optional(),
    matcherVersion: integer,
    judgeOutcome: z
      .discriminatedUnion('kind', [
        judgeStamp.extend({
          kind: z.literal('abstained'),
          confidence: confidence.optional(),
          cause: z.enum([
            'unsure-verdict',
            'below-threshold',
            'swap-disagreement',
            'candidate-overflow',
            'missing-evidence',
            'residual-tie',
          ]),
        }),
        judgeStamp.extend({
          kind: z.literal('judge-error'),
          reason: z.enum(['provider-error', 'unparseable-output']),
          detail: z.string(),
        }),
        z.object({
          kind: z.literal('not-invoked'),
          reason: z.enum(['no-judge-configured', 'no-eligible-judge']),
          families: z
            .object({
              judge: z.string().optional(),
              replayed: z.string().optional(),
              recorded: z.string().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  }),
])
const scoreEntry = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('decision'),
    decisionOrdinal: integer,
    stepIndex: integer.optional(),
    score: decisionScore,
  }),
  z.object({
    kind: z.literal('never-scored'),
    decisionOrdinal: integer,
    stepIndex: integer.optional(),
    reason: z.enum([
      'all-samples-harness-error',
      'modal-representative-missing',
      'missing-cassette-decision',
    ]),
    matcherVersion: integer,
  }),
])

export const baselineScoreSchema = z
  .object({
    cassetteId: z.string().min(1),
    matcherVersion: integer,
    score: z.object({ kind: z.literal('leaf'), cassetteId: z.string().min(1), entry: scoreEntry }),
    diffs: z.array(
      z.object({
        kind: z.enum(['scored', 'miss-by-failure', 'unresolved-tie']),
        cassetteId: z.string().min(1),
        decisionOrdinal: integer,
        stepIndex: integer.optional(),
        matcherVersion: integer,
        goldIdentity: identity,
        candidateIdentity: identity.optional(),
        replay: z.object({
          promptDrift: drift,
          agreement,
          replayedModel: model,
          recordedModel: model.optional(),
        }),
      }),
    ),
    judge: z
      .object({
        judgeModelId: z.string(),
        judgeFamily: z.string(),
        judgeVersion: integer,
        confidenceThreshold: confidence,
        familyOverride: z.literal('same-family-allowed').optional(),
      })
      .optional(),
  })
  .refine((record) => {
    const entry = record.score.entry
    return (
      record.score.cassetteId === record.cassetteId &&
      (entry.kind === 'decision' ? entry.score.matcherVersion : entry.matcherVersion) ===
        record.matcherVersion &&
      record.diffs.every(
        (diff) =>
          diff.cassetteId === record.cassetteId &&
          diff.matcherVersion === record.matcherVersion &&
          diff.decisionOrdinal === entry.decisionOrdinal &&
          diff.stepIndex === entry.stepIndex,
      )
    )
  }, 'nested score identities must match the admitted record')
