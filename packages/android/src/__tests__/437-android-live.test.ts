// C437-ANDROID-LIVE (437 D-20): the toggle fix run live on an emulator's Settings app
// (com.android.settings), through the real runner loop with a scripted planner and verifier. No
// model is called. It proves on a device that an ordinary node exposing `selected` is never
// skipped as already satisfied: a row tapped under desiredState unselected is sent, by ref and by
// coordinate.
//
// Skipped unless AGENT_QA_437_ANDROID_LIVE=1, with a booted emulator and Appium reachable at
// AGENT_QA_APPIUM_URL or http://localhost:4723. A skipped cell is registered as not run in
// scripts/gate/inputs/register.json; a skip is never a pass.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeStep } from '@vostride/agent-qa-runner'
import type {
  Action,
  ActionPlan,
  PlannerConfig,
  Planner,
  PlatformAdapter,
  StepContext,
  StepResult,
  Verifier,
} from '@vostride/agent-qa-runner'
import type { Ref, ScreenState } from '@vostride/agent-qa-schema'
import { AndroidPlatformAdapter } from '../adapter.js'

const LIVE = process.env.AGENT_QA_437_ANDROID_LIVE === '1'
const SETTINGS = 'com.android.settings'
const LIMITS: PlannerConfig = { maxActions: 30, maxPlanningTurns: 30, previousStepCount: 0 }
const ROW = 'Network & internet'

type Turn = (screen: ScreenState) => ActionPlan
type Element = ScreenState['elements'][number]

function elementFor(screen: ScreenState, name: string): Element {
  const element = screen.elements.find((e) => e.name === name)
  if (element === undefined) throw new Error(`"${name}" is not on the screen`)
  return element
}

function refFor(screen: ScreenState, name: string): Ref {
  return elementFor(screen, name).ref
}

function act(action: ActionPlan['action'], stepComplete: boolean, reasoning: string): ActionPlan {
  return { reasoning, action, confidence: 0.9, stepComplete, stepFailed: false }
}

function onScreen(screen: ScreenState, name: string): boolean {
  const height = (screen.metadata.viewportHeight as number | undefined) ?? Number.POSITIVE_INFINITY
  return screen.elements.some((e) =>
    e.name === name && e.bounds !== undefined && e.bounds.height > 0 && e.bounds.y >= 0 && e.bounds.y < height)
}

function onNetworkPage(screen: ScreenState): boolean {
  return onScreen(screen, 'Airplane mode') || onScreen(screen, 'Internet')
}

interface Run {
  result: StepResult
  executed: Action[]
  planned: ActionPlan[]
}

async function runStep(
  adapter: PlatformAdapter,
  instruction: string,
  turns: Turn[],
  check: (after: ScreenState) => boolean,
): Promise<Run> {
  const executed: Action[] = []
  const planned: ActionPlan[] = []
  const counting = new Proxy(adapter, {
    get(target, property) {
      if (property === 'execute') {
        return async (action: Action) => {
          executed.push(action)
          return target.execute(action)
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })
  const planner: Planner = {
    async plan(_step, screen) {
      const plan = turns[Math.min(planned.length, turns.length - 1)](screen)
      planned.push(plan)
      return { plan }
    },
  }
  const verifier: Verifier = {
    async verify(_step, _before, after) {
      const pass = check(after)
      return { verification: { success: pass, reasoning: pass ? 'requested outcome seen' : 'requested outcome absent', isAppError: false } }
    },
  }
  const context: StepContext = {
    stepInstruction: instruction,
    testName: '437 Android live',
    previousSteps: [],
    plannerModel: {} as StepContext['plannerModel'],
    verifierModel: {} as StepContext['verifierModel'],
  }
  const result = await executeStep(instruction, { adapter: counting, planner, verifier, plannerConfig: LIMITS }, context)
  return { result, executed, planned }
}

describe.skipIf(!LIVE)('C437-ANDROID-LIVE', () => {
  let adapter: AndroidPlatformAdapter | undefined

  beforeEach(async () => {
    const created = new AndroidPlatformAdapter()
    await created.setup({ platform: 'android', appPackage: SETTINGS, appActivity: '.Settings' } as Parameters<typeof created.setup>[0])
    adapter = created
    const driver = (created as unknown as { driver: WebdriverIO.Browser }).driver
    await driver.terminateApp(SETTINGS)
    await driver.activateApp(SETTINGS)
  }, 120_000)

  afterEach(async () => {
    await adapter?.cleanup()
    adapter = undefined
  }, 120_000)

  it('an ordinary row is tapped under desiredState unselected on the ref path', async () => {
    const run = await runStep(adapter!, 'Open Network & internet', [
      (screen) => act({ type: 'tap', ref: refFor(screen, ROW), desiredState: 'unselected' }, true, 'Open Network & internet'),
    ], onNetworkPage)

    expect(run.result.status).toBe('passed')
    expect(run.executed).toHaveLength(1)
    expect(run.executed[0]).toMatchObject({ type: 'tap', desiredState: 'unselected' })
    const sub = run.result.evidence!.subActions[0]
    expect(sub.result.success).toBe(true)
    expect(sub.result.metadata?.['idempotentNoop']).toBeUndefined()
  }, 240_000)

  it('the same row through tapCoordinate is sent', async () => {
    const run = await runStep(adapter!, 'Open Network & internet', [
      (screen) => {
        const bounds = elementFor(screen, ROW).bounds
        if (bounds === undefined) throw new Error(`"${ROW}" has no bounds`)
        const x = Math.round(bounds.x + bounds.width / 2)
        const y = Math.round(bounds.y + bounds.height / 2)
        return act({ type: 'tapCoordinate', x, y, coordSpace: 'viewport' }, true, 'Tap the Network & internet row')
      },
    ], onNetworkPage)

    expect(run.result.status).toBe('passed')
    expect(run.executed).toHaveLength(1)
    expect(run.executed[0]).toMatchObject({ type: 'tapCoordinate' })
    const sub = run.result.evidence!.subActions[0]
    expect(sub.result.success).toBe(true)
    expect(sub.result.metadata?.['idempotentNoop']).toBeUndefined()
  }, 240_000)
})
