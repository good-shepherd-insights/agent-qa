import {
  applyColdStartSubCap,
  isVettedCandidate,
  normalizeAnchor,
  type Anchor,
  type IndexEntry,
  type ScopeKey,
  type VettedCandidateInput,
} from '@vostride/agent-qa-schema'

import {
  preFilterPredicate,
  type PreFilterOptions,
} from '../retrieval/pre-filter.js'
import {
  applyDiversityCaps,
  applyLifecycleTrustTreatments,
  rerankPrecedence,
  type RerankEntry,
  type ValidityClass,
} from '../retrieval/rerank.js'
import {
  applyValidity,
  resolveAsOfBuild,
  type ValidityCandidate,
} from '../retrieval/validity.js'
import { clusterKey } from './cluster-key.js'
import { renderBriefLine } from './brief-render.js'

export interface ServingTierFilter extends PreFilterOptions {}

export interface SelectServingRecordsInput {
  readonly candidates: readonly IndexEntry[]
  readonly scope: ScopeKey
  readonly channelBudget: number
  readonly recordCap: number
  readonly asOfBuild?: number
  /** Canonical §5.5.1 product/scope material when the loaded set spans more than one tier. */
  readonly tier?: ServingTierFilter
  /** Raw schema inputs are optional because an IndexEntry may already carry derived `unverified`. */
  readonly candidateVetting?: Readonly<Record<string, VettedCandidateInput>>
}

interface TemporalServingCandidate extends ValidityCandidate {
  readonly record: IndexEntry
  readonly vettedCandidateInput?: VettedCandidateInput
}

interface RankedServingCandidate extends TemporalServingCandidate, RerankEntry {
  readonly record: IndexEntry
}

interface CostedServingCandidate extends RankedServingCandidate {
  readonly tokenEstimate: number
}

interface ScoredServingCandidate {
  readonly candidate: CostedServingCandidate
  readonly score: number
}

const KIND_PRECEDENCE: Readonly<Record<string, number>> = {
  caution: 0,
  procedure: 1,
  fact: 2,
}

function normalizeLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

export function compareServingRecordIds(left: IndexEntry, right: IndexEntry): number {
  const leftId = String(left.id)
  const rightId = String(right.id)
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

function servingTrust(entry: IndexEntry): number {
  return Number.isFinite(entry.trust) ? Math.max(0, entry.trust) : 0
}

export function compareServingTrustThenId(left: IndexEntry, right: IndexEntry): number {
  return servingTrust(right) - servingTrust(left) || compareServingRecordIds(left, right)
}

function normalizedAnchorText(anchor: Anchor): string {
  const normalized = normalizeAnchor(anchor)
  switch (normalized.t) {
    case 'page':
      return normalized.route
    case 'flow':
      return normalized.name
    case 'el':
      return `${normalized.role} ${normalized.name}`
    case 'platform':
      return normalized.platform
    case 'selector':
      return normalized.literal
    case 'error':
      return normalized.message
  }
}

function affinityTokens(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
}

/**
 * PROVISIONAL §10 scope affinity: one baseline point plus the largest normalized anchor-token
 * overlap with the scope key. M3 may calibrate weights, not its deterministic/no-model posture.
 */
function anchorMatch(anchors: readonly Anchor[], scope: ScopeKey): number {
  const scopeTokens = affinityTokens(scope.key)
  let bestOverlap = 0

  for (const anchor of anchors) {
    const anchorTokens = affinityTokens(normalizedAnchorText(anchor))
    let overlap = 0
    for (const token of anchorTokens) {
      if (scopeTokens.has(token)) overlap += 1
    }
    bestOverlap = Math.max(bestOverlap, overlap)
  }

  return 1 + bestOverlap
}

function candidateVetting(
  input: SelectServingRecordsInput,
  candidate: IndexEntry,
): VettedCandidateInput | undefined {
  return input.candidateVetting?.[String(candidate.id)]
}

function isEligibleCandidate(
  input: SelectServingRecordsInput,
  candidate: IndexEntry,
): boolean {
  if (candidate.status !== 'candidate') return candidate.status === 'active'

  const vetting = candidateVetting(input, candidate)
  if (vetting !== undefined) return isVettedCandidate(vetting)

  // `unverified` is the read-side projection of that same schema predicate. Keep the schema's
  // fact/caution boundary explicit so a malformed IndexEntry cannot widen the canary channel.
  return candidate.unverified === true
    && (candidate.kind === 'fact' || candidate.kind === 'caution')
}

function preFilter(
  input: SelectServingRecordsInput,
): IndexEntry[] {
  const material: PreFilterOptions = input.tier ?? {
    product: '',
    testKey: input.scope.key,
    suiteKey: input.scope.key,
    productKey: input.scope.key,
    globalKey: input.scope.key,
  }
  const predicate = preFilterPredicate(material)
  const admittedScopeKeys = new Set(predicate.binds.slice(1))

  return input.candidates.filter((candidate) => {
    // D-08: a rule is either sovereign or it is not yet a rule.
    if (candidate.kind === 'policy') return false
    if (
      material.includeSuperseded !== true
      && (candidate.status === 'deprecated' || candidate.status === 'superseded')
    ) {
      return false
    }
    if (input.tier !== undefined && !admittedScopeKeys.has(candidate.scope.key)) return false
    return isEligibleCandidate(input, candidate)
  })
}

function temporalCandidate(
  input: SelectServingRecordsInput,
  record: IndexEntry,
  product: string,
): TemporalServingCandidate {
  const openedAtOrdinal = record.audit?.openedAtOrdinal ?? 0
  const closedAtOrdinal = record.audit?.closedAtOrdinal ?? null
  const vetting = candidateVetting(input, record)

  return {
    bundleId: String(record.id),
    anchors: record.anchors,
    openedAtOrdinal,
    closedAtOrdinal,
    createdAtOrdinal: openedAtOrdinal,
    status: record.status,
    product,
    record,
    ...(vetting === undefined ? {} : { vettedCandidateInput: vetting }),
  }
}

function validityClass(
  candidate: TemporalServingCandidate & { servedAs?: IndexEntry['servedAs'] },
): ValidityClass {
  return candidate.servedAs === 'prior-build-hypothesis'
    ? 'priorBuildHypothesis'
    : 'current'
}

function rankedCandidate(
  candidate: TemporalServingCandidate & { servedAs?: IndexEntry['servedAs'] },
): RankedServingCandidate {
  const lastConfirmedOrdinal = candidate.record.unconfirmedSinceOrdinal
    ?? candidate.openedAtOrdinal
  const originClass = candidate.vettedCandidateInput?.originClass === 'user'
    ? 'user' as const
    : 'agent' as const

  return {
    ...candidate,
    validityClass: validityClass(candidate),
    trust: candidate.record.trust,
    scope: candidate.record.scope,
    recencyOrdinal: candidate.createdAtOrdinal,
    originClass,
    subtype: candidate.record.subtype ?? null,
    lastConfirmedOrdinal,
    ...(candidate.record.unconfirmedSinceOrdinal === undefined
      ? {}
      : { unconfirmedSinceOrdinal: candidate.record.unconfirmedSinceOrdinal }),
    ...(candidate.record.unverified === true ? { unverified: true } : {}),
    ...(candidate.record.conflict === undefined ? {} : { conflict: candidate.record.conflict }),
  }
}

function reflectedRecord(candidate: RankedServingCandidate): IndexEntry {
  const { record } = candidate
  return {
    ...record,
    trust: candidate.trust,
    ...(candidate.unconfirmedSinceOrdinal === undefined
      ? {}
      : { unconfirmedSinceOrdinal: candidate.unconfirmedSinceOrdinal }),
    ...(candidate.unverified === true ? { unverified: true } : {}),
  }
}

function kindPrecedence(kind: string): number {
  return KIND_PRECEDENCE[kind] ?? 3
}

function compareScored(
  left: ScoredServingCandidate,
  right: ScoredServingCandidate,
): number {
  return (
    kindPrecedence(left.candidate.record.kind) - kindPrecedence(right.candidate.record.kind)
    || right.score - left.score
    // PROVISIONAL deterministic tie-break; M3 may retune scoring, never input-order dependence.
    || compareServingRecordIds(left.candidate.record, right.candidate.record)
  )
}

export interface ServingAdmissionState {
  readonly selectedIds: Set<string>
  readonly sourceCosts: Map<string, number>
  readonly clusterCosts: Map<string, number>
  selectedCount: number
  usedBudget: number
}

export function createServingAdmissionState(): ServingAdmissionState {
  return {
    selectedIds: new Set<string>(),
    sourceCosts: new Map<string, number>(),
    clusterCosts: new Map<string, number>(),
    selectedCount: 0,
    usedBudget: 0,
  }
}

export interface ServingAdmissionInput {
  readonly record: IndexEntry
  readonly cost: number
  readonly channelBudget: number
  readonly recordCap: number
}

/**
 * Shared D-18 greedy admission wall. Channel-specific selectors own ranking, while this helper
 * keeps budget, distinct-record, source-bundle, and normalized-anchor-cluster accounting exact.
 */
export function tryAdmitServingRecord(
  input: ServingAdmissionInput,
  state: ServingAdmissionState,
): boolean {
  const channelBudget = normalizeLimit(input.channelBudget)
  const recordCap = normalizeLimit(input.recordCap)
  const cost = normalizeLimit(input.cost)
  if (recordCap === 0 || cost === 0 || state.selectedCount >= recordCap) return false

  const sourceId = String(input.record.id)
  if (state.selectedIds.has(sourceId) || state.usedBudget + cost > channelBudget) return false

  const cluster = clusterKey(input.record.anchors)
  const nextSourceCost = (state.sourceCosts.get(sourceId) ?? 0) + cost
  const nextClusterCost = (state.clusterCosts.get(cluster) ?? 0) + cost
  // D-18's ≤50% boundary is integer-only: equality is admitted; strictly above is skipped.
  if (2 * nextSourceCost > channelBudget || 2 * nextClusterCost > channelBudget) return false

  state.selectedIds.add(sourceId)
  state.sourceCosts.set(sourceId, nextSourceCost)
  state.clusterCosts.set(cluster, nextClusterCost)
  state.selectedCount += 1
  state.usedBudget += cost
  return true
}

function scoreCandidates(
  candidates: readonly CostedServingCandidate[],
  scope: ScopeKey,
): ScoredServingCandidate[] {
  return candidates
    .map((candidate) => ({
      candidate,
      score: (Number.isFinite(candidate.trust) ? Math.max(0, candidate.trust) : 0)
        * anchorMatch(candidate.anchors, scope),
    }))
    .sort(compareScored)
}

function stageCandidates(
  input: SelectServingRecordsInput,
  channelBudget: number,
): ScoredServingCandidate[] {
  const product = input.tier?.product ?? ''
  const temporal = preFilter(input).map((record) => temporalCandidate(input, record, product))
  const resolvedAsOf = resolveAsOfBuild({
    product,
    candidates: temporal,
    ...(input.asOfBuild === undefined ? {} : { asOfBuild: input.asOfBuild }),
  })
  const valid = applyValidity(temporal, resolvedAsOf).map(rankedCandidate)
  const treated = resolvedAsOf === undefined
    ? valid
    : applyLifecycleTrustTreatments(valid, resolvedAsOf).map((candidate) => (
        candidate.record.unverified === true && candidate.unverified !== true
          ? { ...candidate, unverified: true as const }
          : candidate
      ))
  const costed: CostedServingCandidate[] = treated.map((candidate) => ({
    ...candidate,
    tokenEstimate: renderBriefLine(reflectedRecord(candidate)).cost,
  }))
  const reranked = applyDiversityCaps(rerankPrecedence(costed))
  const scored = scoreCandidates(reranked, input.scope)
  const vetted = scored.filter(({ candidate }) => candidate.unverified === true)
  const admittedVetted = new Set(
    applyColdStartSubCap(
      vetted.map(({ candidate }) => candidate),
      channelBudget,
    ).map(({ bundleId }) => bundleId),
  )

  return scored
    .filter(({ candidate }) => candidate.unverified !== true || admittedVetted.has(candidate.bundleId))
    .sort(compareScored)
}

/**
 * Pure Channel-1/Channel-3 selection over already-loaded records. Retrieval legs, fusion, models,
 * and persistence stay outside this assembly floor.
 */
export function selectServingRecords(input: SelectServingRecordsInput): IndexEntry[] {
  const channelBudget = normalizeLimit(input.channelBudget)
  const recordCap = normalizeLimit(input.recordCap)
  if (channelBudget === 0 || recordCap === 0 || input.candidates.length === 0) return []

  const selected: IndexEntry[] = []
  const admission = createServingAdmissionState()

  for (const { candidate } of stageCandidates(input, channelBudget)) {
    if (admission.selectedCount >= recordCap) break
    const record = reflectedRecord(candidate)
    if (!tryAdmitServingRecord({
      record,
      cost: candidate.tokenEstimate,
      channelBudget,
      recordCap,
    }, admission)) continue

    selected.push(record)
  }

  return selected
}
