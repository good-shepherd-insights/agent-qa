import { asRef } from '@vostride/agent-qa-schema'
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
  makeV2Handoff,
} from '../../__tests__/fixtures/handoff-fixtures'
import type { LeafCassette } from '../../cassette/cassette'
import { extractRunCassettes, type ExtractedCassette } from '../../extract/extract-run'
import type { ArtifactSource } from '../../ports'
import { collectSelfHealPairs } from '../pair-matching'

const FAILED_LEAF_ID = 'run---checkout-suite-42/test-00-step-00-d00-leaf'
const RECOVERING_LEAF_ID = 'run---checkout-suite-42/test-00-step-00-d01-leaf'

function fullArtifacts(): ArtifactSource {
  const entries = new Map<string, Uint8Array>([
    [FIXTURE_SCREENSHOT_SHA, new Uint8Array([1, 2, 3])],
    [FIXTURE_ARTIFACT_SHA, new Uint8Array([4, 5])],
  ])
  return { getBlob: (sha) => entries.get(sha) }
}

function decisionFor(subAction: SubActionEvidence): Decision {
  return {
    plan: subAction.plan,
    plannedAction: structuredClone(subAction.plannedAction),
    result: structuredClone(subAction.result),
  }
}

/**
 * Turn test 0 / step 0 into a self-heal step with two live sub-actions:
 * the recorded failed attempt (index 0) and a recovering clone retargeted
 * to a different control (index 1). The clone shares stateBefore, so both
 * extracted receipts carry the same screenStateHash.
 */
function addSelfHeal(handoff: CompletedRunHandoff): void {
  const step = handoff.tests[0]!.steps[0]!
  const failedSub = step.subActions[0]!
  const recoveringSub = structuredClone(failedSub)
  recoveringSub.plannedAction = { type: 'click', ref: asRef('e-continue-2') }
  step.subActions = [failedSub, recoveringSub]
  step.selfHeal = {
    failedDecision: decisionFor(failedSub),
    recoveringDecision: decisionFor(recoveringSub),
  }
}

function healedHandoff(): CompletedRunHandoff {
  const handoff = makeArtifactRefV2Handoff()
  addSelfHeal(handoff)
  return handoff
}

function extract(handoff: CompletedRunHandoff): readonly ExtractedCassette[] {
  return extractRunCassettes({ handoff, artifacts: fullArtifacts() }).cassettes
}

function leafById(cassettes: readonly ExtractedCassette[], id: string): LeafCassette {
  const found = cassettes
    .map((entry) => entry.cassette)
    .find((cassette): cassette is LeafCassette => cassette.granularity === 'leaf' && cassette.id === id)
  if (found === undefined) throw new Error(`missing leaf cassette ${id}`)
  return found
}

describe('collectSelfHealPairs (D-05/D-06/D-07)', () => {
  it('mints one pair from a uniquely matched self-heal step with same-state cassettes', () => {
    const handoff = healedHandoff()
    const cassettes = extract(handoff)

    const { pairs, skips } = collectSelfHealPairs({ handoff, cassettes })

    expect(skips).toEqual([])
    expect(pairs).toHaveLength(1)
    const pair = pairs[0]!
    expect(pair.testId).toBe('checkout::happy-path')
    expect(pair.testIndex).toBe(0)
    expect(pair.stepIndex).toBe(0)
    expect(pair.failedCassetteId).toBe(FAILED_LEAF_ID)
    expect(pair.recoveringCassetteId).toBe(RECOVERING_LEAF_ID)
    expect(pair.failedScreenStateHash).toBe(
      leafById(cassettes, FAILED_LEAF_ID).receipt.screenStateHash,
    )
    expect(pair.recoveringScreenStateHash).toBe(
      leafById(cassettes, RECOVERING_LEAF_ID).receipt.screenStateHash,
    )
    expect(pair.sameState).toBe(true)
  })

  it('still mints the pair when screenStateHash values differ, stamping sameState false (D-07)', () => {
    const handoff = healedHandoff()
    const recoveringSub = handoff.tests[0]!.steps[0]!.subActions[1]!
    recoveringSub.stateBefore = {
      ...recoveringSub.stateBefore,
      url: 'https://shop.example.test/checkout?retry=1',
    }
    const cassettes = extract(handoff)

    const { pairs, skips } = collectSelfHealPairs({ handoff, cassettes })

    expect(skips).toEqual([])
    expect(pairs).toHaveLength(1)
    const pair = pairs[0]!
    expect(pair.sameState).toBe(false)
    expect(pair.failedScreenStateHash).toBe(
      leafById(cassettes, FAILED_LEAF_ID).receipt.screenStateHash,
    )
    expect(pair.recoveringScreenStateHash).toBe(
      leafById(cassettes, RECOVERING_LEAF_ID).receipt.screenStateHash,
    )
    expect(pair.failedScreenStateHash).not.toBe(pair.recoveringScreenStateHash)
  })

  it('skips with cache-hit-no-cassette when the unique match is a cache-hit sub-action', () => {
    const handoff = healedHandoff()
    const failedSub = handoff.tests[0]!.steps[0]!.subActions[0]!
    delete failedSub.exchanges
    delete failedSub.callRecord
    const cassettes = extract(handoff)

    const { pairs, skips } = collectSelfHealPairs({ handoff, cassettes })

    expect(pairs).toEqual([])
    expect(skips).toEqual([
      {
        testId: 'checkout::happy-path',
        testIndex: 0,
        stepIndex: 0,
        reason: 'cache-hit-no-cassette',
      },
    ])
  })

  it('skips with ambiguous-duplicate when two unconsumed sub-actions match one decision', () => {
    const handoff = healedHandoff()
    const step = handoff.tests[0]!.steps[0]!
    step.subActions[1]!.plannedAction = structuredClone(step.subActions[0]!.plannedAction)
    const cassettes = extract(handoff)

    const { pairs, skips } = collectSelfHealPairs({ handoff, cassettes })

    expect(pairs).toEqual([])
    expect(skips).toEqual([
      {
        testId: 'checkout::happy-path',
        testIndex: 0,
        stepIndex: 0,
        reason: 'ambiguous-duplicate',
      },
    ])
  })

  it('skips with evidence-incomplete when the matched cassette is not complete', () => {
    const handoff = makeV2Handoff()
    addSelfHeal(handoff)
    const cassettes = extract(handoff)

    expect(leafById(cassettes, FAILED_LEAF_ID).completeness.status).toBe('evidence-incomplete')

    const { pairs, skips } = collectSelfHealPairs({ handoff, cassettes })

    expect(pairs).toEqual([])
    expect(skips).toEqual([
      {
        testId: 'checkout::happy-path',
        testIndex: 0,
        stepIndex: 0,
        reason: 'evidence-incomplete',
      },
    ])
  })

  it('skips with no-match for an unmatched action and for an absent extracted cassette', () => {
    const unmatched = healedHandoff()
    unmatched.tests[0]!.steps[0]!.selfHeal!.failedDecision.plannedAction = {
      type: 'click',
      ref: asRef('e-nowhere'),
    }
    const unmatchedResult = collectSelfHealPairs({
      handoff: unmatched,
      cassettes: extract(unmatched),
    })
    expect(unmatchedResult.pairs).toEqual([])
    expect(unmatchedResult.skips).toEqual([
      { testId: 'checkout::happy-path', testIndex: 0, stepIndex: 0, reason: 'no-match' },
    ])

    const absent = healedHandoff()
    const absentResult = collectSelfHealPairs({ handoff: absent, cassettes: [] })
    expect(absentResult.pairs).toEqual([])
    expect(absentResult.skips).toEqual([
      { testId: 'checkout::happy-path', testIndex: 0, stepIndex: 0, reason: 'no-match' },
    ])
  })

  it('treats two identical unconsumed candidates as ambiguous even for the retry shape', () => {
    const handoff = healedHandoff()
    const step = handoff.tests[0]!.steps[0]!
    step.subActions[1]!.plannedAction = structuredClone(step.subActions[0]!.plannedAction)
    step.selfHeal = {
      failedDecision: decisionFor(step.subActions[0]!),
      recoveringDecision: decisionFor(step.subActions[1]!),
    }
    const cassettes = extract(handoff)

    const { pairs, skips } = collectSelfHealPairs({ handoff, cassettes })

    expect(pairs).toEqual([])
    expect(skips).toEqual([
      {
        testId: 'checkout::happy-path',
        testIndex: 0,
        stepIndex: 0,
        reason: 'ambiguous-duplicate',
      },
    ])
  })

  it('is deeply deterministic across repeated calls on the same input', () => {
    const handoff = healedHandoff()
    const cassettes = extract(handoff)

    expect(collectSelfHealPairs({ handoff, cassettes })).toEqual(
      collectSelfHealPairs({ handoff, cassettes }),
    )
  })
})
