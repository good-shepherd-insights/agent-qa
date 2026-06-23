import { describe, expect, it } from 'vitest'
import { computeEvidenceToken } from '../ids/compute-evidence-token'
import type { EvidenceTokenInput } from '../ids/compute-evidence-token'

const GOLDEN_EVIDENCE_TOKEN = '0000000000000000'

function makeInput(overrides: Partial<EvidenceTokenInput> = {}): EvidenceTokenInput {
  return {
    attributingObservationId: 'obs-1',
    anchor: 'el:role=button,name=save',
    buildOrdinal: 7,
    ...overrides,
  }
}

describe('computeEvidenceToken', () => {
  it('returns a stable branded 16-hex evidence token', () => {
    const token = computeEvidenceToken(makeInput())

    expect(token).toBe(computeEvidenceToken(makeInput()))
    expect(token).toMatch(/^[0-9a-f]{16}$/)
  })

  it('matches the frozen golden vector', () => {
    expect(computeEvidenceToken(makeInput())).toBe(GOLDEN_EVIDENCE_TOKEN)
  })

  it('changes when a tuple component changes', () => {
    const baseline = computeEvidenceToken(makeInput())

    expect(computeEvidenceToken(makeInput({ attributingObservationId: 'obs-2' }))).not.toBe(
      baseline,
    )
    expect(computeEvidenceToken(makeInput({ anchor: 'el:role=link,name=home' }))).not.toBe(
      baseline,
    )
    expect(computeEvidenceToken(makeInput({ buildOrdinal: 8 }))).not.toBe(baseline)
  })
})
