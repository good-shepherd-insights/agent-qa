import { describe, expect, it } from 'vitest'

import {
  artifactFreeCaptureReceipt,
  buildCurationCandidateAddressFields,
  candidateContentAddress,
  curationCandidatePayloadSchema,
} from '../queue-payload.js'
import {
  CANARY_QUEUE_SCHEMA_VERSION,
  canaryOutcomeContentAddress,
  canaryOutcomePayloadSchema,
  type CanaryOutcomeAddressFields,
  type CanaryOutcomePayload,
} from '../canary-payload.js'

function validPayload(): CanaryOutcomePayload {
  return {
    schemaVersion: CANARY_QUEUE_SCHEMA_VERSION,
    jobKind: 'canary-outcome',
    candidateId: 'fact-checkout-button-0123456789abcdef',
    runId: 'run-canary-transport',
    buildOrdinal: 42,
    stepIndex: 3,
    outcome: 'positive',
    exercisedAnchor: { t: 'el', role: 'button', name: 'Checkout' },
    attribution: 'The served checkout hypothesis was exercised by the passing step.',
    briefDigest: 'brief-digest-42',
  }
}

describe('Pin 3 canary outcome payload', () => {
  it('accepts only schema version 1 and the canary-outcome job kind', () => {
    const payload = validPayload()

    expect(canaryOutcomePayloadSchema.parse(payload)).toEqual(payload)
    expect(
      canaryOutcomePayloadSchema.safeParse({ ...payload, schemaVersion: 2 }).success,
    ).toBe(false)
    expect(
      canaryOutcomePayloadSchema.safeParse({ ...payload, jobKind: 'curation' }).success,
    ).toBe(false)
  })

  it('rejects unknown keys and outcomes outside positive or negative', () => {
    const payload = validPayload()

    expect(
      canaryOutcomePayloadSchema.safeParse({ ...payload, unexpected: true }).success,
    ).toBe(false)
    expect(
      canaryOutcomePayloadSchema.safeParse({ ...payload, outcome: 'ambiguous' }).success,
    ).toBe(false)
  })

  it('content-addresses deterministic fields independent of key order and wall clock', () => {
    const payload = validPayload()
    const first: CanaryOutcomeAddressFields = {
      ...payload,
      emittedAt: '2026-07-17T10:00:00.000Z',
    }
    const reordered = {
      emittedAt: '2026-07-18T10:00:00.000Z',
      briefDigest: payload.briefDigest,
      attribution: payload.attribution,
      exercisedAnchor: payload.exercisedAnchor,
      outcome: payload.outcome,
      stepIndex: payload.stepIndex,
      buildOrdinal: payload.buildOrdinal,
      runId: payload.runId,
      candidateId: payload.candidateId,
      jobKind: payload.jobKind,
      schemaVersion: payload.schemaVersion,
    } satisfies CanaryOutcomeAddressFields

    expect(canaryOutcomeContentAddress(first)).toBe(
      canaryOutcomeContentAddress(reordered),
    )
  })

  it('leaves existing curation payloads without a jobKind untouched', () => {
    const fields = buildCurationCandidateAddressFields({
      schemaVersion: 2,
      sourceRunId: 'run-existing-curation',
      scope: { tier: 'product', key: 'storefront' },
      buildOrdinal: 42,
      executionContext: 'local-interactive',
      secretFlagged: false,
      injectionFlagged: false,
      kind: 'fact',
      subtype: 'selector',
      anchors: [{ t: 'el', role: 'button', name: 'Checkout' }],
      summarySeed: 'Checkout selector',
      bodySeed: 'The checkout button was verified.',
      distilledObservations: [],
      evidenceToken: 'evidence-existing-curation',
      attributingObservationId: 'run-existing-curation:test-0:step-0',
      artifactInventory: [],
      captureReceipt: artifactFreeCaptureReceipt(),
      emittedAt: '2026-07-17T10:00:00.000Z',
    })
    const payload = { candidateId: candidateContentAddress(fields), ...fields }

    expect(payload).not.toHaveProperty('jobKind')
    expect(curationCandidatePayloadSchema.parse(payload)).toEqual(payload)
  })
})
