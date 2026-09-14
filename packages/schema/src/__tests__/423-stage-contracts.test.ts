import { describe, expect, test } from 'vitest'

import {
  POST_PROCESSING_CHIP_STATUSES,
  POST_PROCESSING_DETAIL_STAGES,
  PostProcessingStageDetailSchema,
  PostProcessingStatusSchema,
} from '../index'
import * as notification from '../notification/index'

const legacy = { runId: 'stage-contract-fixture', chips: { analysis: 'done', curation: 'pending' } }

describe('STAGE-DETAIL-OPTIONAL', () => {
  test('parses all three recorded stage details through the public result schema', () => {
    const payload = {
      ...legacy,
      stageDetails: {
        analysis: {
          attempts: 1,
          createdAt: '2026-09-14T00:00:00Z',
          updatedAt: '2026-09-14T00:01:00Z',
          conclusionKind: 'no_issue',
        },
        curation: { attempts: 0 },
        proposals: {
          attempts: 2,
          claimedAt: '2026-09-14T00:02:00Z',
          lastFailureKind: 'retryable',
          lastFailureReason: 'Synthetic masked failure',
        },
      },
    }
    const parsed = PostProcessingStatusSchema.safeParse(payload)
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual(payload)
  })

  test('keeps historical absence and partial recorded facts without defaults', () => {
    expect(PostProcessingStatusSchema.parse(legacy)).toEqual(legacy)
    const payload = { ...legacy, stageDetails: { analysis: { attempts: 0 } } }
    const parsed = PostProcessingStatusSchema.safeParse(payload)
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual(payload)
  })

  test.each([
    { stageDetails: null },
    { stageDetails: { analysis: null } },
    { stageDetails: { analysis: { attempts: -1 } } },
    { stageDetails: { analysis: { attempts: 1.5 } } },
    { stageDetails: { analysis: { claimedAt: null } } },
    { stageDetails: { analysis: { conclusionKind: 'invented' } } },
    { stageDetails: { analysis: { cancelRequestedAt: '2026-09-14T00:00:00Z' } } },
    { stageDetails: { analysis: { unexpected: true } } },
  ])('rejects invalid or unowned detail facts: %j', (extra) => {
    expect(PostProcessingStatusSchema.safeParse({ ...legacy, ...extra }).success).toBe(false)
  })
})

describe('C423-STAGES-EXACT', () => {
  // Plan 423-23 owns the mutation script; this is its required named RED cell.
  test('pins the public detail list and schema to independent exact vocabularies', () => {
    expect(POST_PROCESSING_DETAIL_STAGES).toEqual(['analysis', 'curation', 'proposals'])
    expect(notification.POST_PROCESSING_DETAIL_STAGES).toBe(POST_PROCESSING_DETAIL_STAGES)
    expect(notification.PostProcessingStageDetailSchema).toBe(PostProcessingStageDetailSchema)
    expect(Object.keys(PostProcessingStageDetailSchema.shape)).toEqual([
      'attempts',
      'createdAt',
      'claimedAt',
      'updatedAt',
      'conclusionKind',
      'lastFailureKind',
      'lastFailureReason',
    ])
    expect(PostProcessingStageDetailSchema.parse({})).toEqual({})
    expect(
      PostProcessingStageDetailSchema.safeParse({ cancelRequestedAt: 'recorded' }).success,
    ).toBe(false)
  })

  test('accepts the hand-spelled three detail stages and rejects a fourth', () => {
    for (const stage of ['analysis', 'curation', 'proposals']) {
      expect(
        PostProcessingStatusSchema.safeParse({ ...legacy, stageDetails: { [stage]: {} } }).success,
      ).toBe(true)
    }
    expect(
      PostProcessingStatusSchema.safeParse({ ...legacy, stageDetails: { admission: {} } }).success,
    ).toBe(false)
  })

  test('keeps exactly two required chips with exactly four statuses', () => {
    expect(POST_PROCESSING_CHIP_STATUSES).toEqual(['pending', 'running', 'done', 'failed'])
    expect(Object.keys(PostProcessingStatusSchema.shape.chips.shape)).toEqual([
      'analysis',
      'curation',
    ])
    for (const status of ['pending', 'running', 'done', 'failed']) {
      expect(
        PostProcessingStatusSchema.safeParse({
          ...legacy,
          chips: { analysis: status, curation: status },
        }).success,
      ).toBe(true)
    }
    for (const chips of [
      { analysis: 'done' },
      { analysis: 'done', curation: 'unknown' },
      { ...legacy.chips, proposals: 'done' },
    ]) {
      expect(PostProcessingStatusSchema.safeParse({ ...legacy, chips }).success).toBe(false)
    }
  })
})
