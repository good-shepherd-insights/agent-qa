import { APICallError } from '@ai-sdk/provider'
import { simulateReadableStream } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { ModelCapabilities, ModelProfile, ModelProviderId } from '@vostride/agent-qa-schema'
import {
  createMaskingContext,
  GuardrailBlockError,
  setActiveMaskingContextResolver,
} from '@vostride/agent-qa-safety'

import { capabilityKey, overrideStore } from '../capability/override-store.js'
import { resolveCapabilities } from '../capability/resolve.js'
import { createModel } from '../registry.js'
import { getProvider } from '../providers/registry.js'
import type { ResolvedModelAuth } from '../auth.js'

interface RegistryCase {
  provider: ModelProviderId
  modelId: string
  expectedProvider: string
  baseURL?: string
  headers?: Record<string, string>
}

const noneAuth: ResolvedModelAuth = { kind: 'none' }
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'
const BEARER = 'Bearer abcdefghijklmno12345'

type StreamPart = Awaited<ReturnType<LanguageModelV3['doStream']>>['stream'] extends ReadableStream<
  infer Part
>
  ? Part
  : never

function profile(testCase: RegistryCase): ModelProfile {
  return {
    provider: testCase.provider,
    model: testCase.modelId,
    ...(testCase.baseURL ? { baseURL: testCase.baseURL } : {}),
    ...(testCase.headers ? { headers: testCase.headers } : {}),
    auth: { mode: 'none' },
  }
}

function fakeLanguageModel(
  onGenerate: (params: LanguageModelV3CallOptions) => void,
  streamChunks: StreamPart[] = [],
): LanguageModelV3 {
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
      return {
        stream: simulateReadableStream({
          chunks: streamChunks,
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      }
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

function overrideProfile(): ModelProfile {
  return {
    provider: 'openai-compatible',
    model: 'override-model',
    baseURL: 'http://localhost:11434/v1',
    auth: { mode: 'none' },
  }
}

function promptWithUserText(text: string): LanguageModelV3CallOptions['prompt'] {
  return [
    {
      role: 'user',
      content: [{ type: 'text', text }],
    },
  ] as LanguageModelV3CallOptions['prompt']
}

function capturedUserText(params: LanguageModelV3CallOptions | undefined): string {
  const message = params?.prompt[0]
  const part = message?.role === 'user' ? message.content[0] : undefined

  if (!part || part.type !== 'text') {
    throw new Error('expected a transformed user text prompt part')
  }

  return part.text
}

function textDelta(delta: string): StreamPart {
  return { type: 'text-delta', id: 'text-1', delta } as StreamPart
}

async function collectStreamText(stream: ReadableStream<StreamPart>): Promise<string> {
  const reader = stream.getReader()
  let output = ''

  for (;;) {
    const result = await reader.read()
    if (result.done) break

    if (result.value.type === 'text-delta') {
      output += result.value.delta
    }
  }

  return output
}

describe('createModel', () => {
  afterEach(() => vi.restoreAllMocks())
  beforeEach(() => {
    overrideStore.clear()
    setActiveMaskingContextResolver(() => undefined)
  })

  it('observes actual provider attempts beneath retries, without receiving provider data', async () => {
    const onProviderCall = vi.fn()
    let attempts = 0
    const raw = fakeLanguageModel(() => {
      if (++attempts === 1) {
        throw new APICallError({
          message: 'temporary provider failure',
          url: 'http://localhost/v1',
          requestBodyValues: {},
          statusCode: 503,
          responseHeaders: { 'retry-after-ms': '0' },
          isRetryable: true,
        })
      }
    })
    const model = createModel(overrideProfile(), noneAuth,
      { languageModels: { 'override-model': raw } }, { onProviderCall })

    await model.doGenerate({ prompt: promptWithUserText('hello') })

    expect(attempts).toBe(2)
    expect(onProviderCall.mock.calls).toEqual([[], []])
  })

  it('observes adapter fallbacks and leaves no-observer calls unchanged', async () => {
    const onProviderCall = vi.fn()
    const providerCall = vi.fn()
    const raw = fakeLanguageModel(providerCall)
    vi.spyOn(getProvider('openai-compatible')!, 'adapter').mockReturnValue(raw)
    const observed = createModel(overrideProfile(), noneAuth, {}, { onProviderCall })
    const ordinary = createModel(overrideProfile(), noneAuth)
    const params: LanguageModelV3CallOptions = { prompt: promptWithUserText('hello') }
    expect(await observed.doGenerate(params)).toEqual(await ordinary.doGenerate(params))
    expect(providerCall).toHaveBeenCalledTimes(2)
    expect(onProviderCall).toHaveBeenCalledTimes(1)
    expect(observed.modelId).toBe(ordinary.modelId)
    expect(observed.provider).toBe(ordinary.provider)
  })

  it('keeps an observer failure from changing provider results or errors', async () => {
    const onProviderCall = () => { throw new Error('observation failed') }
    const raw = fakeLanguageModel(() => {})
    const model = createModel(overrideProfile(), noneAuth,
      { languageModels: { 'override-model': raw } }, { onProviderCall })
    expect((await model.doGenerate({ prompt: [] })).finishReason.unified).toBe('stop')
    const failure = apiError('provider failure')
    raw.doGenerate = () => { throw failure }
    await expect(model.doGenerate({ prompt: [] })).rejects.toBe(failure)
  })

  it('preserves provider binding and streaming while observing each invocation once', async () => {
    const onProviderCall = vi.fn()
    const raw = fakeLanguageModel(() => {}, [textDelta('streamed')])
    const generate = raw.doGenerate
    const stream = raw.doStream
    raw.doGenerate = function (params) {
      expect(this).toBe(raw)
      return generate.call(this, params)
    }
    raw.doStream = function (params) {
      expect(this).toBe(raw)
      return stream.call(this, params)
    }
    const model = createModel(overrideProfile(), noneAuth,
      { languageModels: { 'override-model': raw } }, { onProviderCall })
    await model.doGenerate({ prompt: [] })
    const result = await model.doStream({ prompt: [] })
    expect(await collectStreamText(result.stream)).toBe('streamed')
    expect(onProviderCall).toHaveBeenCalledTimes(2)
  })

  it('does not count a safety refusal before the provider', async () => {
    const onProviderCall = vi.fn()
    const providerCall = vi.fn()
    const model = createModel(overrideProfile(), noneAuth,
      { languageModels: { 'override-model': fakeLanguageModel(providerCall) } },
      { onProviderCall })
    await expect(model.doGenerate({ prompt: promptWithUserText(AWS_KEY) }))
      .rejects.toBeInstanceOf(GuardrailBlockError)
    expect(providerCall).not.toHaveBeenCalled()
    expect(onProviderCall).not.toHaveBeenCalled()
  })

  it('observes a failed invocation and preserves the original error', async () => {
    const onProviderCall = vi.fn()
    const failure = apiError('permanent failure')
    const model = createModel(overrideProfile(), noneAuth,
      { languageModels: { 'override-model': fakeLanguageModel(() => { throw failure }) } },
      { onProviderCall })
    await expect(model.doGenerate({ prompt: [] })).rejects.toBe(failure)
    expect(onProviderCall).toHaveBeenCalledTimes(1)
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

  describe('safety egress middleware', () => {
    it('runs the guardrail after masking on provider request params', async () => {
      const maskingContext = createMaskingContext()
      maskingContext.register(AWS_KEY)
      setActiveMaskingContextResolver(() => maskingContext)

      let captured: LanguageModelV3CallOptions | undefined
      const model = createModel(overrideProfile(), noneAuth, {
        languageModels: {
          'override-model': fakeLanguageModel((params) => {
            captured = params
          }),
        },
      })

      await model.doGenerate({
        prompt: promptWithUserText(`masked ${AWS_KEY}; residual ${BEARER}`),
      })

      const text = capturedUserText(captured)
      expect(text).toContain('<SECRET_0>')
      expect(text).toContain('<REDACTED:bearer>')
      expect(text).not.toContain(AWS_KEY)
      expect(text).not.toContain(BEARER)
    })

    it('blocks an unmasked block-shape prompt before the provider call', async () => {
      let providerCalled = false
      const model = createModel(overrideProfile(), noneAuth, {
        languageModels: {
          'override-model': fakeLanguageModel(() => {
            providerCalled = true
          }),
        },
      })

      await expect(
        model.doGenerate({ prompt: promptWithUserText(`send ${AWS_KEY}`) }),
      ).rejects.toBeInstanceOf(GuardrailBlockError)
      expect(providerCalled).toBe(false)
    })

    it('scans the streaming path instead of passing provider streams through raw', async () => {
      const model = createModel(overrideProfile(), noneAuth, {
        languageModels: {
          'override-model': fakeLanguageModel(() => undefined, [
            textDelta(`prefix ${AWS_KEY.slice(0, 8)}`),
            textDelta(`${AWS_KEY.slice(8)} suffix`),
          ]),
        },
      })

      const result = await model.doStream({ prompt: [] })
      const output = await collectStreamText(result.stream)

      expect(output).toBe('prefix <REDACTED:awsKey> suffix')
      expect(output).not.toContain(AWS_KEY)
      expect(output).not.toContain(AWS_KEY.slice(0, 8))
    })
  })
})
