// Shared fakes for the runner loop test suite (353-04). Framework-free helpers: the
// test files supply the it()/expect wrappers. Models a fake PlatformAdapter, a scripted
// Planner/Verifier, and a structural SafetyHookRunner stub (RESEARCH Pitfall 2 — the
// concrete HookRegistry is nominally typed, so the run-facing surface is stubbed here).
import type { LanguageModel } from 'ai'
import type { SafetyHookRunner } from '@vostride/agent-qa-safety'
import type { ScreenState } from '@vostride/agent-qa-schema'
import type { PlatformAdapter, Action, ActionResult } from '../../platform.js'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import type { ActionPlan, PlanResult, Planner, StepContext, VerificationResult, Verifier } from '../types.js'

export const fakeModel = {} as unknown as LanguageModel

export function makeStepContext(overrides?: Partial<StepContext>): StepContext {
  return {
    stepInstruction: 'Click the Log in button',
    testName: 'Login test',
    previousSteps: [],
    plannerModel: fakeModel,
    verifierModel: fakeModel,
    ...overrides,
  }
}

export function makeActionPlan(overrides?: Partial<ActionPlan>): ActionPlan {
  return {
    reasoning: 'Clicking the Log in button to submit the form',
    action: { type: 'click', ref: 'e2' },
    confidence: 0.95,
    stepComplete: true,
    stepFailed: false,
    ...overrides,
  }
}

export interface FakeAdapterOptions {
  observeResults?: ScreenState[]
  executeResult?: ActionResult
  executeResults?: ActionResult[]
  screenshot?: () => Promise<Buffer | undefined>
}

export function makeAdapter(options?: FakeAdapterOptions): PlatformAdapter {
  let observeCall = 0
  let executeCall = 0
  const observeResults = options?.observeResults ?? [makeScreenState()]
  const executeResults = options?.executeResults
  const singleExecute = options?.executeResult ?? { success: true }

  const adapter: PlatformAdapter = {
    platform: 'web',
    async setup() {},
    async cleanup() {},
    async observe() {
      const idx = Math.min(observeCall, observeResults.length - 1)
      observeCall++
      return observeResults[idx]
    },
    async execute(_action: Action) {
      if (executeResults) {
        const idx = Math.min(executeCall, executeResults.length - 1)
        executeCall++
        return executeResults[idx]
      }
      executeCall++
      return singleExecute
    },
  }
  if (options?.screenshot) adapter.screenshot = options.screenshot
  return adapter
}

export function makePlanner(plans?: ActionPlan[]): Planner {
  let call = 0
  const list = plans ?? [makeActionPlan()]
  return {
    async plan(): Promise<PlanResult> {
      const idx = Math.min(call, list.length - 1)
      call++
      return { plan: list[idx] }
    },
  }
}

export function makeVerifier(results?: VerificationResult[]): Verifier {
  let call = 0
  const list = results ?? [{ success: true, reasoning: 'Step completed', isAppError: false }]
  return {
    async verify() {
      const idx = Math.min(call, list.length - 1)
      call++
      return { verification: list[idx] }
    },
  }
}

export function makeSafetyHooks(overrides: Partial<SafetyHookRunner> = {}): SafetyHookRunner {
  return {
    runContext: (context) => ({ context }),
    runToolCall: (call) => ({ action: 'allow', call }),
    runToolResult: (result) => ({ result }),
    runProviderRequest: (params) => params,
    runToolCallAsync: async (call) => ({ action: 'allow', call }),
    ...overrides,
  }
}
