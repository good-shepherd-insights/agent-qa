import { describe, expect, it } from 'vitest'
import { asRef } from '@vostride/agent-qa-schema'
import type {
  Action,
  DeclaredModelProfile,
  ModelIdentity,
  VerifierVerdict,
} from '@vostride/agent-qa-schema'
import { makeScreenState } from '../../testing/screen-fixtures.js'
import { EvidenceRecorder } from '../evidence.js'

const clickAction: Action = { type: 'click', ref: asRef('e2') }
const passVerdict: VerifierVerdict = { pass: true, reasoning: 'goal met' }
const modelProfile: DeclaredModelProfile = {
  provider: 'openai-compatible',
  modelId: 'planner-model',
  vision: true,
  maxOutputTokens: 4096,
  sampling: { temperature: 0, topP: 0.9, stop: ['DONE'], seed: 7 },
}
const verifierIdentity: ModelIdentity = {
  provider: 'anthropic',
  modelId: 'verifier-model',
}
const toolSchemaDigest = 'a'.repeat(64)

function recorderWithCachedSubAction(options?: ConstructorParameters<typeof EvidenceRecorder>[0]) {
  const recorder = new EvidenceRecorder(options)
  recorder.recordSubAction({
    plan: 'click the login button',
    plannedAction: clickAction,
    stateBefore: makeScreenState(),
    result: { success: true },
    cached: true,
  })
  return recorder
}

describe('EvidenceRecorder decision-context stamping', () => {
  it('copies the exact profile, verifier identity, and digest onto cache-hit and bypass steps', () => {
    const options = { modelProfile, verifierIdentity, toolSchemaDigest }
    const cacheHit = recorderWithCachedSubAction(options).finalize(passVerdict, 0, 'log in')
    const bypass = recorderWithCachedSubAction(options).finalize(passVerdict, 1, 'log in', {
      nonCacheable: true,
    })

    expect(cacheHit.cacheStatus).toBe('hit')
    expect(cacheHit.modelProfile).toBe(modelProfile)
    expect(cacheHit.verifierIdentity).toBe(verifierIdentity)
    expect(cacheHit.toolSchemaDigest).toBe(toolSchemaDigest)

    expect(bypass.cacheStatus).toBe('bypass')
    expect(bypass.modelProfile).toBe(modelProfile)
    expect(bypass.verifierIdentity).toBe(verifierIdentity)
    expect(bypass.toolSchemaDigest).toBe(toolSchemaDigest)
  })

  it('degrades cleanly when the optional recording context is absent', () => {
    const evidence = recorderWithCachedSubAction().finalize(passVerdict, 0, 'log in')

    expect(evidence).not.toHaveProperty('modelProfile')
    expect(evidence).not.toHaveProperty('verifierIdentity')
    expect(evidence).not.toHaveProperty('toolSchemaDigest')
  })
})
