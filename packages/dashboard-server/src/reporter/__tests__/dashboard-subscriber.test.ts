import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RunEventEnvelope, RunEventType } from '@vostride/agent-qa-schema'
import { DashboardDatabase } from '../../db/database.js'
import { createDashboardRunIngest } from '../dashboard-subscriber.js'

let db: DashboardDatabase
let seq = 0

beforeEach(() => {
  db = new DashboardDatabase({ dbPath: ':memory:' })
  seq = 0
})

afterEach(() => {
  db.close()
})

function ev(runId: string, type: RunEventType, payload: Record<string, unknown> = {}): RunEventEnvelope {
  return { seq: ++seq, ts: seq, runId, type, payload } as RunEventEnvelope
}

const attributes = {
  'agent-qa.trigger': 'cli',
  'agent-qa.runner': 'local',
} as const

function testSource(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'test' as const,
    testId: 't_login-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india',
    name: 'Login Test',
    filePath: 'tests/login.yaml',
    loadStatus: 'loaded' as const,
    ...overrides,
  }
}

function testConfig() {
  return {
    runtime: { platform: 'web' },
    model: { planner: { provider: 'openai', model: 'gpt-planner' } },
  }
}

describe('createDashboardRunIngest', () => {
  it('plain run: envelope stream produces run + finalized run_artifacts rows readable via getRunArtifact', async () => {
    const runId = 'r_plain-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india'
    const busRunId = 'run-bus-1'
    const ingest = createDashboardRunIngest({
      db,
      configSnapshot: testConfig(),
      sourceSnapshot: testSource(),
      attributes,
      correlationEnv: { runId },
      now: () => '2026-07-08T00:00:00.000Z',
    })

    ingest.handler(ev(busRunId, 'runStarted', { memberTestCount: 1 }))
    // running row visible immediately (survives a mid-run kill)
    expect(db.getRun(runId)?.status).toBe('running')

    ingest.handler(ev(busRunId, 'testStarted', { testIndex: 0, name: 'Login Test', testId: testSource().testId }))
    ingest.handler(ev(busRunId, 'stepFinalized', { testIndex: 0, stepIndex: 0, status: 'passed', durationMs: 120 }))
    ingest.handler(ev(busRunId, 'testFinished', { testIndex: 0, outcome: 'passed', durationMs: 5000 }))
    ingest.handler(ev(busRunId, 'verdict', { verdict: 'passed' }))
    ingest.handler(ev(busRunId, 'runFinished', { aggregateVerdict: 'passed', disposition: 'detached', finalSeq: seq }))

    await ingest.finalize({ memory: { log: { added: 1, confirmed: 2, deprecated: 0, errors: [], curatorDuration: 5 } } })

    const run = db.getRun(runId)
    expect(run?.status).toBe('passed')
    expect(run?.duration).toBe(5000)
    expect(JSON.parse(run!.memoryLog!).added).toBe(1)

    const artifact = db.getRunArtifact(runId)
    expect(artifact).not.toBeNull()
    expect(artifact?.finalizedAt).toBeTruthy()
    // route shape: config + source sections present, memory attached at finalize
    expect((artifact?.payload.source as Record<string, unknown>).name).toBe('Login Test')
    expect((artifact?.payload.config as Record<string, unknown>).model).toBeDefined()
    expect((artifact?.payload.memory as Record<string, unknown>).log).toBeDefined()
    expect(artifact?.payload.metadata?.attributes).toEqual(attributes)
    expect((artifact?.payload.runtime as Record<string, unknown>).status).toBe('passed')

    // step progress persisted
    expect(db.getSteps(runId)).toHaveLength(1)
  })

  it('healed outcome maps to a passed run row while the step keeps its healed status', () => {
    const runId = 'r_healed-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india'
    const ingest = createDashboardRunIngest({
      db,
      sourceSnapshot: testSource(),
      attributes,
      correlationEnv: { runId },
      now: () => '2026-07-08T00:00:00.000Z',
    })
    ingest.handler(ev('run-bus', 'runStarted', {}))
    ingest.handler(ev('run-bus', 'testStarted', { testIndex: 0 }))
    ingest.handler(ev('run-bus', 'stepFinalized', { testIndex: 0, stepIndex: 0, status: 'healed', durationMs: 90 }))
    ingest.handler(ev('run-bus', 'testFinished', { testIndex: 0, outcome: 'healed', durationMs: 1000 }))

    expect(db.getRun(runId)?.status).toBe('passed')
    expect(db.getSteps(runId)[0].status).toBe('healed')
  })

  it('correlation env — plain mode adopts an existing queued row without duplicating it', () => {
    const runId = 'r_queued-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india'
    db.insertPendingRun({ id: runId, name: 'Queued', attributes })
    const ingest = createDashboardRunIngest({
      db,
      sourceSnapshot: testSource({ name: 'Adopted Test' }),
      attributes,
      correlationEnv: { runId },
      now: () => '2026-07-08T00:00:00.000Z',
    })
    ingest.handler(ev('run-bus', 'runStarted', {}))

    expect(db.getRuns()).toHaveLength(1)
    expect(db.getRun(runId)?.status).toBe('running')
    expect(db.getRun(runId)?.name).toBe('Adopted Test')
  })

  it('correlation env — retry mode inserts a child under the parent with attempt + maxRetries', () => {
    const parentRunId = 'r_parent-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india'
    const childRunId = 'r_child-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india'
    db.insertRun({
      id: parentRunId,
      name: 'Parent',
      status: 'running',
      duration: 0,
      startedAt: '2026-07-08T00:00:00.000Z',
      endedAt: '2026-07-08T00:00:00.000Z',
      attributes,
    })
    const ingest = createDashboardRunIngest({
      db,
      sourceSnapshot: testSource(),
      attributes,
      correlationEnv: { runId: childRunId, parentRunId, maxRetries: 3, attemptNumber: 2 },
      now: () => '2026-07-08T00:00:00.000Z',
    })
    ingest.handler(ev('run-bus', 'runStarted', {})) // no-op in retry mode
    ingest.handler(ev('run-bus', 'testStarted', { testIndex: 0, name: 'Retry Test' }))

    const children = db.getRunsByParent(parentRunId)
    expect(children).toHaveLength(1)
    expect(children[0].id).toBe(childRunId)
    expect(children[0].attemptNumber).toBe(2)
    expect(children[0].maxRetries).toBe(3)
    expect(children[0].parentRunId).toBe(parentRunId)
    expect(db.getRunArtifact(childRunId)?.payload.metadata?.attributes).toEqual(attributes)

    ingest.handler(ev('run-bus', 'testFinished', { testIndex: 0, outcome: 'failed', durationMs: 800, failureSummary: 'boom' }))
    expect(db.getRun(childRunId)?.status).toBe('failed')
    expect(db.getRun(childRunId)?.failureSummary).toBe('boom')
  })

  it('correlation env — suite mode adopts the queued parent and inserts children keyed by testIndex', async () => {
    const suiteRunId = 'r_suite-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india'
    const ingest = createDashboardRunIngest({
      db,
      configSnapshot: testConfig(),
      sourceSnapshot: { kind: 'suite', suiteId: 'suite-smoke', name: 'Smoke Suite', loadStatus: 'loaded' },
      attributes,
      correlationEnv: { suiteQueueId: suiteRunId },
      now: () => '2026-07-08T00:00:00.000Z',
    })

    ingest.handler(ev('run-bus', 'runStarted', { memberTestCount: 2 }))
    const parent = db.getRun(suiteRunId)
    expect(parent?.status).toBe('running')
    expect(db.getRunArtifact(suiteRunId)?.kind).toBe('suite-parent')

    ingest.handler(ev('run-bus', 'testStarted', { testIndex: 0, name: 'Test A', filePath: 'tests/a.yaml' }))
    ingest.handler(ev('run-bus', 'testFinished', { testIndex: 0, outcome: 'passed', durationMs: 100 }))
    ingest.handler(ev('run-bus', 'testStarted', { testIndex: 1, name: 'Test B', filePath: 'tests/b.yaml' }))
    ingest.handler(ev('run-bus', 'testFinished', { testIndex: 1, outcome: 'failed', durationMs: 200 }))
    ingest.handler(ev('run-bus', 'runFinished', { aggregateVerdict: 'failed', disposition: 'detached', finalSeq: seq }))
    await ingest.finalize()

    const children = db.getRunsByParent(suiteRunId)
    expect(children).toHaveLength(2)
    expect(children.map((c) => c.parentRunId)).toEqual([suiteRunId, suiteRunId])
    expect(db.getRun(suiteRunId)?.status).toBe('failed')
    for (const child of children) {
      expect(db.getRunArtifact(child.id)?.finalizedAt).toBeTruthy()
    }
  })

  it('step rows carry the stepStarted instruction text, not a generic "Step N" label', () => {
    const runId = 'r_named-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india'
    const ingest = createDashboardRunIngest({
      db,
      sourceSnapshot: testSource(),
      attributes,
      correlationEnv: { runId },
      now: () => '2026-07-09T00:00:00.000Z',
    })
    ingest.handler(ev('run-bus', 'runStarted', {}))
    ingest.handler(ev('run-bus', 'testStarted', { testIndex: 0 }))
    ingest.handler(ev('run-bus', 'stepStarted', { testIndex: 0, stepIndex: 0, stepText: 'Open Apple Maps' }))
    ingest.handler(ev('run-bus', 'stepFinalized', { testIndex: 0, stepIndex: 0, status: 'passed', durationMs: 100 }))
    ingest.handler(ev('run-bus', 'stepFinalized', { testIndex: 0, stepIndex: 1, status: 'passed', durationMs: 50 }))

    const steps = db.getSteps(runId)
    expect(steps.map((s) => s.name)).toEqual(['Open Apple Maps', 'Step 2'])
  })

  it('hookFinished writes an execution_logs row with stdout/stderr/variables', () => {
    const runId = 'r_hooked-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india'
    const ingest = createDashboardRunIngest({
      db,
      sourceSnapshot: testSource(),
      attributes,
      correlationEnv: { runId },
      now: () => '2026-07-09T00:00:00.000Z',
    })
    ingest.handler(ev('run-bus', 'runStarted', {}))
    ingest.handler(ev('run-bus', 'testStarted', { testIndex: 0 }))
    ingest.handler(ev('run-bus', 'hookFinished', {
      hookName: 'seed-db',
      phase: 'setup',
      hookExecutionId: 'hx-1',
      scope: 'test',
      testIndex: 0,
      status: 'passed',
      durationMs: 340,
      stdout: 'seeded 3 rows',
      stderr: '',
      variables: { USER_ID: 'u-1' },
    }))
    // skipped hooks carry no output and are not persisted (CHECK admits passed|failed)
    ingest.handler(ev('run-bus', 'hookFinished', {
      hookName: 'optional-hook', phase: 'teardown', hookExecutionId: 'hx-2',
      status: 'skipped', durationMs: 0, stdout: '', stderr: '', variables: {},
    }))

    const logs = db.getExecutionLogs({ runId })
    expect(logs).toHaveLength(1)
    expect(logs[0].name).toBe('seed-db')
    expect(logs[0].stdout).toBe('seeded 3 rows')
    expect(logs[0].variables).toEqual({ USER_ID: 'u-1' })
  })

  it('testRetryScheduled drops the abandoned attempt so step rows never duplicate', () => {
    const runId = 'r_retried-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india'
    const ingest = createDashboardRunIngest({
      db,
      sourceSnapshot: testSource(),
      attributes,
      correlationEnv: { runId },
      now: () => '2026-07-09T00:00:00.000Z',
    })
    ingest.handler(ev('run-bus', 'runStarted', {}))
    ingest.handler(ev('run-bus', 'testStarted', { testIndex: 0 }))
    ingest.handler(ev('run-bus', 'stepStarted', { testIndex: 0, stepIndex: 0, stepText: 'Login' }))
    ingest.handler(ev('run-bus', 'stepFinalized', { testIndex: 0, stepIndex: 0, status: 'failed', durationMs: 80 }))
    ingest.handler(ev('run-bus', 'testRetryScheduled', { testId: 't-1', testIndex: 0, attempt: 2, maxAttempts: 2 }))
    ingest.handler(ev('run-bus', 'stepStarted', { testIndex: 0, stepIndex: 0, stepText: 'Login' }))
    ingest.handler(ev('run-bus', 'stepFinalized', { testIndex: 0, stepIndex: 0, status: 'passed', durationMs: 90 }))
    ingest.handler(ev('run-bus', 'testFinished', { testIndex: 0, outcome: 'passed', durationMs: 400 }))

    const steps = db.getSteps(runId)
    expect(steps).toHaveLength(1)
    expect(steps[0].status).toBe('passed')
    expect(steps[0].name).toBe('Login')
  })

  it('finalize is idempotent and safe when no run was ever started', async () => {
    const ingest = createDashboardRunIngest({ db, correlationEnv: { runId: 'r_never-started' } })
    await expect(ingest.finalize()).resolves.toBeUndefined()
    await expect(ingest.finalize()).resolves.toBeUndefined()
    expect(db.getRuns()).toHaveLength(0)
  })

  it('the module does not import the core Reporter interface (pure envelope consumption)', () => {
    const source = readFileSync(fileURLToPath(new URL('../dashboard-subscriber.ts', import.meta.url)), 'utf-8')
    expect(source).not.toMatch(/reporter\/types/)
    expect(source).not.toMatch(/\bimplements Reporter\b/)
    expect(source).not.toMatch(/import[^\n]*\bReporter\b[^\n]*agent-qa-core/)
  })
})
