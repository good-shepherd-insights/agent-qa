/**
 * LABEL-02 silver sampler (D-10/D-11/D-12) — the second module of the D-09
 * pure label factory.
 *
 * Candidacy law (D-10): v50's honest "stable passing" floor is a single
 * verified-pass run. A candidate decision requires test-level outcome ===
 * 'passed' (a 'healed' test is NOT passed), step-level verifierVerdict.pass
 * === true, NO selfHeal block on the step (the pair channel owns those
 * decisions — one label channel per decision in v50), and an extracted LEAF
 * cassette with completeness.status 'complete'.
 *
 * Selection law (D-11): deterministic, zero randomness — per test, candidates
 * order by sha256hex(cassetteId) ascending with cassetteId ascending as
 * tiebreak, then slice to the per-test cap. Same handoff ⇒ same selection.
 * The cap is caller-suppliable curation policy, NOT frozen-config
 * measurement.
 *
 * Tier law (D-12): this module only selects; tier stamping ('silver' via the
 * 'recorded-verdict' channel) happens on the label records (371-06).
 *
 * Leaf-only resolution (discretion item, documented): procedure cassettes are
 * excluded with a typed reason — a procedure's decisions are the SAME
 * decisions its leaves carry, so seeding both would double-count and break
 * 369's uniform per-decision pool.
 *
 * Every excluded unit is a typed exclusion entry — never silently dropped.
 * Leaf ids absent from the extracted set mint NO entry here: the extraction
 * report already recorded that skip, and double-reporting would inflate it.
 */
import { sha256hex } from '@vostride/agent-qa-schema'
import type { CompletedRunHandoff } from '@vostride/agent-qa-schema'
import type { Cassette } from '../cassette/cassette'
import type { ExtractedCassette } from '../extract/extract-run'
import { deriveLeafCassetteId, deriveRunSlug } from '../extract/ids'
import { classifySubAction } from '../extract/select'

/** The six enumerated silver-exclusion cases (D-10/D-11), verbatim. */
export type SilverExclusionReason =
  | 'test-not-passed'
  | 'step-verdict-failed'
  | 'self-heal-step'
  | 'evidence-incomplete'
  | 'cap-exceeded'
  | 'procedure-granularity'

/** Typed exclusion entry; locator fields present where the unit carries them. */
export interface SilverExclusion {
  testId: string
  testIndex: number
  stepIndex?: number
  cassetteId?: string
  reason: SilverExclusionReason
}

export interface SilverSamplingInput {
  handoff: CompletedRunHandoff
  cassettes: readonly ExtractedCassette[]
  silverPerTestCap: number
}

/** Selected cassette ids plus every typed exclusion (never silent). */
export interface SilverSelection {
  selected: string[]
  exclusions: SilverExclusion[]
}

/**
 * Generous default per-test cap (D-11). Caller-suppliable curation policy,
 * NOT frozen-config measurement — seeding decides what joins the corpus, not
 * how it is scored. It never binds at demo scale; it exists so real traffic
 * cannot flood the committed root.
 */
export const DEFAULT_SILVER_PER_TEST_CAP = 25

interface SilverCandidate {
  stepIndex: number
  cassetteId: string
  orderKey: string
}

/** The D-11 total order: sha256hex(cassetteId) asc, cassetteId asc tiebreak. */
function compareCandidates(a: SilverCandidate, b: SilverCandidate): number {
  if (a.orderKey !== b.orderKey) return a.orderKey < b.orderKey ? -1 : 1
  if (a.cassetteId !== b.cassetteId) return a.cassetteId < b.cassetteId ? -1 : 1
  return 0
}

/**
 * Select silver non-regression candidates from verified-pass evidence,
 * deterministically ordered and capped per test. Output order is total —
 * tests in testIndex order, candidates in hash order — so the result is
 * independent of input.cassettes ordering; the cassette Map is lookup-only
 * and never iterated for output order.
 */
export function selectSilverCassettes(input: SilverSamplingInput): SilverSelection {
  const cassettesById = new Map<string, Cassette>()
  const procedureExclusions: SilverExclusion[] = []
  for (const entry of input.cassettes) {
    cassettesById.set(entry.cassette.id, entry.cassette)
    if (entry.cassette.granularity === 'procedure') {
      procedureExclusions.push({
        testId: entry.cassette.testId,
        testIndex: entry.cassette.testIndex,
        cassetteId: entry.cassette.id,
        reason: 'procedure-granularity',
      })
    }
  }
  procedureExclusions.sort((a, b) => {
    if (a.testIndex !== b.testIndex) return a.testIndex - b.testIndex
    const aId = a.cassetteId ?? ''
    const bId = b.cassetteId ?? ''
    if (aId !== bId) return aId < bId ? -1 : 1
    return 0
  })

  const runSlug = deriveRunSlug(input.handoff.runId)
  const selected: string[] = []
  const exclusions: SilverExclusion[] = [...procedureExclusions]

  for (const test of input.handoff.tests) {
    if (test.outcome !== 'passed') {
      exclusions.push({
        testId: test.testId,
        testIndex: test.testIndex,
        reason: 'test-not-passed',
      })
      continue
    }

    const candidates: SilverCandidate[] = []
    for (const step of test.steps) {
      if (step.selfHeal !== undefined) {
        exclusions.push({
          testId: test.testId,
          testIndex: test.testIndex,
          stepIndex: step.stepIndex,
          reason: 'self-heal-step',
        })
        continue
      }
      if (step.verifierVerdict.pass !== true) {
        exclusions.push({
          testId: test.testId,
          testIndex: test.testIndex,
          stepIndex: step.stepIndex,
          reason: 'step-verdict-failed',
        })
        continue
      }

      step.subActions.forEach((subAction, decisionOrdinal) => {
        if (classifySubAction(subAction) !== 'extract') return
        const cassetteId = deriveLeafCassetteId({
          runSlug,
          testIndex: test.testIndex,
          stepIndex: step.stepIndex,
          decisionOrdinal,
        })
        const cassette = cassettesById.get(cassetteId)
        if (cassette === undefined || cassette.granularity !== 'leaf') return
        if (cassette.completeness.status !== 'complete') {
          exclusions.push({
            testId: test.testId,
            testIndex: test.testIndex,
            stepIndex: step.stepIndex,
            cassetteId,
            reason: 'evidence-incomplete',
          })
          return
        }
        candidates.push({
          stepIndex: step.stepIndex,
          cassetteId,
          orderKey: sha256hex(cassetteId),
        })
      })
    }

    candidates.sort(compareCandidates)
    candidates.forEach((candidate, position) => {
      if (position < input.silverPerTestCap) {
        selected.push(candidate.cassetteId)
        return
      }
      exclusions.push({
        testId: test.testId,
        testIndex: test.testIndex,
        stepIndex: candidate.stepIndex,
        cassetteId: candidate.cassetteId,
        reason: 'cap-exceeded',
      })
    })
  }

  return { selected, exclusions }
}
