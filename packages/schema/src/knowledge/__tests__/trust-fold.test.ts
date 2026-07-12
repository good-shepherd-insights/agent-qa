import { describe, expect, it } from 'vitest'

import {
  BundleOutcomeEventSchema,
  type BundleOutcomeEvent,
  type OriginClass,
} from '../outcome-event'
import {
  EVIDENCE_INCOMPLETE_ALPHA_DISCOUNT,
  ORIGIN_PRIORS,
  SERVING_ATTRIBUTION_WEIGHT,
  foldBundleTrust,
} from '../trust-fold'

function event(
  type: BundleOutcomeEvent['type'],
  token: string,
  buildOrdinal = 1,
  payload: Readonly<Record<string, unknown>> = {},
): BundleOutcomeEvent {
  return BundleOutcomeEventSchema.parse({
    type,
    evidenceToken: token,
    curationJobId: `job-${token}`,
    buildOrdinal,
    ...payload,
  })
}

function fold(
  events: readonly BundleOutcomeEvent[],
  originClass: OriginClass = 'user',
  evidenceIncomplete = false,
) {
  return foldBundleTrust(events, {
    originClass,
    evidenceIncomplete,
    createdAtOrdinal: 5,
  })
}

describe('foldBundleTrust priors and Beta evidence (D-08/D-10)', () => {
  it.each([
    ['user', 3 / 4],
    ['agent-verified', 2 / 3],
    ['agent-observed', 1 / 2],
    ['import', 1 / 3],
  ] as const)('starts %s at its exact clean prior', (originClass, expected) => {
    expect(fold([], originClass).trust).toBeCloseTo(expected)
  })

  it('discounts only prior alpha when evidence is incomplete', () => {
    const state = fold([], 'user', true)
    const discountedAlpha = ORIGIN_PRIORS.user.alpha * EVIDENCE_INCOMPLETE_ALPHA_DISCOUNT

    expect(state.trust).toBeCloseTo(discountedAlpha / (discountedAlpha + ORIGIN_PRIORS.user.beta))
    expect(state.trust).toBeCloseTo(1.5 / 2.5)
  })

  it('folds direct confirmation to alpha and contradiction to beta', () => {
    expect(fold([event('confirmed', 'confirmed')]).trust).toBeCloseTo(4 / 5)
    expect(fold([event('contradicted', 'contradicted')]).trust).toBeCloseTo(3 / 5)
  })

  it('folds helpful and harmful serving attribution at the provisional fractional weight', () => {
    const helpful = fold([event('helpful', 'helpful')])
    const harmful = fold([event('harmful', 'harmful')])

    expect(SERVING_ATTRIBUTION_WEIGHT).toBe(0.25)
    expect(helpful.trust).toBeCloseTo(3.25 / 4.25)
    expect(harmful.trust).toBeCloseTo(3 / 4.25)
    expect(helpful.counters).toEqual({
      confirmed: 0,
      contradicted: 0,
      helpful: 1,
      harmful: 0,
    })
    expect(harmful.counters).toEqual({
      confirmed: 0,
      contradicted: 0,
      helpful: 0,
      harmful: 1,
    })
  })
})

describe('foldBundleTrust replay and merge laws (BNDL-03)', () => {
  it('moves no counter when the same evidence-token and job event is replayed', () => {
    const confirmed = event('confirmed', 'same-evidence')

    expect(fold([confirmed, confirmed])).toEqual(fold([confirmed]))
    expect(fold([confirmed, confirmed]).counters.confirmed).toBe(1)
  })

  it('is idempotent when a complete event set is replayed', () => {
    const events = [
      event('confirmed', 'confirm'),
      event('harmful', 'harm'),
      event('promoted', 'promote', 8),
      event('window-close', 'close', 9, { closedAtOrdinal: 9 }),
    ]

    expect(fold([...events, ...events])).toEqual(fold(events))
  })

  it('is commutative for a shuffled set of distinct events', () => {
    const events = [
      event('confirmed', 'confirm'),
      event('helpful', 'help'),
      event('superseded', 'supersede', 6, { byRecordId: 'record-next' }),
      event('promoted', 'promote', 7),
      event('window-close', 'close', 8, { closedAtOrdinal: 12 }),
    ]

    expect(fold([events[4]!, events[2]!, events[0]!, events[3]!, events[1]!])).toEqual(
      fold(events),
    )
  })
})

describe('foldBundleTrust lifecycle derivation', () => {
  it('defaults to candidate and maps each lifecycle event to its status', () => {
    expect(fold([]).status).toBe('candidate')
    expect(fold([event('superseded', 'superseded', 2, { byRecordId: 'record-next' })]).status)
      .toBe('superseded')
    expect(fold([event('deprecated', 'deprecated', 2, { reason: 'obsolete' })]).status)
      .toBe('deprecated')
    expect(fold([event('promoted', 'promoted', 2)]).status).toBe('active')
  })

  it('lets the latest build ordinal win between conflicting lifecycle events', () => {
    const promoted = event('promoted', 'promoted', 10)
    const deprecated = event('deprecated', 'deprecated', 11, { reason: 'unsafe' })

    expect(fold([deprecated, promoted]).status).toBe('deprecated')
  })

  it('breaks equal-build ties by active over candidate over superseded over deprecated', () => {
    const deprecated = event('deprecated', 'deprecated', 12, { reason: 'obsolete' })
    const superseded = event('superseded', 'superseded', 12, { byRecordId: 'record-next' })
    const promoted = event('promoted', 'promoted', 12)

    expect(fold([deprecated, superseded]).status).toBe('superseded')
    expect(fold([promoted, deprecated, superseded]).status).toBe('active')
  })

  it('opens at creation and closes at the latest window-close ordinal when present', () => {
    expect(fold([]).validity).toEqual({ openedAtOrdinal: 5 })

    const earlier = event('window-close', 'close-earlier', 10, { closedAtOrdinal: 10 })
    const later = event('window-close', 'close-later', 20, { closedAtOrdinal: 20 })

    expect(fold([later, earlier]).validity).toEqual({
      openedAtOrdinal: 5,
      closedAtOrdinal: 20,
    })
  })
})
