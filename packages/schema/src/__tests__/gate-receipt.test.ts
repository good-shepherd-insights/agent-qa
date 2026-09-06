import { describe, expect, it } from 'vitest'
import {
  GateReceiptSchema, PromotionReceiptSchema, receiptDigestOf, stampReceiptDigest,
  standingReceiptsByGate, strongestPromotionPath,
} from '../knowledge/gate-receipt'

function core() {
  return { schemaVersion: 1 as const, candidateId: 'candidate', verdict: 'pass' as const,
    producedAtOrdinal: 5, producedBy: { jobId: 'replay' } }
}
function gate1() {
  const score = { baseline: 0.5, candidate: 0.8, delta: 0.3, floor: 0.1, n: 10 }
  return stampReceiptDigest({ ...core(), gate: 1 as const,
    perAxisScore: { headline: score, elementIdentity: score, value: score, opClass: score,
      sideEffect: score, loop: score },
    corpusVersion: { corpusDigest: 'c'.repeat(64), partitionVersion: 2, gateSetSize: 10,
      excludedCount: 1, minimumGateSet: 3 },
    samples: { k: 1, seeds: [1], seedHonored: true, modelCalls: 0 },
    crossCheck: 'held' as const, judgeId: 'judge', degradation: 'replay-diff' as const,
    noiseFloorRef: { profileKey: 'planner-judge', corpusDigest: 'c'.repeat(64) },
  })
}
function gate2() {
  return stampReceiptDigest({ ...core(), gate: 2 as const, attributedObservationId: 'observation',
    benefit: 'exercised-benefited' as const, stateValidity: 'valid' as const })
}
function gate3() {
  return stampReceiptDigest({ ...core(), gate: 3 as const, runId: 'run', stepId: 'step',
    mark: 'confirmed-bug' as const })
}
function promotion(promotionPath: 'deterministic-verdict-floor' | 'gate1-lower-trust' | 'gate1+gate2' | 'user-sovereign') {
  return stampReceiptDigest({ schemaVersion: 1 as const, kind: 'promotion' as const,
    candidateId: 'candidate', producedAtOrdinal: 5, producedBy: {}, promotionPath,
    citedReceiptDigests: [] })
}

describe('416 strict complete receipt vocabulary', () => {
  it('parses a complete Gate-1 receipt and round-trips its content digest', () => {
    const receipt = gate1()
    expect(GateReceiptSchema.safeParse(receipt).success).toBe(true)
    const parsed = GateReceiptSchema.parse(receipt)
    expect(parsed).toEqual(receipt)
    expect(receiptDigestOf(parsed)).toBe(receipt.receiptDigest)
  })
  it('refuses missing samples, missing loop and an unknown cross check', () => {
    const { samples: _samples, ...missingSamples } = gate1()
    const { loop: _loop, ...missingLoop } = gate1().perAxisScore
    for (const receipt of [missingSamples, { ...gate1(), perAxisScore: missingLoop },
      { ...gate1(), crossCheck: 'maybe' }]) {
      expect(GateReceiptSchema.safeParse(receipt).success).toBe(false)
    }
  })
  it('parses Gate-2 attribution and refuses an unknown benefit or state validity', () => {
    expect(GateReceiptSchema.safeParse(gate2()).success).toBe(true)
    expect(GateReceiptSchema.safeParse({ ...gate2(), benefit: 'helped' }).success).toBe(false)
    expect(GateReceiptSchema.safeParse({ ...gate2(), stateValidity: 'maybe' }).success).toBe(false)
  })
  it('parses Gate-3 marks with or without stepId and refuses cross-arm fields', () => {
    expect(GateReceiptSchema.safeParse(gate3()).success).toBe(true)
    const { stepId: _stepId, ...withoutStep } = gate3()
    expect(GateReceiptSchema.safeParse(withoutStep).success).toBe(true)
    const parsed = GateReceiptSchema.safeParse({ ...gate3(), corpusVersion: gate1().corpusVersion })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unrecognized_keys', keys: ['corpusVersion'] }),
    ]))
    expect(GateReceiptSchema.safeParse({ ...gate3(), mark: 'confirmed-defect' }).success).toBe(false)
  })
  it('refuses gate 4, unknown verdict and an unknown promotion path', () => {
    expect(GateReceiptSchema.safeParse({ ...gate1(), gate: 4 }).success).toBe(false)
    expect(GateReceiptSchema.safeParse({ ...gate1(), verdict: 'maybe' }).success).toBe(false)
    expect(PromotionReceiptSchema.safeParse({ ...promotion('deterministic-verdict-floor'), promotionPath: 'gate4' }).success).toBe(false)
  })
  it('keeps every evidence object strict and enforces counts and digest bounds', () => {
    const receipt = gate1()
    for (const invalid of [
      { ...receipt, perAxisScore: { ...receipt.perAxisScore, extra: receipt.perAxisScore.loop } },
      { ...receipt, perAxisScore: { ...receipt.perAxisScore, loop: { ...receipt.perAxisScore.loop, extra: 1 } } },
      { ...receipt, perAxisScore: { ...receipt.perAxisScore, loop: { ...receipt.perAxisScore.loop, n: -1 } } },
      { ...receipt, corpusVersion: { ...receipt.corpusVersion, minimumGateSet: 0 } },
      { ...receipt, corpusVersion: { ...receipt.corpusVersion, corpusDigest: 'bad' } },
      { ...receipt, corpusVersion: { ...receipt.corpusVersion, extra: 1 } },
      { ...receipt, samples: { ...receipt.samples, k: 0 } },
      { ...receipt, samples: { ...receipt.samples, seeds: [1.5] } },
      { ...receipt, samples: { ...receipt.samples, extra: 1 } },
      { ...receipt, noiseFloorRef: { ...receipt.noiseFloorRef, extra: 1 } },
      { ...receipt, degradation: 'unknown' },
    ]) expect(GateReceiptSchema.safeParse(invalid).success).toBe(false)
  })
  it('selects the greatest ordinal and breaks ties with the later line', () => {
    const first = GateReceiptSchema.parse(gate1())
    const failed = GateReceiptSchema.parse({ ...gate1(), verdict: 'fail', producedAtOrdinal: 9 })
    const second = GateReceiptSchema.parse({ ...gate2(), producedAtOrdinal: 9 })
    const later = GateReceiptSchema.parse({ ...gate1(), producedAtOrdinal: 9 })
    expect(standingReceiptsByGate([first, failed, second, later])).toEqual([later, second])
  })
  it('selects the strongest promotion path and leaves absent history undefined', () => {
    expect(strongestPromotionPath([])).toBeUndefined()
    expect(strongestPromotionPath([promotion('deterministic-verdict-floor'), promotion('gate1-lower-trust')])).toBe('gate1-lower-trust')
    expect(strongestPromotionPath([promotion('gate1+gate2'), promotion('user-sovereign')])).toBe('user-sovereign')
  })
})
