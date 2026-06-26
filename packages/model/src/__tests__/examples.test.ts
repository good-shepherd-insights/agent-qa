import { describe, expect, it } from 'vitest'

import { deriveExamplesMiddleware } from '../middleware/examples.js'

async function transform(params: Record<string, unknown>) {
  return deriveExamplesMiddleware().transformParams!({
    type: 'generate',
    params: params as any,
    model: {} as any,
  })
}

describe('deriveExamplesMiddleware', () => {
  it('adds schema-derived examples to function tools without examples', async () => {
    const params = {
      tools: [
        {
          type: 'function' as const,
          name: 'probe',
          inputSchema: {
            properties: {
              ref: { type: 'string' },
              count: { type: 'number' },
            },
          },
        },
      ],
    }

    const result = await transform(params)

    expect((result as any).tools[0].inputExamples).toEqual([
      { input: { ref: '', count: 0 } },
    ])
  })

  it('respects existing curated inputExamples', async () => {
    const tool = {
      type: 'function' as const,
      name: 'probe',
      inputSchema: { properties: { ref: { type: 'string' } } },
      inputExamples: [{ input: { ref: 'curated' } }],
    }
    const params = { tools: [tool] }

    const result = await transform(params)

    expect((result as any).tools[0]).toBe(tool)
    expect((result as any).tools[0].inputExamples).toEqual([{ input: { ref: 'curated' } }])
  })

  it('leaves non-function tools unchanged', async () => {
    const tool = {
      type: 'provider' as const,
      name: 'web_search',
      id: 'web_search',
    }
    const params = { tools: [tool] }

    const result = await transform(params)

    expect((result as any).tools[0]).toBe(tool)
  })

  it('returns params unchanged when tools are absent', async () => {
    const params = { prompt: [] }

    const result = await transform(params)

    expect(result).toBe(params)
  })

  it('does not mutate the original function tool object', async () => {
    const tool = {
      type: 'function' as const,
      name: 'probe',
      inputSchema: {
        properties: {
          ref: { type: 'string' },
          enabled: { type: 'boolean' },
        },
      },
    }
    const params = { tools: [tool] }

    const result = await transform(params)

    expect(tool).not.toHaveProperty('inputExamples')
    expect((result as any).tools[0]).not.toBe(tool)
    expect((result as any).tools[0].inputExamples).toEqual([
      { input: { ref: '', enabled: false } },
    ])
  })
})
