// Unit tests for the runner-owned LLMVerifier (353-03, D-02). The v1
// core/src/agent/__tests__/verifier.test.ts was a loop-integration test (executeStep)
// and belongs with the loop re-derivation (wave 4); these assert the verifier's own
// contract with a mocked `ai` model: structured output → VerifyResult, never-crash
// fallback, and abort rethrow (T-353-07 — abort is the only rethrow).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ScreenState } from '@vostride/agent-qa-schema'
import type { Action } from '../../platform.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import { LLMVerifier } from '../verifier.js'

vi.mock('ai', () => ({
  generateText: vi.fn(),
  Output: {
    object: vi.fn((config: any) => config),
  },
}))

const before: ScreenState = makeScreenState()
const after: ScreenState = makeScreenState({ url: 'https://example.test/after' })
const action: Action = { type: 'click', ref: 'e2' }

describe('LLMVerifier', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps structured verification output to VerifyResult (success/reasoning/isAppError)', async () => {
    const { generateText } = await import('ai')
    const mockGenerateText = vi.mocked(generateText)
    mockGenerateText.mockResolvedValueOnce({
      output: { success: true, reasoning: 'The login form submitted and the dashboard is shown', isAppError: false },
      usage: { inputTokens: 120, outputTokens: 30 },
    } as any)

    const verifier = new LLMVerifier({} as any)
    const result = await verifier.verify('log in', before, after, action)

    expect(result.verification.success).toBe(true)
    expect(result.verification.reasoning).toContain('dashboard')
    expect(result.verification.isAppError).toBe(false)
    expect(result.tokenUsage).toEqual({ promptTokens: 120, completionTokens: 30, totalTokens: 150 })
  })

  it('returns the failed-verification fallback on a non-abort model error, never throws', async () => {
    const { generateText } = await import('ai')
    const mockGenerateText = vi.mocked(generateText)
    mockGenerateText.mockRejectedValueOnce(new Error('Overloaded'))

    const verifier = new LLMVerifier({} as any)
    const result = await verifier.verify('log in', before, after, action)

    expect(result.verification.success).toBe(false)
    expect(result.verification.isAppError).toBe(false)
    expect(result.verification.reasoning).toContain('Verification failed')
    expect(result.verification.reasoning).toContain('Overloaded')
  })

  it('rethrows when the abort signal is aborted (the loop abort path depends on it)', async () => {
    const { generateText } = await import('ai')
    const mockGenerateText = vi.mocked(generateText)
    const abortError = new Error('The operation was aborted')
    mockGenerateText.mockRejectedValueOnce(abortError)

    const controller = new AbortController()
    controller.abort()

    const verifier = new LLMVerifier({} as any)
    await expect(
      verifier.verify('log in', before, after, action, undefined, controller.signal),
    ).rejects.toThrow('The operation was aborted')
  })

  it('throws-then-catches empty output into the fallback (never-crash)', async () => {
    const { generateText } = await import('ai')
    const mockGenerateText = vi.mocked(generateText)
    mockGenerateText.mockResolvedValueOnce({ output: undefined } as any)

    const verifier = new LLMVerifier({} as any)
    const result = await verifier.verify('log in', before, after, action)

    expect(result.verification.success).toBe(false)
    expect(result.verification.reasoning).toContain('Verification failed')
  })
})
