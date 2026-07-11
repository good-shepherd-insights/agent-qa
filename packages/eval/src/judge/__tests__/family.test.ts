import { describe, expect, it } from 'vitest'

import { resolveJudgeFamily } from '../family'

describe('resolveJudgeFamily', () => {
  it('resolves known families across real BYOM id shapes', () => {
    expect(resolveJudgeFamily('claude-sonnet-4-5')).toBe('claude')
    expect(resolveJudgeFamily('us.anthropic.claude-opus-4')).toBe('claude')
    // gpt-* and the o-series are ONE openai family (Pitfall 6): near-siblings never self-judge.
    expect(resolveJudgeFamily('gpt-4o-mini')).toBe('openai')
    expect(resolveJudgeFamily('gpt-5')).toBe('openai')
    expect(resolveJudgeFamily('o3-mini')).toBe('openai')
    expect(resolveJudgeFamily('openrouter/deepseek-r1')).toBe('deepseek')
    expect(resolveJudgeFamily('gemini-2.5-pro')).toBe('gemini')
    expect(resolveJudgeFamily('qwen2.5-72b-instruct')).toBe('qwen')
    expect(resolveJudgeFamily('mixtral-8x7b')).toBe('mistral')
    expect(resolveJudgeFamily('llama-3.3-70b')).toBe('llama')
  })

  it('resolves unknown ids to undefined — unknown is forbidden downstream, never a guess', () => {
    expect(resolveJudgeFamily('this-model-does-not-exist')).toBeUndefined()
    // The replay test fixtures' stub model id shape must never resolve to a family.
    expect(resolveJudgeFamily('fixture-planner')).toBeUndefined()
  })

  it('matches tokens only at boundaries', () => {
    // A family token embedded mid-word without a boundary prefix does NOT match.
    expect(resolveJudgeFamily('megaclaude')).toBeUndefined()
    expect(resolveJudgeFamily('notgpt-model')).toBeUndefined()
    // Position 0 and every boundary char ('-','_','.','/',':') DO match.
    expect(resolveJudgeFamily('claude')).toBe('claude')
    expect(resolveJudgeFamily('vendor:gpt-4')).toBe('openai')
    expect(resolveJudgeFamily('x_llama')).toBe('llama')
    expect(resolveJudgeFamily('a.o3')).toBe('openai')
    expect(resolveJudgeFamily('acme/qwen-7b')).toBe('qwen')
  })

  it('resolves case-insensitively', () => {
    expect(resolveJudgeFamily('Claude-Sonnet-4-5')).toBe('claude')
    expect(resolveJudgeFamily('GPT-4O-MINI')).toBe('openai')
    expect(resolveJudgeFamily('US.Anthropic.CLAUDE-OPUS-4')).toBe('claude')
  })
})
