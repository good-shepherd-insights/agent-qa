/**
 * 422-22-T3 — the RUNTIME half of the chain-terminal notification's closed-set oracle.
 *
 * WHAT THE NOTIFICATION RECORD IS. One row per run, written inside the transaction that lands the
 * LAST job the post-run chain enqueued, and rendered directly by the chat surface and the
 * dashboard. Its vocabulary is therefore persisted AND published, and its stage set carries an
 * OPTIONAL third member.
 *
 * THE ONE FAILURE THIS FILE EXISTS TO PREVENT. Absence of `stages.proposals` means NOT RECORDED —
 * true of every chain that halted at a permanently failed fold. The temptation at every later edit
 * is to make that case a WORD: a third stage status, or a step that fills the member in. Either one
 * would have this build assert that a stage ran which did not. So the cells below pin the status
 * enum at two words in both directions AND drive a record without the member through the guard to
 * show it comes out ABSENT rather than invented.
 *
 * AND IT MUST NOT ACCEPT ANOTHER STAMP. The guard checks the CURRENT shape and stamp in full, and a
 * row stamped otherwise would mean a reader is rendering a contract it does not understand.
 *
 * EVERY EXPECTATION IS HAND-SPELLED. Not one cell builds its expected set from the production
 * constant it measures. The compile-time half is `422-notification-closed-sets.test-d.ts`, which
 * shares no fixture with this file.
 */
import { describe, expect, it } from 'vitest'

import {
  CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION,
  guardRunNotification,
  RUN_NOTIFICATION_FIELD_KEYS,
  RUN_NOTIFICATION_MIGRATIONS,
  RUN_NOTIFICATION_OUTCOMES,
  RUN_NOTIFICATION_STAGE_KEY_SETS,
  RUN_NOTIFICATION_STAGE_STATUSES,
  RunNotificationSchemaError,
} from '../notification/run-notification'
import { CURRENT_HANDOFF_SCHEMA_VERSION } from '../handoff/completed-run-handoff'
import { CURRENT_ANALYSIS_SCHEMA_VERSION } from '../verdict/analysis-artifact'

// ---------------------------------------------------------------------------------------
// The independent spellings, typed out from the D-13/D-15 decisions. `readonly string[]`
// rather than `as const`, so the comparison stays a run-time one between two independently
// authored lists of plain strings.
// ---------------------------------------------------------------------------------------

const EXPECTED_OUTCOMES: readonly string[] = ['done', 'failed']
const EXPECTED_STAGE_STATUSES: readonly string[] = ['done', 'failed']
const EXPECTED_STAGE_KEY_SETS: readonly string[] = [
  'analysis,curation',
  'analysis,curation,proposals',
]
const EXPECTED_FIELD_KEYS = 'outcome,runId,schemaVersion,stages,verdictSummary'

/** A complete, current-shape record. Assembled field by field rather than projected. */
function currentRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    runId: 'run-422-22',
    outcome: 'done',
    verdictSummary: { total: 2, byClass: { unknown: 1, timeout: 1 } },
    stages: {
      analysis: { status: 'done' },
      curation: { status: 'done', curated: 4, deprecated: 2 },
      proposals: { status: 'done', proposed: 3, skipped: 1 },
    },
    ...overrides,
  }
}

describe('422-22 the notification version', () => {
  it('is exactly 2, and is what the guard hands back for every readable row', () => {
    expect(CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION).toBe(2)
    expect(guardRunNotification(currentRecord()).schemaVersion).toBe(2)
  })

  it('declares no migration step', () => {
    expect(Object.keys(RUN_NOTIFICATION_MIGRATIONS)).toEqual([])
  })

  it('REFUSES a row stamped older than this build reads', () => {
    expect(() => guardRunNotification(currentRecord({ schemaVersion: 1 }))).toThrow(
      RunNotificationSchemaError,
    )
  })

  it('REFUSES a row stamped newer than this build reads', () => {
    // Guessing at a later contract is how a reader renders a field it does not understand.
    expect(() => guardRunNotification(currentRecord({ schemaVersion: 5 }))).toThrow(
      RunNotificationSchemaError,
    )
  })
})

describe('422-22 the notification vocabularies', () => {
  it('carries exactly two chain outcomes', () => {
    expect([...RUN_NOTIFICATION_OUTCOMES]).toEqual([...EXPECTED_OUTCOMES])
    expect([...RUN_NOTIFICATION_OUTCOMES].sort()).toEqual([...EXPECTED_OUTCOMES].sort())
  })

  it('carries exactly two stage statuses, and NO word for a stage that was not recorded', () => {
    expect([...RUN_NOTIFICATION_STAGE_STATUSES]).toEqual([...EXPECTED_STAGE_STATUSES])
    // The near-misses a later plan would reach for. Every one of them is a claim about a stage
    // that RAN, and the historical case is a stage that did not exist.
    for (const word of ['not-recorded', 'skipped', 'unknown', 'pending', 'absent']) {
      expect([...RUN_NOTIFICATION_STAGE_STATUSES]).not.toContain(word)
    }
  })

  it('admits exactly two stage key sets — never "the declared ones plus anything"', () => {
    expect([...RUN_NOTIFICATION_STAGE_KEY_SETS]).toEqual([...EXPECTED_STAGE_KEY_SETS])
    expect(RUN_NOTIFICATION_FIELD_KEYS).toBe(EXPECTED_FIELD_KEYS)
  })

  it('refuses every status outside the two, at the public guard', () => {
    for (const bad of ['not-recorded', 'skipped', 'DONE', '', 'done ']) {
      expect(() =>
        guardRunNotification(
          currentRecord({
            stages: {
              analysis: { status: 'done' },
              curation: { status: bad },
              proposals: { status: 'done' },
            },
          }),
        ),
      ).toThrow(RunNotificationSchemaError)
    }
    expect(() => guardRunNotification(currentRecord({ outcome: 'partial' }))).toThrow(
      RunNotificationSchemaError,
    )
  })

  it('refuses a stage key set outside the two, in both directions', () => {
    // A stage the record does not declare, added beside the three that it does.
    expect(() =>
      guardRunNotification(
        currentRecord({
          stages: {
            analysis: { status: 'done' },
            curation: { status: 'done' },
            proposals: { status: 'done' },
            admission: { status: 'done' },
          },
        }),
      ),
    ).toThrow(RunNotificationSchemaError)
    // And a stage the record REQUIRES, dropped.
    expect(() =>
      guardRunNotification(currentRecord({ stages: { analysis: { status: 'done' } } })),
    ).toThrow(RunNotificationSchemaError)
    // A field beside the five the record carries is refused for the same reason.
    expect(() => guardRunNotification(currentRecord({ note: 'anything' }))).toThrow(
      RunNotificationSchemaError,
    )
  })
})

describe('422-22 historical absence is a representation, not an invented stage', () => {
  it('reads a record with no proposal stage and invents none', () => {
    const read = guardRunNotification(
      currentRecord({
        stages: {
          analysis: { status: 'failed' },
          curation: { status: 'failed' },
        },
      }),
    )
    expect(Object.keys(read.stages).sort()).toEqual(['analysis', 'curation'])
    expect('proposals' in read.stages).toBe(false)
    expect(read.stages.proposals).toBeUndefined()
    expect(read.stages.curation.curated).toBeUndefined()
  })

  it('refuses a malformed PRESENT proposal stage rather than rendering it', () => {
    // Absent needs no validation; a present stage is drawn, so a broken one is refused here
    // rather than handed to a surface that would print `undefined`.
    for (const proposals of [
      { status: 'partial' },
      { status: 'done', proposed: -1 },
      { status: 'done', skipped: 1.5 },
      'done',
      null,
    ]) {
      expect(() =>
        guardRunNotification(
          currentRecord({
            stages: {
              analysis: { status: 'done' },
              curation: { status: 'done' },
              proposals,
            },
          }),
        ),
      ).toThrow(RunNotificationSchemaError)
    }
  })

  it('keeps a recorded proposal stage exactly as it was written', () => {
    const record = guardRunNotification(currentRecord())
    expect(record.stages.proposals).toEqual({ status: 'done', proposed: 3, skipped: 1 })
    // A stage that ran and recorded no counts is distinct from one that recorded zeros.
    const countless = guardRunNotification(
      currentRecord({
        stages: {
          analysis: { status: 'done' },
          curation: { status: 'done' },
          proposals: { status: 'done' },
        },
      }),
    )
    expect(countless.stages.proposals).toEqual({ status: 'done' })
    expect(countless.stages.proposals?.proposed).toBeUndefined()
  })
})

describe('422-22 the persisted versions this plan did NOT move', () => {
  it('leaves the handoff at 2 and the analysis artifact at 1', () => {
    // 422 carried circularity evidence across four persisted boundaries with no version bump,
    // because every member is optional-additive inside a block no historical document carries.
    // A bump owes every historical row a migration, and the only honest one here is the identity.
    expect(CURRENT_HANDOFF_SCHEMA_VERSION).toBe(2)
    expect(CURRENT_ANALYSIS_SCHEMA_VERSION).toBe(1)
  })
})
