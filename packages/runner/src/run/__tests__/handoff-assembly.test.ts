import { describe, expect, it } from 'vitest'

import type {
  DeclaredModelProfile,
  ModelIdentity,
  RunId,
  ScopeKey,
} from '@vostride/agent-qa-schema'
import type { RunConfig, RunMemberDescriptor } from '../ports.js'
import type { TestResult } from '../../result.js'
import { assembleHandoff, assemblePerTestOutcome } from '../handoff-assembly.js'
import { startRun } from '../shell.js'

const scope: ScopeKey = { tier: 'suite', key: 'checkout' }
const member: RunMemberDescriptor = { testId: 'checkout' }
const modelProfile: DeclaredModelProfile = {
  provider: 'openai-compatible',
  modelId: 'planner-model',
  vision: true,
  maxOutputTokens: 4096,
}
const verifierIdentity: ModelIdentity = {
  provider: 'anthropic-compatible',
  modelId: 'verifier-model',
}

function resultWithoutEvidence(): TestResult {
  return {
    name: 'checkout',
    filePath: 'checkout.test.ts',
    status: 'passed',
    duration: 1,
    steps: [{ name: 'submit order', status: 'passed', duration: 1 }],
  }
}

describe('handoff assembly instrumentation parity', () => {
  it('copies profile, verifier identity, and digest onto synthesized step evidence', () => {
    const outcome = assemblePerTestOutcome(member, resultWithoutEvidence(), 'passed', {
      testIndex: 0,
      scope,
      buildOrdinal: 7,
      mask: (text) => text,
      modelProfile,
      verifierIdentity,
      toolSchemaDigest: 'digest-1',
    })

    expect(outcome.steps[0].modelProfile).toBe(modelProfile)
    expect(outcome.steps[0].verifierIdentity).toBe(verifierIdentity)
    expect(outcome.steps[0].toolSchemaDigest).toBe('digest-1')
  })

  it('omits instrumentation fields cleanly when synthesis dependencies are absent', () => {
    const outcome = assemblePerTestOutcome(member, resultWithoutEvidence(), 'passed', {
      testIndex: 0,
      scope,
      buildOrdinal: 7,
      mask: (text) => text,
    })

    expect(outcome.steps[0]).not.toHaveProperty('modelProfile')
    expect(outcome.steps[0]).not.toHaveProperty('verifierIdentity')
    expect(outcome.steps[0]).not.toHaveProperty('toolSchemaDigest')
  })

  it('threads member-start evidence context through the shell synthesis call site', async () => {
    const config = {
      runId: 'run-1' as RunId,
      scope,
      executionContext: 'local-headless',
      configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
      buildOrdinal: 7,
      members: [member],
      executor: async (_member, context) => {
        context.setEvidenceContext({ modelProfile, verifierIdentity, toolSchemaDigest: 'digest-1' })
        return resultWithoutEvidence()
      },
    } satisfies RunConfig

    const { handoff } = await startRun(config).done
    const evidence = handoff.tests[0].steps[0]

    expect(evidence.modelProfile).toBe(modelProfile)
    expect(evidence.verifierIdentity).toBe(verifierIdentity)
    expect(evidence.toolSchemaDigest).toBe('digest-1')
  })

  it('stamps assembled handoffs with schemaVersion 3 (373-01 rootCause bump)', () => {
    const config = {
      runId: 'run-1' as RunId,
      scope,
      executionContext: 'local-headless',
      configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
      buildOrdinal: 7,
      members: [],
      executor: async () => resultWithoutEvidence(),
    } satisfies RunConfig

    const handoff = assembleHandoff(config, [], 'passed', { startedAt: 1, endedAt: 2 })

    expect(handoff.schemaVersion).toBe(3)
  })
})
