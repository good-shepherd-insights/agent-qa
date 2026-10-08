import { describe, it, expect } from 'vitest'
import type { ScreenState } from '@vostride/agent-qa-schema'
import type { PlatformAdapter, Action, ActionResult } from '../../platform.js'
import type { LoopPorts } from '../ports.js'
import { executeStep } from '../index.js'
import { buildAgentScreenState, type LooseElement } from './screen-fixtures.js'
import { makeActionPlan, makeStepContext, makeVerifier, makePlanner } from './loop-harness.js'
import type { ActionPlan, Planner, VerificationResult } from '../types.js'
import { readIdempotentNoopMeta } from '../../compound/metadata.js'

const ROW_BOUNDS = { x: 0, y: 400, width: 1280, height: 160 }
const ROW_CENTRE = { x: 640, y: 480 }

function screenWith(element: LooseElement): ScreenState {
  return buildAgentScreenState({
    platform: 'android',
    elements: [{ ref: 'e1', bounds: ROW_BOUNDS, ...element }],
    metadata: { coordSpace: 'viewport', viewportWidth: 1280, viewportHeight: 2856 },
  })
}

function ordinaryButton(selected: boolean): ScreenState {
  return screenWith({
    role: 'button',
    name: 'Network & internet',
    state: { selected },
    attributes: { checkable: 'false', selected: String(selected) },
  })
}

function recordingAdapter(observation: ScreenState, calls: Action[]): PlatformAdapter {
  return {
    platform: 'android',
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

async function runOne(
  observation: ScreenState,
  action: Record<string, unknown> & { type: string },
) {
  const calls: Action[] = []
  const ports: LoopPorts = {
    adapter: recordingAdapter(observation, calls),
    planner: makePlanner([makeActionPlan({ action, stepComplete: true })]),
    verifier: makeVerifier(),
    plannerConfig: { maxActions: 4, maxPlanningTurns: 4, previousStepCount: 0 },
  }
  const result = await executeStep('Set the row', ports, makeStepContext())
  return { calls, result }
}

interface LooseSub {
  result?: { metadata?: Record<string, unknown> }
}

describe('C437-TOGGLE-LOOP', () => {
  it('an ordinary button with selected false is tapped under desiredState unselected', async () => {
    const { calls, result } = await runOne(ordinaryButton(false), {
      type: 'tap',
      ref: 'e1',
      desiredState: 'unselected',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ type: 'tap', ref: 'e1' })
    expect(result.status).toBe('passed')
  })

  it('an ordinary button with selected true is tapped under desiredState selected', async () => {
    const { calls, result } = await runOne(ordinaryButton(true), {
      type: 'tap',
      ref: 'e1',
      desiredState: 'selected',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ type: 'tap', ref: 'e1' })
    expect(result.status).toBe('passed')
  })

  it("a tapCoordinate at the ordinary node's centre is sent", async () => {
    const { calls, result } = await runOne(ordinaryButton(false), {
      type: 'tapCoordinate',
      x: ROW_CENTRE.x,
      y: ROW_CENTRE.y,
      coordSpace: 'viewport',
      desiredState: 'unselected',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ type: 'tapCoordinate', x: ROW_CENTRE.x, y: ROW_CENTRE.y })
    expect(result.status).toBe('passed')
  })

  it('a checkable button already checked is not tapped under desiredState selected', async () => {
    const observation = screenWith({
      role: 'button',
      name: 'Bold',
      state: { checked: true, selected: false },
      attributes: { checkable: 'true', checked: 'true', selected: 'false' },
    })
    const { calls, result } = await runOne(observation, {
      type: 'tap',
      ref: 'e1',
      desiredState: 'selected',
    })
    expect(calls).toHaveLength(0)
    const sub = (result.evidence as { subActions?: LooseSub[] } | undefined)?.subActions?.[0]
    const noop = sub?.result?.metadata?.['idempotentNoop'] as { currentState?: unknown } | undefined
    expect(noop?.currentState).toBe('checked')
  })

  it('a switch not in the requested state is tapped once', async () => {
    const observation = screenWith({
      role: 'switch',
      name: 'Dark theme',
      state: { checked: false, selected: false },
      attributes: { checkable: 'true', checked: 'false', selected: 'false' },
    })
    const { calls } = await runOne(observation, { type: 'tap', ref: 'e1', desiredState: 'checked' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ type: 'tap', ref: 'e1' })
  })

  it('a switch with no checked state is tapped once', async () => {
    const observation = screenWith({
      role: 'switch',
      name: 'Dark theme',
      state: { selected: false },
      attributes: { selected: 'false' },
    })
    const { calls } = await runOne(observation, {
      type: 'tap',
      ref: 'e1',
      desiredState: 'unchecked',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ type: 'tap', ref: 'e1' })
  })
})

function checkedSwitch(): ScreenState {
  return screenWith({
    role: 'switch',
    name: 'Dark theme',
    state: { checked: true, selected: false },
    attributes: { checkable: 'true', checked: 'true', selected: 'false' },
  })
}

const SKIPPED_TAP = { type: 'tap', ref: 'e1', desiredState: 'checked' }
const NO_INPUT = { currentState: 'checked', inputSent: false }

interface RecordedSub {
  result: { success: boolean; error?: string; metadata?: Record<string, unknown> }
}

function subActions(result: Awaited<ReturnType<typeof executeStep>>): RecordedSub[] {
  return (result.evidence as { subActions?: RecordedSub[] } | undefined)?.subActions ?? []
}

function capturingPlanner(plans: ActionPlan[], failureContexts: (string | undefined)[]): Planner {
  let call = 0
  return {
    async plan(_step, _screen, context) {
      failureContexts.push(context.failureContext)
      const plan = plans[Math.min(call, plans.length - 1)]
      call++
      return { plan }
    },
  }
}

interface RunOptions {
  verifier?: VerificationResult[]
  abortSignal?: AbortSignal
  planner?: Planner
}

async function runPlans(plans: ActionPlan[], options: RunOptions = {}) {
  const calls: Action[] = []
  const ports: LoopPorts = {
    adapter: recordingAdapter(checkedSwitch(), calls),
    planner: options.planner ?? makePlanner(plans),
    verifier: makeVerifier(options.verifier),
    plannerConfig: { maxActions: 4, maxPlanningTurns: 4, previousStepCount: 0 },
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
  }
  const result = await executeStep('Turn dark theme on', ports, makeStepContext())
  return { calls, result }
}

function noopResult(success: boolean, idempotentNoop: Record<string, unknown>): ActionResult {
  return { success, metadata: { idempotentNoop } }
}

describe('C437-NO-INPUT', () => {
  it('a skipped tap is recorded with success false, no error and inputSent false', async () => {
    const { calls, result } = await runPlans([
      makeActionPlan({ action: SKIPPED_TAP, stepComplete: true }),
    ])
    expect(calls).toHaveLength(0)
    const sub = subActions(result)[0]
    expect(sub.result.success).toBe(false)
    expect(sub.result.error).toBeUndefined()
    expect(sub.result.metadata?.['idempotentNoop']).toEqual(NO_INPUT)
    expect(result.status).toBe('passed')
  })

  it('the skipped tap is one counted action', async () => {
    const { result } = await runPlans([makeActionPlan({ action: SKIPPED_TAP, stepComplete: true })])
    expect(result.evidence?.limitUsage?.actionsUsed).toBe(1)
  })

  it('a skipped tap with a rejecting verifier replans without a failure context naming an error', async () => {
    const failureContexts: (string | undefined)[] = []
    const plans = [
      makeActionPlan({ action: SKIPPED_TAP, stepComplete: true }),
      makeActionPlan({ action: { type: 'stepFailed' }, stepComplete: false, stepFailed: true }),
    ]
    const { calls } = await runPlans(plans, {
      planner: capturingPlanner(plans, failureContexts),
      verifier: [{ success: false, reasoning: 'The switch still reads off', isAppError: false }],
    })
    expect(calls).toHaveLength(0)
    expect(failureContexts).toHaveLength(2)
    const replanContext = failureContexts[1] ?? ''
    expect(replanContext).toContain('did not accomplish the goal: The switch still reads off')
    expect(replanContext).not.toContain('failed:')
  })

  it('the same skipped tap planned twice sends nothing either time', async () => {
    const { calls, result } = await runPlans([
      makeActionPlan({ action: SKIPPED_TAP, stepComplete: false }),
      makeActionPlan({ action: SKIPPED_TAP, stepComplete: true }),
    ])
    expect(calls).toHaveLength(0)
    const subs = subActions(result)
    expect(subs).toHaveLength(2)
    for (const sub of subs) {
      expect(sub.result.success).toBe(false)
      expect(sub.result.metadata?.['idempotentNoop']).toEqual(NO_INPUT)
    }
    expect(result.evidence?.limitUsage?.actionsUsed).toBe(2)
  })

  it('an abort raised during a skipped-tap step executes nothing', async () => {
    const controller = new AbortController()
    const planner: Planner = {
      async plan() {
        controller.abort(new Error('User cancelled'))
        return { plan: makeActionPlan({ action: SKIPPED_TAP, stepComplete: true }) }
      },
    }
    const { calls, result } = await runPlans([], { planner, abortSignal: controller.signal })
    expect(result.status).toBe('cancelled')
    expect(calls).toHaveLength(0)
  })

  it('readIdempotentNoopMeta reads the pre-437 block and the new block', () => {
    expect(readIdempotentNoopMeta(noopResult(true, { currentState: 'checked' }))).toEqual({
      currentState: 'checked',
    })
    expect(readIdempotentNoopMeta(noopResult(false, NO_INPUT))).toEqual(NO_INPUT)
    expect(
      readIdempotentNoopMeta(noopResult(false, { currentState: 'checked', inputSent: true })),
    ).toBeUndefined()
  })
})
