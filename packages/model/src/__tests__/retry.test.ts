import { APICallError } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'

import { isTransientError } from '../middleware/classify.js'
import { retryMiddleware } from '../middleware/retry.js'
import { stubGenerateResult, stubModel } from './stub-model.js'

const prompt = { prompt: [] }

function apiError(statusCode: number, isRetryable: boolean): APICallError {
  return new APICallError({
    message: `status ${statusCode}`,
    url: 'http://localhost/v1/chat/completions',
    requestBodyValues: {},
    statusCode,
    responseHeaders: {},
    responseBody: '',
    isRetryable,
  })
}

describe('isTransientError', () => {
  it('is true for retryable APICallError instances', () => {
    expect(isTransientError(apiError(503, true))).toBe(true)
  })

  it('is false for non-retryable APICallError instances', () => {
    expect(isTransientError(apiError(400, false))).toBe(false)
  })

  it('classifies only transient network errno codes', () => {
    expect(isTransientError({ code: 'ECONNRESET' })).toBe(true)
    expect(isTransientError({ code: 'EACCES' })).toBe(false)
  })

  it('is false for plain errors', () => {
    expect(isTransientError(new Error('plain'))).toBe(false)
  })
})

describe('retryMiddleware', () => {
  it('retries transient generate failures until success', async () => {
    let calls = 0
    const model = wrapLanguageModel({
      model: stubModel({
        async generate() {
          calls += 1
          if (calls <= 2) throw apiError(503, true)
          return stubGenerateResult([{ type: 'text', text: 'ok' }])
        },
      }),
      middleware: retryMiddleware({ initialDelayInMs: 0 }),
    })

    const result = await model.doGenerate(prompt)

    expect(calls).toBe(3)
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }])
  })

  it('does not retry non-retryable overflow errors', async () => {
    let calls = 0
    const overflow = apiError(400, false)
    const model = wrapLanguageModel({
      model: stubModel({
        async generate() {
          calls += 1
          throw overflow
        },
      }),
      middleware: retryMiddleware({ initialDelayInMs: 0 }),
    })

    await expect(model.doGenerate(prompt)).rejects.toBe(overflow)

    expect(overflow).toBeInstanceOf(APICallError)
    expect(calls).toBe(1)
  })

  it('does not retry abort errors', async () => {
    let calls = 0
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    const model = wrapLanguageModel({
      model: stubModel({
        async generate() {
          calls += 1
          throw abort
        },
      }),
      middleware: retryMiddleware({ initialDelayInMs: 0 }),
    })

    await expect(model.doGenerate(prompt)).rejects.toBe(abort)

    expect(calls).toBe(1)
  })

  it('stops retrying after maxRetries is exhausted', async () => {
    let calls = 0
    const failure = apiError(503, true)
    const model = wrapLanguageModel({
      model: stubModel({
        async generate() {
          calls += 1
          throw failure
        },
      }),
      middleware: retryMiddleware({ maxRetries: 2, initialDelayInMs: 0 }),
    })

    await expect(model.doGenerate(prompt)).rejects.toBe(failure)

    expect(calls).toBe(3)
  })
})
