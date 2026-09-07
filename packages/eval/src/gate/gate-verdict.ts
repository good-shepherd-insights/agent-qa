/** 417 D-02/D-03/D-09/D-20: pure ordered verdict fold over per-decision evidence. */
import { GATE1_REASONS } from '@vostride/agent-qa-schema'
import type { CrossCheck, Gate1Reason, Gate1Receipt, GateVerdict } from '@vostride/agent-qa-schema'
import type { DiffedDecision } from './decision-diff'
import { orderHarmed } from './decision-diff'
import { FLOOR_AXES, type FloorAxis } from '../stats/decision-vector'
import { generalizationRatio, MIN_LIFT_DECISIONS } from '../stats/generalization'
import { pairedBootstrapCI } from '../stats/bootstrap'
import { createSeededRng } from '../stats/prng'
import type { NoiseFloorArtefact } from './floor-artefact'

/** D-15 product measurements are disclosures, never verdict inputs. */
export function productFloorRows(
  floor: NoiseFloorArtefact,
  product: string,
): { product: string; axes: { axis: FloorAxis; floor: number | null; n: number }[] } | undefined {
  if (!Object.hasOwn(floor.products, product)) return undefined
  const record = floor.products[product]!
  return {
    product,
    axes: FLOOR_AXES.map((axis) => ({
      axis,
      floor: record.axes[axis].aggregateFloor ?? null,
      n: record.axes[axis].n,
    })),
  }
}

export interface GeneralizationDisclosure {
  liftDecisions: number
  minimumLiftDecisions: number
  ratio?: number
  ci?: [number, number]
}

/** D-04: positive-fix rates and a conditional bootstrap CI; never a verdict input. */
export function generalizationDisclosure(input: {
  targets: readonly DiffedDecision[]
  heldOut: readonly DiffedDecision[]
}): GeneralizationDisclosure {
  const liftDecisions = input.targets.filter((row) => row.headline === 'fixed').length
  const result: GeneralizationDisclosure = {
    liftDecisions,
    minimumLiftDecisions: MIN_LIFT_DECISIONS,
  }
  // An empty held-out population supplies no measured rate or interval.
  if (liftDecisions < MIN_LIFT_DECISIONS || input.heldOut.length === 0) return result
  const optimizeLiftRate = liftDecisions / input.targets.length
  const measured = generalizationRatio({
    optimizeLiftDecisions: liftDecisions,
    optimizeLiftRate,
    heldOutLiftRate:
      input.heldOut.filter((row) => row.headline === 'fixed').length / input.heldOut.length,
    floor: 0,
  })
  if (measured.ratio === undefined || !Number.isFinite(measured.ratio)) return result
  // Reuse 415's paired bootstrap with the observed target rate held fixed. This
  // disclosure counts positive fixes (not net gains), so pairs encode each
  // held-out decision's fix indicator. Divide each draw by the target rate to
  // keep the CI in ratio units. Stable ordering and a named seed make it repeatable.
  const pairs = orderHarmed(input.heldOut).map((row) => ({ a: false, b: row.headline === 'fixed' }))
  const ci = pairedBootstrapCI(
    pairs,
    (sample) =>
      sample.reduce((sum, pair) => sum + Number(pair.b) - Number(pair.a), 0) /
      sample.length /
      optimizeLiftRate,
    createSeededRng('gate1-generalization-v1'),
  )
  if (Number.isFinite(ci.lower) && Number.isFinite(ci.upper)) {
    result.ratio = measured.ratio
    result.ci = [ci.lower, ci.upper]
  }
  return result
}

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
