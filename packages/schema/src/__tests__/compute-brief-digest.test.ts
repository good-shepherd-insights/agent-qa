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

const losslessFixtureBrief: ServedBrief = {
  ...fixtureBrief,
  briefDigest: '',
  proof: {
    schemaVersion: 1,
    completeness: 'lossless',
    recordCap: 24,
    combinedBudget: 2048,
    admissionEvents: [
      {
        ordinal: 0,
        turnOrdinal: 0,
        surface: 'brief-line',
        id: asRecordId('rec_login'),
        sourceId: 'rec_login',
        clusterKey: '{"name":"Email","role":"textbox","t":"el"}',
        renderedCost: 86,
        chargeRepeated: false,
      },
      {
        ordinal: 1,
        turnOrdinal: 0,
        surface: 'read-body',
        id: asRecordId('rec_body'),
        sourceId: 'rec_body',
        clusterKey: '/checkout',
        renderedCost: 144,
        chargeRepeated: true,
      },
    ],
    promptTurns: [
      {
        ordinal: 0,
        turnOrdinal: 0,
        runDate: '2026-07-24',
        policyL0: 'Never submit a purchase.',
        learnedL1: 'Login form asks for email before password.',
        learnedL2: 'Checkout canary watches the disabled submit button.',
        contextTier: 'Current test: checkout flow\nCurrent step: fill email',
        volatileTier: 'Current date: 2026-07-24',
        policyDigest: '9d7a0d14',
        contextTierDigest: '41e7cd6a',
        volatileTierDigest: 'e0756d1a',
      },
      {
        ordinal: 1,
        turnOrdinal: 1,
        runDate: '2026-07-24',
        policyL0: 'Never submit a purchase.',
        learnedL1: 'Login form asks for email before password.',
        learnedL2: '',
        contextTier: 'Current test: checkout flow\nCurrent step: verify total',
        volatileTier: 'Current date: 2026-07-24',
        policyDigest: '9d7a0d14',
        contextTierDigest: '22235b57',
        volatileTierDigest: 'e0756d1a',
      },
    ],
  },
}

const reorderedLosslessFixtureBrief: ServedBrief = {
  proof: {
    promptTurns: losslessFixtureBrief.proof!.promptTurns.map((turn) => ({
      volatileTierDigest: turn.volatileTierDigest,
      contextTierDigest: turn.contextTierDigest,
      policyDigest: turn.policyDigest,
      volatileTier: turn.volatileTier,
      contextTier: turn.contextTier,
      learnedL2: turn.learnedL2,
      learnedL1: turn.learnedL1,
      policyL0: turn.policyL0,
      runDate: turn.runDate,
      turnOrdinal: turn.turnOrdinal,
      ordinal: turn.ordinal,
    })),
    admissionEvents: losslessFixtureBrief.proof!.admissionEvents.map((event) => ({
      chargeRepeated: event.chargeRepeated,
      renderedCost: event.renderedCost,
      clusterKey: event.clusterKey,
      sourceId: event.sourceId,
      id: event.id,
      surface: event.surface,
      turnOrdinal: event.turnOrdinal,
      ordinal: event.ordinal,
    })),
    combinedBudget: 2048,
    recordCap: 24,
    completeness: 'lossless',
    schemaVersion: 1,
  },
  briefDigest: '',
  channel3: reorderedFixtureBrief.channel3,
  channel2: reorderedFixtureBrief.channel2,
  channel1: reorderedFixtureBrief.channel1,
  truncation: reorderedFixtureBrief.truncation,
  budget: reorderedFixtureBrief.budget,
  asOfBuild: reorderedFixtureBrief.asOfBuild,
  scope: reorderedFixtureBrief.scope,
}

function mutateAdmissionEvent(
  patch: Partial<NonNullable<ServedBrief['proof']>['admissionEvents'][number]>,
): ServedBrief {
  return {
    ...losslessFixtureBrief,
    proof: {
      ...losslessFixtureBrief.proof!,
      admissionEvents: [
        { ...losslessFixtureBrief.proof!.admissionEvents[0], ...patch },
        losslessFixtureBrief.proof!.admissionEvents[1],
      ],
    },
  }
}

function mutatePromptTurn(
  patch: Partial<NonNullable<ServedBrief['proof']>['promptTurns'][number]>,
): ServedBrief {
  return {
    ...losslessFixtureBrief,
    proof: {
      ...losslessFixtureBrief.proof!,
      promptTurns: [
        { ...losslessFixtureBrief.proof!.promptTurns[0], ...patch },
        losslessFixtureBrief.proof!.promptTurns[1],
      ],
    },
  }
}

describe('computeBriefDigest', () => {
  it('retains the proof-less served brief v1 known vector', () => {
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

  it('matches the lossless served brief v2 known vector', () => {
    expect(computeBriefDigest(losslessFixtureBrief)).toBe(
      '61e5a1aaf27676eaf0121622c1cfb1b4709402fc449c1a6f838ce4e764bfa42a',
    )
  })

  it('keeps the v2 digest stable across object field insertion order', () => {
    expect(computeBriefDigest(reorderedLosslessFixtureBrief)).toBe(
      computeBriefDigest(losslessFixtureBrief),
    )
  })

  it('addresses every proof scalar and chronological array position', () => {
    const proof = losslessFixtureBrief.proof!
    const mutations: Array<[string, ServedBrief]> = [
      [
        'schema version',
        {
          ...losslessFixtureBrief,
          proof: { ...proof, schemaVersion: 2 } as unknown as ServedBrief['proof'],
        },
      ],
      [
        'completeness',
        {
          ...losslessFixtureBrief,
          proof: {
            ...proof,
            completeness: 'reconstructed',
          } as unknown as ServedBrief['proof'],
        },
      ],
      ['record cap', { ...losslessFixtureBrief, proof: { ...proof, recordCap: 25 } }],
      [
        'combined budget',
        { ...losslessFixtureBrief, proof: { ...proof, combinedBudget: 2049 } },
      ],
      ['event ordinal', mutateAdmissionEvent({ ordinal: 8 })],
      ['event turn ordinal', mutateAdmissionEvent({ turnOrdinal: 2 })],
      ['event surface', mutateAdmissionEvent({ surface: 'search-result' })],
      ['event id', mutateAdmissionEvent({ id: asRecordId('rec_changed') })],
      ['event source', mutateAdmissionEvent({ sourceId: 'changed-source' })],
      ['event cluster', mutateAdmissionEvent({ clusterKey: 'changed-cluster' })],
      ['event cost', mutateAdmissionEvent({ renderedCost: 87 })],
      ['event repeat charge', mutateAdmissionEvent({ chargeRepeated: true })],
      [
        'event order',
        {
          ...losslessFixtureBrief,
          proof: { ...proof, admissionEvents: [...proof.admissionEvents].reverse() },
        },
      ],
      ['prompt ordinal', mutatePromptTurn({ ordinal: 9 })],
      ['prompt turn ordinal', mutatePromptTurn({ turnOrdinal: 9 })],
      ['prompt run date', mutatePromptTurn({ runDate: '2026-07-25' })],
      ['policy bytes', mutatePromptTurn({ policyL0: 'Never submit two purchases.' })],
      ['learned L1 bytes', mutatePromptTurn({ learnedL1: 'Changed L1.' })],
      ['learned L2 bytes', mutatePromptTurn({ learnedL2: 'Changed L2.' })],
      ['context bytes', mutatePromptTurn({ contextTier: 'Changed context.' })],
      ['volatile bytes', mutatePromptTurn({ volatileTier: 'Changed volatile tier.' })],
      ['policy digest', mutatePromptTurn({ policyDigest: 'changed-policy-digest' })],
      ['context digest', mutatePromptTurn({ contextTierDigest: 'changed-context-digest' })],
      ['volatile digest', mutatePromptTurn({ volatileTierDigest: 'changed-volatile-digest' })],
      [
        'prompt order',
        {
          ...losslessFixtureBrief,
          proof: { ...proof, promptTurns: [...proof.promptTurns].reverse() },
        },
      ],
    ]
    const baseline = computeBriefDigest(losslessFixtureBrief)

    for (const [label, changed] of mutations) {
      expect(computeBriefDigest(changed), label).not.toBe(baseline)
    }
  })

  it('does not include the outer digest in its own input', () => {
    expect(
      computeBriefDigest({ ...losslessFixtureBrief, briefDigest: 'already-computed' }),
    ).toBe(computeBriefDigest(losslessFixtureBrief))
  })
})
