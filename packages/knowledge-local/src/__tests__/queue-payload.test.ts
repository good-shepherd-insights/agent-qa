import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, expectTypeOf, it } from 'vitest'

import * as knowledgeLocal from '../index.js'
import {
  COMMIT_INTENT_SCHEMA_VERSION,
  commitIntentSchema,
  listCommitIntents,
  writeCommitIntent,
} from '../journal/intent-journal.js'
import {
  CURATION_JOB_STATE_SCHEMA_VERSION,
  curationJobStateSchema,
  readJobState,
  writeJobState,
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

function bridgeAddressInput(): Parameters<
  typeof buildCurationCandidateAddressFields
>[0] {
  return {
    ...legacyAddressFields(),
    artifactInventory: [
      {
        relativePath: `artifacts/${'b'.repeat(64)}`,
        sha256: 'b'.repeat(64),
        bytes: 128,
        stepIndex: 0,
        role: 'dom-snapshot',
        originalName: 'step-0.dom.json',
      },
    ],
    captureReceipt: {
      regions: [],
      interactions: [{ stepIndex: 0, elementRef: 'password-input' }],
      omissions: [],
      redactions: [],
    },
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
    const legacyBytes = Buffer.from(JSON.stringify(legacy), 'utf8')
    const parsedLegacy = JSON.parse(legacyBytes.toString('utf8')) as unknown
    const legacyPayload = {
      candidateId: candidateContentAddress(legacy),
      ...(parsedLegacy as CurationCandidateAddressFields),
    }
    expect(curationCandidatePayloadSchema.parse(legacyPayload)).toEqual(legacyPayload)

    const bridgeInput = bridgeAddressInput()
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

  it('addresses every populated safety fact while excluding only emittedAt', () => {
    const input = bridgeAddressInput()
    const baseline = buildCurationCandidateAddressFields(input)
    const baselineId = candidateContentAddress(baseline)
    const artifact = input.artifactInventory[0]!
    const changedDigest = 'c'.repeat(64)

    const variants = [
      buildCurationCandidateAddressFields({
        ...input,
        artifactInventory: [
          {
            ...artifact,
            relativePath: `artifacts/${changedDigest}`,
            sha256: changedDigest,
          },
        ],
      }),
      buildCurationCandidateAddressFields({
        ...input,
        artifactInventory: [{ ...artifact, role: 'ax-snapshot' }],
      }),
      buildCurationCandidateAddressFields({
        ...input,
        artifactInventory: [{ ...artifact, originalName: 'step-0.safe.dom.json' }],
      }),
      buildCurationCandidateAddressFields({
        ...input,
        captureReceipt: {
          ...input.captureReceipt,
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
        },
      }),
      buildCurationCandidateAddressFields({
        ...input,
        captureReceipt: {
          ...input.captureReceipt,
          interactions: [{ stepIndex: 1, elementRef: 'password-input' }],
        },
      }),
      buildCurationCandidateAddressFields({
        ...input,
        captureReceipt: {
          ...input.captureReceipt,
          omissions: [
            {
              stepIndex: 0,
              ref: 'decision-screenshot',
              role: 'screenshot',
              originalName: 'step-0.png',
              reason: 'capture-blacklist',
            },
          ],
        },
      }),
      buildCurationCandidateAddressFields({
        ...input,
        captureReceipt: {
          ...input.captureReceipt,
          redactions: [
            {
              stepIndex: artifact.stepIndex,
              ref: 'dom-snapshot',
              role: 'dom-snapshot',
              originalName: artifact.originalName,
              reason: 'capture-blacklist',
              safeSha256: artifact.sha256,
            },
          ],
        },
      }),
      buildCurationCandidateAddressFields({ ...input, injectionFlagged: true }),
    ]

    for (const variant of variants) {
      expect(candidateContentAddress(variant)).not.toBe(baselineId)
    }
    expect(
      candidateContentAddress(
        buildCurationCandidateAddressFields({
          ...input,
          emittedAt: '2099-01-01T00:00:00.000Z',
        }),
      ),
    ).toBe(baselineId)
  })

  it('rejects unknown and raw-value-shaped bridge keys at every finalized boundary', () => {
    const input = bridgeAddressInput()
    const receipt = input.captureReceipt
    const omission = {
      stepIndex: 0,
      ref: 'decision-screenshot',
      role: 'screenshot' as const,
      originalName: 'step-0.png',
      reason: 'capture-blacklist' as const,
    }
    const redaction = {
      stepIndex: 0,
      ref: 'dom-snapshot',
      role: 'dom-snapshot' as const,
      originalName: input.artifactInventory[0]!.originalName,
      reason: 'capture-blacklist' as const,
      safeSha256: input.artifactInventory[0]!.sha256,
    }
    const invalidInputs: unknown[] = [
      { ...input, captureReceipt: { ...receipt, rawValue: 'secret' } },
      {
        ...input,
        captureReceipt: {
          ...receipt,
          regions: [
            {
              stepIndex: 0,
              elementRef: 'password-input',
              role: 'textbox',
              normalizedName: 'password',
              reason: 'credential-name',
              value: 'secret',
            },
          ],
        },
      },
      {
        ...input,
        captureReceipt: {
          ...receipt,
          interactions: [{ ...receipt.interactions[0]!, rawValue: 'secret' }],
        },
      },
      {
        ...input,
        captureReceipt: { ...receipt, omissions: [{ ...omission, value: 'secret' }] },
      },
      {
        ...input,
        captureReceipt: { ...receipt, redactions: [{ ...redaction, rawValue: 'secret' }] },
      },
      {
        ...input,
        artifactInventory: [{ ...input.artifactInventory[0]!, value: 'secret' }],
      },
    ]

    for (const invalid of invalidInputs) {
      expect(() => buildCurationCandidateAddressFields(invalid as never)).toThrow()
    }
  })
})

describe('format-local durability versions and public bridge surface', () => {
  it('keeps job-state and commit-intent bytes on independent version-1 constants', () => {
    expect(CURATION_QUEUE_SCHEMA_VERSION).toBe(1)
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
    const queueSource = readFileSync(
      new URL('../queue/queue-payload.ts', import.meta.url),
      'utf8',
    )
    expect(queueSource).toMatch(/export const CURATION_QUEUE_SCHEMA_VERSION = 1\b/u)
    expect(queueSource).not.toMatch(/CURATION_QUEUE_SCHEMA_VERSION\s*=\s*2\b/u)
    expect(jobStateSource).not.toContain('CURATION_QUEUE_SCHEMA_VERSION')
    expect(intentSource).not.toContain('CURATION_QUEUE_SCHEMA_VERSION')
    expect(jobStateSource).toContain('CURATION_JOB_STATE_SCHEMA_VERSION')
    expect(intentSource).toContain('COMMIT_INTENT_SCHEMA_VERSION')
  })

  it('round-trips queue, job-state, and commit-intent bytes under separate v1 authorities', () => {
    const root = mkdtempSync(join(tmpdir(), 'curation-version-roundtrip-'))
    const candidateId = 'd'.repeat(64)
    try {
      const fields = buildCurationCandidateAddressFields(bridgeAddressInput())
      const payload = { candidateId: candidateContentAddress(fields), ...fields }
      expect(
        curationCandidatePayloadSchema.parse(JSON.parse(JSON.stringify(payload))),
      ).toEqual(payload)

      writeJobState({
        knowledgeRoot: root,
        candidateId,
        lifecycle: 'queued',
      })
      expect(readJobState(root, candidateId)).toMatchObject({
        kind: 'parsed',
        state: { schemaVersion: 1, candidateId, lifecycle: 'queued' },
      })

      writeCommitIntent(root, {
        schemaVersion: COMMIT_INTENT_SCHEMA_VERSION,
        candidateId,
        bundleId: 'fact-checkout-button-0123456789abcdef',
        deltaKind: 'Add',
        epoch: 7,
      })
      expect(listCommitIntents(root)).toEqual([
        {
          parsed: {
            schemaVersion: 1,
            candidateId,
            bundleId: 'fact-checkout-button-0123456789abcdef',
            deltaKind: 'Add',
            epoch: 7,
          },
        },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
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
