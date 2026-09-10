import { describe, expect, it } from 'vitest'

import { assessJudgeEligibility } from '../adjudicate'
import { assessPanelEligibility, createPanelIdentity } from '../panel'

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
