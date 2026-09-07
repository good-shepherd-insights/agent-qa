import { describe, expect, it } from 'vitest'
import type { Gate1Receipt } from '@vostride/agent-qa-schema'
import * as api from '../../index'
import { diffArms, foldPerAxisScore } from '../decision-diff'
import {
  FLOOR_AXES,
  type AxisCorrectness,
  type DecisionCorrectnessVector,
} from '../../stats/decision-vector'
import type { AxisFloorSet } from '../floor-artefact'
import type { ArmDecision } from '../decision-diff'

function row(
  id = 'cassette-a',
  a: AxisCorrectness = 'incorrect',
  b: AxisCorrectness = 'correct',
): ArmDecision {
  const vector = (headline: AxisCorrectness): DecisionCorrectnessVector => ({
    key: `${id}#-#0`,
    cassetteId: id,
    decisionOrdinal: 0,
    product: 'example-web',
    briefSource: 'proof',
    axes: {
      headline,
      elementIdentity: 'correct',
      value: 'not-applicable',
      opClass: 'correct',
      sideEffect: 'correct',
      loop: 'not-applicable',
    },
  })
  return {
    cassetteId: id,
    decisionOrdinal: 0,
    origin: 'target-step',
    label: {
      tier: 'silver',
      sourceChannel: 'recorded-verdict',
      verdict: { pass: true, reasoning: 'recorded' },
    },
    baseline: { kind: 'scored', vector: vector(a), briefSource: 'proof' },
    candidate: { kind: 'scored', vector: vector(b), briefSource: 'proof' },
  }
}

function floors(value = 0.1): AxisFloorSet {
  const measured = { n: 10, pairs: [], aggregateFloor: value }
  return {
    headline: measured,
    elementIdentity: measured,
    value: measured,
    opClass: measured,
    sideEffect: measured,
    loop: { n: 0, pairs: [] },
  }
}

function invoke(name: string, ...args: unknown[]) {
  const fn = Reflect.get(api, name)
  expect(fn, name).toBeTypeOf('function')
  return fn(...args)
}
const input = () => ({
  kind: 'fact',
  sameFamilyRefused: false,
  targets: diffArms([row()]),
  collateral: [],
  crossCheck: 'flipped',
})

describe('Gate-1 verdict', () => {
  it('fails a ride-along target and keeps the cross-check unrun', () => {
    expect(
      invoke('decideGate1', { ...input(), targets: diffArms([row('a', 'correct', 'correct')]) }),
    ).toMatchObject({ verdict: 'fail', reasons: ['no-positive-value'], crossCheck: 'not-run' })
  })
  it('fails any labelled collateral harm and names the row', () => {
    const collateral = diffArms([
      { ...row('harm', 'correct', 'incorrect'), origin: 'gate-set' as const },
    ])
    expect(invoke('decideGate1', { ...input(), collateral })).toMatchObject({
      verdict: 'fail',
      reasons: ['collateral-harm'],
      crossCheck: 'not-run',
      harmed: collateral,
    })
  })
  it('discloses unverified flips without counting them as harm', () => {
    const collateral = diffArms([
      { ...row('unverified', 'correct', 'incorrect'), label: undefined },
    ])
    expect(invoke('decideGate1', { ...input(), collateral })).toMatchObject({
      verdict: 'pass',
      crossCheck: 'flipped',
      harmed: [],
      unverifiedFlips: collateral,
    })
  })
  it.each([
    ['held', 'fail', 'target-not-reproduced'],
    ['inconclusive', 'abstain', 'inconclusive'],
  ])('folds %s to %s', (crossCheck, verdict, reason) => {
    expect(invoke('decideGate1', { ...input(), crossCheck })).toMatchObject({
      verdict,
      reasons: [reason],
      crossCheck,
    })
  })
  it.each(['procedure', 'policy', 'unknown'])(
    'abstains on kind %s before any other condition',
    (kind) => {
      expect(
        invoke('decideGate1', { ...input(), kind, preSpendAbstain: 'baseline-uncached' }),
      ).toMatchObject({
        verdict: 'abstain',
        reasons: ['tier-not-implemented'],
        crossCheck: 'not-run',
      })
    },
  )
  it('orders and deduplicates reasons, including same-family disclosure', () => {
    expect(
      invoke('decideGate1', {
        ...input(),
        preSpendAbstain: 'baseline-uncached',
        sameFamilyRefused: true,
      }),
    ).toMatchObject({
      verdict: 'abstain',
      reasons: ['baseline-uncached', 'same-family-refused'],
      crossCheck: 'not-run',
    })
    expect(
      invoke('orderGate1Reasons', [
        'collateral-harm',
        'no-positive-value',
        'collateral-harm',
        'same-family-refused',
      ]),
    ).toEqual(['no-positive-value', 'collateral-harm', 'same-family-refused'])
  })
  it('includes broken targets in ordered harm and requires every incorrect target fixed', () => {
    expect(
      invoke('decideGate1', { ...input(), targets: diffArms([row('a', 'correct', 'incorrect')]) }),
    ).toMatchObject({ verdict: 'fail', reasons: ['no-positive-value', 'collateral-harm'] })
    expect(
      invoke('decideGate1', {
        ...input(),
        targets: diffArms([row(), row('b', 'incorrect', 'incorrect')]),
      }),
    ).toMatchObject({ verdict: 'fail', reasons: ['no-positive-value'], crossCheck: 'not-run' })
    const collateral = diffArms(
      ['silver', 'near-gold', 'gold'].map((tier) => ({
        ...row(tier, 'correct', 'incorrect'),
        label: { ...row().label!, tier: tier as 'silver' | 'near-gold' | 'gold' },
      })),
    )
    expect(
      invoke('decideGate1', { ...input(), collateral }).harmed.map(
        (r: { weight: string }) => r.weight,
      ),
    ).toEqual(['gold', 'near-gold', 'silver'])
  })
  it('cannot decide a pass before the cross-check runs', () => {
    expect(Reflect.get(api, 'decideGate1')).toBeTypeOf('function')
    expect(() => invoke('decideGate1', { ...input(), crossCheck: 'not-run' })).toThrow(
      'cross-check must run before a pass is decided',
    )
  })
  it('does not call a lift exactly at the floor a win', () => {
    const score = foldPerAxisScore([row()], floors(1)).perAxisScore.headline
    expect(diffArms([row()])[0]!.headline).toBe('fixed')
    expect(score.delta).toBe(score.floor)
    expect(score.delta <= score.floor).toBe(true)
  })
  it('renders exact pass and abstention lines with cost and key-only judge identity', () => {
    const receipt: Gate1Receipt = {
      schemaVersion: 1,
      gate: 1,
      candidateId: 'synthetic',
      verdict: 'pass',
      producedAtOrdinal: 1,
      producedBy: {},
      receiptDigest: 'a'.repeat(64),
      perAxisScore: foldPerAxisScore([], floors()).perAxisScore,
      corpusVersion: {
        corpusDigest: 'b'.repeat(64),
        partitionVersion: 1,
        gateSetSize: 3,
        excludedCount: 1,
        minimumGateSet: 3,
      },
      samples: { k: 3, seeds: [11], seedHonored: true, modelCalls: 7 },
      crossCheck: 'flipped',
      cap: { maxScreens: 64 },
      spend: { screens: 7, modelCalls: 8, promptTokens: 0, completionTokens: 0, wallClockMs: 0 },
    }
    expect(invoke('renderGate1Line', receipt)).toBe(
      'gate 1 · pass · replay-diff · crossCheck flipped · k=3 · 7/64 screens · 8 calls',
    )
    expect(
      invoke('renderGate1Line', { ...receipt, judgeId: 'model|family=anthropic|judgeVersion=1' }),
    ).toBe(
      'gate 1 · pass · via judge anthropic · crossCheck flipped · k=3 · 7/64 screens · 8 calls',
    )
    expect(
      invoke('renderGate1Line', {
        ...receipt,
        verdict: 'abstain',
        crossCheck: 'not-run',
        spend: undefined,
        samples: { ...receipt.samples, modelCalls: 0 },
        reasons: ['target-unavailable'],
      }),
    ).toBe(
      'gate 1 · abstain · replay-diff · crossCheck not-run · k=3 · 0/64 screens · 0 calls · reason target-unavailable',
    )
  })
})
