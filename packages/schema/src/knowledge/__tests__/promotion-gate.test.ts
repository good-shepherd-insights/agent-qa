import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { asEvidenceToken } from '../../ids/record-id'
import { distilledObservationSchema } from '../distilled-observation'
import {
  evaluatePromotionGate,
  type PromotionGateHoldReason,
  type PromotionGateInput,
} from '../promotion-gate'

const submitAnchor = {
  t: 'el' as const,
  role: 'button',
  name: 'submit order',
  ordinal: 0,
}

function factInput(overrides: Partial<PromotionGateInput> = {}): PromotionGateInput {
  return {
    kind: 'fact',
    subtype: 'selector',
    status: 'candidate',
    validityOpen: true,
    anchors: [submitAnchor, { t: 'platform', platform: 'web' }],
    originClass: 'agent-verified',
    withheld: false,
    needsEnrichment: false,
    evidenceIncomplete: false,
    distilledObservations: [
      { element: { naturalKey: 'button:submit order:0' } },
    ],
    confirmedOutcomeEvidenceTokens: [asEvidenceToken('confirmed-submit-order')],
    hasUserDeprecateInLineage: false,
    memoryOffForAnchorGroup: false,
    ...overrides,
  }
}

function cautionInput(overrides: Partial<PromotionGateInput> = {}): PromotionGateInput {
  return {
    kind: 'caution',
    status: 'candidate',
    validityOpen: true,
    anchors: [{ t: 'error', message: 'checkout timed out' }],
    originClass: 'agent-verified',
    withheld: false,
    needsEnrichment: false,
    evidenceIncomplete: false,
    distilledObservations: [
      {
        error: {
          naturalKey: 'checkout timed out',
          rootCauseClass: 'environment',
        },
      },
    ],
    confirmedOutcomeEvidenceTokens: [asEvidenceToken('confirmed-checkout-caution')],
    hasUserDeprecateInLineage: false,
    memoryOffForAnchorGroup: false,
    ...overrides,
  }
}

describe('evaluatePromotionGate fact evidence (D-16/D-18)', () => {
  it('promotes a candidate fact with an open window and matching element evidence', () => {
    expect(evaluatePromotionGate(factInput())).toEqual({ verdict: 'promote' })
  })

  it('promotes a navigational fact whose page primary is backed by a matching element', () => {
    expect(evaluatePromotionGate(factInput({
      subtype: 'navigational',
      anchors: [
        { t: 'page', route: '/confirmation' },
        submitAnchor,
        { t: 'platform', platform: 'web' },
      ],
    }))).toEqual({ verdict: 'promote' })
  })

  it('holds a fact until a surviving confirmed outcome supplies V4 evidence', () => {
    expect(evaluatePromotionGate(factInput({ confirmedOutcomeEvidenceTokens: [] }))).toEqual({
      verdict: 'hold',
      reason: 'no-confirmed-evidence',
    })
  })

  it('holds ambiguous multi-element evidence instead of accepting one matching element', () => {
    expect(evaluatePromotionGate(factInput({
      distilledObservations: [
        { element: { naturalKey: 'button:submit order:0' } },
        { element: { naturalKey: 'button:cancel order:1' } },
      ],
    }))).toEqual({
      verdict: 'hold',
      reason: 'no-element-observation',
    })
  })

  it('keys on evidence rather than authorship path while holding bare fallback Adds', () => {
    expect(evaluatePromotionGate(factInput({ originClass: 'agent-observed' })))
      .toEqual({ verdict: 'promote' })
    expect(evaluatePromotionGate(factInput({
      originClass: 'agent-observed',
      needsEnrichment: true,
    }))).toEqual({ verdict: 'hold', reason: 'needs-enrichment' })
  })
})

describe('evaluatePromotionGate caution evidence (T-379-07)', () => {
  it('promotes only a caution with a typed learnable root-cause class', () => {
    expect(evaluatePromotionGate(cautionInput())).toEqual({ verdict: 'promote' })

    expect(evaluatePromotionGate(cautionInput({
      distilledObservations: [
        { error: { naturalKey: 'environment: checkout timed out' } },
      ],
    }))).toEqual({ verdict: 'hold', reason: 'missing-root-cause' })
  })

  it('round-trips rootCauseClass as additive identity-bearing observation evidence', () => {
    const observation = {
      schemaVersion: 1,
      step: { naturalKey: 'checkout', ordinal: 0 },
      error: {
        naturalKey: 'checkout timed out',
        rootCauseClass: 'timeout' as const,
      },
      observedAtOrdinal: 42,
    }

    expect(distilledObservationSchema.parse(observation)).toEqual(observation)
    expect(distilledObservationSchema.safeParse({
      ...observation,
      error: { ...observation.error, rootCauseClass: 'app-bug' },
    }).success).toBe(false)
  })
})

describe('evaluatePromotionGate exclusion walls', () => {
  it.each(['procedure', 'policy', 'unknown'] as const)(
    'holds kind %s before considering otherwise-complete evidence',
    (kind) => {
      expect(evaluatePromotionGate(factInput({ kind }))).toEqual({
        verdict: 'hold',
        reason: 'kind-excluded',
      })
    },
  )

  const exclusionCases: ReadonlyArray<[
    name: string,
    override: Partial<PromotionGateInput>,
    reason: PromotionGateHoldReason,
  ]> = [
    ['non-candidate status', { status: 'active' }, 'not-candidate'],
    ['closed validity window', { validityOpen: false }, 'window-closed'],
    ['withheld provenance', { withheld: true }, 'withheld'],
    ['needs-enrichment provenance', { needsEnrichment: true }, 'needs-enrichment'],
    ['incomplete evidence', { evidenceIncomplete: true }, 'evidence-incomplete'],
    ['memory-off anchor group', { memoryOffForAnchorGroup: true }, 'memory-off-anchor'],
    ['user-deprecated lineage', { hasUserDeprecateInLineage: true }, 'user-deprecated'],
  ]

  it.each(exclusionCases)('holds %s with its typed reason', (_name, override, reason) => {
    expect(evaluatePromotionGate(factInput(override))).toEqual({ verdict: 'hold', reason })
  })

  it('holds bridge-style facts whose synthetic payload has no element observation', () => {
    expect(evaluatePromotionGate(factInput({ distilledObservations: [] }))).toEqual({
      verdict: 'hold',
      reason: 'no-element-observation',
    })
  })
})

describe('promotion gate architecture', () => {
  it('has no model, port, provider, or adapter import path', () => {
    const source = readFileSync(new URL('../promotion-gate.ts', import.meta.url), 'utf8')

    expect(source).not.toMatch(
      /from\s+['"][^'"]*(?:model|port|provider|adapter)[^'"]*['"]/i,
    )
  })
})
