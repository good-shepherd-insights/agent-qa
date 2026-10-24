// The analyze-run payload mirror (393 D-20, WTST-06's schema-validated half).
//
// The back-compat case is the load-bearing one: the enqueue site ships a four-field payload
// today, and a schema that only accepts the new six-field shape would refuse every job the
// running system produces. Both halves are pinned here so a later edit cannot quietly make the
// flags mandatory.

import { describe, expect, it } from 'vitest'

import { AnalyzeRunPayloadSchema } from '../analyze-run-payload'

/** Byte-for-byte the shape `post-run-tail.ts` enqueues today. */
const CURRENT_PAYLOAD = {
  runId: 'r_ponent-fram-south-origin-flat',
  handoffDigest: 'sha256:3f9a1c',
  handoffSchemaVersion: 6,
  executionContext: 'local-interactive',
} as const

describe('AnalyzeRunPayloadSchema', () => {
  it('accepts the current four-field payload unchanged (back-compat)', () => {
    expect(AnalyzeRunPayloadSchema.parse(CURRENT_PAYLOAD)).toEqual(CURRENT_PAYLOAD)
  })

  it('accepts the payload with both D-20 flags', () => {
    const flagged = { ...CURRENT_PAYLOAD, gateRun: true, excludedFromOutcomes: true } as const
    expect(AnalyzeRunPayloadSchema.parse(flagged)).toEqual(flagged)
  })

  it('accepts each flag independently — they are DISTINCT axes', () => {
    // C8: a gate run still feeds curation, so `gateRun` without `excludedFromOutcomes` is a
    // real combination and must not be schema-coupled to its sibling.
    expect(
      AnalyzeRunPayloadSchema.parse({ ...CURRENT_PAYLOAD, gateRun: true }),
    ).toMatchObject({ gateRun: true })
    expect(
      AnalyzeRunPayloadSchema.parse({ ...CURRENT_PAYLOAD, excludedFromOutcomes: true }),
    ).toMatchObject({ excludedFromOutcomes: true })
  })

  it('accepts a payload with no executionContext', () => {
    const { executionContext: _dropped, ...withoutContext } = CURRENT_PAYLOAD
    expect(AnalyzeRunPayloadSchema.parse(withoutContext)).toEqual(withoutContext)
  })

  it('refuses gateRun: false — only the literal marker is meaningful', () => {
    expect(() =>
      AnalyzeRunPayloadSchema.parse({ ...CURRENT_PAYLOAD, gateRun: false }),
    ).toThrow()
  })

  it('refuses excludedFromOutcomes: false for the same reason', () => {
    expect(() =>
      AnalyzeRunPayloadSchema.parse({ ...CURRENT_PAYLOAD, excludedFromOutcomes: false }),
    ).toThrow()
  })

  it('refuses an unknown key (.strict() on the producer side)', () => {
    expect(() =>
      AnalyzeRunPayloadSchema.parse({ ...CURRENT_PAYLOAD, gateRunReason: 'draft-eval' }),
    ).toThrow()
  })

  it('refuses an empty runId and an empty handoffDigest', () => {
    expect(() => AnalyzeRunPayloadSchema.parse({ ...CURRENT_PAYLOAD, runId: '' })).toThrow()
    expect(() =>
      AnalyzeRunPayloadSchema.parse({ ...CURRENT_PAYLOAD, handoffDigest: '' }),
    ).toThrow()
  })

  it('refuses a missing handoffDigest — the digest is what names the analysed bytes', () => {
    const { handoffDigest: _dropped, ...withoutDigest } = CURRENT_PAYLOAD
    expect(() => AnalyzeRunPayloadSchema.parse(withoutDigest)).toThrow()
  })

  it('refuses an executionContext outside the closed vocabulary', () => {
    expect(() =>
      AnalyzeRunPayloadSchema.parse({ ...CURRENT_PAYLOAD, executionContext: 'staging' }),
    ).toThrow()
  })
})

// --- 422-12 (D-17/D-18): the optional arbiter sidecar on the enqueue payload ------------------
//
// The payload names the FINAL handoff digest (which bytes were analysed). Each sidecar row names
// the run's pre-execution IDENTITY digest instead, because the final digest now covers the
// verdicts that carry these rows — hashing it into a row would hash a value containing its own
// hash. The two must therefore never be the same string, and the schema says so.

const BASE_DIGEST = 'b'.repeat(64)

function sidecarRow(overrides: Record<string, unknown> = {}) {
  return {
    runId: CURRENT_PAYLOAD.runId,
    perTest: 0,
    stepIndex: 1,
    decisionOrdinal: 0,
    recordId: 'rec_mem_candidate',
    handoffBaseDigest: BASE_DIGEST,
    briefDigest: 'brief-digest-1',
    corpusDigest: 'corpus-digest-1',
    profileDigest: 'profile-digest-1',
    crossCheck: 'held',
    seedHonored: true,
    ...overrides,
  }
}

describe('AnalyzeRunPayloadSchema misdirectionEvidence (422 D-17/D-18)', () => {
  it('accepts a payload carrying the sidecar, with every row preserved', () => {
    const withEvidence = {
      ...CURRENT_PAYLOAD,
      misdirectionEvidence: [
        sidecarRow({ samples: { k: 2, seeds: [7, 8], modelCalls: 2 } }),
        sidecarRow({ recordId: 'rec_mem_canary', stepIndex: 2, crossCheck: 'not-run' }),
      ],
    }
    expect(AnalyzeRunPayloadSchema.parse(withEvidence)).toEqual(withEvidence)
  })

  it('keeps an absent sidecar absent and an empty sidecar empty', () => {
    expect('misdirectionEvidence' in AnalyzeRunPayloadSchema.parse(CURRENT_PAYLOAD)).toBe(false)
    expect(
      AnalyzeRunPayloadSchema.parse({ ...CURRENT_PAYLOAD, misdirectionEvidence: [] }),
    ).toEqual({ ...CURRENT_PAYLOAD, misdirectionEvidence: [] })
  })

  it('refuses a row minted against another run — queue identity is the payload identity', () => {
    expect(() =>
      AnalyzeRunPayloadSchema.parse({
        ...CURRENT_PAYLOAD,
        misdirectionEvidence: [sidecarRow({ runId: 'r_some-other-run' })],
      }),
    ).toThrow(/run/)
  })

  it('refuses two rows naming different source-digest identities', () => {
    expect(() =>
      AnalyzeRunPayloadSchema.parse({
        ...CURRENT_PAYLOAD,
        misdirectionEvidence: [sidecarRow(), sidecarRow({ handoffBaseDigest: 'c'.repeat(64) })],
      }),
    ).toThrow()
  })

  it('refuses a row whose base digest IS the final handoff digest (the self-hash cycle)', () => {
    expect(() =>
      AnalyzeRunPayloadSchema.parse({
        ...CURRENT_PAYLOAD,
        misdirectionEvidence: [sidecarRow({ handoffBaseDigest: CURRENT_PAYLOAD.handoffDigest })],
      }),
    ).toThrow()
  })

  it('refuses a malformed row rather than dropping its members', () => {
    expect(() =>
      AnalyzeRunPayloadSchema.parse({
        ...CURRENT_PAYLOAD,
        misdirectionEvidence: [{ ...sidecarRow(), exonerates: true }],
      }),
    ).toThrow()
    const { seedHonored: _dropped, ...withoutSeed } = sidecarRow()
    expect(() =>
      AnalyzeRunPayloadSchema.parse({ ...CURRENT_PAYLOAD, misdirectionEvidence: [withoutSeed] }),
    ).toThrow()
    expect(() =>
      AnalyzeRunPayloadSchema.parse({
        ...CURRENT_PAYLOAD,
        misdirectionEvidence: [sidecarRow({ crossCheck: 'cleared' })],
      }),
    ).toThrow()
  })

  it('refuses a sidecar that is not an array', () => {
    expect(() =>
      AnalyzeRunPayloadSchema.parse({ ...CURRENT_PAYLOAD, misdirectionEvidence: sidecarRow() }),
    ).toThrow()
  })
})
