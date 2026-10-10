// C438-HEAL-LANES (438 D-04, D-08; CR-01): a heal re-finds EVERY ref lane of the failed action in
// the fresh observation by role, exact name and row words (strictMatch) and judges every stated
// lane against its re-found element, or sends nothing. No pre-observe ref reaches the adapter
// after a heal. Model-free: a scripted planner and a recording android adapter that shows the
// prior page until the first dispatch and the fresh page on every observation after it (the
// loop's settle needs two equal reads, so the page changes when the first action is attempted).
import { describe, expect, it } from 'vitest'
import type { ScreenState } from '@vostride/agent-qa-schema'
import type { Action, ActionResult, PlatformAdapter } from '../../platform.js'
import type { StepResult } from '../../result.js'
import { buildScreenState, type InterimNode } from '../../screen-builder.js'
import { executeStep } from '../index.js'
import type { ActionPlan, Planner, StepContext } from '../types.js'
import { makeStepContext } from './loop-harness.js'

// Every node gets bounds so its ref is in the refMap and the committed-ref lane grounds it.
function screenOf(nodes: InterimNode[]): ScreenState {
  return buildScreenState({
    platform: 'android',
    nodes: nodes.map((node, i) => ({
      bounds: { x: 0, y: i * 60, width: 400, height: 50 },
      ...node,
    })),
    viewport: { width: 400, height: 800 },
    scroll: { offsetX: 0, offsetY: 0, contentWidth: 400, contentHeight: 800 },
    coordSpace: 'viewport',
    timestamp: 0,
  }).state
}

function refNamed(screen: ScreenState, name: string): string {
  const element = screen.elements.find((candidate) => candidate.name === name)
  if (element === undefined) throw new Error(`no element named ${name}`)
  return element.ref
}

type RecordingAdapter = PlatformAdapter & { executed: Action[] }

function adapter(
  prior: ScreenState,
  fresh: ScreenState,
  results: ActionResult[],
): RecordingAdapter {
  const executed: Action[] = []
  return {
    executed,
    platform: 'android',
    async setup() {},
    async cleanup() {},
    async observe() {
      return executed.length === 0 ? prior : fresh
    },
    async execute(action: Action) {
      const result = results[Math.min(executed.length, results.length - 1)]!
      executed.push(action)
      return result
    },
  }
}

function plan(action: ActionPlan['action']): ActionPlan {
  return { reasoning: 'scripted', action, confidence: 0.9, stepComplete: true, stepFailed: false }
}

const GIVE_UP: ActionPlan = {
  reasoning: 'giving up',
  action: { type: 'delay', ms: 0 },
  confidence: 0.9,
  stepComplete: false,
  stepFailed: true,
}

function scriptedPlanner(
  turns: Array<ActionPlan | ((context: StepContext) => ActionPlan)>,
): Planner & { calls: number } {
  const planner = {
    calls: 0,
    async plan(_step: string, _screen: ScreenState, context: StepContext) {
      const turn = turns[Math.min(planner.calls, turns.length - 1)]
      planner.calls++
      return { plan: typeof turn === 'function' ? turn(context) : turn }
    },
  }
  return planner
}

const limits = (maxActions: number, maxPlanningTurns: number) => ({
  maxActions,
  maxPlanningTurns,
  previousStepCount: 0,
})

function metadataOf(
  result: StepResult,
  key: string,
  index = 0,
): Record<string, unknown> | undefined {
  return result.evidence?.subActions[index]?.result.metadata?.[key] as
    | Record<string, unknown>
    | undefined
}

const CARD = { role: 'button', name: 'Card' }
const DROP_A = { role: 'button', name: 'Drop A' }

const BINDING_LOST_TO_REF: ActionResult = {
  success: false,
  error: 'binding-lost: ref e2 — the observed element is no longer on the page; nothing was sent',
  metadata: { binding: { outcome: 'binding-lost', ref: 'e2', inputSent: false } },
}
const UNKNOWN_TO_REF: ActionResult = {
  success: false,
  error: 'Unknown ref "e2". Available refs: e1',
}

const PRIOR = screenOf([
  { role: 'button', name: 'Card' },
  { role: 'button', name: 'Drop A' },
])

// One element is inserted ahead of both lanes, and a second ahead of the drop target, so the
// fresh 'e2' is "Card" and "Drop A" sits at 'e4'.
const FRESH = screenOf([
  { role: 'button', name: 'Banner' },
  { role: 'button', name: 'Card' },
  { role: 'button', name: 'Promo' },
  { role: 'button', name: 'Drop A' },
])

function dragCardOntoDropA(toTarget: Record<string, string> = DROP_A): ActionPlan['action'] {
  return { type: 'drag', fromRef: 'e1', fromTarget: CARD, toRef: 'e2', toTarget }
}

async function runDrag(
  prior: ScreenState,
  fresh: ScreenState,
  firstResult: ActionResult,
  action: ActionPlan['action'] = dragCardOntoDropA(),
) {
  const a = adapter(prior, fresh, [firstResult, { success: true }])
  const planner = scriptedPlanner([plan(action), GIVE_UP])
  const result = await executeStep(
    'Drag Card onto Drop A',
    { adapter: a, planner, plannerConfig: limits(10, 10) },
    makeStepContext(),
  )
  return { a, planner, result }
}

describe('C438-HEAL-LANES', () => {
  it('a drag whose toRef binding is lost re-finds both lanes and drops on the re-found target', async () => {
    const { a, planner, result } = await runDrag(PRIOR, FRESH, BINDING_LOST_TO_REF)

    expect(a.executed).toHaveLength(2)
    expect(a.executed[1]).toEqual({
      type: 'drag',
      fromRef: refNamed(FRESH, 'Card'),
      toRef: refNamed(FRESH, 'Drop A'),
    })
    expect((a.executed[1] as { toRef?: unknown }).toRef).not.toBe('e2')
    expect(result.status).toBe('passed')
    expect(planner.calls).toBe(1)
  })

  it('a drag whose toRef is an unknown ref re-finds both lanes the same way', async () => {
    const { a, planner, result } = await runDrag(PRIOR, FRESH, UNKNOWN_TO_REF)

    expect(a.executed).toHaveLength(2)
    expect(a.executed[1]).toEqual({
      type: 'drag',
      fromRef: refNamed(FRESH, 'Card'),
      toRef: refNamed(FRESH, 'Drop A'),
    })
    expect((a.executed[1] as { toRef?: unknown }).toRef).not.toBe('e2')
    expect(result.status).toBe('passed')
    expect(planner.calls).toBe(1)
  })

  it('a stated toTarget that contradicts the re-found drop target is refused on the heal path', async () => {
    const fresh = screenOf([
      { role: 'button', name: 'Banner' },
      { role: 'button', name: 'Card' },
      { role: 'listitem', text: 'Lane 2' },
      { role: 'button', name: 'Drop A', parentIndex: 2 },
    ])
    const { a, result } = await runDrag(
      PRIOR,
      fresh,
      BINDING_LOST_TO_REF,
      dragCardOntoDropA({ role: 'button', name: 'Drop A', row: 'Lane 1' }),
    )

    expect(a.executed).toHaveLength(1)
    expect(metadataOf(result, 'targetRefusal')).toMatchObject({
      kind: 'target-mismatch',
      lane: 'toRef',
      path: 'heal',
      reasons: ['row'],
      rowStated: true,
      inputSent: false,
    })
    expect(result.evidence?.limitUsage).toMatchObject({ actionsUsed: 1 })
  })

  it('a drop target that is not provably the same refuses the heal and nothing is re-dispatched', async () => {
    const fresh = screenOf([
      { role: 'button', name: 'Banner' },
      { role: 'button', name: 'Card' },
      { role: 'button', name: 'Drop A' },
      { role: 'button', name: 'Drop A' },
    ])
    const { a, result } = await runDrag(PRIOR, fresh, BINDING_LOST_TO_REF)

    expect(a.executed).toHaveLength(1)
    expect(metadataOf(result, 'binding')).toMatchObject({ heal: 'not-unique' })
  })

  it('two lanes that re-find one element refuse the heal', async () => {
    const tile = { role: 'button', name: 'Tile' }
    const prior = screenOf([
      { role: 'button', name: 'Tile' },
      { role: 'button', name: 'Tile' },
    ])
    const fresh = screenOf([
      { role: 'button', name: 'Banner' },
      { role: 'button', name: 'Tile' },
    ])
    const { a, result } = await runDrag(prior, fresh, BINDING_LOST_TO_REF, {
      type: 'drag',
      fromRef: 'e1',
      fromTarget: tile,
      toRef: 'e2',
      toTarget: tile,
    })

    expect(a.executed).toHaveLength(1)
    expect(metadataOf(result, 'binding')).toMatchObject({ heal: 'not-unique' })
  })
})
