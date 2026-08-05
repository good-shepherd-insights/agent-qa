// RED-first pins for FLAK-02's whole promise (Phase 390 D-14/D-16): a quarantined test still RUNS,
// its failure does not fail the run — and the disposition is LOUD, never a rewritten outcome.
//
// The quarantined set arrives on RunConfig as PLAIN DATA (D-16): the runner gains zero ports and
// stays storageNeutral; the CLI folds the committed ledger once at run start.
//
// Both directions are pinned in one suite (the two-sided-contract law): a quarantined failing member
// aggregates 'passed' / exit 0, and a non-quarantined failing sibling still aggregates 'failed'.
//
// Runner package convention: `.js`-suffixed relative import specifiers.
import { describe, expect, it } from 'vitest'

import { startRun } from '../shell.js'
import type {
  MemberTestExecutor,
  MemberTestRunContext,
  RunConfig,
  RunMemberDescriptor,
} from '../shell.js'
import type { HandoffStorePort } from '../ports.js'
import { deriveAggregateVerdict, mapVerdictToExitCode } from '../verdict.js'
import type { StepResult, TestResult } from '../../result.js'
import type { CompletedRunHandoff, MemberTestOutcome, RunSession } from '@vostride/agent-qa-schema'

// ---- Fixtures ------------------------------------------------------------

function step(overrides: Partial<StepResult> = {}): StepResult {
  return { name: 'a step', status: 'passed', duration: 1, ...overrides }
}

function passResult(name: string): TestResult {
  return { name, filePath: `${name}.test.ts`, status: 'passed', steps: [step()], duration: 1 }
}

function failResult(name: string): TestResult {
  return {
    name,
    filePath: `${name}.test.ts`,
    status: 'failed',
    steps: [step({ status: 'failed', error: 'assertion failed' })],
    duration: 1,
  }
}

function makeFakeHandoffStore(): HandoffStorePort & { saved: CompletedRunHandoff[] } {
  const saved: CompletedRunHandoff[] = []
  return {
    saved,
    save(handoff: CompletedRunHandoff) {
      saved.push(handoff)
    },
  }
}

function scriptedExecutor(script: Record<string, TestResult>): MemberTestExecutor {
  return async (member: RunMemberDescriptor, ctx: MemberTestRunContext) => {
    void ctx
    return script[member.testId] ?? passResult(member.testId)
  }
}

const FLAKY: RunMemberDescriptor = {
  testId: 'flaky',
  name: 'checkout completes',
  filePath: 'tests/checkout.test.yaml',
}
const HEALTHY: RunMemberDescriptor = {
  testId: 'healthy',
  name: 'login works',
  filePath: 'tests/login.test.yaml',
}
const REGRESSION: RunMemberDescriptor = {
  testId: 'regression',
  name: 'search returns hits',
  filePath: 'tests/search.test.yaml',
}

const QUARANTINED_FLAKY = {
  product: 'checkout',
  filePath: FLAKY.filePath,
  testName: FLAKY.name,
  expiresAt: '2026-09-04T10:00:00.000Z',
} as const

function baseConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    runId: 'run-1' as RunConfig['runId'],
    scope: { tier: 'product', key: 'checkout' },
    executionContext: 'local-headless',
    buildOrdinal: 7,
    configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
    members: [FLAKY, HEALTHY],
    executor: scriptedExecutor({ flaky: failResult('flaky') }),
    ports: { handoffStore: makeFakeHandoffStore() },
    ...overrides,
  }
}

function done(session: RunSession): Promise<{ verdict: string; handoff: CompletedRunHandoff }> {
  return (session as unknown as { done: Promise<{ verdict: string; handoff: CompletedRunHandoff }> }).done
}

// ---- The end-to-end disposition path ------------------------------------

describe('quarantine-aware run (D-14/D-16)', () => {
  it('a quarantined failing member leaves the run passed at exit 0, outcome still failed', async () => {
    const session = startRun(baseConfig({ quarantined: [QUARANTINED_FLAKY] }))
    const { verdict, handoff } = await done(session)

    expect(verdict).toBe('passed')
    expect(mapVerdictToExitCode(handoff.aggregateVerdict)).toBe(0)

    // The member outcome stays TRUTHFUL — the projection window and the M-passes exit keep
    // seeing reality (D-14). 'failed' stays 'failed'.
    const member = handoff.tests.find((test) => test.testId === 'flaky')
    expect(member?.outcome).toBe('failed')
    expect(member?.quarantined).toBe(true)

    // The disposition lives BESIDE the outcome, and the run records which entries applied.
    expect(handoff.quarantineApplied).toEqual([QUARANTINED_FLAKY])

    const healthy = handoff.tests.find((test) => test.testId === 'healthy')
    expect(healthy?.outcome).toBe('passed')
    expect('quarantined' in (healthy ?? {})).toBe(false)
  })

  it('CONTROL: a non-quarantined failing sibling still fails the run', async () => {
    const session = startRun(
      baseConfig({
        members: [FLAKY, HEALTHY, REGRESSION],
        executor: scriptedExecutor({
          flaky: failResult('flaky'),
          regression: failResult('regression'),
        }),
        quarantined: [QUARANTINED_FLAKY],
      }),
    )
    const { verdict, handoff } = await done(session)

    expect(verdict).toBe('failed')
    expect(mapVerdictToExitCode(handoff.aggregateVerdict)).toBe(1)
    expect(handoff.tests.find((test) => test.testId === 'flaky')?.quarantined).toBe(true)
    expect('quarantined' in (handoff.tests.find((test) => test.testId === 'regression') ?? {})).toBe(
      false,
    )
  })

  it('an absent quarantined set reproduces pre-390 behavior byte-identically', async () => {
    const session = startRun(baseConfig())
    const { verdict, handoff } = await done(session)

    expect(verdict).toBe('failed')
    expect(handoff.quarantineApplied).toBeUndefined()
    for (const test of handoff.tests) expect('quarantined' in test).toBe(false)
  })

  it('an empty quarantined set is byte-identical to an absent one', async () => {
    const session = startRun(baseConfig({ quarantined: [] }))
    const { verdict, handoff } = await done(session)

    expect(verdict).toBe('failed')
    expect(handoff.quarantineApplied).toBeUndefined()
  })

  it('matches members on (filePath, testName) — never testId', async () => {
    const session = startRun(
      baseConfig({
        quarantined: [{ ...QUARANTINED_FLAKY, filePath: 'tests/OTHER.test.yaml' }],
      }),
    )
    const { verdict } = await done(session)
    expect(verdict).toBe('failed')
  })

  it('suppresses a quarantined member that TIMES OUT, the same A3 phenomenon', async () => {
    const timeoutResult: TestResult = {
      name: 'flaky',
      filePath: 'flaky.test.ts',
      status: 'failed',
      steps: [step({ status: 'failed', error: 'Test exceeded its time limit of 30000ms' })],
      duration: 1,
    }
    const session = startRun(
      baseConfig({
        executor: scriptedExecutor({ flaky: timeoutResult }),
        quarantined: [QUARANTINED_FLAKY],
      }),
    )
    const { verdict, handoff } = await done(session)
    const member = handoff.tests.find((test) => test.testId === 'flaky')
    expect(member?.outcome).toBe('timeout')
    expect(member?.quarantined).toBe(true)
    expect(verdict).toBe('passed')
  })
})

// ---- The rule itself (D-14: the skip is EXPLICIT in deriveAggregateVerdict) ----

describe('deriveAggregateVerdict quarantine skip', () => {
  const base = { runCancelled: false, runBudgetExpired: false }

  it('skips quarantined failed AND timeout members', () => {
    for (const outcome of ['failed', 'timeout'] as MemberTestOutcome[]) {
      expect(
        deriveAggregateVerdict({ ...base, outcomes: [outcome], quarantined: [true] }),
      ).toBe('passed')
      expect(
        deriveAggregateVerdict({ ...base, outcomes: [outcome], quarantined: [false] }),
      ).toBe('failed')
    }
  })

  it('only skips the flagged positions', () => {
    expect(
      deriveAggregateVerdict({
        ...base,
        outcomes: ['failed', 'failed'],
        quarantined: [true, false],
      }),
    ).toBe('failed')
    expect(
      deriveAggregateVerdict({
        ...base,
        outcomes: ['failed', 'failed'],
        quarantined: [true, true],
      }),
    ).toBe('passed')
  })

  it('leaves every other branch untouched — the run-level branches win regardless', () => {
    expect(
      deriveAggregateVerdict({
        runCancelled: true,
        runBudgetExpired: false,
        outcomes: ['failed'],
        quarantined: [true],
      }),
    ).toBe('cancelled')
    expect(
      deriveAggregateVerdict({
        runCancelled: false,
        runBudgetExpired: true,
        outcomes: ['failed'],
        quarantined: [true],
      }),
    ).toBe('timeout')
    // A quarantined member never suppresses a sibling 'cancelled' or 'healed' signal.
    expect(
      deriveAggregateVerdict({
        ...base,
        outcomes: ['failed', 'cancelled'],
        quarantined: [true, false],
      }),
    ).toBe('cancelled')
    expect(
      deriveAggregateVerdict({
        ...base,
        outcomes: ['failed', 'healed'],
        quarantined: [true, false],
      }),
    ).toBe('healed')
  })

  it('an absent flags array is the pre-390 rule', () => {
    expect(deriveAggregateVerdict({ ...base, outcomes: ['failed'] })).toBe('failed')
    expect(deriveAggregateVerdict({ ...base, outcomes: ['timeout'] })).toBe('failed')
    expect(deriveAggregateVerdict({ ...base, outcomes: ['passed'] })).toBe('passed')
  })

  it('a short flags array never reads as quarantined by accident', () => {
    expect(
      deriveAggregateVerdict({ ...base, outcomes: ['passed', 'failed'], quarantined: [true] }),
    ).toBe('failed')
  })
})
