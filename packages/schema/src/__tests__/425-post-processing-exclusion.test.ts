import { describe, expect, test } from 'vitest'

import {
  POST_PROCESSING_CHIP_STATUSES,
  POST_PROCESSING_EXCLUSION_REASONS,
  PostProcessingExclusionSchema,
  PostProcessingStatusSchema,
  RunDigestChainOutcomesSchema,
} from '../index'
import * as notification from '../notification/index'

const legacy = { runId: 'exclusion-fixture', chips: { analysis: 'pending', curation: 'pending' } }

describe('EXCLUSION-SCHEMA-ROUNDTRIP', () => {
  test('round-trips each reason beside the untouched chip words', () => {
    for (const reason of ['gate-run', 'outcome-excluded']) {
      const payload = { ...legacy, exclusion: { reason } }
      const parsed = PostProcessingStatusSchema.safeParse(payload)
      expect(parsed.success).toBe(true)
      expect(parsed.data).toEqual(payload)
      expect(parsed.data?.chips).toEqual({ analysis: 'pending', curation: 'pending' })
    }
  })

  test('keeps a status without the key parsing equal to itself', () => {
    const parsed = PostProcessingStatusSchema.parse(legacy)
    expect(parsed).toEqual(legacy)
    expect(parsed).not.toHaveProperty('exclusion')
  })

  test.each([
    { exclusion: null },
    { exclusion: { reason: 'invented' } },
    { exclusion: { reason: 'gate-run', extra: 1 } },
    { exclusion: {} },
  ])('rejects an invalid or unowned exclusion fact: %j', (extra) => {
    expect(PostProcessingStatusSchema.safeParse({ ...legacy, ...extra }).success).toBe(false)
  })
})

describe('C425-EXCLUSION-REASONS-EXACT', () => {
  test('pins the reason list to an independent exact vocabulary through both barrels', () => {
    expect(POST_PROCESSING_EXCLUSION_REASONS).toEqual(['gate-run', 'outcome-excluded'])
    expect(POST_PROCESSING_EXCLUSION_REASONS).toHaveLength(2)
    expect(notification.POST_PROCESSING_EXCLUSION_REASONS).toBe(POST_PROCESSING_EXCLUSION_REASONS)
    expect(notification.PostProcessingExclusionSchema).toBe(PostProcessingExclusionSchema)
    expect(Object.keys(PostProcessingExclusionSchema.shape)).toEqual(['reason'])
  })

  test('leaves the four chip words untouched', () => {
    expect(POST_PROCESSING_CHIP_STATUSES).toEqual(['pending', 'running', 'done', 'failed'])
    expect(POST_PROCESSING_CHIP_STATUSES).toHaveLength(4)
  })

  test('accepts each hand-spelled reason and rejects a third reason or an extra key', () => {
    for (const reason of ['gate-run', 'outcome-excluded']) {
      expect(PostProcessingExclusionSchema.safeParse({ reason }).success).toBe(true)
    }
    expect(PostProcessingExclusionSchema.safeParse({ reason: 'excluded' }).success).toBe(false)
    expect(
      PostProcessingExclusionSchema.safeParse({ reason: 'gate-run', detail: 'raw' }).success,
    ).toBe(false)
  })
})

describe('EXCLUSION-ON-DIGEST-CHAIN', () => {
  test('carries the same optional fact on the digest chain outcomes', () => {
    const payload = { analysis: 'pending', curation: 'pending', exclusion: { reason: 'outcome-excluded' } }
    const parsed = RunDigestChainOutcomesSchema.safeParse(payload)
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual(payload)
  })

  test('refuses a fifth chip word on either chain arm', () => {
    for (const chain of [
      { analysis: 'excluded', curation: 'pending' },
      { analysis: 'pending', curation: 'excluded' },
    ]) {
      expect(RunDigestChainOutcomesSchema.safeParse(chain).success).toBe(false)
    }
  })
})
