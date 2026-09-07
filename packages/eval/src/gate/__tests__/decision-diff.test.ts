import { describe, expect, it } from 'vitest'
import { FLOOR_AXES, type AxisCorrectness, type DecisionCorrectnessVector } from '../../stats/decision-vector'
import type { AxisFloorSet } from '../floor-artefact'
import { diffArms, foldPerAxisScore, weightFor, type ArmDecision } from '../decision-diff'

export function row(id = 'cassette-a', a: AxisCorrectness = 'incorrect', b: AxisCorrectness = 'correct'): ArmDecision {
  const vector = (headline: AxisCorrectness): DecisionCorrectnessVector => ({
    key: `${id}#-#0`, cassetteId: id, decisionOrdinal: 0, product: 'example-web', briefSource: 'proof',
    axes: { headline, elementIdentity: 'correct', value: 'not-applicable', opClass: 'correct', sideEffect: 'correct', loop: 'not-applicable' },
  })
  return { cassetteId: id, decisionOrdinal: 0, origin: 'target-step',
    label: { tier: 'silver', sourceChannel: 'recorded-verdict', verdict: { pass: true, reasoning: 'recorded' } },
    baseline: { kind: 'scored', vector: vector(a), briefSource: 'proof' },
    candidate: { kind: 'scored', vector: vector(b), briefSource: 'proof' } }
}

export function floors(value = 0.1): AxisFloorSet {
  const measured = { n: 10, pairs: [], aggregateFloor: value }
  return { headline: measured, elementIdentity: measured, value: measured, opClass: measured,
    sideEffect: measured, loop: { n: 0, pairs: [] } }
}

describe('per-decision diff', () => {
  it.each([
    ['incorrect', 'correct', 'fixed'], ['correct', 'incorrect', 'broken'],
    ['correct', 'correct', 'unchanged-correct'], ['incorrect', 'incorrect', 'unchanged-incorrect'],
  ] as const)('%s to %s is %s', (a, b, headline) => {
    expect(diffArms([row('cassette-a', a, b)])[0]!.headline).toBe(headline)
  })
  it('names exactly the axes that move, excluding inapplicable axes', () => {
    const input = row('cassette-a', 'correct', 'incorrect')
    if (input.candidate.kind !== 'scored') throw new Error('fixture')
    input.candidate.vector.axes.elementIdentity = 'incorrect'
    input.candidate.vector.axes.value = 'incorrect'
    expect(diffArms([input])[0]).toMatchObject({ flippedWorse: ['headline', 'elementIdentity'], flippedBetter: [] })
  })
  it('discloses optional provenance only when supplied and does not mutate rows', () => {
    const input = row()
    const before = structuredClone(input)
    expect(diffArms([input])[0]).not.toHaveProperty('split')
    expect(input).toEqual(before)
    input.entry = { schemaVersion: 2, cassetteId: input.cassetteId, product: 'example-web',
      captured_at_ordinal: 1, run_links: { runId: 'synthetic', runSlug: 'synthetic' }, receiptDigest: 'a'.repeat(64),
      split: 'held-out', heldOutVisibility: 'private' }
    expect(diffArms([input])[0]).toMatchObject({ split: 'held-out', heldOutVisibility: 'private' })
  })
  it('makes refused arms incomparable and rejects duplicate identities with TypeError', () => {
    expect(diffArms([{ ...row(), candidate: { kind: 'refused', reason: 'unsupported' } }])[0])
      .toMatchObject({ headline: 'incomparable', flippedWorse: [], flippedBetter: [] })
    expect(() => diffArms([row(), row()])).toThrow(TypeError)
    expect(diffArms([row(), { ...row(), stepIndex: 0 }])).toHaveLength(2)
  })
  it('gives no weight to labels without a verdict', () => {
    expect(weightFor(undefined)).toBe('unverified')
    expect(weightFor({ tier: 'gold', sourceChannel: 'user-mark' })).toBe('unverified')
    for (const tier of ['gold', 'near-gold', 'silver'] as const) {
      expect(weightFor({ ...row().label!, tier })).toBe(tier)
    }
  })
})

describe('per-axis paired scores', () => {
  it('compares empty-to-rendered, excludes rendered baselines, and discloses absent floors', () => {
    const empty = row('empty')
    const rendered = row('rendered', 'correct', 'incorrect')
    if (empty.baseline.kind !== 'scored' || empty.candidate.kind !== 'scored' || rendered.baseline.kind !== 'scored') throw new Error('fixture')
    empty.baseline.briefSource = 'empty'
    empty.candidate.briefSource = 'rendered'
    rendered.baseline.briefSource = 'rendered'
    const result = foldPerAxisScore([empty, rendered, { ...row('refused'), candidate: { kind: 'refused', reason: 'missing' } }], floors())
    expect(result.population).toEqual({ proof: 0, empty: 1, rendered: 1, refused: 1, renderedExcluded: 1 })
    expect(result.perAxisScore.headline).toEqual({ baseline: 0, candidate: 1, delta: 1, floor: 0.1, n: 1 })
    expect(result.floorAbsentAxes).toEqual(['loop'])
    expect(result.perAxisScore.loop).toEqual({ baseline: 0, candidate: 0, delta: 0, floor: 0, n: 0 })
  })
  it('retains all six axes with finite zero rates when nothing pairs', () => {
    const result = foldPerAxisScore([], floors())
    expect(Object.keys(result.perAxisScore)).toEqual(FLOOR_AXES)
    for (const score of Object.values(result.perAxisScore)) {
      expect(score).toMatchObject({ baseline: 0, candidate: 0, delta: 0, n: 0 })
    }
  })
})
