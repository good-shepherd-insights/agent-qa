import { beforeEach, describe, expect, it } from 'vitest'

import { matchFamily, UNKNOWN_FLOOR } from '../capability/family-table.js'
import { capabilityKey, getObservedWindow, overrideStore } from '../capability/override-store.js'

describe('matchFamily', () => {
  it('resolves Claude Sonnet to the Anthropic vision tool-message capable family', () => {
    expect(matchFamily('claude-sonnet-4-5')).toMatchObject({
      contextWindow: 200000,
      maxOutput: 32000,
      vision: true,
      visionToolMessages: true,
      text: true,
      toolCalling: true,
      structuredOutput: true,
      streaming: true,
    })
  })

  it('keeps gpt-4o distinct from gpt-4 and the gpt catch-all', () => {
    expect(matchFamily('gpt-4o-2024-08-06')).toMatchObject({
      contextWindow: 128000,
      vision: true,
      visionToolMessages: false,
    })
    expect(matchFamily('gpt-4-0613')).toMatchObject({
      contextWindow: 8192,
      vision: false,
      visionToolMessages: false,
    })
    expect(matchFamily('gpt-4.1-mini')).toMatchObject({
      contextWindow: 1047576,
      vision: true,
      visionToolMessages: false,
    })
  })

  it('does not classify ids that only incidentally contain family tokens', () => {
    expect(matchFamily('turbo3')).toBeUndefined()
    expect(matchFamily('supervision-7b')).toBeUndefined()
    expect(matchFamily('my-vl-7b')).toBeUndefined()
  })

  it('still resolves real families whose tokens sit at a segment boundary', () => {
    expect(matchFamily('o3-mini')).toMatchObject({ contextWindow: 200000 })
    expect(matchFamily('qwen2.5-vl')).toMatchObject({ vision: true })
  })

  it('returns undefined for unknown model ids so callers can apply the floor', () => {
    expect(matchFamily('totally-unknown-model')).toBeUndefined()
    expect(UNKNOWN_FLOOR).toEqual({
      text: true,
      vision: false,
      visionToolMessages: false,
      toolCalling: true,
      structuredOutput: true,
      streaming: true,
      contextWindow: 8192,
      maxOutput: 4096,
    })
  })
})

describe('override store', () => {
  beforeEach(() => {
    overrideStore.clear()
  })

  it('normalizes provider and model into a stable capability key', () => {
    expect(capabilityKey('openai-compatible', '  GPT-4o  ')).toBe('openai-compatible:gpt-4o')
  })

  it('returns undefined for unset observed windows', () => {
    expect(getObservedWindow('openai-compatible:gpt-4o')).toBeUndefined()
  })
})
