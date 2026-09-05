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

/**
 * 414 D-14. The gate learns ONE new fact about the world: whether a replay gate exists on this
 * host and, if it does, whether the candidate has a separable gate set left after provenance
 * exclusion (spec/v2/memory.md §12.4(d)). Absent posture means "no replay gate exists here" —
 * the v51 BYOM floor of §12.2 — and must stay byte-identical, which is why the byte-identity
 * cells below loop EVERY input shape the pre-414 cells in this file build rather than spot-check
 * the base builder.
 */
const emptyGateSetPosture = {
  replayGateAvailable: true,
  gateSetNonEmpty: false,
} as const

const factVariants: ReadonlyArray<[name: string, override: Partial<PromotionGateInput>]> = [
  ['base promoting fact', {}],
  [
    'navigational fact behind a page primary',
    {
      subtype: 'navigational',
      anchors: [
        { t: 'page', route: '/confirmation' },
        submitAnchor,
        { t: 'platform', platform: 'web' },
      ],
    },
  ],
  ['no confirmed outcome evidence', { confirmedOutcomeEvidenceTokens: [] }],
  [
    'ambiguous multi-element evidence',
    {
      distilledObservations: [
        { element: { naturalKey: 'button:submit order:0' } },
        { element: { naturalKey: 'button:cancel order:1' } },
      ],
    },
  ],
  ['fallback authorship path', { originClass: 'agent-observed' }],
  ['fallback Add needing enrichment', { originClass: 'agent-observed', needsEnrichment: true }],
  ['excluded kind procedure', { kind: 'procedure' }],
  ['excluded kind policy', { kind: 'policy' }],
  ['excluded kind unknown', { kind: 'unknown' }],
  ['non-candidate status', { status: 'active' }],
  ['closed validity window', { validityOpen: false }],
  ['withheld provenance', { withheld: true }],
  ['needs-enrichment provenance', { needsEnrichment: true }],
  ['incomplete evidence', { evidenceIncomplete: true }],
  ['memory-off anchor group', { memoryOffForAnchorGroup: true }],
  ['user-deprecated lineage', { hasUserDeprecateInLineage: true }],
  ['no element observation', { distilledObservations: [] }],
]

const cautionVariants: ReadonlyArray<[name: string, override: Partial<PromotionGateInput>]> = [
  ['base promoting caution', {}],
  [
    'caution without a root-cause class',
    { distilledObservations: [{ error: { naturalKey: 'environment: checkout timed out' } }] },
  ],
]

describe('414 D-14 — gatePosture and the empty-gate-set hold (ROOT-09 SC4)', () => {
  it('holds a candidate whose gate set is empty after exclusion, for fact and caution', () => {
    expect(evaluatePromotionGate(factInput({ gatePosture: emptyGateSetPosture }))).toEqual({
      verdict: 'hold',
      reason: 'empty-gate-set',
    })
    expect(evaluatePromotionGate(cautionInput({ gatePosture: emptyGateSetPosture }))).toEqual({
      verdict: 'hold',
      reason: 'empty-gate-set',
    })
  })

  it.each(factVariants)(
    'reads absent, undefined and no-replay-gate posture identically for %s (BYOM floor)',
    (_name, override) => {
      const postureless = evaluatePromotionGate(factInput(override))
      expect(evaluatePromotionGate(factInput({ ...override, gatePosture: undefined }))).toEqual(
        postureless,
      )
      expect(
        evaluatePromotionGate(
          factInput({
            ...override,
            gatePosture: { replayGateAvailable: false, gateSetNonEmpty: false },
          }),
        ),
      ).toEqual(postureless)
    },
  )

  it.each(cautionVariants)(
    'reads absent, undefined and no-replay-gate posture identically for %s (BYOM floor)',
    (_name, override) => {
      const postureless = evaluatePromotionGate(cautionInput(override))
      expect(evaluatePromotionGate(cautionInput({ ...override, gatePosture: undefined }))).toEqual(
        postureless,
      )
      expect(
        evaluatePromotionGate(
          cautionInput({
            ...override,
            gatePosture: { replayGateAvailable: false, gateSetNonEmpty: false },
          }),
        ),
      ).toEqual(postureless)
    },
  )

  it.each(factVariants)(
    'leaves the verdict for %s unchanged on every posture cell but { replay: true, set: false }',
    (_name, override) => {
      const postureless = evaluatePromotionGate(factInput(override))
      expect(
        evaluatePromotionGate(
          factInput({
            ...override,
            gatePosture: { replayGateAvailable: true, gateSetNonEmpty: true },
          }),
        ),
      ).toEqual(postureless)
      expect(
        evaluatePromotionGate(
          factInput({
            ...override,
            gatePosture: { replayGateAvailable: false, gateSetNonEmpty: true },
          }),
        ),
      ).toEqual(postureless)
    },
  )

  it('holds on exactly one of the four posture cells (adjacency)', () => {
    const postureless = evaluatePromotionGate(factInput())
    const cells = [
      { replayGateAvailable: true, gateSetNonEmpty: true },
      { replayGateAvailable: false, gateSetNonEmpty: true },
      { replayGateAvailable: false, gateSetNonEmpty: false },
    ] as const

    for (const gatePosture of cells) {
      expect(evaluatePromotionGate(factInput({ gatePosture }))).toEqual(postureless)
    }

    expect(evaluatePromotionGate(factInput({ gatePosture: emptyGateSetPosture }))).not.toEqual(
      postureless,
    )
  })

  it('checks the empty gate set after window-closed and before withheld (ordering)', () => {
    expect(
      evaluatePromotionGate(factInput({ status: 'active', gatePosture: emptyGateSetPosture })),
    ).toEqual({ verdict: 'hold', reason: 'not-candidate' })

    expect(
      evaluatePromotionGate(factInput({ validityOpen: false, gatePosture: emptyGateSetPosture })),
    ).toEqual({ verdict: 'hold', reason: 'window-closed' })

    expect(
      evaluatePromotionGate(factInput({ withheld: true, gatePosture: emptyGateSetPosture })),
    ).toEqual({ verdict: 'hold', reason: 'empty-gate-set' })
  })
})
