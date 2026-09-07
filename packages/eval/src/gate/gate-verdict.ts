/** 417 D-02/D-03/D-09/D-20: pure ordered verdict fold over per-decision evidence. */
import { GATE1_REASONS } from '@vostride/agent-qa-schema'
import type { CrossCheck, Gate1Reason, Gate1Receipt, GateVerdict } from '@vostride/agent-qa-schema'
import type { DiffedDecision } from './decision-diff'
import { orderHarmed } from './decision-diff'

export interface Gate1DecisionInput {
  kind: string
  preSpendAbstain?: Gate1Reason
  sameFamilyRefused: boolean
  targets: readonly DiffedDecision[]
  collateral: readonly DiffedDecision[]
  crossCheck: CrossCheck
}
export interface Gate1Decision {
  verdict: GateVerdict
  reasons: Gate1Reason[]
  crossCheck: CrossCheck
  harmed: DiffedDecision[]
  unverifiedFlips: DiffedDecision[]
}

export function orderGate1Reasons(reasons: Iterable<Gate1Reason>): Gate1Reason[] {
  const present = new Set(reasons)
  return GATE1_REASONS.filter((reason) => present.has(reason))
}

export function decideGate1(input: Gate1DecisionInput): Gate1Decision {
  let harmed: DiffedDecision[] = []
  let unverifiedFlips: DiffedDecision[] = []
  const result = (
    verdict: GateVerdict,
    reasons: Gate1Reason[],
    crossCheck: CrossCheck = 'not-run',
  ): Gate1Decision => ({
    verdict,
    crossCheck,
    harmed,
    unverifiedFlips,
    reasons: orderGate1Reasons([
      ...reasons,
      ...(input.sameFamilyRefused ? ['same-family-refused' as const] : []),
    ]),
  })
  if (input.kind !== 'fact' && input.kind !== 'caution')
    return result('abstain', ['tier-not-implemented'])
  if (input.preSpendAbstain !== undefined) return result('abstain', [input.preSpendAbstain])

  const worse = [...input.targets, ...input.collateral].filter((row) => row.flippedWorse.length > 0)
  harmed = orderHarmed(
    worse.filter(
      (row) => row.weight === 'gold' || row.weight === 'near-gold' || row.weight === 'silver',
    ),
  )
  unverifiedFlips = orderHarmed(
    worse.filter((row) => row.weight === 'unverified' || row.weight === 'overturned'),
  )
  const incorrectTargets = input.targets.filter(
    (row) => row.headline === 'fixed' || row.headline === 'unchanged-incorrect',
  )
  if (incorrectTargets.length === 0) {
    return result('fail', [
      'no-positive-value',
      ...(harmed.length > 0 ? ['collateral-harm' as const] : []),
    ])
  }
  if (harmed.length > 0) return result('fail', ['collateral-harm'])
  if (
    incorrectTargets.some((row) => row.headline !== 'fixed') ||
    input.targets.some((row) => row.headline === 'incomparable')
  ) {
    return result('fail', ['no-positive-value'])
  }
  switch (input.crossCheck) {
    case 'flipped':
      return result('pass', [], 'flipped')
    case 'held':
      return result('fail', ['target-not-reproduced'], 'held')
    case 'inconclusive':
      return result('abstain', ['inconclusive'], 'inconclusive')
    case 'not-run':
      throw new TypeError('cross-check must run before a pass is decided')
  }
}

function judgeFamilyOf(judgeId: string): string {
  return (
    judgeId
      .split('|')
      .find((part) => part.startsWith('family='))
      ?.slice('family='.length) ?? 'unknown'
  )
}

export function renderGate1Line(receipt: Gate1Receipt): string {
  const { verdict, judgeId, crossCheck, samples, spend, cap, reasons } = receipt
  return `gate 1 · ${verdict} · ${judgeId ? 'via judge ' + judgeFamilyOf(judgeId) : 'replay-diff'} · crossCheck ${crossCheck} · k=${samples.k} · ${spend?.screens ?? 0}/${cap?.maxScreens ?? '?'} screens · ${spend?.modelCalls ?? samples.modelCalls} calls${reasons?.length ? ' · reason ' + reasons[0] : ''}`
}
