import { describe, expect, it } from 'vitest'

import type { GuardrailAuditRow, ProviderRequestParams } from '../../index'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '../policy-loader'
import {
  createGuardrailProviderRequestHook,
  GuardrailBlockError,
} from '../egress-hook'

const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'
const BEARER = 'Bearer abcdefghijklmno12345'
const API_KEY = 'sk-abc123abc123abc123'
const EMAIL = 'owner@example.com'

const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)

class FakeAuditSink {
  readonly guardrailRows: GuardrailAuditRow[] = []

  appendExecutionAudit(): void {
    throw new Error('execution audit should not be written by guardrail egress hook')
  }

  appendGuardrailAudit(row: GuardrailAuditRow): void {
    this.guardrailRows.push(row)
  }
}

function asProviderRequestParams(params: unknown): ProviderRequestParams {
  return params as ProviderRequestParams
}

function expectUserText(params: ProviderRequestParams): string {
  const part = params.prompt[0]?.role === 'user' ? params.prompt[0].content[0] : undefined

  if (!part || part.type !== 'text') {
    throw new Error('expected a user text part')
  }

  return part.text
}

function transform(params: unknown): ProviderRequestParams {
  return createGuardrailProviderRequestHook(policy)(asProviderRequestParams(params))
}

describe('createGuardrailProviderRequestHook', () => {
  it('throws GuardrailBlockError for a blocking user text leaf and audits before throwing', () => {
    const sink = new FakeAuditSink()
    const hook = createGuardrailProviderRequestHook(policy, sink)
    const params = asProviderRequestParams({
      prompt: [
        {
          role: 'user',
          content: [{ type: 'text', text: `use ${AWS_KEY}` }],
        },
      ],
    })

    let thrown: unknown

    try {
      hook(params)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(GuardrailBlockError)
    expect((thrown as GuardrailBlockError).detector).toBe('awsKey')
    expect(sink.guardrailRows).toEqual([
      {
        channel: 'request',
        action: 'block',
        detector: 'awsKey',
        redactedFingerprint: expect.any(String),
      },
    ])
  })

  it('redacts a bearer token user text leaf and writes a redact audit row', () => {
    const sink = new FakeAuditSink()
    const hook = createGuardrailProviderRequestHook(policy, sink)
    const params = asProviderRequestParams({
      prompt: [
        {
          role: 'user',
          content: [{ type: 'text', text: `Authorization: ${BEARER}` }],
        },
      ],
      temperature: 0.2,
    })

    const transformed = hook(params)

    expect(expectUserText(transformed)).toBe('Authorization: <REDACTED:bearer>')
    expect(transformed.temperature).toBe(0.2)
    expect(sink.guardrailRows).toEqual([
      {
        channel: 'request',
        action: 'redact',
        detector: 'bearer',
        redactedFingerprint: expect.any(String),
      },
    ])
  })

  it('passes ordinary prose unchanged without block or redact audit rows', () => {
    const sink = new FakeAuditSink()
    const hook = createGuardrailProviderRequestHook(policy, sink)
    const params = asProviderRequestParams({
      prompt: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'ordinary prose with no secret shape' }],
        },
      ],
    })

    const transformed = hook(params)

    expect(expectUserText(transformed)).toBe('ordinary prose with no secret shape')
    expect(sink.guardrailRows).toEqual([])
  })

  it('scans without any masking-context gate', () => {
    const sink = new FakeAuditSink()
    const hook = createGuardrailProviderRequestHook(policy, sink)
    const params = asProviderRequestParams({
      prompt: [
        {
          role: 'user',
          content: [{ type: 'text', text: `scan even without a ctx: ${BEARER}` }],
        },
      ],
    })

    const transformed = hook(params)

    expect(expectUserText(transformed)).toBe('scan even without a ctx: <REDACTED:bearer>')
    expect(sink.guardrailRows).toHaveLength(1)
  })

  it('mirrors masking walker leaves for representative prompt content', () => {
    const hook = createGuardrailProviderRequestHook(policy)
    const params = asProviderRequestParams({
      prompt: [
        { role: 'system', content: `system ${BEARER}` },
        {
          role: 'user',
          content: [
            { type: 'text', text: `user ${BEARER}` },
            {
              type: 'file',
              filename: `report-${BEARER}.txt`,
              data: `file body ${BEARER}`,
              mediaType: 'text/plain',
            },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: `reasoning ${BEARER}` },
            {
              type: 'tool-call',
              toolCallId: 'call_1',
              toolName: 'lookup',
              input: { authorization: BEARER },
            },
            {
              type: 'tool-result',
              toolCallId: 'call_2',
              toolName: 'lookup',
              output: {
                type: 'content',
                value: [{ type: 'text', text: `assistant result ${BEARER}` }],
              },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_3',
              toolName: 'lookup',
              output: { type: 'text', value: `tool result ${BEARER}` },
            },
            {
              type: 'tool-approval-response',
              approvalId: 'approval_1',
              approved: false,
              reason: `approval ${BEARER}`,
            },
          ],
        },
      ],
    })

    const transformed = hook(params)

    expect(JSON.stringify(transformed)).toContain('<REDACTED:bearer>')
    expect(JSON.stringify(transformed)).not.toContain(BEARER)
  })

  it('leaves binary file data unchanged while scanning string file fields', () => {
    const hook = createGuardrailProviderRequestHook(policy)
    const data = new Uint8Array([1, 2, 3])
    const params = asProviderRequestParams({
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              filename: `capture ${BEARER}`,
              data,
              mediaType: 'image/png',
            },
          ],
        },
      ],
    })

    const transformed = hook(params)
    const part =
      transformed.prompt[0]?.role === 'user' ? transformed.prompt[0].content[0] : undefined

    if (!part || part.type !== 'file') {
      throw new Error('expected a user file part')
    }

    expect(part.filename).toBe('capture <REDACTED:bearer>')
    expect(part.data).toBe(data)
  })

  it('writes all fired detector audit rows before block wins over redact', () => {
    const sink = new FakeAuditSink()
    const hook = createGuardrailProviderRequestHook(policy, sink)
    const params = asProviderRequestParams({
      prompt: [
        {
          role: 'user',
          content: [{ type: 'text', text: `send ${AWS_KEY} to ${EMAIL}` }],
        },
      ],
    })

    expect(() => hook(params)).toThrow(GuardrailBlockError)
    expect(sink.guardrailRows.map((row) => `${row.action}:${row.detector}`)).toEqual([
      'block:awsKey',
      'redact:email',
    ])
  })
})

describe('guardrail egress hook leaf parity with masking walker', () => {
  it('redacts system message content', () => {
    const transformed = transform({
      prompt: [{ role: 'system', content: `system ${BEARER}` }],
    })
    const message = transformed.prompt[0]

    if (!message || message.role !== 'system') {
      throw new Error('expected a system message')
    }

    expect(message.content).toBe('system <REDACTED:bearer>')
  })

  it('redacts user text parts', () => {
    const transformed = transform({
      prompt: [{ role: 'user', content: [{ type: 'text', text: `user ${BEARER}` }] }],
    })

    expect(expectUserText(transformed)).toBe('user <REDACTED:bearer>')
  })

  it('redacts user file filenames and string data', () => {
    const transformed = transform({
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              filename: `file ${BEARER}`,
              data: `body ${BEARER}`,
              mediaType: 'text/plain',
            },
          ],
        },
      ],
    })
    const part =
      transformed.prompt[0]?.role === 'user' ? transformed.prompt[0].content[0] : undefined

    if (!part || part.type !== 'file' || typeof part.data !== 'string') {
      throw new Error('expected a user file part with string data')
    }

    expect(part.filename).toBe('file <REDACTED:bearer>')
    expect(part.data).toBe('body <REDACTED:bearer>')
  })

  it('leaves user file binary data untouched', () => {
    const data = new Uint8Array([4, 5, 6])
    const transformed = transform({
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              filename: 'binary capture',
              data,
              mediaType: 'image/png',
            },
          ],
        },
      ],
    })
    const part =
      transformed.prompt[0]?.role === 'user' ? transformed.prompt[0].content[0] : undefined

    if (!part || part.type !== 'file') {
      throw new Error('expected a user file part')
    }

    expect(part.data).toBe(data)
  })

  it('redacts assistant text parts', () => {
    const transformed = transform({
      prompt: [{ role: 'assistant', content: [{ type: 'text', text: `assistant ${BEARER}` }] }],
    })
    const part =
      transformed.prompt[0]?.role === 'assistant' ? transformed.prompt[0].content[0] : undefined

    if (!part || part.type !== 'text') {
      throw new Error('expected an assistant text part')
    }

    expect(part.text).toBe('assistant <REDACTED:bearer>')
  })

  it('redacts assistant reasoning parts', () => {
    const transformed = transform({
      prompt: [
        { role: 'assistant', content: [{ type: 'reasoning', text: `reason ${BEARER}` }] },
      ],
    })
    const part =
      transformed.prompt[0]?.role === 'assistant' ? transformed.prompt[0].content[0] : undefined

    if (!part || part.type !== 'reasoning') {
      throw new Error('expected an assistant reasoning part')
    }

    expect(part.text).toBe('reason <REDACTED:bearer>')
  })

  it('redacts assistant file filenames and string data', () => {
    const transformed = transform({
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'file',
              filename: `assistant file ${BEARER}`,
              data: `assistant data ${BEARER}`,
              mediaType: 'text/plain',
            },
          ],
        },
      ],
    })
    const part =
      transformed.prompt[0]?.role === 'assistant'
        ? transformed.prompt[0].content[0]
        : undefined

    if (!part || part.type !== 'file' || typeof part.data !== 'string') {
      throw new Error('expected an assistant file part with string data')
    }

    expect(part.filename).toBe('assistant file <REDACTED:bearer>')
    expect(part.data).toBe('assistant data <REDACTED:bearer>')
  })

  it('redacts assistant tool-call JSON input', () => {
    const transformed = transform({
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call_1',
              toolName: 'lookup',
              input: { authorization: BEARER },
            },
          ],
        },
      ],
    })
    const part =
      transformed.prompt[0]?.role === 'assistant' ? transformed.prompt[0].content[0] : undefined

    if (!part || part.type !== 'tool-call') {
      throw new Error('expected an assistant tool-call part')
    }

    expect(part.input).toEqual({ authorization: '<REDACTED:bearer>' })
  })

  it('redacts assistant tool-result text output', () => {
    const transformed = transform({
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_1',
              toolName: 'lookup',
              output: { type: 'text', value: `assistant result ${BEARER}` },
            },
          ],
        },
      ],
    })
    const part =
      transformed.prompt[0]?.role === 'assistant' ? transformed.prompt[0].content[0] : undefined

    if (!part || part.type !== 'tool-result' || part.output.type !== 'text') {
      throw new Error('expected an assistant tool-result text output')
    }

    expect(part.output.value).toBe('assistant result <REDACTED:bearer>')
  })

  it('redacts tool-result error-text output', () => {
    const transformed = transform({
      prompt: [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_1',
              toolName: 'lookup',
              output: { type: 'error-text', value: `error ${BEARER}` },
            },
          ],
        },
      ],
    })
    const part =
      transformed.prompt[0]?.role === 'tool' ? transformed.prompt[0].content[0] : undefined

    if (!part || part.type !== 'tool-result' || part.output.type !== 'error-text') {
      throw new Error('expected a tool-result error-text output')
    }

    expect(part.output.value).toBe('error <REDACTED:bearer>')
  })

  it('redacts tool-result execution-denied reason', () => {
    const transformed = transform({
      prompt: [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_1',
              toolName: 'lookup',
              output: { type: 'execution-denied', reason: `denied ${BEARER}` },
            },
          ],
        },
      ],
    })
    const part =
      transformed.prompt[0]?.role === 'tool' ? transformed.prompt[0].content[0] : undefined

    if (!part || part.type !== 'tool-result' || part.output.type !== 'execution-denied') {
      throw new Error('expected a tool-result execution-denied output')
    }

    expect(part.output.reason).toBe('denied <REDACTED:bearer>')
  })

  it('redacts tool-result JSON output', () => {
    const transformed = transform({
      prompt: [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_1',
              toolName: 'lookup',
              output: { type: 'json', value: { token: BEARER } },
            },
          ],
        },
      ],
    })
    const part =
      transformed.prompt[0]?.role === 'tool' ? transformed.prompt[0].content[0] : undefined

    if (!part || part.type !== 'tool-result' || part.output.type !== 'json') {
      throw new Error('expected a tool-result json output')
    }

    expect(part.output.value).toEqual({ token: '<REDACTED:bearer>' })
  })

  it('redacts tool-result error-json output', () => {
    const transformed = transform({
      prompt: [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_1',
              toolName: 'lookup',
              output: { type: 'error-json', value: { token: BEARER } },
            },
          ],
        },
      ],
    })
    const part =
      transformed.prompt[0]?.role === 'tool' ? transformed.prompt[0].content[0] : undefined

    if (!part || part.type !== 'tool-result' || part.output.type !== 'error-json') {
      throw new Error('expected a tool-result error-json output')
    }

    expect(part.output.value).toEqual({ token: '<REDACTED:bearer>' })
  })

  it('redacts tool-result content text parts', () => {
    const transformed = transform({
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
                value: [{ type: 'text', text: `content ${BEARER}` }],
              },
            },
          ],
        },
      ],
    })
    const part =
      transformed.prompt[0]?.role === 'tool' ? transformed.prompt[0].content[0] : undefined

    if (!part || part.type !== 'tool-result' || part.output.type !== 'content') {
      throw new Error('expected a tool-result content output')
    }

    const nested = part.output.value[0]

    if (!nested || nested.type !== 'text') {
      throw new Error('expected nested content text')
    }

    expect(nested.text).toBe('content <REDACTED:bearer>')
  })

  it('redacts tool-result content file-data filename and data', () => {
    const transformed = transform({
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
                value: [{ type: 'file-data', filename: BEARER, data: BEARER }],
              },
            },
          ],
        },
      ],
    })
    const part =
      transformed.prompt[0]?.role === 'tool' ? transformed.prompt[0].content[0] : undefined

    if (!part || part.type !== 'tool-result' || part.output.type !== 'content') {
      throw new Error('expected a tool-result content output')
    }

    const nested = part.output.value[0]

    if (!nested || nested.type !== 'file-data') {
      throw new Error('expected nested file-data content')
    }

    expect(nested.filename).toBe('<REDACTED:bearer>')
    expect(nested.data).toBe('<REDACTED:bearer>')
  })

  it('redacts tool-result content image-data data', () => {
    const transformed = transform({
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
                value: [{ type: 'image-data', data: API_KEY }],
              },
            },
          ],
        },
      ],
    })
    const part =
      transformed.prompt[0]?.role === 'tool' ? transformed.prompt[0].content[0] : undefined

    if (!part || part.type !== 'tool-result' || part.output.type !== 'content') {
      throw new Error('expected a tool-result content output')
    }

    const nested = part.output.value[0]

    if (!nested || nested.type !== 'image-data') {
      throw new Error('expected nested image-data content')
    }

    expect(nested.data).toBe('<REDACTED:apiKey>')
  })

  it('redacts tool-result content file-url URLs', () => {
    const transformed = transform({
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
                value: [{ type: 'file-url', url: `https://example.test/${API_KEY}` }],
              },
            },
          ],
        },
      ],
    })
    const part =
      transformed.prompt[0]?.role === 'tool' ? transformed.prompt[0].content[0] : undefined

    if (!part || part.type !== 'tool-result' || part.output.type !== 'content') {
      throw new Error('expected a tool-result content output')
    }

    const nested = part.output.value[0]

    if (!nested || nested.type !== 'file-url') {
      throw new Error('expected nested file-url content')
    }

    expect(nested.url).toBe('https://example.test/<REDACTED:apiKey>')
  })

  it('redacts tool-result content image-url URLs', () => {
    const transformed = transform({
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
                value: [{ type: 'image-url', url: `https://example.test/${API_KEY}` }],
              },
            },
          ],
        },
      ],
    })
    const part =
      transformed.prompt[0]?.role === 'tool' ? transformed.prompt[0].content[0] : undefined

    if (!part || part.type !== 'tool-result' || part.output.type !== 'content') {
      throw new Error('expected a tool-result content output')
    }

    const nested = part.output.value[0]

    if (!nested || nested.type !== 'image-url') {
      throw new Error('expected nested image-url content')
    }

    expect(nested.url).toBe('https://example.test/<REDACTED:apiKey>')
  })

  it('redacts tool-result content file-id values', () => {
    const transformed = transform({
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
                value: [{ type: 'file-id', fileId: API_KEY }],
              },
            },
          ],
        },
      ],
    })
    const part =
      transformed.prompt[0]?.role === 'tool' ? transformed.prompt[0].content[0] : undefined

    if (!part || part.type !== 'tool-result' || part.output.type !== 'content') {
      throw new Error('expected a tool-result content output')
    }

    const nested = part.output.value[0]

    if (!nested || nested.type !== 'file-id') {
      throw new Error('expected nested file-id content')
    }

    expect(nested.fileId).toBe('<REDACTED:apiKey>')
  })

  it('redacts tool-result content image-file-id values', () => {
    const transformed = transform({
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
                value: [{ type: 'image-file-id', fileId: API_KEY }],
              },
            },
          ],
        },
      ],
    })
    const part =
      transformed.prompt[0]?.role === 'tool' ? transformed.prompt[0].content[0] : undefined

    if (!part || part.type !== 'tool-result' || part.output.type !== 'content') {
      throw new Error('expected a tool-result content output')
    }

    const nested = part.output.value[0]

    if (!nested || nested.type !== 'image-file-id') {
      throw new Error('expected nested image-file-id content')
    }

    expect(nested.fileId).toBe('<REDACTED:apiKey>')
  })

  it('redacts tool approval response reasons', () => {
    const transformed = transform({
      prompt: [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-approval-response',
              approvalId: 'approval_1',
              approved: false,
              reason: `approval ${BEARER}`,
            },
          ],
        },
      ],
    })
    const part =
      transformed.prompt[0]?.role === 'tool' ? transformed.prompt[0].content[0] : undefined

    if (!part || part.type !== 'tool-approval-response') {
      throw new Error('expected a tool approval response part')
    }

    expect(part.reason).toBe('approval <REDACTED:bearer>')
    expect(part.approvalId).toBe('approval_1')
    expect(part.approved).toBe(false)
  })

  it('leaves provider headers and non-prompt transport config untouched', () => {
    const headers = { authorization: BEARER }
    const providerOptions = { provider: { token: BEARER } }
    const tools = { lookup: { description: BEARER } }
    const transformed = transform({
      prompt: [{ role: 'user', content: [{ type: 'text', text: `prompt ${BEARER}` }] }],
      headers,
      providerOptions,
      tools,
    })

    expect(expectUserText(transformed)).toBe('prompt <REDACTED:bearer>')
    expect(transformed.headers).toBe(headers)
    expect(transformed.providerOptions).toBe(providerOptions)
    expect(transformed.tools).toBe(tools)
  })
})
