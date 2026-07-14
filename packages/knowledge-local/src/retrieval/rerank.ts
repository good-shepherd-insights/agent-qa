import { supersessionKey } from '@vostride/agent-qa-schema'
import type { Anchor, ScopeKey } from '@vostride/agent-qa-schema'

import { DIVERSITY_CAP_PER_ANCHOR } from './constants.js'

export type ValidityClass = 'current' | 'priorBuildHypothesis' | 'auditReadmitted'

export interface ConflictAnnotation {
  readonly peerRecordId: string
  readonly unknownRecordId: string
}

export interface RerankEntry {
  readonly bundleId: string
  readonly validityClass: ValidityClass
  readonly trust: number
  readonly scope: ScopeKey
  readonly recencyOrdinal: number
  readonly createdAtOrdinal: number
  readonly originClass: 'agent' | 'user'
  readonly anchors: readonly Anchor[]
  readonly conflict?: ConflictAnnotation
}

export interface MintUnknownConflict {
  readonly leftRecordId: string
  readonly rightRecordId: string
  readonly unknownRecordId: string
}

export interface CollapseByOrdinalOptions {
  readonly audit?: boolean
  readonly conflicts?: readonly MintUnknownConflict[]
}

const VALIDITY_ORDER: Readonly<Record<ValidityClass, number>> = {
  current: 0,
  priorBuildHypothesis: 1,
  auditReadmitted: 2,
}

const SCOPE_ORDER: Readonly<Record<ScopeKey['tier'], number>> = {
  test: 0,
  suite: 1,
  product: 2,
  global: 3,
}

function compareBundleIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function identityBearingAnchors(anchors: readonly Anchor[]): Anchor[] {
  return anchors.filter((anchor) => anchor.t !== 'platform')
}

/**
 * Sort by the precedence tuple from spec §5.5.6. Each axis is compared independently so a
 * lower-priority recency value can never overtake validity, trust, or scope specificity.
 */
export function rerankPrecedence<T extends RerankEntry>(entries: readonly T[]): T[] {
  return [...entries].sort(
    (left, right) =>
      VALIDITY_ORDER[left.validityClass] - VALIDITY_ORDER[right.validityClass] ||
      right.trust - left.trust ||
      SCOPE_ORDER[left.scope.tier] - SCOPE_ORDER[right.scope.tier] ||
      right.recencyOrdinal - left.recencyOrdinal ||
      compareBundleIds(left.bundleId, right.bundleId),
  )
}

function annotateConflicts<T extends RerankEntry>(
  entries: readonly T[],
  conflicts: readonly MintUnknownConflict[],
): T[] {
  const annotations = new Map<string, ConflictAnnotation>()

  for (const conflict of conflicts) {
    if (!annotations.has(conflict.leftRecordId)) {
      annotations.set(conflict.leftRecordId, {
        peerRecordId: conflict.rightRecordId,
        unknownRecordId: conflict.unknownRecordId,
      })
    }
    if (!annotations.has(conflict.rightRecordId)) {
      annotations.set(conflict.rightRecordId, {
        peerRecordId: conflict.leftRecordId,
        unknownRecordId: conflict.unknownRecordId,
      })
    }
  }

  return entries.map((entry) => {
    const conflict = entry.conflict ?? annotations.get(entry.bundleId)
    return conflict === undefined ? entry : ({ ...entry, conflict } as T)
  })
}

function collapseKey(entry: RerankEntry): string | undefined {
  if (entry.originClass === 'user' || entry.conflict !== undefined) return undefined

  const anchors = identityBearingAnchors(entry.anchors)
  if (anchors.length === 0) return undefined

  // Read-side mirror of spec §7.3.2; Phase 378's writer uses the same schema authority.
  return supersessionKey(anchors)
}

/**
 * Collapse agent-authored supersession groups onto their maximum creation ordinal (D-16).
 * Sovereign user entries and both annotated sides of a MintUnknown conflict always survive.
 */
export function collapseByOrdinal<T extends RerankEntry>(
  entries: readonly T[],
  options: CollapseByOrdinalOptions = {},
): T[] {
  const annotated = annotateConflicts(entries, options.conflicts ?? [])
  if (options.audit === true) return annotated

  const winners = new Map<string, T>()
  for (const entry of annotated) {
    const key = collapseKey(entry)
    if (key === undefined) continue

    const current = winners.get(key)
    if (
      current === undefined ||
      entry.createdAtOrdinal > current.createdAtOrdinal ||
      (entry.createdAtOrdinal === current.createdAtOrdinal &&
        compareBundleIds(entry.bundleId, current.bundleId) < 0)
    ) {
      winners.set(key, entry)
    }
  }

  return annotated.filter((entry) => {
    const key = collapseKey(entry)
    return key === undefined || winners.get(key) === entry
  })
}

function primaryDiversityKey(entry: RerankEntry): string | undefined {
  const primary = identityBearingAnchors(entry.anchors)[0]
  if (primary?.t !== 'el' && primary?.t !== 'flow') return undefined

  return supersessionKey([primary])
}

/** Keep at most the configured number of naturally-ranked results per primary el/flow anchor. */
export function applyDiversityCaps<T extends RerankEntry>(
  entries: readonly T[],
  audit = false,
): T[] {
  if (audit) return [...entries]

  const counts = new Map<string, number>()
  return entries.filter((entry) => {
    const key = primaryDiversityKey(entry)
    if (key === undefined) return true

    const count = counts.get(key) ?? 0
    if (count >= DIVERSITY_CAP_PER_ANCHOR) return false
    counts.set(key, count + 1)
    return true
  })
}
