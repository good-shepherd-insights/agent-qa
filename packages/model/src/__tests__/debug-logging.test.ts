import { APICallError } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import type { LanguageModelMiddleware } from 'ai'
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
} from '@ai-sdk/provider'

import { debugLoggingMiddleware } from '../middleware/debug-logging.js'

const fakeModel = { modelId: 'test-model' } as LanguageModelV3

// A benign successful generate result the wrapped `doGenerate` can resolve.
const OK_RESULT = {
  content: [],
  finishReason: { unified: 'stop', raw: 'stop' },
  usage: {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  },
  warnings: [],
} as unknown as LanguageModelV3GenerateResult

// A request carrying a secret in message content AND the maxOutputTokens param — so we can
// prove the surface logs the SHAPE (roles/counts/param keys) without leaking the secret.
function paramsWithSecret(): LanguageModelV3CallOptions {
  return {
    prompt: [
      { role: 'system', content: 'You are a tester. secret sk-SECRET123 must not leak' },
      { role: 'user', content: [{ type: 'text', text: 'plan the next step' }] },
    ],
    tools: [{ type: 'function', name: 'probe', inputSchema: { type: 'object', properties: {} } }],
    toolChoice: { type: 'required' },
    temperature: 0.5,
    maxOutputTokens: 4096,
    headers: { authorization: 'Bearer sk-SECRET123' },
  } as unknown as LanguageModelV3CallOptions
}

// A codex Responses 400 exactly like the live RUNX-01 capture.
function makeApiCallError(): APICallError {
  return new APICallError({
    message: 'Bad Request',
    url: 'https://api.openai.com/v1/responses',
    statusCode: 400,
    responseBody: '{"detail":"Unsupported parameter: max_output_tokens"}',
    requestBodyValues: {
      model: 'gpt-5.5',
      input: [{ role: 'developer' }, { role: 'user' }],
      max_output_tokens: 4096,
    },
  })
}

// Mimic the SDK: if the middleware wraps generate, drive it; otherwise call through.
async function runGenerate(
  middleware: LanguageModelMiddleware,
  doGenerate: () => Promise<LanguageModelV3GenerateResult>,
  params: LanguageModelV3CallOptions,
): Promise<LanguageModelV3GenerateResult> {
  if (!middleware.wrapGenerate) return doGenerate()
  return middleware.wrapGenerate({
    doGenerate,
    doStream: async () => { throw new Error('stream unused') },
    params,
    model: fakeModel,
  })
}

describe('debugLoggingMiddleware — enabled', () => {
  it('logs the request SHAPE (model id, message + tool counts, maxOutputTokens key) with secrets redacted', async () => {
    const lines: string[] = []
    const middleware = debugLoggingMiddleware({ enabled: true, sink: (line) => lines.push(line) })

    await runGenerate(middleware, async () => OK_RESULT, paramsWithSecret())

    expect(lines.length).toBeGreaterThanOrEqual(1)
    const requestLine = lines[0]
    expect(requestLine).toContain('test-model')
    expect(requestLine).toContain('messages=2')
    expect(requestLine).toContain('tools=1')
    // The output-cap param key is visible (it is exactly what a codex 400 rejects).
    expect(requestLine).toContain('maxOutputTokens')
    // No raw secret from message content or a header value leaks into the log.
    for (const line of lines) {
      expect(line).not.toContain('sk-SECRET123')
    }
  })

  it('logs a provider APICallError statusCode + responseBody, then re-throws the SAME error unchanged', async () => {
    const lines: string[] = []
    const middleware = debugLoggingMiddleware({ enabled: true, sink: (line) => lines.push(line) })
    const apiError = makeApiCallError()

    await expect(
      runGenerate(middleware, async () => { throw apiError }, paramsWithSecret()),
    ).rejects.toBe(apiError)

    const errorLine = lines.find((line) => line.includes('400'))
    expect(errorLine).toBeDefined()
    expect(errorLine).toContain('400')
    expect(errorLine).toContain('Unsupported parameter: max_output_tokens')
  })

  it('does not log the response body on a successful call (shape-only surface)', async () => {
    const lines: string[] = []
    const middleware = debugLoggingMiddleware({ enabled: true, sink: (line) => lines.push(line) })

    await runGenerate(middleware, async () => OK_RESULT, paramsWithSecret())

    // Exactly one line: the request shape. No response/error line on success.
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('request')
  })
})

describe('debugLoggingMiddleware — disabled (default)', () => {
  it('is a passthrough: no wrapGenerate hook, sink never called, error re-thrown unchanged', async () => {
    const lines: string[] = []
    const middleware = debugLoggingMiddleware({ enabled: false, sink: (line) => lines.push(line) })

    expect(middleware.wrapGenerate).toBeUndefined()
    expect(middleware.wrapStream).toBeUndefined()

    // Success path is silent.
    await runGenerate(middleware, async () => OK_RESULT, paramsWithSecret())
    expect(lines).toHaveLength(0)

    // Error path is silent and identity-preserving.
    const apiError = makeApiCallError()
    await expect(
      runGenerate(middleware, async () => { throw apiError }, paramsWithSecret()),
    ).rejects.toBe(apiError)
    expect(lines).toHaveLength(0)
  })
})
