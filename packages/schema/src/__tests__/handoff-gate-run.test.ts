// Phase 384 plan 02, D-10: the `gateRun` carrier, minted on CompletedRunHandoff v4.
//
// Pins the three load-boundary facts the carrier introduces: the version bump itself,
// backward-compatible loading of every already-written v3 handoff document through an
// identity migration, and the present-implies-valid shape clause that admits only the
// literal marker. RESEARCH Pitfall 5 is pinned explicitly: `gateRun` is a SECOND,
// distinct axis beside `excludedFromOutcomes` — neither implies the other.
//
// 387-02 repin: the current version and the migration-key set moved to 5 / ['2','3','4']
// when `retrievalTrace` joined StepEvidence. The gateRun semantics below are untouched —
// a version was added ABOVE them, not in place of them.
//
// Schema module-discipline law: extension-less relative import specifiers, no node builtins.
import { describe, expect, it } from 'vitest'

import {
  guardCompletedRunHandoff,
  HANDOFF_MIGRATIONS,
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
  // The carrier's own semantics are unchanged by later version bumps; what moves is the
  // CURRENT version the guard accepts and the migration chain that carries a v4 document
  // forward. Both are repinned here rather than loosened, because the exact-equality
  // assertion below is what makes "exactly one new migration entry" machine-checked.
  it('pins the current handoff schema version at 5 (387-02 retrievalTrace bump)', () => {
    expect(CURRENT_HANDOFF_SCHEMA_VERSION).toBe(5)
  })

  it('registers the 4 -> 5 identity migration beside the shipped v2 and v3 entries', () => {
    expect(Object.keys(HANDOFF_MIGRATIONS)).toEqual(['2', '3', '4'])
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
