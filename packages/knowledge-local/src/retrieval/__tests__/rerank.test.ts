import {
  asEvidenceToken,
  COLD_START_TRUST_DISCOUNT,
  type Anchor,
  type VettedCandidateInput,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import {
  applyLifecycleTrustTreatments,
  rerankPrecedence,
  UNCONFIRMED_DOWNRANK_FACTOR,
} from '../rerank.js'
import type { RerankEntry } from '../rerank.js'

const anchor: Anchor = { t: 'el', role: 'button', name: 'Submit order' }

function vettedCandidate(
  overrides: Partial<VettedCandidateInput> = {},
): VettedCandidateInput {
  return {
    kind: 'fact',
    subtype: 'selector',
    status: 'candidate',
    validityOpen: true,
    anchors: [anchor],
    originClass: 'agent-verified',
    withheld: false,
    needsEnrichment: false,
    evidenceIncomplete: false,
    confirmedOutcomeEvidenceTokens: [asEvidenceToken('confirmed-token')],
    hasUserDeprecateInLineage: false,
    memoryOffForAnchorGroup: false,
    ...overrides,
  }
}

function entry(
  bundleId: string,
  overrides: Partial<RerankEntry> = {},
): RerankEntry {
  return {
    bundleId,
    validityClass: 'current',
    trust: 1,
    scope: { tier: 'test', key: 'test:checkout' },
    recencyOrdinal: 16,
    createdAtOrdinal: 10,
    originClass: 'agent',
    anchors: [anchor],
    subtype: 'selector',
    lastConfirmedOrdinal: 10,
    ...overrides,
  }
}

describe('read-side lifecycle trust treatments (379 D-05/D-06/D-20)', () => {
  it('dampens a six-build confirmation gap without crossing the validity wall', () => {
    const treated = applyLifecycleTrustTreatments([
      entry('r_stale'),
      entry('r_recent', { trust: 0.8, lastConfirmedOrdinal: 16 }),
      entry('r_prior', {
        validityClass: 'priorBuildHypothesis',
        trust: 100,
        lastConfirmedOrdinal: 16,
      }),
    ], 16)

    expect(treated.find(({ bundleId }) => bundleId === 'r_stale')).toMatchObject({
      trust: UNCONFIRMED_DOWNRANK_FACTOR,
      unconfirmedSinceOrdinal: 10,
    })
    expect(rerankPrecedence(treated).map(({ bundleId }) => bundleId)).toEqual([
      'r_recent',
      'r_stale',
      'r_prior',
    ])
  })

  it('uses the shorter volatile window for measurement facts', () => {
    const treated = applyLifecycleTrustTreatments([
      entry('r_measurement', { subtype: 'measurement', lastConfirmedOrdinal: 12 }),
      entry('r_durable', { subtype: 'selector', lastConfirmedOrdinal: 12 }),
    ], 16)

    expect(treated).toEqual([
      expect.objectContaining({
        bundleId: 'r_measurement',
        trust: UNCONFIRMED_DOWNRANK_FACTOR,
        unconfirmedSinceOrdinal: 12,
      }),
      expect.objectContaining({ bundleId: 'r_durable', trust: 1 }),
    ])
    expect(treated[1]).not.toHaveProperty('unconfirmedSinceOrdinal')
  })

  it('exempts sovereign user records from every autonomous decay window', () => {
    const [treated] = applyLifecycleTrustTreatments([
      entry('r_user', {
        originClass: 'user',
        lastConfirmedOrdinal: -4,
      }),
    ], 16)

    expect(treated).toMatchObject({ trust: 1 })
    expect(treated).not.toHaveProperty('unconfirmedSinceOrdinal')
  })

  it('never filters an over-window entry', () => {
    const treated = applyLifecycleTrustTreatments([
      entry('r_stale', { lastConfirmedOrdinal: 1 }),
      entry('r_recent', { lastConfirmedOrdinal: 16 }),
    ], 16)

    expect(treated.map(({ bundleId }) => bundleId)).toEqual(['r_stale', 'r_recent'])
  })

  it('discounts only candidates admitted by the canonical vetted predicate', () => {
    const treated = applyLifecycleTrustTreatments([
      entry('r_candidate', {
        lastConfirmedOrdinal: 16,
        vettedCandidateInput: vettedCandidate(),
      }),
      entry('r_active', { lastConfirmedOrdinal: 16 }),
    ], 16)

    expect(treated[0]).toMatchObject({
      trust: COLD_START_TRUST_DISCOUNT,
      unverified: true,
    })
    expect(rerankPrecedence(treated).map(({ bundleId }) => bundleId)).toEqual([
      'r_active',
      'r_candidate',
    ])
  })
})
