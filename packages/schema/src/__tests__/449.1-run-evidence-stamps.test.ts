import { describe, expect, it } from 'vitest'

import {
  LosslessServedBriefError,
  RETRIEVAL_TRACE_SCHEMA_VERSION,
  SERVED_BRIEF_PROOF_SCHEMA_VERSION,
  ServedRetrievalTraceV1Schema,
  computeBriefDigest,
  guardLosslessServedBrief,
  sha256hex,
} from '../index'
import type { LosslessServedBrief } from '../index'

function losslessBrief(stamp: number): LosslessServedBrief {
  const contextTier = 'Current test: checkout'
  const volatileTier = 'Current date: 2026-07-24'
  const brief = {
    scope: { tier: 'test', key: 'checkout-flow' },
    asOfBuild: 7,
    budget: 3,
    truncation: 'none',
    channel1: [],
    channel2: [],
    channel3: [],
    briefDigest: '',
    proof: {
      schemaVersion: stamp,
      completeness: 'lossless',
      recordCap: 8,
      combinedBudget: 512,
      admissionEvents: [],
      promptTurns: [{
        ordinal: 0,
        turnOrdinal: 0,
        runDate: '2026-07-24',
        policyL0: '',
        learnedL1: '',
        learnedL2: '',
        contextTier,
        volatileTier,
        policyDigest: sha256hex(''),
        contextTierDigest: sha256hex(contextTier),
        volatileTierDigest: sha256hex(volatileTier),
      }],
    },
  } as unknown as LosslessServedBrief
  return { ...brief, briefDigest: computeBriefDigest(brief) }
}

function trace(stamp: number): unknown {
  return {
    schemaVersion: stamp,
    servedLines: [{ recordId: 'rec-checkout', leg: 'lexical', rank: 1, score: 0.5 }],
    truncated: [],
  }
}

describe('run evidence stamps', () => {
  it('stamps the served-brief proof and the retrieval trace 2', () => {
    expect(SERVED_BRIEF_PROOF_SCHEMA_VERSION).toBe(2)
    expect(RETRIEVAL_TRACE_SCHEMA_VERSION).toBe(2)
  })

  it('reads a lossless proof at its schema version', () => {
    const brief = losslessBrief(SERVED_BRIEF_PROOF_SCHEMA_VERSION)
    expect(guardLosslessServedBrief(brief)).toEqual(brief)
  })

  it.each([1, 3])('refuses a lossless proof stamped %i', (stamp) => {
    const brief = losslessBrief(stamp)
    let caught: unknown
    try {
      guardLosslessServedBrief(brief)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(LosslessServedBriefError)
    expect((caught as LosslessServedBriefError).paths).toContain('proof.schemaVersion')
  })

  it('reads a retrieval trace at its schema version', () => {
    expect(ServedRetrievalTraceV1Schema.parse(trace(RETRIEVAL_TRACE_SCHEMA_VERSION)))
      .toEqual(trace(RETRIEVAL_TRACE_SCHEMA_VERSION))
  })

  it.each([1, 3])('refuses a retrieval trace stamped %i', (stamp) => {
    expect(ServedRetrievalTraceV1Schema.safeParse(trace(stamp)).success).toBe(false)
  })
})
