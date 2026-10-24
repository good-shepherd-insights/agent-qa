import { beforeEach, describe, expect, it } from 'vitest'

import type { ModelCapabilities, ModelProfile } from '@vostride/agent-qa-schema'

import { capabilityKey, overrideStore } from '../capability/override-store.js'
import { resolveCapabilities } from '../capability/resolve.js'

function profile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    provider: 'anthropic-subscription',
    model: 'claude-sonnet-4-5',
    auth: { mode: 'subscription', plugin: 'anthropic' },
    ...overrides,
  }
}

describe('resolveCapabilities', () => {
  beforeEach(() => {
    overrideStore.clear()
  })

  it('resolves a known model id to the full 8-field set', () => {
    expect(resolveCapabilities(profile())).toEqual({
      text: true,
      vision: true,
      visionToolMessages: true,
      toolCalling: true,
      structuredOutput: true,
      streaming: true,
      contextWindow: 200000,
      maxOutput: 32000,
    })
  })

  it('falls back to the conservative floor for unknown models', () => {
    expect(resolveCapabilities(profile({
      provider: 'openai-compatible',
      model: 'mystery-local-7b',
      baseURL: 'http://localhost:11434/v1',
      auth: { mode: 'none' },
    }))).toEqual({
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

  it('keeps vision and visionToolMessages distinct', () => {
    const resolved = resolveCapabilities(profile({
      provider: 'openai-subscription',
      model: 'gpt-4o',
      auth: { mode: 'subscription', plugin: 'openai' },
    }))

    expect(resolved.vision).toBe(true)
    expect(resolved.visionToolMessages).toBe(false)
  })

  it('lets explicit capabilities override family-table bits', () => {
    const capabilities: ModelCapabilities = {
      text: true,
      vision: false,
      visionToolMessages: false,
      toolCalling: true,
      structuredOutput: true,
      streaming: true,
      contextWindow: 12345,
      maxOutput: 2048,
    }

    expect(resolveCapabilities(profile({ capabilities }))).toEqual(capabilities)
  })

  it('applies observed context windows last', () => {
    const capabilities: ModelCapabilities = {
      text: true,
      vision: false,
      visionToolMessages: false,
      toolCalling: true,
      structuredOutput: true,
      streaming: true,
      contextWindow: 12345,
      maxOutput: 2048,
    }
    const modelProfile = profile({ capabilities })
    overrideStore.set(capabilityKey(modelProfile.provider, modelProfile.model), 177777)

    expect(resolveCapabilities(modelProfile)).toEqual({
      ...capabilities,
      contextWindow: 177777,
    })
  })
})
