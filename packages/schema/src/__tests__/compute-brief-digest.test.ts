import { describe, expect, it } from 'vitest'
import { computeBriefDigest } from '../brief/compute-brief-digest'
import type { ServedBrief } from '../brief/served-brief'
import { asRecordId } from '../ids/record-id'

const fixtureBrief: ServedBrief = {
  scope: { tier: 'test', key: 'checkout-flow' },
  asOfBuild: 42,
  budget: 3,
  truncation: 'served L0..L2, dropped 1 of 4 at L3',
  channel1: [
    {
      id: asRecordId('rec_login'),
      kind: 'observation',
      summary: 'Login form asks for email before password.',
      trust: 0.82,
      status: 'confirmed',
      servedAsCanary: false,
      tier: 'L1',
    },
    {
      id: asRecordId('rec_canary'),
      kind: 'canary',
      summary: 'Checkout canary watches the disabled submit button.',
      trust: 0.61,
      status: 'candidate',
      servedAsCanary: true,
      tier: 'L2',
    },
  ],
  channel2: [
    {
      id: asRecordId('rec_body'),
      detailLevel: 'body',
      bodyDigest: '7bd872c31ec8a452',
    },
  ],
  channel3: [
    {
      id: asRecordId('rec_caution'),
      anchors: [
        { t: 'page', route: '/checkout' },
        { t: 'el', role: 'button', name: 'Pay now' },
      ],
      summary: 'Payment button may be disabled while totals refresh.',
    },
  ],
  briefDigest: '',
}

const reorderedFixtureBrief: ServedBrief = {
  briefDigest: '',
  channel3: [
    {
      summary: 'Payment button may be disabled while totals refresh.',
      anchors: [
        { route: '/checkout', t: 'page' },
        { name: 'Pay now', t: 'el', role: 'button' },
      ],
      id: asRecordId('rec_caution'),
    },
  ],
  channel2: [
    {
      bodyDigest: '7bd872c31ec8a452',
      id: asRecordId('rec_body'),
      detailLevel: 'body',
    },
  ],
  channel1: [
    {
      tier: 'L1',
      servedAsCanary: false,
      status: 'confirmed',
      trust: 0.82,
      summary: 'Login form asks for email before password.',
      kind: 'observation',
      id: asRecordId('rec_login'),
    },
    {
      tier: 'L2',
      servedAsCanary: true,
      status: 'candidate',
      trust: 0.61,
      summary: 'Checkout canary watches the disabled submit button.',
      kind: 'canary',
      id: asRecordId('rec_canary'),
    },
  ],
  truncation: 'served L0..L2, dropped 1 of 4 at L3',
  budget: 3,
  asOfBuild: 42,
  scope: { key: 'checkout-flow', tier: 'test' },
}

describe('computeBriefDigest', () => {
  it('matches the served brief known vector', () => {
    expect(computeBriefDigest(fixtureBrief)).toBe(
      'd71b935ac67bda8109f6501c8e01e6d58090f093a8aebc0bfd21dfef791b2e12',
    )
  })

  it('is deterministic for repeated inputs', () => {
    const digest = computeBriefDigest(fixtureBrief)

    expect(computeBriefDigest(fixtureBrief)).toBe(digest)
    expect(computeBriefDigest(fixtureBrief)).toBe(computeBriefDigest(fixtureBrief))
  })

  it('is stable across object field insertion order', () => {
    expect(computeBriefDigest(reorderedFixtureBrief)).toBe(computeBriefDigest(fixtureBrief))
  })

  it('returns a lowercase 64-hex digest', () => {
    expect(computeBriefDigest(fixtureBrief)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when channel line content changes', () => {
    const changed: ServedBrief = {
      ...fixtureBrief,
      channel1: [
        {
          ...fixtureBrief.channel1[0],
          summary: 'Login form asks for phone before password.',
        },
        fixtureBrief.channel1[1],
      ],
    }

    expect(computeBriefDigest(changed)).not.toBe(computeBriefDigest(fixtureBrief))
  })
})
