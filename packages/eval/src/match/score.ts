import type { ScreenStateMetadata } from '@vostride/agent-qa-schema'

import type {
  Cassette,
  ProcedureEndState,
  ProcedureCassette,
} from '../cassette/cassette'
import type { CassetteSidecarLeg } from '../cassette/sidecar-leg'
import { projectActionGoldValue } from '../extract/sidecar-leg'
import { decisionIdentityKey } from '../replay/identity'
import type {
  DecisionReplayResult,
  ReplayCassetteOutcome,
  ReplayRefusal,
  ReplaySample,
} from '../replay/result'
import { MATCHER_CONFIG } from './config'
import {
  collectProcedurePriorIdentities,
  computeLoopVerdict,
} from './loop'
import type {
  LoopHistory,
  LoopVerdict,
  ProcedurePriorIdentity,
} from './loop'
import { classifySideEffect } from './risk'
import type { SideEffectVerdict } from './risk'
import { runMatchTiers } from './tiers'
import type {
  ElementIdentityVerdict,
  OpClassVerdict,
} from './tiers'
import { tokenSetF1 } from './value'

/** D-03 value-axis result; absence and hard-gate short-circuiting are never numeric. */
export type ValueAxisVerdict =
  | { kind: 'not-applicable' }
  | { kind: 'not-evaluated' }
  | { kind: 'scored'; f1: number; band: 'full' | 'mid' | 'low' }

/** The complete and deliberately narrow D-09 deterministic tie vocabulary. */
export type TieCause = 'partial-identity' | 'value-mid-band' | 'no-consensus'

/** The three primary score axes. No combined numeric field exists (MATCH-04). */
export interface DecisionAxes {
  elementIdentity: ElementIdentityVerdict
  opClass: OpClassVerdict
  value: ValueAxisVerdict
}

/** The attribution-grade breakdown carried by settled scores and unresolved ties. */
export interface DecisionPartialBreakdown {
  axes: DecisionAxes
  sideEffect: SideEffectVerdict
  loop: LoopVerdict
  tierReached: 1 | 2 | 3
}

/**
 * MATCH-04 decision verdict. Failures have no fabricated axes, and unresolved ties preserve the
 * computed partial breakdown when a real decision sample exists.
 */
export type DecisionScore =
  | ({ kind: 'scored'; matcherVersion: number } & DecisionPartialBreakdown)
  | { kind: 'miss-by-failure'; reason: string; matcherVersion: number }
  | {
      kind: 'unresolved-tie'
      cause: TieCause
      partial?: DecisionPartialBreakdown
      matcherVersion: number
    }

/** Typed exclusion returned when no decision or scoreable failure outcome exists. */
export interface NeverScoredDecision {
  kind: 'never-scored'
  reason: 'all-samples-harness-error' | 'modal-representative-missing'
  matcherVersion: number
}

/** Direct decision-scoring outcome, including the D-08 harness-only exclusion. */
export type ScoreDecisionOutcome = DecisionScore | NeverScoredDecision

/** Context that binds a score to its recorded screen and procedure prefix. */
export interface ScoreDecisionContext {
  priorIdentities: LoopHistory
  screenStateHash: string
  stateMetadata?: ScreenStateMetadata
}

/** One counted cassette entry: a decision score, a never-scored exclusion, or a typed skip. */
export type DecisionScoreEntry =
  | {
      kind: 'decision'
      decisionOrdinal: number
      stepIndex?: number
      score: DecisionScore
    }
  | {
      kind: 'never-scored'
      decisionOrdinal: number
      stepIndex?: number
      reason:
        | NeverScoredDecision['reason']
        | 'missing-cassette-decision'
      matcherVersion: number
    }
  | {
      kind: 'skipped'
      stepIndex: number
      decisionOrdinal?: number
      reason: 'cache-served' | 'synthesized'
    }

/** D-12 procedure context only; this is not a procedure-level pass/fail verdict. */
export interface ProcedureScoreSummary {
  stepsMatchedFraction: number
  firstDivergentStepIndex?: number
  endState: ProcedureEndState
}

/** Per-cassette scoring result with refusals and shape failures kept as typed outcomes. */
export type CassetteScore =
  | { kind: 'leaf'; cassetteId: string; entry: DecisionScoreEntry }
  | {
      kind: 'procedure'
      cassetteId: string
      entries: readonly DecisionScoreEntry[]
      summary: ProcedureScoreSummary
    }
  | { kind: 'replay-refusal'; cassetteId: string; refusal: ReplayRefusal }
  | {
      kind: 'shape-mismatch'
      cassetteId: string
      reason: 'granularity-mismatch'
      matcherVersion: number
    }

function valueBand(f1: number): 'full' | 'mid' | 'low' {
  if (f1 >= MATCHER_CONFIG.valueMidBand.high) return 'full'
  if (f1 >= MATCHER_CONFIG.valueMidBand.low) return 'mid'
  return 'low'
}

function scoreValueAxis(
  sidecar: CassetteSidecarLeg,
  action: Extract<ReplaySample['outcome'], { kind: 'decision' }>['action'],
  opClass: OpClassVerdict,
): ValueAxisVerdict {
  if (opClass.kind === 'mismatch') return { kind: 'not-evaluated' }
  if (sidecar.goldValue === undefined) return { kind: 'not-applicable' }
  const candidateValue = projectActionGoldValue(action) ?? ''
  const f1 = tokenSetF1(sidecar.goldValue, candidateValue)
  return { kind: 'scored', f1, band: valueBand(f1) }
}

function buildBreakdown(
  sidecar: CassetteSidecarLeg,
  sample: ReplaySample,
  context: ScoreDecisionContext,
): DecisionPartialBreakdown | undefined {
  if (sample.outcome.kind !== 'decision') return undefined
  const tierResult = runMatchTiers(
    sidecar,
    { action: sample.outcome.action, identity: sample.outcome.identity },
    context.stateMetadata,
  )
  return {
    axes: {
      elementIdentity: tierResult.elementIdentity,
      opClass: tierResult.opClass,
      value: scoreValueAxis(sidecar, sample.outcome.action, tierResult.opClass),
    },
    sideEffect: classifySideEffect(sidecar.goldAction, sample.outcome.action),
    loop: computeLoopVerdict(
      sample.outcome.identity,
      context.screenStateHash,
      context.priorIdentities,
    ),
    tierReached: tierResult.tierReached,
  }
}

function partialIdentity(elementIdentity: ElementIdentityVerdict): boolean {
  return (
    elementIdentity.kind === 'scored' &&
    elementIdentity.level !== 'full' &&
    elementIdentity.level !== 'miss'
  )
}

function scoreBreakdown(breakdown: DecisionPartialBreakdown): DecisionScore {
  if (partialIdentity(breakdown.axes.elementIdentity)) {
    return {
      kind: 'unresolved-tie',
      cause: 'partial-identity',
      partial: breakdown,
      matcherVersion: MATCHER_CONFIG.matcherVersion,
    }
  }
  if (
    breakdown.axes.elementIdentity.kind === 'scored' &&
    breakdown.axes.elementIdentity.level === 'full' &&
    breakdown.axes.value.kind === 'scored' &&
    breakdown.axes.value.band === 'mid'
  ) {
    return {
      kind: 'unresolved-tie',
      cause: 'value-mid-band',
      partial: breakdown,
      matcherVersion: MATCHER_CONFIG.matcherVersion,
    }
  }
  return {
    kind: 'scored',
    ...breakdown,
    matcherVersion: MATCHER_CONFIG.matcherVersion,
  }
}

function firstDecisionSample(result: DecisionReplayResult): ReplaySample | undefined {
  return result.samples.find(sample => sample.outcome.kind === 'decision')
}

/**
 * Select the first real Action in the modal identity class (D-10/F2). Agreement identities do
 * not carry coordinate geometry or raw value payloads and are therefore never scored directly.
 */
export function representativeDecisionSample(
  result: DecisionReplayResult,
): ReplaySample | undefined {
  const modal = result.agreement.modal
  if (modal === undefined) return firstDecisionSample(result)
  const modalKey = decisionIdentityKey(modal.identity)
  return result.samples.find(
    sample =>
      sample.outcome.kind === 'decision' &&
      decisionIdentityKey(sample.outcome.identity) === modalKey,
  )
}

/** Assemble one matcher-versioned D-08/D-09/D-10 decision outcome. */
export function scoreDecision(
  sidecar: CassetteSidecarLeg,
  result: DecisionReplayResult,
  context: ScoreDecisionContext = {
    priorIdentities: 'leaf-no-history',
    screenStateHash: '',
  },
): ScoreDecisionOutcome {
  const nonHarnessSamples = result.samples.filter(
    sample => sample.outcome.kind !== 'harness-error',
  )
  if (nonHarnessSamples.length === 0) {
    return {
      kind: 'never-scored',
      reason: 'all-samples-harness-error',
      matcherVersion: MATCHER_CONFIG.matcherVersion,
    }
  }

  if (result.agreement.noConsensus) {
    const partial = firstDecisionSample(result)
    const breakdown = partial === undefined ? undefined : buildBreakdown(sidecar, partial, context)
    return {
      kind: 'unresolved-tie',
      cause: 'no-consensus',
      ...(breakdown === undefined ? {} : { partial: breakdown }),
      matcherVersion: MATCHER_CONFIG.matcherVersion,
    }
  }

  const selected =
    result.agreement.modal === undefined
      ? nonHarnessSamples[0]
      : representativeDecisionSample(result)
  if (selected === undefined) {
    return {
      kind: 'never-scored',
      reason: 'modal-representative-missing',
      matcherVersion: MATCHER_CONFIG.matcherVersion,
    }
  }

  if (selected.outcome.kind === 'planner-failure') {
    return {
      kind: 'miss-by-failure',
      reason: selected.outcome.reason,
      matcherVersion: MATCHER_CONFIG.matcherVersion,
    }
  }
  if (selected.outcome.kind === 'unservable-divergence') {
    return {
      kind: 'miss-by-failure',
      reason: `unservable-divergence:${selected.outcome.tool}`,
      matcherVersion: MATCHER_CONFIG.matcherVersion,
    }
  }
  if (selected.outcome.kind === 'harness-error') {
    return {
      kind: 'never-scored',
      reason: 'all-samples-harness-error',
      matcherVersion: MATCHER_CONFIG.matcherVersion,
    }
  }

  const breakdown = buildBreakdown(sidecar, selected, context)
  if (breakdown === undefined) {
    return {
      kind: 'never-scored',
      reason: 'modal-representative-missing',
      matcherVersion: MATCHER_CONFIG.matcherVersion,
    }
  }
  return scoreBreakdown(breakdown)
}

function decisionEntry(
  decisionOrdinal: number,
  result: DecisionReplayResult,
  sidecar: CassetteSidecarLeg,
  context: ScoreDecisionContext,
  stepIndex?: number,
): DecisionScoreEntry {
  const outcome = scoreDecision(sidecar, result, context)
  if (outcome.kind === 'never-scored') {
    return {
      kind: 'never-scored',
      decisionOrdinal,
      ...(stepIndex === undefined ? {} : { stepIndex }),
      reason: outcome.reason,
      matcherVersion: outcome.matcherVersion,
    }
  }
  return {
    kind: 'decision',
    decisionOrdinal,
    ...(stepIndex === undefined ? {} : { stepIndex }),
    score: outcome,
  }
}

function isSettledFull(entry: DecisionScoreEntry): boolean {
  if (entry.kind !== 'decision' || entry.score.kind !== 'scored') return false
  const { axes, sideEffect, loop } = entry.score
  const valueFull =
    axes.value.kind === 'not-applicable' ||
    (axes.value.kind === 'scored' && axes.value.band === 'full')
  return (
    axes.opClass.kind === 'match' &&
    axes.elementIdentity.kind === 'scored' &&
    axes.elementIdentity.level === 'full' &&
    valueFull &&
    sideEffect.kind === 'none' &&
    loop.kind !== 'flagged'
  )
}

function missingDecisionEntry(
  stepIndex: number,
  decisionOrdinal: number,
): DecisionScoreEntry {
  return {
    kind: 'never-scored',
    stepIndex,
    decisionOrdinal,
    reason: 'missing-cassette-decision',
    matcherVersion: MATCHER_CONFIG.matcherVersion,
  }
}

function scoreProcedure(
  cassette: ProcedureCassette,
  outcome: Extract<ReplayCassetteOutcome, { granularity: 'procedure' }>,
): CassetteScore {
  const history = collectProcedurePriorIdentities(cassette)
  const entries: DecisionScoreEntry[] = outcome.steps.map(step => {
    if (step.kind === 'skipped') {
      return {
        kind: 'skipped',
        stepIndex: step.stepIndex,
        ...(step.decisionOrdinal === undefined
          ? {}
          : { decisionOrdinal: step.decisionOrdinal }),
        reason: step.reason,
      }
    }

    const record = cassette.steps.find(
      candidate =>
        candidate.kind === 'decision' &&
        candidate.stepIndex === step.stepIndex &&
        candidate.decisionOrdinal === step.decisionOrdinal,
    )
    if (record === undefined || record.kind !== 'decision') {
      return missingDecisionEntry(step.stepIndex, step.decisionOrdinal)
    }
    const priorIdentities: readonly ProcedurePriorIdentity[] = history.filter(
      prior => prior.stepIndex < step.stepIndex,
    )
    return decisionEntry(
      step.decisionOrdinal,
      step.result,
      record.record.sidecar,
      {
        priorIdentities,
        screenStateHash: record.record.receipt.screenStateHash,
        stateMetadata: record.record.input.stateBefore.metadata,
      },
      step.stepIndex,
    )
  })

  const decisionEntries = entries.filter(entry => entry.kind !== 'skipped')
  const matched = decisionEntries.filter(isSettledFull).length
  const stepsMatchedFraction =
    decisionEntries.length === 0 ? 0 : matched / decisionEntries.length
  const firstDivergent = decisionEntries.find(entry => !isSettledFull(entry))
  return {
    kind: 'procedure',
    cassetteId: cassette.id,
    entries,
    summary: {
      stepsMatchedFraction,
      ...(firstDivergent === undefined || firstDivergent.stepIndex === undefined
        ? {}
        : { firstDivergentStepIndex: firstDivergent.stepIndex }),
      endState: outcome.endState,
    },
  }
}

function isReplayRefusal(outcome: ReplayCassetteOutcome): outcome is ReplayRefusal {
  return 'kind' in outcome && outcome.kind === 'integrity-refusal'
}

/** Score a replay result against its exact cassette without collapsing any axis to a scalar. */
export function scoreCassetteReplay(
  cassette: Cassette,
  outcome: ReplayCassetteOutcome,
): CassetteScore {
  if (isReplayRefusal(outcome)) {
    return { kind: 'replay-refusal', cassetteId: outcome.cassetteId, refusal: outcome }
  }

  if (cassette.granularity === 'leaf') {
    if (outcome.granularity !== 'leaf') {
      return {
        kind: 'shape-mismatch',
        cassetteId: cassette.id,
        reason: 'granularity-mismatch',
        matcherVersion: MATCHER_CONFIG.matcherVersion,
      }
    }
    return {
      kind: 'leaf',
      cassetteId: cassette.id,
      entry: decisionEntry(
        cassette.decisionOrdinal,
        outcome,
        cassette.sidecar,
        {
          priorIdentities: 'leaf-no-history',
          screenStateHash: cassette.receipt.screenStateHash,
          stateMetadata: cassette.input.stateBefore.metadata,
        },
      ),
    }
  }

  if (outcome.granularity !== 'procedure') {
    return {
      kind: 'shape-mismatch',
      cassetteId: cassette.id,
      reason: 'granularity-mismatch',
      matcherVersion: MATCHER_CONFIG.matcherVersion,
    }
  }
  return scoreProcedure(cassette, outcome)
}
