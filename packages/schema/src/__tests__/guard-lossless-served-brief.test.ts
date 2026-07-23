import { describe, expect, it } from 'vitest'
import {
  LosslessServedBriefError,
  LosslessServedBriefSchema,
  guardLosslessServedBrief,
} from '../brief/guard-lossless-served-brief'
import { guardLosslessServedBrief as briefBarrelGuard } from '../brief/index'
import { computeBriefDigest } from '../brief/compute-brief-digest'
import type {
  LosslessServedBriefProofV1,
  ServedAdmissionEvent,
  ServedBrief,
  ServedPromptTurn,
} from '../brief/served-brief'
import { sha256hex } from '../determinism/sha256'
import { asRecordId } from '../ids/record-id'
import { guardLosslessServedBrief as rootBarrelGuard } from '../index'

type LosslessServedBrief = ServedBrief & { proof: LosslessServedBriefProofV1 }

function promptTurn(overrides: Partial<ServedPromptTurn> = {}): ServedPromptTurn {
  const policyL0 = overrides.policyL0 ?? ''
  const contextTier = overrides.contextTier ?? 'Current test: checkout\nCurrent step: verify total'
  const volatileTier = overrides.volatileTier ?? 'Current date: 2026-07-24'

  return {
    ordinal: 0,
    turnOrdinal: 0,
    runDate: '2026-07-24',
    policyL0,
    learnedL1: '',
    learnedL2: '',
    contextTier,
    volatileTier,
    policyDigest: sha256hex(policyL0),
    contextTierDigest: sha256hex(contextTier),
    volatileTierDigest: sha256hex(volatileTier),
    ...overrides,
  }
}

function admissionEvent(overrides: Partial<ServedAdmissionEvent> = {}): ServedAdmissionEvent {
  return {
    ordinal: 0,
    turnOrdinal: 0,
    surface: 'brief-line',
    id: asRecordId('rec_checkout'),
    sourceId: 'rec_checkout',
    clusterKey: '/checkout',
    renderedCost: 32,
    chargeRepeated: false,
    ...overrides,
  }
}

function signBrief(brief: LosslessServedBrief): LosslessServedBrief {
  return {
    ...brief,
    briefDigest: computeBriefDigest(brief),
  }
}

function validZeroRecordBrief(): LosslessServedBrief {
  return signBrief({
    scope: { tier: 'test', key: 'checkout-flow' },
    asOfBuild: 42,
    budget: 3,
    truncation: 'none',
    channel1: [],
    channel2: [],
    channel3: [],
    briefDigest: '',
    proof: {
      schemaVersion: 1,
      completeness: 'lossless',
      recordCap: 24,
      combinedBudget: 2048,
      admissionEvents: [],
      promptTurns: [promptTurn()],
    },
  })
}

function expectLosslessError(value: unknown): LosslessServedBriefError {
  try {
    guardLosslessServedBrief(value)
  } catch (error) {
    expect(error).toBeInstanceOf(LosslessServedBriefError)
    return error as LosslessServedBriefError
  }
  throw new Error('expected guardLosslessServedBrief to reject the value')
}

describe('guardLosslessServedBrief', () => {
  it('accepts a complete zero-record proof with one real prompt turn', () => {
    const brief = validZeroRecordBrief()

    expect(guardLosslessServedBrief(brief)).toEqual(brief)
    expect(LosslessServedBriefSchema.safeParse(brief).success).toBe(true)
  })

  it('is the same public guard from the brief and root barrels', () => {
    expect(briefBarrelGuard).toBe(guardLosslessServedBrief)
    expect(rootBarrelGuard).toBe(guardLosslessServedBrief)
  })

  it('rejects an empty object and a structurally valid proof-less legacy brief', () => {
    expectLosslessError({})

    const { proof: _proof, ...legacy } = validZeroRecordBrief()
    const proofless: ServedBrief = {
      ...legacy,
      briefDigest: computeBriefDigest(legacy),
    }
    expectLosslessError(proofless)
  })

  it('rejects zero prompt turns instead of passing vacuously', () => {
    const brief = validZeroRecordBrief()
    const changed = signBrief({
      ...brief,
      proof: { ...brief.proof, promptTurns: [] },
    })

    expectLosslessError(changed)
  })

  it('rejects non-contiguous ordinals and decreasing turn order', () => {
    const brief = validZeroRecordBrief()
    const cases: LosslessServedBrief[] = [
      signBrief({
        ...brief,
        proof: { ...brief.proof, admissionEvents: [admissionEvent({ ordinal: 1 })] },
      }),
      signBrief({
        ...brief,
        proof: { ...brief.proof, promptTurns: [promptTurn({ ordinal: 1 })] },
      }),
      signBrief({
        ...brief,
        proof: {
          ...brief.proof,
          admissionEvents: [
            admissionEvent(),
            admissionEvent({
              ordinal: 1,
              turnOrdinal: 0,
              id: asRecordId('rec_second'),
            }),
            admissionEvent({
              ordinal: 2,
              turnOrdinal: 2,
              id: asRecordId('rec_third'),
            }),
            admissionEvent({
              ordinal: 3,
              turnOrdinal: 1,
              id: asRecordId('rec_fourth'),
            }),
          ],
        },
      }),
      signBrief({
        ...brief,
        proof: {
          ...brief.proof,
          promptTurns: [
            promptTurn({ ordinal: 0, turnOrdinal: 1 }),
            promptTurn({ ordinal: 1, turnOrdinal: 0 }),
          ],
        },
      }),
    ]

    for (const value of cases) expectLosslessError(value)
  })

  it('rejects an unknown admission surface even with a recomputed outer digest', () => {
    const brief = validZeroRecordBrief()
    const changed = signBrief({
      ...brief,
      proof: {
        ...brief.proof,
        admissionEvents: [
          admissionEvent({
            surface: 'unknown-surface',
          } as unknown as Partial<ServedAdmissionEvent>),
        ],
      },
    })

    expectLosslessError(changed)
  })

  it('rejects non-finite, negative, and fractional costs and caps', () => {
    const brief = validZeroRecordBrief()
    const cases = [
      signBrief({
        ...brief,
        proof: { ...brief.proof, recordCap: -1 },
      }),
      signBrief({
        ...brief,
        proof: { ...brief.proof, combinedBudget: 1.5 },
      }),
      signBrief({
        ...brief,
        proof: {
          ...brief.proof,
          admissionEvents: [admissionEvent({ renderedCost: Number.NaN })],
        },
      }),
      signBrief({
        ...brief,
        proof: {
          ...brief.proof,
          admissionEvents: [admissionEvent({ renderedCost: Number.POSITIVE_INFINITY })],
        },
      }),
    ]

    for (const value of cases) expectLosslessError(value)
  })

  it('rejects mismatched prompt-tier digests after the outer digest is recomputed', () => {
    const brief = validZeroRecordBrief()
    const fields = ['policyDigest', 'contextTierDigest', 'volatileTierDigest'] as const

    for (const field of fields) {
      const changed = signBrief({
        ...brief,
        proof: {
          ...brief.proof,
          promptTurns: [promptTurn({ [field]: '0'.repeat(64) })],
        },
      })
      expectLosslessError(changed)
    }
  })

  it('rejects reordered or tampered proof material and a mismatched brief digest', () => {
    const brief = validZeroRecordBrief()
    const withTwoEvents = signBrief({
      ...brief,
      proof: {
        ...brief.proof,
        admissionEvents: [
          admissionEvent(),
          admissionEvent({ ordinal: 1, id: asRecordId('rec_second') }),
        ],
      },
    })

    expectLosslessError({
      ...withTwoEvents,
      proof: {
        ...withTwoEvents.proof,
        admissionEvents: [...withTwoEvents.proof.admissionEvents].reverse(),
      },
    })
    expectLosslessError({
      ...brief,
      proof: {
        ...brief.proof,
        promptTurns: [promptTurn({ policyL0: 'tampered policy bytes' })],
      },
    })
    expectLosslessError({ ...brief, briefDigest: 'f'.repeat(64) })
  })

  it('reports structural paths without disclosing persisted prompt contents', () => {
    const secretPrompt = 'do not disclose persisted prompt bytes'
    const brief = validZeroRecordBrief()
    const error = expectLosslessError(
      signBrief({
        ...brief,
        proof: {
          ...brief.proof,
          promptTurns: [
            promptTurn({
              policyL0: secretPrompt,
              policyDigest: '0'.repeat(64),
            }),
          ],
        },
      }),
    )

    expect(error.paths).toContain('proof.promptTurns.0.policyDigest')
    expect(error.message).not.toContain(secretPrompt)
    expect(error.message).not.toContain('0'.repeat(64))
  })
})
