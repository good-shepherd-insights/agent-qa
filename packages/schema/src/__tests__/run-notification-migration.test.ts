// The `RunNotification` v1 → v2 version walk (Phase 404, D-01 / D-04; 385 D-04's discipline).
//
// WHAT THIS PINS THAT THE SHAPE CELLS CANNOT. `guardRunNotification` is the ONE door every stored
// notification row enters through — both store readers call it — so the narrowing of `stages` from
// three members to two is a change to bytes already sitting in users' `agent-jobs.db`. A suite that
// only exercised freshly-written records would be measuring this build talking to itself, and
// would stay green on the day a shipped row stopped being readable.
//
// THE TWO DIRECTIONS ARE NOT THE SAME CLAIM AND ARE ASSERTED SEPARATELY. Migrate-older says an
// EARLIER contract still reads; reject-newer says a LATER one is refused BY NAME rather than
// guessed at. A guard that did the first without the second would happily hand a surface a record
// whose fields it cannot know the meaning of, which is the failure the version stamp exists for.
//
// MIGRATION IS READ-SIDE AND IN-MEMORY. Nothing is rewritten in place, so the input record must
// come back out of the guard unmodified — pinned below, because "we migrate on read" and "we
// quietly edit the caller's object" are one line apart and only one of them is safe when two
// readers race a writer.
import { describe, expect, it } from 'vitest'

import {
  CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION,
  guardRunNotification,
  RUN_NOTIFICATION_MIGRATIONS,
  RunNotificationSchemaError,
} from '../notification/run-notification'

/** The v1 shape as it was actually written: three stages, the third a structural placeholder. */
function storedV1(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    runId: 'run-404-migration',
    outcome: 'done',
    verdictSummary: { total: 2, byClass: { timeout: 1, unknown: 1 } },
    stages: {
      analysis: { status: 'done' },
      curation: { status: 'done', curated: 3, deprecated: 1 },
      issues: { status: 'reserved' },
    },
  }
}

/** The current shape, written by this build. */
function storedV2(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    runId: 'run-404-migration',
    outcome: 'done',
    verdictSummary: { total: 2, byClass: { timeout: 1, unknown: 1 } },
    stages: {
      analysis: { status: 'done' },
      curation: { status: 'done', curated: 3, deprecated: 1 },
    },
  }
}

describe('guardRunNotification migrates older rows and refuses newer ones (D-01, 385 D-04)', () => {
  it('reads a stored schemaVersion-1 row as a two-stage schemaVersion-2 record', () => {
    const migrated = guardRunNotification(storedV1())

    expect(migrated.schemaVersion).toBe(2)
    // Set-equality on the KEYS, not membership: a migration that merely added nothing would pass a
    // membership check while leaving the member it was written to drop sitting in the record.
    expect(Object.keys(migrated.stages).sort()).toEqual(['analysis', 'curation'])
  })

  it('carries every other field of a v1 row through byte-equal', () => {
    const migrated = guardRunNotification(storedV1())
    const expected = storedV2()

    // Compared whole rather than field by field: a walk that dropped the counts, or re-derived the
    // outcome from the stages it kept, would satisfy any per-field spot check written afterwards.
    expect(JSON.parse(JSON.stringify(migrated))).toEqual(expected)
  })

  it('does NOT mutate the record it was handed — the walk is in-memory, the row is untouched', () => {
    const stored = storedV1()
    const before = JSON.stringify(stored)

    guardRunNotification(stored)

    // The reader hands the guard bytes it parsed out of a sqlite column; a guard that edited them
    // in place would be a writer wearing a reader's name, and two readers racing one writer would
    // see each other's edits.
    expect(JSON.stringify(stored)).toBe(before)
  })

  it('accepts a two-stage schemaVersion-2 record unchanged, with no walk at all', () => {
    const stored = storedV2()

    expect(JSON.parse(JSON.stringify(guardRunNotification(stored)))).toEqual(storedV2())
  })

  it('refuses a schemaVersion-2 record that still carries a third stage, naming the stage set', () => {
    const smuggled = { ...storedV2(), stages: { ...(storedV2().stages as object), extra: {} } }

    // The version stamp alone cannot catch this: the record claims the CURRENT contract, so only
    // the exact-key check stands between a third member and every surface that renders stages.
    expect(() => guardRunNotification(smuggled)).toThrow(RunNotificationSchemaError)
    expect(() => guardRunNotification(smuggled))
      .toThrow(/its stage set is \["analysis","curation","extra"\]/u)
  })

  it('refuses a schemaVersion-3 record BY NAME, naming both 3 and 2', () => {
    const fromTheFuture = { ...storedV2(), schemaVersion: 3 }

    // Both numbers in the message on purpose: "this row is newer than me" is only actionable if
    // the reader is told which build wrote it and which build is reading.
    expect(() => guardRunNotification(fromTheFuture)).toThrow(/declares schemaVersion 3/u)
    expect(() => guardRunNotification(fromTheFuture)).toThrow(/this build reads 2/u)
  })

  it('refuses a schemaVersion-0 row — an older version with no registered step is not a guess', () => {
    // The registry is the whole of what "older" means. A version below the lowest registered step
    // walks nothing and then fails the equality check, which is the same refusal a newer row gets
    // and for the same reason: this build does not know that contract.
    expect(() => guardRunNotification({ ...storedV1(), schemaVersion: 0 }))
      .toThrow(/declares schemaVersion 0/u)
  })

  it('registers exactly the steps needed to walk every older version up to the current one', () => {
    // Read off the constant rather than restated: this is what makes the NEXT bump a one-line
    // addition with a home, instead of a condition somewhere inside the guard.
    expect(Object.keys(RUN_NOTIFICATION_MIGRATIONS).map(Number).sort()).toEqual([1])
    expect(CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION).toBe(2)
  })
})
