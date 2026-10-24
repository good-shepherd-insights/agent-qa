import { asRef, sha256hex } from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  Decision,
  SubActionEvidence,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import {
  FIXTURE_ARTIFACT_SHA,
  FIXTURE_SCREENSHOT_SHA,
  makeArtifactRefV2Handoff,
} from '../../__tests__/fixtures/handoff-fixtures'
import { extractRunCassettes, type ExtractedCassette } from '../../extract/extract-run'
import type { ArtifactSource } from '../../ports'
import { collectSelfHealPairs } from '../pair-matching'
import { buildSeedingPlan, type SeedingPlan } from '../seeding-plan'
import { assignSplit, bucketOf, type PartitionParams } from '../split-assignment'
import { DEFAULT_SILVER_PER_TEST_CAP, selectSilverCassettes } from '../silver-sampling'

const SILVER_STEP0_ID = 'run---checkout-suite-42/test-00-step-00-d00-leaf'
const SILVER_STEP1_ID = 'run---checkout-suite-42/test-00-step-01-d01-leaf'
const PAIR_FAILED_ID = 'run---checkout-suite-42/test-01-step-00-d00-leaf'
const PAIR_RECOVERING_ID = 'run---checkout-suite-42/test-01-step-00-d01-leaf'
const NON_MEMBER_LEAF_ID = 'run---checkout-suite-42/test-01-step-02-d00-leaf'
const TEST0_PROCEDURE_ID = 'run---checkout-suite-42/test-00-procedure'
const TEST1_PROCEDURE_ID = 'run---checkout-suite-42/test-01-procedure'
/**
 * 414 D-07 partition fixture. These fractions are TEST VECTOR inputs, not a
 * default: they are chosen so that BOTH pair members would bucket held-out
 * without the D-08 exemption, one silver leaf lands held-out/shared and the
 * other held-out/private — so the cells below can see every arm.
 */
const PARTITION: PartitionParams = {
  saltHex: '0'.repeat(64),
  heldOutFraction: 0.9,
  privateFraction: 0.4,
}

function fullArtifacts(): ArtifactSource {
  const entries = new Map<string, Uint8Array>([
    [FIXTURE_SCREENSHOT_SHA, new Uint8Array([1, 2, 3])],
    [FIXTURE_ARTIFACT_SHA, new Uint8Array([4, 5])],
  ])
  return { getBlob: (sha) => entries.get(sha) }
}

function extract(handoff: CompletedRunHandoff): readonly ExtractedCassette[] {
  return extractRunCassettes({ handoff, artifacts: fullArtifacts() }).cassettes
}

function decisionFor(subAction: SubActionEvidence): Decision {
  return {
    plan: subAction.plan,
    plannedAction: structuredClone(subAction.plannedAction),
    result: structuredClone(subAction.result),
  }
}

/** Retarget a live sub-action clone and stamp selfHeal onto an arbitrary step. */
function addSelfHealToStep(
  handoff: CompletedRunHandoff,
  testIdx: number,
  stepIdx: number,
): void {
  const step = handoff.tests[testIdx]!.steps[stepIdx]!
  const failedSub = step.subActions[0]!
  const recoveringSub = structuredClone(failedSub)
  recoveringSub.plannedAction = { type: 'click', ref: asRef('e-continue-2') }
  step.subActions = [failedSub, recoveringSub]
  step.selfHeal = {
    failedDecision: decisionFor(failedSub),
    recoveringDecision: decisionFor(recoveringSub),
  }
}

/**
 * The canonical composition fixture: test 0 stays a passing test with two
 * eligible silver decisions; test 1's first step becomes a fully resolvable
 * self-heal pair (pair minting is outcome-independent).
 */
function compositionHandoff(): CompletedRunHandoff {
  const handoff = makeArtifactRefV2Handoff()
  addSelfHealToStep(handoff, 1, 0)
  return handoff
}

function buildPlan(
  handoff: CompletedRunHandoff,
  cassettes: readonly ExtractedCassette[],
  params?: { silverPerTestCap?: number },
): SeedingPlan {
  return buildSeedingPlan({ handoff, cassettes, partition: PARTITION, params })
}

/** The D-11 order contract, computed independently of the implementation. */
function hashOrdered(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => {
    const hashA = sha256hex(a)
    const hashB = sha256hex(b)
    if (hashA !== hashB) return hashA < hashB ? -1 : 1
    return a < b ? -1 : a > b ? 1 : 0
  })
}

describe('buildSeedingPlan (D-16 corpus-seeding planner)', () => {
  it('composes pair members and silver selections into fully materialized cases', () => {
    const handoff = compositionHandoff()
    const cassettes = extract(handoff)

    const plan = buildPlan(handoff, cassettes)

    expect(plan.cases.map((planCase) => planCase.cassetteId)).toEqual([
      SILVER_STEP0_ID,
      SILVER_STEP1_ID,
      PAIR_FAILED_ID,
      PAIR_RECOVERING_ID,
    ])
    expect(plan.product).toBe('default')
    expect(plan.runId).toBe(handoff.runId)
    expect(plan.runSlug).toBe('run---checkout-suite-42')

    for (const planCase of plan.cases) {
      expect(planCase.labelRecord.cassetteId).toBe(planCase.cassetteId)
      expect(planCase.corpusEntry.cassetteId).toBe(planCase.cassetteId)
      expect(planCase.corpusEntry.product).toBe('default')
      expect(planCase.corpusEntry.run_links).toEqual({
        runId: handoff.runId,
        runSlug: 'run---checkout-suite-42',
      })
    }

    const failedCase = plan.cases.find((planCase) => planCase.cassetteId === PAIR_FAILED_ID)!
    expect(failedCase.labelRecord.label.sourceChannel).toBe('self-heal-pair')
    expect(failedCase.labelRecord.label.tier).toBe('near-gold')
    expect(failedCase.labelRecord.label.pairing).toEqual({
      pairedCassetteId: PAIR_RECOVERING_ID,
      relation: 'contrastive-negative',
    })
    expect(failedCase.labelRecord.pairState?.sameState).toBe(true)

    const silverCase = plan.cases.find((planCase) => planCase.cassetteId === SILVER_STEP0_ID)!
    expect(silverCase.labelRecord.label.sourceChannel).toBe('recorded-verdict')
    expect(silverCase.labelRecord.label.tier).toBe('silver')
    expect(silverCase.labelRecord.pairState).toBeUndefined()
  })

  it('admits ONLY pair members and silver selections — membership is commit scope (D-13)', () => {
    const handoff = compositionHandoff()
    const cassettes = extract(handoff)
    expect(cassettes.some((entry) => entry.cassette.id === NON_MEMBER_LEAF_ID)).toBe(true)

    const plan = buildPlan(handoff, cassettes)
    const caseIds = plan.cases.map((planCase) => planCase.cassetteId)

    expect(caseIds).not.toContain(NON_MEMBER_LEAF_ID)
    expect(caseIds).not.toContain(TEST0_PROCEDURE_ID)
    expect(caseIds).not.toContain(TEST1_PROCEDURE_ID)
    expect(caseIds).toEqual([
      SILVER_STEP0_ID,
      SILVER_STEP1_ID,
      PAIR_FAILED_ID,
      PAIR_RECOVERING_ID,
    ])
  })

  it('passes matcher skips and sampler exclusions through verbatim', () => {
    const handoff = compositionHandoff()
    const blockedStep = handoff.tests[0]!.steps[1]!
    const cacheHitSub = blockedStep.subActions[0]!
    blockedStep.subActions = [cacheHitSub]
    blockedStep.selfHeal = {
      failedDecision: decisionFor(cacheHitSub),
      recoveringDecision: decisionFor(cacheHitSub),
    }
    const cassettes = extract(handoff)

    const plan = buildPlan(handoff, cassettes)
    const { skips } = collectSelfHealPairs({ handoff, cassettes })
    const { exclusions } = selectSilverCassettes({
      handoff,
      cassettes,
      silverPerTestCap: DEFAULT_SILVER_PER_TEST_CAP,
    })

    expect(skips).toEqual([
      {
        testId: 'checkout::happy-path',
        testIndex: 0,
        stepIndex: 1,
        reason: 'cache-hit-no-cassette',
      },
    ])
    expect(plan.pairSkips).toEqual(skips)
    expect(plan.silverExclusions).toEqual(exclusions)
    expect(plan.proceduresExcludedCount).toBe(
      exclusions.filter((exclusion) => exclusion.reason === 'procedure-granularity').length,
    )
    expect(plan.proceduresExcludedCount).toBe(2)
  })

  it('counts both pair classes so a starved channel is visible (D-07)', () => {
    const handoff = makeArtifactRefV2Handoff()
    addSelfHealToStep(handoff, 0, 0)
    addSelfHealToStep(handoff, 1, 0)
    const differingSub = handoff.tests[1]!.steps[0]!.subActions[1]!
    differingSub.stateBefore = {
      ...differingSub.stateBefore,
      url: 'https://shop.example.test/checkout?retry=1',
    }
    const cassettes = extract(handoff)

    const plan = buildPlan(handoff, cassettes)

    expect(plan.pairCounts).toEqual({ total: 2, sameState: 1, differingState: 1 })
  })

  it("never plans a 'gold' case — every tier is near-gold or silver (D-12)", () => {
    const handoff = compositionHandoff()
    const cassettes = extract(handoff)

    const plan = buildPlan(handoff, cassettes)

    expect(plan.cases.length).toBeGreaterThan(0)
    for (const planCase of plan.cases) {
      expect(['near-gold', 'silver']).toContain(planCase.labelRecord.label.tier)
    }
  })

  it('is deterministic, ordered by cassetteId ascending, and input-order independent', () => {
    const handoff = compositionHandoff()
    const cassettes = extract(handoff)

    const first = buildPlan(handoff, cassettes)
    const second = buildPlan(handoff, cassettes)
    const reversed = buildPlan(handoff, [...cassettes].reverse())

    expect(second).toEqual(first)
    expect(reversed).toEqual(first)
    const ids = first.cases.map((planCase) => planCase.cassetteId)
    expect(ids).toEqual([...ids].sort())
  })

  it('defaults the silver cap and visibly binds a supplied cap', () => {
    const handoff = compositionHandoff()
    const cassettes = extract(handoff)

    const defaulted = buildPlan(handoff, cassettes)
    const explicit = buildPlan(handoff, cassettes, {
      silverPerTestCap: DEFAULT_SILVER_PER_TEST_CAP,
    })
    expect(defaulted).toEqual(explicit)

    const capped = buildPlan(handoff, cassettes, { silverPerTestCap: 1 })
    const [kept, dropped] = hashOrdered([SILVER_STEP0_ID, SILVER_STEP1_ID])
    expect(capped.cases.map((planCase) => planCase.cassetteId)).toEqual(
      [kept!, PAIR_FAILED_ID, PAIR_RECOVERING_ID].sort(),
    )
    expect(
      capped.silverExclusions.filter((exclusion) => exclusion.reason === 'cap-exceeded'),
    ).toEqual([
      {
        testId: 'checkout::happy-path',
        testIndex: 0,
        stepIndex: expect.any(Number),
        cassetteId: dropped,
        reason: 'cap-exceeded',
      },
    ])
  })
})

describe('buildSeedingPlan — the split is an INPUT to the projection (414 D-07/D-08/D-13)', () => {
  it('exempts both pair members and buckets silver leaves, reproducibly', () => {
    const handoff = compositionHandoff()
    const cassettes = extract(handoff)

    const plan = buildPlan(handoff, cassettes)
    const caseFor = (id: string) => plan.cases.find((planCase) => planCase.cassetteId === id)!

    // D-08: both members stay natural even though their own buckets fall
    // inside held-out under this partition — assert the counterfactual so the
    // exemption cannot pass vacuously.
    for (const pairId of [PAIR_FAILED_ID, PAIR_RECOVERING_ID]) {
      expect(caseFor(pairId).corpusEntry.split).toBe('natural')
      expect(
        assignSplit({ ...PARTITION, cassetteId: pairId, isPairMember: false }).split,
      ).toBe('held-out')
    }

    // At least one silver leaf is genuinely held-out, and recomputing the
    // assignment for its id reproduces the visibility the plan stamped.
    const heldOutSilver = [SILVER_STEP0_ID, SILVER_STEP1_ID]
      .map(caseFor)
      .filter((planCase) => planCase.corpusEntry.split === 'held-out')
    expect(heldOutSilver.length).toBeGreaterThan(0)
    for (const planCase of heldOutSilver) {
      const recomputed = assignSplit({
        ...PARTITION,
        cassetteId: planCase.cassetteId,
        isPairMember: false,
      })
      expect(recomputed).toEqual({
        split: 'held-out',
        heldOutVisibility:
          planCase.corpusEntry.split === 'held-out'
            ? planCase.corpusEntry.heldOutVisibility
            : undefined,
      })
      expect(bucketOf(PARTITION.saltHex, planCase.cassetteId)).toBeGreaterThanOrEqual(0)
    }
  })

  it('never stamps a path field, and carries the D-04 fields iff supplied', () => {
    const handoff = compositionHandoff()
    const cassettes = extract(handoff)

    const bare = buildPlan(handoff, cassettes)
    for (const planCase of bare.cases) {
      expect(Object.keys(planCase.corpusEntry.run_links)).toEqual(['runId', 'runSlug'])
      expect(Object.keys(planCase.corpusEntry)).not.toContain('captured_at')
      expect(Object.keys(planCase.corpusEntry)).not.toContain('targetEnvironment')
    }

    const stamped = buildSeedingPlan({
      handoff,
      cassettes,
      partition: PARTITION,
      capturedAt: '2026-09-04T16:25:54.000Z',
      targetEnvironment: 'local',
    })
    expect(stamped.cases.length).toBeGreaterThan(0)
    for (const planCase of stamped.cases) {
      expect(planCase.corpusEntry.captured_at).toBe('2026-09-04T16:25:54.000Z')
      expect(planCase.corpusEntry.targetEnvironment).toBe('local')
    }
  })
})
