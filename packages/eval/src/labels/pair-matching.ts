/**
 * LABEL-01 self-heal pair matcher (D-05/D-06/D-07) — the first module of the
 * D-09 pure label factory.
 *
 * Matching law (D-05): each self-heal decision resolves against the SAME step's
 * sub-actions via canonical-JSON action equality, in order, consume-once. A
 * decision resolves only when exactly ONE unconsumed sub-action matches —
 * uniqueness is required, first-match guessing is forbidden, because a wrong
 * pairing poisons a near-gold label. Every unresolvable step mints NO pair and
 * exactly one typed PairSkip (never silent).
 *
 * Role law (D-06): recovering = contrastive-positive, failed =
 * contrastive-negative; the pairing vocabulary stays the shipped
 * ContrastivePairing — MintedContrastivePair is the matcher RESULT, projected
 * onto label records later (371-06).
 *
 * State law (D-07): sameState is STAMPED from receipt screenStateHash equality,
 * never gated — differing-state pairs still mint.
 */
import type {
  CompletedRunHandoff,
  Decision,
  PerTestOutcome,
  StepEvidence,
} from '@vostride/agent-qa-schema'
import { canonicalJson } from '../canonical-json'
import type { Cassette } from '../cassette/cassette'
import type { ContrastivePairing } from '../cassette/label-leg'
import type { ExtractedCassette } from '../extract/extract-run'
import { deriveLeafCassetteId, deriveRunSlug } from '../extract/ids'
import { classifySubAction } from '../extract/select'

/** The four enumerated D-05 non-unique-match cases, verbatim. */
export type PairSkipReason =
  | 'cache-hit-no-cassette'
  | 'ambiguous-duplicate'
  | 'evidence-incomplete'
  | 'no-match'

/** Locator-carrying typed skip for a self-heal step that minted no pair (D-05). */
export interface PairSkip {
  testId: string
  testIndex: number
  stepIndex: number
  reason: PairSkipReason
}

/** One resolved pair member: role, cassette id, and its receipt state hash (D-06/D-07). */
export interface SelfHealPairing {
  role: ContrastivePairing['relation']
  cassetteId: string
  screenStateHash: string
}

/** The matcher result for one fully resolved self-heal step (D-05/D-06/D-07). */
export interface MintedContrastivePair {
  testId: string
  testIndex: number
  stepIndex: number
  failedCassetteId: string
  recoveringCassetteId: string
  failedScreenStateHash: string
  recoveringScreenStateHash: string
  sameState: boolean
}

export interface CollectSelfHealPairsInput {
  handoff: CompletedRunHandoff
  cassettes: readonly ExtractedCassette[]
}

export interface CollectSelfHealPairsResult {
  pairs: MintedContrastivePair[]
  skips: PairSkip[]
}

type MemberResolution =
  | { kind: 'resolved'; pairing: SelfHealPairing }
  | { kind: 'skip'; reason: PairSkipReason }

interface ResolveMemberInput {
  decision: Decision
  role: SelfHealPairing['role']
  test: PerTestOutcome
  step: StepEvidence
  consumed: Set<number>
  cassettesById: ReadonlyMap<string, Cassette>
  runSlug: string
}

function resolveMember({
  decision,
  role,
  test,
  step,
  consumed,
  cassettesById,
  runSlug,
}: ResolveMemberInput): MemberResolution {
  const wanted = canonicalJson(decision.plannedAction)
  const candidates: number[] = []
  step.subActions.forEach((subAction, ordinal) => {
    if (consumed.has(ordinal)) return
    if (canonicalJson(subAction.plannedAction) === wanted) candidates.push(ordinal)
  })

  if (candidates.length === 0) return { kind: 'skip', reason: 'no-match' }
  if (candidates.length > 1) return { kind: 'skip', reason: 'ambiguous-duplicate' }

  const ordinal = candidates[0]!
  const subAction = step.subActions[ordinal]!
  if (classifySubAction(subAction) === 'cache-hit') {
    return { kind: 'skip', reason: 'cache-hit-no-cassette' }
  }

  const cassetteId = deriveLeafCassetteId({
    runSlug,
    testIndex: test.testIndex,
    stepIndex: step.stepIndex,
    decisionOrdinal: ordinal,
  })
  const cassette = cassettesById.get(cassetteId)
  if (cassette === undefined || cassette.granularity !== 'leaf') {
    return { kind: 'skip', reason: 'no-match' }
  }
  if (cassette.completeness.status !== 'complete') {
    return { kind: 'skip', reason: 'evidence-incomplete' }
  }

  consumed.add(ordinal)
  return {
    kind: 'resolved',
    pairing: { role, cassetteId, screenStateHash: cassette.receipt.screenStateHash },
  }
}

/**
 * Project every self-heal step of a run into typed contrastive pairs plus
 * never-silent typed skips. Deterministic: walks tests and steps in handoff
 * order; the cassette Map is lookup-only and never iterated for output order.
 */
export function collectSelfHealPairs(
  input: CollectSelfHealPairsInput,
): CollectSelfHealPairsResult {
  const cassettesById = new Map<string, Cassette>()
  for (const entry of input.cassettes) {
    cassettesById.set(entry.cassette.id, entry.cassette)
  }
  const runSlug = deriveRunSlug(input.handoff.runId)
  const pairs: MintedContrastivePair[] = []
  const skips: PairSkip[] = []

  for (const test of input.handoff.tests) {
    for (const step of test.steps) {
      const selfHeal = step.selfHeal
      if (selfHeal === undefined) continue

      const consumed = new Set<number>()
      const failed = resolveMember({
        decision: selfHeal.failedDecision,
        role: 'contrastive-negative',
        test,
        step,
        consumed,
        cassettesById,
        runSlug,
      })
      const recovering: MemberResolution = failed.kind === 'skip'
        ? failed
        : resolveMember({
            decision: selfHeal.recoveringDecision,
            role: 'contrastive-positive',
            test,
            step,
            consumed,
            cassettesById,
            runSlug,
          })

      if (failed.kind === 'skip') {
        skips.push({
          testId: test.testId,
          testIndex: test.testIndex,
          stepIndex: step.stepIndex,
          reason: failed.reason,
        })
        continue
      }
      if (recovering.kind === 'skip') {
        skips.push({
          testId: test.testId,
          testIndex: test.testIndex,
          stepIndex: step.stepIndex,
          reason: recovering.reason,
        })
        continue
      }

      pairs.push({
        testId: test.testId,
        testIndex: test.testIndex,
        stepIndex: step.stepIndex,
        failedCassetteId: failed.pairing.cassetteId,
        recoveringCassetteId: recovering.pairing.cassetteId,
        failedScreenStateHash: failed.pairing.screenStateHash,
        recoveringScreenStateHash: recovering.pairing.screenStateHash,
        sameState:
          failed.pairing.screenStateHash === recovering.pairing.screenStateHash,
      })
    }
  }

  return { pairs, skips }
}
