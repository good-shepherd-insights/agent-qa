import {
  canonicalJson,
  decideMeasurementDrift,
  isReplayableActionShape,
  parseProcedureBody,
  sha256hex,
  foldMeasurements,
  normalizeAnchor,
  supersessionKey as schemaSupersessionKey,
  type Anchor,
  type BundleDraft,
  type BundleStatus,
  type CanaryOutcome,
  type Delta,
  type DistilledObservation,
  type GuardrailPolicy,
  type MeasurementObservation,
  type ProcedureBodyPayload,
  type RecordId,
  type ScopeKey,
} from '@vostride/agent-qa-schema'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ARTIFACT_STEP_CAP_BYTES } from '../artifact-copy.js'
import { checkpointCommittedParts } from '../bundle-egress.js'
import {
  deriveBundleTrust,
  loadBundle,
  readMeasurements,
  type LoadedBundle,
} from '../bundle-read.js'
import { enumerateBundleDirs } from '../bundle-scan.js'
import type {
  CurationCandidateArtifact,
  CurationCaptureReceipt,
} from '../queue/queue-payload.js'
import type { AuthoredDeltaCheckpoint, DispositionProfile } from './author-contract.js'
import {
  SCOPE_BURST_THRESHOLD,
  SCOPE_BURST_WINDOW_BUILDS,
  STABLE_WINDOW_BUILDS,
  THRASH_MAX_SUPERSESSIONS,
  THRASH_WINDOW_BUILDS,
  anchorScopeKey,
  foldFirstSeenAnchorsByScope,
  foldSupersessionLineage,
  scanCanonicalBundles,
  type CanonicalBundleSnapshot,
} from './lineage-fold.js'

/** Provisional §7.3.1 cap. Phase 379 may retune it only through an explicit constant edit. */
export const BLAST_RADIUS_MAX_SUPERSEDES_PER_ANCHOR_PER_DRAIN = 1

/**
 * D-22: bind one canary observation to the served candidate and attributed step. The schema
 * evidence-token recipe adds the exercised anchor and build ordinal; together those fields are
 * the complete replay identity required by §7.5.1.
 */
export function canaryOutcomeObservationId(
  outcome: Pick<
    CanaryOutcome,
    'candidateId' | 'runId' | 'testId' | 'testIndex' | 'stepIndex'
  >,
): string {
  return `canary-outcome:${sha256hex(canonicalJson({
    candidateId: outcome.candidateId,
    runId: outcome.runId,
    testId: outcome.testId,
    testIndex: outcome.testIndex,
    stepIndex: outcome.stepIndex,
  }))}`
}

/**
 * 381-03 (PROC-01 D-02/D-03): the verified queue evidence the procedure-extraction wall
 * validates against. Everything here is code-derived queue truth — distilled observations,
 * the finalized §A8 capture receipt, and the claimed artifact inventory — never LLM text.
 */
export interface ProcedureDispositionEvidence {
  distilledObservations: readonly DistilledObservation[]
  captureReceipt: CurationCaptureReceipt
  artifactInventory: readonly CurationCandidateArtifact[]
  /** Claimed candidate directory the inventory's relative paths resolve against. */
  candidateDir: string
  policy: GuardrailPolicy
  auditBaseDir: string
}

export interface DispositionCandidateContext {
  anchors: readonly Anchor[]
  scope: ScopeKey
  buildOrdinal: number
  /** Durable queue address used as the observation's idempotency identity. */
  curationJobId?: string
  /** Original measurement seed value; prose authored by a model is never parsed for authority. */
  measurementValue?: string
  /** Present only for procedure-extraction jobs; procedure deltas fail closed without it. */
  procedureEvidence?: ProcedureDispositionEvidence
}

export interface RelationIntent {
  type: 'proposed-supersession-of' | 'renamed-from'
  targetId: RecordId
}

export interface DispositionDrainState {
  supersedesSeenByAnchorKey: Map<string, number>
  /** 379 Open Question 3: one canonical O(store) scan, lazily cached per drain. */
  canonicalBundles?: CanonicalBundleSnapshot[]
  /** Test-only observability seam for proving the canonical scan runs once. */
  onCanonicalBundleScan?: () => void
  /** Prevent two jobs in one drain from arming the same not-yet-published unknown. */
  unknownMarkersSeen?: Set<string>
  /** New anchor groups observed by earlier jobs after the once-per-drain snapshot. */
  firstSeenAnchorsByScope?: Map<string, Map<string, {
    buildOrdinal: number
    recordId?: RecordId
  }>>
}

export interface FirstSeenRegistration {
  scopeKey: string
  supersessionKey: string
  buildOrdinal: number
}

export interface UnknownMintIntent {
  kind: 'thrash' | 'scope-burst'
  marker: string
  triggerKey: string
  scope: ScopeKey
  windowOpenOrdinal: number
  windowCloseOrdinal: number
  evidenceRecordIds: RecordId[]
  includeCommittedBundle: boolean
  firstSeenCount?: number
}

export interface UnknownResolutionIntent {
  targetId: RecordId
  reason: 'thrash-stable-window'
}

export interface DisposeDeltaInput {
  delta: Delta
  checkpoint: AuthoredDeltaCheckpoint
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
      unknownMintIntents?: UnknownMintIntent[]
      unknownResolutionIntents?: UnknownResolutionIntent[]
      firstSeenRegistration?: FirstSeenRegistration
    }
  | {
      kind: 'downgraded'
      delta: Delta
      reason: string
      original: Delta
      relationIntents?: RelationIntent[]
      measurementAppend?: { victimId: RecordId; observation: MeasurementObservation }
      unknownMintIntents?: UnknownMintIntent[]
      unknownResolutionIntents?: UnknownResolutionIntent[]
      firstSeenRegistration?: FirstSeenRegistration
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
  unknownMintIntents?: UnknownMintIntent[]
  unknownResolutionIntents?: UnknownResolutionIntent[]
  firstSeenRegistration?: FirstSeenRegistration
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

function canonicalBundles(input: DisposeDeltaInput): readonly CanonicalBundleSnapshot[] {
  if (input.drainState.canonicalBundles === undefined) {
    input.drainState.onCanonicalBundleScan?.()
    input.drainState.canonicalBundles = scanCanonicalBundles(input.knowledgeRoot)
  }
  return input.drainState.canonicalBundles
}

function flowMarker(bundle: CanonicalBundleSnapshot): string | undefined {
  const primary = bundle.anchors[0]
  return primary?.t === 'flow' ? primary.name : undefined
}

function unresolvedUnknownsWithPrefix(
  input: DisposeDeltaInput,
  prefix: string,
): CanonicalBundleSnapshot[] {
  return canonicalBundles(input).filter((bundle) =>
    bundle.kind === 'unknown'
    && bundle.status !== 'deprecated'
    && bundle.status !== 'superseded'
    && flowMarker(bundle)?.startsWith(prefix) === true,
  )
}

function unknownMarkerAlreadyArmed(input: DisposeDeltaInput, marker: string): boolean {
  if (input.drainState.unknownMarkersSeen?.has(marker) === true) return true
  return canonicalBundles(input).some((bundle) =>
    bundle.kind === 'unknown'
    && flowMarker(bundle) === marker,
  )
}

function armUnknownMarker(input: DisposeDeltaInput, marker: string): void {
  input.drainState.unknownMarkersSeen ??= new Set<string>()
  input.drainState.unknownMarkersSeen.add(marker)
}

function pushUnknownMint(state: EvaluationState, intent: UnknownMintIntent): void {
  state.unknownMintIntents = [...(state.unknownMintIntents ?? []), intent]
}

function pushUnknownResolution(
  state: EvaluationState,
  intent: UnknownResolutionIntent,
): void {
  state.unknownResolutionIntents = [...(state.unknownResolutionIntents ?? []), intent]
}

/**
 * D-07/D-08: the tripping Supersede remains the applied write. The unresolved
 * unknown is a second deterministic commit intent; it suppresses serving later,
 * never this writer path.
 */
function armThrashTripAndClosure(
  input: DisposeDeltaInput,
  lookup: TruthLookup,
  state: EvaluationState,
): void {
  const buildOrdinal = input.candidate?.buildOrdinal
  if (buildOrdinal === undefined) return
  const bundles = canonicalBundles(input)

  if (input.delta.kind === 'Supersede' && input.profile.mode === 'drain-to-active') {
    const victim = lookup(input.delta.victimId)
    if (victim === undefined) return
    const victimAnchors = victim.bundle.frontmatter.anchors.map(
      ({ normalized }) => normalized,
    )
    const triggerKey = schemaSupersessionKey(victimAnchors)
    const folded = foldSupersessionLineage(bundles, {
      windowBuilds: THRASH_WINDOW_BUILDS,
      asOfBuildOrdinal: buildOrdinal,
    }).get(triggerKey)
    const depthAfterCommit = (folded?.supersededDepthInWindow ?? 0) + 1
    if (depthAfterCommit < THRASH_MAX_SUPERSESSIONS) return

    const prefix = `thrash:${triggerKey}:window:`
    if (unresolvedUnknownsWithPrefix(input, prefix).length > 0) return
    const windowOpenOrdinal = folded?.windowOpenOrdinal
      ?? Math.max(1, buildOrdinal - THRASH_WINDOW_BUILDS + 1)
    const marker = `${prefix}${windowOpenOrdinal}`
    if (unknownMarkerAlreadyArmed(input, marker)) return

    pushUnknownMint(state, {
      kind: 'thrash',
      marker,
      triggerKey,
      scope: input.delta.scope,
      windowOpenOrdinal,
      windowCloseOrdinal: buildOrdinal,
      evidenceRecordIds: [
        ...(folded?.chainRecordIds ?? []),
        input.delta.victimId,
      ].filter((id, index, values) => values.indexOf(id) === index).sort(),
      includeCommittedBundle: true,
    })
    armUnknownMarker(input, marker)
    return
  }

  if (input.delta.kind !== 'Confirm') return
  const target = lookup(input.delta.targetId)
  if (target === undefined) return
  const targetAnchors = target.bundle.frontmatter.anchors.map(
    ({ normalized }) => normalized,
  )
  const triggerKey = schemaSupersessionKey(targetAnchors)
  const folded = foldSupersessionLineage(bundles, {
    windowBuilds: Number.MAX_SAFE_INTEGER,
    asOfBuildOrdinal: buildOrdinal,
  }).get(triggerKey)
  const latest = folded?.latestSupersessionOrdinal
  if (latest === undefined || buildOrdinal - latest < STABLE_WINDOW_BUILDS) return

  for (const unknown of unresolvedUnknownsWithPrefix(input, `thrash:${triggerKey}:window:`)) {
    pushUnknownResolution(state, {
      targetId: unknown.recordId,
      reason: 'thrash-stable-window',
    })
  }
}

function createdAnchors(delta: Delta): readonly Anchor[] | undefined {
  if (delta.kind === 'Add') return delta.bundle.anchors
  if (delta.kind === 'Supersede') return delta.newBundle.anchors
  return undefined
}

/**
 * D-09/Open Question 3: evaluate the O(store) first-seen fold once per drain,
 * then increment it with committed jobs carried in drain state. Crossing the
 * provisional threshold arms one scope/window unknown without rewriting the
 * triggering Add or Supersede.
 */
function armScopeBurst(
  input: DisposeDeltaInput,
  state: EvaluationState,
): void {
  const anchors = createdAnchors(input.delta)
  const buildOrdinal = input.candidate?.buildOrdinal
  if (anchors === undefined || buildOrdinal === undefined) return

  const scopeKey = anchorScopeKey(anchors)
  if (scopeKey === undefined) return
  const candidateKey = schemaSupersessionKey(anchors)
  const bundles = canonicalBundles(input)
  const matchingCanonical = bundles.filter((bundle) =>
    bundle.kind !== 'unknown'
    && schemaSupersessionKey(bundle.anchors) === candidateKey,
  )
  const replayedCandidate = matchingCanonical.find((bundle) =>
    input.candidate?.curationJobId !== undefined
    && bundle.curationJobId === input.candidate.curationJobId,
  )
  if (matchingCanonical.some((bundle) => bundle !== replayedCandidate)) return
  const baselineBundles = replayedCandidate === undefined
    ? bundles
    : bundles.filter((bundle) => bundle.recordId !== replayedCandidate.recordId)

  input.drainState.firstSeenAnchorsByScope ??= new Map()
  const entries = input.drainState.firstSeenAnchorsByScope.get(scopeKey) ?? new Map()
  input.drainState.firstSeenAnchorsByScope.set(scopeKey, entries)
  if (entries.has(candidateKey)) return

  const baseline = foldFirstSeenAnchorsByScope(baselineBundles, {
    windowBuilds: SCOPE_BURST_WINDOW_BUILDS,
    asOfBuildOrdinal: buildOrdinal,
  }).get(scopeKey)
  const windowOpenOrdinal = baseline?.windowOpenOrdinal
    ?? Math.max(1, buildOrdinal - SCOPE_BURST_WINDOW_BUILDS + 1)
  const inWindowEntries = [...entries.entries()].filter(
    ([, entry]) => entry.buildOrdinal >= windowOpenOrdinal,
  )
  const countBefore = (baseline?.firstSeenCount ?? 0) + inWindowEntries.length
  entries.set(candidateKey, {
    buildOrdinal,
    ...(replayedCandidate === undefined ? {} : { recordId: replayedCandidate.recordId }),
  })
  state.firstSeenRegistration = {
    scopeKey,
    supersessionKey: candidateKey,
    buildOrdinal,
  }
  const countAfter = countBefore + 1
  if (countBefore > SCOPE_BURST_THRESHOLD || countAfter <= SCOPE_BURST_THRESHOLD) return

  const marker = `scope-burst:${scopeKey}:window:${windowOpenOrdinal}`
  if (unknownMarkerAlreadyArmed(input, marker)) return
  pushUnknownMint(state, {
    kind: 'scope-burst',
    marker,
    triggerKey: scopeKey,
    scope: input.delta.scope,
    windowOpenOrdinal,
    windowCloseOrdinal: buildOrdinal,
    firstSeenCount: countAfter,
    evidenceRecordIds: [
      ...(baseline?.recordIds ?? []),
      ...inWindowEntries.flatMap(([, entry]) =>
        entry.recordId === undefined ? [] : [entry.recordId],
      ),
    ].filter((id, index, values) => values.indexOf(id) === index).sort(),
    includeCommittedBundle: true,
  })
  armUnknownMarker(input, marker)
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

/**
 * 379 D-22 / RATIFICATION A3: `renamed-from` is the concrete realization of
 * memory.md §9.6's alias edge. It already round-trips from relations.json into
 * graph_edges and is traversed by retrieval expansion, so no synonym edge type
 * is added.
 */
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

function procedureDraft(delta: Delta): BundleDraft | undefined {
  if (delta.kind === 'Add' && delta.bundle.kind === 'procedure') return delta.bundle
  if (delta.kind === 'Supersede' && delta.newBundle.kind === 'procedure') {
    return delta.newBundle
  }
  return undefined
}

interface CoveredProcedureStep {
  step: ProcedureBodyPayload['steps'][number]
  observation: DistilledObservation
}

/**
 * §7.1 candidacy mapping: each committed step's authored instruction is the emit fold's
 * step natural key, so a covered step resolves to exactly one verified-PASS distilled
 * observation. A missing or ambiguous mapping is itself missing PASS evidence — fail closed.
 */
function coveredProcedureSteps(
  payload: ProcedureBodyPayload,
  observations: readonly DistilledObservation[],
): CoveredProcedureStep[] | undefined {
  const byNaturalKey = new Map<string, DistilledObservation[]>()
  for (const observation of observations) {
    const group = byNaturalKey.get(observation.step.naturalKey) ?? []
    group.push(observation)
    byNaturalKey.set(observation.step.naturalKey, group)
  }
  const covered: CoveredProcedureStep[] = []
  for (const step of payload.steps) {
    const group = byNaturalKey.get(step.instruction)
    if (group === undefined || group.length !== 1) return undefined
    covered.push({ step, observation: group[0]! })
  }
  return covered
}

/**
 * 381-03 (PROC-01): the deterministic procedure-extraction wall — D-02 candidacy (contiguous
 * verified-PASS span with resolved elements + coherent anchors) and Pitfall 6 replayability
 * (the ONE shared schema exclusion list, never a fork). Any failed check disposes the delta
 * as a structured Noop with a machine-readable reason; nothing here reads LLM prose for
 * authority — the body decode is fail-closed and evidence comes from the durable queue payload.
 */
function disposeProcedureExtraction(input: DisposeDeltaInput): string | undefined {
  const draft = procedureDraft(input.delta)
  if (draft === undefined) return undefined
  const evidence = input.candidate?.procedureEvidence
  if (evidence === undefined) return 'procedure-evidence-missing'

  const payload = parseProcedureBody(draft.body)
  if (payload === undefined) return 'procedure-body-unparseable'

  const covered = coveredProcedureSteps(payload, evidence.distilledObservations)
  if (covered === undefined) return 'procedure-step-coverage'
  for (let index = 1; index < covered.length; index += 1) {
    const previous = covered[index - 1]!.observation.step.ordinal
    if (covered[index]!.observation.step.ordinal !== previous + 1) {
      return 'procedure-span-non-contiguous'
    }
  }
  if (covered.some(({ observation }) => observation.element === undefined)) {
    return 'procedure-step-unresolved-element'
  }

  if (draft.anchors.filter((anchor) => anchor.t === 'flow').length !== 1) {
    return 'procedure-flow-anchor'
  }
  const coveredSurfaces = new Set(
    covered.flatMap(({ observation }) =>
      observation.surface === undefined ? [] : [observation.surface.naturalKey],
    ),
  )
  const pageRoutes = [
    ...draft.anchors.flatMap((anchor) => (anchor.t === 'page' ? [anchor.route] : [])),
    ...payload.steps.map((step) => step.guard.pageAnchor.route),
  ]
  if (pageRoutes.some((route) => !coveredSurfaces.has(route))) {
    return 'procedure-page-anchor-disjoint'
  }

  for (const { step } of covered) {
    const shapeKeys = [
      ...Object.keys(step.action.targets),
      ...Object.keys(step.action.values),
    ]
    if (!isReplayableActionShape(step.action.type, shapeKeys)) {
      return 'procedure-non-replayable-action'
    }
  }

  const secretReject = procedureSecretLiteralReject(covered, evidence.captureReceipt)
  if (secretReject !== undefined) return secretReject

  const bindingReject = procedureBindingIntegrityReject(payload)
  if (bindingReject !== undefined) return bindingReject

  if (procedureArtifactEgressBlocked(evidence)) return 'procedure-artifact-egress'

  return undefined
}

/**
 * Handoff evidence is masked-before-record (T-353-08): secrets surface as `<SECRET_n>`/
 * `<EMAIL_n>` placeholders (or an unexpanded `{{secret:...}}` template) and test variables
 * as `{{env:...}}` templates. The emit fold labels value sources on this same contract; any
 * such observed value surviving as a committed literal is a D-03 structural reject — the
 * secret param type only protects values that stay `{ param }` referenced (T-381-02/07).
 */
const MASKED_SECRET_VALUE_PATTERN = /<(?:SECRET|EMAIL)_\d+>|\{\{\s*secret:/
const TEST_VARIABLE_VALUE_PATTERN = /\{\{\s*env:/

/**
 * D-03 rule 2. Two independent signals, both fail closed: (1) the literal's own content
 * matches the masking contract; (2) the finalized capture receipt marks a masked credential
 * region on the covered step's ordinal — the receipt's element refs are not carried into
 * the codec body, so ANY literal slot on a masked step is refused (step-granular, not
 * lane-granular, deliberately).
 */
function procedureSecretLiteralReject(
  covered: readonly CoveredProcedureStep[],
  captureReceipt: CurationCaptureReceipt,
): string | undefined {
  const maskedStepOrdinals = new Set(
    captureReceipt.regions.map((region) => region.stepIndex),
  )
  for (const { step, observation } of covered) {
    for (const slot of Object.values(step.action.values)) {
      if (typeof slot !== 'string') continue
      if (MASKED_SECRET_VALUE_PATTERN.test(slot)) return 'procedure-masked-secret-literal'
      if (TEST_VARIABLE_VALUE_PATTERN.test(slot)) return 'procedure-test-variable-literal'
      if (maskedStepOrdinals.has(observation.step.ordinal)) {
        return 'procedure-masked-secret-literal'
      }
    }
  }
  return undefined
}

/**
 * D-03 rule 1: every `{ param }` ref must resolve to a declared parameter, and every
 * declared parameter must be referenced by at least one step value slot. (Param types
 * outside the closed string/number/boolean/secret union are unreachable here by
 * construction — `parseProcedureBody` already refused them at the decode wall.)
 */
function procedureBindingIntegrityReject(
  payload: ProcedureBodyPayload,
): string | undefined {
  const declared = new Set(payload.parameters.map(({ name }) => name))
  const referenced = new Set<string>()
  for (const step of payload.steps) {
    for (const slot of Object.values(step.action.values)) {
      if (typeof slot === 'string') continue
      if (!declared.has(slot.param)) return 'procedure-param-undeclared'
      referenced.add(slot.param)
    }
  }
  if (payload.parameters.some(({ name }) => !referenced.has(name))) {
    return 'procedure-param-unreferenced'
  }
  return undefined
}

/**
 * RESEARCH A3 / Pitfall 10 / T-381-07. The ratified ≤2MB/step artifact cap is enforced by
 * the ONE existing commit-path wall — `copyArtifacts` (`ARTIFACT_STEP_CAP_BYTES`, skip
 * reason 'step-cap') inside `commitCurationDelta`'s required pre-copy pass — so disposition
 * adds no duplicate clamp. What the commit path does NOT cover is artifact BYTES under the
 * committed-text egress checkpoint: `publishBundle` checkpoints only rendered text parts,
 * while artifact blobs land in the gitignore-covered artifacts/ tree. The extraction wall
 * therefore runs the same fail-closed assert over every claimed artifact's bytes before a
 * procedure delta may commit. Two deliberate skips, both parity with the copy wall: a
 * pruned source (the copy skips it identically) and bytes above `ARTIFACT_STEP_CAP_BYTES`
 * (the copy refuses it as 'step-cap', so it can never ride the bundle — scanning it would
 * only expose the detector pass to multi-megabyte pathological inputs).
 */
function procedureArtifactEgressBlocked(
  evidence: ProcedureDispositionEvidence,
): boolean {
  const parts: { label: string; text: string }[] = []
  for (const artifact of evidence.artifactInventory) {
    let bytes: Buffer
    try {
      bytes = readFileSync(join(evidence.candidateDir, artifact.relativePath))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    if (bytes.byteLength > ARTIFACT_STEP_CAP_BYTES) continue
    parts.push({
      label: `procedure-artifact:${artifact.sha256}`,
      text: bytes.toString('utf8'),
    })
  }
  if (parts.length === 0) return false
  return checkpointCommittedParts(parts, {
    policy: evidence.policy,
    auditBaseDir: evidence.auditBaseDir,
  }).kind === 'egress-blocked'
}

/**
 * Run memory.md §7.3.1's six checks in order. The function is deliberately synchronous: every
 * decision is made from the persisted checkpoint and canonical bundle tree, never an index row.
 */
export function disposeDelta(input: DisposeDeltaInput): DispositionOutcome {
  const procedureReject = disposeProcedureExtraction(input)
  if (procedureReject !== undefined) {
    return { kind: 'noop', reason: procedureReject }
  }
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
    if (fallback.kind === 'Add') {
      armScopeBurst({ ...dispositionInput, delta: fallback }, state)
    }
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
              ...(state.renameBridge === undefined ? [] : [state.renameBridge]),
            ],
          }
        : {}),
      ...(state.unknownMintIntents === undefined
        ? {}
        : { unknownMintIntents: state.unknownMintIntents }),
      ...(state.firstSeenRegistration === undefined
        ? {}
        : { firstSeenRegistration: state.firstSeenRegistration }),
    }
  }

  armThrashTripAndClosure(dispositionInput, lookup, state)
  armScopeBurst(dispositionInput, state)
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
    ...(state.unknownMintIntents === undefined
      ? {}
      : { unknownMintIntents: state.unknownMintIntents }),
    ...(state.unknownResolutionIntents === undefined
      ? {}
      : { unknownResolutionIntents: state.unknownResolutionIntents }),
    ...(state.firstSeenRegistration === undefined
      ? {}
      : { firstSeenRegistration: state.firstSeenRegistration }),
    ...(measurement.confirmedDriftSupersede
      && dispositionInput.profile.mode === 'drain-to-active'
      ? { bornActive: true as const }
      : {}),
  }
}
