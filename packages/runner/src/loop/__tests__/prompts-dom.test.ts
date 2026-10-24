// Ported from core/src/agent/__tests__/prompts-dom.test.ts (353-03, D-02).
// Adaptation: D-10 dropped healingConfig from StepContext — removed from fixtures.
//
// 355-02 redirect (Wave-0, RED pending Plan 03): the monolithic step-prompt builder is
// retired. The DOM supplementary-context block now rides in the per-turn observation
// message emitted by `composeTurnMessages(...)` (D-04 — per-turn state out of the cached
// prefix). Every content assertion is preserved byte-for-byte; only the producing call changes.
import { describe, it, expect } from 'vitest'
import type { ModelMessage } from 'ai'
import type { ScreenState } from '@vostride/agent-qa-schema'
import type { StepContext } from '../types.js'
// Plan-03 turn API — intentionally unresolved today (the RED reason for this suite):
import { composeTurnMessages } from '../prompts.js'
import { buildAgentScreenState, type LooseScreenState } from './screen-fixtures.js'

function makeScreenState(overrides: LooseScreenState = {}): ScreenState {
  return buildAgentScreenState({
    tree: 'button "Sign In" [ref=btn-1]',
    elements: [
      { ref: 'btn-1', role: 'button', name: 'Sign In', attributes: {} },
    ],
    url: 'https://example.com/login',
    timestamp: Date.now(),
    metadata: { coordSpace: 'viewport', viewportWidth: 0, viewportHeight: 0 },
    ...overrides,
  })
}

function makeStepContext(overrides?: Partial<StepContext>): StepContext {
  return {
    stepInstruction: 'Click login button',
    testName: 'Login test',
    previousSteps: [],
    plannerModel: {} as any,
    verifierModel: {} as any,
    ...overrides,
  }
}

// Concatenate the text parts of the per-turn ModelMessage[] into one rendered string
// so the existing content assertions run unchanged against the turn content.
function renderTurn(messages: ModelMessage[]): string {
  return messages
    .map((m) =>
      typeof m.content === 'string'
        ? m.content
        : m.content
            .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
            .join(''),
    )
    .join('\n')
}

describe('turn content with DOM context (was step-prompt with DOM context)', () => {
  it('includes DOM context when metadata has domContext', () => {
    const context = makeStepContext()
    const screenState = makeScreenState({
      metadata: { coordSpace: 'viewport' as const, viewportWidth: 0, viewportHeight: 0, domContext: 'div\n  button "Click me"' },
    })

    const result = renderTurn(composeTurnMessages(context, screenState))

    expect(result).toContain('DOM structure (supplementary context')
    expect(result).toContain('div\n  button "Click me"')
  })

  it('excludes DOM context when metadata.domContext absent', () => {
    const context = makeStepContext()
    const screenState = makeScreenState({ metadata: { coordSpace: 'viewport' as const, viewportWidth: 0, viewportHeight: 0 } })

    const result = renderTurn(composeTurnMessages(context, screenState))

    expect(result).not.toContain('DOM structure')
  })

  it('DOM context is included in full without truncation', () => {
    const longDom = 'div\n' + '  span "Some text content here"\n'.repeat(500)
    const context = makeStepContext()
    const screenState = makeScreenState({
      metadata: { coordSpace: 'viewport' as const, viewportWidth: 0, viewportHeight: 0, domContext: longDom },
    })

    const result = renderTurn(composeTurnMessages(context, screenState))

    expect(result).toContain('DOM structure (supplementary context')
    expect(result).toContain(longDom)
  })
})
