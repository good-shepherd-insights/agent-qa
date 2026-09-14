// The `RunNotification` version walk, v1 → v2 → v3 (Phase 404, D-01 / D-04; 422 D-13; 385 D-04).
//
// WHAT THIS PINS THAT THE SHAPE CELLS CANNOT. `guardRunNotification` is the ONE door every stored
// notification row enters through — both store readers call it — so the narrowing of `stages` from
// three members to two, and 422's re-widening with an OPTIONAL third, are changes to bytes already
// sitting in users' `agent-jobs.db`. A suite that only exercised freshly-written records would be
// measuring this build talking to itself, and would stay green on the day a shipped row stopped
// being readable.
//
// THE TWO DIRECTIONS ARE NOT THE SAME CLAIM AND ARE ASSERTED SEPARATELY. Migrate-older says an
// EARLIER contract still reads; reject-newer says a LATER one is refused BY NAME rather than
// guessed at. A guard that did the first without the second would happily hand a surface a record
// whose fields it cannot know the meaning of, which is the failure the version stamp exists for.
//
// THE 422 WIDENING IS THE HONESTY CASE. The third stage is OPTIONAL and its absence MEANS
// something: this row was written by a chain that never recorded a proposal stage. The one thing
// the migration may never do is fill it in — a synthesized `proposals: {status: 'done'}` on a
// historical row would be this build inventing work nobody did, on every row ever written. So the
// walk is asserted to leave the member ABSENT, and the absence is asserted to survive the guard.
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

/** The v2 shape as it shipped: exactly two stages, no proposal stage in the vocabulary at all. */
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

/** The current shape with no proposal stage — what a HALTED chain still writes today. */
function storedV3(): Record<string, unknown> {
  return { ...storedV2(), schemaVersion: 3 }
}

/** The current shape a chain that reached the third stage writes (422 D-13). */
function storedV3WithProposals(): Record<string, unknown> {
  return {
    ...storedV3(),
    stages: {
      analysis: { status: 'done' },
      curation: { status: 'done', curated: 3, deprecated: 1 },
      proposals: { status: 'done', proposed: 2, skipped: 1 },
    },
  }
}

describe('guardRunNotification migrates older rows and refuses newer ones (D-01, 385 D-04)', () => {
  it('reads a stored schemaVersion-1 row as a two-stage schemaVersion-4 record', () => {
    const migrated = guardRunNotification(storedV1())

    expect(migrated.schemaVersion).toBe(4)
    // Set-equality on the KEYS, not membership: a migration that merely added nothing would pass a
    // membership check while leaving the member it was written to drop sitting in the record.
    expect(Object.keys(migrated.stages).sort()).toEqual(['analysis', 'curation'])
  })

  it('carries every other field of a v1 row through byte-equal, three version steps later', () => {
    const migrated = guardRunNotification(storedV1())

    // Compared whole rather than field by field: a walk that dropped the counts, or re-derived the
    // outcome from the stages it kept, would satisfy any per-field spot check written afterwards.
    expect(JSON.parse(JSON.stringify(migrated))).toEqual({ ...storedV3(), schemaVersion: 4 })
  })

  it('never synthesizes a proposal stage onto a historical row', () => {
    // THE honesty cell. Every row written before 422 belongs to a chain that had no third stage,
    // and this build knows nothing about what such a run would have proposed. Absent is the only
    // true answer, and it must survive BOTH walk steps and the direct v2 read alike.
    for (const [label, stored] of [['v1', storedV1()], ['v2', storedV2()]] as const) {
      const migrated = guardRunNotification(stored)
      expect(Object.keys(migrated.stages).sort(), label).toEqual(['analysis', 'curation'])
      expect(migrated.stages.proposals, label).toBeUndefined()
      expect(Object.hasOwn(migrated.stages, 'proposals'), label).toBe(false)
    }
  })

  it('reads a stored schemaVersion-2 row as a schemaVersion-4 record with its counts intact', () => {
    const migrated = guardRunNotification(storedV2())

    expect(JSON.parse(JSON.stringify(migrated))).toEqual({ ...storedV3(), schemaVersion: 4 })
  })

  it('does NOT mutate the record it was handed — the walk is in-memory, the row is untouched', () => {
    const stored = storedV1()
    const before = JSON.stringify(stored)

    guardRunNotification(stored)

    // The reader hands the guard bytes it parsed out of a sqlite column; a guard that edited them
    // in place would be a writer wearing a reader's name, and two readers racing one writer would
    // see each other's edits.
    expect(JSON.stringify(stored)).toBe(before)

    const storedTwo = storedV2()
    const beforeTwo = JSON.stringify(storedTwo)
    guardRunNotification(storedTwo)
    expect(JSON.stringify(storedTwo)).toBe(beforeTwo)
  })

  it('accepts a current record with and without its proposal stage, unchanged', () => {
    for (const historic of [storedV3(), storedV3WithProposals()]) {
      const current = { ...historic, schemaVersion: 4 }
      expect(JSON.parse(JSON.stringify(guardRunNotification(current)))).toEqual(current)
      expect(JSON.parse(JSON.stringify(guardRunNotification(historic)))).toEqual(current)
    }
  })

  it('refuses a current record carrying a stage outside the declared three, naming the set', () => {
    const smuggled = {
      ...storedV3(),
      stages: { ...(storedV3().stages as object), extra: {} },
    }

    // The version stamp alone cannot catch this: the record claims the CURRENT contract, so only
    // the exact-key check stands between an undeclared member and every surface that renders
    // stages. The optional third member widened the ALLOWED sets to two, never to "anything".
    expect(() => guardRunNotification(smuggled)).toThrow(RunNotificationSchemaError)
    expect(() => guardRunNotification(smuggled))
      .toThrow(/its stage set is \["analysis","curation","extra"\]/u)
  })

  it('refuses a malformed proposal stage rather than rendering it', () => {
    const noStatus = {
      ...storedV3(),
      stages: { ...(storedV3().stages as object), proposals: { proposed: 1 } },
    }
    expect(() => guardRunNotification(noStatus))
      .toThrow(/its proposal stage reports no outcome/u)

    const badCount = {
      ...storedV3(),
      stages: { ...(storedV3().stages as object), proposals: { status: 'done', proposed: -1 } },
    }
    expect(() => guardRunNotification(badCount)).toThrow(/its proposed count is not a count/u)

    const fractional = {
      ...storedV3(),
      stages: { ...(storedV3().stages as object), proposals: { status: 'done', skipped: 1.5 } },
    }
    expect(() => guardRunNotification(fractional)).toThrow(/its skipped count is not a count/u)
  })

  it('refuses a schemaVersion-5 record BY NAME, naming both 5 and 4', () => {
    const fromTheFuture = { ...storedV3(), schemaVersion: 5 }

    // Both numbers in the message on purpose: "this row is newer than me" is only actionable if
    // the reader is told which build wrote it and which build is reading.
    expect(() => guardRunNotification(fromTheFuture)).toThrow(/declares schemaVersion 5/u)
    expect(() => guardRunNotification(fromTheFuture)).toThrow(/this build reads 4/u)
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
    expect(Object.keys(RUN_NOTIFICATION_MIGRATIONS).map(Number).sort()).toEqual([1, 2, 3])
    expect(CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION).toBe(4)
  })
})
