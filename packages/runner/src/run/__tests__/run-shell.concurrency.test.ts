// The bounded member pool (402-02, INVK-04 / D-09) — its concurrency proof, its parity control,
// and the invariants the sequential `for` loop used to guarantee for free.
//
// WHY A SEPARATE FILE FROM `run-shell.test.ts`: that file pins the SEQUENTIAL contract and must
// keep passing byte-for-byte. This one pins what only a POOL can be asked. The distinction is
// load-bearing for the parity control below.
//
// THE VACUOUS-ASSERTION TRAP (measured in 402-01, applied here): a 2-member fixture whose members
// take the same time and settle in declaration order produces the SAME observable stream under a
// concurrent pool and under the `for` loop it replaces — such a cell cannot tell them apart. So
// every cell in this file is driven by DEFERRED executors whose settle order the test controls,
// chosen so the sequential and concurrent executions produce DIFFERENT observable sequences.
// Where a claim genuinely cannot be discriminated that way (the terminal sequence's uniqueness,
// the parity control itself) the assertion site says so in prose.
//
// NO SLEEPS. Overlap is observed through microtask budgets (`drainMicrotasks`), not timers: under
// the pool a second member reaches its executor within the SAME synchronous region as the first
// (both worker loops run to their first await before either resumes), so a bounded drain either
// observes the overlap immediately or proves it never happened.
import { describe, expect, it } from 'vitest'

import { startRun } from '../shell.js'
import type {
  MemberTestExecutor,
  MemberTestRunContext,
  RunConfig,
  RunMemberDescriptor,
} from '../shell.js'
import type { EventLogPort, HandoffStorePort } from '../ports.js'
import type {
  CompletedRunHandoff,
  RunEventEnvelope,
  RunSession,
} from '@vostride/agent-qa-schema'
import type { TestResult } from '../../result.js'
import { SEQUENTIAL_BASELINE } from './__fixtures__/sequential-baseline.js'

// ---- Shared fakes ---------------------------------------------------------------------------

function passResult(name: string): TestResult {
  return {
    name,
    filePath: `${name}.test.ts`,
    status: 'passed',
    steps: [{ name: 'a step', status: 'passed', duration: 1 }],
    duration: 1,
  }
}

function failResult(name: string): TestResult {
  return {
    name,
    filePath: `${name}.test.ts`,
    status: 'failed',
    steps: [{ name: 'a step', status: 'failed', duration: 1, error: 'boom' }],
    duration: 1,
  }
}

function makeFakeHandoffStore(): HandoffStorePort {
  return { save: () => undefined }
}

function makeFakeEventLog(): EventLogPort {
  const store: RunEventEnvelope[] = []
  return {
    append(envelope) {
      store.push(envelope)
    },
    read(fromSeq) {
      return store.filter((event) => event.seq >= fromSeq)
    },
  }
}

function drain(session: RunSession): RunEventEnvelope[] {
  const received: RunEventEnvelope[] = []
  session.subscribe(1, (event) => received.push(event))
  return received
}

function done(session: RunSession): Promise<{ verdict: string; handoff: CompletedRunHandoff }> {
  return session.done as Promise<{ verdict: string; handoff: CompletedRunHandoff }>
}

/**
 * Yield the microtask queue `turns` times. The pool's dispatch is entirely synchronous +
 * microtask-driven (no timers anywhere in the shell's member loop), so a bounded drain is a
 * SUFFICIENT and TERMINATING observation: under concurrency the second member has started well
 * inside the budget; under a sequential loop it never starts and the budget expires, which is a
 * clean assertion failure rather than a hang.
 */
async function drainMicrotasks(turns = 100): Promise<void> {
  for (let i = 0; i < turns; i += 1) await Promise.resolve()
}

// ---- The pre-refactor parity control ---------------------------------------------------------

/**
 * The scenario the workers=1 parity control replays. Deliberately NOT uniform: a passing member,
 * a failing member that poisons its group, the resulting skip (a member the executor never sees),
 * and an ungrouped member that still runs. Every branch of the loop body appears exactly once, so
 * a refactor that drops or reorders any of them shows up in the stream.
 */
const BASELINE_MEMBERS: readonly RunMemberDescriptor[] = [
  {
    testId: 'alpha',
    name: 'alpha test',
    filePath: 'alpha.test.ts',
    failFastGroup: 'g1',
    suiteId: 's1',
    suiteName: 'suite one',
    suiteIndex: 0,
    suiteTotal: 1,
    totalSteps: 1,
  },
  {
    testId: 'bravo',
    name: 'bravo test',
    filePath: 'bravo.test.ts',
    failFastGroup: 'g1',
    suiteId: 's1',
    suiteName: 'suite one',
    suiteIndex: 0,
    suiteTotal: 1,
    totalSteps: 1,
  },
  {
    testId: 'charlie',
    name: 'charlie test',
    filePath: 'charlie.test.ts',
    failFastGroup: 'g1',
    suiteId: 's1',
    suiteName: 'suite one',
    suiteIndex: 0,
    suiteTotal: 1,
    totalSteps: 1,
  },
  { testId: 'delta', name: 'delta test', filePath: 'delta.test.ts', totalSteps: 1 },
]

const BASELINE_SCRIPT: Record<string, TestResult> = {
  alpha: passResult('alpha'),
  bravo: failResult('bravo'),
  delta: passResult('delta'),
}

function baselineConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  const calls: string[] = []
  const executor: MemberTestExecutor = async (member: RunMemberDescriptor) => {
    calls.push(member.testId)
    return BASELINE_SCRIPT[member.testId] ?? passResult(member.testId)
  }
  return {
    runId: 'run-baseline' as RunConfig['runId'],
    scope: { tier: 'suite', key: 'checkout' },
    executionContext: 'local-headless',
    buildOrdinal: 7,
    configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
    members: BASELINE_MEMBERS,
    executor,
    ports: { handoffStore: makeFakeHandoffStore(), eventLog: makeFakeEventLog() },
    ...overrides,
  }
}

export interface BaselineEvent {
  seq: number
  type: string
  runId: string
  payload: unknown
}

/**
 * `ts` is the ONLY field dropped — it is wall-clock, stamped by the bus's own default clock, and
 * says nothing about ordering that `seq` does not already say. Everything else (payload included)
 * is compared verbatim: the control is worth having only if it is byte-tight.
 */
function normalize(events: readonly RunEventEnvelope[]): BaselineEvent[] {
  return events.map((event) => ({
    seq: event.seq,
    type: event.type,
    runId: event.runId,
    payload: JSON.parse(JSON.stringify(event.payload)) as unknown,
  }))
}

describe('workers=1 parity — the pre-refactor differential control', () => {
  it('reproduces the captured sequential event stream verbatim', async () => {
    const session = startRun(baselineConfig())
    const events = drain(session)
    await done(session)

    expect(normalize(events)).toEqual(SEQUENTIAL_BASELINE)
  })

  // Capture mode. Run with AGENT_QA_CAPTURE_BASELINE=1 to (re)generate the fixture. It is
  // deliberately a test rather than a loose script so the capture and the comparison can never
  // drift apart: they share the scenario, the executor and the normalizer above.
  it.runIf(process.env.AGENT_QA_CAPTURE_BASELINE === '1')(
    'captures the fixture (AGENT_QA_CAPTURE_BASELINE=1)',
    async () => {
      const session = startRun(baselineConfig())
      const events = drain(session)
      await done(session)
      const captured = normalize(events)

      const { writeFileSync } = await import('node:fs')
      const { fileURLToPath } = await import('node:url')
      const target = fileURLToPath(
        new URL('./__fixtures__/sequential-baseline.ts', import.meta.url),
      )
      writeFileSync(
        target,
        [
          '// GENERATED — the pre-refactor sequential event stream of `run-shell.concurrency.test.ts`\'s',
          '// baseline scenario, captured 2026-08-24 against the `for`-loop shell at 7908bd34 BEFORE the',
          '// bounded member pool landed (402-02 Task 1). This file IS the parity control: the pool at',
          '// workers=1 must reproduce it verbatim. Regenerate ONLY with a recorded reason —',
          '// `AGENT_QA_CAPTURE_BASELINE=1 pnpm --filter @vostride/agent-qa-runner exec vitest run \\',
          '//   src/run/__tests__/run-shell.concurrency.test.ts` — because regenerating it against the',
          '// code under test is exactly how a differential control becomes self-certifying.',
          'export const SEQUENTIAL_BASELINE: ReadonlyArray<{',
          '  seq: number',
          '  type: string',
          '  runId: string',
          '  payload: unknown',
          '}> = ' + JSON.stringify(captured, null, 2),
          '',
        ].join('\n'),
      )
    },
  )
})

// ---- Deferred-executor instruments ------------------------------------------------------------

/**
 * Drain microtasks until `predicate` holds or the budget expires; report which happened. This is
 * the whole timing apparatus of this file. It terminates unconditionally, so a cell that expects
 * overlap FAILS on a sequential executor rather than hanging on one, and a cell that expects
 * serialization proves it without waiting on a clock.
 */
async function drainUntil(predicate: () => boolean, turns = 100): Promise<boolean> {
  for (let i = 0; i < turns; i += 1) {
    if (predicate()) return true
    await Promise.resolve()
  }
  return predicate()
}

function plainMembers(ids: readonly string[]): RunMemberDescriptor[] {
  return ids.map((id) => ({ testId: id, name: `${id} test`, filePath: `${id}.test.ts` }))
}

function poolConfig(overrides: Partial<RunConfig>): RunConfig {
  return {
    runId: 'run-pool' as RunConfig['runId'],
    scope: { tier: 'suite', key: 'checkout' },
    executionContext: 'local-headless',
    buildOrdinal: 7,
    configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
    members: plainMembers(['m0', 'm1']),
    executor: async (member: RunMemberDescriptor) => passResult(member.testId),
    ports: { handoffStore: makeFakeHandoffStore(), eventLog: makeFakeEventLog() },
    ...overrides,
  }
}

/**
 * An executor where m0 blocks until m1 has STARTED. Under a concurrent pool that resolves and the
 * two members finish in INVERTED order; under any sequential execution m1 cannot start while m0 is
 * blocked, the drain budget expires, and the recorded orders come out identical instead of
 * inverted. That difference — not a duration, not a timer — is what these cells assert on.
 */
function interleavingExecutor(started: string[], finished: string[]): MemberTestExecutor {
  return async (member: RunMemberDescriptor, _ctx: MemberTestRunContext) => {
    started.push(member.testId)
    if (member.testId === 'm0') await drainUntil(() => started.includes('m1'))
    finished.push(member.testId)
    return passResult(member.testId)
  }
}

describe('the bounded member pool — 2 members concurrent, one bus, one terminal sequence', () => {
  it('runs two members in flight together and lets the second finish FIRST', async () => {
    const started: string[] = []
    const finished: string[] = []
    const session = startRun(
      poolConfig({ workers: 2, executor: interleavingExecutor(started, finished) }),
    )
    const events = drain(session)
    await done(session)

    // Overlap: m1 entered its executor while m0 was still inside its own.
    expect(started).toEqual(['m0', 'm1'])
    // The discriminating half. A `for` loop CANNOT produce this ordering: it is the one
    // observation that separates a pool from the loop it replaces on identical input.
    expect(finished).toEqual(['m1', 'm0'])

    const startedIds = events
      .filter((e) => e.type === 'testStarted')
      .map((e) => (e.payload as { testId: string }).testId)
    const finishedIds = events
      .filter((e) => e.type === 'testFinished')
      .map((e) => (e.payload as { testId: string }).testId)
    expect(startedIds).toEqual(['m0', 'm1'])
    expect(finishedIds).toEqual(['m1', 'm0'])
  })

  it('stamps every envelope with the run\'s ONE runId at a strictly increasing seq', async () => {
    const started: string[] = []
    const finished: string[] = []
    const session = startRun(
      poolConfig({ workers: 2, executor: interleavingExecutor(started, finished) }),
    )
    const events = drain(session)
    await done(session)

    expect(finished).toEqual(['m1', 'm0'])
    expect(new Set(events.map((e) => e.runId))).toEqual(new Set(['run-pool']))
    expect(events.map((e) => e.seq)).toEqual(events.map((_e, i) => i + 1))
  })

  it('runs the terminal sequence exactly once no matter how the members interleave', async () => {
    const started: string[] = []
    const finished: string[] = []
    const session = startRun(
      poolConfig({ workers: 2, executor: interleavingExecutor(started, finished) }),
    )
    const events = drain(session)
    await done(session)

    // Assert the PREMISE first. Without this line the cell passes on a sequential executor too,
    // and would be claiming "no matter how the members interleave" about a run in which they did
    // not interleave at all — the 402-01 vacuous-assertion trap in its purest form.
    expect(finished).toEqual(['m1', 'm0'])
    expect(events.filter((e) => e.type === 'verdict')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'runFinished')).toHaveLength(1)
    const last = events[events.length - 1]
    expect(last.type).toBe('runFinished')
    expect((last.payload as { finalSeq: number }).finalSeq).toBe(last.seq)
  })

  it('serializes members that declare the SAME exclusive lane, even at workers=8', async () => {
    // The A2 protection (D-09's "each member its own browser/CDP handle"). Suite members share the
    // one adapter their suite set up, so they declare a lane and the pool must NOT interleave them
    // — the same input that produced an inverted finish above must produce declaration order here.
    const started: string[] = []
    const finished: string[] = []
    const members = plainMembers(['m0', 'm1']).map((m) => ({
      ...m,
      exclusiveLane: 'suite-lifecycle',
    }))
    const session = startRun(
      poolConfig({ workers: 8, members, executor: interleavingExecutor(started, finished) }),
    )
    const events = drain(session)
    await done(session)

    expect(started).toEqual(['m0', 'm1'])
    expect(finished).toEqual(['m0', 'm1'])
    const finishedIds = events
      .filter((e) => e.type === 'testFinished')
      .map((e) => (e.payload as { testId: string }).testId)
    expect(finishedIds).toEqual(['m0', 'm1'])
  })

  it('an all-lane run at workers=8 reproduces the workers=1 baseline stream verbatim', async () => {
    // The claim that makes the pool safe to ship for the suite path before per-member browser
    // sessions exist: give every member the lane a suite producer gives it and the ENTIRE event
    // stream — order, seqs, payloads — is the pre-refactor one, at any worker count.
    //
    // Every member gets the lane here, including the ungrouped `delta`. That is deliberate: a run
    // where SOME members declare the lane and some do not is a mixed run, and mixing changes the
    // stream (the lane-free member overtakes the queue). No shipped producer builds one — a run is
    // either the suite path (every member lane-bound) or the direct path (no member lane-bound) —
    // so this cell pins the shape that exists rather than the shape that does not.
    const laneMembers = BASELINE_MEMBERS.map((m) => ({ ...m, exclusiveLane: 'suite-lifecycle' }))
    const session = startRun(baselineConfig({ members: laneMembers, workers: 8 }))
    const events = drain(session)
    await done(session)

    expect(normalize(events)).toEqual(SEQUENTIAL_BASELINE)
  })
})

describe('the pool at the edges — empty and single-member runs', () => {
  it('a zero-member run settles immediately with the terminal sequence exactly once', async () => {
    const session = startRun(poolConfig({ members: [], workers: 4 }))
    const events = drain(session)
    const completion = await done(session)

    expect(events.map((e) => e.type)).toEqual(['runStarted', 'verdict', 'runFinished'])
    expect(events.filter((e) => e.type === 'verdict')).toHaveLength(1)
    expect(completion.handoff.tests).toEqual([])
    expect((events[0].payload as { memberTestCount: number }).memberTestCount).toBe(0)
  })

  it('a single-member run under the pool matches the same run at workers=1', async () => {
    const single = plainMembers(['m0'])
    const pooled = startRun(poolConfig({ members: single, workers: 4, runId: 'run-x' as RunConfig['runId'] }))
    const pooledEvents = drain(pooled)
    const pooledCompletion = await done(pooled)

    const sequential = startRun(poolConfig({ members: single, runId: 'run-x' as RunConfig['runId'] }))
    const sequentialEvents = drain(sequential)
    const sequentialCompletion = await done(sequential)

    expect(normalize(pooledEvents)).toEqual(normalize(sequentialEvents))
    expect(pooledCompletion.verdict).toBe(sequentialCompletion.verdict)
  })
})
