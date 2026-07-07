// Wave-0 RED scaffold (361-01, Task 1). Pins the Plan 02 bus-schema-v1 contract
// BEFORE any implementation exists — RED strictly on the unresolved import of the
// not-yet-existing `../run/bus-events` module (right-reason RED). Turns green in
// Plan 02 without weakening a single assertion here.
//
// Contract source: spec/v2/runner.md §2.2 (frozen envelope, append-only event enum,
// busSchemaVersion, runFinished.disposition fixed 'detached' in M1) + 361-CONTEXT.md
// D-05 (envelope home), D-15 (MemberTestOutcome splits off RunStatus, gains 'skipped').
//
// Schema module-discipline law: extension-less relative import specifiers, no node builtins.
import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  CURRENT_BUS_SCHEMA_VERSION,
  RUN_EVENT_TYPES,
} from '../run/bus-events'
import type {
  RunEventEnvelope,
  RunEventType,
  RunFinishedPayload,
  RunStartedPayload,
} from '../run/bus-events'
import type { MemberTestOutcome } from '../run/member-outcome'
import type { PerTestOutcome } from '../handoff/per-test-outcome'
import type { ScopeKey } from '../identity/scope-key'
import type { ExecutionContext, RunStatus } from '../run/run-status'

// The complete §2.2 event vocabulary M1 ships: every group EXCEPT the reserved
// control/arbiter group (M5). The eleven lifecycle/diagnostic events plus the nine
// chip events — camelCase, names verbatim per spec §2.2 (Ratified 2026-07-05).
const EXPECTED_EVENT_TYPES: readonly string[] = [
  // Run lifecycle
  'runStarted',
  'runFinished',
  // Member-test lifecycle
  'testStarted',
  'testFinished',
  // Step lifecycle
  'stepStarted',
  'stepFinalized',
  // Sub-action evidence tick
  'subActionRecorded',
  // Verdict
  'verdict',
  // Diagnostics
  'runWarning',
  'runError',
  // Liveness
  'heartbeat',
  // Post-processing / status chips — DEFINED in v1, emitted by no M1 producer
  'analysisStarted',
  'analysisCompleted',
  'analysisFailed',
  'curationStarted',
  'curationCompleted',
  'curationFailed',
  'issuesStarted',
  'issuesCompleted',
  'issuesFailed',
]

const scope: ScopeKey = { tier: 'suite', key: 'checkout' }
const executionContext: ExecutionContext = 'local-headless'

describe('bus schema v1 — envelope + event vocabulary (D-05, spec §2.2)', () => {
  it('declares bus schema version 1', () => {
    expect(CURRENT_BUS_SCHEMA_VERSION).toBe(1)
  })

  it('the event-type vocabulary is exactly the §2.2 groups minus control/arbiter', () => {
    expect([...RUN_EVENT_TYPES].sort()).toEqual([...EXPECTED_EVENT_TYPES].sort())
  })

  it('defines the nine chip events verbatim (Ratified 2026-07-05, spec §2.2)', () => {
    const chips = [
      'analysisStarted',
      'analysisCompleted',
      'analysisFailed',
      'curationStarted',
      'curationCompleted',
      'curationFailed',
      'issuesStarted',
      'issuesCompleted',
      'issuesFailed',
    ]
    for (const chip of chips) {
      expect(RUN_EVENT_TYPES).toContain(chip)
    }
  })

  it('an envelope { seq, ts, runId, type, payload } JSON-round-trips deep-equal', () => {
    const envelope: RunEventEnvelope = {
      seq: 1,
      ts: 1_700_000_000_000,
      runId: 'run-abc',
      type: 'heartbeat',
      payload: {},
    }
    expect(JSON.parse(JSON.stringify(envelope))).toEqual(envelope)
  })

  it('the envelope seq/ts/runId/type/payload fields are all present', () => {
    const envelope: RunEventEnvelope = {
      seq: 7,
      ts: 1_700_000_000_042,
      runId: 'run-xyz',
      type: 'runWarning',
      payload: { code: 'subscriber-detached', message: 'handler threw' },
    }
    expect(Object.keys(envelope).sort()).toEqual(
      ['payload', 'runId', 'seq', 'ts', 'type'],
    )
  })
})

describe('run-lifecycle payload headers (spec §2.2, D-04/D-05)', () => {
  it('RunStartedPayload carries the CompletedRunHandoff header fields + busSchemaVersion', () => {
    const runStarted: RunStartedPayload = {
      busSchemaVersion: CURRENT_BUS_SCHEMA_VERSION,
      scope,
      executionContext,
      buildOrdinal: 1,
      configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
      memberTestCount: 3,
    }
    expect(Object.keys(runStarted).sort()).toEqual([
      'buildOrdinal',
      'busSchemaVersion',
      'configDigests',
      'executionContext',
      'memberTestCount',
      'scope',
    ])
    expect(runStarted.busSchemaVersion).toBe(1)
    expect(JSON.parse(JSON.stringify(runStarted))).toEqual(runStarted)
  })

  it('RunFinishedPayload carries aggregateVerdict, disposition fixed detached, finalSeq', () => {
    const runFinished: RunFinishedPayload = {
      aggregateVerdict: 'passed',
      disposition: 'detached',
      finalSeq: 42,
    }
    // M1 fixes disposition to 'detached' — no post-processing producer exists (Ratified 2026-07-05).
    expect(runFinished.disposition).toBe('detached')
    expect(runFinished.finalSeq).toBe(42)
    expect(JSON.parse(JSON.stringify(runFinished))).toEqual(runFinished)
  })
})

describe('MemberTestOutcome — the D-15 per-test union split', () => {
  it('includes skipped and every RunStatus member', () => {
    const outcomes: MemberTestOutcome[] = [
      'passed',
      'failed',
      'healed',
      'timeout',
      'cancelled',
      'skipped',
    ]
    expect(outcomes).toContain('skipped')
  })

  it('every RunStatus is a valid MemberTestOutcome (member superset of aggregate)', () => {
    expectTypeOf<RunStatus>().toMatchTypeOf<MemberTestOutcome>()
  })

  it('PerTestOutcome.outcome is assignable from MemberTestOutcome (D-15)', () => {
    expectTypeOf<MemberTestOutcome>().toMatchTypeOf<PerTestOutcome['outcome']>()
    expectTypeOf<RunEventType>().toEqualTypeOf<(typeof RUN_EVENT_TYPES)[number]>()
  })
})
