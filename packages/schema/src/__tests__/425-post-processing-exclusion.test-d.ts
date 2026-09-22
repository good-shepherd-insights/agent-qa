import { describe, expectTypeOf, test } from 'vitest'
import type { z } from 'zod'

import { POST_PROCESSING_EXCLUSION_REASONS, PostProcessingExclusionSchema } from '../index'
import type {
  PostProcessingChipStatus,
  PostProcessingExclusionReason,
  PostProcessingStatus,
  RunDigestChainOutcomes,
} from '../index'
import type * as Notification from '../notification/index'

type ExactlyEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false

// Independent literal union; the never-bar fails to compile the moment either side grows.
describe('C425-EXCLUSION-REASONS-EXACT', () => {
  test('pins exactly two exclusion reasons in both directions through both barrels', () => {
    const listMatchesUnion: ExactlyEqual<
      (typeof POST_PROCESSING_EXCLUSION_REASONS)[number],
      PostProcessingExclusionReason
    > = true
    expectTypeOf(listMatchesUnion).toEqualTypeOf<true>()
    expectTypeOf<PostProcessingExclusionReason>().toEqualTypeOf<'gate-run' | 'outcome-excluded'>()
    expectTypeOf<(typeof POST_PROCESSING_EXCLUSION_REASONS)[number]>().toEqualTypeOf<
      'gate-run' | 'outcome-excluded'
    >()
    expectTypeOf<
      Exclude<PostProcessingExclusionReason, (typeof POST_PROCESSING_EXCLUSION_REASONS)[number]>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Exclude<(typeof POST_PROCESSING_EXCLUSION_REASONS)[number], PostProcessingExclusionReason>
    >().toEqualTypeOf<never>()
    expectTypeOf<Notification.PostProcessingExclusionReason>().toEqualTypeOf<
      PostProcessingExclusionReason
    >()
    expectTypeOf<z.infer<typeof PostProcessingExclusionSchema>>().toEqualTypeOf<{
      reason: 'gate-run' | 'outcome-excluded'
    }>()
  })

  test('refuses a third reason at the type boundary', () => {
    // @ts-expect-error a third reason is not a member of the closed exclusion set
    const third: PostProcessingExclusionReason = 'excluded'
    expectTypeOf(third).toEqualTypeOf<PostProcessingExclusionReason>()
    expectTypeOf<Extract<PostProcessingExclusionReason, 'excluded'>>().toEqualTypeOf<never>()
  })

  test('rides beside the untouched chip words on both DTOs', () => {
    expectTypeOf<PostProcessingStatus['exclusion']>().toEqualTypeOf<
      { reason: PostProcessingExclusionReason } | undefined
    >()
    expectTypeOf<RunDigestChainOutcomes['exclusion']>().toEqualTypeOf<
      { reason: PostProcessingExclusionReason } | undefined
    >()
    expectTypeOf<PostProcessingChipStatus>().toEqualTypeOf<
      'pending' | 'running' | 'done' | 'failed'
    >()
    expectTypeOf<Extract<PostProcessingChipStatus, 'excluded'>>().toEqualTypeOf<never>()
    expectTypeOf<RunDigestChainOutcomes['analysis']>().toEqualTypeOf<PostProcessingChipStatus>()
  })
})
