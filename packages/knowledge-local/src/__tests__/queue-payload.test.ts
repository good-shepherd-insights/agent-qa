import { describe, expect, expectTypeOf, it } from 'vitest'

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
