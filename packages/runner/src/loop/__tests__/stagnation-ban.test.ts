// RED scaffold (Wave 0, Phase 358 · CYCLE-02 · D-04 · Pattern 4). Pins the ban-enforcement
// SPLIT BEFORE Plan 06 lands it. The longpress-for-tap substitution on a stagnating anchor is
// deterministically bounced in-turn (reusing the 357 D-09 groundability machinery): a
// structured is_error tool result in the SAME conversation, then the corrected tap succeeds —
// two consecutive banned emissions become a structured 'ungroundable_action' failure, never a
// throw. The wandering ban is instead a static stable-tier prompt rule (no alternate-path gate
// heuristic — a DIFFERENT-element action while an anchor stagnates passes the callback).
//
// RED BY DESIGN: the shipped planner's groundability closure is stagnation-agnostic — it
// grounds a longpress on the banned anchor and returns it, and buildSystemPrompt carries no
// wandering-ban rule. Those gaps ARE the intended failures (GREEN when Plan 06 lands).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import type { StepContext } from '../types.js'
import { LLMPlanner } from '../planner.js'
import { buildSystemPrompt } from '../prompts.js'
import { makeFakeTokenAccounting } from './loop-harness.js'

vi.mock('ai', async (importActual) => {
  const actual = await importActual<typeof import('ai')>()
  return { ...actual, generateText: vi.fn() }
})

const screen = makeScreenState() // button "Log in" is e2 (anchor button|log in|0)
const ENVELOPE = { reasoning: 'act', confidence: 0.9, stepComplete: true, doesActionAdvanceUsTowardsGoal: true }

// The Plan-06 stagnation slot on StepContext; typed locally until the production type lands.
type BanContext = Partial<StepContext> & {
  stagnation?: { bannedSubstitutions: { anchorKey: string; banned: string; required: string }[] }
}

function makeContext(overrides: BanContext = {}): StepContext {
  return {
    stepInstruction: 'Interact with Log in',
    testName: 'ban test',
    previousSteps: [],
    plannerModel: {} as never,
    verifierModel: {} as never,
    ...overrides,
  } as StepContext
}

const BANNED_LOGIN = { stagnation: { bannedSubstitutions: [{ anchorKey: 'button|log in|0', banned: 'longpress', required: 'tap' }] } }

function newPlanner() {
  return new LLMPlanner({} as never, 'ios', undefined, undefined, makeFakeTokenAccounting())
}

describe('longpress-for-tap ban — in-turn bounce (D-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('bounces a longpress on the banned anchor and the corrected tap succeeds (one-shot in-turn retry)', async () => {
    const { generateText } = await import('ai')
    const mock = vi.mocked(generateText)
    mock.mockResolvedValueOnce({ toolCalls: [{ toolName: 'mobile_longpress', input: { ref: 'e2', ...ENVELOPE } }], usage: { inputTokens: 10, outputTokens: 2 } } as never)
    mock.mockResolvedValueOnce({ toolCalls: [{ toolName: 'mobile_tap', input: { ref: 'e2', ...ENVELOPE } }], usage: { inputTokens: 10, outputTokens: 2 } } as never)

    const result = await newPlanner().plan('Interact with Log in', screen, makeContext(BANNED_LOGIN))

    expect(mock).toHaveBeenCalledTimes(2) // the ban bounced the longpress in the same turn
    expect(result.plan.action.type).toBe('tap')
  })

  it('two consecutive banned emissions surface a structured ungroundable_action failure (never a throw of another shape)', async () => {
    const { generateText } = await import('ai')
    const mock = vi.mocked(generateText)
    mock.mockResolvedValue({ toolCalls: [{ toolName: 'mobile_longpress', input: { ref: 'e2', ...ENVELOPE } }], usage: { inputTokens: 10, outputTokens: 2 } } as never)

    await expect(newPlanner().plan('Interact with Log in', screen, makeContext(BANNED_LOGIN))).rejects.toThrow(/ungroundable_action/)
  })

  it('a DIFFERENT-element action while an anchor is stagnating passes the callback (D-04 negative — no wandering gate)', async () => {
    const { generateText } = await import('ai')
    vi.mocked(generateText).mockResolvedValueOnce({ toolCalls: [{ toolName: 'mobile_longpress', input: { ref: 'e1', ...ENVELOPE } }], usage: { inputTokens: 10, outputTokens: 2 } } as never)

    // e1 is the email textbox — NOT the banned anchor. The ban must not fire on it.
    const result = await newPlanner().plan('Interact with Log in', screen, makeContext(BANNED_LOGIN))
    expect(result.plan.action.ref).toBe('e1')
  })
})

describe('wandering ban — static stable-tier prompt rule', () => {
  it('buildSystemPrompt carries the wandering-ban rule and is byte-identical across two calls', () => {
    const first = buildSystemPrompt('ios')
    const second = buildSystemPrompt('ios')
    expect(first).toBe(second) // stable tier — byte-stable, cache-safe
    expect(first.toLowerCase()).toMatch(/wander/)
  })
})
