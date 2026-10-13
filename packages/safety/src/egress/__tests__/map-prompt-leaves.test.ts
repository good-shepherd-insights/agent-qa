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
            { type: 'tool-call', toolCallId: 'c1', toolName: 'lookup', input: { q: 'secret' } },
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

const PW = 'pa"ss\\word'
const maskPw = (text: string): string => text.split(PW).join('[secret:PW]')

describe('C441-EGRESS', () => {
  it('a value with a quote inside a tool-call input is masked', () => {
    const params = asParams({
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'c1',
              toolName: 'fill',
              input: { a: { b: [`x ${PW} y`] }, n: 3, t: true, z: null },
            },
          ],
        },
      ],
    })

    const out = mapPromptLeaves(params, maskPw)
    const part = out.prompt[0]?.role === 'assistant' ? out.prompt[0].content[0] : undefined

    expect(part?.type === 'tool-call' ? part.input : undefined).toEqual({
      a: { b: ['x [secret:PW] y'] },
      n: 3,
      t: true,
      z: null,
    })
  })

  it('a JSON tool result is walked leaf by leaf', () => {
    const value = { [PW]: { list: [`held ${PW}`, 7], deep: { text: PW } } }
    const params = asParams({
      prompt: [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'c1',
              toolName: 'read',
              output: { type: 'json', value },
            },
            {
              type: 'tool-result',
              toolCallId: 'c2',
              toolName: 'read',
              output: { type: 'error-json', value },
            },
          ],
        },
      ],
    })

    const out = mapPromptLeaves(params, maskPw)
    const tool = out.prompt[0]
    if (tool?.role !== 'tool') throw new Error('expected tool')
    const expected = { [PW]: { list: ['held [secret:PW]', 7], deep: { text: '[secret:PW]' } } }
    for (const part of tool.content) {
      expect(part.type === 'tool-result' ? part.output : undefined).toMatchObject({
        value: expected,
      })
    }
  })

  it('binary and base64 data is never passed to the mask', () => {
    const fileData = 'ZmlsZSBkYXRh'
    const resultFileData = 'cmVzdWx0IGZpbGU='
    const imageData = 'aW1hZ2UgZGF0YQ=='
    const params = asParams({
      prompt: [
        {
          role: 'user',
          content: [
            { type: 'file', filename: `${PW}.txt`, data: fileData, mediaType: 'text/plain' },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'c1',
              toolName: 'screenshot',
              output: {
                type: 'content',
                value: [
                  {
                    type: 'file-data',
                    filename: `${PW}.pdf`,
                    data: resultFileData,
                    mediaType: 'application/pdf',
                  },
                  { type: 'image-data', data: imageData, mediaType: 'image/png' },
                ],
              },
            },
          ],
        },
      ],
    })
    const seen: string[] = []
    const spy = (text: string): string => {
      seen.push(text)
      return maskPw(text)
    }

    const out = mapPromptLeaves(params, spy)

    const user = out.prompt[0]
    if (user?.role !== 'user') throw new Error('expected user')
    expect(user.content[0]).toMatchObject({ filename: '[secret:PW].txt', data: fileData })
    const tool = out.prompt[1]
    if (tool?.role !== 'tool') throw new Error('expected tool')
    const result = tool.content[0]
    if (result?.type !== 'tool-result' || result.output.type !== 'content') {
      throw new Error('expected content output')
    }
    expect(result.output.value[0]).toMatchObject({
      filename: '[secret:PW].pdf',
      data: resultFileData,
    })
    expect(result.output.value[1]).toMatchObject({ data: imageData })
    expect(seen).not.toContain(fileData)
    expect(seen).not.toContain(resultFileData)
    expect(seen).not.toContain(imageData)
  })

  it('URLs and text parts are still masked', () => {
    const params = asParams({
      prompt: [
        { role: 'system', content: `system ${PW}` },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: `text ${PW}` },
            { type: 'reasoning', text: `reasoning ${PW}` },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'c1',
              toolName: 'open',
              output: {
                type: 'content',
                value: [
                  { type: 'file-url', url: `https://x.test/${PW}` },
                  { type: 'image-url', url: `https://x.test/i/${PW}` },
                ],
              },
            },
            {
              type: 'tool-result',
              toolCallId: 'c2',
              toolName: 'open',
              output: { type: 'error-text', value: `error ${PW}` },
            },
            {
              type: 'tool-result',
              toolCallId: 'c3',
              toolName: 'open',
              output: { type: 'execution-denied', reason: `denied ${PW}` },
            },
          ],
        },
      ],
    })

    const wire = JSON.stringify(mapPromptLeaves(params, maskPw))

    for (const masked of [
      'system [secret:PW]',
      'text [secret:PW]',
      'reasoning [secret:PW]',
      'https://x.test/[secret:PW]',
      'https://x.test/i/[secret:PW]',
      'error [secret:PW]',
      'denied [secret:PW]',
    ]) {
      expect(wire).toContain(masked)
    }
    expect(wire).not.toContain('pa\\"ss')
  })
})
