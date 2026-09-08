import { sha256hex } from '@vostride/agent-qa-schema'
import { z } from 'zod'
import { canonicalJson } from '../canonical-json'
import type { Cassette } from '../cassette/cassette'
import { JUDGE_CONFIG } from '../judge/config'
import { effectiveGold } from '../labels/effective-gold'
import type { StandaloneLabelRecord } from '../labels/label-record'
import type { ReplayCassetteOutcome } from '../replay/result'
import { MATCHER_CONFIG } from './config'
import { scoreCassetteReplay, type CassetteScore, type DecisionScoreEntry, type JudgeIdentityBlock } from './score'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
export const scoringJudgeRequestSchema = z.object({
  judgeModelId: z.string().min(1), allowSameFamily: z.boolean(),
}).strict()
export type ScoringJudgeRequest = z.infer<typeof scoringJudgeRequestSchema> | null
/** Additive score-file context. Absence remains readable for uncorrected legacy scores. */
export const scoringContextSchema = z.object({
  schemaVersion: z.literal(1), matcherVersion: z.number().int().nonnegative(),
  inputsDigest: digest, replayDigest: digest, finalScoreDigest: digest, judgeIdentityDigest: digest,
  judgeRequest: scoringJudgeRequestSchema.nullable(),
}).strict()
export type ScoringContext = z.infer<typeof scoringContextSchema>
interface ScoringInputs {
  cassette: Cassette
  outcome: ReplayCassetteOutcome
  labelRecord?: StandaloneLabelRecord
}
interface StoredScore {
  cassetteId: string
  matcherVersion: number
  score: CassetteScore
  judge?: JudgeIdentityBlock
  scoringContext?: ScoringContext
}
const hash = (value: unknown): string => sha256hex(canonicalJson(value))
function inputsDigest(input: ScoringInputs): string {
  const gold = input.cassette.granularity === 'leaf' ? effectiveGold(input.cassette, input.labelRecord) : undefined
  const cassette = gold?.kind === 'eligible' ? gold.cassette : input.cassette
  // Label trust/weight is selected authoritatively by the report, not adjudicated by the judge.
  const scoringCassette = cassette.granularity === 'leaf'
    ? { ...cassette, label: undefined } : cassette
  return hash({ cassette: scoringCassette,
    correction: input.labelRecord?.correction?.correctedAction ?? null })
}
/** Called after the actual matcher/adjudicator completes; never mints a judge verdict. */
export function createScoringContext(input: ScoringInputs & {
  score: CassetteScore; judge?: JudgeIdentityBlock; judgeRequest: ScoringJudgeRequest
}): ScoringContext {
  return { schemaVersion: 1, matcherVersion: MATCHER_CONFIG.matcherVersion,
    inputsDigest: inputsDigest(input),
    // executionSeed is the store's publication envelope; sample seeds/results are bound here.
    // Baseline admission separately validates that envelope against its run publication.
    replayDigest: hash({ ...input.outcome, executionSeed: undefined }),
    finalScoreDigest: hash(input.score), judgeIdentityDigest: hash(input.judge ?? null),
    judgeRequest: input.judgeRequest }
}

/** Score compatibility is independent of planner input and immutable recorded observations. */
export function resolveScoringContext(input: ScoringInputs & {
  record?: StoredScore; expectedJudgeRequest?: ScoringJudgeRequest
}): { score?: CassetteScore; incurredJudgeScore?: CassetteScore; compatible: boolean } {
  const { cassette, record } = input
  const gold = cassette.granularity === 'leaf' ? effectiveGold(cassette, input.labelRecord) : undefined
  const refuse = (score: CassetteScore) => ({ score, compatible: false,
    ...(record === undefined ? {} : { incurredJudgeScore: record.score }) })
  // Eligibility refusals retain their precise reason even when an older score exists.
  if (gold?.kind === 'refused') return refuse(scoreCassetteReplay(cassette, input.outcome, input.labelRecord))
  const currentJudge = record?.judge === undefined || (record.judge.judgeVersion === JUDGE_CONFIG.judgeVersion &&
    record.judge.confidenceThreshold === JUDGE_CONFIG.confidenceThreshold)
  const expectedJudge = input.expectedJudgeRequest
  const legacyJudgeMatches = expectedJudge === undefined || (expectedJudge === null ? record?.judge === undefined
    : record?.judge?.judgeModelId === expectedJudge.judgeModelId &&
      (record.judge.familyOverride !== undefined) === expectedJudge.allowSameFamily)
  const legacy = record?.scoringContext === undefined && input.labelRecord?.correction === undefined
  if (legacy && (record === undefined || (record.cassetteId === cassette.id && record.score.cassetteId === cassette.id &&
    record.matcherVersion === MATCHER_CONFIG.matcherVersion && currentJudge && legacyJudgeMatches))) {
    return { score: record?.score, compatible: true }
  }
  if (record?.scoringContext !== undefined) {
    const parsed = scoringContextSchema.safeParse(record.scoringContext)
    const context = parsed.success ? parsed.data : undefined
    const current = createScoringContext({ ...input, score: record.score, judge: record.judge,
      judgeRequest: input.expectedJudgeRequest === undefined ? record.scoringContext.judgeRequest : input.expectedJudgeRequest })
    if (context !== undefined && record.cassetteId === cassette.id && record.score.cassetteId === cassette.id &&
      record.matcherVersion === MATCHER_CONFIG.matcherVersion && canonicalJson(context) === canonicalJson(current) &&
      currentJudge && (record.judge === undefined || context.judgeRequest?.judgeModelId === record.judge.judgeModelId)) {
      return { score: record.score, compatible: true }
    }
  }
  const deterministic = scoreCassetteReplay(cassette, input.outcome, input.labelRecord)
  if (deterministic.kind !== 'leaf' && deterministic.kind !== 'procedure') return refuse(deterministic)
  const stale = (entry: DecisionScoreEntry): DecisionScoreEntry =>
    entry.kind === 'skipped' ? entry : { kind: 'never-scored', decisionOrdinal: entry.decisionOrdinal,
      ...(entry.stepIndex === undefined ? {} : { stepIndex: entry.stepIndex }),
      reason: 'stale-scoring-context', matcherVersion: MATCHER_CONFIG.matcherVersion }
  return refuse(deterministic.kind === 'leaf' ? { ...deterministic, entry: stale(deterministic.entry) }
    : { ...deterministic, entries: deterministic.entries.map(stale) })
}
