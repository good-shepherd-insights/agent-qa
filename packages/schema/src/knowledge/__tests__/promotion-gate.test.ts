import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { asEvidenceToken } from '../../ids/record-id'
import { distilledObservationSchema } from '../distilled-observation'
import { stampReceiptDigest, type GateReceipt, type GateVerdict } from '../gate-receipt'
import {
  detectGateInconsistency,
  evaluatePromotionGate,
  type PromotionGateHoldReason,
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

function receipt(
  gate: 1 | 2 | 3, verdict: GateVerdict, producedAtOrdinal = 5,
  overrides: { corpusDigest?: string } = {},
): GateReceipt {
  const core = {
    schemaVersion: 1 as const, candidateId: 'candidate', verdict, producedAtOrdinal,
    producedBy: { opId: 'gate-test' },
  }
  const corpusDigest = overrides.corpusDigest ?? 'c'.repeat(64)
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

const submitAnchor = {
  t: 'el' as const,
  role: 'button',
  name: 'submit order',
  ordinal: 0,
}

function factInput(overrides: Partial<PromotionGateInput> = {}): PromotionGateInput {
  return {
    kind: 'fact',
    subtype: 'selector',
    status: 'candidate',
    validityOpen: true,
    anchors: [submitAnchor, { t: 'platform', platform: 'web' }],
    originClass: 'agent-verified',
    withheld: false,
    needsEnrichment: false,
    evidenceIncomplete: false,
    distilledObservations: [
      { element: { naturalKey: 'button:submit order:0' } },
    ],
    confirmedOutcomeEvidenceTokens: [asEvidenceToken('confirmed-submit-order')],
    hasUserDeprecateInLineage: false,
    memoryOffForAnchorGroup: false,
    ...overrides,
  }
}

function cautionInput(overrides: Partial<PromotionGateInput> = {}): PromotionGateInput {
  return {
    kind: 'caution',
    status: 'candidate',
    validityOpen: true,
    anchors: [{ t: 'error', message: 'checkout timed out' }],
    originClass: 'agent-verified',
    withheld: false,
    needsEnrichment: false,
    evidenceIncomplete: false,
    distilledObservations: [
      {
        error: {
          naturalKey: 'checkout timed out',
          rootCauseClass: 'environment',
        },
      },
    ],
    confirmedOutcomeEvidenceTokens: [asEvidenceToken('confirmed-checkout-caution')],
    hasUserDeprecateInLineage: false,
    memoryOffForAnchorGroup: false,
    ...overrides,
  }
}

describe('evaluatePromotionGate fact evidence (D-16/D-18)', () => {
  it('promotes a candidate fact with an open window and matching element evidence', () => {
    expect(evaluatePromotionGate(factInput())).toEqual({ verdict: 'promote', promotionPath: 'deterministic-verdict-floor', citedReceiptDigests: [] })
  })

  it('promotes a navigational fact whose page primary is backed by a matching element', () => {
    expect(evaluatePromotionGate(factInput({
      subtype: 'navigational',
      anchors: [
        { t: 'page', route: '/confirmation' },
        submitAnchor,
        { t: 'platform', platform: 'web' },
      ],
    }))).toEqual({ verdict: 'promote', promotionPath: 'deterministic-verdict-floor', citedReceiptDigests: [] })
  })

  it('holds a fact until a surviving confirmed outcome supplies V4 evidence', () => {
    expect(evaluatePromotionGate(factInput({ confirmedOutcomeEvidenceTokens: [] }))).toEqual({
      verdict: 'hold',
      reason: 'no-confirmed-evidence',
    })
  })

  it('holds ambiguous multi-element evidence instead of accepting one matching element', () => {
    expect(evaluatePromotionGate(factInput({
      distilledObservations: [
        { element: { naturalKey: 'button:submit order:0' } },
        { element: { naturalKey: 'button:cancel order:1' } },
      ],
    }))).toEqual({
      verdict: 'hold',
      reason: 'no-element-observation',
    })
  })

  it('keys on evidence rather than authorship path while holding bare fallback Adds', () => {
    expect(evaluatePromotionGate(factInput({ originClass: 'agent-observed' })))
      .toEqual({ verdict: 'promote', promotionPath: 'deterministic-verdict-floor', citedReceiptDigests: [] })
    expect(evaluatePromotionGate(factInput({
      originClass: 'agent-observed',
      needsEnrichment: true,
    }))).toEqual({ verdict: 'hold', reason: 'needs-enrichment' })
  })
})

describe('evaluatePromotionGate caution evidence (T-379-07)', () => {
  it('promotes only a caution with a typed learnable root-cause class', () => {
    expect(evaluatePromotionGate(cautionInput())).toEqual({ verdict: 'promote', promotionPath: 'deterministic-verdict-floor', citedReceiptDigests: [] })

    expect(evaluatePromotionGate(cautionInput({
      distilledObservations: [
        { error: { naturalKey: 'environment: checkout timed out' } },
      ],
    }))).toEqual({ verdict: 'hold', reason: 'missing-root-cause' })
  })

  it('round-trips rootCauseClass as additive identity-bearing observation evidence', () => {
    const observation = {
      schemaVersion: 1,
      step: { naturalKey: 'checkout', ordinal: 0 },
      error: {
        naturalKey: 'checkout timed out',
        rootCauseClass: 'timeout' as const,
      },
      observedAtOrdinal: 42,
    }

    expect(distilledObservationSchema.parse(observation)).toEqual(observation)
    expect(distilledObservationSchema.safeParse({
      ...observation,
      error: { ...observation.error, rootCauseClass: 'app-bug' },
    }).success).toBe(false)
  })
})

describe('evaluatePromotionGate exclusion walls', () => {
  it.each(['procedure', 'policy', 'unknown'] as const)(
    'holds kind %s before considering otherwise-complete evidence',
    (kind) => {
      expect(evaluatePromotionGate(factInput({ kind }))).toEqual({
        verdict: 'hold',
        reason: 'kind-excluded',
      })
    },
  )

  const exclusionCases: ReadonlyArray<[
    name: string,
    override: Partial<PromotionGateInput>,
    reason: PromotionGateHoldReason,
  ]> = [
    ['non-candidate status', { status: 'active' }, 'not-candidate'],
    ['closed validity window', { validityOpen: false }, 'window-closed'],
    ['withheld provenance', { withheld: true }, 'withheld'],
    ['needs-enrichment provenance', { needsEnrichment: true }, 'needs-enrichment'],
    ['incomplete evidence', { evidenceIncomplete: true }, 'evidence-incomplete'],
    ['memory-off anchor group', { memoryOffForAnchorGroup: true }, 'memory-off-anchor'],
    ['user-deprecated lineage', { hasUserDeprecateInLineage: true }, 'user-deprecated'],
  ]

  it.each(exclusionCases)('holds %s with its typed reason', (_name, override, reason) => {
    expect(evaluatePromotionGate(factInput(override))).toEqual({ verdict: 'hold', reason })
  })

  it('holds bridge-style facts whose synthetic payload has no element observation', () => {
    expect(evaluatePromotionGate(factInput({ distilledObservations: [] }))).toEqual({
      verdict: 'hold',
      reason: 'no-element-observation',
    })
  })
})

describe('promotion gate architecture', () => {
  it('checks inconsistency after sovereign and before v51 evidence, outside promoteVia', () => {
    const source = readFileSync(new URL('../promotion-gate.ts', import.meta.url), 'utf8')
    expect(source.indexOf("promotionPath: 'user-sovereign'"))
      .toBeLessThan(source.indexOf('detectGateInconsistency(standing)'))
    expect(source.indexOf('detectGateInconsistency(standing)'))
      .toBeLessThan(source.indexOf("hold('withheld')"))
    const promoteVia = source.slice(source.indexOf('function promoteVia('),
      source.indexOf('function promotionElementAnchor('))
    expect(promoteVia).not.toMatch(/detectGateInconsistency|inconsistency/)
  })
  it('has no model, port, provider, or adapter import path', () => {
    const source = readFileSync(new URL('../promotion-gate.ts', import.meta.url), 'utf8')

    expect(source).not.toMatch(
      /from\s+['"][^'"]*(?:model|port|provider|adapter)[^'"]*['"]/i,
    )
  })
})

describe('416 ordered receipt promotion paths', () => {
  const gated = (gateReceipts: readonly GateReceipt[],
    overrides: Partial<PromotionGateInput> = {}) => evaluatePromotionGate(factInput({
      gatePosture: resolvedPosture(), gateReceipts, ...overrides,
    }))
  const rarePosture = () => resolvedPosture({
    canary: { kind: 'provided', attributedRows: 100, rarePathEligible: true },
  })

  it('requires gate1-receipt-required for fact and caution on a bound gate with empty receipts', () => {
    for (const build of [factInput, cautionInput]) {
      expect(evaluatePromotionGate(build({ gatePosture: resolvedPosture(), gateReceipts: [] })))
        .toEqual({ verdict: 'hold', reason: 'gate1-receipt-required' })
    }
    expect(gated([receipt(2, 'pass')])).toEqual({ verdict: 'hold', reason: 'gate1-receipt-required' })
  })

  it('requires gate2-receipt-required after Gate-1 without rare-path eligibility', () => {
    expect(gated([receipt(1, 'pass')])).toEqual({ verdict: 'hold', reason: 'gate2-receipt-required' })
    expect(gated([receipt(1, 'pass')], { gatePosture: resolvedPosture({
      canary: { kind: 'provided', attributedRows: 100, rarePathEligible: false },
    }) })).toEqual({ verdict: 'hold', reason: 'gate2-receipt-required' })
  })

  it('promotes gate1-lower-trust only with explicit rarePathEligible and cites Gate-1', () => {
    const g1 = receipt(1, 'pass')
    expect(gated([g1], { gatePosture: rarePosture() })).toEqual({
      verdict: 'promote', promotionPath: 'gate1-lower-trust', citedReceiptDigests: [g1.receiptDigest],
    })
  })

  it.each([5, 6])('promotes gate1+gate2 for a current Gate-2 at ordinal %s (>= adjacency)', (ordinal) => {
    const g1 = receipt(1, 'pass', 5)
    const g2 = receipt(2, 'pass', ordinal)
    expect(gated([g2, g1])).toEqual({ verdict: 'promote', promotionPath: 'gate1+gate2',
      citedReceiptDigests: [g1.receiptDigest, g2.receiptDigest] })
    expect(evaluatePromotionGate(cautionInput({ gatePosture: resolvedPosture(),
      gateReceipts: [g1, g2] }))).toEqual({ verdict: 'promote', promotionPath: 'gate1+gate2',
      citedReceiptDigests: [g1.receiptDigest, g2.receiptDigest] })
  })

  it('holds gate2-receipt-required when Gate-2 predates Gate-1', () => {
    const g1 = receipt(1, 'pass', 5)
    const g2 = receipt(2, 'pass', 4)
    expect(gated([g1, g2])).toEqual({ verdict: 'hold', reason: 'gate2-receipt-required' })
    expect(gated([g1, g2], { gatePosture: rarePosture() })).toEqual({
      verdict: 'promote', promotionPath: 'gate1-lower-trust', citedReceiptDigests: [g1.receiptDigest],
    })
  })

  it.each([1, 2] as const)('holds gate-failed for a standing Gate-%s fail, even on the rare path', (gate) => {
    // 418 D-17: an ordinary failure uses a distinct corpus; same-digest conflict is pinned below.
    expect(gated([receipt(1, 'pass'), receipt(gate, 'fail', 6, { corpusDigest: 'd'.repeat(64) })],
      { gatePosture: rarePosture() })).toEqual({ verdict: 'hold', reason: 'gate-failed' })
  })

  it.each([1, 2] as const)('holds gate-abstained for a standing Gate-%s abstain', (gate) => {
    expect(gated([receipt(1, 'pass'), receipt(gate, 'abstain', 6)],
      { gatePosture: rarePosture() })).toEqual({ verdict: 'hold', reason: 'gate-abstained' })
  })

  it.each([1, 2] as const)('holds receipt-stale for Gate-%s corpus mismatch and accepts a newer current pass', (gate) => {
    const g1 = receipt(1, 'pass', 5)
    const stale = receipt(gate, 'pass', 6, { corpusDigest: 'd'.repeat(64) })
    const current = receipt(gate, 'pass', 7)
    expect(gated([g1, stale], { gatePosture: rarePosture() }))
      .toEqual({ verdict: 'hold', reason: 'receipt-stale' })
    expect(gated([g1, current, stale], { gatePosture: rarePosture() })).toEqual({
      verdict: 'promote', promotionPath: gate === 1 ? 'gate1-lower-trust' : 'gate1+gate2',
      citedReceiptDigests: gate === 1 ? [current.receiptDigest] : [g1.receiptDigest, current.receiptDigest],
    })
  })

  it('breaks ordinal ties with the later array line for the standing Gate-1', () => {
    const pass = receipt(1, 'pass', 5)
    const fail = receipt(1, 'fail', 5)
    expect(gated([fail, pass], { gatePosture: rarePosture() })).toEqual({
      verdict: 'promote', promotionPath: 'gate1-lower-trust', citedReceiptDigests: [pass.receiptDigest],
    })
    expect(gated([pass, fail], { gatePosture: rarePosture() }))
      .toEqual({ verdict: 'hold', reason: 'gate-failed' })
  })

  it('promotes user-sovereign without v51 evidence, Gate-1 or Gate-2 on every host', () => {
    const g3 = receipt(3, 'pass')
    for (const gatePosture of [undefined, resolvedPosture(),
      resolvedPosture({ replayGateAvailable: false })]) {
      for (const build of [factInput, cautionInput]) {
        expect(evaluatePromotionGate(build({ gatePosture, gateReceipts: [g3],
          confirmedOutcomeEvidenceTokens: [], distilledObservations: [], withheld: true,
          needsEnrichment: true, evidenceIncomplete: true, memoryOffForAnchorGroup: true,
          hasUserDeprecateInLineage: true,
        }))).toEqual({ verdict: 'promote', promotionPath: 'user-sovereign',
          citedReceiptDigests: [g3.receiptDigest] })
      }
    }
  })

  it('never makes Gate-3 stale when other receipts cite a different corpus', () => {
    const g3 = receipt(3, 'pass')
    expect(gated([receipt(1, 'pass', 10, { corpusDigest: 'd'.repeat(64) }), g3]))
      .toEqual({ verdict: 'promote', promotionPath: 'user-sovereign',
        citedReceiptDigests: [g3.receiptDigest] })
  })

  it('uses the standing Gate-3 instead of an older sovereign pass', () => {
    expect(gated([receipt(3, 'pass', 4), receipt(3, 'fail', 5)]))
      .toEqual({ verdict: 'hold', reason: 'gate1-receipt-required' })
    expect(gated([receipt(3, 'pass', 5), receipt(3, 'abstain', 5)]))
      .toEqual({ verdict: 'hold', reason: 'gate1-receipt-required' })
  })

  it('orders user-sovereign above gate1+gate2 above gate1-lower-trust', () => {
    const g1 = receipt(1, 'pass')
    const g2 = receipt(2, 'pass')
    const g3 = receipt(3, 'pass')
    expect(gated([g1, g2, g3], { gatePosture: rarePosture() })).toEqual({
      verdict: 'promote', promotionPath: 'user-sovereign', citedReceiptDigests: [g3.receiptDigest],
    })
    expect(gated([g1, g2], { gatePosture: rarePosture() })).toEqual({
      verdict: 'promote', promotionPath: 'gate1+gate2', citedReceiptDigests: [g1.receiptDigest, g2.receiptDigest],
    })
    expect(gated([g1], { gatePosture: rarePosture() })).toEqual({
      verdict: 'promote', promotionPath: 'gate1-lower-trust', citedReceiptDigests: [g1.receiptDigest],
    })
  })

  it.each([true, false])('holds posture-unavailable before evidence or sovereign with replay=%s', (replayGateAvailable) => {
    expect(gated([receipt(3, 'pass')], { confirmedOutcomeEvidenceTokens: [],
      gatePosture: { kind: 'unavailable', replayGateAvailable, refusals: ['missing floor'] },
    })).toEqual({ verdict: 'hold', reason: 'posture-unavailable' })
  })

  it('holds unprovenanced-candidate or empty-gate-set only with a bound gate, before sovereign', () => {
    for (const [overrides, reason] of [
      [{ gateSetVerdict: 'unprovenanced-candidate', gateSetNonEmpty: false }, 'unprovenanced-candidate'],
      [{ gateSetNonEmpty: false }, 'empty-gate-set'],
    ] as const) {
      expect(gated([receipt(3, 'pass')], { gatePosture: resolvedPosture(overrides) }))
        .toEqual({ verdict: 'hold', reason })
      expect(gated([], { gatePosture: resolvedPosture({ ...overrides, replayGateAvailable: false }) }))
        .toEqual(evaluatePromotionGate(factInput()))
    }
  })

  it('preserves kind, status and window precedence over receipt and posture checks', () => {
    for (const [override, reason] of [
      [{ kind: 'procedure' }, 'kind-excluded'], [{ kind: 'policy' }, 'kind-excluded'],
      [{ status: 'active' }, 'not-candidate'], [{ validityOpen: false }, 'window-closed'],
    ] as const) {
      expect(gated([receipt(1, 'pass'), receipt(3, 'pass')], override))
        .toEqual({ verdict: 'hold', reason })
      expect(gated([receipt(3, 'pass')], { ...override,
        gatePosture: { kind: 'unavailable', replayGateAvailable: true, refusals: ['broken'] },
      })).toEqual({ verdict: 'hold', reason })
    }
  })

  it('retains the v51 evidence checks before Gate-1 and Gate-2 receipt holds', () => {
    expect(gated([], { confirmedOutcomeEvidenceTokens: [] }))
      .toEqual({ verdict: 'hold', reason: 'no-confirmed-evidence' })
    expect(gated([receipt(1, 'pass'), receipt(2, 'pass')], { distilledObservations: [] }))
      .toEqual({ verdict: 'hold', reason: 'no-element-observation' })
  })
})

describe('418 D-17 — gate-inconsistent precedes the v51 evidence holds and every per-gate answer', () => {
  const contradiction = () => [receipt(1, 'pass'), receipt(2, 'fail', 6)]
  const neverConfirmed = (gateReceipts: readonly GateReceipt[],
    overrides: Partial<PromotionGateInput> = {}) => factInput({
    confirmedOutcomeEvidenceTokens: [], gatePosture: resolvedPosture(), gateReceipts, ...overrides,
  })
  const inconsistent = { verdict: 'hold', reason: 'gate-inconsistent' }

  it('holds gate-inconsistent for a never-confirmed candidate with same-digest pass and fail', () => {
    expect(evaluatePromotionGate(neverConfirmed(contradiction()))).toEqual(inconsistent)
  })
  it('holds on confirmed, withheld, missing-element and absent-posture inputs', () => {
    for (const overrides of [
      {}, { withheld: true }, { distilledObservations: [] }, { gatePosture: undefined },
    ]) {
      expect(evaluatePromotionGate(factInput({
        gatePosture: resolvedPosture(), gateReceipts: contradiction(), ...overrides,
      }))).toEqual(inconsistent)
    }
  })
  it('keeps not-candidate above contradiction on an active never-confirmed input', () => {
    expect(evaluatePromotionGate(neverConfirmed(contradiction(), { status: 'active' })))
      .toEqual({ verdict: 'hold', reason: 'not-candidate' })
  })
  it('keeps sovereign above contradictory receipts and a pending proposal on never-confirmed input', () => {
    const g3 = receipt(3, 'pass')
    expect(evaluatePromotionGate(neverConfirmed([...contradiction(), g3], {
      gatePosture: resolvedPosture({ canary: { kind: 'provided', rarePathEligible: false,
        inconsistency: { pending: true, proposalId: 'pending-inconsistency' } } }),
    }))).toEqual({ verdict: 'promote', promotionPath: 'user-sovereign',
      citedReceiptDigests: [g3.receiptDigest] })
  })
  it('retains no-confirmed-evidence for a never-confirmed input with a lone Gate-1 failure', () => {
    expect(evaluatePromotionGate(neverConfirmed([receipt(1, 'fail')])))
      .toEqual({ verdict: 'hold', reason: 'no-confirmed-evidence' })
  })
  it('holds shape 2 on never-confirmed input only when Gate-1 harmed a held-out row', () => {
    const g1 = receipt(1, 'fail')
    if (g1.gate !== 1) throw new Error('Expected Gate-1 fixture')
    const { receiptDigest: _digest, ...body } = g1
    const harmed = stampReceiptDigest({ ...body, harmed: [{ cassetteId: 'heldout-cassette',
      decisionOrdinal: 0, origin: 'gate-set' as const, verdictPresent: true,
      split: 'held-out', axes: ['headline' as const] }] })
    const g2 = receipt(2, 'pass', 6)
    expect(evaluatePromotionGate(neverConfirmed([harmed, g2]))).toEqual(inconsistent)
    expect(detectGateInconsistency([harmed, g2])).toEqual({
      shape: 'gate2-pass-gate1-heldout-fail', gate1Digest: harmed.receiptDigest,
      gate2Digest: g2.receiptDigest,
    })
    const noPositive = stampReceiptDigest({ ...body, reasons: ['no-positive-value' as const] })
    expect(evaluatePromotionGate(neverConfirmed([noPositive, g2])))
      .toEqual({ verdict: 'hold', reason: 'no-confirmed-evidence' })
    expect(evaluatePromotionGate(factInput({ gatePosture: resolvedPosture(),
      gateReceipts: [noPositive, g2] }))).toEqual({ verdict: 'hold', reason: 'gate-failed' })
    const naturalHarm = stampReceiptDigest({ ...body,
      harmed: harmed.harmed.map(row => ({ ...row, split: 'natural' })) })
    expect(detectGateInconsistency([naturalHarm, g2])).toBeUndefined()
  })
  it('does not call different digests inconsistent on never-confirmed or confirmed input', () => {
    const gateReceipts = [receipt(1, 'pass'),
      receipt(2, 'fail', 6, { corpusDigest: 'd'.repeat(64) })]
    expect(evaluatePromotionGate(neverConfirmed(gateReceipts)))
      .toEqual({ verdict: 'hold', reason: 'no-confirmed-evidence' })
    expect(evaluatePromotionGate(factInput({ gatePosture: resolvedPosture(), gateReceipts })))
      .toEqual({ verdict: 'hold', reason: 'gate-failed' })
  })
  it('holds a never-confirmed candidate when both cite an old digest, before staleness', () => {
    const corpusDigest = 'd'.repeat(64)
    expect(evaluatePromotionGate(neverConfirmed([
      receipt(1, 'pass', 5, { corpusDigest }), receipt(2, 'fail', 6, { corpusDigest }),
    ]))).toEqual(inconsistent)
  })
  it('holds a pending proposal on never-confirmed input even with clean ordered pass receipts', () => {
    expect(evaluatePromotionGate(neverConfirmed([receipt(1, 'pass'), receipt(2, 'pass', 6)], {
      gatePosture: resolvedPosture({ canary: { kind: 'provided', rarePathEligible: false,
        inconsistency: { pending: true, proposalId: 'pending-inconsistency' } } }),
    }))).toEqual(inconsistent)
  })
  it('still promotes ordered pass plus pass on confirmed input with both cited digests', () => {
    const g1 = receipt(1, 'pass')
    const g2 = receipt(2, 'pass', 6)
    expect(evaluatePromotionGate(factInput({ gatePosture: resolvedPosture(), gateReceipts: [g1, g2] })))
      .toEqual({ verdict: 'promote', promotionPath: 'gate1+gate2',
        citedReceiptDigests: [g1.receiptDigest, g2.receiptDigest] })
  })
  it('folds latest ordinal and later ties before detecting a contradiction and cites standing digests', () => {
    const g1 = receipt(1, 'pass')
    const fail = receipt(2, 'fail', 6)
    const pass = receipt(2, 'pass', 6)
    expect(detectGateInconsistency([g1, fail])).toEqual({ shape: 'gate1-pass-gate2-fail',
      gate1Digest: g1.receiptDigest, gate2Digest: fail.receiptDigest })
    expect(detectGateInconsistency([g1, fail, pass])).toBeUndefined()
    expect(detectGateInconsistency([g1, pass, fail])).toEqual({ shape: 'gate1-pass-gate2-fail',
      gate1Digest: g1.receiptDigest, gate2Digest: fail.receiptDigest })
    expect(detectGateInconsistency([g1, receipt(2, 'pass', 7), fail])).toBeUndefined()
    expect(detectGateInconsistency([g1, receipt(2, 'abstain')])).toBeUndefined()
    expect(detectGateInconsistency([fail])).toBeUndefined()
  })
})

/**
 * 414 D-14. The gate learns ONE new fact about the world: whether a replay gate exists on this
 * host and, if it does, whether the candidate has a separable gate set left after provenance
 * exclusion (spec/v2/memory.md §12.4(d)). Absent posture means "no replay gate exists here" —
 * the v51 BYOM floor of §12.2 — and must stay byte-identical, which is why the byte-identity
 * cells below loop EVERY input shape the pre-414 cells in this file build rather than spot-check
 * the base builder.
 */
const emptyGateSetPosture = resolvedPosture({ gateSetNonEmpty: false })

const factVariants: ReadonlyArray<[name: string, override: Partial<PromotionGateInput>]> = [
  ['base promoting fact', {}],
  [
    'navigational fact behind a page primary',
    {
      subtype: 'navigational',
      anchors: [
        { t: 'page', route: '/confirmation' },
        submitAnchor,
        { t: 'platform', platform: 'web' },
      ],
    },
  ],
  ['no confirmed outcome evidence', { confirmedOutcomeEvidenceTokens: [] }],
  [
    'ambiguous multi-element evidence',
    {
      distilledObservations: [
        { element: { naturalKey: 'button:submit order:0' } },
        { element: { naturalKey: 'button:cancel order:1' } },
      ],
    },
  ],
  ['fallback authorship path', { originClass: 'agent-observed' }],
  ['fallback Add needing enrichment', { originClass: 'agent-observed', needsEnrichment: true }],
  ['excluded kind procedure', { kind: 'procedure' }],
  ['excluded kind policy', { kind: 'policy' }],
  ['excluded kind unknown', { kind: 'unknown' }],
  ['non-candidate status', { status: 'active' }],
  ['closed validity window', { validityOpen: false }],
  ['withheld provenance', { withheld: true }],
  ['needs-enrichment provenance', { needsEnrichment: true }],
  ['incomplete evidence', { evidenceIncomplete: true }],
  ['memory-off anchor group', { memoryOffForAnchorGroup: true }],
  ['user-deprecated lineage', { hasUserDeprecateInLineage: true }],
  ['no element observation', { distilledObservations: [] }],
]

const cautionVariants: ReadonlyArray<[name: string, override: Partial<PromotionGateInput>]> = [
  ['base promoting caution', {}],
  [
    'caution without a root-cause class',
    { distilledObservations: [{ error: { naturalKey: 'environment: checkout timed out' } }] },
  ],
]

describe('414 D-14 — gatePosture and the empty-gate-set hold (ROOT-09 SC4)', () => {
  it('holds a candidate whose gate set is empty after exclusion, for fact and caution', () => {
    expect(evaluatePromotionGate(factInput({ gatePosture: emptyGateSetPosture }))).toEqual({
      verdict: 'hold',
      reason: 'empty-gate-set',
    })
    expect(evaluatePromotionGate(cautionInput({ gatePosture: emptyGateSetPosture }))).toEqual({
      verdict: 'hold',
      reason: 'empty-gate-set',
    })
  })

  it.each(factVariants)(
    'reads absent, undefined and no-replay-gate posture identically for %s (BYOM floor)',
    (_name, override) => {
      const postureless = evaluatePromotionGate(factInput(override))
      expect(evaluatePromotionGate(factInput({ ...override, gatePosture: undefined }))).toEqual(
        postureless,
      )
      expect(
        evaluatePromotionGate(
          factInput({
            ...override,
            gatePosture: resolvedPosture({ replayGateAvailable: false, gateSetNonEmpty: false }),
          }),
        ),
      ).toEqual(postureless)
      expect(evaluatePromotionGate(factInput({ ...override, gateReceipts: [] })))
        .toEqual(postureless)
      expect(evaluatePromotionGate(factInput({ ...override, gateReceipts: [],
        gatePosture: resolvedPosture({ replayGateAvailable: false }),
      }))).toEqual(postureless)
    },
  )

  it.each(cautionVariants)(
    'reads absent, undefined and no-replay-gate posture identically for %s (BYOM floor)',
    (_name, override) => {
      const postureless = evaluatePromotionGate(cautionInput(override))
      expect(evaluatePromotionGate(cautionInput({ ...override, gatePosture: undefined }))).toEqual(
        postureless,
      )
      expect(
        evaluatePromotionGate(
          cautionInput({
            ...override,
            gatePosture: resolvedPosture({ replayGateAvailable: false, gateSetNonEmpty: false }),
          }),
        ),
      ).toEqual(postureless)
      expect(evaluatePromotionGate(cautionInput({ ...override, gateReceipts: [] })))
        .toEqual(postureless)
      expect(evaluatePromotionGate(cautionInput({ ...override, gateReceipts: [],
        gatePosture: resolvedPosture({ replayGateAvailable: false }),
      }))).toEqual(postureless)
    },
  )

  it.each(factVariants)(
    'leaves the floor verdict for %s unchanged when judge and canary are disclosed',
    (_name, override) => {
      const postureless = evaluatePromotionGate(factInput(override))
      expect(
        evaluatePromotionGate(
          factInput({
            ...override,
            gatePosture: resolvedPosture({ replayGateAvailable: false,
              judge: { capable: true, reason: 'eligible', judgeFamily: 'other' },
              canary: { kind: 'provided', attributedRows: 100, rarePathEligible: false },
            }),
          }),
        ),
      ).toEqual(postureless)
      expect(
        evaluatePromotionGate(
          factInput({
            ...override,
            gatePosture: resolvedPosture({ replayGateAvailable: false }),
          }),
        ),
      ).toEqual(postureless)
    },
  )

  it('holds on both bound-gate posture cells and preserves the two floor cells (adjacency)', () => {
    const postureless = evaluatePromotionGate(factInput())
    const cells = [
      resolvedPosture({ replayGateAvailable: false, gateSetNonEmpty: true }),
      resolvedPosture({ replayGateAvailable: false, gateSetNonEmpty: false }),
    ]

    for (const gatePosture of cells) {
      expect(evaluatePromotionGate(factInput({ gatePosture }))).toEqual(postureless)
    }

    expect(evaluatePromotionGate(factInput({ gatePosture: emptyGateSetPosture }))).not.toEqual(
      postureless,
    )
    expect(evaluatePromotionGate(factInput({ gatePosture: resolvedPosture() })))
      .toEqual({ verdict: 'hold', reason: 'gate1-receipt-required' })
  })

  it('checks the empty gate set after window-closed and before withheld (ordering)', () => {
    expect(
      evaluatePromotionGate(factInput({ status: 'active', gatePosture: emptyGateSetPosture })),
    ).toEqual({ verdict: 'hold', reason: 'not-candidate' })

    expect(
      evaluatePromotionGate(factInput({ validityOpen: false, gatePosture: emptyGateSetPosture })),
    ).toEqual({ verdict: 'hold', reason: 'window-closed' })

    expect(
      evaluatePromotionGate(factInput({ withheld: true, gatePosture: emptyGateSetPosture })),
    ).toEqual({ verdict: 'hold', reason: 'empty-gate-set' })
  })
})

describe('419 D-04 sovereign confirmation with harmful canary evidence', () => {
  const g3 = stampReceiptDigest({
    schemaVersion: 1, gate: 3, candidateId: 'candidate', verdict: 'pass',
    producedAtOrdinal: 7, producedBy: { opId: 'knowledge.proposal.apply' },
    runId: 'r_x', stepId: '0:2', mark: 'false-fail',
  })
  const input = () => factInput({
    confirmedOutcomeEvidenceTokens: [],
    gateReceipts: [receipt(1, 'pass'), receipt(2, 'fail', 6), g3],
    gatePosture: resolvedPosture({
      canary: { kind: 'provided', attributedRows: 1, rarePathEligible: false,
        inconsistency: { pending: true, proposalId: 'harmful-canary' } },
    }),
  })

  it('promotes a mark-produced Gate-3 pass user-sovereign despite harmful canary evidence', () => {
    expect(evaluatePromotionGate(input())).toEqual({
      verdict: 'promote', promotionPath: 'user-sovereign',
      citedReceiptDigests: [g3.receiptDigest],
    })
    expect(evaluatePromotionGate({ ...input(), gateReceipts: [receipt(1, 'pass'), receipt(2, 'fail', 6)] }))
      .toEqual({ verdict: 'hold', reason: 'gate-inconsistent' })
  })

  it('keeps procedure kind-excluded ahead of the sovereign short-circuit (419 OQ3)', () => {
    expect(evaluatePromotionGate({ ...input(), kind: 'procedure' }))
      .toEqual({ verdict: 'hold', reason: 'kind-excluded' })
  })
})
