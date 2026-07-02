import { describe, expect, it } from 'vitest'

import type { ProviderRequestParams } from '../../hooks/interfaces'
import { mapPromptLeaves } from '../map-prompt-leaves'

const identity = (text: string): string => text
const bang = (text: string): string => `${text}!`

function asParams(params: unknown): ProviderRequestParams {
  return params as ProviderRequestParams
}

class LeafBlockError extends Error {}

describe('mapPromptLeaves', () => {
  it('returns an equivalent tree for an identity fn across every part type', () => {
    const params = asParams({
      prompt: [
        { role: 'system', content: 'system prompt' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'user text' },
            { type: 'file', filename: 'f.txt', data: 'string data', mediaType: 'text/plain' },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'reasoning' },
            { type: 'tool-call', toolCallId: 'c1', toolName: 'lookup', input: { q: 'x' } },
            {
              type: 'tool-result',
              toolCallId: 'c2',
              toolName: 'lookup',
              output: { type: 'content', value: [{ type: 'text', text: 'nested' }] },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'c3',
              toolName: 'lookup',
              output: { type: 'json', value: { token: 'v' } },
            },
            {
              type: 'tool-approval-response',
              approvalId: 'a1',
              approved: false,
              reason: 'reason',
            },
          ],
        },
      ],
      temperature: 0.4,
    })

    expect(mapPromptLeaves(params, identity)).toEqual(params)
  })

  it('passes every in-scope string leaf through fn', () => {
    const params = asParams({
      prompt: [
        { role: 'system', content: 'sys' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'txt' },
            { type: 'file', filename: 'name', data: 'body', mediaType: 'text/plain' },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'c1',
              toolName: 'lookup',
              output: { type: 'error-text', value: 'err' },
            },
          ],
        },
      ],
    })

    const out = mapPromptLeaves(params, bang)
    const sys = out.prompt[0]
    const user = out.prompt[1]
    const tool = out.prompt[2]

    expect(sys?.role === 'system' ? sys.content : undefined).toBe('sys!')
    if (user?.role !== 'user') throw new Error('expected user')
    const text = user.content[0]
    const file = user.content[1]
    expect(text?.type === 'text' ? text.text : undefined).toBe('txt!')
    expect(file?.type === 'file' ? file.filename : undefined).toBe('name!')
    expect(file?.type === 'file' && typeof file.data === 'string' ? file.data : undefined).toBe(
      'body!',
    )
    if (tool?.role !== 'tool') throw new Error('expected tool')
    const result = tool.content[0]
    expect(
      result?.type === 'tool-result' && result.output.type === 'error-text'
        ? result.output.value
        : undefined,
    ).toBe('err!')
  })

  it('propagates a throw from fn on a JSON-shaped tool-call input leaf', () => {
    const params = asParams({
      prompt: [
        {
          role: 'assistant',
          content: [
            { type: 'tool-call', toolCallId: 'c1', toolName: 'lookup', input: { secret: 'x' } },
          ],
        },
      ],
    })

    const throwOnJson = (text: string): string => {
      if (text.includes('secret')) throw new LeafBlockError('blocked')
      return text
    }

    expect(() => mapPromptLeaves(params, throwOnJson)).toThrow(LeafBlockError)
  })

  it('returns a JSON leaf unchanged when serialization fails (never throws for a non-block reason)', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const params = asParams({
      prompt: [
        {
          role: 'assistant',
          content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'lookup', input: circular }],
        },
      ],
    })

    const out = mapPromptLeaves(params, bang)
    const part = out.prompt[0]?.role === 'assistant' ? out.prompt[0].content[0] : undefined

    expect(part?.type === 'tool-call' ? part.input : undefined).toBe(circular)
  })

  it('returns a JSON leaf unchanged when the transformed string fails to parse', () => {
    const params = asParams({
      prompt: [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'c1',
              toolName: 'lookup',
              output: { type: 'json', value: { token: 'v' } },
            },
          ],
        },
      ],
    })

    const corrupt = (text: string): string => `${text} not json`
    const out = mapPromptLeaves(params, corrupt)
    const part = out.prompt[0]?.role === 'tool' ? out.prompt[0].content[0] : undefined

    expect(
      part?.type === 'tool-result' && part.output.type === 'json' ? part.output.value : undefined,
    ).toEqual({ token: 'v' })
  })
})
