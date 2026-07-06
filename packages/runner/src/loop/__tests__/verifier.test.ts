// Unit tests for the runner-owned LLMVerifier (353-03, D-02). The v1
// core/src/agent/__tests__/verifier.test.ts was a loop-integration test (executeStep)
// and belongs with the loop re-derivation (wave 4); these assert the verifier's own
// contract with a mocked `ai` model: structured output → VerifyResult, never-crash
// fallback, and abort rethrow (T-353-07 — abort is the only rethrow).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ScreenState } from '@vostride/agent-qa-schema'
import { asRef } from '@vostride/agent-qa-schema'
import type { Action } from '../../platform.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import { LLMVerifier } from '../verifier.js'
import { makeFakeTokenAccounting } from './loop-harness.js'

vi.mock('ai', () => ({
  generateText: vi.fn(),
  Output: {
    object: vi.fn((config: any) => config),
  },
}))

const before: ScreenState = makeScreenState()
const after: ScreenState = makeScreenState({ url: 'https://example.test/after' })
const action: Action = { type: 'click', ref: asRef('e2') }

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

    const verifier = new LLMVerifier({} as any, makeFakeTokenAccounting())
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

    const verifier = new LLMVerifier({} as any, makeFakeTokenAccounting())
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

    const verifier = new LLMVerifier({} as any, makeFakeTokenAccounting())
    await expect(
      verifier.verify('log in', before, after, action, undefined, controller.signal),
    ).rejects.toThrow('The operation was aborted')
  })

  it('throws-then-catches empty output into the fallback (never-crash)', async () => {
    const { generateText } = await import('ai')
    const mockGenerateText = vi.mocked(generateText)
    mockGenerateText.mockResolvedValueOnce({ output: undefined } as any)

    const verifier = new LLMVerifier({} as any, makeFakeTokenAccounting())
    const result = await verifier.verify('log in', before, after, action)

    expect(result.verification.success).toBe(false)
    expect(result.verification.reasoning).toContain('Verification failed')
  })

  // Phase 355-01 (CTXB-04 / D-10) — RED until Plan 06 injects the TokenAccounting port
  // into LLMVerifier and feeds recordUsage(result.usage, messages) after each response.
  it('feeds the injected TokenAccounting recordUsage exactly once per response (D-10)', async () => {
    const { generateText } = await import('ai')
    const mockGenerateText = vi.mocked(generateText)
    mockGenerateText.mockResolvedValueOnce({
      output: { success: true, reasoning: 'The dashboard is shown', isAppError: false },
      usage: { inputTokens: 120, outputTokens: 30 },
    } as any)

    const accounting = makeFakeTokenAccounting()
    const verifier = new LLMVerifier({} as any, accounting)
    await verifier.verify('log in', before, after, action)

    expect(accounting.recordUsageCalls).toHaveLength(1)
    expect(accounting.recordUsageCalls[0].messages.length).toBeGreaterThan(0)
  })

  // Phase 360-09 (EXEC-07 · D-05/D-06/D-07/D-09) — the single-model judge/extract lanes.
  describe('judgeClaim (AI judge lane, D-05/D-06)', () => {
    it('makes exactly one generateText call and maps the closed judgment schema to verdict + rationale', async () => {
      const { generateText } = await import('ai')
      const mockGenerateText = vi.mocked(generateText)
      mockGenerateText.mockResolvedValueOnce({
        output: { verdict: true, rationale: 'the welcome banner reads Welcome' },
        usage: { inputTokens: 80, outputTokens: 20 },
      } as any)

      const accounting = makeFakeTokenAccounting()
      const verifier = new LLMVerifier({} as any, accounting)
      const result = await verifier.judgeClaim('the welcome banner is visible', before, {
        consensus: 3,
        video: true,
        effort: 'high',
      })

      expect(mockGenerateText).toHaveBeenCalledTimes(1)
      expect(mockGenerateText.mock.calls[0][0].maxRetries).toBe(0)
      expect(result.verdict).toBe(true)
      expect(result.rationale).toContain('Welcome')
      // Deferred knobs (D-09) are accepted and never throw — recording is the loop's job.
      expect(accounting.recordUsageCalls).toHaveLength(1)
    })

    it('degrades an empty/invalid model output to a structured false verdict, never throws', async () => {
      const { generateText } = await import('ai')
      const mockGenerateText = vi.mocked(generateText)
      mockGenerateText.mockResolvedValueOnce({ output: undefined } as any)

      const verifier = new LLMVerifier({} as any, makeFakeTokenAccounting())
      const result = await verifier.judgeClaim('anything', before)

      expect(result.verdict).toBe(false)
      expect(result.rationale).toContain('AI judgment failed')
    })

    it('returns a structured false verdict on a non-abort model error, never throws', async () => {
      const { generateText } = await import('ai')
      const mockGenerateText = vi.mocked(generateText)
      mockGenerateText.mockRejectedValueOnce(new Error('Overloaded'))

      const verifier = new LLMVerifier({} as any, makeFakeTokenAccounting())
      const result = await verifier.judgeClaim('anything', before)

      expect(result.verdict).toBe(false)
      expect(result.rationale).toContain('Overloaded')
    })

    it('rethrows when the abort signal is aborted (the loop abort path depends on it)', async () => {
      const { generateText } = await import('ai')
      const mockGenerateText = vi.mocked(generateText)
      mockGenerateText.mockRejectedValueOnce(new Error('The operation was aborted'))

      const controller = new AbortController()
      controller.abort()
      const verifier = new LLMVerifier({} as any, makeFakeTokenAccounting())
      await expect(
        verifier.judgeClaim('anything', before, { abortSignal: controller.signal }),
      ).rejects.toThrow('The operation was aborted')
    })
  })

  describe('extractData (AI extraction lane, D-07)', () => {
    it('makes exactly one generateText call and returns the extracted field map', async () => {
      const { generateText } = await import('ai')
      const mockGenerateText = vi.mocked(generateText)
      mockGenerateText.mockResolvedValueOnce({
        output: { orderId: 'ORD-9' },
        usage: { inputTokens: 60, outputTokens: 10 },
      } as any)

      const verifier = new LLMVerifier({} as any, makeFakeTokenAccounting())
      const fields = await verifier.extractData('extract the order id', before, {
        schema: [{ name: 'orderId', type: 'string', description: 'the order id' }],
        scope: 'run',
      })

      expect(mockGenerateText).toHaveBeenCalledTimes(1)
      expect(fields).toEqual({ orderId: 'ORD-9' })
    })

    it('degrades a failed extraction to an empty map, never throws', async () => {
      const { generateText } = await import('ai')
      const mockGenerateText = vi.mocked(generateText)
      mockGenerateText.mockRejectedValueOnce(new Error('Overloaded'))

      const verifier = new LLMVerifier({} as any, makeFakeTokenAccounting())
      const fields = await verifier.extractData('extract the order id', before)

      expect(fields).toEqual({})
    })
  })
})
