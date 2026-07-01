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
