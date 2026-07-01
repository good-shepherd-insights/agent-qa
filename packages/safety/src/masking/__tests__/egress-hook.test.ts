import { describe, expect, it } from 'vitest'

import type { ProviderRequestParams } from '../../hooks/interfaces'
import { createMaskingContext } from '../context'
import { createMaskingProviderRequestHook } from '../egress-hook'

const SECRET = 'sk-live-abcdef0123456789'

function asProviderRequestParams(params: unknown): ProviderRequestParams {
  return params as ProviderRequestParams
}

function expectMasked(value: string): void {
  expect(value).toContain('<SECRET_0>')
  expect(value).not.toContain(SECRET)
}

describe('createMaskingProviderRequestHook', () => {
  it('masks prompt text leaves when a masking context is active', () => {
    const ctx = createMaskingContext()
    ctx.register(SECRET)
    const hook = createMaskingProviderRequestHook(() => ctx)
    const params = asProviderRequestParams({
      prompt: [
        {
          role: 'user',
          content: [{ type: 'text', text: `use ${SECRET}` }],
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
    expectMasked(part.text)
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
    const ctx = createMaskingContext()
    ctx.register(SECRET)
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
              input: { authorization: `Bearer ${SECRET}` },
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
    expect(JSON.stringify(part.input)).not.toContain(SECRET)
  })

  it('masks user file part string fields while leaving media type unchanged', () => {
    const ctx = createMaskingContext()
    ctx.register(SECRET)
    const hook = createMaskingProviderRequestHook(() => ctx)
    const params = asProviderRequestParams({
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              filename: `screenshot-${SECRET}.png`,
              data: `https://example.test/image.png?token=${SECRET}`,
              mediaType: 'image/png',
            },
          ],
        },
      ],
    })

    const masked = hook(params)
    const part = masked.prompt[0]?.role === 'user' ? masked.prompt[0].content[0] : undefined

    if (!part || part.type !== 'file') {
      throw new Error('expected a user file part')
    }
    if (typeof part.data !== 'string') {
      throw new Error('expected file data to remain a string')
    }

    expectMasked(part.filename ?? '')
    expectMasked(part.data)
    expect(part.mediaType).toBe('image/png')
  })

  it('leaves binary file data unchanged', () => {
    const ctx = createMaskingContext()
    ctx.register(SECRET)
    const hook = createMaskingProviderRequestHook(() => ctx)
    const data = new Uint8Array([1, 2, 3])
    const params = asProviderRequestParams({
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              filename: 'screenshot.png',
              data,
              mediaType: 'image/png',
            },
          ],
        },
      ],
    })

    const masked = hook(params)
    const part = masked.prompt[0]?.role === 'user' ? masked.prompt[0].content[0] : undefined

    if (!part || part.type !== 'file') {
      throw new Error('expected a user file part')
    }

    expect(part.data).toBe(data)
    expect(part.mediaType).toBe('image/png')
  })

  it('masks tool approval response reasons while preserving structural fields', () => {
    const ctx = createMaskingContext()
    ctx.register(SECRET)
    const hook = createMaskingProviderRequestHook(() => ctx)
    const params = asProviderRequestParams({
      prompt: [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-approval-response',
              approvalId: 'approval_1',
              approved: false,
              reason: `do not reveal ${SECRET}`,
            },
          ],
        },
      ],
    })

    const masked = hook(params)
    const part = masked.prompt[0]?.role === 'tool' ? masked.prompt[0].content[0] : undefined

    if (!part || part.type !== 'tool-approval-response') {
      throw new Error('expected a tool approval response part')
    }

    expectMasked(part.reason ?? '')
    expect(part.approvalId).toBe('approval_1')
    expect(part.approved).toBe(false)
  })

  it('masks tool-result content variant text leaves', () => {
    const ctx = createMaskingContext()
    ctx.register(SECRET)
    const hook = createMaskingProviderRequestHook(() => ctx)
    const params = asProviderRequestParams({
      prompt: [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_1',
              toolName: 'lookup',
              output: {
                type: 'content',
                value: [{ type: 'text', text: `result contains ${SECRET}` }],
              },
            },
          ],
        },
      ],
    })

    const masked = hook(params)
    const part = masked.prompt[0]?.role === 'tool' ? masked.prompt[0].content[0] : undefined

    if (!part || part.type !== 'tool-result' || part.output.type !== 'content') {
      throw new Error('expected a tool-result content output')
    }

    const nested = part.output.value[0]

    if (!nested || nested.type !== 'text') {
      throw new Error('expected a nested text output part')
    }

    expectMasked(nested.text)
  })

  it('leaves provider headers unchanged because they are transport credentials', () => {
    const ctx = createMaskingContext()
    ctx.register(SECRET)
    const hook = createMaskingProviderRequestHook(() => ctx)
    const headers = { authorization: `Bearer ${SECRET}` }
    const params = asProviderRequestParams({
      prompt: [
        {
          role: 'user',
          content: [{ type: 'text', text: `mask ${SECRET}` }],
        },
      ],
      headers,
    })

    const masked = hook(params)

    expect(masked.headers).toBe(headers)
    expect(masked.headers?.authorization).toBe(`Bearer ${SECRET}`)
  })
})
