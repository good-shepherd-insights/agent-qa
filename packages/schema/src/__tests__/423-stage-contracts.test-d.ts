import { describe, expectTypeOf, test } from 'vitest'
import type { z } from 'zod'

import {
  POST_PROCESSING_CHIP_STATUSES,
  POST_PROCESSING_DETAIL_STAGES,
  PostProcessingStageDetailSchema,
  PostProcessingStatusSchema,
} from '../index'
import type {
  JobConclusionKind,
  PostProcessingChips,
  PostProcessingChipStatus,
  PostProcessingDetailStage,
  PostProcessingStageDetail,
  PostProcessingStatus,
} from '../index'
import type * as Notification from '../notification/index'

// Independent literal unions: neither expected vocabulary is derived from production.
// Plan 423-23 owns the mutation script; C423-STAGES-EXACT is its required RED cell.
describe('C423-STAGES-EXACT', () => {
  test('pins three detail stages in both directions through public exports', () => {
    expectTypeOf<PostProcessingDetailStage>().toEqualTypeOf<'analysis' | 'curation' | 'proposals'>()
    expectTypeOf<(typeof POST_PROCESSING_DETAIL_STAGES)[number]>().toEqualTypeOf<
      'analysis' | 'curation' | 'proposals'
    >()
    expectTypeOf<
      Exclude<PostProcessingDetailStage, (typeof POST_PROCESSING_DETAIL_STAGES)[number]>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Exclude<(typeof POST_PROCESSING_DETAIL_STAGES)[number], PostProcessingDetailStage>
    >().toEqualTypeOf<never>()
    expectTypeOf<Notification.PostProcessingDetailStage>().toEqualTypeOf<PostProcessingDetailStage>()
  })

  test('pins exactly two chip keys and four statuses independently', () => {
    expectTypeOf<keyof PostProcessingChips>().toEqualTypeOf<'analysis' | 'curation'>()
    expectTypeOf<PostProcessingChipStatus>().toEqualTypeOf<'pending' | 'running' | 'done' | 'failed'>()
    expectTypeOf<
      Exclude<PostProcessingChipStatus, (typeof POST_PROCESSING_CHIP_STATUSES)[number]>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Exclude<(typeof POST_PROCESSING_CHIP_STATUSES)[number], PostProcessingChipStatus>
    >().toEqualTypeOf<never>()
    expectTypeOf<PostProcessingChips>().toEqualTypeOf<{
      analysis: 'pending' | 'running' | 'done' | 'failed'
      curation: 'pending' | 'running' | 'done' | 'failed'
    }>()
  })

  test('refuses a fourth stage and third chip at the type boundary', () => {
    expectTypeOf<Extract<PostProcessingDetailStage, 'admission'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<keyof PostProcessingChips, 'proposals'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<PostProcessingChipStatus, 'unknown'>>().toEqualTypeOf<never>()
  })

  test('keeps each stage optional on the DTO and inferred result', () => {
    type Expected = Partial<Record<'analysis' | 'curation' | 'proposals', PostProcessingStageDetail>>
    expectTypeOf<PostProcessingStatus['stageDetails']>().toEqualTypeOf<Expected | undefined>()
    expectTypeOf<z.infer<typeof PostProcessingStatusSchema>>().toEqualTypeOf<PostProcessingStatus>()
    expectTypeOf<keyof NonNullable<PostProcessingStatus['stageDetails']>>().toEqualTypeOf<
      'analysis' | 'curation' | 'proposals'
    >()
  })

  test('carries only the seven optional recorded facts through both barrels', () => {
    expectTypeOf<PostProcessingStageDetail>().toEqualTypeOf<{
      attempts?: number
      createdAt?: string
      claimedAt?: string
      updatedAt?: string
      conclusionKind?: JobConclusionKind
      lastFailureKind?: string
      lastFailureReason?: string
    }>()
    expectTypeOf<z.infer<typeof PostProcessingStageDetailSchema>>().toEqualTypeOf<
      PostProcessingStageDetail
    >()
    expectTypeOf<Notification.PostProcessingStageDetail>().toEqualTypeOf<PostProcessingStageDetail>()
    expectTypeOf<Extract<keyof PostProcessingStageDetail, 'cancelRequestedAt'>>().toEqualTypeOf<never>()
  })
})
