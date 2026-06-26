import { describe, expect, it } from 'vitest'
import type { ModelProfile } from '@vostride/agent-qa-schema'

import { deriveTransport } from '../auth.js'
import { validateProfile } from '../validate.js'

function profile(overrides: Partial<ModelProfile>): ModelProfile {
  return {
    provider: 'gemini',
    model: 'model-id',
    auth: { mode: 'none' },
    ...overrides,
  }
}

describe('validateProfile', () => {
  it('requires baseURL for openai-compatible profiles', () => {
    expect(() => validateProfile(profile({ provider: 'openai-compatible' }))).toThrow(
      'OpenAI-Compatible provider requires a baseURL',
    )
  })

  it('requires baseURL for anthropic-compatible profiles', () => {
    expect(() => validateProfile(profile({ provider: 'anthropic-compatible' }))).toThrow(
      'Anthropic-Compatible provider requires a baseURL',
    )
  })

  it('rejects custom headers outside anthropic-compatible without leaking values', () => {
    const secret = 'secret-sentinel-api-key'

    expect(() =>
      validateProfile(
        profile({
          provider: 'openai-compatible',
          baseURL: 'http://localhost:11434/v1',
          headers: { authorization: secret },
        }),
      ),
    ).toThrow(/OpenAI-Compatible provider custom headers are only supported on anthropic-compatible/)

    try {
      validateProfile(
        profile({
          provider: 'gemini',
          headers: { authorization: secret },
        }),
      )
    } catch (error) {
      expect((error as Error).message).not.toContain(secret)
      expect((error as Error).message).not.toContain('authorization')
    }
  })

  it('accepts anthropic-compatible profiles with baseURL and headers', () => {
    expect(() =>
      validateProfile(
        profile({
          provider: 'anthropic-compatible',
          baseURL: 'http://localhost:8080',
          headers: { 'x-routing-key': 'local' },
        }),
      ),
    ).not.toThrow()
  })

  it('accepts subscription and gemini profiles without baseURL or headers', () => {
    expect(() => validateProfile(profile({ provider: 'openai-subscription' }))).not.toThrow()
    expect(() => validateProfile(profile({ provider: 'anthropic-subscription' }))).not.toThrow()
    expect(() => validateProfile(profile({ provider: 'gemini' }))).not.toThrow()
  })
})

describe('deriveTransport', () => {
  it('flattens profile transport fields and api-key auth', () => {
    const result = deriveTransport(
      profile({
        provider: 'openai-compatible',
        baseURL: 'http://localhost:11434/v1',
        headers: { 'x-local': 'true' },
      }),
      { kind: 'api-key', apiKey: 'key-123' },
    )

    expect(result).toEqual({
      baseURL: 'http://localhost:11434/v1',
      headers: { 'x-local': 'true' },
      apiKey: 'key-123',
    })
  })

  it('maps bearer-token auth to authToken', () => {
    const result = deriveTransport(
      profile({
        provider: 'anthropic-compatible',
        baseURL: 'http://localhost:8080',
      }),
      { kind: 'bearer-token', token: 'token-123' },
    )

    expect(result.authToken).toBe('token-123')
    expect(result.apiKey).toBeUndefined()
  })

  it('supplies placeholder api keys for injected fetch and none auth', () => {
    const fetcher: typeof globalThis.fetch = async () => new Response(null)

    expect(
      deriveTransport(profile({ provider: 'openai-subscription' }), {
        kind: 'auth-fetch',
        modelAdapter: 'openai-responses',
        fetch: fetcher,
      }),
    ).toMatchObject({ apiKey: 'placeholder', fetch: fetcher })

    expect(deriveTransport(profile({ provider: 'openai-compatible' }), { kind: 'none' })).toMatchObject({
      apiKey: 'openai-compatible',
    })
  })
})
