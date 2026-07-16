import {
  canonicalJson,
  decideMeasurementDrift,
  foldMeasurements,
  normalizeAnchor,
  supersessionKey as schemaSupersessionKey,
  type Anchor,
  type BundleStatus,
  type Delta,
  type MeasurementObservation,
  type RecordId,
  type ScopeKey,
} from '@vostride/agent-qa-schema'

import {
  deriveBundleTrust,
  loadBundle,
  readMeasurements,
  type LoadedBundle,
} from '../bundle-read.js'
import { enumerateBundleDirs } from '../bundle-scan.js'
import type { AuthoredCheckpoint, DispositionProfile } from './author-contract.js'

/** Provisional §7.3.1 cap. Phase 379 may retune it only through an explicit constant edit. */
export const BLAST_RADIUS_MAX_SUPERSEDES_PER_ANCHOR_PER_DRAIN = 1

export interface DispositionCandidateContext {
  anchors: readonly Anchor[]
  scope: ScopeKey
  buildOrdinal: number
  /** Durable queue address used as the observation's idempotency identity. */
  curationJobId?: string
  /** Original measurement seed value; prose authored by a model is never parsed for authority. */
  measurementValue?: string
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
  | {
      kind: 'apply'
      delta: Delta
      relationIntents?: RelationIntent[]
      bornActive?: true
      measurementAppend?: { victimId: RecordId; observation: MeasurementObservation }
    }
  | {
      kind: 'downgraded'
      delta: Delta
      reason: string
      original: Delta
      relationIntents?: RelationIntent[]
      measurementAppend?: { victimId: RecordId; observation: MeasurementObservation }
    }
  | { kind: 'requeue-resynthesis'; reason: string }
  | { kind: 'noop'; reason: string }

interface BundleTruth {
  dir: string
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
        dir: entry.dir,
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

interface MeasurementDisposition {
  input: DisposeDeltaInput
  measurementAppend?: { victimId: RecordId; observation: MeasurementObservation }
  confirmedDriftSupersede: boolean
}

/**
 * RATIFICATION A6: non-numeric measurement values retain the existing inequality-supersede
 * semantics outside the drift tree. Otherwise string-valued measurements could never widen.
 */
function finiteMeasurementValue(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Mechanism #9: discipline measurement Confirm/Supersede deltas against canonical bundle truth
 * before the six existing checks compose their final verdict.
 */
function disposeMeasurementDrift(
  input: DisposeDeltaInput,
  lookup: TruthLookup,
): MeasurementDisposition {
  const delta = input.delta
  if (delta.kind !== 'Confirm' && delta.kind !== 'Supersede') {
    return { input, confirmedDriftSupersede: false }
  }
  const victimId = delta.kind === 'Confirm' ? delta.targetId : delta.victimId

  const victim = lookup(victimId)
  if (
    victim === undefined
    || victim.bundle.frontmatter.kind !== 'fact'
    || victim.bundle.frontmatter.subtype !== 'measurement'
  ) {
    return { input, confirmedDriftSupersede: false }
  }

  const value = finiteMeasurementValue(input.candidate?.measurementValue)
  if (value === undefined) {
    return { input, confirmedDriftSupersede: false }
  }
  if (input.candidate?.curationJobId === undefined) {
    throw new TypeError('numeric measurement disposition requires a durable curation job id')
  }

  const measurements = readMeasurements(victim.dir)
  if (measurements === undefined) {
    throw new TypeError('numeric measurement disposition requires a stored baseline')
  }
  const observation: MeasurementObservation = {
    value,
    buildOrdinal: input.candidate.buildOrdinal,
    evidenceToken: delta.evidenceToken,
    curationJobId: input.candidate.curationJobId,
  }
  const consumed = measurements.observations.find(
    (candidate) =>
      candidate.evidenceToken === observation.evidenceToken
      && candidate.curationJobId === observation.curationJobId,
  )
  if (consumed !== undefined && canonicalJson(consumed) !== canonicalJson(observation)) {
    throw new TypeError('measurement observation identity resolved to different canonical bytes')
  }
  const observations = consumed === undefined
    ? [...measurements.observations, observation]
    : measurements.observations
  const decision = decideMeasurementDrift({
    baseline: measurements.baseline,
    state: foldMeasurements(measurements.baseline, observations),
    windowBuilds: { observations },
  })

  if (delta.kind === 'Confirm') {
    // Confirm carries observation authority but no replacement draft. Keep accumulating canonical
    // evidence so a later measurement Supersede can realize a confirmed regime change.
    return {
      input,
      measurementAppend: { victimId, observation },
      confirmedDriftSupersede: false,
    }
  }

  if (decision.decision === 'supersede') {
    return { input, confirmedDriftSupersede: true }
  }

  // Pitfall 5: a widen emits no superseded event and therefore never feeds the thrash counter.
  const confirm: Delta = {
    kind: 'Confirm',
    ...envelope(delta),
    targetId: victimId,
    evidenceToken: delta.evidenceToken,
  }
  return {
    input: { ...input, delta: confirm },
    measurementAppend: { victimId, observation },
    confirmedDriftSupersede: false,
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
  const measurement = disposeMeasurementDrift(input, lookup)
  const dispositionInput = measurement.input
  const state: EvaluationState = {}
  const checks = [
    () => checkCitedIdIntegrity(dispositionInput, lookup),
    () => checkAnchorConsistency(dispositionInput, lookup, state),
    () => checkSupersessionKey(dispositionInput, lookup, state),
    () => checkAutonomousDeprecate(dispositionInput, lookup),
    () => checkCompareAndSet(dispositionInput, lookup),
    () => checkBlastRadius(dispositionInput, state),
  ]

  for (const check of checks) {
    const verdict = check()
    if (verdict.kind === 'requeue') {
      return { kind: 'requeue-resynthesis', reason: verdict.reason }
    }
    if (verdict.kind === 'downgrade') {
      return {
        ...downgraded(dispositionInput.delta, verdict),
        ...(measurement.measurementAppend === undefined
          ? {}
          : { measurementAppend: measurement.measurementAppend }),
      }
    }
  }

  if (dispositionInput.delta.kind === 'Noop') return { kind: 'noop', reason: 'delta-noop' }
  if (
    dispositionInput.profile.mode === 'propose-only'
    && (
      dispositionInput.delta.kind === 'Supersede'
      || dispositionInput.delta.kind === 'Deprecate'
    )
  ) {
    // D-02 flat invariant: propose-only has zero exceptions. Even deterministically confirmed
    // drift remains a candidate plus proposed-supersession relation in CI/cloud/headless contexts.
    const fallback = dispositionInput.delta.kind === 'Supersede'
      ? addCandidate(dispositionInput.delta)
      : mintUnknown(dispositionInput.delta, 'propose-only', 'clarification')
    return {
      kind: 'downgraded',
      delta: fallback,
      reason: 'propose-only',
      original: dispositionInput.delta,
      ...(dispositionInput.delta.kind === 'Supersede'
        ? {
            relationIntents: [
              {
                type: 'proposed-supersession-of' as const,
                targetId: dispositionInput.delta.victimId,
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
    delta: dispositionInput.delta,
    ...(state.renameBridge === undefined ? {} : { relationIntents: [state.renameBridge] }),
    ...(measurement.measurementAppend === undefined
      ? {}
      : { measurementAppend: measurement.measurementAppend }),
    ...(measurement.confirmedDriftSupersede
      && dispositionInput.profile.mode === 'drain-to-active'
      ? { bornActive: true as const }
      : {}),
  }
}
