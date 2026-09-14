// 422-22-T3 — the COMPILE-TIME half of the chain-terminal notification's closed-set oracle.
//
// AN INDEPENDENT ORACLE, NOT A SECOND VIEW of `422-notification-closed-sets.test.ts`. It shares no
// fixture and no helper with the runtime half; the only thing both touch is the module they are
// each measuring.
//
// EVERY SET IS SPELLED OUT AS A LITERAL UNION, and the `Exclude<...>` cells beside each literal
// pin the two directions against the runtime list. `X equals (typeof XS)[number]` on its own is
// not a pin: it is satisfied by any pair that happens to match however both sides change.
//
// THE ASSERTIONS SIT INSIDE `test` BLOCKS ON PURPOSE. A `.test-d.ts` whose assertions are all
// top-level still typechecks, but vitest reports "no tests" for it — and a type oracle with a zero
// counted total is a failure wearing a pass's clothes. Every cell below is counted.
//
// THE ABSENCE IS THE SUBJECT. `stages.proposals` is OPTIONAL, and the type-level claim that
// matters is that it is optional rather than a union with a third status word. Both directions are
// stated: the member may be `undefined`, and the status enum contains nothing that could stand in
// for the historical case.

import { describe, expectTypeOf, test } from 'vitest'

import {
  CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION,
  RUN_NOTIFICATION_OUTCOMES,
  RUN_NOTIFICATION_STAGE_STATUSES,
} from '../notification/run-notification'
import type {
  RunNotification,
  RunNotificationOutcome,
  RunNotificationStages,
  RunNotificationStageStatus,
  RunNotificationVerdictSummary,
} from '../notification/run-notification'
import type { Verdict } from '../verdict/verdict'

describe('the notification record shape', () => {
  test('carries exactly the five top-level members, hand-spelled', () => {
    expectTypeOf<keyof RunNotification>().toEqualTypeOf<
      'schemaVersion' | 'runId' | 'outcome' | 'verdictSummary' | 'stages'
    >()
  })

  test('types its version as the LITERAL current version, not as a number', () => {
    // A record built with last version's shape then fails to typecheck at its CONSTRUCTION site,
    // which is where the mistake is — rather than at a reader that could only report it as
    // corrupt bytes.
    expectTypeOf<RunNotification['schemaVersion']>().toEqualTypeOf<
      typeof CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION
    >()
    expectTypeOf<RunNotification['schemaVersion']>().toEqualTypeOf<4>()
    expectTypeOf<RunNotification['schemaVersion']>().not.toEqualTypeOf<number>()
    expectTypeOf<RunNotification['schemaVersion']>().not.toEqualTypeOf<2>()
  })

  test('keeps its class counts PARTIAL, so an absent class is not a zero', () => {
    // A dense record would make "this class did not occur" and "this build does not know that
    // class yet" the same bytes, and the second is the one a later verdict class introduces.
    expectTypeOf<RunNotificationVerdictSummary['byClass']>().toEqualTypeOf<
      Partial<Record<Verdict['class'], number>>
    >()
    expectTypeOf<RunNotificationVerdictSummary['total']>().toEqualTypeOf<number>()
  })

  test('negative control: the record is not open-ended', () => {
    // @ts-expect-error — the record carries no free text; a reason field would need a masking
    // boundary at every surface that renders this row directly.
    expectTypeOf<RunNotification['reason']>().toEqualTypeOf<string>()
  })
})

describe('the chain outcome vocabulary', () => {
  test('is exactly two words, closed in both directions', () => {
    expectTypeOf<RunNotificationOutcome>().toEqualTypeOf<'done' | 'failed'>()
    expectTypeOf<
      Exclude<RunNotificationOutcome, (typeof RUN_NOTIFICATION_OUTCOMES)[number]>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Exclude<(typeof RUN_NOTIFICATION_OUTCOMES)[number], RunNotificationOutcome>
    >().toEqualTypeOf<never>()
    expectTypeOf<RunNotification['outcome']>().toEqualTypeOf<RunNotificationOutcome>()
  })

  test('bars a word that would make the chain outcome a second verdict on the run', () => {
    // `outcome` is a fact about the CHAIN, not about the run: a failed run whose analysis and
    // curation both succeeded notifies `done`. The run's own verdict is the exit code, frozen
    // long before this record exists, and a third word here would start answering that question
    // a second time, later and more quietly.
    expectTypeOf<Extract<RunNotificationOutcome, 'passed'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<RunNotificationOutcome, 'partial'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<RunNotificationOutcome, 'unknown'>>().toEqualTypeOf<never>()
  })
})

describe('the stage status vocabulary', () => {
  test('is exactly two words, closed in both directions', () => {
    expectTypeOf<RunNotificationStageStatus>().toEqualTypeOf<'done' | 'failed'>()
    expectTypeOf<
      Exclude<RunNotificationStageStatus, (typeof RUN_NOTIFICATION_STAGE_STATUSES)[number]>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Exclude<(typeof RUN_NOTIFICATION_STAGE_STATUSES)[number], RunNotificationStageStatus>
    >().toEqualTypeOf<never>()
  })

  test('has NO word for a stage that was not recorded', () => {
    // THE ONE BAR THIS WHOLE FILE IS FOR. A status is a claim about a stage that RAN. Every row
    // written before v3 belongs to a chain whose third stage did not exist, so the historical
    // case is expressed by the member being MISSING and never by a word — a widened enum would
    // let a migration stamp an invented stage onto every row ever written.
    expectTypeOf<Extract<RunNotificationStageStatus, 'not-recorded'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<RunNotificationStageStatus, 'skipped'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<RunNotificationStageStatus, 'absent'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<RunNotificationStageStatus, 'unknown'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<RunNotificationStageStatus, 'pending'>>().toEqualTypeOf<never>()
  })

  test('is the SAME two words the chain outcome uses, and stays a separate declaration', () => {
    // They agree today and they answer different questions: one is about a stage and one is
    // about the whole chain. Two declarations is what lets either move without the other.
    expectTypeOf<RunNotificationStageStatus>().toEqualTypeOf<RunNotificationOutcome>()
  })

  test('negative control: the status set is non-empty', () => {
    // @ts-expect-error — 'failed' is a real member, so extracting it is not never.
    expectTypeOf<Extract<RunNotificationStageStatus, 'failed'>>().toEqualTypeOf<never>()
  })
})

describe('the stage set', () => {
  test('declares exactly three members, two required and one optional', () => {
    expectTypeOf<keyof RunNotificationStages>().toEqualTypeOf<
      'analysis' | 'curation' | 'proposals'
    >()
    expectTypeOf<
      Extract<Required<RunNotificationStages>['proposals'], undefined>
    >().toEqualTypeOf<never>()
  })

  test('keeps the proposal stage OPTIONAL — absence is the historical fact', () => {
    expectTypeOf<Extract<RunNotificationStages['proposals'], undefined>>().toEqualTypeOf<
      undefined
    >()
    // …while the two stages that always run are not optional. A build that made `analysis`
    // optional would make "the chain did not analyse" indistinguishable from "the row lost a key".
    expectTypeOf<Extract<RunNotificationStages['analysis'], undefined>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<RunNotificationStages['curation'], undefined>>().toEqualTypeOf<never>()
  })

  test('carries counts only where a stage can have them, and never a reason', () => {
    expectTypeOf<RunNotificationStages['analysis']>().toEqualTypeOf<{
      status: RunNotificationStageStatus
    }>()
    expectTypeOf<RunNotificationStages['curation']['curated']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<RunNotificationStages['curation']['deprecated']>().toEqualTypeOf<
      number | undefined
    >()
    expectTypeOf<
      NonNullable<RunNotificationStages['proposals']>['proposed']
    >().toEqualTypeOf<number | undefined>()
    expectTypeOf<
      NonNullable<RunNotificationStages['proposals']>['skipped']
    >().toEqualTypeOf<number | undefined>()
  })

  test('bars a fourth stage under any name the chain might grow one', () => {
    // The chain's tail declares no successor, so a fourth stage is one nothing derives an id for
    // and nothing could ever land the terminal from.
    expectTypeOf<Extract<keyof RunNotificationStages, 'admission'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<keyof RunNotificationStages, 'consolidation'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<keyof RunNotificationStages, 'chat'>>().toEqualTypeOf<never>()
  })

  test('negative control: the proposal stage is optional, not required', () => {
    // @ts-expect-error — the member may be undefined, so it is not the bare stage record.
    expectTypeOf<RunNotificationStages['proposals']>().toEqualTypeOf<{
      status: RunNotificationStageStatus
      proposed?: number
      skipped?: number
    }>()
  })
})
