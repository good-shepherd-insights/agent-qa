import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildInternalRunAttributes } from '../../run-attributes.js'
import type { TestDefinition } from '../../types/test.js'
import type { StepResult, TestResult } from '@vostride/agent-qa-runner'
import type { RunEventEnvelope, RunEventType } from '@vostride/agent-qa-schema'
import { MockAnalyticsTransport } from '../transport.js'
import { createAnalyticsRunSubscriber } from '../run-reporter.js'

const testId = 't_alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india-juliet'
const suiteId = 's_alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india-juliet'
const runId = 'r_alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india-juliet'
const parentRunId = 'r_parent-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india'
const authStateName = 'analytics-demo-acc'
const authStatePath = '/internal/auth/staging-web/analytics-demo-acc/storage-state.json'
const authCookieSecret = 'analytics-cookie-secret'
const authLocalStorageSecret = 'analytics-local-storage-secret'

function makeTest(overrides: Partial<TestDefinition> = {}): TestDefinition {
  return {
    'test-id': testId,
    name: 'Sensitive Test Name',
    target: 'web',
    steps: ['Sensitive step text'],
    ...overrides,
  } as TestDefinition
}

function makeArtifactContext() {
  return {
    runId,
    artifact: {
      kind: 'test' as const,
      config: {
        use: { authState: authStateName },
        model: {
          planner: { provider: 'openai', model: 'gpt-planner' },
          verifier: { provider: 'openai', model: 'gpt-verifier' },
        },
        runtime: {
          platform: 'web',
          browserName: 'chromium',
          authState: {
            version: 1,
            kind: 'web',
            targetName: 'staging-web',
            stateName: authStateName,
            capturedAt: '2026-05-17T00:00:00.000Z',
            storageStatePath: authStatePath,
          },
        },
        memory: {
          enabled: true,
          injectedObservationCount: 2,
        },
      },
      source: {
        kind: 'test',
        testId,
        name: 'Sensitive Test Name',
        filePath: '/private/tests/sensitive.yaml',
      },
      metadata: {
        attributes: buildInternalRunAttributes({ trigger: 'dashboard', runner: 'local' }),
      },
    },
  }
}

function makeStep(): StepResult {
  return {
    id: 'step-1',
    name: 'Sensitive step text',
    status: 'passed',
    duration: 123,
    trace: {
      observation: 'raw observation',
      reasoning: 'raw reasoning',
      plannedAction: { type: 'click' } as any,
      result: 'success',
      screenStateBefore: 'raw state',
      tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      verifierReasoning: 'verified',
      subActions: [
        {
          index: 0,
          observation: 'raw sub observation',
          reasoning: 'raw sub reasoning',
          plannedAction: { type: 'click' } as any,
          result: 'success',
          screenStateBefore: 'raw sub state',
          cached: true,
          tokenUsage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
          verifierReasoning: 'sub verified',
        },
        {
          index: 1,
          observation: 'raw failed sub observation',
          reasoning: 'raw failed sub reasoning',
          plannedAction: { type: 'fill' } as any,
          result: 'failure',
          error: 'raw subaction error',
          screenStateBefore: 'raw failed state',
          cached: false,
        },
      ],
    },
    consoleLogs: [{ level: 'error', text: 'secret console', timestamp: 1 }],
    networkLogs: [{
      url: 'https://secret.example',
      method: 'GET',
      status: 500,
      requestHeaders: {},
      responseHeaders: {},
      startTime: 1,
      endTime: 2,
    }],
  }
}

function makeResult(overrides: Partial<TestResult> = {}): TestResult {
  const result: TestResult = {
    runId,
    name: 'Sensitive Test Name',
    filePath: '/private/tests/sensitive.yaml',
    status: 'passed',
    duration: 1234,
    steps: [makeStep()],
    retryCount: 1,
    failureSummary: 'raw failure text',
    ...overrides,
  }
  ;(result as any).memoryLog = {
    added: 1,
    confirmed: 2,
    deprecated: 3,
    deleted: 4,
    deltas: [{ observationId: 'obs_secret', reasoning: 'raw memory reasoning' }],
    errors: ['raw memory error'],
    curatorDuration: 25,
    tokenUsage: { promptTokens: 7, completionTokens: 8, totalTokens: 15 },
  }
  ;(result as any).authStatePayload = {
    cookies: [{ name: 'sid', value: authCookieSecret }],
    origins: [{ origin: 'https://example.com', localStorage: [{ name: 'token', value: authLocalStorageSecret }] }],
  }
  return result
}

describe('createAnalyticsRunSubscriber', () => {
  let tempDir: string
  let identityPath: string
  let seq: number

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-qa-run-subscriber-'))
    identityPath = join(tempDir, 'analytics.json')
    seq = 0
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  function ev(busRunId: string, type: RunEventType, payload: Record<string, unknown> = {}): RunEventEnvelope {
    seq += 1
    return { seq, ts: seq, runId: busRunId, type, payload } as RunEventEnvelope
  }

  const cliAttributes = { 'agent-qa.trigger': 'cli', 'agent-qa.runner': 'local' } as const

  it('accumulates the derivable metric set from a suite envelope stream and submits at flush', async () => {
    const transport = new MockAnalyticsTransport()
    const subscriber = createAnalyticsRunSubscriber({
      surface: 'cli', transport, identityPath, env: {}, attributes: cliAttributes,
    })
    const busRunId = 'run-bus-suite'

    subscriber.handler(ev(busRunId, 'runStarted', { memberTestCount: 2 }))
    subscriber.handler(ev(busRunId, 'testStarted', { testId: testId, testIndex: 0, name: 'A', suiteId }))
    subscriber.handler(ev(busRunId, 'stepFinalized', { testIndex: 0, stepIndex: 0, status: 'passed' }))
    subscriber.handler(ev(busRunId, 'testFinished', { testId: testId, testIndex: 0, outcome: 'passed', durationMs: 1000, retryCount: 1 }))
    subscriber.handler(ev(busRunId, 'testStarted', { testId: testId, testIndex: 1, name: 'B', suiteId }))
    subscriber.handler(ev(busRunId, 'stepFinalized', { testIndex: 1, stepIndex: 0, status: 'failed' }))
    subscriber.handler(ev(busRunId, 'testFinished', { testId: testId, testIndex: 1, outcome: 'failed', durationMs: 500 }))
    subscriber.handler(ev(busRunId, 'verdict', { verdict: 'failed' }))
    subscriber.handler(ev(busRunId, 'runFinished', { aggregateVerdict: 'failed', disposition: 'detached', finalSeq: seq }))

    // No submission before flush.
    expect(transport.events).toHaveLength(0)

    await subscriber.flush()

    const names = transport.events.map(e => e.event.name)
    expect(names).toEqual([
      'agent-qa.test_run.completed',
      'agent-qa.test_run.completed',
      'agent-qa.suite_run.completed',
    ])

    const first = transport.events[0].event.properties
    expect(first).toMatchObject({
      run_id: busRunId,
      status: 'passed',
      duration_ms: 1000,
      retry_count: 1,
      is_flaky: true,
      trigger_source: 'cli',
      runner: 'local',
      step_count: 1,
      passed_step_count: 1,
    })

    const second = transport.events[1].event.properties
    expect(second).toMatchObject({ status: 'failed', duration_ms: 500, failed_step_count: 1 })

    const suite = transport.events[2].event.properties
    expect(suite).toMatchObject({
      status: 'failed',
      suite_child_count: 2,
      suite_passed_count: 1,
      suite_failed_count: 1,
      duration_ms: 1500,
    })

    expect(transport.flushCount).toBe(1)
  })

  it('maps a healed member outcome to a passed run status', async () => {
    const transport = new MockAnalyticsTransport()
    const subscriber = createAnalyticsRunSubscriber({
      surface: 'cli', transport, identityPath, env: {}, attributes: cliAttributes,
    })
    subscriber.handler(ev('r', 'runStarted', { memberTestCount: 1 }))
    subscriber.handler(ev('r', 'testStarted', { testId, testIndex: 0, name: 'A' }))
    subscriber.handler(ev('r', 'testFinished', { testId, testIndex: 0, outcome: 'healed', durationMs: 42 }))
    subscriber.handler(ev('r', 'runFinished', { aggregateVerdict: 'passed', disposition: 'detached', finalSeq: seq }))
    await subscriber.flush()

    expect(transport.events).toHaveLength(1) // single non-suite run → no suite_run event
    expect(transport.events[0].event.name).toBe('agent-qa.test_run.completed')
    expect(transport.events[0].event.properties.status).toBe('passed')
  })

  it('resets a member step tally on testRetryScheduled so a re-run never double-counts', async () => {
    const transport = new MockAnalyticsTransport()
    const subscriber = createAnalyticsRunSubscriber({
      surface: 'cli', transport, identityPath, env: {}, attributes: cliAttributes,
    })
    subscriber.handler(ev('r', 'runStarted', { memberTestCount: 1 }))
    subscriber.handler(ev('r', 'testStarted', { testId, testIndex: 0, name: 'A' }))
    subscriber.handler(ev('r', 'stepFinalized', { testIndex: 0, stepIndex: 0, status: 'failed' }))
    subscriber.handler(ev('r', 'testRetryScheduled', { testId, testIndex: 0, attempt: 1, maxAttempts: 2 }))
    subscriber.handler(ev('r', 'stepFinalized', { testIndex: 0, stepIndex: 0, status: 'passed' }))
    subscriber.handler(ev('r', 'testFinished', { testId, testIndex: 0, outcome: 'passed', durationMs: 10, retryCount: 1 }))
    subscriber.handler(ev('r', 'runFinished', { aggregateVerdict: 'passed', disposition: 'detached', finalSeq: seq }))
    await subscriber.flush()

    const props = transport.events[0].event.properties
    expect(props.step_count).toBe(1)
    expect(props.passed_step_count).toBe(1)
    expect(props.failed_step_count).toBe(0)
  })

  it('privacy opt-out is a silent no-op — no events, handler never throws', async () => {
    const transport = new MockAnalyticsTransport()
    const subscriber = createAnalyticsRunSubscriber({
      surface: 'cli', transport, identityPath, env: {}, config: { analytics: { privacy: true } } as any,
    })
    expect(() => {
      subscriber.handler(ev('r', 'runStarted', { memberTestCount: 1 }))
      subscriber.handler(ev('r', 'testFinished', { testId, testIndex: 0, outcome: 'passed', durationMs: 5 }))
      subscriber.handler(ev('r', 'runFinished', { aggregateVerdict: 'passed', disposition: 'detached', finalSeq: seq }))
    }).not.toThrow()
    await expect(subscriber.flush()).resolves.toBeUndefined()
    expect(transport.events).toHaveLength(0)
  })

  it('swallows a throwing service so an analytics fault never touches the run', async () => {
    const subscriber = createAnalyticsRunSubscriber({
      surface: 'cli', identityPath, env: {}, attributes: cliAttributes,
      service: {
        capture: vi.fn(() => Promise.reject(new Error('capture failed'))),
        flush: vi.fn(() => Promise.reject(new Error('flush failed'))),
      },
    })
    subscriber.handler(ev('r', 'runStarted', { memberTestCount: 1 }))
    subscriber.handler(ev('r', 'testFinished', { testId, testIndex: 0, outcome: 'passed', durationMs: 5 }))
    subscriber.handler(ev('r', 'runFinished', { aggregateVerdict: 'passed', disposition: 'detached', finalSeq: seq }))
    await expect(subscriber.flush()).resolves.toBeUndefined()
  })

  it('tolerates a malformed envelope without throwing', () => {
    const transport = new MockAnalyticsTransport()
    const subscriber = createAnalyticsRunSubscriber({ surface: 'cli', transport, identityPath, env: {} })
    expect(() => subscriber.handler({ seq: 1, ts: 1, runId: 'r', type: 'testFinished' } as unknown as RunEventEnvelope)).not.toThrow()
  })
})
