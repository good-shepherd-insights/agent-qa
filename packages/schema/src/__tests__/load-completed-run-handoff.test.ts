// Wave-0 RED scaffold (361-01, Task 1). Pins the schema-side handoff version guard
// BEFORE any implementation exists — RED strictly on the unresolved import of the
// not-yet-existing `../handoff/load-completed-run-handoff` module (right-reason RED).
//
// Contract source: 361-CONTEXT.md D-19 (361 ships the READ side of the version
// discipline: parse → version check → reject newer-than-known with a typed error →
// migrate older; empty migration table at v1, but the seam exists so every future
// consumer imports the one guard instead of re-implementing the rule) +
// eval-and-core-types.md §A8 schema-version discipline (reject newer / migrate older).
//
// Schema module-discipline law: extension-less relative import specifiers, no node builtins.
import { describe, expect, it } from 'vitest'

import {
  guardCompletedRunHandoff,
  HandoffVersionError,
  HANDOFF_MIGRATIONS,
} from '../handoff/load-completed-run-handoff'
import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  type CompletedRunHandoff,
} from '../handoff/completed-run-handoff'
import { asRunId } from '../run/run-id'
import type { ScopeKey } from '../identity/scope-key'

const scope: ScopeKey = { tier: 'suite', key: 'checkout' }

function makeValidHandoff(): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: asRunId('run-abc'),
    scope,
    buildOrdinal: 1,
    executionContext: 'ci',
    aggregateVerdict: 'passed',
    configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_010_000,
    tests: [],
  }
}

describe('guardCompletedRunHandoff (D-19, §A8 version discipline)', () => {
  it('returns a typed handoff for a document at the current schemaVersion', () => {
    const doc = makeValidHandoff()
    const guarded = guardCompletedRunHandoff(doc)
    expect(guarded.schemaVersion).toBe(CURRENT_HANDOFF_SCHEMA_VERSION)
    expect(guarded.runId).toBe('run-abc')
    expect(guarded.aggregateVerdict).toBe('passed')
  })

  it('loads a stored schemaVersion 2 document through the registered identity migration', () => {
    // RCC-01 / RESEARCH Pitfall 5: rootCause is optional-additive, so every
    // pre-Phase-373 .agent-qa/runs/<slug>/handoff.json (written at v2) must keep
    // loading — the HANDOFF_MIGRATIONS[2] identity entry carries it to v3 semantics.
    const doc = { ...makeValidHandoff(), schemaVersion: 2 }
    const guarded = guardCompletedRunHandoff(doc)
    expect(guarded.runId).toBe('run-abc')
    expect(guarded.aggregateVerdict).toBe('passed')
    expect(guarded.tests).toEqual([])
  })

  it('rejects a pre-INST schemaVersion 1 with no migration registered', () => {
    const doc = { ...makeValidHandoff(), schemaVersion: 1 }
    let thrown: unknown
    try {
      guardCompletedRunHandoff(doc)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(HandoffVersionError)
    const err = thrown as HandoffVersionError
    expect(err.message).toContain('schemaVersion 1')
    expect(err.message).toContain(`supports ${CURRENT_HANDOFF_SCHEMA_VERSION}`)
    expect(err.foundVersion).toBe(1)
    expect(err.supportedVersion).toBe(CURRENT_HANDOFF_SCHEMA_VERSION)
  })

  it('rejects a newer-than-known schemaVersion with a typed HandoffVersionError', () => {
    const newer = CURRENT_HANDOFF_SCHEMA_VERSION + 1
    const doc = { ...makeValidHandoff(), schemaVersion: newer }
    let thrown: unknown
    try {
      guardCompletedRunHandoff(doc)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(HandoffVersionError)
    const err = thrown as HandoffVersionError
    expect(err.foundVersion).toBe(newer)
    expect(err.supportedVersion).toBe(CURRENT_HANDOFF_SCHEMA_VERSION)
  })

  it('throws for a non-numeric schemaVersion', () => {
    const doc = { ...makeValidHandoff(), schemaVersion: 'one' as unknown as number }
    expect(() => guardCompletedRunHandoff(doc)).toThrow()
  })

  it('throws for a missing schemaVersion', () => {
    const { schemaVersion: _omit, ...withoutVersion } = makeValidHandoff()
    void _omit
    expect(() => guardCompletedRunHandoff(withoutVersion as CompletedRunHandoff)).toThrow()
  })

  it('registers exactly the v2..v6 identity migrations so schemaVersion 1 stays unreadable', () => {
    expect(HANDOFF_MIGRATIONS).toBeDefined()
    expect(Object.keys(HANDOFF_MIGRATIONS)).toEqual(['2', '3', '4', '5', '6'])
  })
})

// --- 407-03 (TRST-01, D-13): the additive `StepEvidence.retrievalRung` -----------------------
//
// The rung is recorded BESIDE the served brief, never inside it, so a v6 handoff stays
// loadable and a v7 handoff that carries one is admitted only in the shape the schema
// declares. Present-implies-valid, exactly as `retrievalTrace` next door.

function makeStepWithRung(rung?: unknown): unknown {
  return {
    stepIndex: 0,
    stepText: 'Save the record',
    cacheStatus: 'miss',
    servedBrief: {
      scope,
      asOfBuild: 1,
      budget: 4096,
      truncation: 'none',
      channel1: [],
      channel2: [],
      channel3: [],
      briefDigest: 'brief-digest-deadbeef',
    },
    subActions: [],
    verifierVerdict: { pass: true, reasoning: 'saved' },
    ...(rung !== undefined ? { retrievalRung: rung } : {}),
  }
}

function makeHandoffWithStep(rung?: unknown): Record<string, unknown> {
  return {
    ...makeValidHandoff(),
    tests: [
      {
        testId: 't-1',
        testName: 'checkout happy path',
        filePath: 'tests/checkout.test.yaml',
        testIndex: 0,
        outcome: 'passed',
        steps: [makeStepWithRung(rung)],
      },
    ],
  }
}

describe('StepEvidence.retrievalRung at the load boundary (407 D-13, TRST-01)', () => {
  it('bumps the current handoff schemaVersion to 7', () => {
    expect(CURRENT_HANDOFF_SCHEMA_VERSION).toBe(7)
  })

  it('loads a stored schemaVersion 6 document whose steps carry no rung, unchanged', () => {
    const doc = { ...makeHandoffWithStep(), schemaVersion: 6 }
    const guarded = guardCompletedRunHandoff(doc)
    const step = guarded.tests[0]?.steps[0]
    expect(step).toBeDefined()
    expect('retrievalRung' in (step as object)).toBe(false)
  })

  it('loads a v7 document whose step carries a recorded rung, field intact', () => {
    const recorded = {
      schemaVersion: 1,
      rung: 'static-floor',
      reason: 'native-runtime-unavailable',
    }
    const guarded = guardCompletedRunHandoff(makeHandoffWithStep(recorded))
    expect(guarded.tests[0]?.steps[0]?.retrievalRung).toEqual(recorded)
  })

  it('admits a memidex rung carrying no reason key (the top rung names no cause)', () => {
    const recorded = { schemaVersion: 1, rung: 'memidex' }
    const guarded = guardCompletedRunHandoff(makeHandoffWithStep(recorded))
    expect(guarded.tests[0]?.steps[0]?.retrievalRung).toEqual(recorded)
  })

  it('refuses a step whose retrievalRung is present but not a RecordedRetrievalRung', () => {
    // Present-implies-valid: the same refusal an invalid `retrievalTrace` earns.
    expect(() => guardCompletedRunHandoff(makeHandoffWithStep({ rung: 'fast' }))).toThrow(
      /failed structural validation/,
    )
  })

  it('refuses a rung whose word is outside the closed vocabulary', () => {
    expect(() =>
      guardCompletedRunHandoff(makeHandoffWithStep({ schemaVersion: 1, rung: 'dense-only' })),
    ).toThrow(/failed structural validation/)
  })
})

// --- 407-20 (REVIEW WR-04): a replay plan source is admitted only in the wire's own domain ---
//
// `hasCompletePlanSourceShape` used to admit `flow.cursor`/`flow.length` as merely FINITE numbers
// and `guard.checksPassed`/`guard.total`/`*.procedureStepIndex` as a bare `typeof === 'number'`,
// while `RunKnowledgePlanSourceSchema` (`../functions/runs`) declares every one of them
// `z.number().int().nonnegative()`. `planSourceOf` picks an admitted value straight onto that
// strict wire, so a `-1` cursor loaded here and then threw at `spec.output.parse` — the Knowledge
// tab rendering `read_failed` for that run. A handoff carrying a negative cursor is malformed, so
// it is refused where it is LOADED, through the same arm an unknown `miss.reason` takes today.

function makeReplayStep(planSource: unknown): unknown {
  return {
    stepIndex: 0,
    stepText: 'Save the record',
    cacheStatus: 'miss',
    servedBrief: {
      scope,
      asOfBuild: 1,
      budget: 4096,
      truncation: 'none',
      channel1: [],
      channel2: [],
      channel3: [],
      briefDigest: 'brief-digest-deadbeef',
    },
    subActions: [],
    verifierVerdict: { pass: true, reasoning: 'saved' },
    planSource,
  }
}

function replayHandoff(planSource: unknown): Record<string, unknown> {
  return {
    ...makeValidHandoff(),
    tests: [
      {
        testId: 't-1',
        testName: 'checkout happy path',
        filePath: 'tests/checkout.test.yaml',
        testIndex: 0,
        outcome: 'passed',
        steps: [makeReplayStep(planSource)],
      },
    ],
  }
}

/** The shape `recordProcedureReplaySource` (runner loop/index.ts:406) really writes. */
function replaySource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'procedure-replay',
    procedureId: 'p',
    guard: { checksPassed: 3, total: 3 },
    flow: { cursor: 1, length: 3 },
    ...overrides,
  }
}

describe("a replay plan source is admitted only in the wire's own domain (407-20, REVIEW WR-04)", () => {
  it('loads a step whose replay plan source carries the ordinals the runner writes', () => {
    const guarded = guardCompletedRunHandoff(replayHandoff(replaySource()))
    expect(guarded.tests[0]?.steps[0]?.planSource).toEqual({
      kind: 'procedure-replay',
      procedureId: 'p',
      guard: { checksPassed: 3, total: 3 },
      flow: { cursor: 1, length: 3 },
    })
  })

  it.each([
    ['flow.cursor: -1', replaySource({ flow: { cursor: -1, length: 3 } })],
    ['flow.length: 1.5', replaySource({ flow: { cursor: 1, length: 1.5 } })],
    ['flow.cursor: Number.NaN', replaySource({ flow: { cursor: Number.NaN, length: 3 } })],
    ['guard.checksPassed: -1', replaySource({ guard: { checksPassed: -1, total: 3 } })],
    ['guard.total: 2.5', replaySource({ guard: { checksPassed: 2, total: 2.5 } })],
    [
      'guard.miss.procedureStepIndex: 1.5',
      replaySource({
        guard: {
          checksPassed: 1,
          total: 3,
          miss: { procedureStepIndex: 1.5, reason: 'descriptor-missing' },
        },
      }),
    ],
    [
      'guard.executionFailure.procedureStepIndex: -1',
      replaySource({
        guard: { checksPassed: 1, total: 3, executionFailure: { procedureStepIndex: -1 } },
      }),
    ],
    [
      'guard.verifierRejection.procedureStepIndex: 0.5',
      replaySource({
        guard: { checksPassed: 1, total: 3, verifierRejection: { procedureStepIndex: 0.5 } },
      }),
    ],
  ])('refuses a replay plan source carrying %s', (_label, planSource) => {
    // The same refusal arm an unknown `miss.reason` earns today — never admitted here and
    // then thrown at by `spec.output.parse` as a `read_failed` page.
    expect(() => guardCompletedRunHandoff(replayHandoff(planSource))).toThrow(
      /failed structural validation/,
    )
  })

  it('leaves an ordinary procedure-hint plan source untouched', () => {
    const hint = { kind: 'procedure-hint', procedureId: 'p' }
    expect(guardCompletedRunHandoff(replayHandoff(hint)).tests[0]?.steps[0]?.planSource).toEqual(
      hint,
    )
  })

  it('leaves a procedure-hint carrying a declared demotion untouched', () => {
    const hint = { kind: 'procedure-hint', procedureId: 'p', demotion: 'body-empty' }
    expect(guardCompletedRunHandoff(replayHandoff(hint)).tests[0]?.steps[0]?.planSource).toEqual(
      hint,
    )
  })

  it('still refuses a procedure-hint whose demotion is outside the closed union', () => {
    const hint = { kind: 'procedure-hint', procedureId: 'p', demotion: 'body-elsewhere' }
    expect(() => guardCompletedRunHandoff(replayHandoff(hint))).toThrow(
      /failed structural validation/,
    )
  })
})
