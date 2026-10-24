import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  DISTILLED_OBSERVATION_SCHEMA_VERSION,
  asRecordId,
  guardDistilledObservation,
  supersessionKey,
} from '../index'
import type { Anchor, DistilledObservation, IndexEntry } from '../index'

const oldEntry: IndexEntry = {
  id: asRecordId('fact-checkout'),
  kind: 'fact',
  title: 'Checkout',
  summary: 'Checkout summary',
  trust: 0.8,
  anchors: [],
  status: 'active',
  servedAsCanary: false,
  scope: { tier: 'global', key: 'global' },
  validity: 'current',
}

const annotatedEntry: IndexEntry = {
  ...oldEntry,
  servedAs: 'prior-build-hypothesis',
  conflict: {
    peerRecordId: asRecordId('fact-checkout-peer'),
    unknownRecordId: asRecordId('unknown-checkout-conflict'),
  },
  audit: {
    status: 'open',
    openedAtOrdinal: 41,
    closedAtOrdinal: null,
  },
}

describe('supersession key', () => {
  it('is invariant to anchor array order', () => {
    const anchors: Anchor[] = [
      { t: 'flow', name: 'checkout' },
      { t: 'page', route: '/checkout' },
      { t: 'el', role: 'button', name: 'submit order' },
    ]

    expect(supersessionKey(anchors)).toBe(supersessionKey([...anchors].reverse()))
  })

  it('is invariant to cosmetic variants normalized by the anchor authority', () => {
    const cosmetic: Anchor[] = [
      { t: 'page', route: ' /Checkout/#receipt ' },
      { t: 'el', role: ' Button ', name: '  Submit Order ' },
      { t: 'error', message: ' Timeout after 5000ms ' },
    ]
    const clean: Anchor[] = [
      { t: 'page', route: '/checkout' },
      { t: 'el', role: 'button', name: 'submit order' },
      { t: 'error', message: 'timeout after #ms' },
    ]

    expect(supersessionKey(cosmetic)).toBe(supersessionKey(clean))
  })

  it('distinguishes genuinely different anchor sets', () => {
    expect(supersessionKey([{ t: 'flow', name: 'checkout' }]))
      .not.toBe(supersessionKey([{ t: 'flow', name: 'refund' }]))
  })

  it('keeps old and annotated IndexEntry construction source-compatible', () => {
    expectTypeOf(oldEntry).toMatchTypeOf<IndexEntry>()
    expectTypeOf(annotatedEntry).toMatchTypeOf<IndexEntry>()
    expect(annotatedEntry.servedAsCanary).toBe(false)
    expect(annotatedEntry.servedAs).toBe('prior-build-hypothesis')
  })

  it('exposes the distilled observation contract from the package barrel', () => {
    const observation: DistilledObservation = {
      schemaVersion: DISTILLED_OBSERVATION_SCHEMA_VERSION,
      step: { naturalKey: 'open checkout', ordinal: 0 },
      observedAtOrdinal: 41,
    }

    expect(guardDistilledObservation(observation)).toEqual(observation)
  })
})
