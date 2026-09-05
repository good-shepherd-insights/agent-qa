/**
 * 414 D-15/D-16 gate posture (ROOT-10 SC5) — what could gate at one scope, and
 * with what capability.
 *
 * Composition law, mirroring `derive-census.ts`: this file is a PURE FOLD over
 * already-loaded legs. `eval-local` (Plan 05) owns every read of the committed
 * root and hands the snapshot and the manifests in; the cli composes the verb
 * and renders. Nothing here touches a host API or a clock.
 *
 * The canary summary is DATA the caller supplies. Eval NEVER imports
 * knowledge-local — the reader carve-out walls it off for replay hermeticity —
 * so 416/418's bridge folds its attribution result down to the two-arm summary
 * below and passes it. The `not-provided` arm exists so "no canary evidence"
 * is an ANSWER rather than an absent field a reader mistakes for zero.
 *
 * D-16: `resolveProductPartition` is reused UNCHANGED as the one spelling of
 * "which partition". A `ScopeKey` carries no product reference and eval holds
 * no test-to-product registry, so a test- or suite-tier key has nothing to map
 * through: it resolves to the typed `default` partition and the posture SAYS
 * SO via `scope.resolution`. There is deliberately no `productHint` input —
 * that would be a second spelling of the mapping and a side door around the
 * resolver. Callers that know the product (the seed verb, 416's bridge) pass a
 * product-tier key.
 *
 * T-414-15: the manifest is echoed as a salt DIGEST, never the salt. A posture
 * travels into reports and receipts, and a public salt lets a proposer compute
 * the held-out set for itself.
 *
 * D-12: `minimumGateSet` is a REQUIRED input here too. `gateSetNonEmpty`
 * reports AVAILABILITY — how the partition stands before any candidate's
 * exclusion is applied. The gate-time answer for one candidate comes from
 * `selectGateSet`, which subtracts that candidate's own contributors first.
 */
import { sha256hex } from '@vostride/agent-qa-schema'
import type { ScopeKey } from '@vostride/agent-qa-schema'

import { computeCorpusDigest } from '../census/corpus-digest'
import type { CommittedCorpusSnapshot } from '../census/derive-census'
import { assessJudgeEligibility } from '../judge/adjudicate'
import type { JudgeFamily } from '../judge/family'
import { resolveProductPartition } from '../labels/corpus-entry'
import type { PartitionManifest } from '../labels/partition-manifest'
import { countGateSet } from './gate-set'
import type { GateSetCounts } from './gate-set'

/** The model ids the posture folds; no port, no call, just identity. */
export interface JudgeCapabilityInput {
  /** The model whose output would be judged. */
  plannerModelId: string
  /** Absent means no judge is configured — an answer, not an error. */
  judgeModelId?: string
  /** Explicit default-off opt-in; disclosed on the posture either way. */
  allowSameFamily?: boolean
}

/**
 * The judge half of the posture. `reason` carries the exact literals
 * `assessJudgeEligibility` returns, plus `eligible` for the capable arm, so a
 * reader never has to map one vocabulary onto another.
 */
export interface JudgeCapability {
  capable: boolean
  reason: 'eligible' | 'no-judge-configured' | 'no-eligible-judge'
  /** ALWAYS present: the same-family opt-in is never silent. */
  allowSameFamily: boolean
  /** Present on the capable arm. */
  judgeFamily?: JudgeFamily
  /** Present only when the opt-in actually lifted a refusal that would have fired. */
  familyOverride?: 'same-family-allowed'
  /** Present on the `no-eligible-judge` refusal, verbatim from the assessment. */
  families?: { judge?: string; replayed?: string; recorded?: string }
}

/**
 * The canary evidence the caller was given, folded to what the posture needs.
 * 416/418 fill it from `CanaryAttributionsResult`; eval only carries it.
 */
export type CanaryEvidenceSummary =
  | { kind: 'provided'; attributedRows: number; skippedBundles: number }
  | { kind: 'not-provided' }

/** The committed manifest as it may safely travel: a digest, never the salt. */
export type PartitionEcho =
  | {
      kind: 'present'
      partitionVersion: number
      saltDigest: string
      heldOutFraction: number
      privateFraction: number
    }
  | { kind: 'absent' }

/** HOW the requested scope became a partition name (D-16). */
export type ScopeResolution = 'product-key' | 'default-fallback'

export interface GatePosture {
  scope: {
    requested: ScopeKey
    partition: string
    resolution: ScopeResolution
  }
  /** Identity of the WHOLE loaded root, not of the partition (413 D-15). */
  corpusDigest: string
  partition: PartitionEcho
  /** Raw per-split integer counts for the resolved partition. */
  counts: GateSetCounts
  /** The floor this posture was judged against (D-12). */
  minimumGateSet: number
  /** Availability BEFORE any candidate's exclusion — not a gate-time verdict. */
  gateSetNonEmpty: boolean
  judge: JudgeCapability
  canary: CanaryEvidenceSummary
}

export interface ReadGatePostureInput {
  snapshot: CommittedCorpusSnapshot
  manifests: readonly PartitionManifest[]
  scope: ScopeKey
  /** REQUIRED integer floor, >= 1. No default exists anywhere (D-12). */
  minimumGateSet: number
  judge: JudgeCapabilityInput
  canary: CanaryEvidenceSummary
}

function totalOf(counts: GateSetCounts): number {
  return counts.natural + counts.heldOutShared + counts.heldOutPrivate + counts.adversarial
}

function echoOf(manifest: PartitionManifest | undefined): PartitionEcho {
  if (manifest === undefined) return { kind: 'absent' }
  return {
    kind: 'present',
    partitionVersion: manifest.partitionVersion,
    saltDigest: sha256hex(manifest.salt),
    heldOutFraction: manifest.heldOutFraction,
    privateFraction: manifest.privateFraction,
  }
}

function judgeCapabilityOf(input: JudgeCapabilityInput): JudgeCapability {
  const allowSameFamily = input.allowSameFamily === true
  const eligibility = assessJudgeEligibility({
    judgeModelId: input.judgeModelId,
    replayedModelId: input.plannerModelId,
    allowSameFamily,
  })

  if (eligibility.eligible) {
    return {
      capable: true,
      reason: 'eligible',
      allowSameFamily,
      judgeFamily: eligibility.judgeFamily,
      ...(eligibility.familyOverride === undefined
        ? {}
        : { familyOverride: eligibility.familyOverride }),
    }
  }

  if (eligibility.reason === 'no-judge-configured') {
    return { capable: false, reason: 'no-judge-configured', allowSameFamily }
  }

  return {
    capable: false,
    reason: 'no-eligible-judge',
    allowSameFamily,
    families: eligibility.families,
  }
}

/**
 * Fold the loaded legs into the posture for one scope.
 *
 * Throws `TypeError` when `minimumGateSet` is not a positive integer — by the
 * time a value reaches here it came from the caller's own configuration, so a
 * violation is a caller bug, not untrusted data.
 */
export function readGatePosture(input: ReadGatePostureInput): GatePosture {
  const { snapshot, manifests, scope, minimumGateSet, judge, canary } = input

  if (!Number.isInteger(minimumGateSet) || minimumGateSet < 1) {
    throw new TypeError(
      `minimumGateSet must be an integer of at least 1 (got ${String(minimumGateSet)})`,
    )
  }

  // The ONE resolver (D-16), reused unchanged.
  const partitionName = resolveProductPartition(scope)
  // `resolveProductPartition` passes every non-empty, non-'unknown'
  // product-tier key through untouched, so equality with the requested key is
  // exactly "the key named this partition". Everything else fell back.
  const resolution: ScopeResolution =
    scope.tier === 'product' && partitionName === scope.key ? 'product-key' : 'default-fallback'

  const counts = countGateSet(snapshot.entries.filter(entry => entry.product === partitionName))

  return {
    scope: { requested: scope, partition: partitionName, resolution },
    corpusDigest: computeCorpusDigest(snapshot.entries),
    partition: echoOf(manifests.find(manifest => manifest.product === partitionName)),
    counts,
    minimumGateSet,
    gateSetNonEmpty: totalOf(counts) >= minimumGateSet,
    judge: judgeCapabilityOf(judge),
    canary,
  }
}
