import { describe, it, expect } from 'vitest'
import type { ScreenState } from '@vostride/agent-qa-schema'
import type { PlatformAdapter, Action, ActionResult } from '../../platform.js'
import type { LoopPorts } from '../ports.js'
import { executeStep } from '../index.js'
import { buildAgentScreenState, type LooseElement } from './screen-fixtures.js'
import { makeActionPlan, makeStepContext, makeVerifier, makePlanner } from './loop-harness.js'

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
