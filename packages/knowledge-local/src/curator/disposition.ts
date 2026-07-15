import {
  canonicalJson,
  normalizeAnchor,
  supersessionKey as schemaSupersessionKey,
  type Anchor,
  type BundleStatus,
  type Delta,
  type RecordId,
  type ScopeKey,
} from '@vostride/agent-qa-schema'

import { deriveBundleTrust, loadBundle, type LoadedBundle } from '../bundle-read.js'
import { enumerateBundleDirs } from '../bundle-scan.js'
import type { AuthoredCheckpoint, DispositionProfile } from './author-contract.js'

/** Provisional §7.3.1 cap. Phase 379 may retune it only through an explicit constant edit. */
export const BLAST_RADIUS_MAX_SUPERSEDES_PER_ANCHOR_PER_DRAIN = 1

export interface DispositionCandidateContext {
  anchors: readonly Anchor[]
  scope: ScopeKey
  buildOrdinal: number
}

export interface RelationIntent {
  type: 'proposed-supersession-of' | 'renamed-from'
  targetId: RecordId
}

export interface DispositionDrainState {
  supersedesSeenByAnchorKey: Map<string, number>
}

export interface DisposeDeltaInput {
  delta: Delta
  checkpoint: AuthoredCheckpoint
  profile: DispositionProfile
  knowledgeRoot: string
  /**
   * Verified queue evidence needed for anchor and new-ordinal checks. Optional only for the
   * non-mutating delta shapes; Add and Supersede fail closed when it is absent.
   */
  candidate?: DispositionCandidateContext
  drainState: DispositionDrainState
}

export type DispositionOutcome =
  | { kind: 'apply'; delta: Delta; relationIntents?: RelationIntent[] }
  | {
      kind: 'downgraded'
      delta: Delta
      reason: string
      original: Delta
      relationIntents?: RelationIntent[]
    }
  | { kind: 'requeue-resynthesis'; reason: string }
  | { kind: 'noop'; reason: string }

interface BundleTruth {
  bundle: LoadedBundle
  status: BundleStatus
  openedAtOrdinal: number
  currentOrdinal: number
}

type TruthLookup = (id: RecordId) => BundleTruth | undefined

type CheckFailure =
  | { kind: 'downgrade'; reason: string; fallback?: 'drift-unknown' }
  | { kind: 'requeue'; reason: string }

type CheckVerdict = { kind: 'pass' } | CheckFailure

interface EvaluationState {
  renameBridge?: RelationIntent
  blastRadiusAnchorKey?: string
}

const PASS: CheckVerdict = { kind: 'pass' }

function sameScope(left: ScopeKey, right: ScopeKey): boolean {
  return left.tier === right.tier && left.key === right.key
}

function sameAnchor(left: Anchor, right: Anchor): boolean {
  return canonicalJson(normalizeAnchor(left)) === canonicalJson(normalizeAnchor(right))
}

function primaryAnchor(anchors: readonly Anchor[]): Anchor | undefined {
  return anchors[0]
}

function deltaTargetIds(delta: Delta): RecordId[] {
  const ids = new Set<RecordId>(delta.citedIds)
  switch (delta.kind) {
    case 'Confirm':
    case 'Deprecate':
      ids.add(delta.targetId)
      break
    case 'Supersede':
      ids.add(delta.victimId)
      break
    case 'MintUnknown':
      for (const id of delta.conflict.recordIds) ids.add(id)
      break
    case 'Add':
    case 'Noop':
      break
  }
  return [...ids]
}

function truthLookup(knowledgeRoot: string): TruthLookup {
  const cache = new Map<RecordId, BundleTruth | undefined>()
  return (id) => {
    if (cache.has(id)) return cache.get(id)

    for (const entry of enumerateBundleDirs(knowledgeRoot)) {
      const loaded = loadBundle(entry.dir)
      if (loaded.kind !== 'loaded' || loaded.bundle.manifest.id !== id) continue
      const trust = deriveBundleTrust(loaded.bundle)
      const truth: BundleTruth = {
        bundle: loaded.bundle,
        status: trust.status,
        openedAtOrdinal: trust.validity.openedAtOrdinal,
        currentOrdinal:
          trust.validity.closedAtOrdinal ?? trust.validity.openedAtOrdinal,
      }
      cache.set(id, truth)
      return truth
    }

    cache.set(id, undefined)
    return undefined
  }
}

function checkCitedIdIntegrity(
  input: DisposeDeltaInput,
  lookup: TruthLookup,
): CheckVerdict {
  const persistedNeighbors = new Set<RecordId>(input.checkpoint.neighborIds)
  for (const id of deltaTargetIds(input.delta)) {
    if (!persistedNeighbors.has(id)) {
      return { kind: 'downgrade', reason: 'cited-id-integrity' }
    }
    const truth = lookup(id)
    if (
      truth === undefined
      || truth.status === 'deprecated'
      || !sameScope(truth.bundle.frontmatter.scope, input.delta.scope)
    ) {
      return { kind: 'downgrade', reason: 'cited-id-integrity' }
    }
  }
  return PASS
}

function hasSharedAnchor(
  left: readonly Anchor[],
  right: readonly Anchor[],
  type: Anchor['t'],
): boolean {
  return left
    .filter((anchor) => anchor.t === type)
    .some((anchor) =>
      right.some((candidate) => candidate.t === type && sameAnchor(anchor, candidate)),
    )
}

function renameBridge(
  newAnchors: readonly Anchor[],
  victimAnchors: readonly Anchor[],
  victimId: RecordId,
): RelationIntent | undefined {
  const next = primaryAnchor(newAnchors)
  const previous = primaryAnchor(victimAnchors)
  if (next?.t !== 'el' || previous?.t !== 'el') return undefined
  const normalizedNext = normalizeAnchor(next)
  const normalizedPrevious = normalizeAnchor(previous)
  if (normalizedNext.t !== 'el' || normalizedPrevious.t !== 'el') return undefined
  if (
    normalizedNext.role !== normalizedPrevious.role
    || normalizedNext.name === normalizedPrevious.name
  ) {
    return undefined
  }
  if (
    !hasSharedAnchor(newAnchors, victimAnchors, 'page')
    || !hasSharedAnchor(newAnchors, victimAnchors, 'selector')
  ) {
    return undefined
  }
  return { type: 'renamed-from', targetId: victimId }
}

function candidateMatchesBundle(
  input: DisposeDeltaInput,
  anchors: readonly Anchor[],
  scope: ScopeKey,
): boolean {
  if (!sameScope(scope, input.delta.scope)) return false
  if (input.candidate === undefined) return false
  const claimedPrimary = primaryAnchor(anchors)
  const verifiedPrimary = primaryAnchor(input.candidate.anchors)
  return (
    claimedPrimary !== undefined
    && verifiedPrimary !== undefined
    && sameAnchor(claimedPrimary, verifiedPrimary)
  )
}

function checkAnchorConsistency(
  input: DisposeDeltaInput,
  lookup: TruthLookup,
  state: EvaluationState,
): CheckVerdict {
  if (input.delta.kind === 'Add') {
    return candidateMatchesBundle(input, input.delta.bundle.anchors, input.delta.bundle.scope)
      ? PASS
      : { kind: 'downgrade', reason: 'anchor-consistency' }
  }
  if (input.delta.kind !== 'Supersede') return PASS
  if (
    !candidateMatchesBundle(
      input,
      input.delta.newBundle.anchors,
      input.delta.newBundle.scope,
    )
  ) {
    return { kind: 'downgrade', reason: 'anchor-consistency' }
  }

  const victim = lookup(input.delta.victimId)
  if (victim === undefined) {
    return { kind: 'downgrade', reason: 'anchor-consistency' }
  }
  const victimAnchors = victim.bundle.frontmatter.anchors.map(({ normalized }) => normalized)
  const nextPrimary = primaryAnchor(input.delta.newBundle.anchors)
  const previousPrimary = primaryAnchor(victimAnchors)
  if (nextPrimary === undefined || previousPrimary === undefined) {
    return { kind: 'downgrade', reason: 'anchor-consistency' }
  }
  if (sameAnchor(nextPrimary, previousPrimary)) return PASS

  const bridge = renameBridge(
    input.delta.newBundle.anchors,
    victimAnchors,
    input.delta.victimId,
  )
  if (bridge === undefined) {
    return { kind: 'downgrade', reason: 'anchor-consistency' }
  }
  state.renameBridge = bridge
  return PASS
}

function checkSupersessionKey(
  input: DisposeDeltaInput,
  lookup: TruthLookup,
  state: EvaluationState,
): CheckVerdict {
  if (input.delta.kind !== 'Supersede') return PASS
  const victim = lookup(input.delta.victimId)
  if (victim === undefined || input.candidate === undefined) {
    return { kind: 'downgrade', reason: 'supersession-key' }
  }

  const victimAnchors = victim.bundle.frontmatter.anchors.map(({ normalized }) => normalized)
  if (
    state.renameBridge === undefined
    && schemaSupersessionKey(input.delta.newBundle.anchors)
      !== schemaSupersessionKey(victimAnchors)
  ) {
    return { kind: 'downgrade', reason: 'supersession-key' }
  }
  if (input.candidate.buildOrdinal <= victim.openedAtOrdinal) {
    return { kind: 'downgrade', reason: 'supersession-key' }
  }
  return PASS
}

function checkAutonomousDeprecate(
  input: DisposeDeltaInput,
  lookup: TruthLookup,
): CheckVerdict {
  if (input.delta.kind !== 'Deprecate' || input.delta.origin !== 'agent') return PASS
  return lookup(input.delta.targetId)?.status === 'active'
    ? { kind: 'downgrade', reason: 'autonomous-deprecate' }
    : PASS
}

function checkCompareAndSet(
  input: DisposeDeltaInput,
  lookup: TruthLookup,
): CheckVerdict {
  for (const precondition of input.checkpoint.preconditions) {
    const current = lookup(precondition.recordId)
    if (
      current === undefined
      || current.status !== precondition.observedStatus
      || current.currentOrdinal !== precondition.observedOrdinal
    ) {
      return { kind: 'requeue', reason: 'compare-and-set' }
    }
  }
  return PASS
}

function checkBlastRadius(
  input: DisposeDeltaInput,
  state: EvaluationState,
): CheckVerdict {
  if (input.delta.kind !== 'Supersede') return PASS
  const candidateScope = input.candidate?.scope ?? input.delta.newBundle.scope
  if (!sameScope(candidateScope, input.delta.scope)) {
    return { kind: 'downgrade', reason: 'blast-radius-scope' }
  }
  if (input.profile.mode === 'propose-only') return PASS

  const anchorKey = schemaSupersessionKey(
    input.candidate?.anchors ?? input.delta.newBundle.anchors,
  )
  const seen = input.drainState.supersedesSeenByAnchorKey.get(anchorKey) ?? 0
  if (seen >= BLAST_RADIUS_MAX_SUPERSEDES_PER_ANCHOR_PER_DRAIN) {
    return {
      kind: 'downgrade',
      reason: 'blast-radius-cap',
      fallback: 'drift-unknown',
    }
  }
  state.blastRadiusAnchorKey = anchorKey
  return PASS
}

function envelope(delta: Delta): Pick<Delta, 'origin' | 'scope' | 'citedIds'> & {
  precondition?: Delta['precondition']
  authorship?: Delta['authorship']
} {
  return {
    origin: delta.origin,
    scope: delta.scope,
    citedIds: [...delta.citedIds],
    ...(delta.precondition === undefined ? {} : { precondition: [...delta.precondition] }),
    ...(delta.authorship === undefined ? {} : { authorship: delta.authorship }),
  }
}

function addCandidate(delta: Extract<Delta, { kind: 'Supersede' }>): Delta {
  return {
    kind: 'Add',
    ...envelope(delta),
    bundle: delta.newBundle,
  }
}

function mintUnknown(
  delta: Delta,
  reason: string,
  conflictKind: 'contradiction' | 'drift' | 'clarification',
): Delta {
  return {
    kind: 'MintUnknown',
    ...envelope(delta),
    citedIds: reason === 'cited-id-integrity' ? [] : [...delta.citedIds],
    conflict: {
      recordIds: reason === 'cited-id-integrity' ? [] : deltaTargetIds(delta),
      kind: conflictKind,
    },
  }
}

function downgraded(
  delta: Delta,
  failure: Extract<CheckFailure, { kind: 'downgrade' }>,
): DispositionOutcome {
  const fallback =
    failure.fallback === 'drift-unknown'
      ? mintUnknown(delta, failure.reason, 'drift')
      : delta.kind === 'Supersede'
        ? addCandidate(delta)
        : mintUnknown(delta, failure.reason, 'clarification')
  return {
    kind: 'downgraded',
    delta: fallback,
    reason: failure.reason,
    original: delta,
  }
}

/**
 * Run memory.md §7.3.1's six checks in order. The function is deliberately synchronous: every
 * decision is made from the persisted checkpoint and canonical bundle tree, never an index row.
 */
export function disposeDelta(input: DisposeDeltaInput): DispositionOutcome {
  const lookup = truthLookup(input.knowledgeRoot)
  const state: EvaluationState = {}
  const checks = [
    () => checkCitedIdIntegrity(input, lookup),
    () => checkAnchorConsistency(input, lookup, state),
    () => checkSupersessionKey(input, lookup, state),
    () => checkAutonomousDeprecate(input, lookup),
    () => checkCompareAndSet(input, lookup),
    () => checkBlastRadius(input, state),
  ]

  for (const check of checks) {
    const verdict = check()
    if (verdict.kind === 'requeue') {
      return { kind: 'requeue-resynthesis', reason: verdict.reason }
    }
    if (verdict.kind === 'downgrade') return downgraded(input.delta, verdict)
  }

  if (input.delta.kind === 'Noop') return { kind: 'noop', reason: 'delta-noop' }
  if (
    input.profile.mode === 'propose-only'
    && (input.delta.kind === 'Supersede' || input.delta.kind === 'Deprecate')
  ) {
    const fallback = input.delta.kind === 'Supersede'
      ? addCandidate(input.delta)
      : mintUnknown(input.delta, 'propose-only', 'clarification')
    return {
      kind: 'downgraded',
      delta: fallback,
      reason: 'propose-only',
      original: input.delta,
      ...(input.delta.kind === 'Supersede'
        ? {
            relationIntents: [
              {
                type: 'proposed-supersession-of' as const,
                targetId: input.delta.victimId,
              },
            ],
          }
        : {}),
    }
  }

  if (state.blastRadiusAnchorKey !== undefined) {
    const seen = input.drainState.supersedesSeenByAnchorKey.get(state.blastRadiusAnchorKey) ?? 0
    input.drainState.supersedesSeenByAnchorKey.set(state.blastRadiusAnchorKey, seen + 1)
  }
  return {
    kind: 'apply',
    delta: input.delta,
    ...(state.renameBridge === undefined ? {} : { relationIntents: [state.renameBridge] }),
  }
}
