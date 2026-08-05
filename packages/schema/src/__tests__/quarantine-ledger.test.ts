// RED-first pins for the Phase 390 quarantine ledger event contract (D-01/D-03/D-11/D-12/D-14/D-16).
//
// The ledger is COMMITTED truth at the knowledge root, so its read side follows the
// analysis-artifact posture: a NEWER schemaVersion is a typed hard failure, and a structurally
// broken event is refused — never healed to absence (healing a quarantine entry silently
// un-quarantines, the exact silent flip this phase exists to prevent).
//
// Boundary pinned at 1 and 2: version 1 admits by identity, version 2 throws typed.

import { describe, expect, it } from 'vitest'

import {
  CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
  QUARANTINE_EVENT_KINDS,
  QUARANTINE_UNASSIGNED_OWNER,
  QUARANTINE_LEDGER_MIGRATIONS,
  QuarantineLedgerVersionError,
  guardQuarantineLedgerEvent,
  hasQuarantineEventShape,
} from '../quarantine/quarantine-ledger'
import type {
  QuarantineAppliedEntry,
  QuarantineEntryState,
  QuarantineLadderState,
  QuarantineLedgerEvent,
} from '../quarantine/quarantine-ledger'
import { CURRENT_HANDOFF_SCHEMA_VERSION } from '../handoff/completed-run-handoff'
import type { CompletedRunHandoff } from '../handoff/completed-run-handoff'
import { HANDOFF_MIGRATIONS, guardCompletedRunHandoff } from '../handoff/load-completed-run-handoff'
import type { PerTestOutcome } from '../handoff/per-test-outcome'
import { VERDICT_CLASSES, isVerdictClass } from '../verdict/verdict'
import type { Verdict, VerdictClass } from '../verdict/verdict'
import { VersionGuardError } from '../versioning/create-version-guard'

// ---- Fixtures ------------------------------------------------------------

function enteredEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
    kind: 'entered',
    at: '2026-08-05T10:00:00.000Z',
    product: 'example-web',
    filePath: 'tests/checkout.test.yaml',
    testName: 'checkout completes',
    fingerprint: 'fp-1',
    verdictClass: 'flake',
    owner: QUARANTINE_UNASSIGNED_OWNER,
    expiresAt: '2026-09-04T10:00:00.000Z',
    ...overrides,
  }
}

// ---- The closed event vocabulary (388 C13 — spelled once) ----------------

describe('quarantine ledger event vocabulary', () => {
  it('pins the version at 1 with an empty (registered) migration seam', () => {
    expect(CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION).toBe(1)
    expect(QUARANTINE_LEDGER_MIGRATIONS).toEqual({})
  })

  it('closes the event-kind union over the four lifecycle actions', () => {
    // 'expired' is a COMPUTED state, never an event (D-11) — the event list is
    // append-only lifecycle ACTIONS only.
    expect([...QUARANTINE_EVENT_KINDS]).toEqual([
      'entered',
      'renewed',
      'released-manual',
      'released-auto',
    ])
    expect(QUARANTINE_EVENT_KINDS).not.toContain('expired')
  })

  it('spells the typed unassigned owner literal (D-12 honest absence)', () => {
    expect(QUARANTINE_UNASSIGNED_OWNER).toBe('unassigned')
  })

  it('mints the state vocabulary once — entry states and the ladder states', () => {
    const quarantined: QuarantineEntryState['state'] = 'quarantined'
    const expired: QuarantineEntryState['state'] = 'expired'
    const released: QuarantineEntryState['state'] = 'released'
    expect([quarantined, expired, released]).toEqual(['quarantined', 'expired', 'released'])

    // 'flagged' is detection-layer visibility only — it never appears in the ledger (D-06).
    const ladder: QuarantineLadderState[] = ['flagged', 'quarantined', 'expired']
    expect(ladder).toHaveLength(3)
  })
})

// ---- The canonical verdict-class vocabulary the ledger keys on -----------

describe('verdict class vocabulary', () => {
  it('agrees with the Verdict union it is derived from', () => {
    type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
    const unionsAgree: AssertEqual<VerdictClass, Verdict['class']> = true
    expect(unionsAgree).toBe(true)
    expect([...VERDICT_CLASSES].sort()).toEqual(
      [
        'app_bug',
        'config_error',
        'environment',
        'flake',
        'llm_error',
        'test_bug',
        'timeout',
        'unknown',
      ].sort(),
    )
  })

  it('admits only closed-set members', () => {
    expect(isVerdictClass('flake')).toBe(true)
    expect(isVerdictClass('quarantined')).toBe(false)
    expect(isVerdictClass(3)).toBe(false)
  })
})

// ---- guardQuarantineLedgerEvent ------------------------------------------

describe('guardQuarantineLedgerEvent', () => {
  it('admits a well-formed schemaVersion-1 entered event BY IDENTITY', () => {
    const stored = enteredEvent()
    const admitted = guardQuarantineLedgerEvent(stored)
    expect(admitted).toBe(stored as unknown as QuarantineLedgerEvent)
    expect(admitted.kind).toBe('entered')
    if (admitted.kind !== 'entered') throw new Error('expected an entered event')
    expect(admitted.owner).toBe(QUARANTINE_UNASSIGNED_OWNER)
    expect(admitted.expiresAt).toBe('2026-09-04T10:00:00.000Z')
  })

  it('admits renewed and both released kinds', () => {
    const renewed = guardQuarantineLedgerEvent({
      schemaVersion: 1,
      kind: 'renewed',
      at: '2026-08-06T10:00:00.000Z',
      product: 'example-web',
      filePath: 'tests/checkout.test.yaml',
      testName: 'checkout completes',
      expiresAt: '2026-10-04T10:00:00.000Z',
      owner: 'alice',
    })
    expect(renewed.kind).toBe('renewed')

    for (const kind of ['released-manual', 'released-auto'] as const) {
      const released = guardQuarantineLedgerEvent({
        schemaVersion: 1,
        kind,
        at: '2026-08-07T10:00:00.000Z',
        product: 'example-web',
        filePath: 'tests/checkout.test.yaml',
        testName: 'checkout completes',
      })
      expect(released.kind).toBe(kind)
    }
  })

  it('refuses a value whose kind is outside the closed union', () => {
    expect(() => guardQuarantineLedgerEvent(enteredEvent({ kind: 'evicted' }))).toThrow(TypeError)
    expect(() => guardQuarantineLedgerEvent(enteredEvent({ kind: 'expired' }))).toThrow(TypeError)
  })

  it('refuses a value missing any leg of the stable identity', () => {
    for (const missing of ['product', 'filePath', 'testName'] as const) {
      const broken = enteredEvent()
      delete broken[missing]
      expect(() => guardQuarantineLedgerEvent(broken)).toThrow(TypeError)
    }
    // Empty identity strings are refused too — they would key a phantom entry.
    expect(() => guardQuarantineLedgerEvent(enteredEvent({ testName: '' }))).toThrow(TypeError)
  })

  it('refuses an entered event missing its own required lifecycle fields', () => {
    for (const missing of ['fingerprint', 'verdictClass', 'owner', 'expiresAt'] as const) {
      const broken = enteredEvent()
      delete broken[missing]
      expect(() => guardQuarantineLedgerEvent(broken)).toThrow(TypeError)
    }
    expect(() => guardQuarantineLedgerEvent(enteredEvent({ verdictClass: 'quarantined' }))).toThrow(
      TypeError,
    )
  })

  it('hard-fails a NEWER schemaVersion with the typed ledger version error', () => {
    let thrown: unknown
    try {
      guardQuarantineLedgerEvent(enteredEvent({ schemaVersion: 2 }))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(QuarantineLedgerVersionError)
    expect(thrown).toBeInstanceOf(VersionGuardError)
    const versionError = thrown as QuarantineLedgerVersionError
    expect(versionError.name).toBe('QuarantineLedgerVersionError')
    expect(versionError.documentName).toBe('QuarantineLedgerEvent')
    expect(versionError.foundVersion).toBe(2)
    expect(versionError.supportedVersion).toBe(1)
  })

  it('refuses a line with no numeric schemaVersion at all', () => {
    const broken = enteredEvent()
    delete broken.schemaVersion
    expect(() => guardQuarantineLedgerEvent(broken)).toThrow(TypeError)
  })

  it('exposes the structural check the read path uses ahead of the guard', () => {
    expect(hasQuarantineEventShape(enteredEvent())).toBe(true)
    expect(hasQuarantineEventShape(enteredEvent({ kind: 'evicted' }))).toBe(false)
    expect(hasQuarantineEventShape(null)).toBe(false)
    expect(hasQuarantineEventShape([enteredEvent()])).toBe(false)
  })
})

// ---- The handoff disposition contract (D-14 / D-16) ----------------------

describe('handoff quarantine disposition', () => {
  function handoffFixture(tests: PerTestOutcome[], applied?: QuarantineAppliedEntry[]): unknown {
    return {
      schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
      runId: 'run-1',
      scope: { tier: 'product', key: 'example-web' },
      buildOrdinal: 7,
      executionContext: 'local-headless',
      aggregateVerdict: 'passed',
      configDigests: { suiteConfigDigest: 'a', testConfigDigest: 'b' },
      startedAt: 1,
      endedAt: 2,
      tests,
      ...(applied === undefined ? {} : { quarantineApplied: applied }),
    }
  }

  function memberFixture(overrides: Partial<PerTestOutcome> = {}): PerTestOutcome {
    return {
      testId: 't1',
      testName: 'checkout completes',
      filePath: 'tests/checkout.test.yaml',
      testIndex: 0,
      outcome: 'failed',
      steps: [],
      ...overrides,
    }
  }

  it('bumps the handoff contract to 6 with a registered identity migration from 5', () => {
    expect(CURRENT_HANDOFF_SCHEMA_VERSION).toBe(6)
    expect(typeof HANDOFF_MIGRATIONS[5]).toBe('function')
    const stored = { schemaVersion: 5, marker: true }
    expect(HANDOFF_MIGRATIONS[5](stored)).toBe(stored)
  })

  it('carries the disposition BESIDE a truthful failed outcome', () => {
    const member = memberFixture({ quarantined: true })
    expect(member.outcome).toBe('failed')
    const handoff = guardCompletedRunHandoff(
      handoffFixture([member], [
        {
          product: 'example-web',
          filePath: 'tests/checkout.test.yaml',
          testName: 'checkout completes',
          expiresAt: '2026-09-04T10:00:00.000Z',
        },
      ]),
    ) as CompletedRunHandoff
    expect(handoff.tests[0].quarantined).toBe(true)
    expect(handoff.quarantineApplied).toEqual([
      {
        product: 'example-web',
        filePath: 'tests/checkout.test.yaml',
        testName: 'checkout completes',
        expiresAt: '2026-09-04T10:00:00.000Z',
      },
    ])
  })

  it('keeps absence absent — an unquarantined member has no disposition key', () => {
    const handoff = guardCompletedRunHandoff(handoffFixture([memberFixture()])) as CompletedRunHandoff
    expect('quarantined' in handoff.tests[0]).toBe(false)
    expect('quarantineApplied' in handoff).toBe(false)
  })

  it('refuses a non-literal-true disposition (the excludedFromOutcomes idiom)', () => {
    expect(() =>
      guardCompletedRunHandoff(handoffFixture([memberFixture({ quarantined: false as never })])),
    ).toThrow(TypeError)
  })

  it('refuses a structurally broken applied-entry list', () => {
    expect(() =>
      guardCompletedRunHandoff(
        handoffFixture([memberFixture()], [{ product: 'example-web' } as never]),
      ),
    ).toThrow(TypeError)
    expect(() =>
      guardCompletedRunHandoff(handoffFixture([memberFixture()], {} as never)),
    ).toThrow(TypeError)
  })

  it('loads a stored v5 handoff unchanged through the registered migration', () => {
    const stored = { ...(handoffFixture([memberFixture()]) as Record<string, unknown>), schemaVersion: 5 }
    const loaded = guardCompletedRunHandoff(stored) as CompletedRunHandoff
    expect(loaded.tests[0].quarantined).toBeUndefined()
    expect(loaded.quarantineApplied).toBeUndefined()
  })
})
