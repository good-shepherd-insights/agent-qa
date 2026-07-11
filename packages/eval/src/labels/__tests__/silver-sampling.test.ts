import { sha256hex } from '@vostride/agent-qa-schema'
import type { CompletedRunHandoff, SubActionEvidence } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import {
  FIXTURE_ARTIFACT_SHA,
  FIXTURE_SCREENSHOT_SHA,
  makeArtifactRefV2Handoff,
  makeV2Handoff,
} from '../../__tests__/fixtures/handoff-fixtures'
import { extractRunCassettes, type ExtractedCassette } from '../../extract/extract-run'
import type { ArtifactSource } from '../../ports'
import {
  DEFAULT_SILVER_PER_TEST_CAP,
  selectSilverCassettes,
  type SilverExclusion,
  type SilverSelection,
} from '../silver-sampling'

const STEP0_LEAF_ID = 'run---checkout-suite-42/test-00-step-00-d00-leaf'
const STEP1_LEAF_ID = 'run---checkout-suite-42/test-00-step-01-d01-leaf'
const TEST0_PROCEDURE_ID = 'run---checkout-suite-42/test-00-procedure'
const TEST1_PROCEDURE_ID = 'run---checkout-suite-42/test-01-procedure'

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

function select(
  handoff: CompletedRunHandoff,
  cassettes: readonly ExtractedCassette[],
  silverPerTestCap = DEFAULT_SILVER_PER_TEST_CAP,
): SilverSelection {
  return selectSilverCassettes({ handoff, cassettes, silverPerTestCap })
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

function byReason(
  exclusions: readonly SilverExclusion[],
  reason: SilverExclusion['reason'],
): SilverExclusion[] {
  return exclusions.filter((exclusion) => exclusion.reason === reason)
}

/** Stamp a selfHeal block onto a step from its own first sub-action. */
function stampSelfHeal(handoff: CompletedRunHandoff, testIdx: number, stepIdx: number): void {
  const step = handoff.tests[testIdx]!.steps[stepIdx]!
  const sub = step.subActions[0]!
  const decision = {
    plan: sub.plan,
    plannedAction: structuredClone(sub.plannedAction),
    result: structuredClone(sub.result),
  }
  step.selfHeal = {
    failedDecision: decision,
    recoveringDecision: structuredClone(decision),
  }
}

describe('selectSilverCassettes (D-10/D-11)', () => {
  it('exports the generous caller-suppliable default cap (D-11)', () => {
    expect(DEFAULT_SILVER_PER_TEST_CAP).toBe(25)
  })

  it('selects only verified-pass leaf decisions with complete evidence (candidacy, D-10)', () => {
    const handoff = makeArtifactRefV2Handoff()
    const cassettes = extract(handoff)

    const { selected, exclusions } = select(handoff, cassettes)

    expect(selected).toEqual(hashOrdered([STEP0_LEAF_ID, STEP1_LEAF_ID]))
    expect(selected).not.toContain('run---checkout-suite-42/test-00-step-01-d00-leaf')
    expect(exclusions).toEqual([
      {
        testId: 'checkout::happy-path',
        testIndex: 0,
        cassetteId: TEST0_PROCEDURE_ID,
        reason: 'procedure-granularity',
      },
      {
        testId: 'checkout::failure-path',
        testIndex: 1,
        cassetteId: TEST1_PROCEDURE_ID,
        reason: 'procedure-granularity',
      },
      { testId: 'checkout::failure-path', testIndex: 1, reason: 'test-not-passed' },
    ])
  })

  it("excludes a 'healed' test with one per-test exclusion — healed is NOT passed", () => {
    const handoff = makeArtifactRefV2Handoff()
    handoff.tests[0]!.outcome = 'healed'
    const cassettes = extract(handoff)

    const { selected, exclusions } = select(handoff, cassettes)

    expect(selected).toEqual([])
    expect(byReason(exclusions, 'test-not-passed')).toEqual([
      { testId: 'checkout::happy-path', testIndex: 0, reason: 'test-not-passed' },
      { testId: 'checkout::failure-path', testIndex: 1, reason: 'test-not-passed' },
    ])
  })

  it('excludes a failed-verdict step inside a passing test with its stepIndex', () => {
    const handoff = makeArtifactRefV2Handoff()
    handoff.tests[0]!.steps[1]!.verifierVerdict = {
      pass: false,
      reasoning: 'The follow-up state regressed',
    }
    const cassettes = extract(handoff)

    const { selected, exclusions } = select(handoff, cassettes)

    expect(selected).toEqual([STEP0_LEAF_ID])
    expect(byReason(exclusions, 'step-verdict-failed')).toEqual([
      {
        testId: 'checkout::happy-path',
        testIndex: 0,
        stepIndex: 1,
        reason: 'step-verdict-failed',
      },
    ])
  })

  it('excludes a selfHeal-carrying step — pair and silver channels never overlap', () => {
    const handoff = makeArtifactRefV2Handoff()
    stampSelfHeal(handoff, 0, 0)
    const cassettes = extract(handoff)

    const { selected, exclusions } = select(handoff, cassettes)

    expect(selected).not.toContain(STEP0_LEAF_ID)
    expect(selected).toEqual([STEP1_LEAF_ID])
    expect(byReason(exclusions, 'self-heal-step')).toEqual([
      { testId: 'checkout::happy-path', testIndex: 0, stepIndex: 0, reason: 'self-heal-step' },
    ])
  })

  it('caps per test in (sha256hex(cassetteId), cassetteId) ascending order (D-11)', () => {
    const handoff = makeArtifactRefV2Handoff()
    const step0 = handoff.tests[0]!.steps[0]!
    const base = step0.subActions[0]!
    step0.subActions = [
      base,
      structuredClone(base),
      structuredClone(base),
      structuredClone(base),
    ]
    const step1 = handoff.tests[0]!.steps[1]!
    step1.subActions = [step1.subActions[0]!] as SubActionEvidence[]
    const cassettes = extract(handoff)

    const candidateIds = [0, 1, 2, 3].map(
      (ordinal) => `run---checkout-suite-42/test-00-step-00-d0${ordinal}-leaf`,
    )
    const expectedOrder = hashOrdered(candidateIds)

    const { selected, exclusions } = select(handoff, cassettes, 2)

    expect(selected).toEqual(expectedOrder.slice(0, 2))
    expect(byReason(exclusions, 'cap-exceeded')).toEqual(
      expectedOrder.slice(2).map((cassetteId) => ({
        testId: 'checkout::happy-path',
        testIndex: 0,
        stepIndex: 0,
        cassetteId,
        reason: 'cap-exceeded',
      })),
    )
  })

  it('excludes procedure cassettes with a typed reason — leaf-only eligibility', () => {
    const handoff = makeArtifactRefV2Handoff()
    const cassettes = extract(handoff)

    const { selected, exclusions } = select(handoff, cassettes)

    expect(byReason(exclusions, 'procedure-granularity')).toEqual([
      {
        testId: 'checkout::happy-path',
        testIndex: 0,
        cassetteId: TEST0_PROCEDURE_ID,
        reason: 'procedure-granularity',
      },
      {
        testId: 'checkout::failure-path',
        testIndex: 1,
        cassetteId: TEST1_PROCEDURE_ID,
        reason: 'procedure-granularity',
      },
    ])
    expect(selected.some((id) => id.endsWith('-procedure'))).toBe(false)
  })

  it('excludes eligible decisions whose cassette is not complete', () => {
    const handoff = makeV2Handoff()
    const cassettes = extract(handoff)

    const incomplete = cassettes.find((entry) => entry.cassette.id === STEP0_LEAF_ID)
    expect(incomplete?.cassette.completeness.status).toBe('evidence-incomplete')

    const { selected, exclusions } = select(handoff, cassettes)

    expect(selected).toEqual([])
    expect(byReason(exclusions, 'evidence-incomplete')).toEqual([
      {
        testId: 'checkout::happy-path',
        testIndex: 0,
        stepIndex: 0,
        cassetteId: STEP0_LEAF_ID,
        reason: 'evidence-incomplete',
      },
      {
        testId: 'checkout::happy-path',
        testIndex: 0,
        stepIndex: 1,
        cassetteId: STEP1_LEAF_ID,
        reason: 'evidence-incomplete',
      },
    ])
  })

  it('is deterministic and independent of input.cassettes ordering (D-11)', () => {
    const handoff = makeArtifactRefV2Handoff()
    const cassettes = extract(handoff)

    const first = select(handoff, cassettes)
    const second = select(handoff, cassettes)
    const reversed = select(handoff, [...cassettes].reverse())

    expect(second).toEqual(first)
    expect(reversed).toEqual(first)
  })
})
