// RED scaffold (Wave 0, Phase 358 · CYCLE-02 · D-02 · Pattern 2). Pins the deterministic
// five-class stagnation classifier BEFORE the progress module exists. Classification is a
// PURE runner-side function over typed signals only (roles / bounds / element state / settle
// flags / §12.11 re-read) — never over free element text (V5/injection posture). Unknown ⇒
// the unresponsive track (D-02 default). No LLM (L9).
//
// RED BY DESIGN: `../progress/classifier` does not exist until Plan 04 — the unresolved
// import IS the intended failure. Pinned API:
//   classifyStagnation({ stateBefore, stateAfter, anchor?, settleResult?, actionResult? })
//     → 'obstruction' | 'off-screen' | 'transient-load' | 'input-didnt-land' | 'unresponsive'
import { describe, it, expect } from 'vitest'
import type { ScreenState } from '@vostride/agent-qa-schema'
// Plan-04 progress module — intentionally unresolved today (the RED reason for this suite):
import { classifyStagnation, type StagnationClass } from '../progress/classifier.js'
import { buildAgentScreenState, type LooseElement } from './screen-fixtures.js'

const VIEWPORT = { coordSpace: 'viewport' as const, viewportWidth: 390, viewportHeight: 844 }

function state(elements: LooseElement[]): ScreenState {
  return buildAgentScreenState({ elements, metadata: { ...VIEWPORT } })
}

const button = (name: string, bounds = { x: 20, y: 100, width: 200, height: 44 }): LooseElement => ({ role: 'button', name, bounds })

describe('classifyStagnation — typed-signal classification (D-02)', () => {
  it('obstruction: a new dialog/alert-role subtree appears in the fresh state', () => {
    const before = state([button('Submit')])
    const after = state([button('Submit'), { role: 'dialog', name: 'Confirm', bounds: { x: 0, y: 0, width: 390, height: 400 } }])
    const cls: StagnationClass = classifyStagnation({ stateBefore: before, stateAfter: after })
    expect(cls).toBe('obstruction')
  })

  it('off-screen: the target anchor resolves but its bounds fall outside the viewport', () => {
    const before = state([button('Submit', { x: 20, y: 100, width: 200, height: 44 })])
    const after = state([button('Submit', { x: 20, y: 2000, width: 200, height: 44 })])
    const cls = classifyStagnation({ stateBefore: before, stateAfter: after, anchor: { role: 'button', nameNormalized: 'submit', ordinal: 0 } })
    expect(cls).toBe('off-screen')
  })

  it('transient-load: a busy/progressbar-role element is present', () => {
    const before = state([button('Submit')])
    const after = state([button('Submit'), { role: 'progressbar', name: 'Loading', bounds: { x: 20, y: 200, width: 200, height: 8 } }])
    const cls = classifyStagnation({ stateBefore: before, stateAfter: after })
    expect(cls).toBe('transient-load')
  })

  it('transient-load: the settle gate reported settled:false (poll cap hit)', () => {
    const before = state([button('Submit')])
    const after = state([button('Submit')])
    const cls = classifyStagnation({ stateBefore: before, stateAfter: after, settleResult: { settled: false } })
    expect(cls).toBe('transient-load')
  })

  it('input-didnt-land: a §12.11 re-read mismatch annotation is present', () => {
    const before = state([{ role: 'textbox', name: 'Email', value: '', bounds: { x: 20, y: 100, width: 300, height: 44 } }])
    const after = state([{ role: 'textbox', name: 'Email', value: '', bounds: { x: 20, y: 100, width: 300, height: 44 } }])
    const cls = classifyStagnation({ stateBefore: before, stateAfter: after, actionResult: { success: true, metadata: { fillReread: { expected: 'a@b.co', actual: '' } } } })
    expect(cls).toBe('input-didnt-land')
  })

  it('unresponsive: nothing classifiable (D-02 unknown-track default)', () => {
    const before = state([button('Submit')])
    const after = state([button('Submit')])
    const cls = classifyStagnation({ stateBefore: before, stateAfter: after, settleResult: { settled: true } })
    expect(cls).toBe('unresponsive')
  })

  it('never switches on free text: an element literally named "Loading" with no busy role classifies unresponsive', () => {
    const before = state([button('Submit')])
    // Free text says "loading" but there is NO progressbar/busy role and settle succeeded —
    // typed signals only, so this must NOT become transient-load (injection-inert).
    const after = state([button('Submit'), { role: 'text', name: 'Loading, please wait…', bounds: { x: 20, y: 200, width: 200, height: 20 } }])
    const cls = classifyStagnation({ stateBefore: before, stateAfter: after, settleResult: { settled: true } })
    expect(cls).toBe('unresponsive')
  })
})
