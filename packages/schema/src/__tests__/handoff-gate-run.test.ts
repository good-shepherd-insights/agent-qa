// Phase 384 plan 02, D-10: the `gateRun` carrier, minted on CompletedRunHandoff v4.
//
// Pins the three load-boundary facts the carrier introduces: the version bump itself,
// backward-compatible loading of every already-written v3 handoff document, and the
// present-implies-valid shape clause that admits only the literal marker. RESEARCH Pitfall 5 is pinned explicitly: `gateRun` is a SECOND,
// distinct axis beside `excludedFromOutcomes` — neither implies the other.
//
// Schema module-discipline law: extension-less relative import specifiers, no node builtins.
import { describe, expect, it } from 'vitest'

import {
  guardCompletedRunHandoff,
  HANDOFF_MIGRATIONS,
  HANDOFF_STAMPS_READ_AS_CURRENT,
} from '../handoff/load-completed-run-handoff'
import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  type CompletedRunHandoff,
} from '../handoff/completed-run-handoff'
import { asRunId } from '../run/run-id'
import type { ScopeKey } from '../identity/scope-key'

const scope: ScopeKey = { tier: 'suite', key: 'checkout' }

function makeHandoff(): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: asRunId('run-gate-1'),
    scope,
    buildOrdinal: 4,
    executionContext: 'local-headless',
    aggregateVerdict: 'passed',
    configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_010_000,
    tests: [],
  }
}

describe('CompletedRunHandoff gateRun carrier, minted at v4 (D-10)', () => {
  it('pins the current handoff schema version at 2', () => {
    expect(CURRENT_HANDOFF_SCHEMA_VERSION).toBe(2)
  })

  it('registers no migration and reads stamps 3 to 7 as current', () => {
    expect(Object.keys(HANDOFF_MIGRATIONS)).toEqual([])
    expect(HANDOFF_STAMPS_READ_AS_CURRENT).toEqual([3, 4, 5, 6, 7])
  })

  it('loads an already-written schemaVersion 3 document unchanged, with gateRun absent', () => {
    const stored = { ...makeHandoff(), schemaVersion: 3 }

    const guarded = guardCompletedRunHandoff(stored)

    expect(guarded.runId).toBe('run-gate-1')
    expect(guarded.aggregateVerdict).toBe('passed')
    expect(guarded.tests).toEqual([])
    expect('gateRun' in guarded).toBe(false)
  })

  it('admits a current-version document carrying the literal gateRun marker', () => {
    const doc = { ...makeHandoff(), gateRun: true as const }

    const guarded = guardCompletedRunHandoff(doc)

    expect(guarded.gateRun).toBe(true)
  })

  it('rejects a document whose gateRun is present but not the literal true', () => {
    const withFalse = { ...makeHandoff(), gateRun: false }
    const withString = { ...makeHandoff(), gateRun: 'yes' }

    expect(() => guardCompletedRunHandoff(withFalse)).toThrow()
    expect(() => guardCompletedRunHandoff(withString)).toThrow()
  })

  it('keeps gateRun and excludedFromOutcomes independent axes (Pitfall 5)', () => {
    const gateOnly = guardCompletedRunHandoff({ ...makeHandoff(), gateRun: true })
    const excludedOnly = guardCompletedRunHandoff({
      ...makeHandoff(),
      excludedFromOutcomes: true,
    })
    const both = guardCompletedRunHandoff({
      ...makeHandoff(),
      gateRun: true,
      excludedFromOutcomes: true,
    })

    expect('excludedFromOutcomes' in gateOnly).toBe(false)
    expect('gateRun' in excludedOnly).toBe(false)
    expect(both.gateRun).toBe(true)
    expect(both.excludedFromOutcomes).toBe(true)
  })
})
