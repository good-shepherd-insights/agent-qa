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
