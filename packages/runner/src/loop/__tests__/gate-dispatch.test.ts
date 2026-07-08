// SEAM-03 / D-08..D-10: the live async policy gate at the loop's single dispatch chokepoint.
// Every resolved action projects into a RiskActionDescriptor and awaits runToolCallAsync BEFORE
// any adapter/callback execution. A deny is a terminal policy_denied failure carrying the gate's
// audited reason (no replan). The measured gate-await extends the step deadline so a slow human
// confirm can never fake a step timeout (D-10). An unbound port degrades to ungated execution.
import { describe, it, expect, vi } from 'vitest'
import type { RiskActionDescriptor } from '@vostride/agent-qa-schema'
import type { PlatformAdapter, Action, ActionResult } from '../../platform.js'
import type { LoopPorts } from '../ports.js'
import type { Planner } from '../types.js'
import { executeStep } from '../index.js'
import {
  makeActionPlan,
  makeAdapter,
  makePlanner,
  makeSafetyHooks,
  makeStepContext,
} from './loop-harness.js'

function ports(overrides: Partial<LoopPorts> & Pick<LoopPorts, 'adapter' | 'planner'>): LoopPorts {
  return overrides
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe('executeStep — async policy gate dispatch (SEAM-03)', () => {
  it('Test 1: allow executes the ORIGINAL resolved Action, never the gate descriptor (Pitfall 4)', async () => {
    const executed: Action[] = []
    const adapter = makeAdapter()
    adapter.execute = async (action: Action) => { executed.push(action); return { success: true } }

    // The gate returns allow carrying the DESCRIPTOR as `call` — the loop must ignore it.
    const safetyHooks = makeSafetyHooks({
      runToolCallAsync: async (call) => ({
        action: 'allow',
        call: { name: (call as RiskActionDescriptor).name, recognized: true } as typeof call,
      }),
    })

    const result = await executeStep(
      'Click the Log in button',
      ports({ adapter, planner: makePlanner(), safetyHooks }),
      makeStepContext(),
    )

    expect(result.status).toBe('passed')
    expect(executed).toEqual([{ type: 'click', ref: 'e2' }])
  })

  it('Test 2: deny is a terminal failure with the audited reason; planner called exactly once; adapter never executes', async () => {
    const execute = vi.fn((_a: Action): Promise<ActionResult> => Promise.resolve({ success: true }))
    const adapter = makeAdapter()
    adapter.execute = execute
    const plannerSpy = vi.fn().mockResolvedValue({ plan: makeActionPlan({ stepComplete: false }) })
    const planner: Planner = { plan: plannerSpy }

    const reason = "execution policy denied 'delete_record' (destructive, ci, no trust grant): re-run locally to confirm interactively"
    const safetyHooks = makeSafetyHooks({ runToolCallAsync: async () => ({ action: 'deny', reason }) })

    const result = await executeStep('Delete the record', ports({ adapter, planner, safetyHooks }), makeStepContext())

    expect(result.status).toBe('failed')
    expect(result.error).toBe(reason)
    expect(execute).not.toHaveBeenCalled()
    expect(plannerSpy).toHaveBeenCalledOnce()
  })

  it('Test 3: the deny reason reaches the step evidence', async () => {
    const reason = 'execution policy denied — restricted verb'
    const safetyHooks = makeSafetyHooks({ runToolCallAsync: async () => ({ action: 'deny', reason }) })

    const result = await executeStep(
      'Do the denied thing',
      ports({ adapter: makeAdapter(), planner: makePlanner(), safetyHooks }),
      makeStepContext(),
    )

    expect(result.status).toBe('failed')
    expect(result.evidence?.verifierVerdict.reasoning).toContain(reason)
    const denied = result.evidence?.subActions.at(-1)
    expect(denied?.result.success).toBe(false)
    expect(denied?.result.error).toContain(reason)
  })

  it('Test 4: a slow gate extends the step deadline — no fake timeout (D-10)', async () => {
    // stepTimeout is small; the gate sleeps longer than the remaining margin on each call. Without
    // the D-10 extension the second iteration's top-of-loop deadline check would fire a fake
    // timeout. Two plans force a second iteration so that check is actually reached.
    const planner = makePlanner([
      makeActionPlan({ stepComplete: false }),
      makeActionPlan({ stepComplete: true }),
    ])
    const safetyHooks = makeSafetyHooks({
      runToolCallAsync: async (call) => { await sleep(60); return { action: 'allow', call } },
    })

    const result = await executeStep(
      'Two-step gated action',
      ports({ adapter: makeAdapter(), planner, safetyHooks, stepTimeout: 40 }),
      makeStepContext(),
    )

    expect(result.status).toBe('passed')
    expect(result.error).toBeUndefined()
  })

  it('Test 5: a setVariable action also flows through the gate before the callback runs', async () => {
    const gated: string[] = []
    const setVars: Array<{ name: string; value: string }> = []
    const safetyHooks = makeSafetyHooks({
      runToolCallAsync: async (call) => {
        gated.push((call as RiskActionDescriptor).name)
        return { action: 'allow', call }
      },
    })

    const result = await executeStep(
      'Set a variable',
      ports({
        adapter: makeAdapter(),
        planner: makePlanner([makeActionPlan({ action: { type: 'setVariable', name: 'TOKEN', value: 'abc' }, stepComplete: true })]),
        safetyHooks,
        onSetVariable: (name, value) => setVars.push({ name, value }),
      }),
      makeStepContext(),
    )

    expect(result.status).toBe('passed')
    expect(gated).toContain('setVariable')
    expect(setVars).toEqual([{ name: 'TOKEN', value: 'abc' }])
  })

  it('Test 6: an unbound safetyHooks port degrades to ungated execution (no throw)', async () => {
    const executed: Action[] = []
    const adapter = makeAdapter()
    adapter.execute = async (action: Action) => { executed.push(action); return { success: true } }

    const result = await executeStep(
      'Click the Log in button',
      ports({ adapter, planner: makePlanner() }),
      makeStepContext(),
    )

    expect(result.status).toBe('passed')
    expect(executed).toEqual([{ type: 'click', ref: 'e2' }])
  })
})
