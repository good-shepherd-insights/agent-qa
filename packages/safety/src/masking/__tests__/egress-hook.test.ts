import { describe, expect, it } from 'vitest'

import type { ProviderRequestParams } from '../../hooks/interfaces'
import { createMaskingContext } from '../context'
import { createMaskingProviderRequestHook } from '../egress-hook'

function asProviderRequestParams(params: unknown): ProviderRequestParams {
  return params as ProviderRequestParams
}

describe('createMaskingProviderRequestHook', () => {
  it('masks prompt text leaves when a masking context is active', () => {
    const secret = 'sk-live-abcdef0123456789'
    const ctx = createMaskingContext()
    ctx.register(secret)
    const hook = createMaskingProviderRequestHook(() => ctx)
    const params = asProviderRequestParams({
      prompt: [
        {
          role: 'user',
          content: [{ type: 'text', text: `use ${secret}` }],
        },
      ],
      temperature: 0.2,
    })

    const masked = hook(params)
    const part = masked.prompt[0]?.role === 'user' ? masked.prompt[0].content[0] : undefined

    if (!part || part.type !== 'text') {
      throw new Error('expected a user text part')
    }

    expect(masked).not.toBe(params)
    expect(part.text).toContain('<SECRET_0>')
    expect(part.text).not.toContain(secret)
    expect(masked.temperature).toBe(0.2)
  })

  it('returns the exact same params reference when no masking context is active', () => {
    const hook = createMaskingProviderRequestHook(() => undefined)
    const params = asProviderRequestParams({
      prompt: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'unchanged' }],
        },
      ],
    })

    expect(hook(params)).toBe(params)
  })

  it('masks secrets embedded in tool-call input objects', () => {
    const secret = 'sk-live-abcdef0123456789'
    const ctx = createMaskingContext()
    ctx.register(secret)
    const hook = createMaskingProviderRequestHook(() => ctx)
    const params = asProviderRequestParams({
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call_1',
              toolName: 'lookup',
              input: { authorization: `Bearer ${secret}` },
            },
          ],
        },
      ],
    })

    const masked = hook(params)
    const part = masked.prompt[0]?.role === 'assistant' ? masked.prompt[0].content[0] : undefined

    if (!part || part.type !== 'tool-call') {
      throw new Error('expected an assistant tool-call part')
    }

    expect(JSON.stringify(part.input)).toContain('<SECRET_0>')
    expect(JSON.stringify(part.input)).not.toContain(secret)
  })
})
