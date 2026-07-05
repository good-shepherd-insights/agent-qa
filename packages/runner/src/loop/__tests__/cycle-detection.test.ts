// RED scaffold (Wave 0, Phase 358 · CYCLE-03 · D-08/D-10 · Pitfall 4/6). Pins the loop-level
// cycle contract on executeStep BEFORE Plan 08 wires it: the binding sanity PAIR
// ("delete all 10 items" completes / "open-close-menu forever" stops), the D-10 budget
// refresh (a confirmed unit of progress resets the step budget to full; wall-clock is the
// only absolute ceiling), the D-08 one-shot cycle-break turn then terminal stepFailed, and
// the Pitfall-6 deadline backstop for a never-settling screen.
//
// RED BY DESIGN: the shipped loop has no oracle/revisitation/budget-refresh wiring — it caps
// at maxSubActions and never mints a cycle-break block or cycle evidence. Those gaps ARE the
// intended failures (GREEN when Plan 08 lands).
import { describe, it, expect } from 'vitest'
import type { ScreenState } from '@vostride/agent-qa-schema'
import type { PlatformAdapter, Action, ActionResult } from '../../platform.js'
import type { LoopPorts } from '../ports.js'
import type { Planner, PlanResult, StepContext } from '../types.js'
import { executeStep } from '../index.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import { buildAgentScreenState, type LooseElement } from './screen-fixtures.js'
import { makeActionPlan, makeStepContext, makeVerifier } from './loop-harness.js'

function ports(overrides: Partial<LoopPorts> & Pick<LoopPorts, 'adapter' | 'planner'>): LoopPorts {
  return overrides
}

// A list screen with `count` delete buttons — a confirmed local effect (one row gone) is
// visible between successive states (feeds the future oracle + D-10 refresh).
function listScreen(count: number): ScreenState {
  const rows: LooseElement[] = []
  for (let i = 0; i < count; i++) {
    rows.push({ role: 'button', name: `Delete row ${i}`, bounds: { x: 20, y: 80 + i * 44, width: 300, height: 40 } })
  }
  return buildAgentScreenState({ url: 'https://x.test/list', elements: rows, metadata: { coordSpace: 'viewport', viewportWidth: 390, viewportHeight: 844 } })
}

// A screen is STABLE across the settle gate's polls within one iteration and only changes
// after an action lands (Plan 08 reconciliation): the observation index advances on EXECUTE,
// not per observe, so the bounded settle gate (which polls screenIdentityHash until two
// consecutive observations match) quiesces on the current screen and one confirmed local
// effect (one row gone) is visible per iteration — the realistic model the binding-sanity
// contract asserts. (The prior per-observe advance made settle consume the whole sequence in
// ~2 polls, which no shipped settle gate does.)
function countingAdapter(observeResults: ScreenState[], onExecute: () => void): PlatformAdapter {
  let step = 0
  return {
    platform: 'web',
    async setup() {},
    async cleanup() {},
    async observe() {
      return observeResults[Math.min(step, observeResults.length - 1)]
    },
    async execute(_action: Action): Promise<ActionResult> {
      onExecute()
      step++
      return { success: true }
    },
  }
}

describe('binding sanity A — "delete all 10 items" completes (D-10 budget refresh)', () => {
  it('processes all 10 units past the initial budget with no cycle/stagnation flag', async () => {
    const INITIAL_BUDGET = 4
    // 11 shrinking observations (10 → 0), a confirmed delete between each.
    const observes: ScreenState[] = []
    for (let n = 10; n >= 0; n--) observes.push(listScreen(n))

    let executeCount = 0
    // Byte-IDENTICAL delete every turn (CYCLE-01: repetition that IS the task), then complete.
    const plans = Array.from({ length: 10 }, () => makeActionPlan({ action: { type: 'click', ref: 'e1' }, stepComplete: false }))
    plans.push(makeActionPlan({ action: { type: 'click', ref: 'e1' }, stepComplete: true }))
    let call = 0
    const planner: Planner = {
      async plan(): Promise<PlanResult> {
        const p = plans[Math.min(call, plans.length - 1)]
        call++
        return { plan: p }
      },
    }

    const result = await executeStep(
      'Delete all rows',
      ports({
        adapter: countingAdapter(observes, () => { executeCount++ }),
        planner,
        verifier: makeVerifier(),
        plannerConfig: { maxSubActions: INITIAL_BUDGET, previousStepCount: 0 },
      }),
      makeStepContext(),
    )

    expect(result.status).toBe('passed')
    // The refresh proves itself: more successful iterations ran than the initial budget.
    expect(executeCount).toBeGreaterThan(INITIAL_BUDGET)
    expect((result.evidence as { cycle?: unknown } | undefined)?.cycle).toBeUndefined()
  })
})

describe('binding sanity B — "open-close-menu forever" stops (D-08)', () => {
  async function runStuckLoop(): Promise<{ result: Awaited<ReturnType<typeof executeStep>>; cycleBreakCalls: number }> {
    // A constant observation: same settled hash every iteration ⇒ revisited key, and the
    // planner's alternating taps confirm no task progress (combined rule trips).
    const constant = makeScreenState()
    let cycleBreakCalls = 0
    const planner: Planner = {
      async plan(_step, _screen, context: StepContext): Promise<PlanResult> {
        if ((context as { cycleBreak?: unknown }).cycleBreak) cycleBreakCalls++
        return { plan: makeActionPlan({ action: { type: 'click', ref: 'e2' }, stepComplete: false }) }
      },
    }
    const result = await executeStep(
      'Open then close the menu',
      ports({
        adapter: countingAdapter([constant], () => {}),
        planner,
        verifier: makeVerifier(),
        plannerConfig: { maxSubActions: 15, previousStepCount: 0 },
      }),
      makeStepContext(),
    )
    return { result, cycleBreakCalls }
  }

  it('injects the cycle-break block exactly once, then terminates as a structured stepFailed carrying cycle evidence', async () => {
    const { result, cycleBreakCalls } = await runStuckLoop()
    expect(result.status).toBe('failed')
    // D-08 one-shot: the cycle-break block appears in exactly one planning turn's context.
    expect(cycleBreakCalls).toBe(1)
    // The terminal failure carries the event-scoped cycle evidence block (D-07).
    expect((result.evidence as { cycle?: unknown } | undefined)?.cycle).toBeDefined()
  })
})

describe('Pitfall 6 — never-settling screen terminates via the deadline backstop', () => {
  it('a permanently-busy fake screen fails via the wall-clock deadline, not an infinite loop', async () => {
    let n = 0
    const everChanging: PlatformAdapter = {
      platform: 'web',
      async setup() {},
      async cleanup() {},
      async observe() {
        // Never two consecutive matching hashes — settle can never stabilize.
        return buildAgentScreenState({ elements: [{ role: 'text', name: `frame ${n++}`, bounds: { x: 0, y: 0, width: 10, height: 10 } }] })
      },
      async execute(): Promise<ActionResult> { return { success: true } },
    }
    const planner: Planner = { async plan(): Promise<PlanResult> { return { plan: makeActionPlan({ stepComplete: false }) } } }
    const result = await executeStep(
      'Wait for the busy screen',
      ports({ adapter: everChanging, planner, verifier: makeVerifier(), stepTimeout: 50, plannerConfig: { maxSubActions: 1000, previousStepCount: 0 } }),
      makeStepContext(),
    )
    expect(result.status).toBe('failed')
  })
})
