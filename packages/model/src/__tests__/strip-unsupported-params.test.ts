import type { LanguageModelMiddleware } from 'ai'
import { describe, expect, it } from 'vitest'

import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider'

import { stripUnsupportedParamsMiddleware } from '../middleware/strip-unsupported-params.js'
import { getProvider } from '../providers/registry.js'

const fakeModel = {} as LanguageModelV3

async function transform(
  middleware: LanguageModelMiddleware,
  params: LanguageModelV3CallOptions,
): Promise<LanguageModelV3CallOptions> {
  if (!middleware.transformParams) {
    throw new Error('expected a transformParams middleware')
  }
  return middleware.transformParams({ type: 'generate', params, model: fakeModel })
}

function paramsWithCap(): LanguageModelV3CallOptions {
  return {
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    tools: [
      {
        type: 'function',
        name: 'probe',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
    toolChoice: { type: 'required' },
    temperature: 0.5,
    maxOutputTokens: 4096,
  } as LanguageModelV3CallOptions
}

describe('stripUnsupportedParamsMiddleware', () => {
  it('deletes the named param and preserves every other field, order intact', async () => {
    const middleware = stripUnsupportedParamsMiddleware(['maxOutputTokens'])
    const params = paramsWithCap()
    const before = JSON.parse(JSON.stringify({ ...params, maxOutputTokens: undefined }))

    const result = await transform(middleware, params)

    expect(result).not.toHaveProperty('maxOutputTokens')
    // Every surviving field is byte-identical, and in the same declaration order.
    expect(Object.keys(result)).toEqual(['prompt', 'tools', 'toolChoice', 'temperature'])
    expect(JSON.parse(JSON.stringify(result))).toEqual(before)
  })

  it('returns the params unchanged when the list is empty', async () => {
    const middleware = stripUnsupportedParamsMiddleware([])
    const params = paramsWithCap()

    const result = await transform(middleware, params)

    expect(result).toBe(params)
    expect(result).toHaveProperty('maxOutputTokens', 4096)
  })

  it('returns the params unchanged when no named key is present', async () => {
    const middleware = stripUnsupportedParamsMiddleware(['topK'])
    const params = paramsWithCap()

    const result = await transform(middleware, params)

    expect(result).toBe(params)
    expect(result).toHaveProperty('maxOutputTokens', 4096)
    // No unrelated key was deleted.
    expect(Object.keys(result)).toEqual(['prompt', 'tools', 'toolChoice', 'temperature', 'maxOutputTokens'])
  })

  it('removes every named key that is present', async () => {
    const middleware = stripUnsupportedParamsMiddleware(['maxOutputTokens', 'topK'])
    const params = { ...paramsWithCap(), topK: 40 } as LanguageModelV3CallOptions

    const result = await transform(middleware, params)

    expect(result).not.toHaveProperty('maxOutputTokens')
    expect(result).not.toHaveProperty('topK')
    expect(result).toHaveProperty('temperature', 0.5)
  })
})

describe('provider unsupportedParams declarations', () => {
  it('declares maxOutputTokens unsupported for openai-subscription only', () => {
    expect(getProvider('openai-subscription')?.unsupportedParams).toContain('maxOutputTokens')
  })

  it('does not declare maxOutputTokens unsupported for cap-supporting providers', () => {
    for (const id of ['openai-compatible', 'anthropic-compatible', 'anthropic-subscription', 'gemini']) {
      expect(getProvider(id)?.unsupportedParams ?? []).not.toContain('maxOutputTokens')
    }
  })
})
