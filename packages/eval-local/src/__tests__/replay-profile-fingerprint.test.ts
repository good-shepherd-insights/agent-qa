import { computeReplayProfileFingerprint } from '@vostride/agent-qa-eval'
import { createModel, resolveCapabilities } from '@vostride/agent-qa-model'
import type { ModelProfile } from '@vostride/agent-qa-model'
import { describe, expect, it, vi } from 'vitest'

import { computeReplayProfileFingerprintFor } from '../replay-composition.js'
import { throwingStub } from './fixtures/replay-fixtures.js'

vi.mock('@vostride/agent-qa-model', async importOriginal => {
  const actual = await importOriginal<typeof import('@vostride/agent-qa-model')>()
  return {
    ...actual,
    resolveCapabilities: vi.fn(actual.resolveCapabilities),
    createModel: vi.fn(() => {
      throw new Error('fingerprinting must not create a model')
    }),
  }
})

const STUB_MODEL_ID = 'replay-composition-stub'

function stubProfile(): ModelProfile {
  return {
    provider: 'openai-compatible',
    model: STUB_MODEL_ID,
    baseURL: 'http://localhost:11434/v1',
    auth: { mode: 'none' },
  }
}

describe('computeReplayProfileFingerprintFor (415 D-11)', () => {
  it('hashes exactly the resolved temperature-zero replay profile without creating a model', () => {
    const profile = stubProfile()
    const capabilities = resolveCapabilities(profile)
    const fingerprint = computeReplayProfileFingerprintFor({ profile, seedPolicy: 'declared' })
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(fingerprint).toBe(
      computeReplayProfileFingerprint({
        provider: profile.provider,
        modelId: profile.model,
        temperature: 0,
        seedPolicy: 'declared',
        capabilities: {
          vision: capabilities.vision,
          ...(capabilities.maxOutput === undefined
            ? {}
            : { maxOutputTokens: capabilities.maxOutput }),
        },
        modelOverrideKeys: [],
      }),
    )
    expect(createModel).not.toHaveBeenCalled()
  })

  it('keys the seed policy, while two seed values and provider disclosures share a profile', () => {
    const profile = stubProfile()
    const first = { profile, seedPolicy: 'declared' as const, seed: 17, system_fingerprint: 'a' }
    const second = { ...first, seed: 29, system_fingerprint: 'b' }
    expect(computeReplayProfileFingerprintFor(first)).toBe(computeReplayProfileFingerprintFor(second))
    expect(computeReplayProfileFingerprintFor(first)).not.toBe(
      computeReplayProfileFingerprintFor({ profile, seedPolicy: 'none' }),
    )
  })

  it('keys sorted override names, independent of insertion order and model object identity', () => {
    const input = { profile: stubProfile(), seedPolicy: 'declared' as const }
    const stub = throwingStub(STUB_MODEL_ID).languageModels[STUB_MODEL_ID]!
    const forward = computeReplayProfileFingerprintFor({
      ...input,
      modelOverrides: { languageModels: { [STUB_MODEL_ID]: stub, 'another-stub': stub } },
    })
    const reverse = computeReplayProfileFingerprintFor({
      ...input,
      modelOverrides: {
        languageModels: {
          'another-stub': throwingStub('another-stub').languageModels['another-stub']!,
          [STUB_MODEL_ID]: stub,
        },
      },
    })
    expect(forward).toBe(reverse)
    expect(forward).not.toBe(computeReplayProfileFingerprintFor(input))
    expect(forward).not.toBe(
      computeReplayProfileFingerprintFor({
        ...input,
        modelOverrides: { languageModels: { [STUB_MODEL_ID]: stub } },
      }),
    )
  })

  it('resolves a fresh profile and capabilities copy, leaving the caller untouched', () => {
    const profile = stubProfile()
    profile.capabilities = Object.freeze({
      ...resolveCapabilities(profile), vision: true, maxOutput: 2048,
    })
    Object.freeze(profile)
    const before = structuredClone(profile)
    const fingerprint = computeReplayProfileFingerprintFor({ profile, seedPolicy: 'none' })
    const resolvedCopy = vi.mocked(resolveCapabilities).mock.calls.at(-1)![0]
    expect(resolvedCopy).not.toBe(profile)
    expect(resolvedCopy.capabilities).not.toBe(profile.capabilities)
    expect(profile).toEqual(before)
    expect(fingerprint).not.toBe(
      computeReplayProfileFingerprintFor({
        profile: { ...profile, capabilities: { ...profile.capabilities!, vision: false } },
        seedPolicy: 'none',
      }),
    )
  })
})
