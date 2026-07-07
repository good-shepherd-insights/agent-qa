import { describe, it, expect, vi } from 'vitest'
import type { PlatformAdapter, Action, ActionResult, MemberEventSink, LoopEventEmitPort } from '@vostride/agent-qa-runner'
import type { ScreenState } from '@vostride/agent-qa-schema'
import { buildAgentScreenState, type LooseScreenState } from './screen-fixtures.js'
import type { ActionPlan } from '../../schema/action-schema.js'
import type { Planner } from '../types.js'
import type { TestDefinition } from '../../types/test.js'
import { runTest } from '../runner.js'
import type { RunTestConfig } from '../runner.js'

// Plan 361-09 Task 1: the three additive RunTestConfig seams (events, abortSignal,
// configDigests) threaded straight through runTest into the loop, with core's per-test
// SIGINT registration yielding to the shell's run-level abort (D-02/D-03/D-20). These pins
// prove: stepStarted fires once per step (index + text); each step's LoopPorts bundle carries
// the sink's loopEmitFor(stepIndex) port; an external abort chains into testAbortController
// AND suppresses core's SIGINT listener; a no-seam run is unchanged.

function makeScreenState(overrides: LooseScreenState = {}): ScreenState {
  return buildAgentScreenState({
    tree: 'button "OK" [ref=btn-1]',
    elements: [
      { ref: 'btn-1', role: 'button', name: 'OK', attributes: {} },
    ],
    url: 'https://example.com',
    ...overrides,
  })
}

function makeActionPlan(overrides?: Partial<ActionPlan>): ActionPlan {
  return {
    reasoning: 'Clicking OK',
    action: { type: 'click', ref: 'btn-1' },
    confidence: 0.9,
    stepComplete: true,
    stepFailed: false,
    ...overrides,
  }
}

function createMockAdapter(options?: {
  executeResults?: ActionResult[]
}): PlatformAdapter {
  let executeCallCount = 0
  const executeResults = options?.executeResults ?? [{ success: true }]
  return {
    platform: 'web',
    async setup() {},
    async cleanup() {},
    async observe() { return makeScreenState() },
    async execute(_action: Action) {
      const idx = Math.min(executeCallCount, executeResults.length - 1)
      executeCallCount++
      return executeResults[idx]
    },
  }
}

function createMockPlanner(): Planner {
  return {
    async plan() { return { plan: makeActionPlan() } },
  }
}

function makeRunTestConfig(overrides?: Partial<RunTestConfig>): RunTestConfig {
  return {
    adapter: createMockAdapter(),
    planner: createMockPlanner(),
    plannerModel: {} as any,
    verifierModel: {} as any,
    ...overrides,
  }
}

function makeTestDef(overrides?: Partial<TestDefinition>): TestDefinition {
  return {
    'test-id': 't_threading',
    name: 'Threading test',
    target: 'default',
    steps: ['Click Login', 'Enter email', 'Click Submit'],
    ...overrides,
  }
}

function createFakeSink(): {
  sink: MemberEventSink
  stepStarted: ReturnType<typeof vi.fn>
  loopEmitFor: ReturnType<typeof vi.fn>
  emitPorts: LoopEventEmitPort[]
} {
  const emitPorts: LoopEventEmitPort[] = []
  const stepStarted = vi.fn()
  const loopEmitFor = vi.fn((_stepIndex: number) => {
    const port: LoopEventEmitPort = {
      stepFinalized: vi.fn(),
      subActionRecorded: vi.fn(),
    }
    emitPorts.push(port)
    return port
  })
  return { sink: { stepStarted, loopEmitFor }, stepStarted, loopEmitFor, emitPorts }
}

describe('361-09 · member event sink threading (D-02)', () => {
  it('fires stepStarted once per step and curries loopEmitFor(stepIndex) into each step bundle', async () => {
    const { sink, stepStarted, loopEmitFor } = createFakeSink()
    const config = makeRunTestConfig({ events: sink })
    const test = makeTestDef({ steps: ['Step A', 'Step B', 'Step C'] })

    const result = await runTest(test, config, '/tests/threading.yaml')

    expect(result.status).toBe('passed')
    expect(stepStarted).toHaveBeenCalledTimes(3)
    expect(stepStarted).toHaveBeenNthCalledWith(1, { stepIndex: 0, stepText: 'Step A' })
    expect(stepStarted).toHaveBeenNthCalledWith(2, { stepIndex: 1, stepText: 'Step B' })
    expect(stepStarted).toHaveBeenNthCalledWith(3, { stepIndex: 2, stepText: 'Step C' })
    // One curried loop-emit port per step, minted with the step's own index.
    expect(loopEmitFor.mock.calls.map((c) => c[0])).toEqual([0, 1, 2])
  })

  it('does not require the events seam — a run without it behaves unchanged', async () => {
    const config = makeRunTestConfig()
    const test = makeTestDef({ steps: ['Step A'] })

    const result = await runTest(test, config, '/tests/no-events.yaml')

    expect(result.status).toBe('passed')
    expect(result.steps).toHaveLength(1)
  })
})

describe('361-09 · external abort + SIGINT suppression (D-03)', () => {
  it('an already-aborted external signal cancels the test with no steps executed', async () => {
    const controller = new AbortController()
    controller.abort(new Error('run cancelled by shell'))
    const config = makeRunTestConfig({ abortSignal: controller.signal })
    const test = makeTestDef({ steps: ['Step A', 'Step B'] })

    const result = await runTest(test, config, '/tests/abort-pre.yaml')

    expect(result.status).toBe('cancelled')
    expect(result.steps).toHaveLength(0)
  })

  it('an external abort mid-run cancels the active step and registers no SIGINT listener', async () => {
    let resolveObserveStarted!: () => void
    const observeStarted = new Promise<void>((resolve) => {
      resolveObserveStarted = resolve
    })
    const adapter = createMockAdapter()
    adapter.observe = async () => {
      resolveObserveStarted()
      return await new Promise<ScreenState>(() => {})
    }
    const controller = new AbortController()
    const config = makeRunTestConfig({ adapter, abortSignal: controller.signal })
    const test = makeTestDef({ steps: ['Wait for external cancel'] })

    const before = process.listenerCount('SIGINT')
    const resultPromise = runTest(test, config, '/tests/abort-mid.yaml')
    await observeStarted
    const during = process.listenerCount('SIGINT')
    controller.abort(new Error('run cancelled by shell'))
    const result = await resultPromise
    const after = process.listenerCount('SIGINT')

    expect(result.status).toBe('cancelled')
    // The shell owns run-level cancel: core registers NO SIGINT handler when abortSignal is supplied.
    expect(during).toBe(before)
    expect(after).toBe(before)
  })

  it('without an external signal, core still owns per-test SIGINT and stays listener-balanced', async () => {
    const before = process.listenerCount('SIGINT')
    const config = makeRunTestConfig()
    const test = makeTestDef({ steps: ['Step A'] })

    const result = await runTest(test, config, '/tests/no-seam.yaml')

    const after = process.listenerCount('SIGINT')
    expect(result.status).toBe('passed')
    // Registers its own handler for the run, then removes it — net zero.
    expect(after).toBe(before)
  })
})
