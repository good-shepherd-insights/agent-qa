// Wave-0 RED scaffold (361-01, Task 3). Pins the SESSION-01/04/05 run-shell behavior
// BEFORE any implementation exists — RED strictly on the unresolved import of the
// not-yet-existing `../shell.js` module (right-reason RED). Turns green in Plan 06.
//
// Contract source: 361-CONTEXT.md D-01 (startRun owns session identity, bus, seq,
// member iteration, aggregate verdict, handoff emission), D-03 (run-level SIGINT +
// wall-clock budget), D-04 (fully-resolved RunConfig, no fs/providers), D-13/D-17
// (session.done resolves { verdict, handoff }, handoff persisted exactly once),
// D-16 (per-test outcome derivation) + spec/v2/runner.md §2.1/§2.2. RESEARCH Pitfall 4:
// handoff step indices re-derived from array position, never all-zero.
//
// Runner package convention: `.js`-suffixed relative import specifiers. Fully-faked
// executor + ports — no real fs, providers, or timers.
import { describe, expect, it, vi } from 'vitest'

import { startRun } from '../shell.js'
import type {
  MemberTestExecutor,
  MemberTestRunContext,
  RunConfig,
  RunMemberDescriptor,
} from '../shell.js'
import type { EventLogPort, HandoffStorePort, RunTimerPort } from '../ports.js'
import type { StepResult, TestResult } from '../../result.js'
import type {
  CompletedRunHandoff,
  RunEventEnvelope,
  RunSession,
  StepEvidence,
} from '@vostride/agent-qa-schema'

// ---- Fakes ---------------------------------------------------------------

function passResult(name: string, steps: StepResult[] = [defaultStep()]): TestResult {
  return { name, filePath: `${name}.test.ts`, status: 'passed', steps, duration: 1 }
}

function failResult(name: string, error?: string): TestResult {
  return {
    name,
    filePath: `${name}.test.ts`,
    status: 'failed',
    steps: [defaultStep({ status: 'failed', error })],
    duration: 1,
  }
}

function defaultStep(overrides: Partial<StepResult> = {}): StepResult {
  return { name: 'a step', status: 'passed', duration: 1, ...overrides }
}

interface FakeHandoffStore extends HandoffStorePort {
  saved: CompletedRunHandoff[]
  saveCalls: number
}

function makeFakeHandoffStore(options: { fail?: boolean } = {}): FakeHandoffStore {
  const saved: CompletedRunHandoff[] = []
  return {
    saved,
    saveCalls: 0,
    async save(handoff: CompletedRunHandoff) {
      this.saveCalls += 1
      if (options.fail) throw new Error('disk full')
      saved.push(handoff)
    },
  }
}

function makeFakeEventLog(): EventLogPort {
  const store: RunEventEnvelope[] = []
  return {
    append(envelope: RunEventEnvelope) {
      store.push(envelope)
    },
    read(fromSeq: number) {
      return store.filter(event => event.seq >= fromSeq)
    },
  }
}

interface FakeTimer extends RunTimerPort {
  fireLatest(): void
}

function makeFakeTimer(): FakeTimer {
  let scheduled: (() => void) | undefined
  return {
    schedule(_delayMs: number, fn: () => void) {
      scheduled = fn
      return () => {
        if (scheduled === fn) scheduled = undefined
      }
    },
    now: () => 1_700_000_000_000,
    fireLatest() {
      scheduled?.()
    },
  }
}

// An executor that resolves canned results by testId and records call order.
function scriptedExecutor(
  script: Record<string, TestResult>,
  calls: string[],
): MemberTestExecutor {
  return async (member: RunMemberDescriptor, ctx: MemberTestRunContext) => {
    calls.push(member.testId)
    void ctx
    return script[member.testId] ?? passResult(member.testId)
  }
}

// An executor whose active member hangs until its abortSignal fires.
function abortableExecutor(calls: string[]): MemberTestExecutor {
  return (member: RunMemberDescriptor, ctx: MemberTestRunContext) =>
    new Promise<TestResult>(resolve => {
      calls.push(member.testId)
      const cancelled: TestResult = {
        name: member.testId,
        filePath: `${member.testId}.test.ts`,
        status: 'cancelled',
        steps: [],
        duration: 1,
      }
      if (ctx.abortSignal.aborted) return resolve(cancelled)
      ctx.abortSignal.addEventListener('abort', () => resolve(cancelled), { once: true })
    })
}

function baseConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    runId: 'run-1' as RunConfig['runId'],
    scope: { tier: 'suite', key: 'checkout' },
    executionContext: 'local-headless',
    buildOrdinal: 7,
    configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
    members: [{ testId: 'a' }, { testId: 'b' }],
    executor: scriptedExecutor({}, []),
    ports: { handoffStore: makeFakeHandoffStore(), eventLog: makeFakeEventLog() },
    ...overrides,
  }
}

function drain(session: RunSession): RunEventEnvelope[] {
  const received: RunEventEnvelope[] = []
  ;(session as unknown as { subscribe(fromSeq: number, handler: (e: RunEventEnvelope) => void): () => void })
    .subscribe(1, event => received.push(event))
  return received
}

function done(session: RunSession): Promise<{ verdict: string; handoff: CompletedRunHandoff }> {
  return (session as unknown as { done: Promise<{ verdict: string; handoff: CompletedRunHandoff }> }).done
}

function cancel(session: RunSession): void {
  ;(session as unknown as { cancel(): void }).cancel()
}

// ---- Synchronous session identity (SESSION-01, D-01/D-04) ----------------

describe('startRun — synchronous session identity (SESSION-01)', () => {
  it('returns a session synchronously carrying id, running status, executionContext', () => {
    const session = startRun(baseConfig())
    expect(session.id).toBe('run-1')
    expect(session.status).toBe('running')
    expect(session.executionContext).toBe('local-headless')
  })
})

// ---- Run lifecycle + ordering (SESSION-04, spec §2.2) --------------------

describe('run lifecycle emission (SESSION-04, spec §2.2)', () => {
  it('the first event is runStarted at seq 1 with busSchemaVersion + D-04 header fields', async () => {
    const session = startRun(baseConfig())
    const events = drain(session)
    await done(session)

    const first = events[0]
    expect(first.type).toBe('runStarted')
    expect(first.seq).toBe(1)
    const payload = first.payload as Record<string, unknown>
    expect(payload.busSchemaVersion).toBe(1)
    expect(payload.scope).toEqual({ tier: 'suite', key: 'checkout' })
    expect(payload.executionContext).toBe('local-headless')
    expect(payload.buildOrdinal).toBe(7)
    expect(payload.configDigests).toEqual({ suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' })
    expect(payload.memberTestCount).toBe(2)
  })

  it('members execute in order, each bracketed by testStarted/testFinished; testFinished carries an outcome, never steps', async () => {
    const calls: string[] = []
    const session = startRun(baseConfig({ executor: scriptedExecutor({}, calls) }))
    const events = drain(session)
    await done(session)

    expect(calls).toEqual(['a', 'b'])
    const lifecycle = events.filter(e => e.type === 'testStarted' || e.type === 'testFinished')
    expect(lifecycle.map(e => e.type)).toEqual(['testStarted', 'testFinished', 'testStarted', 'testFinished'])
    for (const finished of events.filter(e => e.type === 'testFinished')) {
      const payload = finished.payload as Record<string, unknown>
      expect(payload.outcome).toBeDefined()
      expect(payload).not.toHaveProperty('steps')
    }
  })

  it('a shared failFastGroup skips remaining same-group members while other groups still run', async () => {
    const calls: string[] = []
    const members: RunMemberDescriptor[] = [
      { testId: 'g1-a', failFastGroup: 'g1' },
      { testId: 'g1-b', failFastGroup: 'g1' },
      { testId: 'g2-a', failFastGroup: 'g2' },
    ]
    const session = startRun(
      baseConfig({
        members,
        executor: scriptedExecutor({ 'g1-a': failResult('g1-a') }, calls),
      }),
    )
    const events = drain(session)
    await done(session)

    // g1-b is skipped (executor never invoked); g2-a still runs.
    expect(calls).toEqual(['g1-a', 'g2-a'])
    const skipped = events
      .filter(e => e.type === 'testFinished')
      .map(e => (e.payload as { testId: string; outcome: string }))
    expect(skipped).toContainEqual(expect.objectContaining({ testId: 'g1-b', outcome: 'skipped' }))
  })

  it('publishes verdict exactly once, before runFinished; runFinished is last, once, detached, with finalSeq = its own seq', async () => {
    const session = startRun(baseConfig())
    const events = drain(session)
    await done(session)

    const verdicts = events.filter(e => e.type === 'verdict')
    const finishes = events.filter(e => e.type === 'runFinished')
    expect(verdicts).toHaveLength(1)
    expect(finishes).toHaveLength(1)
    const verdictIdx = events.findIndex(e => e.type === 'verdict')
    const finishIdx = events.findIndex(e => e.type === 'runFinished')
    expect(verdictIdx).toBeLessThan(finishIdx)
    expect(finishIdx).toBe(events.length - 1)
    const finishPayload = finishes[0].payload as { disposition: string; finalSeq: number }
    expect(finishPayload.disposition).toBe('detached')
    expect(finishPayload.finalSeq).toBe(finishes[0].seq)
  })

  it('a full passing run emits no chip-event types (defined-never-emitted)', async () => {
    const session = startRun(baseConfig())
    const events = drain(session)
    await done(session)
    const chips = new Set([
      'analysisStarted', 'analysisCompleted', 'analysisFailed',
      'curationStarted', 'curationCompleted', 'curationFailed',
      'issuesStarted', 'issuesCompleted', 'issuesFailed',
    ])
    expect(events.some(e => chips.has(e.type))).toBe(false)
  })
})

// ---- Cancellation + budget (D-03) ----------------------------------------

describe('run-level cancel + budget (D-03)', () => {
  it('session.cancel() aborts the active member, skips the rest, aggregates cancelled', async () => {
    const calls: string[] = []
    const session = startRun(baseConfig({ executor: abortableExecutor(calls) }))
    drain(session)
    cancel(session)
    const { verdict } = await done(session)
    expect(verdict).toBe('cancelled')
    // The second member is never started once the run is cancelled.
    expect(calls).toEqual(['a'])
  })

  it('run-budget expiry aborts the active member and aggregates timeout', async () => {
    const timer = makeFakeTimer()
    const calls: string[] = []
    const session = startRun(
      baseConfig({ executor: abortableExecutor(calls), runBudgetMs: 5_000, ports: { handoffStore: makeFakeHandoffStore(), timer } }),
    )
    drain(session)
    timer.fireLatest() // simulate budget expiry
    const { verdict } = await done(session)
    expect(verdict).toBe('timeout')
  })
})

// ---- Handoff (SESSION-05, D-13/D-17) -------------------------------------

describe('handoff — exactly one per run (SESSION-05, D-13/D-17)', () => {
  it('session.done resolves the same handoff that is persisted through the store port, exactly once', async () => {
    const store = makeFakeHandoffStore()
    const session = startRun(baseConfig({ ports: { handoffStore: store, eventLog: makeFakeEventLog() } }))
    drain(session)
    const { handoff } = await done(session)
    expect(store.saveCalls).toBe(1)
    expect(store.saved[0]).toBe(handoff)
  })

  it('the handoff carries the §A8 header fields and per-test outcomes', async () => {
    const store = makeFakeHandoffStore()
    const session = startRun(baseConfig({ ports: { handoffStore: store, eventLog: makeFakeEventLog() } }))
    drain(session)
    const { handoff } = await done(session)
    expect(handoff.schemaVersion).toBe(1)
    expect(handoff.runId).toBe('run-1')
    expect(handoff.scope).toEqual({ tier: 'suite', key: 'checkout' })
    expect(handoff.buildOrdinal).toBe(7)
    expect(handoff.executionContext).toBe('local-headless')
    expect(handoff.configDigests).toEqual({ suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' })
    expect(typeof handoff.startedAt).toBe('number')
    expect(typeof handoff.endedAt).toBe('number')
    expect(handoff.tests).toHaveLength(2)
  })

  it('handoff step indices are re-derived from array position (never all-zero — RESEARCH Pitfall 4)', async () => {
    const twoSteps = passResult('a', [
      defaultStep({ name: 's0', evidence: { stepIndex: 0 } as unknown as StepEvidence }),
      defaultStep({ name: 's1', evidence: { stepIndex: 0 } as unknown as StepEvidence }),
    ])
    const session = startRun(
      baseConfig({ members: [{ testId: 'a' }], executor: scriptedExecutor({ a: twoSteps }, []) }),
    )
    drain(session)
    const { handoff } = await done(session)
    expect(handoff.tests[0].steps.map(s => s.stepIndex)).toEqual([0, 1])
  })

  it('a step WITHOUT evidence still yields a synthesized minimal StepEvidence (Open Q1: synthesize, do not drop)', async () => {
    const noEvidence = passResult('a', [defaultStep({ name: 's0' })])
    const session = startRun(
      baseConfig({ members: [{ testId: 'a' }], executor: scriptedExecutor({ a: noEvidence }, []) }),
    )
    drain(session)
    const { handoff } = await done(session)
    expect(handoff.tests[0].steps).toHaveLength(1)
    expect(handoff.tests[0].steps[0]).toMatchObject({ stepIndex: 0 })
  })

  it('handoff-store save failure publishes runWarning handoff-write-failed and done STILL resolves (verdict independence, D-07)', async () => {
    const store = makeFakeHandoffStore({ fail: true })
    const session = startRun(baseConfig({ ports: { handoffStore: store, eventLog: makeFakeEventLog() } }))
    const events = drain(session)
    const { verdict } = await done(session)
    expect(verdict).toBe('passed')
    const warning = events.find(
      e => e.type === 'runWarning' && (e.payload as { code: string }).code === 'handoff-write-failed',
    )
    expect(warning).toBeDefined()
  })
})

// Keep vi referenced (fake-timer discipline utility) so lint does not flag the import.
void vi
