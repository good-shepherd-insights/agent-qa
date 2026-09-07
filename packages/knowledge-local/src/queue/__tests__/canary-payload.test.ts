import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asRecordId, canonicalJson, sha256hex } from '@vostride/agent-qa-schema'
import { enqueueCanaryOutcome } from '../canary-queue.js'
import { queuedRoot } from '../queue-layout.js'

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
  readQueuedCanaryPayload,
  PAYLOAD_BENEFITS,
  PAYLOAD_STATE_VALIDITIES,
  type CanaryOutcomePayloadV2,
  type CanaryOutcomeAddressFields,
  type CanaryOutcomePayload,
} from '../canary-payload.js'

function validPayload(): CanaryOutcomePayload {
  return {
    schemaVersion: CANARY_QUEUE_SCHEMA_VERSION,
    jobKind: 'canary-outcome',
    candidateId: 'fact-checkout-button-0123456789abcdef',
    runId: 'run-canary-transport',
    testId: 'checkout::happy-path',
    testIndex: 1,
    buildOrdinal: 42,
    stepIndex: 3,
    outcome: 'positive',
    benefit: 'rode-along',
    stateValidity: 'unknown',
    exercisedAnchor: { t: 'el', role: 'button', name: 'Checkout' },
    attribution: 'The served checkout hypothesis was exercised by the passing step.',
    briefDigest: 'brief-digest-42',
  }
}

function validV2Payload(): CanaryOutcomePayloadV2 {
  return {
    schemaVersion: 2,
    jobKind: 'canary-outcome',
    candidateId: 'fact-checkout-button-0123456789abcdef',
    runId: 'run-canary-transport',
    testId: 'checkout::happy-path',
    testIndex: 1,
    buildOrdinal: 42,
    stepIndex: 3,
    outcome: 'positive',
    exercisedAnchor: { t: 'el', role: 'button', name: 'Checkout' },
    attribution: 'The served checkout hypothesis was exercised by the passing step.',
    briefDigest: 'brief-digest-42',
  }
}

describe('Pin 3 canary outcome payload', () => {
  it('enqueueCanaryOutcome writes v3 payload.json with attribution authority', () => {
    const root = mkdtempSync(join(tmpdir(), 'canary-v3-payload-'))
    try {
      const { schemaVersion: _version, jobKind: _kind, outcome, candidateId, ...fields } = validPayload()
      const result = enqueueCanaryOutcome(root, {
        ...fields, candidateId: asRecordId(candidateId), runOutcome: outcome,
      })
      const bytes = readFileSync(join(queuedRoot(root), result.entryId, 'payload.json'), 'utf8')
      expect(JSON.parse(bytes)).toEqual(validPayload())
      expect(bytes).toBe(`${canonicalJson(validPayload())}\n`)
      expect(JSON.parse(bytes)).not.toHaveProperty('ablation')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('validates and content-addresses every optional attribution evidence field', () => {
    const ablation = {
      crossCheck: 'flipped' as const, k: 3, baseSeed: 42, seeds: [42, 43, 44], seedHonored: true,
      spend: { modelCalls: 5, screens: 1, promptTokens: 20, completionTokens: 10 },
    }
    const payload = {
      ...validPayload(), corpusDigest: 'a'.repeat(64), observedStateDigest: 'b'.repeat(64), ablation,
    }
    expect(readQueuedCanaryPayload(payload)).toEqual({ kind: 'v3', payload })
    for (const changed of [
      { benefit: 'exercised-benefited' as const }, { stateValidity: 'valid' as const },
      { corpusDigest: 'c'.repeat(64) }, { observedStateDigest: 'd'.repeat(64) },
      { ablation: { ...ablation, seedHonored: false } },
    ]) expect(canaryOutcomeContentAddress({ ...payload, ...changed })).not.toBe(canaryOutcomeContentAddress(payload))
    for (const invalid of [
      { corpusDigest: 'bad' }, { observedStateDigest: 'A'.repeat(64) },
      { ablation: { ...ablation, k: 2 } }, { ablation: { ...ablation, crossCheck: 'invented' } },
      { ablation: { ...ablation, spend: { ...ablation.spend, modelCalls: -1 } } },
      { ablation: { ...ablation, spend: { ...ablation.spend, extra: 1 } } },
    ]) expect(readQueuedCanaryPayload({ ...payload, ...invalid }).kind).toBe('refused')
  })
  it('queued payload.json is governed by the closed benefit, stateValidity and outcome words, in declaration order', () => {
    expect([...PAYLOAD_BENEFITS]).toEqual(['exercised-benefited', 'rode-along', 'exercised-harmed'])
    expect([...PAYLOAD_STATE_VALIDITIES]).toEqual(['valid', 'stale', 'unknown'])
    expect(canaryOutcomePayloadSchema.shape.benefit.options).toEqual(PAYLOAD_BENEFITS)
    expect(canaryOutcomePayloadSchema.shape.stateValidity.options).toEqual(PAYLOAD_STATE_VALIDITIES)
    expect(canaryOutcomePayloadSchema.shape.outcome.options).toEqual(['positive', 'negative'])
  })

  it('reads a literal v2 payload through the load guard as rode-along / unknown', () => {
    expect(readQueuedCanaryPayload(validV2Payload())).toEqual({
      kind: 'v2-filled', original: validV2Payload(), payload: validPayload(),
    })
    expect(readQueuedCanaryPayload(validPayload())).toEqual({ kind: 'v3', payload: validPayload() })
    expect(readQueuedCanaryPayload({ ...validV2Payload(), schemaVersion: 1 }).kind).toBe('refused')
    expect(readQueuedCanaryPayload({ ...validV2Payload(), benefit: 'exercised-benefited' }).kind).toBe('refused')
  })

  it('a v2 payload keeps its v2 content address after the fill', () => {
    const read = readQueuedCanaryPayload(validV2Payload())
    expect(read.kind).toBe('v2-filled')
    if (read.kind !== 'v2-filled') throw new Error('Expected legacy payload')
    expect(canaryOutcomeContentAddress(read.original)).toBe(canaryOutcomeContentAddress(validV2Payload()))
    expect(canaryOutcomeContentAddress(read.original)).toBe(sha256hex(canonicalJson(validV2Payload())))
    expect(canaryOutcomeContentAddress(read.payload)).not.toBe(canaryOutcomeContentAddress(read.original))
  })

  it('refuses a v3 payload missing benefit or carrying an unknown key', () => {
    const { benefit: _benefit, ...missing } = validPayload()
    expect(readQueuedCanaryPayload(missing).kind).toBe('refused')
    expect(readQueuedCanaryPayload({ ...validPayload(), unknown: true }).kind).toBe('refused')
    expect(readQueuedCanaryPayload({ ...validPayload(), stateValidity: undefined }).kind).toBe('refused')
  })

  it('accepts only schema version 3 and the canary-outcome job kind', () => {
    const payload = validPayload()

    expect(canaryOutcomePayloadSchema.parse(payload)).toEqual(payload)
    expect(canaryOutcomePayloadSchema.safeParse(validV2Payload()).success).toBe(false)
    expect(
      canaryOutcomePayloadSchema.safeParse({ ...payload, schemaVersion: 1 }).success,
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
      benefit: payload.benefit,
      stateValidity: payload.stateValidity,
      stepIndex: payload.stepIndex,
      buildOrdinal: payload.buildOrdinal,
      testIndex: payload.testIndex,
      testId: payload.testId,
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
