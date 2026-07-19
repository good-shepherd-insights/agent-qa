import { describe, expect, it } from 'vitest'

import type {
  DeclaredModelProfile,
  ModelIdentity,
  RunId,
  ScopeKey,
  StepEvidence,
  Verdict,
} from '@vostride/agent-qa-schema'
import { asRecordId, guardCompletedRunHandoff } from '@vostride/agent-qa-schema'
import type { RunConfig, RunMemberDescriptor } from '../ports.js'
import type { TestResult } from '../../result.js'
import { assembleHandoff, assemblePerTestOutcome, skippedPerTestOutcome } from '../handoff-assembly.js'
import { makeEmptyServedBrief } from '../../loop/evidence.js'
import { startRun } from '../shell.js'

const scope: ScopeKey = { tier: 'suite', key: 'checkout' }
const member: RunMemberDescriptor = {
  testId: 'checkout-guest-1',
  name: 'Guest checkout with promo',
  filePath: 'checkout.spec.yaml',
}
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

  it('persists the durable outcome-exclusion marker only when the run config opts in', () => {
    const ordinaryConfig = {
      runId: 'run-ordinary' as RunId,
      scope,
      executionContext: 'local-headless',
      configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
      buildOrdinal: 7,
      members: [],
      executor: async () => resultWithoutEvidence(),
    } satisfies RunConfig
    const excludedConfig = {
      ...ordinaryConfig,
      runId: 'run-gate' as RunId,
      excludedFromOutcomes: true,
    } satisfies RunConfig

    const ordinary = assembleHandoff(ordinaryConfig, [], 'passed', {
      startedAt: 1,
      endedAt: 2,
    })
    const excluded = assembleHandoff(excludedConfig, [], 'passed', {
      startedAt: 1,
      endedAt: 2,
    })

    expect(ordinary).not.toHaveProperty('excludedFromOutcomes')
    expect(excluded.excludedFromOutcomes).toBe(true)
    expect(JSON.parse(JSON.stringify(excluded))).toHaveProperty('excludedFromOutcomes', true)
  })
})

describe('§A9 rootCause attach (373-07, D-01 presence rule)', () => {
  const environmentVerdict: Verdict = {
    class: 'environment',
    producer: 'deterministic-classifier',
    confidence: 1,
    evidence: {
      citedSteps: [0],
      citedAnchors: [],
      citedArtifacts: [],
      rationale: 'health probe: 503 in 230ms',
    },
    memoryMisdirectionRuledOut: true,
    perTest: 0,
  }

  it('carries a supplied verdict verbatim onto the assembled outcome', () => {
    const outcome = assemblePerTestOutcome(
      member,
      resultWithoutEvidence(),
      'failed',
      { testIndex: 0, scope, buildOrdinal: 7, mask: (text) => text },
      environmentVerdict,
    )

    expect(outcome.rootCause).toBe(environmentVerdict)
  })

  it('leaves the rootCause key ABSENT (not undefined-valued) when no verdict is supplied', () => {
    const outcome = assemblePerTestOutcome(member, resultWithoutEvidence(), 'passed', {
      testIndex: 0,
      scope,
      buildOrdinal: 7,
      mask: (text) => text,
    })

    expect('rootCause' in outcome).toBe(false)
    expect(JSON.stringify(outcome)).not.toContain('rootCause')
  })

  it('keeps the handoff top-level shape unchanged — rootCause rides tests[] only (D-01)', () => {
    const config = {
      runId: 'run-1' as RunId,
      scope,
      executionContext: 'local-headless',
      configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
      buildOrdinal: 7,
      members: [member],
      executor: async () => resultWithoutEvidence(),
    } satisfies RunConfig
    const perTest = assemblePerTestOutcome(
      member,
      resultWithoutEvidence(),
      'failed',
      { testIndex: 0, scope, buildOrdinal: 7, mask: (text) => text },
      environmentVerdict,
    )

    const handoff = assembleHandoff(config, [perTest], 'failed', { startedAt: 1, endedAt: 2 })

    expect(Object.keys(handoff).sort()).toEqual([
      'aggregateVerdict',
      'buildOrdinal',
      'configDigests',
      'endedAt',
      'executionContext',
      'runId',
      'schemaVersion',
      'scope',
      'startedAt',
      'tests',
    ])
  })
})

describe('stable test identity — filePath + human testName (ABRF-02, WR-02)', () => {
  it('populates filePath and human testName from the descriptor on assembled outcomes', () => {
    const outcome = assemblePerTestOutcome(member, resultWithoutEvidence(), 'passed', {
      testIndex: 0,
      scope,
      buildOrdinal: 7,
      mask: (text) => text,
    })

    expect(outcome.filePath).toBe('checkout.spec.yaml')
    expect(outcome.testName).toBe('Guest checkout with promo')
    expect(outcome.testName).not.toBe(outcome.testId)
  })

  it('populates filePath and human testName from the descriptor on skipped outcomes', () => {
    const skipped = skippedPerTestOutcome(member, 3)

    expect(skipped.filePath).toBe('checkout.spec.yaml')
    expect(skipped.testName).toBe('Guest checkout with promo')
    expect(skipped.testName).not.toBe(skipped.testId)
    expect(skipped.outcome).toBe('skipped')
  })
})

describe('StepEvidence.planSource marker (D-12)', () => {
  const procedureId = asRecordId('procedure-flow-login-0123456789abcdef')

  function evidenceWith(planSource: NonNullable<StepEvidence['planSource']>): StepEvidence {
    return {
      stepIndex: 0,
      stepText: 'log in',
      cacheStatus: 'miss',
      servedBrief: makeEmptyServedBrief(scope, 7),
      subActions: [],
      verifierVerdict: { pass: true, reasoning: 'ok' },
      planSource,
    }
  }

  it('both variants typecheck and survive a handoff JSON round-trip through the one guard', () => {
    const replayStep = evidenceWith({
      kind: 'procedure-replay',
      procedureId,
      guard: { checksPassed: 3, total: 3 },
    })
    const hintStep = evidenceWith({ kind: 'procedure-hint', procedureId })
    const config = {
      runId: 'run-1' as RunId,
      scope,
      executionContext: 'local-headless',
      configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
      buildOrdinal: 7,
      members: [member],
      executor: async () => resultWithoutEvidence(),
    } satisfies RunConfig
    const perTest = {
      testId: 'checkout-guest-1',
      testName: 'Guest checkout with promo',
      testIndex: 0,
      filePath: 'checkout.spec.yaml',
      outcome: 'passed' as const,
      steps: [replayStep, hintStep],
    }

    const handoff = assembleHandoff(config, [perTest], 'passed', { startedAt: 1, endedAt: 2 })
    const reloaded = guardCompletedRunHandoff(JSON.parse(JSON.stringify(handoff)))

    expect(reloaded.tests[0].steps[0].planSource).toEqual({
      kind: 'procedure-replay',
      procedureId,
      guard: { checksPassed: 3, total: 3 },
    })
    expect(reloaded.tests[0].steps[1].planSource).toEqual({ kind: 'procedure-hint', procedureId })
    // the D-12 separation: planSource never pollutes the cached-provenance surface
    expect(reloaded.tests[0].steps[0].cacheStatus).toBe('miss')
  })

  it('records a guard miss on the replay variant', () => {
    const step = evidenceWith({
      kind: 'procedure-replay',
      procedureId,
      guard: {
        checksPassed: 1,
        total: 3,
        miss: { procedureStepIndex: 1, reason: 'descriptor-ambiguous' },
      },
    })

    expect(step.planSource?.kind).toBe('procedure-replay')
    expect(
      step.planSource?.kind === 'procedure-replay' ? step.planSource.guard.miss?.reason : undefined,
    ).toBe('descriptor-ambiguous')
  })
})
