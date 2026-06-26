import { describe, expect, it } from 'vitest'

import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { ModelProfile, ModelProviderId } from '@vostride/agent-qa-schema'

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

describe('createModel', () => {
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
})
