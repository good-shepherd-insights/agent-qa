import { describe, expect, it } from 'vitest'

import { assessJudgeEligibility } from '../adjudicate'
import { assessPanelEligibility, createPanelIdentity, poolPanel } from '../panel'
import type { PanelMemberOutcome } from '../panel'
import type { JudgePairwiseOutcome } from '../../match/score'

describe('assessPanelEligibility', () => {
  it('discloses the same canonical first offending pair for shuffled declarations', () => {
    const expected = {
      eligible: false,
      reason: 'no-eligible-judge',
      families: {
        replayed: 'claude', recorded: 'openai',
        members: [
          { judgeModelId: 'claude-judge', judgeFamily: 'claude' },
          { judgeModelId: 'gpt-judge', judgeFamily: 'openai' },
        ],
        offendingPair: ['claude-judge', 'claude-planner'],
      },
    }
    for (const memberModelIds of [['gpt-judge', 'claude-judge'], ['claude-judge', 'gpt-judge']]) {
      expect(assessPanelEligibility({ memberModelIds, replayedModelId: 'claude-planner',
        recordedModelId: 'gpt-recorded', allowSameFamily: true })).toEqual(expected)
    }
  })

  it.each([
    ['deepseek-r1-distill-llama-70b', 'deepseek-r1'],
    ['deepseek-r1-distill-llama-70b', 'llama-3.3'],
    ['deepseek-r1-distill-qwen-32b', 'deepseek-r1'],
    ['deepseek-r1-distill-qwen-32b', 'qwen2.5'],
  ])('refuses %s against %s on all three sides', (distill, parent) => {
    const inputs = [
      { memberModelIds: [distill, 'claude-judge'], replayedModelId: parent },
      { memberModelIds: [distill, 'claude-judge'], replayedModelId: 'gpt-5', recordedModelId: parent },
      { memberModelIds: [distill, parent], replayedModelId: 'gpt-5' },
      { memberModelIds: [parent, 'claude-judge'], replayedModelId: distill },
      { memberModelIds: [parent, 'claude-judge'], replayedModelId: 'gpt-5', recordedModelId: distill },
    ]
    for (const input of inputs) {
      expect(assessPanelEligibility({ ...input, allowSameFamily: true })).toMatchObject({
        eligible: false, reason: 'no-eligible-judge',
      })
      expect(assessPanelEligibility(input)).not.toHaveProperty('familyOverride')
    }
  })

  it.each([
    { memberModelIds: ['unknown', 'claude'], replayedModelId: 'gpt' },
    { memberModelIds: ['gemini', 'claude'], replayedModelId: 'unknown' },
    { memberModelIds: ['gemini', 'claude'], replayedModelId: 'gpt', recordedModelId: 'unknown' },
  ])('refuses unknown identities even with override: %j', input => {
    expect(assessPanelEligibility({ ...input, allowSameFamily: true })).toMatchObject({
      eligible: false, reason: 'no-eligible-judge',
    })
  })

  it('skips only absent recorded identity and keeps the whole eligible declaration', () => {
    const input = { memberModelIds: ['gemini', 'claude'], replayedModelId: 'gpt' }
    expect(assessPanelEligibility(input)).toEqual({ eligible: true, ...createPanelIdentity(input.memberModelIds) })
    expect(assessPanelEligibility({ ...input, recordedModelId: 'qwen' })).toEqual(assessPanelEligibility(input))
    expect(assessPanelEligibility({ ...input, recordedModelId: 'gemini' })).toMatchObject({ eligible: false })
  })

  it('refuses duplicate resolved alias IDs without deduplication', () => {
    expect(assessPanelEligibility({ memberModelIds: ['claude', 'claude'], replayedModelId: 'gpt' }))
      .toMatchObject({ eligible: false, families: {
        members: [{ judgeModelId: 'claude' }, { judgeModelId: 'claude' }],
        offendingPair: ['claude', 'claude'],
      } })
  })

  it('normalizes singleton before interpreting the explicit override', () => {
    for (const judgeModelId of ['gpt-judge', 'claude', 'unknown']) {
      for (const allowSameFamily of [undefined, false, true]) {
        const input = { replayedModelId: 'gpt-planner', recordedModelId: 'claude', allowSameFamily }
        expect(assessPanelEligibility({ ...input, memberModelIds: [judgeModelId] }))
          .toStrictEqual(assessJudgeEligibility({ ...input, judgeModelId }))
      }
    }
    expect(assessPanelEligibility({ memberModelIds: [], replayedModelId: 'gpt' }))
      .toEqual({ eligible: false, reason: 'no-judge-configured' })
  })

  it('caps live declarations at three even when four families are disjoint', () => {
    expect(assessPanelEligibility({ memberModelIds: ['claude', 'gemini', 'llama', 'qwen'],
      replayedModelId: 'gpt' })).toMatchObject({ eligible: false, reason: 'no-eligible-judge' })
  })
})

describe('createPanelIdentity', () => {
  it('escapes component separators and literal percent encodings without collisions', () => {
    expect(createPanelIdentity(['claude+a', 'gemini/b']).judgeModelId)
      .toBe('panel:claude%2Ba+gemini%2Fb')
    expect(createPanelIdentity(['claude%2Ba', 'gemini/b']).judgeModelId)
      .toBe('panel:claude%252Ba+gemini%2Fb')
    expect(createPanelIdentity(['a+b', 'c']).judgeModelId)
      .not.toBe(createPanelIdentity(['a', 'b+c']).judgeModelId)
  })

  it('sorts by Unicode code point, independent of locale or UTF-16 ordering', () => {
    const ids = ['𐀀/claude', '\uE000/gemini', 'a/qwen', 'Z/llama']
    const identity = createPanelIdentity(ids)
    expect(identity.members?.map(member => member.judgeModelId))
      .toEqual(['Z/llama', 'a/qwen', '\uE000/gemini', '𐀀/claude'])
    expect(createPanelIdentity([...ids].reverse())).toEqual(identity)
  })
})

const equivalent: JudgePairwiseOutcome = { kind: 'settled', resolution: 'equivalent', confidence: 'high' }
const different: JudgePairwiseOutcome = { kind: 'settled', resolution: 'different', confidence: 'high' }
const unsure: JudgePairwiseOutcome = { kind: 'abstained', cause: 'unsure-verdict' }
const error: JudgePairwiseOutcome = { kind: 'error', reason: 'provider-error', detail: 'fixture error' }

function members(outcomes: readonly JudgePairwiseOutcome[]): PanelMemberOutcome[] {
  return outcomes.map((outcome, index) => ({ judgeModelId: `claude-fixture-${index}`,
    judgeFamily: 'claude', outcome, usage: { calls: 2, inputTokens: 10, outputTokens: 5 } }))
}

describe('poolPanel verdict majority', () => {
  it.each<{ name: string; outcomes: JudgePairwiseOutcome[]; expected: JudgePairwiseOutcome }>([
    { name: '2:0', outcomes: [equivalent, equivalent], expected: equivalent },
    { name: '0:2', outcomes: [different, different], expected: different },
    { name: '2:1', outcomes: [equivalent, equivalent, different], expected: equivalent },
    { name: '1:2', outcomes: [equivalent, different, different], expected: different },
    { name: '1:1', outcomes: [equivalent, different], expected: { kind: 'abstained', cause: 'panel-disagreement' } },
    { name: '2:2 pure law only', outcomes: [equivalent, different, equivalent, different], expected: { kind: 'abstained', cause: 'panel-disagreement' } },
    { name: 'zero members', outcomes: [], expected: { kind: 'abstained', cause: 'below-quorum' } },
    { name: 'zero settled', outcomes: [unsure, unsure], expected: { kind: 'abstained', cause: 'below-quorum' } },
    { name: 'one settled plus error', outcomes: [equivalent, error], expected: { kind: 'abstained', cause: 'below-quorum' } },
    { name: 'two settled plus abstention', outcomes: [equivalent, unsure, equivalent], expected: equivalent },
    { name: 'two settled plus error', outcomes: [different, error, different], expected: different },
    { name: 'all errors', outcomes: [error, error, error], expected: { kind: 'abstained', cause: 'below-quorum' } },
  ])('$name is independent of declaration order', ({ outcomes, expected }) => {
    expect(poolPanel(members(outcomes))).toEqual(expected)
    expect(poolPanel(members([...outcomes].reverse()), 'max')).toEqual(expected)
    expect(poolPanel(members([...outcomes.slice(1), ...outcomes.slice(0, 1)]))).toEqual(expected)
  })

  it('uses the minimum majority confidence without adding dissenting confidence', () => {
    const medium: JudgePairwiseOutcome = { ...equivalent, confidence: 'medium' }
    const lowDissent: JudgePairwiseOutcome = { ...different, confidence: 'low' }
    for (const outcomes of [[medium, equivalent, lowDissent], [lowDissent, equivalent, medium]]) {
      expect(poolPanel(members(outcomes))).toEqual(medium)
    }
    expect(poolPanel(members([{ ...different, confidence: 'low' }, different, equivalent])))
      .toEqual({ ...different, confidence: 'low' })
  })

  it('retains original settled, abstained and error outcomes with all incurred usage', () => {
    const input = members([equivalent, unsure, error])
    const before = structuredClone(input)
    poolPanel(input)
    expect(input).toStrictEqual(before)
    expect(input.map(member => member.outcome)).toEqual([equivalent, unsure, error])
    expect(input.map(member => member.usage)).toEqual([
      { calls: 2, inputTokens: 10, outputTokens: 5 },
      { calls: 2, inputTokens: 10, outputTokens: 5 },
      { calls: 2, inputTokens: 10, outputTokens: 5 },
    ])
  })
})

describe('poolPanel reserved numeric average', () => {
  it.each([
    { scores: [0, 0], expected: 0 },
    { scores: [1, 1], expected: 1 },
    { scores: [0, 1], expected: 0.5 },
    { scores: [0.2, 0.4, 0.9], expected: 0.5 },
  ])('averages $scores to $expected', ({ scores, expected }) => {
    expect(poolPanel(scores, 'avg')).toBeCloseTo(expected, 14)
    expect(poolPanel([...scores].reverse(), 'avg')).toBeCloseTo(expected, 14)
  })

  it.each([[], [0], [0.5], [1]])('requires two numeric scores: %j', (...scores) => {
    expect(poolPanel(scores, 'avg')).toEqual({ kind: 'abstained', cause: 'below-quorum' })
  })

  it.each([NaN, Infinity, -Infinity, -0.01, 1.01])('rejects invalid score %s explicitly', score => {
    expect(poolPanel([0.5, score], 'avg')).toEqual({ kind: 'invalid-input', reason: 'invalid-score', index: 1 })
    expect(poolPanel([score], 'avg')).toEqual({ kind: 'invalid-input', reason: 'invalid-score', index: 0 })
  })
})
