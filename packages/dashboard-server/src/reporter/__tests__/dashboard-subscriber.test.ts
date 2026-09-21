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

/**
 * A whole `StepFinalizedPayload` (405-01). The v1 cells passed five fields because the
 * subscriber's own `*Like` interface named five; the arm now takes the schema type, so a fixture
 * that omitted `cacheStatus` would be describing an envelope the bus cannot emit.
 */
function stepFinalized(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    testIndex: 0,
    stepIndex: 0,
    cacheStatus: 'miss',
    verifierVerdict: { pass: true, reasoning: 'ok' },
    selfHealOccurred: false,
    briefDigest: 'brief-digest-fixture',
    status: 'passed',
    durationMs: 100,
    ...overrides,
  }
}

/** A whole `SubActionRecordedPayload`, including the ref the 405 bus fold now carries. */
function subActionRecorded(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    testIndex: 0,
    stepIndex: 0,
    subActionIndex: 0,
    plan: 'Click Save',
    plannedAction: { type: 'click', ref: 'e2' },
    result: { success: true },
    screenStateHash: 'b'.repeat(64),
    screenStateHashAfter: 'c'.repeat(64),
    artifactRefs: [{ id: `decision-screenshot:${'d'.repeat(64)}`, sha: 'd'.repeat(64) }],
    ...overrides,
  }
}

describe('createDashboardRunIngest', () => {
  it('SUITE-DURATION-WRITE accumulates parallel member work once and replaces retries, including zero', async () => {
    const runId = db.insertPendingRun({ name: 'Duration probe', parallel: true })
    const ingest = createDashboardRunIngest({ db, correlationEnv: { runId } })
    ingest.handler(ev(runId, 'runStarted', { memberTestCount: 3 }))
    const durations = [31631.826750000007, 38765.66812499997, 35742.61929200002]
    for (const testIndex of [2, 0, 1]) {
      ingest.handler(ev(runId, 'testFinished', { testIndex, outcome: 'passed', durationMs: durations[testIndex] }))
    }
    const stored = () => db['db'].prepare('SELECT duration FROM runs WHERE id = ?').get(runId) as { duration: number }
    expect(stored().duration).toBeCloseTo(106140.114167, 7)
    ingest.handler(ev(runId, 'testFinished', { testIndex: 1, outcome: 'passed', durationMs: durations[1] }))
    expect(stored().duration).toBeCloseTo(106140.114167, 7)
    ingest.handler(ev(runId, 'testRetryScheduled', { testIndex: 1 }))
    ingest.handler(ev(runId, 'testFinished', { testIndex: 1, outcome: 'passed', durationMs: 0 }))
    ingest.handler(ev(runId, 'runFinished', { aggregateVerdict: 'passed' }))
    await ingest.finalize({})
    expect(stored().duration).toBe(durations[0] + durations[2])
    expect(db.getRun(runId)?.duration).toBe(stored().duration)
    expect(db.getRunArtifact(runId)?.payload.runtime?.duration).toBe(stored().duration)
  })

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
    ingest.handler(ev(busRunId, 'stepFinalized', stepFinalized({ durationMs: 120 })))
    ingest.handler(ev(busRunId, 'testFinished', { testId: 't-1', testIndex: 0, outcome: 'passed', durationMs: 5000 }))
    ingest.handler(ev(busRunId, 'verdict', { verdict: 'passed' }))
    ingest.handler(ev(busRunId, 'runFinished', { aggregateVerdict: 'passed', disposition: 'detached', finalSeq: seq }))

    await ingest.finalize({})

    const run = db.getRun(runId)
    expect(run?.status).toBe('passed')
    expect(run?.duration).toBe(5000)

    const artifact = db.getRunArtifact(runId)
    expect(artifact).not.toBeNull()
    expect(artifact?.finalizedAt).toBeTruthy()
    // route shape: config + source sections present. NO `memory` section: the v1 member of
    // `DashboardRunIngestFinalizeExtra` is deleted (407-05 · D-02), so a finalize can no longer
    // stage one even if a caller tried — the drawer tab that read it is gone with it.
    expect((artifact?.payload.source as Record<string, unknown>).name).toBe('Login Test')
    expect((artifact?.payload.config as Record<string, unknown>).model).toBeDefined()
    expect(Object.keys(artifact!.payload)).not.toContain('memory')
    expect(artifact?.payload.metadata?.attributes).toEqual(attributes)
    expect((artifact?.payload.runtime as Record<string, unknown>).status).toBe('passed')

    // 405-01: step progress lands in the v2 projection, read the way the op reads it.
    expect(db.readRunDetailRows(runId)?.steps).toHaveLength(1)
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
    ingest.handler(ev('run-bus', 'stepFinalized', stepFinalized({ status: 'healed', durationMs: 90 })))
    ingest.handler(ev('run-bus', 'testFinished', { testId: 't-1', testIndex: 0, outcome: 'healed', durationMs: 1000 }))

    expect(db.getRun(runId)?.status).toBe('passed')
    // 405-01 D-01: `toRunStatus` collapses `healed` to `passed` for the `runs.status` CHECK and
    // for NOTHING ELSE. The step row keeps the payload's own word, which is what makes "this step
    // self-healed" readable at all.
    expect(db.readRunDetailRows(runId)?.steps[0].status).toBe('healed')
    expect(db.readRunDetailRows(runId)?.members[0].outcome).toBe('healed')
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

  // 2026-08-24 (402-09, D-11): the two cells that stood here asserted the parent/child model —
  // "retry mode inserts a child under the parent with attempt + maxRetries" and "suite mode adopts
  // the queued parent and inserts children keyed by testIndex". Both producers are deleted; the
  // cells below assert the ONE-RUN model that replaced them, which is the same claim with the
  // opposite sign. See DELETION-INVENTORY.md.

  it('correlation env — a suite run adopts the queued row and mints NO children', async () => {
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
    // The queued row is ADOPTED, not parented: the artifact kind is an ordinary run's.
    expect(db.getRunArtifact(suiteRunId)?.kind).toBe('test')

    ingest.handler(ev('run-bus', 'testStarted', { testId: 't-a', testIndex: 0, name: 'Test A', filePath: 'tests/a.yaml' }))
    ingest.handler(ev('run-bus', 'testFinished', { testId: 't-a', testIndex: 0, outcome: 'passed', durationMs: 100 }))
    ingest.handler(ev('run-bus', 'testStarted', { testId: 't-b', testIndex: 1, name: 'Test B', filePath: 'tests/b.yaml' }))
    ingest.handler(ev('run-bus', 'testFinished', { testId: 't-b', testIndex: 1, outcome: 'failed', durationMs: 200 }))
    ingest.handler(ev('run-bus', 'runFinished', { aggregateVerdict: 'failed', disposition: 'detached', finalSeq: seq }))
    await ingest.finalize()

    // ONE row for the whole suite — no children, and none orphaned somewhere else either.
    //
    // 2026-08-27 (405-07, D-02): the child read this used to call is gone with the column it read.
    // `getRuns()` is now the WHOLE runs table rather than its top-level slice, which makes this the
    // stronger claim: a child row minted anywhere would show up here, not merely fail to be
    // returned by a reader that filtered for it.
    expect(db.getRuns().map((r) => r.id)).toEqual([suiteRunId])
    expect(db.getRun(suiteRunId)?.status).toBe('failed')

    // 405-01 D-01: the per-member split 402-09 deleted, restored from 402-04's handles rather
    // than from a second run row. TWO member rows on ONE run row.
    const members = db.readRunDetailRows(suiteRunId)?.members ?? []
    expect(members.map((member) => [member.testIndex, member.name, member.outcome]))
      .toEqual([[0, 'Test A', 'passed'], [1, 'Test B', 'failed']])
  })

  it('correlation env — a suiteQueueId is just another spelling of runId', () => {
    const runIdA = 'r_viasuite-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india'
    const ingestA = createDashboardRunIngest({
      db,
      sourceSnapshot: testSource(),
      attributes,
      correlationEnv: { suiteQueueId: runIdA },
      now: () => '2026-07-08T00:00:00.000Z',
    })
    ingestA.handler(ev('run-bus', 'runStarted', {}))
    expect(db.getRun(runIdA)?.status).toBe('running')
    expect(db.getRunArtifact(runIdA)?.kind).toBe('test')
    expect(db.getRuns()).toHaveLength(1)
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
    ingest.handler(ev('run-bus', 'stepFinalized', stepFinalized({ stepIndex: 0, durationMs: 100 })))
    ingest.handler(ev('run-bus', 'stepFinalized', stepFinalized({ stepIndex: 1, durationMs: 50 })))

    // 405-01: a step with no `stepStarted` has NO `stepText` at all. The v1 arm substituted
    // `Step 2` — a label nobody wrote, wearing an instruction's clothes.
    const steps = db.readRunDetailRows(runId)?.steps ?? []
    expect(steps.map((step) => step.stepText)).toEqual(['Open Apple Maps', undefined])
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
    // 405-01 D-01: the hook's place in the run tree. NULL would mean run-scoped.
    expect(logs[0].testIndex).toBe(0)
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
    ingest.handler(ev('run-bus', 'stepFinalized', stepFinalized({ status: 'failed', durationMs: 80 })))
    ingest.handler(ev('run-bus', 'subActionRecorded', subActionRecorded()))
    // A SECOND MEMBER, whose completed history must SURVIVE the first member's retry (D-17). The
    // v1 arm called `deleteStepsForRun`, which deleted this row too.
    ingest.handler(ev('run-bus', 'testStarted', { testId: 't-2', testIndex: 1, name: 'Other' }))
    ingest.handler(ev('run-bus', 'stepStarted', { testIndex: 1, stepIndex: 0, stepText: 'Other step' }))
    ingest.handler(ev('run-bus', 'stepFinalized', stepFinalized({ testIndex: 1, durationMs: 30 })))

    ingest.handler(ev('run-bus', 'testRetryScheduled', { testId: 't-1', testIndex: 0, attempt: 2, maxAttempts: 2 }))
    ingest.handler(ev('run-bus', 'stepStarted', { testIndex: 0, stepIndex: 0, stepText: 'Login' }))
    ingest.handler(ev('run-bus', 'stepFinalized', stepFinalized({ status: 'passed', durationMs: 90 })))
    ingest.handler(ev('run-bus', 'testFinished', { testId: 't-1', testIndex: 0, outcome: 'passed', durationMs: 400 }))

    const rows = db.readRunDetailRows(runId)
    const memberSteps = (rows?.steps ?? []).filter((step) => step.testIndex === 0)
    expect(memberSteps).toHaveLength(1)
    expect(memberSteps[0].status).toBe('passed')
    expect(memberSteps[0].stepText).toBe('Login')
    // The abandoned attempt's SUB-ACTIONS went with its steps.
    expect((rows?.subActions ?? []).filter((one) => one.testIndex === 0)).toHaveLength(0)
    // The OTHER member's history is untouched — the whole point of scoping the delete.
    expect((rows?.steps ?? []).filter((step) => step.testIndex === 1)).toHaveLength(1)
    // D-17: the attempt ordinal the member header renders.
    expect(rows?.members.find((member) => member.testIndex === 0)?.attempts).toBe(2)
    expect(rows?.members.find((member) => member.testIndex === 1)?.attempts).toBe(1)
  })

  it('finalize is idempotent and safe when no run was ever started', async () => {
    const ingest = createDashboardRunIngest({ db, correlationEnv: { runId: 'r_never-started' } })
    await expect(ingest.finalize()).resolves.toBeUndefined()
    await expect(ingest.finalize()).resolves.toBeUndefined()
    expect(db.getRuns()).toHaveLength(0)
  })

  it('subActionRecorded writes the whole payload verbatim, artifactRefs included (405 D-01/D-14)', () => {
    const runId = 'r_subact-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india'
    const ingest = createDashboardRunIngest({
      db,
      sourceSnapshot: testSource(),
      attributes,
      correlationEnv: { runId },
      now: () => '2026-08-27T00:00:00.000Z',
    })
    ingest.handler(ev('run-bus', 'runStarted', {}))
    ingest.handler(ev('run-bus', 'testStarted', { testId: 't-1', testIndex: 0 }))
    ingest.handler(ev('run-bus', 'subActionRecorded', subActionRecorded()))
    ingest.handler(ev('run-bus', 'subActionRecorded', subActionRecorded({
      subActionIndex: 1,
      plan: 'Type the value',
      // No refs and no after-hash: both are ABSENT keys on the row, never nulls.
      artifactRefs: undefined,
      screenStateHashAfter: undefined,
    })))

    const subActions = db.readRunDetailRows(runId)?.subActions ?? []
    expect(subActions).toHaveLength(2)
    expect(subActions[0].artifactRefs?.[0].sha).toBe('d'.repeat(64))
    expect(subActions[0].plannedAction).toEqual({ type: 'click', ref: 'e2' })
    expect(subActions[0].result).toEqual({ success: true })
    expect(subActions[0].screenStateHashAfter).toBe('c'.repeat(64))
    expect(subActions[1].plan).toBe('Type the value')
    expect(subActions[1].artifactRefs).toBeUndefined()
    expect(subActions[1].screenStateHashAfter).toBeUndefined()
  })

  it('stepFinalized persists the WHOLE payload, not the five fields the v1 row kept', () => {
    const runId = 'r_wholestep-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel'
    const ingest = createDashboardRunIngest({
      db,
      sourceSnapshot: testSource(),
      attributes,
      correlationEnv: { runId },
      now: () => '2026-08-27T00:00:00.000Z',
    })
    ingest.handler(ev('run-bus', 'runStarted', {}))
    ingest.handler(ev('run-bus', 'testStarted', { testId: 't-1', testIndex: 0 }))
    ingest.handler(ev('run-bus', 'stepStarted', { testIndex: 0, stepIndex: 0, stepText: 'Save it' }))
    ingest.handler(ev('run-bus', 'stepFinalized', stepFinalized({
      cacheStatus: 'hit',
      verifierVerdict: { pass: false, reasoning: 'value never appeared' },
      selfHealOccurred: true,
      briefDigest: 'digest-xyz',
      status: 'failed',
      error: 'assertion failed',
    })))

    const step = db.readRunDetailRows(runId)?.steps[0]
    expect(step?.cacheStatus).toBe('hit')
    expect(step?.verifierVerdict).toEqual({ pass: false, reasoning: 'value never appeared' })
    expect(step?.selfHealOccurred).toBe(true)
    expect(step?.briefDigest).toBe('digest-xyz')
    expect(step?.status).toBe('failed')
    expect(step?.error).toBe('assertion failed')
    expect(step?.stepText).toBe('Save it')
    // D-05: this fixture measured nothing, so the row carries NO tokenUsage — not zeros.
    expect(step?.tokenUsage).toBeUndefined()
  })

  it('a measured stepFinalized persists its tokenUsage; an unmeasured one leaves the columns NULL (405 D-05/D-06)', () => {
    const runId = 'r_tokens-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-in'
    const ingest = createDashboardRunIngest({
      db,
      sourceSnapshot: testSource(),
      attributes,
      correlationEnv: { runId },
      now: () => '2026-08-27T00:00:00.000Z',
    })
    ingest.handler(ev('run-bus', 'runStarted', {}))
    ingest.handler(ev('run-bus', 'testStarted', { testId: 't-1', testIndex: 0 }))
    ingest.handler(ev('run-bus', 'stepFinalized', stepFinalized({
      stepIndex: 0,
      tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })))
    // A cache hit: the loop made no model call, so the payload carries no tokenUsage at all.
    ingest.handler(ev('run-bus', 'stepFinalized', stepFinalized({ stepIndex: 1, cacheStatus: 'hit' })))

    const steps = db.readRunDetailRows(runId)?.steps ?? []
    expect(steps).toHaveLength(2)
    expect(steps[0].tokenUsage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 })
    expect('tokenUsage' in steps[0]).toBe(true)
    expect('tokenUsage' in steps[1]).toBe(false)

    // The read mapper could hide a zero-fill, so this asserts the COLUMN. `absent ≠ zero` has to
    // be true at rest, not just on the way out: a `0` here would be a measurement nobody made.
    const raw = db as unknown as { db: { prepare(sql: string): { all(...p: unknown[]): unknown[] } } }

    // The parts persisted separately — not one blob, and not a re-derived total.
    const parts = raw.db
      .prepare('SELECT prompt_tokens, completion_tokens, total_tokens FROM run_steps WHERE run_id = ? AND step_index = 0')
      .all(runId) as Array<{ prompt_tokens: number | null; completion_tokens: number | null; total_tokens: number | null }>
    expect(parts[0]).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })

    // And the unmeasured step is NULL at rest, in every one of the three columns.
    const totals = raw.db
      .prepare('SELECT total_tokens FROM run_steps WHERE run_id = ? ORDER BY step_index')
      .all(runId) as Array<{ total_tokens: number | null }>
    expect(totals.map(r => r.total_tokens)).toEqual([15, null])
    const unmeasured = raw.db
      .prepare('SELECT prompt_tokens, completion_tokens, total_tokens FROM run_steps WHERE run_id = ? AND step_index = 1')
      .all(runId) as Array<{ prompt_tokens: number | null; completion_tokens: number | null; total_tokens: number | null }>
    expect(unmeasured[0]).toEqual({ prompt_tokens: null, completion_tokens: null, total_tokens: null })
  })

  it('a thin member — testFinished with no testStarted — still gets a row (405 D-18)', () => {
    const runId = 'r_thin-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india'
    const ingest = createDashboardRunIngest({
      db,
      sourceSnapshot: testSource(),
      attributes,
      correlationEnv: { runId },
      now: () => '2026-08-27T00:00:00.000Z',
    })
    ingest.handler(ev('run-bus', 'runStarted', {}))
    // The member's stream BEGINS with its terminal event: skipped by fail-fast.
    ingest.handler(ev('run-bus', 'testFinished', {
      testId: 't-skipped',
      testIndex: 3,
      outcome: 'skipped',
      failureSummary: 'skipped by fail-fast',
    }))

    const members = db.readRunDetailRows(runId)?.members ?? []
    expect(members).toHaveLength(1)
    expect(members[0].testIndex).toBe(3)
    expect(members[0].outcome).toBe('skipped')
    expect(members[0].failureSummary).toBe('skipped by fail-fast')
    expect(members[0].attempts).toBe(1)
    // Never an empty tree that looks like a bug: the member is there, with nothing under it.
    expect(db.readRunDetailRows(runId)?.steps).toEqual([])
  })

  it('a testFinished never blanks the identity fields testStarted wrote (the upsert coalesces)', () => {
    const runId = 'r_coalesce-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel'
    const ingest = createDashboardRunIngest({
      db,
      sourceSnapshot: testSource(),
      attributes,
      correlationEnv: { runId },
      now: () => '2026-08-27T00:00:00.000Z',
    })
    ingest.handler(ev('run-bus', 'runStarted', {}))
    ingest.handler(ev('run-bus', 'testStarted', {
      testId: 't-1', testIndex: 0, name: 'Named Test', filePath: 'tests/n.yaml', totalSteps: 4,
    }))
    ingest.handler(ev('run-bus', 'testFinished', { testId: 't-1', testIndex: 0, outcome: 'failed' }))

    const member = db.readRunDetailRows(runId)?.members[0]
    expect(member?.name).toBe('Named Test')
    expect(member?.filePath).toBe('tests/n.yaml')
    expect(member?.totalSteps).toBe(4)
    expect(member?.outcome).toBe('failed')
  })

  it('readRunDetailRows answers undefined for a run nothing recorded, and empty arrays for one that projected nothing', () => {
    const runId = 'r_empty-alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india'
    // ABSENCE AND EMPTINESS ARE DIFFERENT ANSWERS, and the op turns only the first into a refusal.
    expect(db.readRunDetailRows(runId)).toBeUndefined()

    const ingest = createDashboardRunIngest({
      db,
      sourceSnapshot: testSource(),
      attributes,
      correlationEnv: { runId },
      now: () => '2026-08-27T00:00:00.000Z',
    })
    ingest.handler(ev('run-bus', 'runStarted', {}))
    expect(db.readRunDetailRows(runId)).toEqual({
      runId, members: [], steps: [], subActions: [],
    })
  })

  it('the module does not import the core Reporter interface (pure envelope consumption)', () => {
    const source = readFileSync(fileURLToPath(new URL('../dashboard-subscriber.ts', import.meta.url)), 'utf-8')
    expect(source).not.toMatch(/reporter\/types/)
    expect(source).not.toMatch(/\bimplements Reporter\b/)
    expect(source).not.toMatch(/import[^\n]*\bReporter\b[^\n]*agent-qa-core/)
  })
})
