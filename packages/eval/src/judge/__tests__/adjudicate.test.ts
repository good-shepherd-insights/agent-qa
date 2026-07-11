import { describe, expect, it } from 'vitest'

import { assessJudgeEligibility } from '../adjudicate'

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
