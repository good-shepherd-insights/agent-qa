import { APICallError } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

import { isContextOverflow, parseRealWindow } from '../capability/overflow-parse.js'

function apiError(
  statusCode: number,
  isRetryable: boolean,
  message = `status ${statusCode}`,
  responseBody = '',
): APICallError {
  return new APICallError({
    message,
    url: 'http://localhost/v1/chat/completions',
    requestBodyValues: {},
    statusCode,
    responseHeaders: {},
    responseBody,
    isRetryable,
  })
}

describe('parseRealWindow', () => {
  it('parses the OpenAI context length format', () => {
    expect(parseRealWindow(apiError(
      400,
      false,
      "This model's maximum context length is 128000 tokens. However, you requested 130000 tokens",
    ))).toBe(128000)
  })

  it('parses the Anthropic prompt-too-long format', () => {
    expect(parseRealWindow(apiError(
      400,
      false,
      'prompt is too long: 215534 tokens > 200000 maximum',
    ))).toBe(200000)
  })

  it('parses the Google maximum tokens format', () => {
    expect(parseRealWindow(apiError(
      400,
      false,
      'The input token count (1236488) exceeds the maximum number of tokens allowed (1048576).',
    ))).toBe(1048576)
  })

  it('also reads provider response bodies', () => {
    expect(parseRealWindow(apiError(
      400,
      false,
      'provider error',
      "This model's maximum context length is 32768 tokens.",
    ))).toBe(32768)
  })

  it('rejects out-of-range values', () => {
    expect(parseRealWindow(apiError(400, false, 'maximum context length is 999999999 tokens'))).toBeUndefined()
    expect(parseRealWindow(apiError(400, false, 'maximum context length is 0 tokens'))).toBeUndefined()
    expect(parseRealWindow(apiError(400, false, 'maximum context length is -1 tokens'))).toBeUndefined()
  })

  it('ignores non-overflow errors', () => {
    expect(parseRealWindow(apiError(503, true, 'maximum context length is 128000 tokens'))).toBeUndefined()
    expect(parseRealWindow(new Error('plain'))).toBeUndefined()
  })
})

describe('isContextOverflow', () => {
  it('is true only for parsable 400 overflow errors', () => {
    expect(isContextOverflow(apiError(400, false, 'maximum context length is 128000 tokens'))).toBe(true)
    expect(isContextOverflow(apiError(400, false, 'different bad request'))).toBe(false)
    expect(isContextOverflow(apiError(503, true, 'maximum context length is 128000 tokens'))).toBe(false)
  })
})
