import { sha256hex } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { canonicalJson } from '../../canonical-json'
import { committedFileText } from '../../labels/committed-file'
import {
  BASELINE_POINTER_SCHEMA_VERSION,
  SEED_POLICIES,
  composeBaselineProfileKey,
  computeReplayProfileFingerprint,
  guardBaselinePointer,
  projectBaselinePointer,
  type ReplayProfileFingerprintInput,
} from '../profile-key'

const pointerInput = {
  plannerModelId: 'gpt-5.6-terra',
  fingerprint: 'abc',
  matcherVersion: 1,
  batchKey: 'batch-fixture',
  corpusDigest: 'digest-fixture',
}

const legacyPointer = {
  schemaVersion: 1,
  profileKey: 'planner=gpt-5.6-terra|matcher=1|judge=none|judgeVersion=none',
  batchKey: 'batch-fixture',
  plannerModelId: 'gpt-5.6-terra',
  matcherVersion: 1,
}

describe('baseline pointer v2 (415 D-11)', () => {
  it('includes the fingerprint as the second profile-key segment', () => {
    expect(composeBaselineProfileKey(pointerInput)).toBe(
      'planner=gpt-5.6-terra|fingerprint=abc|matcher=1|judge=none|judgeVersion=none',
    )
  })

  it('projects byte-stable v2 pointers with required fingerprint and corpus digest', () => {
    const pointer = projectBaselinePointer(pointerInput)
    expect(BASELINE_POINTER_SCHEMA_VERSION).toBe(2)
    expect(pointer).toEqual({
      ...pointerInput,
      schemaVersion: 2,
      profileKey: composeBaselineProfileKey(pointerInput),
    })
    expect(committedFileText(pointer)).toBe(
      committedFileText(projectBaselinePointer(pointerInput)),
    )
    expect(guardBaselinePointer(pointer)).toEqual({ kind: 'v2', pointer })
  })

  it('admits the v1 history shape without inventing a fingerprint', () => {
    const { schemaVersion: _schemaVersion, ...pointer } = legacyPointer
    expect(guardBaselinePointer(legacyPointer)).toEqual({ kind: 'v1', pointer })
    expect(
      guardBaselinePointer({ ...legacyPointer, judgeModelId: 'judge-fixture', judgeVersion: 1 }),
    ).toEqual({
      kind: 'v1',
      pointer: { ...pointer, judgeModelId: 'judge-fixture', judgeVersion: 1 },
    })
  })

  it.each([
    ['unknown version', { ...legacyPointer, schemaVersion: 3 }],
    ['missing batch key', { ...legacyPointer, batchKey: undefined }],
    ['v1 unknown field', { ...legacyPointer, fingerprint: 'undeclared' }],
    ['v2 unknown field', { ...pointerInput, schemaVersion: 2, profileKey: 'p', extra: true }],
    ['v2 missing fingerprint', { ...legacyPointer, schemaVersion: 2, corpusDigest: 'digest' }],
    ['v2 missing corpus digest', { ...legacyPointer, schemaVersion: 2, fingerprint: 'abc' }],
    ['null body', null],
  ])('rejects %s with a typed reason', (_name, value) => {
    expect(guardBaselinePointer(value)).toEqual({
      kind: 'rejected',
      reason: expect.any(String),
    })
  })
})

describe('resolved replay profile fingerprint (415 D-11)', () => {
  const input: ReplayProfileFingerprintInput = {
    provider: 'openai',
    modelId: 'gpt-5.6-terra',
    temperature: 0,
    seedPolicy: 'declared',
    capabilities: { vision: true, maxOutputTokens: 4096 },
    modelOverrideKeys: [],
  }

  it('uses the canonical SHA-256 recipe deterministically', () => {
    const digest = computeReplayProfileFingerprint(input)
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    expect(digest).toBe(sha256hex(canonicalJson(input)))
    expect(computeReplayProfileFingerprint(input)).toBe(digest)
  })

  it.each<Partial<ReplayProfileFingerprintInput>>([
    { provider: 'anthropic' },
    { modelId: 'other-model' },
    { temperature: 1 },
    { seedPolicy: 'none' },
    { capabilities: { vision: false, maxOutputTokens: 4096 } },
    { capabilities: { vision: true, maxOutputTokens: 8192 } },
    { capabilities: { vision: true } },
    { modelOverrideKeys: ['stub-model'] },
  ])('changes when a resolved input changes: %j', change => {
    expect(computeReplayProfileFingerprint({ ...input, ...change })).not.toBe(
      computeReplayProfileFingerprint(input),
    )
  })

  it('ignores object-key insertion order, including capabilities', () => {
    expect(
      computeReplayProfileFingerprint({
        modelOverrideKeys: [],
        capabilities: { maxOutputTokens: 4096, vision: true },
        seedPolicy: 'declared',
        temperature: 0,
        modelId: 'gpt-5.6-terra',
        provider: 'openai',
      }),
    ).toBe(computeReplayProfileFingerprint(input))
  })

  it('publishes exactly the two seed policies', () => {
    expect(SEED_POLICIES).toEqual(['none', 'declared'])
  })
})
