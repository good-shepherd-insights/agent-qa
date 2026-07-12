// Wave-0 (test-first) scaffold for Phase 355 CTXB-01/CTXB-02 — the three cache-ordered
// planner-prompt tiers (stable / context / volatile), the single Anthropic cache_control
// breakpoint on the context message, and the per-turn-state decomposition.
//
// RED BY DESIGN: `buildContextTier`, `buildVolatileTier`, and `composeTurnMessages` do
// not exist until Plan 03 rebuilds prompts.ts into tiers. `buildSystemPrompt` (the stable
// tier) already exists and is unchanged. The failing reason must be exactly the
// not-yet-implemented tier builders (a missing-export / not-a-function error naming the
// symbol) — never a typo or wrong fixture. Plan 03 turns this GREEN.
//
// Contract these tests pin (per CONTEXT D-04/D-05/D-06/D-07/D-09/D-12):
//   - buildContextTier(context)  → SystemModelMessage (role:'system'); carries the ONE
//                                   ephemeral breakpoint under providerOptions.anthropic.cacheControl.
//   - buildVolatileTier(context) → SystemModelMessage (role:'system'); NO breakpoint; a
//                                   date-granularity stamp; renders no 'Knowledge brief'
//                                   section when the brief slot is empty.
//   - composeTurnMessages(context, screenState) → ModelMessage[]; the per-turn state
//                                   (screen tree, previous steps, sub-action history) lives
//                                   here and NEVER in the system tiers; empty slots omitted.
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ModelMessage, SystemModelMessage } from 'ai'
import type { ScreenState } from '@vostride/agent-qa-schema'
import type { StepContext } from '../types.js'
import { buildAgentScreenState, type LooseScreenState } from './screen-fixtures.js'
import {
  buildSystemPrompt,
  // Plan-03 tier API — intentionally unresolved today (the RED reason for this suite):
  buildContextTier,
  buildVolatileTier,
  composeTurnMessages,
} from '../prompts.js'

const PREV_STEP_INSTRUCTION = 'navigate to the login page'
const SCREEN_TREE_TOKEN = 'Sign In'

function makeContext(overrides: Partial<StepContext> = {}): StepContext {
  return {
    stepInstruction: 'click the Sign In button',
    testName: 'login test',
    suiteContext: 'E-commerce checkout suite',
    testContext: 'User can sign in with valid credentials',
    previousSteps: [],
    plannerModel: {} as never,
    verifierModel: {} as never,
    ...overrides,
  }
}

function makeScreenState(overrides: LooseScreenState = {}): ScreenState {
  return buildAgentScreenState({
    tree: `- button "${SCREEN_TREE_TOKEN}" [ref=e1]`,
    elements: [{ ref: 'e1', role: 'button', name: SCREEN_TREE_TOKEN, attributes: {} }],
    metadata: { coordSpace: 'viewport', viewportWidth: 0, viewportHeight: 0 },
    ...overrides,
  })
}

// The planner `system` value: an ordered [stable, context, volatile] array. Stable is
// wrapped from the (unchanged) string builder; context/volatile are Plan-03 tier builders.
function buildPlannerSystem(
  ctx: StepContext,
  platform: 'web' | 'android' | 'ios' = 'web',
): SystemModelMessage[] {
  const stable: SystemModelMessage = { role: 'system', content: buildSystemPrompt(platform) }
  const context = buildContextTier(ctx) as SystemModelMessage
  const volatile = buildVolatileTier(ctx) as SystemModelMessage
  return [stable, context, volatile]
}

function contentText(content: SystemModelMessage['content'] | ModelMessage['content']): string {
  return typeof content === 'string' ? content : JSON.stringify(content)
}

function cacheControlOf(message: SystemModelMessage): unknown {
  return (message.providerOptions as Record<string, { cacheControl?: unknown }> | undefined)?.anthropic?.cacheControl
}

afterEach(() => {
  vi.useRealTimers()
})

describe('planner system tiers — ordering (CTXB-01 / D-04)', () => {
  it('assembles system as an ordered [stable, context, volatile] array of role:system messages', () => {
    const system = buildPlannerSystem(makeContext())
    expect(system).toHaveLength(3)
    expect(system.every((m) => m.role === 'system')).toBe(true)
    // The context tier carries the app/suite/test framing (byte-stable per run).
    expect(contentText(system[1].content)).toContain('E-commerce checkout suite')
  })
})

describe('planner system tiers — single cache breakpoint (CTXB-01 / D-05)', () => {
  it('places exactly one ephemeral cache_control breakpoint, on the context message', () => {
    const system = buildPlannerSystem(makeContext())
    expect(cacheControlOf(system[1])).toEqual({ type: 'ephemeral' })
    // Stable (above) and volatile (below) carry no breakpoint — exactly one breakpoint total.
    expect(cacheControlOf(system[0])).toBeUndefined()
    expect(cacheControlOf(system[2])).toBeUndefined()
  })
})

describe('planner system tiers — cached-prefix byte-stability (CTXB-01 / D-05/D-07)', () => {
  it('keeps stable + context tiers byte-identical across two turns of the same run', () => {
    const ctx = makeContext()
    const first = buildPlannerSystem(ctx)
    const second = buildPlannerSystem(ctx)
    // Everything at or above the breakpoint (stable + context) must be byte-stable.
    expect(contentText(second[0].content)).toBe(contentText(first[0].content))
    expect(contentText(second[1].content)).toBe(contentText(first[1].content))
  })
})

describe('volatile tier — date-granularity stamp (CTXB-01 / D-07)', () => {
  it('stamps the volatile tier at date granularity (identical bytes across two intra-day clock times)', () => {
    const ctx = makeContext()
    vi.useFakeTimers()

    vi.setSystemTime(new Date('2026-07-05T09:00:00Z'))
    const morning = contentText((buildVolatileTier(ctx) as SystemModelMessage).content)

    vi.setSystemTime(new Date('2026-07-05T15:37:42Z'))
    const afternoon = contentText((buildVolatileTier(ctx) as SystemModelMessage).content)

    // Same calendar day → identical bytes (minute/second precision would bust the KV cache).
    expect(afternoon).toBe(morning)
  })
})

describe('per-turn state placement (CTXB-01 / D-04/D-09)', () => {
  it('emits per-turn screen/history state as turn messages, never in the system tiers', () => {
    const ctx = makeContext({
      previousSteps: [{ instruction: PREV_STEP_INSTRUCTION, outcome: 'passed' }],
      // Leakage probe: a sub-action token that cannot collide with the fixed stable-tier
      // rule text. (The literal "scroll down" appears verbatim in Rule 3 and Rule 14 of
      // buildSystemPrompt — Rule 14's "scroll down for content at the bottom" is pinned
      // by the qa-mindset suite — so it is unusable as an isolation probe.)
      subActionHistory: [{ action: 'expand the accordion panel', result: 'success' }],
    })
    const screen = makeScreenState()

    const system = buildPlannerSystem(ctx)
    const messages = composeTurnMessages(ctx, screen)

    const systemText = system.map((m) => contentText(m.content)).join('\n')
    const messagesText = JSON.stringify(messages)

    // Per-turn state (screen tree, previous steps, sub-action history) lives in messages...
    expect(messagesText).toContain(SCREEN_TREE_TOKEN)
    expect(messagesText).toContain(PREV_STEP_INSTRUCTION)
    expect(messagesText).toContain('expand the accordion panel')

    // ...and never leaks into the cached system prefix.
    expect(systemText).not.toContain(SCREEN_TREE_TOKEN)
    expect(systemText).not.toContain(PREV_STEP_INSTRUCTION)
    expect(systemText).not.toContain('expand the accordion panel')
  })
})

describe('empty ingredient slots (CTXB-02 / D-12)', () => {
  it('omits working-memory and brief messages entirely when those slots are empty', () => {
    const ctx = makeContext() // no knowledgeBrief, no workingMemory
    const screen = makeScreenState()

    const messages = composeTurnMessages(ctx, screen)
    // No blank/degenerate message is pushed for an empty slot.
    expect(messages.every((m) => contentText(m.content).trim().length > 0)).toBe(true)

    // The volatile tier renders no 'Knowledge brief' section when the brief is unbound.
    const volatile = contentText((buildVolatileTier(ctx) as SystemModelMessage).content)
    expect(volatile).not.toContain('Knowledge brief')
  })
})

describe('non-Anthropic provider no-op (CTXB-01 / D-05)', () => {
  it('lets a non-Anthropic run read identical tier content while ignoring providerOptions.anthropic', () => {
    const context = buildContextTier(makeContext()) as SystemModelMessage
    // A non-Anthropic provider passes the message through untouched (a plain object spread
    // mirrors the SDK no-op: the anthropic-namespaced key is simply never parsed).
    const merged = { ...context }
    expect(() => JSON.stringify(merged)).not.toThrow()
    expect(contentText(merged.content)).toBe(contentText(context.content))
    // Reading/ignoring the anthropic namespace never throws on a non-Anthropic run.
    expect(() => (merged.providerOptions as Record<string, unknown> | undefined)?.anthropic).not.toThrow()
  })
})
