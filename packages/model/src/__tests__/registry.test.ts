import { APICallError } from '@ai-sdk/provider'
import { beforeEach, describe, expect, it } from 'vitest'

import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { ModelCapabilities, ModelProfile, ModelProviderId } from '@vostride/agent-qa-schema'

import { capabilityKey, overrideStore } from '../capability/override-store.js'
import { resolveCapabilities } from '../capability/resolve.js'
import { createModel } from '../registry.js'
import type { ResolvedModelAuth } from '../auth.js'

interface RegistryCase {
  provider: ModelProviderId
  modelId: string
  expectedProvider: string
  baseURL?: string
  headers?: Record<string, string>
}

const noneAuth: ResolvedModelAuth = { kind: 'none' }

function profile(testCase: RegistryCase): ModelProfile {
  return {
    provider: testCase.provider,
    model: testCase.modelId,
    ...(testCase.baseURL ? { baseURL: testCase.baseURL } : {}),
    ...(testCase.headers ? { headers: testCase.headers } : {}),
    auth: { mode: 'none' },
  }
}

function fakeLanguageModel(onGenerate: (params: LanguageModelV3CallOptions) => void): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'override.test',
    modelId: 'override-model',
    supportedUrls: {},
    async doGenerate(params) {
      onGenerate(params)
      return {
        content: [],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 0, text: 0, reasoning: 0 },
        },
        warnings: [],
      }
    },
    async doStream() {
      return { stream: new ReadableStream() }
    },
  }
}

function apiError(message: string): APICallError {
  return new APICallError({
    message,
    url: 'http://localhost/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 400,
    responseHeaders: {},
    responseBody: '',
    isRetryable: false,
  })
}

describe('createModel', () => {
  beforeEach(() => {
    overrideStore.clear()
  })

  it('resolves a v3 model for each built-in provider through the registry', () => {
    const cases: RegistryCase[] = [
      {
        provider: 'openai-compatible',
        modelId: 'local-chat-model',
        expectedProvider: 'openai.chat',
        baseURL: 'http://localhost:11434/v1',
      },
      {
        provider: 'openai-subscription',
        modelId: 'gpt-5.1',
        expectedProvider: 'openai.responses',
      },
      {
        provider: 'anthropic-compatible',
        modelId: 'claude-local',
        expectedProvider: 'anthropic.messages',
        baseURL: 'http://localhost:8080',
        headers: { 'x-routing-key': 'local' },
      },
      {
        provider: 'anthropic-subscription',
        modelId: 'claude-sonnet-4-5',
        expectedProvider: 'anthropic.messages',
      },
      {
        provider: 'gemini',
        modelId: 'gemini-2.5-flash',
        expectedProvider: 'google.generative-ai',
      },
    ]

    for (const testCase of cases) {
      const model = createModel(profile(testCase), noneAuth)

      expect(model.specificationVersion).toBe('v3')
      expect(model.provider).toBe(testCase.expectedProvider)
      expect(model.modelId).toBe(testCase.modelId)
    }
  })

  it('throws a supported-providers error for unknown provider ids', () => {
    const invalidProfile: ModelProfile = {
      provider: 'unknown-provider' as ModelProviderId,
      model: 'model-id',
      auth: { mode: 'none' },
    }

    expect(() => createModel(invalidProfile, noneAuth)).toThrow(
      /Unknown provider "unknown-provider".*openai-compatible.*gemini/,
    )
  })

  it('applies tool schema middleware centrally through the registry', async () => {
    let captured: LanguageModelV3CallOptions | undefined
    const model = createModel(
      {
        provider: 'openai-compatible',
        model: 'override-model',
        baseURL: 'http://localhost:11434/v1',
        auth: { mode: 'none' },
      },
      noneAuth,
      {
        languageModels: {
          'override-model': fakeLanguageModel((params) => {
            captured = params
          }),
        },
      },
    )

    await model.doGenerate({
      prompt: [],
      tools: [
        {
          type: 'function',
          name: 'probe',
          inputSchema: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            properties: {},
          },
        },
      ],
    })

    const transformedTool = captured?.tools?.[0]
    expect(transformedTool?.type).toBe('function')
    if (!transformedTool || transformedTool.type !== 'function') {
      throw new Error('Expected a transformed function tool')
    }

    expect(transformedTool).toMatchObject({
      type: 'function',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    })
    expect(transformedTool.inputSchema).not.toHaveProperty('$schema')
  })

  it('auto-fills capabilities when absent and preserves declared capabilities', () => {
    const autoProfile = profile({
      provider: 'openai-compatible',
      modelId: 'gpt-4o',
      expectedProvider: 'openai.chat',
      baseURL: 'http://localhost:11434/v1',
    })
    const expected = resolveCapabilities(autoProfile)

    createModel(autoProfile, noneAuth)

    expect(autoProfile.capabilities).toEqual(expected)

    const declared: ModelCapabilities = {
      text: true,
      vision: false,
      visionToolMessages: false,
      toolCalling: true,
      structuredOutput: true,
      streaming: true,
      contextWindow: 12345,
      maxOutput: 2048,
    }
    const declaredProfile = profile({
      provider: 'openai-compatible',
      modelId: 'gpt-4o',
      expectedProvider: 'openai.chat',
      baseURL: 'http://localhost:11434/v1',
    })
    declaredProfile.capabilities = declared

    createModel(declaredProfile, noneAuth)

    expect(declaredProfile.capabilities).toBe(declared)
  })

  it('records un-retried overflow through the full registry stack', async () => {
    let calls = 0
    const modelProfile = profile({
      provider: 'openai-compatible',
      modelId: 'override-model',
      expectedProvider: 'override.test',
      baseURL: 'http://localhost:11434/v1',
    })
    const overflow = apiError(
      "This model's maximum context length is 32768 tokens. However, you requested 40000 tokens",
    )
    const model = createModel(modelProfile, noneAuth, {
      languageModels: {
        'override-model': {
          ...fakeLanguageModel(() => {
            calls += 1
            throw overflow
          }),
          async doGenerate(params) {
            calls += 1
            throw overflow
          },
        },
      },
    })

    await expect(model.doGenerate({ prompt: [] })).rejects.toBe(overflow)

    expect(calls).toBe(1)
    expect(overrideStore.get(capabilityKey(modelProfile.provider, modelProfile.model))).toBe(32768)
  })
})
