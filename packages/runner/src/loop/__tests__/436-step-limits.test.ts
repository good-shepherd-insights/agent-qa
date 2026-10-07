// HARN-02 / 436 D-01, D-07, D-10..D-13: a step execution runs under a monotonic action limit and
// stops honestly, with a typed limit block, when the limit refuses the next dispatch.
import { describe, expect, it } from 'vitest'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import {
  DEFAULT_PLANNER_LIMITS,
  formatLimitStopReason,
  resolvePlannerLimits,
} from '@vostride/agent-qa-schema'
import type { Action, ActionResult, PlatformAdapter } from '../../platform.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import { executeStep } from '../index.js'
import type { LoopPorts } from '../ports.js'
import type { ActionPlan, Planner, VerificationResult, Verifier } from '../types.js'
import { makeActionPlan, makeAdapter, makeStepContext } from './loop-harness.js'

function ports(overrides: Partial<LoopPorts> & Pick<LoopPorts, 'adapter' | 'planner'>): LoopPorts {
  return overrides
}

function scriptedPlanner(plans: ActionPlan[]): Planner & { calls: number } {
  const planner = {
    calls: 0,
    async plan() {
      const plan = plans[Math.min(planner.calls, plans.length - 1)]
      planner.calls++
      return { plan }
    },
  }
  return planner
}

function countingAdapter(result: ActionResult = { success: true }): PlatformAdapter & { executed: Action[] } {
  const executed: Action[] = []
  return {
    executed,
    platform: 'web',
    async setup() {},
    async cleanup() {},
    async observe() { return makeScreenState() },
    async execute(action: Action) {
      executed.push(action)
      return result
    },
  }
}

function scriptedVerifier(results: VerificationResult[]): Verifier & { calls: number } {
  const verifier = {
    calls: 0,
    async verify() {
      const verification = results[Math.min(verifier.calls, results.length - 1)]
      verifier.calls++
      return { verification }
    },
  }
  return verifier
}

const limits = (maxActions: number) => ({ maxActions, maxPlanningTurns: maxActions, previousStepCount: 0 })

describe('C436-STEP-LIMITS', () => {
  it('a live step stops at its action limit with a typed limit block', async () => {
    const adapter = countingAdapter()
    const planner = scriptedPlanner([makeActionPlan({ reasoning: '', stepComplete: false })])
    const result = await executeStep(
      'Press the dead button until something happens',
      ports({ adapter, planner, plannerConfig: limits(3) }),
      makeStepContext(),
    )
    const reason = 'Stopped: action limit reached — 3 of 3 actions used'
    expect(adapter.executed).toHaveLength(3)
    expect(planner.calls).toBe(3)
    expect(result.status).toBe('failed')
    expect(result.error).toBe(reason)
    expect(result.evidence?.limitStop).toEqual({
      limit: 'actions',
      configured: 3,
      used: 3,
      requestedOutcome: 'unverified',
      reason,
    })
    expect(result.evidence?.planningFailure).toBeUndefined()
    expect(result.evidence?.termination).toBeUndefined()
    expect(result.evidence?.verdictSource).toBeUndefined()
    expect(result.evidence?.limitUsage).toMatchObject({ limits: { maxActions: 3, maxPlanningTurns: 3 }, actionsUsed: 3 })
  })

  it("the Nth action's completion claim is verified and can pass", async () => {
    const adapter = countingAdapter()
    const planner = scriptedPlanner([
      makeActionPlan({ stepComplete: false }),
      makeActionPlan({ stepComplete: false }),
      makeActionPlan({ stepComplete: true }),
    ])
    const verifier = scriptedVerifier([{ success: true, reasoning: 'Logged in', isAppError: false }])
    const result = await executeStep('Log in', ports({ adapter, planner, verifier, plannerConfig: limits(3) }), makeStepContext())
    expect(result.status).toBe('passed')
    expect(verifier.calls).toBe(1)
    expect(adapter.executed).toHaveLength(3)
    expect(result.evidence?.limitStop).toBeUndefined()
    expect(result.evidence?.limitUsage?.actionsUsed).toBe(3)
  })

  it('the N-1 case completes normally', async () => {
    const adapter = countingAdapter()
    const planner = scriptedPlanner([makeActionPlan({ stepComplete: false }), makeActionPlan({ stepComplete: true })])
    const verifier = scriptedVerifier([{ success: true, reasoning: 'Logged in', isAppError: false }])
    const result = await executeStep('Log in', ports({ adapter, planner, verifier, plannerConfig: limits(3) }), makeStepContext())
    expect(result.status).toBe('passed')
    expect(result.evidence?.limitStop).toBeUndefined()
    expect(result.evidence?.limitUsage?.actionsUsed).toBe(2)
  })

  it("the limit block carries the last verifier rejection and the planner's last reasoning", async () => {
    const masking = createMaskingContext()
    masking.register('hunter2-secret')
    const adapter = countingAdapter()
    const planner = scriptedPlanner([
      makeActionPlan({ reasoning: 'First try with hunter2-secret', stepComplete: true }),
      makeActionPlan({ reasoning: 'Second try with hunter2-secret', stepComplete: true }),
      makeActionPlan({ reasoning: 'Third try with hunter2-secret', stepComplete: true }),
    ])
    const verifier = scriptedVerifier([
      { success: false, reasoning: 'Saved banner absent (1)', isAppError: false },
      { success: false, reasoning: 'Saved banner absent (2)', isAppError: false },
      { success: false, reasoning: 'Saved banner absent for hunter2-secret', isAppError: false },
    ])
    const result = await executeStep('Save the form', ports({ adapter, planner, verifier, masking, plannerConfig: limits(3) }), makeStepContext())
    expect(result.status).toBe('failed')
    expect(adapter.executed).toHaveLength(3)
    expect(verifier.calls).toBe(3)
    const stop = result.evidence?.limitStop
    expect(stop?.lastVerifierRejection).toBe(masking.mask('Saved banner absent for hunter2-secret'))
    expect(stop?.lastPlannerReasoning).toBe(masking.mask('Third try with hunter2-secret'))
    expect(stop?.lastVerifierRejection).not.toContain('hunter2-secret')
    expect(stop?.lastPlannerReasoning).not.toContain('hunter2-secret')
    expect(result.evidence?.verdictSource).toBeUndefined()
  })

  it('screen changes never refill the counter', async () => {
    const screens = Array.from({ length: 200 }, (_, i) => makeScreenState({
      tree: `[Viewport: 390x844] [2 elements]\n- textbox "Email" [ref=e1]\n- button "Log in" [ref=e2]\n- text "tick ${i}"`,
    }))
    let executes = 0
    const base = makeAdapter({ observeResults: screens })
    const adapter: PlatformAdapter = { ...base, async execute(action) { executes++; return base.execute(action) } }
    const planner = scriptedPlanner([makeActionPlan({ stepComplete: false })])
    const result = await executeStep('Keep pressing', ports({ adapter, planner, plannerConfig: limits(4) }), makeStepContext())
    expect(executes).toBe(4)
    expect(result.status).toBe('failed')
    expect(result.evidence?.limitStop).toMatchObject({ limit: 'actions', configured: 4, used: 4 })
  })

  it('without plannerConfig the schema defaults apply', async () => {
    const result = await executeStep(
      'Click Log in',
      ports({ adapter: countingAdapter(), planner: scriptedPlanner([makeActionPlan()]) }),
      makeStepContext(),
    )
    expect(result.status).toBe('passed')
    expect(result.evidence?.limitUsage?.limits).toEqual(DEFAULT_PLANNER_LIMITS)
    expect(result.evidence?.limitUsage?.actionsUsed).toBe(1)
  })

  describe('resolvePlannerLimits takes the last positive integer per key', () => {
    it('no blocks, absent planner and empty planner resolve the defaults', () => {
      expect(resolvePlannerLimits()).toEqual({ maxActions: 30, maxPlanningTurns: 30 })
      expect(resolvePlannerLimits(undefined, null, {}, { planner: {} })).toEqual(DEFAULT_PLANNER_LIMITS)
    })

    it('one key set leaves the other at its default', () => {
      expect(resolvePlannerLimits({ planner: { maxActions: 7 } })).toEqual({ maxActions: 7, maxPlanningTurns: 30 })
    })

    it('a later block overrides an earlier one per key', () => {
      expect(resolvePlannerLimits(
        { planner: { maxActions: 40, maxPlanningTurns: 45 } },
        { planner: { maxActions: 60 } },
        undefined,
      )).toEqual({ maxActions: 60, maxPlanningTurns: 45 })
    })

    it('0, -1, 2.5 and a string are ignored', () => {
      for (const bad of [0, -1, 2.5, '7', Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
        expect(resolvePlannerLimits({ planner: { maxActions: 12 } }, { planner: { maxActions: bad, maxPlanningTurns: bad } }))
          .toEqual({ maxActions: 12, maxPlanningTurns: 30 })
      }
    })

    it('the reason formatter spells both limits', () => {
      expect(formatLimitStopReason('actions', 30, 30)).toBe('Stopped: action limit reached — 30 of 30 actions used')
      expect(formatLimitStopReason('planning-turns', 30, 30)).toBe('Stopped: planning-turn limit reached — 30 of 30 planner calls used')
    })
  })
})
