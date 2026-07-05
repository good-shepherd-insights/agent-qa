// RED scaffold (Wave 0, Phase 358 · CYCLE-02/03 · D-04/D-07/D-08 · Pitfall 3). Pins the
// per-turn stagnation/cycle-break/bulk-predicate prompt rendering BEFORE Plan 06 lands it.
// These are per-turn VOLATILE state ⇒ they ride composeTurnMessages ONLY, never the cached
// system tiers (buildSystemPrompt / buildContextTier / buildVolatileTier) — cache-busting the
// prefix is Pitfall 3. This suite also pins the DELETION of the v1 anti-repetition warning
// (§12.16 names it as the thing being replaced) via a negative assertion on the composed
// sub-action history output.
//
// RED BY DESIGN: the shipped composeTurnMessages ignores the (Plan-06) context.stagnation /
// context.cycleBreak / context.bulkCompletionPredicate slots and still emits the v1 "Do NOT
// repeat" warning — that mismatch IS the intended failure (GREEN when Plan 06 lands).
import { describe, it, expect } from 'vitest'
import type { ModelMessage } from 'ai'
import type { ScreenState } from '@vostride/agent-qa-schema'
import type { StepContext } from '../types.js'
import {
  composeTurnMessages,
  buildSystemPrompt,
  buildContextTier,
  buildVolatileTier,
} from '../prompts.js'
import { buildAgentScreenState } from './screen-fixtures.js'

// Plan-06 adds these per-turn slots to StepContext; typed locally so the fixture reads
// cleanly before the production type lands.
type ProgressContext = Partial<StepContext> & {
  stagnation?: { classification: string; anchor: { role: string; nameNormalized: string; ordinal: number }; diff: string; bannedSubstitutions?: unknown[] }
  cycleBreak?: { revisitedKey: string; windowSummary: string }
  bulkCompletionPredicate?: string
}

function makeContext(overrides: ProgressContext = {}): StepContext {
  return {
    stepInstruction: 'Delete all rows',
    testName: 'bulk delete test',
    previousSteps: [],
    plannerModel: {} as never,
    verifierModel: {} as never,
    ...overrides,
  } as StepContext
}

function makeScreen(): ScreenState {
  return buildAgentScreenState({
    tree: '- button "Delete" [ref=e1]',
    elements: [{ ref: 'e1', role: 'button', name: 'Delete', attributes: {} }],
    metadata: { coordSpace: 'viewport', viewportWidth: 390, viewportHeight: 844 },
  })
}

function renderOne(m: ModelMessage): string {
  return typeof m.content === 'string'
    ? m.content
    : m.content.map((p) => ('text' in p && typeof p.text === 'string' ? p.text : '')).join('')
}

function renderTurn(messages: ModelMessage[]): string {
  return messages.map(renderOne).join('\n')
}

function systemText(context: StepContext): string {
  const context1 = buildContextTier(context)
  const volatile = buildVolatileTier(context)
  const asText = (c: unknown): string => (typeof c === 'string' ? c : JSON.stringify(c))
  return [buildSystemPrompt('web'), asText(context1.content), asText(volatile.content)].join('\n')
}

describe('composeTurnMessages — stagnation block (D-07)', () => {
  it('renders a stagnation block (classification + anchor + raw diff facts) when context.stagnation is set', () => {
    const context = makeContext({
      stagnation: { classification: 'off-screen', anchor: { role: 'button', nameNormalized: 'delete', ordinal: 0 }, diff: 'target bounds below the viewport' },
    })
    const turn = renderTurn(composeTurnMessages(context, makeScreen()))
    expect(turn).toContain('off-screen')
    expect(turn).toContain('delete')
    expect(turn).toContain('target bounds below the viewport')
  })

  it('omits the stagnation block entirely when unset', () => {
    const turn = renderTurn(composeTurnMessages(makeContext(), makeScreen()))
    expect(turn).not.toContain('off-screen')
  })
})

describe('composeTurnMessages — cycle-break block (D-08)', () => {
  it('renders a cycle-break block (revisited key + window summary + change-approach-or-stepFailed) when set', () => {
    const context = makeContext({
      cycleBreak: { revisitedKey: 'HASH:/menu', windowSummary: 'no confirmed progress across 5 iterations' },
    })
    const turn = renderTurn(composeTurnMessages(context, makeScreen()))
    expect(turn).toContain('HASH:/menu')
    expect(turn).toContain('no confirmed progress across 5 iterations')
    expect(turn.toLowerCase()).toMatch(/change (your )?approach|stepfailed/)
  })
})

describe('composeTurnMessages — bulk completion predicate (D-09)', () => {
  it('renders the active bulk predicate with the cite-positive-evidence instruction when set', () => {
    const context = makeContext({ bulkCompletionPredicate: 'until no rows with a delete button remain' })
    const turn = renderTurn(composeTurnMessages(context, makeScreen()))
    expect(turn).toContain('until no rows with a delete button remain')
    expect(turn.toLowerCase()).toContain('evidence')
  })
})

describe('cache-tier byte-stability (Pitfall 3)', () => {
  it('never renders the three volatile blocks into buildSystemPrompt/buildContextTier/buildVolatileTier', () => {
    // Unique sentinels that cannot collide with the ~2000-word stable-tier rule text
    // (the literal phrase "off-screen" already appears in Rule 11 of buildSystemPrompt).
    const context = makeContext({
      stagnation: { classification: 'off-screen', anchor: { role: 'button', nameNormalized: 'delete', ordinal: 0 }, diff: 'ZZDIFFSENTINEL' },
      cycleBreak: { revisitedKey: 'ZZKEYSENTINEL', windowSummary: 'ZZWINDOWSENTINEL' },
      bulkCompletionPredicate: 'ZZPREDICATESENTINEL',
    })
    const system = systemText(context)
    expect(system).not.toContain('ZZDIFFSENTINEL')
    expect(system).not.toContain('ZZKEYSENTINEL')
    expect(system).not.toContain('ZZPREDICATESENTINEL')
  })
})

describe('v1 anti-repetition warning is deleted (§12.16 replaces it)', () => {
  it('produces NO "Do NOT repeat" warning for two identical sub-actions with no screen change', () => {
    const context = makeContext({
      subActionHistory: [
        { action: 'tap on ref="e1"', result: 'success', screenChanged: false },
        { action: 'tap on ref="e1"', result: 'success', screenChanged: false },
      ],
    })
    const turn = renderTurn(composeTurnMessages(context, makeScreen()))
    expect(turn).not.toContain('Do NOT repeat')
    expect(turn).not.toContain('no visible change')
  })
})
