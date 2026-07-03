// LIVE cutover proof (353-05, D-01/D-16): core's transitional runTest builds the
// runner LoopPorts bundle and delegates to the runner-owned executeStep. A real test
// step executes through the runner loop, and the accumulated §A8 StepEvidence rides on
// the returned TestResult with full ScreenState refMaps — offline-resolvable NOW
// (SCREEN-02's "persists" satisfied this phase), proving the requirement at the
// composition level (not just the runner unit level).
import { describe, it, expect, vi } from 'vitest'
import type { PlatformAdapter, Action, ActionResult } from '@vostride/agent-qa-runner'
import { makeScreenState } from '@vostride/agent-qa-runner'
import type { ScreenState } from '@vostride/agent-qa-schema'
import type { Planner, Verifier } from '../types.js'
import type { TestDefinition } from '../../types/test.js'
import { runTest } from '../runner.js'
import type { RunTestConfig } from '../runner.js'

vi.mock('@vostride/agent-qa-web', () => ({ runAccessibilityCheck: vi.fn() }))

function fakeAdapter(observed: ScreenState): PlatformAdapter {
  return {
    platform: 'web',
    async setup() {},
    async cleanup() {},
    async observe(): Promise<ScreenState> { return observed },
    async execute(_action: Action): Promise<ActionResult> { return { success: true } },
  }
}

// Scripted planner: plans a single click against the observed screen and declares the
// step complete. Stands in for the LLM planner so the loop runs end-to-end offline.
function scriptedPlanner(): Planner {
  return {
    async plan() {
      return { plan: { reasoning: 'click the login button', action: { type: 'click', ref: 'e2' }, confidence: 1, stepComplete: true, stepFailed: false } }
    },
  }
}

function passingVerifier(): Verifier {
  return {
    async verify() {
      return { verification: { success: true, reasoning: 'goal met', isAppError: false } }
    },
  }
}

function makeConfig(overrides?: Partial<RunTestConfig>): RunTestConfig {
  return {
    adapter: fakeAdapter(makeScreenState()),
    planner: scriptedPlanner(),
    verifier: passingVerifier(),
    plannerModel: {} as never,
    verifierModel: {} as never,
    ...overrides,
  }
}

function makeTestDef(): TestDefinition {
  return {
    'test-id': 't_login',
    name: 'login',
    target: 'default',
    steps: ['click the login button'],
  }
}

describe('runTest — runner loop is THE live loop (D-01)', () => {
  it('executes a step end-to-end through the runner executeStep (fake adapter + scripted planner)', async () => {
    const result = await runTest(makeTestDef(), makeConfig(), '/tests/login.yaml')

    expect(result.steps).toHaveLength(1)
    expect(result.steps[0].status).toBe('passed')
    // The step result carries the additive §A8 evidence produced by the runner loop.
    expect(result.steps[0].evidence).toBeDefined()
  })

  it('persists step evidence whose recorded refs resolve offline to role/nameNormalized/bounds (SCREEN-02, D-16)', async () => {
    const result = await runTest(makeTestDef(), makeConfig(), '/tests/login.yaml')

    const evidence = result.steps[0].evidence
    expect(evidence).toBeDefined()
    const sub = evidence!.subActions[0]

    // stateBefore is the FULL ScreenState (elements + refMap), not a v1 tree string.
    expect(sub.stateBefore.elements.length).toBeGreaterThan(0)
    expect(Object.keys(sub.stateBefore.refMap).length).toBeGreaterThan(0)

    // Offline ref resolution: a recorded ref maps to role/nameNormalized (elements) and
    // bounds (refMap) with no live adapter — the requirement-level integration proof.
    const el = sub.stateBefore.elements.find(e => e.ref === 'e2')
    expect(el).toBeDefined()
    expect(el!.role).toBe('button')
    expect(el!.nameNormalized).toBe('log in')
    expect(sub.stateBefore.refMap[el!.ref].bounds).toEqual(el!.bounds)
  })

  it('keeps the legacy trace shape intact for reporters (projected from evidence)', async () => {
    const result = await runTest(makeTestDef(), makeConfig(), '/tests/login.yaml')

    const step = result.steps[0]
    expect(step.trace).toBeDefined()
    expect(step.trace!.subActions).toBeDefined()
    expect(Array.isArray(step.trace!.subActions)).toBe(true)
  })
})
