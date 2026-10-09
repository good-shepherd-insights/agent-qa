import { asRef, screenStateHash, sha256hex } from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  PerTestOutcome,
  RecordedActionResult,
  ScreenState,
  StepEvidence,
  SubActionEvidence,
  Verdict,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../../canonical-json'
import { buildSeedingPlan } from '../seeding-plan'
import { collectSoftPopulation } from '../soft-population'

const skippedTap: RecordedActionResult = {
  success: false,
  metadata: { idempotentNoop: { currentState: 'checked', inputSent: false } },
}
const realFailure: RecordedActionResult = { success: false, error: 'element not found' }

const state: ScreenState = {
  platform: 'android',
  tree: 'switch Notifications',
  elements: [],
  refMap: {},
  timestamp: 1,
  metadata: {
    captureMode: 'none',
    coordSpace: 'viewport',
    viewportWidth: 1080,
    viewportHeight: 2400,
    scroll: { offsetX: 0, offsetY: 0, contentWidth: 1080, contentHeight: 2400 },
  },
} as unknown as ScreenState

const flake: Verdict = {
  class: 'flake',
  producer: 'deterministic-classifier',
  perTest: 0,
  confidence: 1,
  memoryMisdirectionRuledOut: true,
  evidence: { citedSteps: [0], citedAnchors: [], citedArtifacts: [], rationale: 'Recorded flake' },
}

function sub(result: RecordedActionResult, ref = 'e-notifications'): SubActionEvidence {
  return {
    plan: 'Turn on notifications',
    plannedAction: { type: 'tap', ref: asRef(ref), desiredState: 'checked' },
    stateBefore: state,
    result,
  } as unknown as SubActionEvidence
}

function step(subActions: SubActionEvidence[], pass: boolean): StepEvidence {
  return {
    stepIndex: 0,
    stepText: 'Turn on notifications',
    cacheStatus: 'miss',
    subActions,
    verifierVerdict: { pass, reasoning: pass ? 'Notifications are on' : 'Not on' },
  } as unknown as StepEvidence
}

function handoff(tests: PerTestOutcome[]): CompletedRunHandoff {
  return {
    runId: 'run-437-26',
    scope: { tier: 'product', key: 'settings' },
    tests,
  } as unknown as CompletedRunHandoff
}

function rerunMember(originResult: RecordedActionResult): CompletedRunHandoff {
  const evidence = step([sub(originResult)], true)
  const facts = {
    runId: 'run-437-26',
    testId: 'settings::notifications',
    testIndex: 0,
    stepIndex: 0,
    decisionOrdinal: 0,
    evidence,
  }
  const origin = {
    attempt: 0,
    outcome: 'failed' as const,
    rootCause: flake,
    decisions: [
      {
        ...facts,
        screenStateHash: screenStateHash(state),
        evidenceDigest: sha256hex(canonicalJson(facts)),
      },
    ],
  }
  const member = {
    testId: 'settings::notifications',
    testName: 'notifications',
    filePath: 'tests/settings.yaml',
    testIndex: 0,
    outcome: 'passed',
    steps: [],
    isRerun: true,
    rerunAttempt: 1,
    rerunOrigin: { ...origin, evidenceDigest: sha256hex(canonicalJson(origin)) },
  } as unknown as PerTestOutcome
  return handoff([member])
}

const partition = { saltHex: '0'.repeat(64), heldOutFraction: 0.4, privateFraction: 0.5 }

function selfHealHandoff(recoveringResult: RecordedActionResult): CompletedRunHandoff {
  const failed = sub(realFailure, 'e-stale')
  const recovering = sub(recoveringResult)
  const s = step([failed, recovering], true)
  s.selfHeal = {
    failedDecision: { plan: failed.plan, plannedAction: failed.plannedAction, result: realFailure },
    recoveringDecision: {
      plan: recovering.plan,
      plannedAction: recovering.plannedAction,
      result: recoveringResult,
    },
  }
  const member = {
    testId: 'settings::notifications',
    testName: 'notifications',
    filePath: 'tests/settings.yaml',
    testIndex: 0,
    outcome: 'passed',
    steps: [s],
  } as unknown as PerTestOutcome
  return handoff([member])
}

describe('C437-NO-INPUT-READERS', () => {
  it('a passing decision whose sub-action was a skipped tap is not retired as missing', () => {
    const skipped = buildSeedingPlan({ handoff: rerunMember(skippedTap), cassettes: [], partition })
    const succeeded = buildSeedingPlan({
      handoff: rerunMember({ success: true }),
      cassettes: [],
      partition,
    })
    expect(succeeded.retirementCounts).toEqual({ superseded: 0, missing: 0, conflict: 0 })
    expect(skipped.retirementCounts).toEqual(succeeded.retirementCounts)
    expect(skipped.labelRevisions).toEqual([])
  })

  it('a passing decision whose sub-action really failed is still processed', () => {
    const plan = buildSeedingPlan({ handoff: rerunMember(realFailure), cassettes: [], partition })
    expect(plan.retirementCounts).toEqual({ superseded: 0, missing: 1, conflict: 0 })
  })

  it('a self-heal recovered by a skipped tap with a passing verifier is observed', () => {
    const population = collectSoftPopulation({ handoffs: [selfHealHandoff(skippedTap)] })
    expect(population.skips).toEqual([])
    expect(population.observations).toHaveLength(1)
    expect(population.observations[0]).toMatchObject({
      product: 'settings',
      runId: 'run-437-26',
      testIndex: 0,
      stepIndex: 0,
      recoveringCassetteId: 'run-437-26/test-00-step-00-d01-leaf',
      recoveringDecision: { verifierVerdict: { pass: true } },
    })
  })

  it('a self-heal whose recovering action really failed is still unverified-success', () => {
    const population = collectSoftPopulation({ handoffs: [selfHealHandoff(realFailure)] })
    expect(population.observations).toEqual([])
    expect(population.skips.map((row) => row.reason)).toEqual(['unverified-success'])
  })
})
