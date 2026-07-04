// Unit tests for the runner-owned LLMPlanner (353-02 Task 1, D-02). Ported from v1's
// scripted-fake-LanguageModel pattern: a mocked `ai.generateText` returns a scripted
// tool call and the planner projects it into a PlanResult. `tool` stays real (only
// generateText is replaced) so buildTools produces the true v45 slice. Behaviors:
//   1. a scripted tool-call response → PlanResult with the parsed ActionPlan envelope
//   2. screenshot send failure → retry once without the image, prompt annotated
//   3. arg extraction tolerates the args/input SDK key variants
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ScreenState } from '@vostride/agent-qa-schema'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import type { StepContext } from '../types.js'
import { LLMPlanner } from '../planner.js'
import { makeFakeTokenAccounting } from './loop-harness.js'

vi.mock('ai', async (importActual) => {
  const actual = await importActual<typeof import('ai')>()
  return { ...actual, generateText: vi.fn() }
})

const screen: ScreenState = makeScreenState()

function makeContext(overrides: Partial<StepContext> = {}): StepContext {
  return {
    stepInstruction: 'Click sign in',
    testName: 'login test',
    previousSteps: [],
    plannerModel: {} as never,
    verifierModel: {} as never,
    ...overrides,
  }
}

const CLICK_ENVELOPE = {
  reasoning: 'Click the Sign In button to submit',
  confidence: 0.9,
  stepComplete: true,
  doesActionAdvanceUsTowardsGoal: true,
}

describe('LLMPlanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('projects a scripted tool call into a PlanResult with the v45 envelope intact (D-09)', async () => {
    const { generateText } = await import('ai')
    vi.mocked(generateText).mockResolvedValueOnce({
      toolCalls: [{ toolName: 'web_click', input: { ref: 'e1', ...CLICK_ENVELOPE } }],
      usage: { inputTokens: 100, outputTokens: 20 },
    } as never)

    const planner = new LLMPlanner({} as never, 'web', undefined, undefined, makeFakeTokenAccounting())
    const result = await planner.plan('Click sign in', screen, makeContext())

    expect(result.plan.action.type).toBe('click')
    expect(result.plan.action.ref).toBe('e1')
    expect(result.plan.reasoning).toBe(CLICK_ENVELOPE.reasoning)
    expect(result.plan.confidence).toBe(0.9)
    expect(result.plan.stepComplete).toBe(true)
    expect(result.tokenUsage).toEqual({ promptTokens: 100, completionTokens: 20, totalTokens: 120 })
  })

  it('retries once without the image when the screenshot send fails, annotating the prompt', async () => {
    const { generateText } = await import('ai')
    const mock = vi.mocked(generateText)
    mock.mockRejectedValueOnce(new Error('image payload too large'))
    mock.mockResolvedValueOnce({
      toolCalls: [{ toolName: 'web_click', input: { ref: 'e1', ...CLICK_ENVELOPE } }],
      usage: { inputTokens: 80, outputTokens: 10 },
    } as never)

    const planner = new LLMPlanner({} as never, 'web', undefined, undefined, makeFakeTokenAccounting())
    const result = await planner.plan('Click sign in', screen, makeContext({ screenshot: Buffer.from('png') }))

    expect(mock).toHaveBeenCalledTimes(2)
    // first call carried the image; the fallback turn retries with a text-only user
    // message carrying the note (the planning turn always drives via `messages`).
    const fallbackArgs = mock.mock.calls[1][0] as { messages?: { content?: unknown }[] }
    expect(JSON.stringify(fallbackArgs.messages)).toContain('Visual screenshot is unavailable')
    expect(result.plan.action.type).toBe('click')
  })

  it('tolerates the `args` tool-call key variant as well as `input`', async () => {
    const { generateText } = await import('ai')
    vi.mocked(generateText).mockResolvedValueOnce({
      toolCalls: [{ toolName: 'web_click', args: { ref: 'e2', ...CLICK_ENVELOPE } }],
      usage: { inputTokens: 50, outputTokens: 5 },
    } as never)

    const planner = new LLMPlanner({} as never, 'web', undefined, undefined, makeFakeTokenAccounting())
    const result = await planner.plan('Click sign in', screen, makeContext())

    expect(result.plan.action.type).toBe('click')
    expect(result.plan.action.ref).toBe('e2')
  })

  // Phase 355-01 (CTXB-04 / D-10) — RED until Plan 05 injects the TokenAccounting port
  // into LLMPlanner and feeds recordUsage(result.usage, messages) after each response.
  it('feeds the injected TokenAccounting recordUsage exactly once per response (D-10)', async () => {
    const { generateText } = await import('ai')
    vi.mocked(generateText).mockResolvedValueOnce({
      toolCalls: [{ toolName: 'web_click', input: { ref: 'e1', ...CLICK_ENVELOPE } }],
      usage: { inputTokens: 100, outputTokens: 20 },
    } as never)

    const accounting = makeFakeTokenAccounting()
    const planner = new LLMPlanner({} as never, 'web', undefined, undefined, accounting)
    await planner.plan('Click sign in', screen, makeContext())

    expect(accounting.recordUsageCalls).toHaveLength(1)
    expect(accounting.recordUsageCalls[0].messages.length).toBeGreaterThan(0)
  })
})
