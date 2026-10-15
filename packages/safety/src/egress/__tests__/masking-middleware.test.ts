import { wrapLanguageModel } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'

import type { ProviderRequestParams } from '../map-prompt-leaves'
import { createMaskingMiddleware } from '../masking-middleware'

const upper = (text: string): string => text.toUpperCase()

function recorder(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: 'text', text: 'ok' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 0, text: 0, reasoning: 0 },
      },
      warnings: [],
    },
  })
}

describe('C441-EGRESS', () => {
  it('the middleware rewrites only through the injected function', async () => {
    const tools = [
      {
        type: 'function' as const,
        name: 'lookup',
        description: 'look up a value',
        inputSchema: { type: 'object' as const, properties: { q: { type: 'string' as const } } },
      },
    ]
    const headers = { authorization: 'Bearer header-value' }
    const providerOptions = { openai: { user: 'provider-option-value' } }
    const params = {
      prompt: [
        { role: 'system', content: 'system text' },
        { role: 'user', content: [{ type: 'text', text: 'user text' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'assistant text' }] },
      ],
      tools,
      headers,
      providerOptions,
    } as unknown as ProviderRequestParams

    const model = recorder()
    const wrapped = wrapLanguageModel({ model, middleware: createMaskingMiddleware(upper) })
    await wrapped.doGenerate(params)

    const sent = model.doGenerateCalls[0]!
    expect(sent.prompt).toEqual([
      { role: 'system', content: 'SYSTEM TEXT' },
      { role: 'user', content: [{ type: 'text', text: 'USER TEXT' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'ASSISTANT TEXT' }] },
    ])
    expect(sent.tools).toEqual(tools)
    expect(sent.headers).toEqual(headers)
    expect(sent.providerOptions).toEqual(providerOptions)
  })
})
