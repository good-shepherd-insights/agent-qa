/** 417 D-01 / 415 D-05: pure one-line edit planning; recorded proof selection is authoritative. */
import type { CandidateInjection } from '@vostride/agent-qa-schema'
import type { LeafCassette } from '../cassette/cassette'
import { applyBriefDelta, type DeclaredBriefDelta } from '../replay/brief-delta'

export interface CandidateArmPlan {
  delta: DeclaredBriefDelta
  expectedBriefSource: 'proof' | 'rendered'
  turnMatch?: 'exact' | 'uniform'
}
export type CandidateArmRefusal = { kind: 'unrenderable-target'; detail: string }

export function toDeclaredBriefDelta(
  injection: CandidateInjection,
  cassette: LeafCassette,
): { kind: 'plan'; plan: CandidateArmPlan } | CandidateArmRefusal {
  const { line, renderedLine } = injection
  const tier = line.tier
  if (tier !== 'L0' && tier !== 'L1' && tier !== 'L2') {
    return { kind: 'unrenderable-target', detail: `unsupported brief tier ${tier}` }
  }
  const brief = cassette.input.servedBrief
  const delta: DeclaredBriefDelta = {
    kind: 'injected',
    line,
    tier,
    renderedLine,
    channel1Position: brief.channel1.length,
    turnOrdinal: cassette.decisionOrdinal,
    position: 0,
  }
  const turns = brief.proof?.promptTurns ?? []
  const first = turns[0]
  if (first !== undefined) {
    const exact = turns.find((turn) => turn.turnOrdinal === cassette.decisionOrdinal)
    const uniform = turns.every(
      (turn) =>
        turn.policyL0 === first.policyL0 &&
        turn.learnedL1 === first.learnedL1 &&
        turn.learnedL2 === first.learnedL2,
    )
    const turn = exact ?? (uniform ? first : undefined)
    if (turn === undefined) {
      return {
        kind: 'unrenderable-target',
        detail: `no promptTurn matches decisionOrdinal ${cassette.decisionOrdinal} (turnOrdinals ${turns.map((item) => item.turnOrdinal).join(',')} differ)`,
      }
    }
    const text =
      turn[
        { L0: 'policyL0', L1: 'learnedL1', L2: 'learnedL2' }[tier] as
          'policyL0' | 'learnedL1' | 'learnedL2'
      ]
    return {
      kind: 'plan',
      plan: {
        delta: {
          ...delta,
          turnOrdinal: turn.turnOrdinal,
          position: text === '' ? 0 : text.split('\n').length,
        },
        expectedBriefSource: 'proof',
        turnMatch: exact === undefined ? 'uniform' : 'exact',
      },
    }
  }
  // An existing proof with no turn cannot satisfy applyBriefDelta's exact-one-turn law.
  if (brief.proof !== undefined) {
    return { kind: 'unrenderable-target', detail: 'brief proof carries no prompt turns' }
  }
  if (brief.channel1.length === 0 && brief.channel2.length + brief.channel3.length > 0) {
    return {
      kind: 'unrenderable-target',
      detail: 'brief populated on channel2/channel3 only and carries no proof',
    }
  }
  return { kind: 'plan', plan: { delta, expectedBriefSource: 'rendered' } }
}

export function injectCandidate(cassette: LeafCassette, plan: CandidateArmPlan): LeafCassette {
  return { ...cassette, input: applyBriefDelta(cassette.input, plan.delta) }
}
