/** 417 D-03/D-15: pure per-decision harm and per-axis counts; no scalar decision score. */
import type { Gate1HarmOrigin } from '@vostride/agent-qa-schema'
import type { CassetteLabelLeg, LabelSourceChannel, LabelTier } from '../cassette/label-leg'
import type { CorpusEntry } from '../labels/corpus-entry'
import type { BriefSource } from '../replay/brief-tiers'
import {
  FLOOR_AXES,
  axisVectors,
  type DecisionCorrectnessVector,
  type FloorAxis,
} from '../stats/decision-vector'
import { pairedDecisionDiff } from '../stats/paired'
import type { AxisFloorSet } from './floor-artefact'

export type DecisionWeight = 'gold' | 'near-gold' | 'silver' | 'unverified' | 'overturned'
// prettier-ignore
export const DECISION_WEIGHTS = ['gold', 'near-gold', 'silver', 'unverified', 'overturned'] as const satisfies readonly DecisionWeight[]
export type ArmOutcome =
  | { kind: 'scored'; vector: DecisionCorrectnessVector; briefSource: BriefSource }
  | { kind: 'refused'; reason: string }
export interface ArmDecision {
  cassetteId: string
  stepIndex?: number
  decisionOrdinal: number
  origin: Gate1HarmOrigin
  entry?: CorpusEntry
  label?: CassetteLabelLeg
  /** Persisted disclosure only; categorical harm remains governed by weightFor. */
  softWeight?: number
  baseline: ArmOutcome
  candidate: ArmOutcome
}
export type DecisionHeadline =
  'fixed' | 'broken' | 'unchanged-correct' | 'unchanged-incorrect' | 'incomparable'
// prettier-ignore
export const DECISION_HEADLINES = ['fixed', 'broken', 'unchanged-correct', 'unchanged-incorrect', 'incomparable'] as const satisfies readonly DecisionHeadline[]
export interface DiffedDecision {
  cassetteId: string
  stepIndex?: number
  decisionOrdinal: number
  origin: Gate1HarmOrigin
  weight: DecisionWeight
  softWeight?: number
  labelTier?: LabelTier
  sourceChannel?: LabelSourceChannel
  verdictPresent: boolean
  split?: string
  heldOutVisibility?: string
  baselineBriefSource?: BriefSource
  candidateBriefSource?: BriefSource
  headline: DecisionHeadline
  flippedWorse: FloorAxis[]
  flippedBetter: FloorAxis[]
}

export function weightFor(label: CassetteLabelLeg | undefined): DecisionWeight {
  if (label?.verdict === undefined) return 'unverified'
  // 2026-09-07 D-03: scoreCassetteReplay re-scores both arms against the cassette's
  // recorded goldAction (the corrected gold under an overturned label). The same
  // correctness vectors reach this fold; a return to the overturned action has
  // zero harm weight and is disclosed, never charged.
  return label.sourceChannel === 'overturned-verdict' ? 'overturned' : label.tier
}

export function orderHarmed(rows: readonly DiffedDecision[]): DiffedDecision[] {
  const rank = { gold: 0, 'near-gold': 1, silver: 2, unverified: 3, overturned: 3 }
  return [...rows].sort(
    (a, b) =>
      rank[a.weight] - rank[b.weight] ||
      a.cassetteId.localeCompare(b.cassetteId, 'en') ||
      a.decisionOrdinal - b.decisionOrdinal,
  )
}

export function diffArms(rows: readonly ArmDecision[]): DiffedDecision[] {
  const seen = new Set<string>()
  return rows.map((row) => {
    const key = JSON.stringify([row.cassetteId, row.stepIndex ?? null, row.decisionOrdinal])
    if (seen.has(key)) throw new TypeError('decision keys must be unique within a gate')
    seen.add(key)
    const { baseline, candidate, label, entry } = row
    let headline: DecisionHeadline = 'incomparable'
    const flippedWorse: FloorAxis[] = []
    const flippedBetter: FloorAxis[] = []
    if (baseline.kind === 'scored' && candidate.kind === 'scored') {
      const a = baseline.vector.axes.headline
      const b = candidate.vector.axes.headline
      if (a !== 'not-applicable' && b !== 'not-applicable') {
        headline =
          a === 'incorrect' && b === 'correct'
            ? 'fixed'
            : a === 'correct' && b === 'incorrect'
              ? 'broken'
              : b === 'correct'
                ? 'unchanged-correct'
                : 'unchanged-incorrect'
      }
      for (const axis of FLOOR_AXES) {
        if (baseline.vector.axes[axis] === 'correct' && candidate.vector.axes[axis] === 'incorrect')
          flippedWorse.push(axis)
        if (baseline.vector.axes[axis] === 'incorrect' && candidate.vector.axes[axis] === 'correct')
          flippedBetter.push(axis)
      }
    }
    return {
      cassetteId: row.cassetteId,
      ...(row.stepIndex === undefined ? {} : { stepIndex: row.stepIndex }),
      decisionOrdinal: row.decisionOrdinal,
      origin: row.origin,
      weight: weightFor(label),
      ...(row.softWeight === undefined ? {} : { softWeight: row.softWeight }),
      verdictPresent: label?.verdict !== undefined,
      ...(label === undefined ? {} : { labelTier: label.tier, sourceChannel: label.sourceChannel }),
      ...(entry === undefined ? {} : { split: entry.split }),
      ...(entry !== undefined && 'heldOutVisibility' in entry
        ? { heldOutVisibility: entry.heldOutVisibility }
        : {}),
      ...(baseline.kind === 'scored' ? { baselineBriefSource: baseline.briefSource } : {}),
      ...(candidate.kind === 'scored' ? { candidateBriefSource: candidate.briefSource } : {}),
      headline,
      flippedWorse,
      flippedBetter,
    }
  })
}

export interface PerAxisFold {
  perAxisScore: Record<
    FloorAxis,
    { baseline: number; candidate: number; delta: number; floor: number; n: number }
  >
  floorAbsentAxes: FloorAxis[]
  /** Disclosure only: decideGate1 never uses aggregate lifts or regressions. */
  lifts: FloorAxis[]
  regressions: FloorAxis[]
  population: {
    proof: number
    empty: number
    rendered: number
    refused: number
    renderedExcluded: number
  }
}

export function foldPerAxisScore(rows: readonly ArmDecision[], floor: AxisFloorSet): PerAxisFold {
  const population = { proof: 0, empty: 0, rendered: 0, refused: 0, renderedExcluded: 0 }
  const baselineVectors: DecisionCorrectnessVector[] = []
  const candidateVectors: DecisionCorrectnessVector[] = []
  for (const { baseline, candidate } of rows) {
    if (baseline.kind !== 'scored' || candidate.kind !== 'scored') {
      population.refused++
      continue
    }
    if (candidate.briefSource === 'rendered') population.rendered++
    if (baseline.briefSource === 'rendered') {
      population.renderedExcluded++
      continue
    }
    // D-03 (b): the recorded baseline classifies membership; empty-to-rendered is compared.
    population[baseline.briefSource]++
    baselineVectors.push(baseline.vector)
    candidateVectors.push(candidate.vector)
  }
  const floorAbsentAxes: FloorAxis[] = []
  const perAxisScore = Object.fromEntries(
    FLOOR_AXES.map((axis) => {
      const diff = pairedDecisionDiff(
        axisVectors(baselineVectors, axis),
        axisVectors(candidateVectors, axis),
      )
      if (floor[axis].aggregateFloor === undefined) floorAbsentAxes.push(axis)
      return [
        axis,
        {
          baseline: diff.n === 0 ? 0 : (diff.both + diff.aOnly) / diff.n,
          candidate: diff.n === 0 ? 0 : (diff.both + diff.bOnly) / diff.n,
          delta: diff.n === 0 ? 0 : (diff.bOnly - diff.aOnly) / diff.n,
          floor: floor[axis].aggregateFloor ?? 0,
          n: diff.n,
        },
      ]
    }),
  ) as PerAxisFold['perAxisScore']
  const lifts = FLOOR_AXES.filter((axis) => perAxisScore[axis].delta > perAxisScore[axis].floor)
  const regressions = FLOOR_AXES.filter(
    (axis) => perAxisScore[axis].delta < -perAxisScore[axis].floor,
  )
  return { perAxisScore, floorAbsentAxes, population, lifts, regressions }
}
