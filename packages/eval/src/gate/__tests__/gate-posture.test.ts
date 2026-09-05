// 414 Task 3 — `readGatePosture` (ROOT-10 SC5's posture half, D-15/D-16).
//
// The posture answers "what could gate here, and with what capability" for one
// scope: which partition the scope resolved to and HOW, how many entries sit
// in each split, whether that clears the caller's floor, whether a judge is
// eligible, and what canary evidence the caller was given.
//
// Two cells carry the load. Test 1 asserts the raw salt appears NOWHERE in the
// serialised posture — the manifest is echoed as a DIGEST, because a posture
// travels to a report and a public salt lets a proposer compute the held-out
// set. Test 2 documents D-16's explicit assumption: a test-tier ScopeKey
// carries no product reference, so it resolves to the typed `default`
// partition with `resolution: 'default-fallback'` DISCLOSED — there is no
// productHint side door and no second resolver.
import { sha256hex } from '@vostride/agent-qa-schema'
import type { ScopeKey } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { canonicalJson } from '../../canonical-json'
import { computeCorpusDigest } from '../../census/corpus-digest'
import type { CommittedCorpusSnapshot } from '../../census/derive-census'
import type { CorpusEntry, CorpusEntryBase } from '../../labels/corpus-entry'
import { projectPartitionManifest } from '../../labels/partition-manifest'
import type { PartitionManifest } from '../../labels/partition-manifest'
import { PARTITION_VERSION } from '../../labels/split-assignment'
import { countGateSet } from '../gate-set'
import { readGatePosture } from '../gate-posture'
import type { CanaryEvidenceSummary, ReadGatePostureInput } from '../gate-posture'

const PRODUCT = 'example-web'
const OTHER_PRODUCT = 'example-mobile'
const SALT = 'a3f'.repeat(21).concat('b')

// Two ids of DIFFERENT known families, plus one of the same family as the
// planner, chosen from JUDGE_FAMILY_MAP's tokens.
const PLANNER_MODEL = 'claude-sonnet-4'
const CROSS_FAMILY_JUDGE = 'gpt-5'
const SAME_FAMILY_JUDGE = 'claude-opus-4'

function base(cassetteId: string, overrides: Partial<CorpusEntryBase> = {}): CorpusEntryBase {
  return {
    schemaVersion: 2,
    cassetteId,
    product: PRODUCT,
    captured_at_ordinal: 100 + cassetteId.charCodeAt(cassetteId.length - 1),
    run_links: { runId: `run-${cassetteId}`, runSlug: `run-${cassetteId}` },
    receiptDigest: cassetteId.padEnd(64, '0'),
    ...overrides,
  }
}

function natural(cassetteId: string, overrides: Partial<CorpusEntryBase> = {}): CorpusEntry {
  return { ...base(cassetteId, overrides), split: 'natural' }
}

function heldOutPrivate(cassetteId: string, overrides: Partial<CorpusEntryBase> = {}): CorpusEntry {
  return { ...base(cassetteId, overrides), split: 'held-out', heldOutVisibility: 'private' }
}

function snapshotOf(entries: readonly CorpusEntry[]): CommittedCorpusSnapshot {
  return {
    entries,
    labelsById: new Map(),
    cassettesById: new Map(),
    blobPresentById: new Map(),
  }
}

function manifestFor(product: string): PartitionManifest {
  return projectPartitionManifest({
    product,
    saltHex: SALT,
    heldOutFraction: 0.2,
    privateFraction: 0.5,
  })
}

function postureInput(overrides: Partial<ReadGatePostureInput> = {}): ReadGatePostureInput {
  return {
    snapshot: snapshotOf([natural('c1'), heldOutPrivate('c2'), natural('c3')]),
    manifests: [manifestFor(PRODUCT)],
    scope: { tier: 'product', key: PRODUCT },
    minimumGateSet: 1,
    judge: { plannerModelId: PLANNER_MODEL },
    canary: { kind: 'not-provided' },
    ...overrides,
  }
}

describe('readGatePosture', () => {
  it('resolves a product-tier key to its own partition and echoes the manifest as a digest', () => {
    const entries = [
      natural('c1'),
      heldOutPrivate('c2'),
      natural('c3'),
      natural('c4', { product: OTHER_PRODUCT }),
    ]
    const snapshot = snapshotOf(entries)

    const posture = readGatePosture(
      postureInput({ snapshot, manifests: [manifestFor(PRODUCT), manifestFor(OTHER_PRODUCT)] }),
    )

    expect(posture.scope).toEqual({
      requested: { tier: 'product', key: PRODUCT },
      partition: PRODUCT,
      resolution: 'product-key',
    })

    // Counts are over THIS partition only — the other product's entry is not here.
    expect(posture.counts).toEqual(countGateSet(entries.filter(e => e.product === PRODUCT)))
    expect(posture.counts).toEqual({
      natural: 2,
      heldOutShared: 0,
      heldOutPrivate: 1,
      adversarial: 0,
    })

    // The corpus digest identifies the WHOLE loaded root, not the partition.
    expect(posture.corpusDigest).toBe(computeCorpusDigest(entries))

    expect(posture.partition).toEqual({
      kind: 'present',
      partitionVersion: PARTITION_VERSION,
      saltDigest: sha256hex(SALT),
      heldOutFraction: 0.2,
      privateFraction: 0.5,
    })

    // T-414-15: the raw salt never leaves the manifest.
    expect(JSON.stringify(posture)).not.toContain(SALT)
  })

  it('discloses a default-fallback resolution for any scope that names no product (D-16)', () => {
    // D-16 EXPLICIT ASSUMPTION: ScopeKey carries no product reference and eval
    // holds no test-to-product registry, so a test-tier key has nothing to map
    // THROUGH. It resolves to the typed `default` partition and SAYS SO.
    const testTier = readGatePosture(postureInput({ scope: { tier: 'test', key: 't_x' } }))
    expect(testTier.scope.partition).toBe('default')
    expect(testTier.scope.resolution).toBe('default-fallback')
    // No manifest for `default` exists in this input.
    expect(testTier.partition).toEqual({ kind: 'absent' })
    // No entry carries product 'default' either.
    expect(testTier.counts).toEqual({
      natural: 0,
      heldOutShared: 0,
      heldOutPrivate: 0,
      adversarial: 0,
    })

    const suiteTier = readGatePosture(
      postureInput({ scope: { tier: 'suite', key: 'checkout.spec.ts' } }),
    )
    expect(suiteTier.scope.partition).toBe('default')
    expect(suiteTier.scope.resolution).toBe('default-fallback')

    // A product literally NAMED `default` (the cli fixture's product) is a
    // product-key resolution: the fallback is a property of HOW the key
    // resolved, never of what the partition is called.
    const namedDefault = readGatePosture(
      postureInput({
        scope: { tier: 'product', key: 'default' },
        snapshot: snapshotOf([natural('c1', { product: 'default' })]),
        manifests: [manifestFor('default')],
      }),
    )
    expect(namedDefault.scope.partition).toBe('default')
    expect(namedDefault.scope.resolution).toBe('product-key')
    expect(namedDefault.partition.kind).toBe('present')

    // The only way to name a partition is a product-tier ScopeKey through the
    // ONE resolver: the input shape carries no productHint side door.
    const inputKeys = Object.keys(postureInput())
    expect(inputKeys).not.toContain('productHint')
    expect(inputKeys).not.toContain('product')
    expect(inputKeys.sort()).toEqual([
      'canary',
      'judge',
      'manifests',
      'minimumGateSet',
      'scope',
      'snapshot',
    ])
  })

  it('reports availability against the caller-supplied floor, which is required', () => {
    expect(readGatePosture(postureInput({ minimumGateSet: 1 })).gateSetNonEmpty).toBe(true)
    expect(readGatePosture(postureInput({ minimumGateSet: 3 })).gateSetNonEmpty).toBe(true)
    expect(readGatePosture(postureInput({ minimumGateSet: 4 })).gateSetNonEmpty).toBe(false)
    expect(readGatePosture(postureInput({ minimumGateSet: 4 })).minimumGateSet).toBe(4)

    expect(
      readGatePosture(postureInput({ snapshot: snapshotOf([]), minimumGateSet: 1 })).gateSetNonEmpty,
    ).toBe(false)

    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => readGatePosture(postureInput({ minimumGateSet: bad })), String(bad)).toThrow(
        TypeError,
      )
    }
  })

  it('folds the judge ids through assessJudgeEligibility and discloses the same-family opt-in', () => {
    const noJudge = readGatePosture(postureInput({ judge: { plannerModelId: PLANNER_MODEL } }))
    expect(noJudge.judge).toEqual({
      capable: false,
      reason: 'no-judge-configured',
      allowSameFamily: false,
    })

    const crossFamily = readGatePosture(
      postureInput({ judge: { plannerModelId: PLANNER_MODEL, judgeModelId: CROSS_FAMILY_JUDGE } }),
    )
    expect(crossFamily.judge.capable).toBe(true)
    expect(crossFamily.judge.reason).toBe('eligible')
    expect(crossFamily.judge.allowSameFamily).toBe(false)
    expect(crossFamily.judge.judgeFamily).toBe('openai')

    const sameFamily = readGatePosture(
      postureInput({ judge: { plannerModelId: PLANNER_MODEL, judgeModelId: SAME_FAMILY_JUDGE } }),
    )
    expect(sameFamily.judge.capable).toBe(false)
    expect(sameFamily.judge.reason).toBe('no-eligible-judge')
    expect(sameFamily.judge.families).toEqual({ judge: 'claude', replayed: 'claude' })

    const overridden = readGatePosture(
      postureInput({
        judge: {
          plannerModelId: PLANNER_MODEL,
          judgeModelId: SAME_FAMILY_JUDGE,
          allowSameFamily: true,
        },
      }),
    )
    expect(overridden.judge.capable).toBe(true)
    // Never silently allowed: the opt-in rides the posture in both fields.
    expect(overridden.judge.allowSameFamily).toBe(true)
    expect(overridden.judge.familyOverride).toBe('same-family-allowed')
  })

  it('carries the canary summary verbatim, including the not-provided arm', () => {
    const notProvided: CanaryEvidenceSummary = { kind: 'not-provided' }
    expect(readGatePosture(postureInput({ canary: notProvided })).canary).toEqual(notProvided)

    const provided: CanaryEvidenceSummary = {
      kind: 'provided',
      attributedRows: 3,
      skippedBundles: 1,
    }
    expect(readGatePosture(postureInput({ canary: provided })).canary).toEqual(provided)
  })

  it('is a pure fold: two calls over the same inputs serialise identically', () => {
    const input = postureInput({
      judge: { plannerModelId: PLANNER_MODEL, judgeModelId: CROSS_FAMILY_JUDGE },
      canary: { kind: 'provided', attributedRows: 3, skippedBundles: 1 },
    })
    expect(canonicalJson(readGatePosture(input))).toBe(canonicalJson(readGatePosture(input)))

    // And order of the manifests list cannot change the answer.
    const scopeKey: ScopeKey = { tier: 'product', key: PRODUCT }
    const manifests = [manifestFor(OTHER_PRODUCT), manifestFor(PRODUCT)]
    expect(
      canonicalJson(readGatePosture({ ...input, scope: scopeKey, manifests })),
    ).toBe(
      canonicalJson(
        readGatePosture({ ...input, scope: scopeKey, manifests: [...manifests].reverse() }),
      ),
    )
  })
})
