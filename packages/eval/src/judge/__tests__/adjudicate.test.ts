import { makeScreenState } from '@vostride/agent-qa-runner'
import { asRef } from '@vostride/agent-qa-schema'
import type { Action } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import type { CassetteSidecarLeg } from '../../cassette/sidecar-leg'
import { MATCHER_CONFIG } from '../../match/config'
import { isDecisionFullMatch, scoreCassetteReplay } from '../../match/score'
import type { CassetteScore, DecisionScore } from '../../match/score'
import {
  leafCassette,
  makeSidecar,
  procedureCassette,
} from '../../replay/__tests__/fixtures'
import { computeDecisionIdentity } from '../../replay/identity'
import type { DecisionIdentity } from '../../replay/identity'
import type {
  DecisionReplayResult,
  LeafReplayResult,
  ProcedureReplayResult,
  ReplayAgreement,
  ReplaySample,
  ReplaySampleOutcome,
} from '../../replay/result'
import { adjudicateCassetteScore, assessJudgeEligibility } from '../adjudicate'
import type { AdjudicationResult, JudgeEligibility } from '../adjudicate'
import { JUDGE_CONFIG } from '../config'
import type { JudgeCallRequest, JudgeCallResult, JudgePort } from '../port'
import { buildJudgePrompt } from '../prompt'
import type { JudgeTieEvidence } from '../prompt'

describe('assessJudgeEligibility', () => {
  it('refuses with no-judge-configured when no judge model id is supplied (D-06)', () => {
    expect(
      assessJudgeEligibility({ replayedModelId: 'gpt-5' }),
    ).toEqual({ eligible: false, reason: 'no-judge-configured' })
  })

  it('treats an unknown judge family as same-family and forbids it (D-13)', () => {
    const eligibility = assessJudgeEligibility({
      judgeModelId: 'stub-judge-model',
      replayedModelId: 'gpt-5',
    })
    expect(eligibility).toEqual({
      eligible: false,
      reason: 'no-eligible-judge',
      families: { replayed: 'openai' },
    })
    if (eligibility.eligible !== false || eligibility.reason !== 'no-eligible-judge') return
    expect(eligibility.families.judge).toBeUndefined()
    expect(eligibility.families.replayed).toBe('openai')
  })

  it('severs the direct self-preference circuit for a judge in the replayed family (D-14 side 1)', () => {
    expect(
      assessJudgeEligibility({
        judgeModelId: 'gpt-4o-mini',
        replayedModelId: 'gpt-5',
      }),
    ).toEqual({
      eligible: false,
      reason: 'no-eligible-judge',
      families: { judge: 'openai', replayed: 'openai' },
    })
  })

  it('forbids a judge sharing the recorded family, and skips the recorded side when absent (D-14 side 2)', () => {
    expect(
      assessJudgeEligibility({
        judgeModelId: 'claude-sonnet-4-5',
        replayedModelId: 'gpt-5',
        recordedModelId: 'claude-opus-4',
      }),
    ).toEqual({
      eligible: false,
      reason: 'no-eligible-judge',
      families: { judge: 'claude', replayed: 'openai', recorded: 'claude' },
    })

    expect(
      assessJudgeEligibility({
        judgeModelId: 'claude-sonnet-4-5',
        replayedModelId: 'gpt-5',
      }),
    ).toEqual({
      eligible: true,
      judgeModelId: 'claude-sonnet-4-5',
      judgeFamily: 'claude',
    })
  })

  it('forbids conservatively when the replayed or supplied recorded family is unknown', () => {
    expect(
      assessJudgeEligibility({
        judgeModelId: 'claude-sonnet-4-5',
        replayedModelId: 'mystery-planner-model',
      }),
    ).toEqual({
      eligible: false,
      reason: 'no-eligible-judge',
      families: { judge: 'claude' },
    })

    expect(
      assessJudgeEligibility({
        judgeModelId: 'claude-sonnet-4-5',
        replayedModelId: 'gpt-5',
        recordedModelId: 'mystery-recorded-model',
      }),
    ).toEqual({
      eligible: false,
      reason: 'no-eligible-judge',
      families: { judge: 'claude', replayed: 'openai' },
    })
  })

  it('grants eligibility for a fully disjoint judge with the resolved judge family', () => {
    expect(
      assessJudgeEligibility({
        judgeModelId: 'claude-sonnet-4-5',
        replayedModelId: 'gpt-5',
        recordedModelId: 'gemini-2.5-pro',
      }),
    ).toEqual({
      eligible: true,
      judgeModelId: 'claude-sonnet-4-5',
      judgeFamily: 'claude',
    })
  })
})

// --- adjudication fixtures --------------------------------------------------

const JUDGE_ID = 'claude-sonnet-4-5'

const ELIGIBLE: JudgeEligibility = {
  eligible: true,
  judgeModelId: JUDGE_ID,
  judgeFamily: 'claude',
}

const screen = makeScreenState()
const buttonAction = { type: 'click', ref: asRef('e2') } as const satisfies Action
const buttonAnchor = { role: 'button', nameNormalized: 'log in', ordinal: 0 }

function buttonSidecar(): CassetteSidecarLeg {
  return makeSidecar({
    goldAction: buttonAction,
    opClass: 'click',
    goldAnchor: buttonAnchor,
    equivalenceSet: [{ ...buttonAnchor, ref: 'gold-button' }],
  })
}

function fillAction(text: string): Action {
  return {
    type: 'fill',
    ref: asRef('e1'),
    text,
    clearMode: 'replace',
    submit: false,
  }
}

function fillSidecar(goldValue: string): CassetteSidecarLeg {
  return makeSidecar({
    goldAction: fillAction(goldValue),
    opClass: 'fill',
    goldValue,
    goldAnchor: { role: 'textbox', nameNormalized: 'email', ordinal: 0 },
    equivalenceSet: [
      { role: 'textbox', nameNormalized: 'email', ordinal: 0, ref: 'gold-input' },
    ],
  })
}

function decisionOutcome(
  action: Action,
  identity: DecisionIdentity = computeDecisionIdentity(action, screen.elements),
): ReplaySampleOutcome {
  return { kind: 'decision', action, identity }
}

function decisionResult(
  outcomes: readonly ReplaySampleOutcome[],
  options: { noConsensus?: boolean } = {},
): DecisionReplayResult {
  const samples: ReplaySample[] = outcomes.map((outcome, sampleIndex) => ({
    sampleIndex,
    outcome,
    durationMs: 10,
  }))
  const firstDecision = outcomes.find(
    (outcome): outcome is Extract<ReplaySampleOutcome, { kind: 'decision' }> =>
      outcome.kind === 'decision',
  )
  const noConsensus = options.noConsensus ?? false
  const modal =
    noConsensus || firstDecision === undefined
      ? undefined
      : { identity: firstDecision.identity, count: 1 }
  const agreement: ReplayAgreement = {
    k: outcomes.length,
    agreementRate: modal === undefined ? 0 : modal.count / outcomes.length,
    ...(modal === undefined ? {} : { modal }),
    noConsensus,
    harnessErrorCount: outcomes.filter(outcome => outcome.kind === 'harness-error')
      .length,
  }

  return {
    cassetteId: 'cassette-adjudicate',
    samples,
    agreement,
    ...(modal === undefined ? {} : { modalDecision: modal.identity }),
    promptDrift: { drift: false, recordedHash: 'hash', recomputedHash: 'hash' },
    replayedModel: { provider: 'test', modelId: 'gpt-5' },
    unconsumedExchanges: [],
    totalDurationMs: samples.length * 10,
  }
}

function leafOutcome(
  outcomes: readonly ReplaySampleOutcome[],
  options: { noConsensus?: boolean } = {},
): LeafReplayResult {
  return { ...decisionResult(outcomes, options), granularity: 'leaf' }
}

interface LeafFixture {
  cassette: ReturnType<typeof leafCassette>
  outcome: LeafReplayResult
  score: CassetteScore
  tie: Extract<DecisionScore, { kind: 'unresolved-tie' }>
}

function leafTieFixture(
  sidecar: CassetteSidecarLeg,
  outcome: LeafReplayResult,
): LeafFixture {
  const cassette = leafCassette({ sidecar })
  const score = scoreCassetteReplay(cassette, outcome)
  if (
    score.kind !== 'leaf' ||
    score.entry.kind !== 'decision' ||
    score.entry.score.kind !== 'unresolved-tie'
  ) {
    throw new Error('fixture expected an unresolved-tie leaf score')
  }
  return { cassette, outcome, score, tie: score.entry.score }
}

function valueTieFixture(): LeafFixture {
  return leafTieFixture(
    fillSidecar('alpha beta gamma delta'),
    leafOutcome([decisionOutcome(fillAction('alpha beta'))]),
  )
}

const partialCandidateIdentity: DecisionIdentity = {
  opClass: 'click',
  target: { ...buttonAnchor, ordinal: 2 },
}

function partialTieFixture(): LeafFixture {
  return leafTieFixture(
    buttonSidecar(),
    leafOutcome([decisionOutcome(buttonAction, partialCandidateIdentity)]),
  )
}

function adjudicatedLeafScore(result: AdjudicationResult): DecisionScore {
  const { score } = result
  if (score.kind !== 'leaf' || score.entry.kind !== 'decision') {
    throw new Error('expected an adjudicated leaf decision entry')
  }
  return score.entry.score
}

// --- scripted judge port ----------------------------------------------------

interface ScriptedPort {
  port: JudgePort
  requests: JudgeCallRequest[]
}

function scriptedPort(script: readonly JudgeCallResult[]): ScriptedPort {
  const requests: JudgeCallRequest[] = []
  const port: JudgePort = {
    judgeModelId: JUDGE_ID,
    call(request) {
      const index = requests.length
      requests.push(request)
      const answer = script[index]
      if (answer === undefined) {
        throw new Error(`unscripted judge call at index ${index}`)
      }
      return Promise.resolve(answer)
    },
  }
  return { port, requests }
}

function throwingPort(): JudgePort {
  return {
    judgeModelId: JUDGE_ID,
    call() {
      throw new Error('the judge port must never be consulted')
    },
  }
}

function verdict(
  category: 'equivalent' | 'different' | 'unsure',
  confidence: 'high' | 'medium' | 'low' = 'high',
  usage?: { calls: number; inputTokens?: number; outputTokens?: number },
): JudgeCallResult {
  return {
    kind: 'verdict',
    verdict: category,
    confidence,
    rationale: 'scripted rationale',
    ...(usage === undefined ? {} : { usage }),
  }
}

const callError: JudgeCallResult = {
  kind: 'call-error',
  reason: 'provider-error',
  detail: 'scripted provider outage',
}

// --- adjudicateCassetteScore ------------------------------------------------

describe('adjudicateCassetteScore', () => {
  it('never consults the port for settled, miss, never-scored, and skipped entries (JUDGE-01)', async () => {
    const settledCassette = leafCassette({ sidecar: buttonSidecar() })
    const settledOutcome = leafOutcome([decisionOutcome(buttonAction)])
    const settledScore = scoreCassetteReplay(settledCassette, settledOutcome)
    const settled = await adjudicateCassetteScore({
      cassette: settledCassette,
      outcome: settledOutcome,
      score: settledScore,
      eligibility: ELIGIBLE,
      port: throwingPort(),
    })
    expect(settled.score).toEqual(settledScore)

    const missCassette = leafCassette({ sidecar: buttonSidecar() })
    const missOutcome = leafOutcome([
      { kind: 'planner-failure', reason: 'step_failed', message: 'recorded failure' },
    ])
    const missScore = scoreCassetteReplay(missCassette, missOutcome)
    const miss = await adjudicateCassetteScore({
      cassette: missCassette,
      outcome: missOutcome,
      score: missScore,
      eligibility: ELIGIBLE,
      port: throwingPort(),
    })
    expect(miss.score).toEqual(missScore)

    const procCassette = procedureCassette([
      { sidecar: buttonSidecar(), receipt: { screenStateHash: 'screen-a' } },
      { sidecar: buttonSidecar(), receipt: { screenStateHash: 'screen-b' } },
    ])
    const procOutcome: ProcedureReplayResult = {
      granularity: 'procedure',
      cassetteId: procCassette.id,
      steps: [
        {
          kind: 'decision',
          stepIndex: 0,
          decisionOrdinal: 0,
          result: decisionResult([decisionOutcome(buttonAction)]),
        },
        { kind: 'skipped', stepIndex: 1, decisionOrdinal: 0, reason: 'cache-served' },
        { kind: 'skipped', stepIndex: 2, reason: 'synthesized' },
        {
          kind: 'decision',
          stepIndex: 3,
          decisionOrdinal: 0,
          result: decisionResult([
            { kind: 'harness-error', message: 'runtime failed' },
          ]),
        },
      ],
      endState: procCassette.endState,
      totalDurationMs: 20,
    }
    const procScore = scoreCassetteReplay(procCassette, procOutcome)
    const proc = await adjudicateCassetteScore({
      cassette: procCassette,
      outcome: procOutcome,
      score: procScore,
      eligibility: ELIGIBLE,
      port: throwingPort(),
    })
    expect(proc.score).toEqual(procScore)
  })

  it('stamps every tie not-invoked with the eligibility reason and changes nothing else (D-06/D-12)', async () => {
    const fixture = valueTieFixture()
    const unconfigured = await adjudicateCassetteScore({
      cassette: fixture.cassette,
      outcome: fixture.outcome,
      score: fixture.score,
      eligibility: { eligible: false, reason: 'no-judge-configured' },
    })
    const unconfiguredScore = adjudicatedLeafScore(unconfigured)
    expect(unconfiguredScore.kind).toBe('unresolved-tie')
    if (unconfiguredScore.kind !== 'unresolved-tie') return
    expect(unconfiguredScore.judgeOutcome).toEqual({
      kind: 'not-invoked',
      reason: 'no-judge-configured',
    })
    const { judgeOutcome: _outcome, ...rest } = unconfiguredScore
    expect(rest).toEqual(fixture.tie)
    expect(unconfigured.judge).toBeUndefined()

    const ineligible = assessJudgeEligibility({
      judgeModelId: 'gpt-4o-mini',
      replayedModelId: 'gpt-5',
    })
    const refused = await adjudicateCassetteScore({
      cassette: fixture.cassette,
      outcome: fixture.outcome,
      score: fixture.score,
      eligibility: ineligible,
      port: throwingPort(),
    })
    const refusedScore = adjudicatedLeafScore(refused)
    expect(refusedScore.kind).toBe('unresolved-tie')
    if (refusedScore.kind !== 'unresolved-tie') return
    expect(refusedScore.judgeOutcome).toEqual({
      kind: 'not-invoked',
      reason: 'no-eligible-judge',
      families: { judge: 'openai', replayed: 'openai' },
    })
    expect(refused.judge).toBeUndefined()

    const portless = await adjudicateCassetteScore({
      cassette: fixture.cassette,
      outcome: fixture.outcome,
      score: fixture.score,
      eligibility: ELIGIBLE,
    })
    const portlessScore = adjudicatedLeafScore(portless)
    if (portlessScore.kind !== 'unresolved-tie') return
    expect(portlessScore.judgeOutcome).toEqual({
      kind: 'not-invoked',
      reason: 'no-judge-configured',
    })
    expect(portless.judge).toBeUndefined()
  })

  it('settles an equivalent value tie on its own partial breakdown verbatim (D-01/D-02)', async () => {
    const fixture = valueTieFixture()
    const { port } = scriptedPort([
      verdict('equivalent', 'high', { calls: 1, inputTokens: 10, outputTokens: 4 }),
      verdict('equivalent', 'high', { calls: 1, inputTokens: 12, outputTokens: 6 }),
    ])
    const result = await adjudicateCassetteScore({
      cassette: fixture.cassette,
      outcome: fixture.outcome,
      score: fixture.score,
      eligibility: ELIGIBLE,
      port,
    })
    const adjudicated = adjudicatedLeafScore(result)
    expect(adjudicated.kind).toBe('scored')
    if (adjudicated.kind !== 'scored') return
    if (fixture.tie.partial === undefined) throw new Error('fixture tie lost its partial')
    expect(adjudicated.axes).toEqual(fixture.tie.partial.axes)
    expect(adjudicated.sideEffect).toEqual(fixture.tie.partial.sideEffect)
    expect(adjudicated.loop).toEqual(fixture.tie.partial.loop)
    expect(adjudicated.tierReached).toBe(fixture.tie.partial.tierReached)
    expect(adjudicated.matcherVersion).toBe(fixture.tie.matcherVersion)
    expect(adjudicated.judgeSettled).toEqual({
      axis: 'value',
      resolution: 'equivalent',
      cause: 'value-mid-band',
      judgeId: JUDGE_ID,
      judgeVersion: JUDGE_CONFIG.judgeVersion,
      confidence: 'high',
      usage: { calls: 2, inputTokens: 22, outputTokens: 10 },
    })
    expect(isDecisionFullMatch(adjudicated)).toBe(true)
  })

  it('settles an agreed different verdict as a judged miss that isDecisionFullMatch rejects', async () => {
    const valueFixture = valueTieFixture()
    const differentValue = await adjudicateCassetteScore({
      cassette: valueFixture.cassette,
      outcome: valueFixture.outcome,
      score: valueFixture.score,
      eligibility: ELIGIBLE,
      port: scriptedPort([verdict('different'), verdict('different')]).port,
    })
    const judgedMiss = adjudicatedLeafScore(differentValue)
    expect(judgedMiss.kind).toBe('scored')
    if (judgedMiss.kind !== 'scored') return
    expect(judgedMiss.judgeSettled).toMatchObject({
      axis: 'value',
      resolution: 'different',
      cause: 'value-mid-band',
    })
    expect(isDecisionFullMatch(judgedMiss)).toBe(false)

    const partialFixture = partialTieFixture()
    const settledIdentity = await adjudicateCassetteScore({
      cassette: partialFixture.cassette,
      outcome: partialFixture.outcome,
      score: partialFixture.score,
      eligibility: ELIGIBLE,
      port: scriptedPort([verdict('equivalent'), verdict('equivalent')]).port,
    })
    const identityScore = adjudicatedLeafScore(settledIdentity)
    expect(identityScore.kind).toBe('scored')
    if (identityScore.kind !== 'scored') return
    expect(identityScore.judgeSettled).toMatchObject({
      axis: 'element-identity',
      resolution: 'equivalent',
      cause: 'partial-identity',
    })
    expect(identityScore.axes.elementIdentity).toMatchObject({
      kind: 'scored',
      level: 'ordinal-only-differs',
    })
    expect(isDecisionFullMatch(identityScore)).toBe(true)
  })

  it('issues exactly two physically order-swapped calls per pairwise judgment (D-08)', async () => {
    const fixture = partialTieFixture()
    const { port, requests } = scriptedPort([
      verdict('equivalent'),
      verdict('equivalent'),
    ])
    await adjudicateCassetteScore({
      cassette: fixture.cassette,
      outcome: fixture.outcome,
      score: fixture.score,
      eligibility: ELIGIBLE,
      port,
    })

    const evidence: JudgeTieEvidence = {
      stepText: 'Click the login button',
      question: {
        kind: 'element-equivalence',
        gold: buttonAnchor,
        candidate: { ...buttonAnchor, ordinal: 2 },
      },
    }
    expect(requests).toEqual([
      buildJudgePrompt(evidence, 'ab'),
      buildJudgePrompt(evidence, 'ba'),
    ])
    expect(requests[0].order).toBe('ab')
    expect(requests[1].order).toBe('ba')
    expect(requests[0].prompt).not.toBe(requests[1].prompt)

    const disagreeing = partialTieFixture()
    const disagreement = await adjudicateCassetteScore({
      cassette: disagreeing.cassette,
      outcome: disagreeing.outcome,
      score: disagreeing.score,
      eligibility: ELIGIBLE,
      port: scriptedPort([verdict('equivalent'), verdict('different')]).port,
    })
    const stood = adjudicatedLeafScore(disagreement)
    expect(stood.kind).toBe('unresolved-tie')
    if (stood.kind !== 'unresolved-tie') return
    expect(stood.judgeOutcome).toEqual({
      kind: 'abstained',
      cause: 'swap-disagreement',
      judgeId: JUDGE_ID,
      judgeVersion: JUDGE_CONFIG.judgeVersion,
      usage: { calls: 2 },
    })
    const { judgeOutcome: _stoodOutcome, ...stoodRest } = stood
    expect(stoodRest).toEqual(disagreeing.tie)
  })

  it('abstains below the minimum confidence category and on any unsure order (D-09)', async () => {
    const belowFixture = valueTieFixture()
    const below = await adjudicateCassetteScore({
      cassette: belowFixture.cassette,
      outcome: belowFixture.outcome,
      score: belowFixture.score,
      eligibility: ELIGIBLE,
      port: scriptedPort([
        verdict('equivalent', 'medium'),
        verdict('equivalent', 'medium'),
      ]).port,
    })
    const belowScore = adjudicatedLeafScore(below)
    expect(belowScore.kind).toBe('unresolved-tie')
    if (belowScore.kind !== 'unresolved-tie') return
    expect(belowScore.judgeOutcome).toMatchObject({
      kind: 'abstained',
      cause: 'below-threshold',
      confidence: 'medium',
    })

    const mixedFixture = valueTieFixture()
    const mixed = await adjudicateCassetteScore({
      cassette: mixedFixture.cassette,
      outcome: mixedFixture.outcome,
      score: mixedFixture.score,
      eligibility: ELIGIBLE,
      port: scriptedPort([
        verdict('equivalent', 'high'),
        verdict('equivalent', 'medium'),
      ]).port,
    })
    const mixedScore = adjudicatedLeafScore(mixed)
    if (mixedScore.kind !== 'unresolved-tie') return
    expect(mixedScore.judgeOutcome).toMatchObject({
      kind: 'abstained',
      cause: 'below-threshold',
      confidence: 'medium',
    })

    const unsureFixture = valueTieFixture()
    const unsure = await adjudicateCassetteScore({
      cassette: unsureFixture.cassette,
      outcome: unsureFixture.outcome,
      score: unsureFixture.score,
      eligibility: ELIGIBLE,
      port: scriptedPort([verdict('unsure'), verdict('equivalent')]).port,
    })
    const unsureScore = adjudicatedLeafScore(unsure)
    if (unsureScore.kind !== 'unresolved-tie') return
    expect(unsureScore.judgeOutcome).toMatchObject({
      kind: 'abstained',
      cause: 'unsure-verdict',
    })
  })

  it('mints judge-error per decision without aborting sibling ties (D-11)', async () => {
    const errorFixture = valueTieFixture()
    const callErrored = await adjudicateCassetteScore({
      cassette: errorFixture.cassette,
      outcome: errorFixture.outcome,
      score: errorFixture.score,
      eligibility: ELIGIBLE,
      port: scriptedPort([callError, verdict('equivalent')]).port,
    })
    const callErrorScore = adjudicatedLeafScore(callErrored)
    expect(callErrorScore.kind).toBe('unresolved-tie')
    if (callErrorScore.kind !== 'unresolved-tie') return
    expect(callErrorScore.judgeOutcome).toMatchObject({
      kind: 'judge-error',
      reason: 'provider-error',
      detail: 'scripted provider outage',
    })

    const throwFixture = valueTieFixture()
    const thrown = await adjudicateCassetteScore({
      cassette: throwFixture.cassette,
      outcome: throwFixture.outcome,
      score: throwFixture.score,
      eligibility: ELIGIBLE,
      port: throwingPort(),
    })
    const thrownScore = adjudicatedLeafScore(thrown)
    if (thrownScore.kind !== 'unresolved-tie') return
    expect(thrownScore.judgeOutcome).toMatchObject({
      kind: 'judge-error',
      reason: 'provider-error',
    })

    const procCassette = procedureCassette([
      {
        sidecar: fillSidecar('alpha beta gamma delta'),
        receipt: { screenStateHash: 'screen-a' },
      },
      {
        sidecar: fillSidecar('alpha beta gamma delta'),
        receipt: { screenStateHash: 'screen-b' },
      },
    ])
    const procOutcome: ProcedureReplayResult = {
      granularity: 'procedure',
      cassetteId: procCassette.id,
      steps: [
        {
          kind: 'decision',
          stepIndex: 0,
          decisionOrdinal: 0,
          result: decisionResult([decisionOutcome(fillAction('alpha beta'))]),
        },
        { kind: 'skipped', stepIndex: 1, decisionOrdinal: 0, reason: 'cache-served' },
        { kind: 'skipped', stepIndex: 2, reason: 'synthesized' },
        {
          kind: 'decision',
          stepIndex: 3,
          decisionOrdinal: 0,
          result: decisionResult([decisionOutcome(fillAction('alpha beta'))]),
        },
      ],
      endState: procCassette.endState,
      totalDurationMs: 20,
    }
    const procScore = scoreCassetteReplay(procCassette, procOutcome)
    const proc = await adjudicateCassetteScore({
      cassette: procCassette,
      outcome: procOutcome,
      score: procScore,
      eligibility: ELIGIBLE,
      port: scriptedPort([
        callError,
        callError,
        verdict('equivalent'),
        verdict('equivalent'),
      ]).port,
    })
    expect(proc.score.kind).toBe('procedure')
    if (proc.score.kind !== 'procedure') return
    const [first, , , last] = proc.score.entries
    expect(first.kind).toBe('decision')
    if (first.kind !== 'decision' || first.score.kind !== 'unresolved-tie') {
      throw new Error('expected the first tie to survive with a judge-error stamp')
    }
    expect(first.score.judgeOutcome).toMatchObject({
      kind: 'judge-error',
      reason: 'provider-error',
    })
    expect(last.kind).toBe('decision')
    if (last.kind !== 'decision' || last.score.kind !== 'scored') {
      throw new Error('expected the second tie to settle')
    }
    expect(last.score.judgeSettled).toMatchObject({
      axis: 'value',
      resolution: 'equivalent',
    })
  })

  it('judges no-consensus candidates pairwise against gold, bounded and honest (D-03)', async () => {
    const candidateA: DecisionIdentity = {
      opClass: 'click',
      target: { ...buttonAnchor, ordinal: 2 },
    }
    const candidateB: DecisionIdentity = {
      opClass: 'click',
      target: { role: 'link', nameNormalized: 'sign in', ordinal: 0 },
    }
    const twoCandidates = leafTieFixture(
      buttonSidecar(),
      leafOutcome(
        [
          decisionOutcome(buttonAction, candidateA),
          decisionOutcome(buttonAction, candidateB),
        ],
        { noConsensus: true },
      ),
    )

    const survivorB = await adjudicateCassetteScore({
      cassette: twoCandidates.cassette,
      outcome: twoCandidates.outcome,
      score: twoCandidates.score,
      eligibility: ELIGIBLE,
      port: scriptedPort([
        verdict('different'),
        verdict('different'),
        verdict('equivalent'),
        verdict('equivalent'),
      ]).port,
    })
    const settledOnB = adjudicatedLeafScore(survivorB)
    expect(settledOnB.kind).toBe('scored')
    if (settledOnB.kind !== 'scored') return
    expect(settledOnB.axes.elementIdentity).toEqual({
      kind: 'scored',
      level: 'miss',
      numeric: MATCHER_CONFIG.identityLadder.miss,
      tier: 2,
    })
    expect(settledOnB.judgeSettled).toEqual({
      axis: 'element-identity',
      resolution: 'equivalent',
      cause: 'no-consensus',
      judgeId: JUDGE_ID,
      judgeVersion: JUDGE_CONFIG.judgeVersion,
      confidence: 'high',
      usage: { calls: 4 },
    })
    expect(isDecisionFullMatch(settledOnB)).toBe(true)

    const allDifferent = await adjudicateCassetteScore({
      cassette: twoCandidates.cassette,
      outcome: twoCandidates.outcome,
      score: twoCandidates.score,
      eligibility: ELIGIBLE,
      port: scriptedPort([
        verdict('different'),
        verdict('different'),
        verdict('different'),
        verdict('different'),
      ]).port,
    })
    const judgedMiss = adjudicatedLeafScore(allDifferent)
    expect(judgedMiss.kind).toBe('scored')
    if (judgedMiss.kind !== 'scored') return
    expect(judgedMiss.judgeSettled).toMatchObject({
      axis: 'element-identity',
      resolution: 'different',
      cause: 'no-consensus',
    })
    expect(judgedMiss.axes.elementIdentity).toMatchObject({
      kind: 'scored',
      level: 'ordinal-only-differs',
    })
    expect(isDecisionFullMatch(judgedMiss)).toBe(false)

    const residual = await adjudicateCassetteScore({
      cassette: twoCandidates.cassette,
      outcome: twoCandidates.outcome,
      score: twoCandidates.score,
      eligibility: ELIGIBLE,
      port: scriptedPort([verdict('equivalent'), verdict('equivalent')]).port,
    })
    const residualScore = adjudicatedLeafScore(residual)
    expect(residualScore.kind).toBe('unresolved-tie')
    if (residualScore.kind !== 'unresolved-tie') return
    expect(residualScore.judgeOutcome).toMatchObject({
      kind: 'abstained',
      cause: 'residual-tie',
    })

    const mixed = await adjudicateCassetteScore({
      cassette: twoCandidates.cassette,
      outcome: twoCandidates.outcome,
      score: twoCandidates.score,
      eligibility: ELIGIBLE,
      port: scriptedPort([
        verdict('unsure'),
        verdict('equivalent'),
        verdict('different'),
        verdict('different'),
      ]).port,
    })
    const mixedScore = adjudicatedLeafScore(mixed)
    if (mixedScore.kind !== 'unresolved-tie') return
    expect(mixedScore.judgeOutcome).toMatchObject({
      kind: 'abstained',
      cause: 'unsure-verdict',
    })

    const overflowIdentities: DecisionIdentity[] = [0, 1, 2, 3].map(ordinal => ({
      opClass: 'click',
      target: { ...buttonAnchor, ordinal: ordinal + 1 },
    }))
    const overflow = leafTieFixture(
      buttonSidecar(),
      leafOutcome(
        overflowIdentities.map(identity => decisionOutcome(buttonAction, identity)),
        { noConsensus: true },
      ),
    )
    const overflowed = await adjudicateCassetteScore({
      cassette: overflow.cassette,
      outcome: overflow.outcome,
      score: overflow.score,
      eligibility: ELIGIBLE,
      port: throwingPort(),
    })
    const overflowScore = adjudicatedLeafScore(overflowed)
    expect(overflowScore.kind).toBe('unresolved-tie')
    if (overflowScore.kind !== 'unresolved-tie') return
    expect(overflowScore.judgeOutcome).toEqual({
      kind: 'abstained',
      cause: 'candidate-overflow',
      judgeId: JUDGE_ID,
      judgeVersion: JUDGE_CONFIG.judgeVersion,
    })
  })

  it('recomputes the procedure summary over adjudicated entries (D-01)', async () => {
    const procCassette = procedureCassette([
      {
        sidecar: fillSidecar('alpha beta gamma delta'),
        receipt: { screenStateHash: 'screen-a' },
      },
      { sidecar: buttonSidecar(), receipt: { screenStateHash: 'screen-b' } },
    ])
    const procOutcome: ProcedureReplayResult = {
      granularity: 'procedure',
      cassetteId: procCassette.id,
      steps: [
        {
          kind: 'decision',
          stepIndex: 0,
          decisionOrdinal: 0,
          result: decisionResult([decisionOutcome(fillAction('alpha beta'))]),
        },
        { kind: 'skipped', stepIndex: 1, decisionOrdinal: 0, reason: 'cache-served' },
        { kind: 'skipped', stepIndex: 2, reason: 'synthesized' },
        {
          kind: 'decision',
          stepIndex: 3,
          decisionOrdinal: 0,
          result: decisionResult([decisionOutcome(buttonAction)]),
        },
      ],
      endState: procCassette.endState,
      totalDurationMs: 20,
    }
    const procScore = scoreCassetteReplay(procCassette, procOutcome)
    expect(procScore.kind).toBe('procedure')
    if (procScore.kind !== 'procedure') return
    expect(procScore.summary).toEqual({
      stepsMatchedFraction: 0.5,
      firstDivergentStepIndex: 0,
      endState: procCassette.endState,
    })

    const result = await adjudicateCassetteScore({
      cassette: procCassette,
      outcome: procOutcome,
      score: procScore,
      eligibility: ELIGIBLE,
      port: scriptedPort([verdict('equivalent'), verdict('equivalent')]).port,
    })
    expect(result.score.kind).toBe('procedure')
    if (result.score.kind !== 'procedure') return
    expect(result.score.summary).toEqual({
      stepsMatchedFraction: 1,
      endState: procCassette.endState,
    })
    expect(Object.hasOwn(result.score.summary, 'firstDivergentStepIndex')).toBe(false)
  })

  it('returns the judge identity block exactly when the eligible path ran (D-16)', async () => {
    const fixture = valueTieFixture()
    const eligible = await adjudicateCassetteScore({
      cassette: fixture.cassette,
      outcome: fixture.outcome,
      score: fixture.score,
      eligibility: ELIGIBLE,
      port: scriptedPort([verdict('equivalent'), verdict('equivalent')]).port,
    })
    expect(eligible.judge).toEqual({
      judgeModelId: JUDGE_ID,
      judgeFamily: 'claude',
      judgeVersion: JUDGE_CONFIG.judgeVersion,
      confidenceThreshold: JUDGE_CONFIG.confidenceThreshold,
    })

    const ineligible = await adjudicateCassetteScore({
      cassette: fixture.cassette,
      outcome: fixture.outcome,
      score: fixture.score,
      eligibility: { eligible: false, reason: 'no-judge-configured' },
    })
    expect(ineligible.judge).toBeUndefined()

    const portless = await adjudicateCassetteScore({
      cassette: fixture.cassette,
      outcome: fixture.outcome,
      score: fixture.score,
      eligibility: ELIGIBLE,
    })
    expect(portless.judge).toBeUndefined()
  })
})
