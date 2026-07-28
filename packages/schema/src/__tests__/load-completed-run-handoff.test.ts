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

  it('registers exactly the v2 and v3 identity migrations so schemaVersion 1 stays unreadable', () => {
    expect(HANDOFF_MIGRATIONS).toBeDefined()
    expect(Object.keys(HANDOFF_MIGRATIONS)).toEqual(['2', '3'])
  })
})
