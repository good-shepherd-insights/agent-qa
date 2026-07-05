// Ported from core/src/agent/__tests__/prompts-memory.test.ts (353-03, D-02).
//
// 355-02 rewrite (Wave-0, RED pending Plan 03): the v1 opaque single memory-context
// string slot is retired and SPLIT into the two v2 channels (D-12/D-13):
//   - the knowledge brief → the VOLATILE system tier (`buildVolatileTier`), framed as
//     hypotheses (L3, not commands), above the cache breakpoint;
//   - working memory → structured TURN content (`composeTurnMessages`), below the system
//     region, injected as its own turn message (empty slot omitted).
// No single opaque memory string survives. Failing reason is exactly the not-yet-
// implemented tier/turn API (missing exports) + the new StepContext slots until Plan 03.
import { describe, it, expect } from 'vitest'
import type { ModelMessage, SystemModelMessage } from 'ai'
import type { ScreenState } from '@vostride/agent-qa-schema'
import type { StepContext } from '../types.js'
// Plan-03 tier/turn API — intentionally unresolved today (the RED reason for this suite):
import { buildVolatileTier, composeTurnMessages } from '../prompts.js'
import { buildAgentScreenState } from './screen-fixtures.js'

// The two v2 memory slots on StepContext (D-12/D-13): knowledgeBrief (volatile tier) and
// workingMemory (structured turn content). Phase 358 broke workingMemory from the plain-string
// slot to the structured `WorkingMemoryEntry[]` set (sanctioned, no shim) — the fixtures below
// construct entry arrays and assert the value reaches the planner turn verbatim.
type MemoryContext = Partial<StepContext>

function makeScreenState(): ScreenState {
  return buildAgentScreenState({
    tree: '',
    elements: [],
    timestamp: Date.now(),
    metadata: { coordSpace: 'viewport', viewportWidth: 0, viewportHeight: 0 },
  })
}

function makeStepContext(overrides?: MemoryContext): StepContext {
  return {
    stepInstruction: 'Click login button',
    testName: 'Login test',
    previousSteps: [],
    plannerModel: {} as any,
    verifierModel: {} as any,
    ...overrides,
  } as StepContext
}

function volatileText(context: StepContext): string {
  const tier = buildVolatileTier(context) as SystemModelMessage
  return typeof tier.content === 'string' ? tier.content : JSON.stringify(tier.content)
}

function renderOne(m: ModelMessage): string {
  return typeof m.content === 'string'
    ? m.content
    : m.content
        .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
        .join('')
}

function renderTurn(messages: ModelMessage[]): string {
  return messages.map(renderOne).join('\n')
}

describe('knowledge brief channel — volatile tier (D-12/D-13)', () => {
  it('renders the knowledge brief in the volatile tier framed as hypotheses (L3, not commands)', () => {
    const brief = 'Login modal appears after clicking Sign In (trust: 0.80)'
    const context = makeStepContext({ knowledgeBrief: brief })
    const volatile = volatileText(context)

    expect(volatile).toContain('Knowledge brief')
    expect(volatile).toContain(brief)
    // Framed as hypotheses to trust-check against live observation — never as commands.
    expect(volatile.toLowerCase()).toContain('hypothes')
  })

  it('renders no brief section and omits the slot when the brief is absent', () => {
    const context = makeStepContext({ knowledgeBrief: undefined })
    const volatile = volatileText(context)

    expect(volatile).not.toContain('Knowledge brief')
  })
})

describe('working memory channel — structured turn content (D-12/D-13)', () => {
  it('emits a working-memory turn message from composeTurnMessages when the slot is set', () => {
    const emailValue = 'test@example.com'
    const context = makeStepContext({
      workingMemory: [{ key: 'email', value: emailValue, kind: 'extracted-value', provenance: 'observation' }],
    })
    const messages = composeTurnMessages(context, makeScreenState())

    // The verbatim captured value reaches the planner turn (structured entry rendering).
    expect(renderTurn(messages)).toContain(emailValue)
    expect(renderTurn(messages)).toContain('email')
  })

  it('omits the working-memory message entirely when the slot is empty (D-12 empty-slot omission)', () => {
    const context = makeStepContext({ workingMemory: undefined })
    const messages = composeTurnMessages(context, makeScreenState())

    // No blank/degenerate message is pushed for the empty slot.
    expect(messages.every((m) => renderOne(m).trim().length > 0)).toBe(true)
    expect(renderTurn(messages)).not.toContain('Working memory')
  })
})

describe('the two channels are distinct (D-04/D-13)', () => {
  it('keeps the brief above the breakpoint (volatile tier) and working memory in turn content', () => {
    const brief = 'Login modal appears after clicking Sign In (trust: 0.80)'
    const emailValue = 'test@example.com'
    const context = makeStepContext({
      knowledgeBrief: brief,
      workingMemory: [{ key: 'email', value: emailValue, kind: 'extracted-value', provenance: 'observation' }],
    })

    const volatile = volatileText(context)
    const turn = renderTurn(composeTurnMessages(context, makeScreenState()))

    // Brief lives in the cached volatile system tier, never leaking into turn content.
    expect(volatile).toContain(brief)
    expect(turn).not.toContain(brief)
    // Working memory lives in turn content (below the system region), never in the tier.
    expect(turn).toContain(emailValue)
    expect(volatile).not.toContain(emailValue)
  })
})
