// RED scaffold (Wave 0, Phase 358 · WM-01 · D-11/D-12 · Pattern 6). Pins the working-memory
// LIFECYCLE inside executeStep BEFORE Plan 08 wires it: capture-before-navigate (by
// construction), whole-set serving to the next planning turn, and the masked
// StepEvidence.workingMemory snapshot recorded BESIDE (never inside) servedBrief. Uses the
// optional-port idiom — an unbound workingMemory port leaves the loop unchanged.
//
// RED BY DESIGN: the shipped loop never reads a workingMemory port, so capture is never
// invoked, context.workingMemory is never served, and evidence.workingMemory is never
// snapshotted — those gaps ARE the intended failure (GREEN when Plan 08 lands).
import { describe, it, expect } from 'vitest'
import type { ScreenState, MaskingContext } from '@vostride/agent-qa-schema'
import type { PlatformAdapter, Action, ActionResult } from '../../platform.js'
import type { LoopPorts } from '../ports.js'
import type { Planner, PlanResult, StepContext } from '../types.js'
import { executeStep } from '../index.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import { makeActionPlan, makeStepContext, makeVerifier } from './loop-harness.js'

// The Plan-08 WorkingMemoryPort shape (served through LoopPorts.workingMemory). Structural
// fake — typed locally until the port lands on LoopPorts.
interface FakeWmPort {
  capture(entries: unknown[], provenanceCtx?: unknown): void
  entries(): unknown[]
  dispose(): void
}

function makeWmPort(log: string[]): FakeWmPort & { stored: unknown[] } {
  const stored: unknown[] = []
  return {
    stored,
    capture(entries) {
      log.push('capture')
      stored.push(...entries)
    },
    entries() {
      return stored
    },
    dispose() {
      log.push('dispose')
    },
  }
}

// Identity-plus-marker masking so the snapshot's mask() application is provable.
const fakeMasking = {
  mask: (text: string) => `MASKED(${text})`,
  unmask: (text: string) => text,
} as unknown as MaskingContext

function loggingAdapter(log: string[], observeResults: ScreenState[]): PlatformAdapter {
  let observeCall = 0
  return {
    platform: 'web',
    async setup() {},
    async cleanup() {},
    async observe() {
      const idx = Math.min(observeCall, observeResults.length - 1)
      observeCall++
      return observeResults[idx]
    },
    async execute(_action: Action): Promise<ActionResult> {
      log.push('execute')
      return { success: true }
    },
  }
}

function ports(overrides: Partial<LoopPorts> & Pick<LoopPorts, 'adapter' | 'planner'>): LoopPorts {
  return overrides
}

const REMEMBER = [{ key: 'otp', value: '4821', kind: 'extracted-value', provenance: 'observation' }]

describe('working-memory loop lifecycle (WM-01)', () => {
  it('captures remember[] BEFORE dispatching the navigating action (capture-before-navigate)', async () => {
    const log: string[] = []
    const wm = makeWmPort(log)
    const planner: Planner = {
      async plan(): Promise<PlanResult> {
        return { plan: makeActionPlan({ action: { type: 'navigate', url: 'https://x.test/next' }, remember: REMEMBER, stepComplete: true } as never) }
      },
    }
    const result = await executeStep(
      'Remember the OTP then navigate',
      ports({ adapter: loggingAdapter(log, [makeScreenState(), makeScreenState()]), planner, verifier: makeVerifier(), workingMemory: wm } as never),
      makeStepContext(),
    )
    expect(result.status).toBe('passed')
    expect(log).toContain('capture')
    expect(log).toContain('execute')
    // Ordering is the contract: capture strictly precedes the navigating execute.
    expect(log.indexOf('capture')).toBeLessThan(log.indexOf('execute'))
  })

  it('serves entries captured in earlier turns to the next planning turn context', async () => {
    const log: string[] = []
    const wm = makeWmPort(log)
    const served: unknown[] = []
    let call = 0
    const planner: Planner = {
      async plan(_step, _screen, context: StepContext): Promise<PlanResult> {
        served.push(context.workingMemory)
        call++
        if (call === 1) {
          return { plan: makeActionPlan({ action: { type: 'click', ref: 'e2' }, remember: REMEMBER, stepComplete: false } as never) }
        }
        return { plan: makeActionPlan({ action: { type: 'click', ref: 'e2' }, stepComplete: true }) }
      },
    }
    const result = await executeStep(
      'Capture then reuse',
      ports({ adapter: loggingAdapter(log, [makeScreenState(), makeScreenState(), makeScreenState()]), planner, verifier: makeVerifier(), workingMemory: wm } as never),
      makeStepContext(),
    )
    expect(result.status).toBe('passed')
    expect(call).toBeGreaterThanOrEqual(2)
    // The second planning turn sees the entry captured in the first (whole-set serving, D-11).
    const secondServed = served[1] as { key?: string }[] | undefined
    expect(Array.isArray(secondServed)).toBe(true)
    expect(secondServed?.some((e) => e.key === 'otp')).toBe(true)
  })

  it('snapshots the served set into StepEvidence.workingMemory with masked values (beside servedBrief)', async () => {
    const log: string[] = []
    const wm = makeWmPort(log)
    const planner: Planner = {
      async plan(): Promise<PlanResult> {
        return { plan: makeActionPlan({ action: { type: 'click', ref: 'e2' }, remember: REMEMBER, stepComplete: true } as never) }
      },
    }
    const result = await executeStep(
      'Capture and snapshot',
      ports({ adapter: loggingAdapter(log, [makeScreenState(), makeScreenState()]), planner, verifier: makeVerifier(), workingMemory: wm, masking: fakeMasking } as never),
      makeStepContext(),
    )
    expect(result.status).toBe('passed')
    const snapshot = (result.evidence as { workingMemory?: { value: string }[] } | undefined)?.workingMemory
    expect(Array.isArray(snapshot)).toBe(true)
    expect(snapshot?.some((e) => e.value === 'MASKED(4821)')).toBe(true)
  })

  it('runs unchanged with no workingMemory port bound — snapshot absent (optional-port idiom)', async () => {
    const log: string[] = []
    const planner = { async plan(): Promise<PlanResult> { return { plan: makeActionPlan() } } }
    const result = await executeStep(
      'No WM port',
      ports({ adapter: loggingAdapter(log, [makeScreenState(), makeScreenState()]), planner, verifier: makeVerifier() }),
      makeStepContext(),
    )
    expect(result.status).toBe('passed')
    expect((result.evidence as { workingMemory?: unknown } | undefined)?.workingMemory).toBeUndefined()
    expect(log).not.toContain('capture')
  })
})
