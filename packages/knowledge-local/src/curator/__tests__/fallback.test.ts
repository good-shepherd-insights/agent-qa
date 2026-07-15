import {
  asEvidenceToken,
  asRecordId,
  deriveEvidenceToken,
  type Anchor,
  type BundleKind,
  type Delta,
  type ExecutionContext,
  type FactSubtype,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { parseAuthoredCheckpoint } from '../author-contract.js'
import type { CurationJobView, NeighborRecord } from '../author-contract.js'
import {
  RESTRICTED_FALLBACK_DELTA_KINDS,
  assertRestrictedFallbackDelta,
  constructFallbackDeltas,
} from '../fallback.js'

type FallbackJobFixture = CurationJobView & {
  attributingObservationId: string
  executionContext: ExecutionContext
}

type FallbackNeighborFixture = NeighborRecord & {
  kind: BundleKind
  subtype?: FactSubtype
}

const primaryAnchor: Anchor = { t: 'el', role: 'Button', name: 'Checkout' }
const pageAnchor: Anchor = { t: 'page', route: '/checkout' }
const scope = { tier: 'product', key: 'storefront' } as const

function job(overrides: Partial<FallbackJobFixture> = {}): FallbackJobFixture {
  return {
    candidateId: 'a'.repeat(64),
    kind: 'fact',
    subtype: 'selector',
    anchors: [primaryAnchor, pageAnchor],
    summarySeed: 'Checkout control',
    bodySeed: 'The Checkout button resolves uniquely on the checkout page.',
    distilledObservations: [],
    scope,
    buildOrdinal: 42,
    secretFlagged: false,
    injectionFlagged: false,
    attributingObservationId: 'run-1:test-0:step-0',
    executionContext: 'local-headless',
    ...overrides,
  }
}

function neighbor(
  overrides: Partial<FallbackNeighborFixture> = {},
): FallbackNeighborFixture {
  return {
    alias: 1,
    recordId: asRecordId('fact-checkout-control'),
    kind: 'fact',
    subtype: 'selector',
    summary: 'Existing checkout control',
    anchors: [primaryAnchor, pageAnchor],
    observedStatus: 'active',
    observedOrdinal: 41,
    ...overrides,
  }
}

function onlyDelta(jobView: FallbackJobFixture, neighbors: FallbackNeighborFixture[] = []): Delta {
  const deltas = constructFallbackDeltas(jobView, neighbors)
  expect(deltas).toHaveLength(1)
  return deltas[0]!
}

describe('constructFallbackDeltas restricted BYOM projection (CUR-02)', () => {
  it('emits a born-candidate Add with deterministic fallback authorship when no anchor matches', () => {
    const input = job()
    const delta = onlyDelta(input)

    expect(delta).toMatchObject({
      kind: 'Add',
      origin: 'agent',
      scope,
      citedIds: [],
      authorship: {
        path: 'deterministic-fallback',
        executionContext: 'local-headless',
      },
    })
    if (delta.kind !== 'Add') throw new Error('expected Add')
    expect(delta.authorship?.model).toBeUndefined()
    expect(delta.bundle).toMatchObject({
      kind: 'fact',
      subtype: 'selector',
      anchors: [primaryAnchor, pageAnchor],
      scope,
      summary: input.summarySeed,
      body: input.bodySeed,
      originStage: 'run-curation',
    })
  })

  it('confirms an exact normalized primary-anchor neighbor with a fresh code-derived token', () => {
    const input = job({
      anchors: [
        { t: 'el', role: ' button ', name: ' CHECKOUT ' },
        { t: 'page', route: '/checkout/' },
      ],
    })
    const existing = neighbor()
    const delta = onlyDelta(input, [existing])

    expect(delta.kind).toBe('Confirm')
    if (delta.kind !== 'Confirm') throw new Error('expected Confirm')
    expect(delta.targetId).toBe(existing.recordId)
    expect(delta.evidenceToken).toBe(
      deriveEvidenceToken({
        attributingObservationId: input.attributingObservationId,
        anchor: input.anchors[0]!,
        buildOrdinal: input.buildOrdinal,
      }),
    )
    expect(delta.citedIds).toEqual([existing.recordId])
    expect(delta.precondition).toEqual([
      {
        recordId: existing.recordId,
        observedStatus: existing.observedStatus,
        observedOrdinal: existing.observedOrdinal,
      },
    ])
  })

  it('supersedes only an exact-key measurement neighbor and carries the fresh measured draft', () => {
    const input = job({
      subtype: 'measurement',
      summarySeed: 'Checkout latency p95: 840 ms',
      bodySeed: 'The verified checkout latency p95 is 840 ms.',
    })
    const measurementNeighbor = neighbor({ subtype: 'measurement' })
    const delta = onlyDelta(input, [measurementNeighbor])

    expect(delta.kind).toBe('Supersede')
    if (delta.kind !== 'Supersede') throw new Error('expected Supersede')
    expect(delta.victimId).toBe(measurementNeighbor.recordId)
    expect(delta.newBundle).toMatchObject({
      kind: 'fact',
      subtype: 'measurement',
      summary: input.summarySeed,
      body: input.bodySeed,
    })
    expect(delta.evidenceToken).toBe(
      deriveEvidenceToken({
        attributingObservationId: input.attributingObservationId,
        anchor: input.anchors[0]!,
        buildOrdinal: input.buildOrdinal,
      }),
    )
  })

  it('never supersedes a non-measurement neighbor for a measurement candidate', () => {
    const input = job({ subtype: 'measurement' })
    const behavioralNeighbor = neighbor({ subtype: 'behavioral' })

    expect(onlyDelta(input, [behavioralNeighbor]).kind).toBe('Confirm')
  })

  it('uses the complete supersession key before measurement supersession', () => {
    const input = job({ subtype: 'measurement' })
    const differentPage = neighbor({
      subtype: 'measurement',
      anchors: [primaryAnchor, { t: 'page', route: '/different-page' }],
    })

    expect(onlyDelta(input, [differentPage]).kind).toBe('Confirm')
  })

  it('is byte-deterministic and does not mutate the caller-owned inputs', () => {
    const input = job()
    const neighbors = [neighbor({ alias: 2 }), neighbor({ alias: 1 })]
    const inputBefore = structuredClone(input)
    const neighborsBefore = structuredClone(neighbors)

    const first = constructFallbackDeltas(input, neighbors)
    const second = constructFallbackDeltas(input, neighbors)

    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(input).toEqual(inputBefore)
    expect(neighbors).toEqual(neighborsBefore)
  })

  it('persists needsEnrichment for a non-derivable kind through the authored checkpoint', () => {
    const input = job({
      kind: 'procedure',
      subtype: undefined,
      anchors: [{ t: 'flow', name: 'Checkout flow' }],
      summarySeed: 'Checkout flow',
      bodySeed: 'Complete checkout using the verified step sequence.',
    })
    const delta = onlyDelta(input)
    expect(delta.kind).toBe('Add')
    if (delta.kind !== 'Add') throw new Error('expected Add')
    expect((delta.bundle as typeof delta.bundle & { needsEnrichment?: true }).needsEnrichment).toBe(
      true,
    )

    const parsed = parseAuthoredCheckpoint({
      schemaVersion: 1,
      delta,
      neighborIds: [],
      preconditions: [],
      authorship: delta.authorship,
    })
    expect(
      (
        parsed.delta.kind === 'Add'
          ? (parsed.delta.bundle as typeof parsed.delta.bundle & { needsEnrichment?: true })
          : {}
      ).needsEnrichment,
    ).toBe(true)
  })

  it('produces no delta kind outside the restricted set across a fixture sweep', () => {
    const produced = [
      onlyDelta(job()),
      onlyDelta(job(), [neighbor()]),
      onlyDelta(job({ subtype: 'measurement' }), [neighbor({ subtype: 'measurement' })]),
      onlyDelta(job({ subtype: 'measurement' }), [neighbor({ subtype: 'behavioral' })]),
      onlyDelta(
        job({
          kind: 'procedure',
          subtype: undefined,
          anchors: [{ t: 'flow', name: 'Checkout flow' }],
        }),
      ),
    ]
    type RestrictedKind = (typeof RESTRICTED_FALLBACK_DELTA_KINDS)[number]
    const counts: Record<RestrictedKind, number> = {
      Add: 0,
      Confirm: 0,
      Supersede: 0,
      Noop: 0,
    }

    for (const delta of produced) {
      assertRestrictedFallbackDelta(delta)
      counts[delta.kind as RestrictedKind] += 1
    }

    expect(Object.keys(counts).sort()).toEqual([...RESTRICTED_FALLBACK_DELTA_KINDS].sort())
    expect(counts).toMatchObject({ Add: 2, Confirm: 2, Supersede: 1, Noop: 0 })
    expect(produced.some((delta) => delta.kind === 'Deprecate')).toBe(false)
  })
})

describe('assertRestrictedFallbackDelta commit-side boundary', () => {
  const add = onlyDelta(job())

  it('accepts Add, Confirm, measurement Supersede, and Noop', () => {
    const confirm = onlyDelta(job(), [neighbor()])
    const supersede = onlyDelta(job({ subtype: 'measurement' }), [
      neighbor({ subtype: 'measurement' }),
    ])
    const noop: Delta = {
      kind: 'Noop',
      origin: 'agent',
      scope,
      citedIds: [],
      authorship: {
        path: 'deterministic-fallback',
        executionContext: 'local-headless',
      },
    }

    for (const delta of [add, confirm, supersede, noop]) {
      expect(() => assertRestrictedFallbackDelta(delta)).not.toThrow()
    }
  })

  it('rejects Deprecate, MintUnknown, and non-measurement Supersede', () => {
    const envelope = {
      origin: 'agent' as const,
      scope,
      citedIds: [asRecordId('fact-checkout-control')],
      authorship: {
        path: 'deterministic-fallback' as const,
        executionContext: 'local-headless' as const,
      },
    }
    const forbidden: Delta[] = [
      {
        ...envelope,
        kind: 'Deprecate',
        targetId: envelope.citedIds[0]!,
        reason: 'fallback must not deprecate',
      },
      {
        ...envelope,
        kind: 'MintUnknown',
        conflict: { recordIds: envelope.citedIds, kind: 'contradiction' },
      },
      {
        ...envelope,
        kind: 'Supersede',
        victimId: envelope.citedIds[0]!,
        newBundle:
          add.kind === 'Add'
            ? add.bundle
            : (() => {
                throw new Error('expected Add fixture')
              })(),
        evidenceToken: asEvidenceToken('forbidden-behavioral-supersede'),
      },
    ]

    for (const delta of forbidden) {
      expect(() => assertRestrictedFallbackDelta(delta)).toThrow(TypeError)
    }
  })
})
