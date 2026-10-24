// 2026-09-30, 432-10 D-05/D-08/D-22: the gate-inconsistent hold is read from standing receipts
// alone. No posture marker, proposal id or inbox read can hold or release a candidate.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { asEvidenceToken } from '../../ids/record-id'
import {
  GATE_RECEIPT_SCHEMA_VERSION,
  stampReceiptDigest,
  type GateReceipt,
  type GateVerdict,
} from '../gate-receipt'
import {
  detectGateInconsistency,
  evaluatePromotionGate,
  type PromotionCanaryPosture,
  type PromotionGateInput,
  type ResolvedPromotionGatePosture,
} from '../promotion-gate'

function resolvedPosture(
  overrides: Partial<ResolvedPromotionGatePosture> = {},
): ResolvedPromotionGatePosture {
  return {
    kind: 'resolved', replayGateAvailable: true, gateSetNonEmpty: true, gateSetVerdict: 'ok',
    corpusDigest: 'c'.repeat(64), minimumGateSet: 63,
    counts: { natural: 0, heldOutShared: 0, heldOutPrivate: 0, adversarial: 0, excludedCount: 0 },
    scope: { partition: 'checkout', resolution: 'product-key' },
    judge: { capable: false, reason: 'no-judge-configured' },
    canary: { kind: 'not-provided', rarePathEligible: false },
    ...overrides,
  }
}

function receipt(gate: 1 | 2 | 3, verdict: GateVerdict, producedAtOrdinal = 5): GateReceipt {
  const core = {
    schemaVersion: GATE_RECEIPT_SCHEMA_VERSION as typeof GATE_RECEIPT_SCHEMA_VERSION,
    candidateId: 'candidate', verdict, producedAtOrdinal,
    producedBy: { opId: 'gate-test' },
  }
  const corpusDigest = 'c'.repeat(64)
  if (gate === 3) return stampReceiptDigest({ ...core, gate, runId: 'run', mark: 'confirmed-bug' })
  if (gate === 2) return stampReceiptDigest({
    ...core, gate, corpusVersion: { corpusDigest }, attributedObservationId: 'observation',
    benefit: 'exercised-benefited', stateValidity: 'valid',
  })
  const score = { baseline: 0.5, candidate: 0.8, delta: 0.3, floor: 0.1, n: 10 }
  return stampReceiptDigest({
    ...core, gate,
    perAxisScore: { headline: score, elementIdentity: score, value: score, opClass: score,
      sideEffect: score, loop: score },
    corpusVersion: { corpusDigest, partitionVersion: 2, gateSetSize: 63,
      excludedCount: 0, minimumGateSet: 63 },
    samples: { k: 1, seeds: [1], seedHonored: true, modelCalls: 0 }, crossCheck: 'held',
  })
}

function factInput(overrides: Partial<PromotionGateInput> = {}): PromotionGateInput {
  return {
    kind: 'fact', subtype: 'selector', status: 'candidate', validityOpen: true,
    anchors: [{ t: 'el', role: 'button', name: 'submit order', ordinal: 0 }],
    originClass: 'agent-verified', withheld: false, needsEnrichment: false,
    evidenceIncomplete: false,
    distilledObservations: [{ element: { naturalKey: 'button:submit order:0' } }],
    confirmedOutcomeEvidenceTokens: [asEvidenceToken('confirmed-submit-order')],
    hasUserDeprecateInLineage: false, memoryOffForAnchorGroup: false,
    ...overrides,
  }
}

// The canary posture a pre-432 host could still hand in: a pending-review marker naming a
// proposal. Built through `unknown` because the current posture type has no such member.
const legacyCanary = {
  kind: 'provided', rarePathEligible: false,
  inconsistency: { pending: true, proposalId: 'prop_0123456789abcdef' },
} as unknown as PromotionCanaryPosture

describe('432 the gate-inconsistent hold is evidence-only (D-05, D-22)', () => {
  const inconsistent = { verdict: 'hold', reason: 'gate-inconsistent' }
  const contradiction = () => [receipt(1, 'pass'), receipt(2, 'fail', 6)]

  it('C432-PROMOTION-GATE-RETAINED: contradictory standing receipts hold, Gate-3 stays sovereign, clean receipts promote', () => {
    // Confirmed and never-confirmed candidates both hold on same-digest pass and fail.
    expect(evaluatePromotionGate(factInput({ gatePosture: resolvedPosture(),
      gateReceipts: contradiction() }))).toEqual(inconsistent)
    expect(evaluatePromotionGate(factInput({ confirmedOutcomeEvidenceTokens: [],
      gatePosture: resolvedPosture(), gateReceipts: contradiction() }))).toEqual(inconsistent)
    // A sovereign Gate-3 pass precedes the contradiction.
    const g3 = receipt(3, 'pass', 7)
    expect(evaluatePromotionGate(factInput({ confirmedOutcomeEvidenceTokens: [],
      gatePosture: resolvedPosture(), gateReceipts: [...contradiction(), g3] })))
      .toEqual({ verdict: 'promote', promotionPath: 'user-sovereign', citedReceiptDigests: [g3.receiptDigest] })
    // Newer clean evidence clears the hold; nothing else is needed.
    const g1 = receipt(1, 'pass')
    const g2 = receipt(2, 'pass', 7)
    expect(detectGateInconsistency([...contradiction(), g2])).toBeUndefined()
    expect(evaluatePromotionGate(factInput({ gatePosture: resolvedPosture(),
      gateReceipts: [...contradiction(), g2] })))
      .toEqual({ verdict: 'promote', promotionPath: 'gate1+gate2',
        citedReceiptDigests: [g1.receiptDigest, g2.receiptDigest] })
    // A leftover pending-review marker neither holds clean receipts nor releases a contradiction.
    expect(evaluatePromotionGate(factInput({ gatePosture: resolvedPosture({ canary: legacyCanary }),
      gateReceipts: [g1, g2] })))
      .toEqual({ verdict: 'promote', promotionPath: 'gate1+gate2',
        citedReceiptDigests: [g1.receiptDigest, g2.receiptDigest] })
    expect(evaluatePromotionGate(factInput({ gatePosture: resolvedPosture({ canary: legacyCanary }),
      gateReceipts: contradiction() }))).toEqual(inconsistent)
  })

  it('holds on the held-out shape and on absent posture, from receipts alone', () => {
    const g1 = receipt(1, 'fail')
    if (g1.gate !== 1) throw new Error('Expected Gate-1 fixture')
    const { receiptDigest: _digest, ...body } = g1
    const harmed = stampReceiptDigest({ ...body, harmed: [{ cassetteId: 'heldout-cassette',
      decisionOrdinal: 0, origin: 'gate-set' as const, verdictPresent: true,
      split: 'held-out', axes: ['headline' as const] }] })
    expect(evaluatePromotionGate(factInput({ gatePosture: resolvedPosture(),
      gateReceipts: [harmed, receipt(2, 'pass', 6)] }))).toEqual(inconsistent)
    expect(evaluatePromotionGate(factInput({ gateReceipts: contradiction() }))).toEqual(inconsistent)
  })

  it('reads no posture marker: the gate source names no canary inconsistency or proposal', () => {
    const source = readFileSync(new URL('../promotion-gate.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/canary\.inconsistency/)
    expect(source).not.toMatch(/proposalId/)
    expect(source.split('detectGateInconsistency(standing)').length - 1).toBe(1)
  })
})
