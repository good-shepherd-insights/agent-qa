import { describe, expectTypeOf, test } from 'vitest'
import type { z } from 'zod'

import { RETRIEVAL_RUNG_REASONS, RecordedRetrievalRungSchema } from '../index'
import type { RecordedRetrievalRung, RetrievalRungReason } from '../index'
import type * as Brief from '../brief/index'

// Independent literal unions: neither expected vocabulary is derived from production.
// Plan 423-23 owns the mutation script; C423-RUNG-REASONS-EXACT is its required RED cell.
type HistoricalReason =
  | 'native-runtime-unavailable'
  | 'profile-unresolved'
  | 'low-ram-deferral'
  | 'model-not-downloaded'
  | 'embedder-load-failed'
  | 'index-unavailable'
  | 'floor-disabled'
  | 'profile-static-configured'
type CurrentReason = HistoricalReason | 'index-not-built' | 'index-locked' | 'index-corrupt'
type Rung = 'memidex' | 'bundle-scan' | 'static-floor' | 'lexical-only'

type V1 = Extract<RecordedRetrievalRung, { schemaVersion: 1 }>
type V2 = Extract<RecordedRetrievalRung, { schemaVersion: 2 }>

describe('C423-RUNG-REASONS-EXACT', () => {
  test('pins eleven current reasons in both directions through public exports', () => {
    expectTypeOf<RetrievalRungReason>().toEqualTypeOf<CurrentReason>()
    expectTypeOf<(typeof RETRIEVAL_RUNG_REASONS)[number]>().toEqualTypeOf<CurrentReason>()
    expectTypeOf<
      Exclude<RetrievalRungReason, (typeof RETRIEVAL_RUNG_REASONS)[number]>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Exclude<(typeof RETRIEVAL_RUNG_REASONS)[number], RetrievalRungReason>
    >().toEqualTypeOf<never>()
    expectTypeOf<Brief.RetrievalRungReason>().toEqualTypeOf<RetrievalRungReason>()
  })

  test('pins the historical v1 arm to exactly the eight pre-423 reasons', () => {
    expectTypeOf<NonNullable<V1['reason']>>().toEqualTypeOf<HistoricalReason>()
    expectTypeOf<Extract<NonNullable<V1['reason']>, 'index-not-built'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<NonNullable<V1['reason']>, 'index-locked'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<NonNullable<V1['reason']>, 'index-corrupt'>>().toEqualTypeOf<never>()
  })

  test('pins the current v2 arm to exactly the eleven reasons', () => {
    expectTypeOf<NonNullable<V2['reason']>>().toEqualTypeOf<CurrentReason>()
    expectTypeOf<Extract<NonNullable<V2['reason']>, 'index-missing'>>().toEqualTypeOf<never>()
  })

  test('pins exactly two strict versioned arms over the same four rungs', () => {
    expectTypeOf<RecordedRetrievalRung['schemaVersion']>().toEqualTypeOf<1 | 2>()
    expectTypeOf<V1>().toEqualTypeOf<{
      schemaVersion: 1
      rung: Rung
      reason?: HistoricalReason | undefined
    }>()
    expectTypeOf<V2>().toEqualTypeOf<{
      schemaVersion: 2
      rung: Rung
      reason?: CurrentReason | undefined
    }>()
    expectTypeOf<z.infer<typeof RecordedRetrievalRungSchema>>().toEqualTypeOf<RecordedRetrievalRung>()
    expectTypeOf<Brief.RecordedRetrievalRung>().toEqualTypeOf<RecordedRetrievalRung>()
  })
})
