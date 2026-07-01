import { simulateReadableStream } from 'ai'
import { describe, expect, it } from 'vitest'

import { createProviderRequestMiddleware } from '../../egress/provider-request-middleware'
import { createHookRegistry } from '../../hooks/registry'
import type { AuditSink, ExecutionAuditRow, GuardrailAuditRow } from '../../ports/audit-sink'
import { defaultGuardrailPolicyInput, loadGuardrailPolicy } from '../policy-loader'
import { createGuardrailStreamScan, type LanguageModelV3StreamPart } from '../stream-scan'

const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'
const BEARER = 'Bearer abcdefghijklmno12345'
const EMAIL = 'owner@example.com'

const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)

class FakeAuditSink implements AuditSink {
  readonly guardrailRows: GuardrailAuditRow[] = []

  appendExecutionAudit(_row: ExecutionAuditRow): void {
    throw new Error('execution audit should not be written by guardrail stream scan')
  }

  appendGuardrailAudit(row: GuardrailAuditRow): void {
    this.guardrailRows.push(row)
  }
}

function textDelta(delta: string, id = 'text-1'): LanguageModelV3StreamPart {
  return { type: 'text-delta', id, delta }
}

function reasoningDelta(delta: string, id = 'reasoning-1'): LanguageModelV3StreamPart {
  return { type: 'reasoning-delta', id, delta }
}

async function collect(stream: ReadableStream<LanguageModelV3StreamPart>) {
  const reader = stream.getReader()
  const parts: LanguageModelV3StreamPart[] = []

  for (;;) {
    const result = await reader.read()
    if (result.done) break
    parts.push(result.value)
  }

  return parts
}

async function scanChunks(chunks: LanguageModelV3StreamPart[], sink = new FakeAuditSink()) {
  const stream = simulateReadableStream({
    chunks,
    initialDelayInMs: null,
    chunkDelayInMs: null,
  }).pipeThrough(createGuardrailStreamScan(policy, sink)())

  return { parts: await collect(stream), sink }
}

async function runWrapStream(
  middleware: ReturnType<typeof createProviderRequestMiddleware>,
  stream: ReadableStream<LanguageModelV3StreamPart>,
) {
  if (!middleware.wrapStream) throw new Error('expected wrapStream')

  return middleware.wrapStream({
    doGenerate: async () => {
      throw new Error('doGenerate should not be called by wrapStream')
    },
    doStream: async () => ({ stream }),
    params: {} as never,
    model: {} as never,
  })
}

function textOutput(parts: LanguageModelV3StreamPart[]): string {
  return parts
    .filter((part): part is Extract<LanguageModelV3StreamPart, { type: 'text-delta' }> => {
      return part.type === 'text-delta'
    })
    .map((part) => part.delta)
    .join('')
}

function reasoningOutput(parts: LanguageModelV3StreamPart[]): string {
  return parts
    .filter((part): part is Extract<LanguageModelV3StreamPart, { type: 'reasoning-delta' }> => {
      return part.type === 'reasoning-delta'
    })
    .map((part) => part.delta)
    .join('')
}

describe('createGuardrailStreamScan', () => {
  it('redacts an AWS key split across text-delta chunks and records the durable block', async () => {
    const { parts, sink } = await scanChunks([
      textDelta(`prefix ${AWS_KEY.slice(0, 8)}`),
      textDelta(`${AWS_KEY.slice(8)} suffix`),
    ])
    const output = textOutput(parts)

    expect(output).toContain('<REDACTED:awsKey>')
    expect(output).not.toContain(AWS_KEY)
    expect(output).not.toContain(AWS_KEY.slice(0, 8))
    expect(sink.guardrailRows).toEqual([
      {
        channel: 'stream',
        action: 'block',
        detector: 'awsKey',
        redactedFingerprint: expect.any(String),
      },
    ])
  })

  it('redacts a bearer token split across text-delta chunks without leaking a prefix', async () => {
    const { parts, sink } = await scanChunks([
      textDelta(`Authorization: ${BEARER.slice(0, 12)}`),
      textDelta(`${BEARER.slice(12)} done`),
    ])
    const output = textOutput(parts)

    expect(output).toBe('Authorization: <REDACTED:bearer> done')
    expect(output).not.toContain(BEARER)
    expect(output).not.toContain(BEARER.slice(0, 12))
    expect(sink.guardrailRows.map((row) => `${row.action}:${row.detector}`)).toEqual([
      'redact:bearer',
    ])
  })

  it('redacts ordinary redact hits and writes a redact audit row', async () => {
    const { parts, sink } = await scanChunks([textDelta(`contact ${EMAIL}`)])

    expect(textOutput(parts)).toBe('contact <REDACTED:email>')
    expect(sink.guardrailRows).toEqual([
      {
        channel: 'stream',
        action: 'redact',
        detector: 'email',
        redactedFingerprint: expect.any(String),
      },
    ])
  })

  it('passes clean text through unchanged and flushes the held tail', async () => {
    const input = 'clean text before the holdback tail\nand ordinary trailing prose'
    const { parts, sink } = await scanChunks([textDelta(input.slice(0, 12)), textDelta(input.slice(12))])

    expect(textOutput(parts)).toBe(input)
    expect(sink.guardrailRows).toEqual([])
  })

  it('passes non-text stream parts through untouched and in order', async () => {
    const textStart: LanguageModelV3StreamPart = { type: 'text-start', id: 'text-1' }
    const toolCall: LanguageModelV3StreamPart = {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'lookup',
      input: '{"query":"safe"}',
    }
    const textEnd: LanguageModelV3StreamPart = { type: 'text-end', id: 'text-1' }
    const finish: LanguageModelV3StreamPart = {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
    }
    const chunks = [textStart, toolCall, textEnd, finish]
    const { parts, sink } = await scanChunks(chunks)

    expect(parts).toEqual(chunks)
    expect(sink.guardrailRows).toEqual([])
  })

  it('scans reasoning-delta content with the same boundary protection', async () => {
    const { parts, sink } = await scanChunks([
      reasoningDelta(`reason ${BEARER.slice(0, 13)}`),
      reasoningDelta(`${BEARER.slice(13)} tail`),
    ])

    expect(reasoningOutput(parts)).toBe('reason <REDACTED:bearer> tail')
    expect(reasoningOutput(parts)).not.toContain(BEARER.slice(0, 13))
    expect(sink.guardrailRows.map((row) => `${row.action}:${row.detector}`)).toEqual([
      'redact:bearer',
    ])
  })

  it('flush-scans a secret that was wholly retained inside the holdback tail', async () => {
    const { parts, sink } = await scanChunks([textDelta(`tail-only ${AWS_KEY}`)])
    const output = textOutput(parts)

    expect(output).toBe('tail-only <REDACTED:awsKey>')
    expect(output).not.toContain(AWS_KEY)
    expect(sink.guardrailRows.map((row) => `${row.action}:${row.detector}`)).toEqual([
      'block:awsKey',
    ])
  })
})

describe('createProviderRequestMiddleware stream attachment', () => {
  it('pipes wrapStream through the guardrail stream scan when provided', async () => {
    const sink = new FakeAuditSink()
    const middleware = createProviderRequestMiddleware(
      createHookRegistry(),
      createGuardrailStreamScan(policy, sink),
    )
    const rawStream = simulateReadableStream({
      chunks: [textDelta(`prefix ${AWS_KEY.slice(0, 8)}`), textDelta(`${AWS_KEY.slice(8)} suffix`)],
      initialDelayInMs: null,
      chunkDelayInMs: null,
    })

    const result = await runWrapStream(middleware, rawStream)
    const output = textOutput(await collect(result.stream))

    expect(output).toBe('prefix <REDACTED:awsKey> suffix')
    expect(output).not.toContain(AWS_KEY)
    expect(sink.guardrailRows.map((row) => `${row.action}:${row.detector}`)).toEqual([
      'block:awsKey',
    ])
  })

  it('keeps wrapStream as a passthrough when no stream scan is provided', async () => {
    const middleware = createProviderRequestMiddleware(createHookRegistry())
    const rawStream = simulateReadableStream({
      chunks: [textDelta(`raw ${AWS_KEY}`)],
      initialDelayInMs: null,
      chunkDelayInMs: null,
    })

    const result = await runWrapStream(middleware, rawStream)

    expect(textOutput(await collect(result.stream))).toBe(`raw ${AWS_KEY}`)
  })
})
