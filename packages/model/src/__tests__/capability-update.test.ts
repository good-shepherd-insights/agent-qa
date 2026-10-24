import { APICallError } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ModelProfile } from '@vostride/agent-qa-schema'

import { capabilityKey, overrideStore } from '../capability/override-store.js'
import { resolveCapabilities } from '../capability/resolve.js'
import { capabilityUpdateMiddleware } from '../middleware/capability-update.js'
import { stubGenerateResult, stubModel } from './stub-model.js'

const prompt = { prompt: [] }
const profile: ModelProfile = {
  provider: 'openai-compatible',
  model: 'local-model',
  baseURL: 'http://localhost:11434/v1',
  auth: { mode: 'none' },
}

function apiError(
  statusCode: number,
  isRetryable: boolean,
  message = `status ${statusCode}`,
  responseBody = '',
): APICallError {
  return new APICallError({
    message,
    url: 'http://localhost/v1/chat/completions',
    requestBodyValues: {},
    statusCode,
    responseHeaders: {},
    responseBody,
    isRetryable,
  })
}

async function expectObservedWindow(message: string, expectedWindow: number): Promise<void> {
  let calls = 0
  const overflow = apiError(400, false, message)
  const model = wrapLanguageModel({
    model: stubModel({
      async generate() {
        calls += 1
        throw overflow
      },
    }),
    middleware: capabilityUpdateMiddleware(profile),
  })

  await expect(model.doGenerate(prompt)).rejects.toBe(overflow)

  expect(calls).toBe(1)
  expect(overrideStore.get(capabilityKey(profile.provider, profile.model))).toBe(expectedWindow)
}

describe('capabilityUpdateMiddleware', () => {
  beforeEach(() => {
    overrideStore.clear()
  })

  it('records OpenAI overflow windows and rethrows the same error', async () => {
    await expectObservedWindow(
      "This model's maximum context length is 128000 tokens. However, you requested 130000 tokens",
      128000,
    )
  })

  it('records Anthropic overflow windows and rethrows the same error', async () => {
    await expectObservedWindow('prompt is too long: 215534 tokens > 200000 maximum', 200000)
  })

  it('records Google overflow windows and rethrows the same error', async () => {
    await expectObservedWindow(
      'The input token count (1236488) exceeds the maximum number of tokens allowed (1048576).',
      1048576,
    )
  })

  it('rethrows non-overflow errors without writing to the store', async () => {
    const failure = apiError(503, true, 'maximum context length is 128000 tokens')
    const model = wrapLanguageModel({
      model: stubModel({
        async generate() {
          throw failure
        },
      }),
      middleware: capabilityUpdateMiddleware(profile),
    })

    await expect(model.doGenerate(prompt)).rejects.toBe(failure)

    expect(overrideStore.get(capabilityKey(profile.provider, profile.model))).toBeUndefined()
  })

  it('passes successful calls through without writing to the store', async () => {
    const model = wrapLanguageModel({
      model: stubModel({
        async generate() {
          return stubGenerateResult([{ type: 'text', text: 'ok' }])
        },
      }),
      middleware: capabilityUpdateMiddleware(profile),
    })

    const result = await model.doGenerate(prompt)

    expect(result.content).toEqual([{ type: 'text', text: 'ok' }])
    expect(overrideStore.get(capabilityKey(profile.provider, profile.model))).toBeUndefined()
  })

  it('feeds observed windows back through resolveCapabilities', async () => {
    await expectObservedWindow(
      "This model's maximum context length is 32768 tokens. However, you requested 40000 tokens",
      32768,
    )

    expect(resolveCapabilities(profile).contextWindow).toBe(32768)
  })
})
