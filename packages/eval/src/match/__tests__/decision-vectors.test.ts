import { describe, expect, it } from 'vitest'
import type { LeafReplayResult } from '../../replay/result'
import { makeLabel } from '../../replay/__tests__/fixtures'
import { axisVectors } from '../../stats/decision-vector'
import type { DecisionCorrectnessVector } from '../../stats/decision-vector'
import {
  DECISION_VECTORS_SCHEMA_VERSION,
  decisionCorrectnessVectors,
  decisionVectorsDocumentSchema,
  guardDecisionVectorsDocument,
  projectDecisionVectorsDocument,
} from '../decision-vectors'
import { buildEvalReport } from '../metrics'
import type { ScoredBatchEntry } from '../metrics'
import type { DecisionPartialBreakdown, DecisionScore } from '../score'

function breakdown(): DecisionPartialBreakdown {
  return {
    axes: {
      elementIdentity: { kind: 'scored', level: 'full', numeric: 1, tier: 2 },
      opClass: { kind: 'match', opClass: 'activate' },
      value: { kind: 'not-applicable' },
    },
    sideEffect: { kind: 'none' }, loop: { kind: 'not-applicable' }, tierReached: 2,
  }
}

function settled(): Extract<DecisionScore, { kind: 'scored' }> {
  return { kind: 'scored', matcherVersion: 1, ...breakdown() }
}

function replay(cassetteId = 'leaf'): LeafReplayResult {
  return {
    granularity: 'leaf', cassetteId, briefSource: 'proof', samples: [],
    agreement: { k: 1, agreementRate: 1, noConsensus: false, harnessErrorCount: 0 },
    promptDrift: { drift: false, harnessDrift: false, recordedHash: 'hash', recomputedHash: 'hash' },
    replayedModel: { provider: 'test', modelId: 'fixture' },
    unconsumedExchanges: [], totalDurationMs: 0,
  }
}

function entry(score: DecisionScore = settled(), cassetteId = 'leaf'): ScoredBatchEntry {
  return {
    cassetteId, outcome: replay(cassetteId),
    score: { kind: 'leaf', cassetteId, entry: { kind: 'decision', decisionOrdinal: 7, score } },
  }
}

const fullAxes = {
  headline: 'correct', elementIdentity: 'correct', value: 'not-applicable',
  opClass: 'correct', sideEffect: 'correct', loop: 'not-applicable',
} as const

function vector(): DecisionCorrectnessVector {
  return {
    key: 'leaf#-#7', cassetteId: 'leaf', decisionOrdinal: 7,
    product: 'default', briefSource: 'proof', axes: { ...fullAxes },
  }
}

describe('decisionCorrectnessVectors', () => {
  it('projects all six pinned axes, leaf score ordinal, source and default product', () => {
    expect(decisionCorrectnessVectors([entry()])).toEqual([vector()])
  })

  it('treats within-tolerance as incorrect for both headline and element identity', () => {
    const score = settled()
    score.axes.elementIdentity = { kind: 'scored', level: 'within-tolerance', numeric: 0.5, tier: 3 }
    expect(decisionCorrectnessVectors([entry(score)])[0]!.axes)
      .toEqual({ ...fullAxes, headline: 'incorrect', elementIdentity: 'incorrect' })
  })

  it('excludes unscorable identity from headline and identity, retaining other axes', () => {
    const score = settled()
    score.axes.elementIdentity = { kind: 'unscorable', cause: 'no-gold-evidence' }
    expect(decisionCorrectnessVectors([entry(score)])[0]!.axes)
      .toEqual({ ...fullAxes, headline: 'not-applicable', elementIdentity: 'not-applicable' })
  })

  it('keeps a not-evaluated identity in the headline denominator as a miss', () => {
    const score = settled()
    score.axes.elementIdentity = { kind: 'not-evaluated' }
    score.axes.opClass = { kind: 'mismatch', goldClass: 'activate', candidateClass: 'type' }
    expect(decisionCorrectnessVectors([entry(score)])[0]!.axes)
      .toEqual({ ...fullAxes, headline: 'incorrect', elementIdentity: 'not-applicable', opClass: 'incorrect' })
  })

  it('excludes contrastive negatives only from headline', () => {
    const negative = entry()
    negative.label = makeLabel({ pairing: { relation: 'contrastive-negative', pairedCassetteId: 'pair' } })
    expect(decisionCorrectnessVectors([negative])[0]!.axes)
      .toEqual({ ...fullAxes, headline: 'not-applicable' })
  })

  it.each(['element-identity', 'value'] as const)('settles only the judge-equivalent %s axis', axis => {
    const score = settled()
    score.axes.elementIdentity = { kind: 'scored', level: 'miss', numeric: 0, tier: 2 }
    score.axes.value = { kind: 'scored', band: 'low', f1: 0 }
    score.judgeSettled = {
      axis, resolution: 'equivalent', cause: axis === 'value' ? 'value-mid-band' : 'partial-identity',
      judgeId: 'fixture', judgeVersion: 1, confidence: 'high',
    }
    const axes = decisionCorrectnessVectors([entry(score)])[0]!.axes
    expect(axes.headline).toBe('incorrect')
    expect(axes.elementIdentity).toBe(axis === 'element-identity' ? 'correct' : 'incorrect')
    expect(axes.value).toBe(axis === 'value' ? 'correct' : 'incorrect')
    if (axis === 'element-identity') score.axes.value = { kind: 'not-applicable' }
    else score.axes.elementIdentity = { kind: 'scored', level: 'full', numeric: 1, tier: 2 }
    expect(decisionCorrectnessVectors([entry(score)])[0]!.axes.headline).toBe('correct')
    score.judgeSettled.resolution = 'different'
    expect(decisionCorrectnessVectors([entry(score)])[0]!.axes.headline).toBe('incorrect')
  })

  it.each(['full', 'mid', 'low'] as const)('projects scored value band %s', band => {
    const score = settled()
    score.axes.value = { kind: 'scored', band, f1: band === 'full' ? 1 : 0.5 }
    expect(decisionCorrectnessVectors([entry(score)])[0]!.axes.value)
      .toBe(band === 'full' ? 'correct' : 'incorrect')
  })

  it('excludes a not-evaluated value from that axis', () => {
    const score = settled()
    score.axes.value = { kind: 'not-evaluated' }
    expect(decisionCorrectnessVectors([entry(score)])[0]!.axes.value).toBe('not-applicable')
  })

  it('projects side-effect and loop flags without combining them into a score', () => {
    const score = settled()
    score.sideEffect = { kind: 'flagged', reason: 'fixture risk', riskFamily: 'destructive' }
    score.loop = { kind: 'flagged', priorStepIndex: 2 }
    expect(decisionCorrectnessVectors([entry(score)])[0]!.axes)
      .toEqual({ ...fullAxes, headline: 'incorrect', sideEffect: 'incorrect', loop: 'incorrect' })
    score.sideEffect = { kind: 'none' }
    score.loop = { kind: 'none' }
    expect(decisionCorrectnessVectors([entry(score)])[0]!.axes.loop).toBe('correct')
  })

  it('preserves the report headline denominator for ties, partials and scored failures', () => {
    const entries = [entry(), entry({ kind: 'miss-by-failure', reason: 'no action', matcherVersion: 1 }, 'failure'),
      entry({ kind: 'unresolved-tie', cause: 'partial-identity', partial: breakdown(), matcherVersion: 1 }, 'partial'),
      entry({ kind: 'unresolved-tie', cause: 'no-consensus', matcherVersion: 1 }, 'tie')]
    const vectors = decisionCorrectnessVectors(entries)
    expect(vectors).toHaveLength(4)
    expect(vectors[1]!.axes).toEqual({ headline: 'incorrect', elementIdentity: 'not-applicable',
      value: 'not-applicable', opClass: 'not-applicable', sideEffect: 'not-applicable', loop: 'not-applicable' })
    expect(vectors[2]!.axes).toEqual({ ...fullAxes, headline: 'not-applicable' })
    expect(Object.values(vectors[3]!.axes)).toEqual(Array(6).fill('not-applicable'))
    const headline = axisVectors(vectors, 'headline')
    expect(buildEvalReport(entries).headline.firstAttemptDecisionAccuracy)
      .toEqual({ numerator: headline.filter(v => v.correct).length, denominator: headline.length, rate: 0.5 })
  })

  it('uses entry product before the partition map and never mutates inputs', () => {
    const explicit = { ...entry(), product: 'entry-product' }
    const fallback = entry(settled(), 'mapped')
    const entries = [explicit, fallback]
    const before = structuredClone(entries)
    const map = new Map([['leaf', 'other-product'], ['mapped', 'map-product']])
    expect(decisionCorrectnessVectors(entries, map).map(v => v.product))
      .toEqual(['entry-product', 'map-product'])
    expect(entries).toEqual(before)
  })

  it('pairs procedure results by step and ordinal even when score entries are reordered', () => {
    const procedure: ScoredBatchEntry = {
      cassetteId: 'procedure', outcome: { granularity: 'procedure', cassetteId: 'procedure',
        steps: [
          { kind: 'decision', stepIndex: 2, decisionOrdinal: 1, result: replay('procedure') },
          { kind: 'skipped', stepIndex: 3, reason: 'cache-served' },
          { kind: 'decision', stepIndex: 5, decisionOrdinal: 2, result: { ...replay('procedure'), briefSource: 'rendered' } },
        ], endState: { outcome: 'passed' }, totalDurationMs: 0 },
      score: { kind: 'procedure', cassetteId: 'procedure',
        entries: [
          { kind: 'decision', stepIndex: 5, decisionOrdinal: 2, score: settled() },
          { kind: 'skipped', stepIndex: 3, reason: 'cache-served' },
          { kind: 'decision', stepIndex: 2, decisionOrdinal: 1, score: settled() },
        ], summary: { stepsMatchedFraction: 1, endState: { outcome: 'passed' } } },
    }
    expect(decisionCorrectnessVectors([procedure]).map(v => [v.key, v.stepIndex, v.briefSource]))
      .toEqual([['procedure#5#2', 5, 'rendered'], ['procedure#2#1', 2, 'proof']])
  })

  it('emits no vectors for refusal, absent score, skipped or never-scored entries', () => {
    const refused: ScoredBatchEntry = { ...entry(), outcome: { kind: 'integrity-refusal',
      cassetteId: 'leaf', reason: 'missing-blob', detail: 'missing fixture blob' } }
    const unscored = entry()
    delete unscored.score
    const skipped: ScoredBatchEntry = { ...entry(), score: { kind: 'leaf', cassetteId: 'leaf',
      entry: { kind: 'never-scored', decisionOrdinal: 7, matcherVersion: 1, reason: 'all-samples-harness-error' } } }
    expect(decisionCorrectnessVectors([refused, unscored, skipped])).toEqual([])
  })

  it('omits unknown historical source stamps from pairing while keeping report scores intact', () => {
    const legacy = entry(settled(), 'legacy')
    Reflect.deleteProperty(legacy.outcome, 'briefSource')
    const entries = [legacy, entry()]
    const vectors = decisionCorrectnessVectors(entries)
    expect(vectors).toEqual([vector()])
    expect(legacy.outcome).not.toHaveProperty('briefSource')
    expect(buildEvalReport(entries).headline.firstAttemptDecisionAccuracy)
      .toEqual({ numerator: 2, denominator: 2, rate: 1 })
    expect(guardDecisionVectorsDocument(projectDecisionVectorsDocument({
      batchKey: 'batch', matcherVersion: 1, vectors,
    })).kind).toBe('ok')
  })
})

describe('decision vectors document', () => {
  const valid = () => ({ schemaVersion: 1, batchKey: 'batch', matcherVersion: 1, vectors: [vector()] })

  it('projects a deterministic strict document and round-trips through its guard', () => {
    expect(DECISION_VECTORS_SCHEMA_VERSION).toBe(1)
    const input = { batchKey: 'batch', matcherVersion: 1, vectors: [vector()] }
    const document = projectDecisionVectorsDocument(input)
    expect(document).toEqual(valid())
    expect(document.vectors).not.toBe(input.vectors)
    expect(document.vectors[0]!.axes).not.toBe(input.vectors[0]!.axes)
    expect(decisionVectorsDocumentSchema.safeParse(document).success).toBe(true)
    expect(guardDecisionVectorsDocument(JSON.parse(JSON.stringify(document))))
      .toEqual({ kind: 'ok', document })
  })

  it.each([
    ['wrong schema', () => ({ ...valid(), schemaVersion: 2 })],
    ['unknown document key', () => ({ ...valid(), prompt: 'must never be persisted' })],
    ['unknown vector key', () => ({ ...valid(), vectors: [{ ...vector(), heldOutVisibility: 'private' }] })],
    ['unknown axis', () => ({ ...valid(), vectors: [{ ...vector(), axes: { ...fullAxes, recovery: 'correct' } }] })],
    ['missing axis', () => { const doc = valid(); Reflect.deleteProperty(doc.vectors[0]!.axes, 'loop'); return doc }],
    ['invalid axis value', () => ({ ...valid(), vectors: [{ ...vector(), axes: { ...fullAxes, loop: 'maybe' } }] })],
    ['missing provenance', () => { const doc = valid(); Reflect.deleteProperty(doc.vectors[0]!, 'briefSource'); return doc }],
    ['negative ordinal', () => ({ ...valid(), vectors: [{ ...vector(), decisionOrdinal: -1 }] })],
    ['fractional step', () => ({ ...valid(), vectors: [{ ...vector(), stepIndex: 0.5 }] })],
  ])('rejects %s with a typed reason', (_label, makeInvalid) => {
    const result = guardDecisionVectorsDocument(makeInvalid())
    expect(result.kind).toBe('rejected')
    if (result.kind !== 'rejected') throw new Error('expected rejection')
    expect(result.reason.length).toBeGreaterThan(0)
  })

  it('projects only document fields and rejects extra vector content', () => {
    const extraDocument = { ...valid(), prompt: 'private bytes' }
    expect(projectDecisionVectorsDocument(extraDocument)).toEqual(valid())
    const extraVector = { ...valid(), vectors: [{ ...vector(), prompt: 'private bytes' }] }
    expect(() => projectDecisionVectorsDocument(extraVector)).toThrow(TypeError)
  })
})
