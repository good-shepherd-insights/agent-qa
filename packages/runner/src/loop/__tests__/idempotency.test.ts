// RED scaffold (Wave 0, Phase 359 · EXEC-04 · D-13/D-14/D-15/D-16 · Pattern 5 · spec §12.13).
// Pins the toggle/picker idempotency contract BEFORE Plans 03/04/08 wire it:
//   Block A — the pure comparator `desiredStateSatisfied(action, screenState)` (D-15): suppress
//     an action ONLY on positive persisted-state evidence (tap/click vs state.checked/selected;
//     select/nativeSelect/pickerSelect vs the persisted value); undefined/missing state ⇒ act.
//   Block B — the dispatch-seam short-circuit (D-14): at the ONE chokepoint before adapter.execute,
//     a satisfied desiredState mints a success ActionResult with metadata.idempotentNoop
//     { currentState } WITHOUT calling the adapter; the 358 tap oracle counts the flagged no-op as
//     effect-achieved (D-16, no stagnation increment); an unsatisfied desiredState falls through
//     to a plain tap. The desiredState param must survive toolCallToActionPlan to the seam (D-13).
//
// RED BY DESIGN:
//   - Block A: `../../compound/idempotency.js` does not exist until the compound plan lands — the
//     unresolved import fails the whole suite at collection (vitest strips types; `tsc -p .` stays
//     green via @ts-expect-error, removed when the module lands).
//   - Block B: the shipped seam has no idempotency check and the tap/click emission schema has no
//     desiredState param — so the zero-execute / idempotentNoop-metadata / desiredState-survival
//     assertions are un-wired-seam failures (GREEN when Plans 04+08 land).
import { describe, it, expect } from 'vitest'
import type { ScreenState, ElementInfo, ElementState } from '@vostride/agent-qa-schema'
import { asRef } from '@vostride/agent-qa-schema'
import type { PlatformAdapter, Action, ActionResult } from '../../platform.js'
import type { LoopPorts } from '../ports.js'
import { executeStep } from '../index.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import { buildAgentScreenState } from './screen-fixtures.js'
import { makeActionPlan, makeStepContext, makeVerifier, makePlanner } from './loop-harness.js'
import { ToolRegistry } from '../../tools/registry.js'
import { registerAllActions } from '../../tools/actions/index.js'
import { toolCallToActionPlan } from '../../tools/builder.js'
// Idempotency comparator — intentionally unresolved today (the RED reason for Block A):
// @ts-expect-error module lands in the Phase-359 compound plan (remove this directive then)
import { desiredStateSatisfied } from '../../compound/idempotency.js'

// ---------------------------------------------------------------------------
// Block A — pure comparator fixtures (via the canonical v2 factory, 352 precedent)
// ---------------------------------------------------------------------------

function checkable(state: Partial<ElementState>, opts: { role?: string; value?: string } = {}): ScreenState {
  const element: ElementInfo = {
    ref: asRef('e1'),
    role: opts.role ?? 'checkbox',
    name: 'Wi-Fi',
    nameNormalized: 'wi-fi',
    state: { enabled: true, focused: false, visible: true, ...state },
    labels: {},
    attributes: {},
    ...(opts.value !== undefined ? { value: opts.value } : {}),
  }
  return makeScreenState({ elements: [element] })
}

describe('Block A — desiredStateSatisfied: checkable toggles (D-15)', () => {
  it('tap desiredState=checked ⇒ {currentState} hit when persisted state.checked is true', () => {
    const hit = desiredStateSatisfied({ type: 'tap', ref: 'e1', desiredState: 'checked' }, checkable({ checked: true }))
    expect(hit).toBeDefined()
    expect(hit.currentState).toBeDefined()
  })

  it('tap desiredState=checked ⇒ act (undefined) when state.checked is false', () => {
    expect(desiredStateSatisfied({ type: 'tap', ref: 'e1', desiredState: 'checked' }, checkable({ checked: false }))).toBeUndefined()
  })

  it('tap desiredState=checked ⇒ act (undefined) when state.checked is ABSENT — positive evidence only', () => {
    expect(desiredStateSatisfied({ type: 'tap', ref: 'e1', desiredState: 'checked' }, checkable({}))).toBeUndefined()
  })

  it('unchecked mirror: hit when checked=false, act when checked=true or absent', () => {
    expect(desiredStateSatisfied({ type: 'tap', ref: 'e1', desiredState: 'unchecked' }, checkable({ checked: false }))).toBeDefined()
    expect(desiredStateSatisfied({ type: 'tap', ref: 'e1', desiredState: 'unchecked' }, checkable({ checked: true }))).toBeUndefined()
    expect(desiredStateSatisfied({ type: 'tap', ref: 'e1', desiredState: 'unchecked' }, checkable({}))).toBeUndefined()
  })

  it('selected/unselected mirror against state.selected', () => {
    expect(desiredStateSatisfied({ type: 'click', ref: 'e1', desiredState: 'selected' }, checkable({ selected: true }))).toBeDefined()
    expect(desiredStateSatisfied({ type: 'click', ref: 'e1', desiredState: 'selected' }, checkable({ selected: false }))).toBeUndefined()
    expect(desiredStateSatisfied({ type: 'click', ref: 'e1', desiredState: 'unselected' }, checkable({ selected: false }))).toBeDefined()
    expect(desiredStateSatisfied({ type: 'click', ref: 'e1', desiredState: 'unselected' }, checkable({ selected: true }))).toBeUndefined()
  })
})

describe('Block A — desiredStateSatisfied: pickers act on the persisted value (D-15)', () => {
  it('select/nativeSelect/pickerSelect no-op when the persisted value already equals the requested value', () => {
    for (const type of ['select', 'nativeSelect', 'pickerSelect']) {
      // Already on Option A ⇒ suppress.
      expect(desiredStateSatisfied({ type, ref: 'e1', value: 'Option A' }, checkable({}, { role: 'combobox', value: 'Option A' }))).toBeDefined()
      // Different requested value ⇒ act.
      expect(desiredStateSatisfied({ type, ref: 'e1', value: 'Option B' }, checkable({}, { role: 'combobox', value: 'Option A' }))).toBeUndefined()
      // Persisted value absent ⇒ act (positive evidence only).
      expect(desiredStateSatisfied({ type, ref: 'e1', value: 'Option A' }, checkable({}, { role: 'combobox' }))).toBeUndefined()
    }
  })

  it('an action with no desiredState and a non-picker type is always undefined (no idempotency claim)', () => {
    expect(desiredStateSatisfied({ type: 'tap', ref: 'e1' }, checkable({ checked: true }))).toBeUndefined()
  })

  it('byte-pin: the hit object sorted keys are exactly ["currentState"] with a string value (D-04)', () => {
    const hit = desiredStateSatisfied({ type: 'tap', ref: 'e1', desiredState: 'checked' }, checkable({ checked: true }))
    expect(Object.keys(hit).sort()).toEqual(['currentState'])
    expect(typeof hit.currentState).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// Block B — dispatch-seam integration over the loop harness (D-13/D-14/D-16)
// ---------------------------------------------------------------------------

function ports(overrides: Partial<LoopPorts> & Pick<LoopPorts, 'adapter' | 'planner'>): LoopPorts {
  return overrides
}

function recordingAdapter(observation: ScreenState, calls: Action[]): PlatformAdapter {
  return {
    platform: 'web',
    async setup() {},
    async cleanup() {},
    async observe() {
      return observation
    },
    async execute(action: Action): Promise<ActionResult> {
      calls.push(action)
      return { success: true }
    },
  }
}

interface LooseSub {
  result?: { metadata?: Record<string, unknown> }
  localEffect?: { achieved?: boolean }
}

function firstSub(result: Awaited<ReturnType<typeof executeStep>>): LooseSub | undefined {
  const ev = result.evidence as { subActions?: LooseSub[] } | undefined
  return ev?.subActions?.[0]
}

describe('Block B — the seam suppresses a satisfied desiredState (D-14/D-16)', () => {
  it('a checked toggle with desiredState=checked never calls adapter.execute and records idempotentNoop', async () => {
    const observation = buildAgentScreenState({
      url: 'https://x.test/settings',
      elements: [{ ref: 'e1', role: 'checkbox', name: 'Wi-Fi', state: { checked: true }, bounds: { x: 20, y: 80, width: 300, height: 44 } }],
      metadata: { coordSpace: 'viewport', viewportWidth: 390, viewportHeight: 844 },
    })
    const calls: Action[] = []
    const adapter = recordingAdapter(observation, calls)
    const plans = [makeActionPlan({ action: { type: 'tap', ref: 'e1', desiredState: 'checked' } as unknown as Action, stepComplete: true })]

    const result = await executeStep(
      'Ensure Wi-Fi is on',
      ports({ adapter, planner: makePlanner(plans), verifier: makeVerifier(), plannerConfig: { maxSubActions: 4, previousStepCount: 0 } }),
      makeStepContext(),
    )

    // D-14: the check runs at the ONE chokepoint before adapter.execute ⇒ zero adapter calls.
    expect(calls.length).toBe(0)
    // D-16: the minted no-op carries metadata.idempotentNoop.currentState ...
    const sub = firstSub(result)
    const noop = sub?.result?.metadata?.['idempotentNoop'] as { currentState?: unknown } | undefined
    expect(noop).toBeDefined()
    expect(noop?.currentState).toBeDefined()
    // ... and the tap oracle reads it as effect-achieved (no stagnation increment).
    expect(sub?.localEffect?.achieved).toBe(true)
  })

  it('an UNsatisfied desiredState=checked (state.checked false) falls through to a plain tap', async () => {
    const observation = buildAgentScreenState({
      url: 'https://x.test/settings',
      elements: [{ ref: 'e1', role: 'checkbox', name: 'Wi-Fi', state: { checked: false }, bounds: { x: 20, y: 80, width: 300, height: 44 } }],
      metadata: { coordSpace: 'viewport', viewportWidth: 390, viewportHeight: 844 },
    })
    const calls: Action[] = []
    const adapter = recordingAdapter(observation, calls)
    const plans = [makeActionPlan({ action: { type: 'tap', ref: 'e1', desiredState: 'checked' } as unknown as Action, stepComplete: true })]

    await executeStep(
      'Turn Wi-Fi on',
      ports({ adapter, planner: makePlanner(plans), verifier: makeVerifier(), plannerConfig: { maxSubActions: 4, previousStepCount: 0 } }),
      makeStepContext(),
    )

    // Un-satisfied ⇒ the seam does NOT suppress; the adapter executes the plain tap.
    expect(calls.length).toBeGreaterThanOrEqual(1)
  })
})

describe('Block B — desiredState survives toolCallToActionPlan to the seam (D-13 plumbing)', () => {
  it('a click tool call carrying desiredState spreads it onto the produced action plan', () => {
    const registry = new ToolRegistry()
    registerAllActions(registry)
    // Currently RED: the click emission schema is .strict() with no desiredState param (Plan 04
    // adds it) ⇒ toolCallToActionPlan rejects the field. When Plan 04 lands, desiredState rides
    // through to action.desiredState with zero extra plumbing (builder spreads parsed fields).
    const plan = toolCallToActionPlan(
      'web_click',
      { reasoning: 'toggle wifi', confidence: 1, stepComplete: false, ref: 'e1', desiredState: 'checked' },
      registry,
    ) as { action: Record<string, unknown> }
    expect(plan.action['desiredState']).toBe('checked')
  })
})
