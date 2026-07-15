import { readFileSync } from 'node:fs'

import { describe, expect, expectTypeOf, it } from 'vitest'

import * as knowledgeLocal from '../index.js'
import {
  COMMIT_INTENT_SCHEMA_VERSION,
  commitIntentSchema,
} from '../journal/intent-journal.js'
import {
  CURATION_JOB_STATE_SCHEMA_VERSION,
  curationJobStateSchema,
} from '../queue/job-state.js'
import {
  CURATION_QUEUE_SCHEMA_VERSION,
  artifactFreeCaptureReceipt,
  buildCurationCandidateAddressFields,
  candidateContentAddress,
  curationCandidatePayloadSchema,
  curationCandidateProjectionSchema,
  curationCaptureReceiptSchema,
  type CurationCandidateAddressFields,
  type CurationCandidateProjection,
  type CurationCaptureReceipt,
} from '../queue/queue-payload.js'
import type {
  CurationArtifactDescriptor,
  CurationCandidateOmission,
  CurationCandidateRedaction,
} from '../index.js'

function legacyAddressFields(): CurationCandidateAddressFields {
  return {
    schemaVersion: CURATION_QUEUE_SCHEMA_VERSION,
    sourceRunId: 'run-queue-contract',
    scope: { tier: 'product', key: 'storefront' },
    buildOrdinal: 42,
    executionContext: 'local-interactive',
    secretFlagged: false,
    injectionFlagged: false,
    kind: 'fact',
    subtype: 'selector',
    anchors: [{ t: 'el', role: 'button', name: 'Checkout' }],
    summarySeed: 'Checkout button selector',
    bodySeed: 'The checkout button was resolved and verified.',
    distilledObservations: [
      {
        schemaVersion: 1,
        step: { naturalKey: 'checkout-click', ordinal: 0 },
        platform: 'web',
        element: { naturalKey: 'button:checkout' },
        observedAtOrdinal: 42,
      },
    ],
    evidenceToken: 'evidence-queue-contract',
    attributingObservationId: 'run-queue-contract:test-0:step-0',
    artifactInventory: [],
    emittedAt: '2026-07-15T10:00:00.000Z',
  }
}

function finalizedReceipt(): CurationCaptureReceipt {
  return {
    regions: [
      {
        stepIndex: 0,
        elementRef: 'password-input',
        role: 'textbox',
        normalizedName: 'password',
        inputType: 'password',
        reason: 'password-input',
      },
    ],
    interactions: [{ stepIndex: 0, elementRef: 'password-input' }],
    omissions: [
      {
        stepIndex: 0,
        ref: 'decision-screenshot',
        role: 'screenshot',
        originalName: 'step-0.png',
        reason: 'capture-blacklist',
      },
    ],
    redactions: [
      {
        stepIndex: 0,
        ref: 'dom-snapshot',
        role: 'dom-snapshot',
        originalName: 'step-0.dom.json',
        reason: 'capture-blacklist',
        safeSha256: 'b'.repeat(64),
      },
    ],
  }
}

describe('curation candidate projection and receipt contracts (SAFE-02)', () => {
  it('requires source descriptors, capture evidence, and interactions before copy', () => {
    const {
      schemaVersion: _schemaVersion,
      artifactInventory: _artifactInventory,
      ...projectionFields
    } = legacyAddressFields()
    void _schemaVersion
    void _artifactInventory
    const projection = curationCandidateProjectionSchema.parse({
      ...projectionFields,
      artifactDescriptors: [
        {
          ref: { id: 'decision-screenshot', sha: 'a'.repeat(64) },
          stepIndex: 0,
          role: 'screenshot',
          originalName: 'step-0.png',
        },
      ],
      captureEvidence: {
        elements: [
          {
            stepIndex: 0,
            elementRef: 'password-input',
            role: 'textbox',
            name: 'Password',
            nameNormalized: 'password',
            inputType: 'password',
            value: 'function-local-secret',
          },
        ],
      },
      stepInteractions: [{ stepIndex: 0, elementRef: 'password-input' }],
    })

    expect(projection).not.toHaveProperty('candidateId')
    expect(projection.artifactDescriptors[0]).toMatchObject({
      role: 'screenshot',
      originalName: 'step-0.png',
    })
    expect(projection.captureEvidence.elements[0]).toHaveProperty(
      'value',
      'function-local-secret',
    )
    expectTypeOf<CurationCandidateProjection>().not.toHaveProperty('candidateId')

    const required = {
      ...projection,
      artifactDescriptors: undefined,
    }
    expect(curationCandidateProjectionSchema.safeParse(required).success).toBe(false)
    expect(
      curationCandidateProjectionSchema.safeParse({
        ...projection,
        captureEvidence: undefined,
      }).success,
    ).toBe(false)
    expect(
      curationCandidateProjectionSchema.safeParse({
        ...projection,
        stepInteractions: undefined,
      }).success,
    ).toBe(false)
    expect(
      curationCandidateProjectionSchema.safeParse({
        ...projection,
        candidateId: 'c'.repeat(64),
      }).success,
    ).toBe(false)
  })

  it('accepts only strict, value-free finalized receipt facts', () => {
    const receipt = finalizedReceipt()
    expect(curationCaptureReceiptSchema.parse(receipt)).toEqual(receipt)

    for (const rawValueShapedReceipt of [
      {
        ...receipt,
        regions: [{ ...receipt.regions[0], value: 'secret' }],
      },
      {
        ...receipt,
        omissions: [{ ...receipt.omissions[0], rawValue: 'secret' }],
      },
      {
        ...receipt,
        redactions: [{ ...receipt.redactions[0], value: 'secret' }],
      },
      { ...receipt, unknown: true },
    ]) {
      expect(curationCaptureReceiptSchema.safeParse(rawValueShapedReceipt).success).toBe(
        false,
      )
    }

    expect(receipt.omissions[0]).toEqual({
      stepIndex: 0,
      ref: 'decision-screenshot',
      role: 'screenshot',
      originalName: 'step-0.png',
      reason: 'capture-blacklist',
    })
    expect(receipt.redactions[0]).toEqual({
      stepIndex: 0,
      ref: 'dom-snapshot',
      role: 'dom-snapshot',
      originalName: 'step-0.dom.json',
      reason: 'capture-blacklist',
      safeSha256: 'b'.repeat(64),
    })
  })

  it('names artifact-free capture intent with four explicit empty fact arrays', () => {
    expect(artifactFreeCaptureReceipt()).toEqual({
      regions: [],
      interactions: [],
      omissions: [],
      redactions: [],
    })
  })

  it('keeps legacy version-1 bytes parseable while the explicit builder emits the bridge', () => {
    const legacy = legacyAddressFields()
    const legacyPayload = {
      candidateId: candidateContentAddress(legacy),
      ...legacy,
    }
    expect(curationCandidatePayloadSchema.parse(legacyPayload)).toEqual(legacyPayload)

    const bridgeInput = {
      ...legacy,
      artifactInventory: [
        {
          relativePath: `artifacts/${'b'.repeat(64)}`,
          sha256: 'b'.repeat(64),
          bytes: 128,
          stepIndex: 0,
          role: 'dom-snapshot' as const,
          originalName: 'step-0.dom.json',
        },
      ],
      captureReceipt: finalizedReceipt(),
    }
    const bridge = buildCurationCandidateAddressFields(bridgeInput)
    expect(bridge).toEqual(bridgeInput)
    expectTypeOf<Parameters<typeof buildCurationCandidateAddressFields>[0]>()
      .toMatchTypeOf<{ captureReceipt: CurationCaptureReceipt }>()

    const bridgePayload = {
      candidateId: candidateContentAddress(bridge),
      ...bridge,
    }
    expect(curationCandidatePayloadSchema.parse(bridgePayload)).toEqual(bridgePayload)
    expect(bridgePayload.candidateId).not.toBe(legacyPayload.candidateId)

    const changedReceipt = buildCurationCandidateAddressFields({
      ...bridgeInput,
      captureReceipt: {
        ...bridgeInput.captureReceipt,
        interactions: [{ stepIndex: 1, elementRef: 'password-input' }],
      },
    })
    expect(candidateContentAddress(changedReceipt)).not.toBe(
      candidateContentAddress(bridge),
    )

    const missingReceipt = { ...bridgeInput } as Record<string, unknown>
    delete missingReceipt.captureReceipt
    expect(() => buildCurationCandidateAddressFields(missingReceipt as never)).toThrow()
  })
})

describe('format-local durability versions and public bridge surface', () => {
  it('keeps job-state and commit-intent bytes on independent version-1 constants', () => {
    expect(CURATION_JOB_STATE_SCHEMA_VERSION).toBe(1)
    expect(COMMIT_INTENT_SCHEMA_VERSION).toBe(1)
    expect(
      curationJobStateSchema.parse({
        schemaVersion: CURATION_JOB_STATE_SCHEMA_VERSION,
        candidateId: 'd'.repeat(64),
        lifecycle: 'queued',
        embedCrashCount: 0,
        updatedAt: '2026-07-15T10:00:00.000Z',
      }),
    ).toMatchObject({
      schemaVersion: 1,
      candidateId: 'd'.repeat(64),
      lifecycle: 'queued',
    })
    expect(
      commitIntentSchema.parse({
        schemaVersion: COMMIT_INTENT_SCHEMA_VERSION,
        candidateId: 'e'.repeat(64),
        bundleId: 'fact-checkout-button-0123456789abcdef',
        deltaKind: 'Add',
        epoch: 7,
      }),
    ).toEqual({
      schemaVersion: 1,
      candidateId: 'e'.repeat(64),
      bundleId: 'fact-checkout-button-0123456789abcdef',
      deltaKind: 'Add',
      epoch: 7,
    })

    const jobStateSource = readFileSync(
      new URL('../queue/job-state.ts', import.meta.url),
      'utf8',
    )
    const intentSource = readFileSync(
      new URL('../journal/intent-journal.ts', import.meta.url),
      'utf8',
    )
    expect(jobStateSource).not.toContain('CURATION_QUEUE_SCHEMA_VERSION')
    expect(intentSource).not.toContain('CURATION_QUEUE_SCHEMA_VERSION')
    expect(jobStateSource).toContain('CURATION_JOB_STATE_SCHEMA_VERSION')
    expect(intentSource).toContain('COMMIT_INTENT_SCHEMA_VERSION')
  })

  it('uses a named artifact-free receipt at the production synthetic constructor', () => {
    const source = readFileSync(
      new URL('../curator/knowledge-store.ts', import.meta.url),
      'utf8',
    )
    expect(source).toContain('buildCurationCandidateAddressFields')
    expect(source).toContain('artifactFreeCaptureReceipt')
    expect(source).toMatch(/captureReceipt:\s*artifactFreeCaptureReceipt\(\)/u)
  })

  it('exports every queue migration contract and durability version from the barrel', () => {
    const surface = knowledgeLocal as unknown as Record<string, unknown>
    for (const symbol of [
      'artifactFreeCaptureReceipt',
      'buildCurationCandidateAddressFields',
    ]) {
      expect(surface[symbol], symbol).toBeTypeOf('function')
    }
    for (const symbol of [
      'curationArtifactDescriptorSchema',
      'curationCandidateOmissionSchema',
      'curationCandidateProjectionSchema',
      'curationCandidateRedactionSchema',
      'curationCaptureReceiptSchema',
    ]) {
      expect(surface[symbol], symbol).toBeTypeOf('object')
    }
    expect(surface.CURATION_JOB_STATE_SCHEMA_VERSION).toBe(1)
    expect(surface.COMMIT_INTENT_SCHEMA_VERSION).toBe(1)

    expectTypeOf<CurationArtifactDescriptor>().toHaveProperty('originalName')
    expectTypeOf<CurationCandidateOmission>().not.toHaveProperty('value')
    expectTypeOf<CurationCandidateRedaction>().toHaveProperty('safeSha256')
  })
})
