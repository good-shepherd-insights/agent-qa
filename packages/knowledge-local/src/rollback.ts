/**
 * D-15 provenance-keyed rollback.
 *
 * Resolution is derived exclusively from canonical bundle files. Disposable records rows are
 * never consulted, so deleting or rebuilding the local index cannot change the affected set.
 * Task 2 attaches the append-only inverse emitter to this resolution authority.
 */
import { isAbsolute } from 'node:path'

import {
  asEvidenceToken,
  asRecordId,
  canonicalJson,
  eventDedupKey,
  sha256hex,
  supersessionKey,
  survivingOutcomeEvents,
  type BundleOutcomeEvent,
  type Delta,
  type OriginClass,
  type RecordId,
} from '@vostride/agent-qa-schema'

import { appendOutcomeEvent } from './bundle-append.js'
import { deriveBundleTrust, loadBundle } from './bundle-read.js'
import type { LoadedBundle } from './bundle-read.js'
import type { BundleStoreConfig } from './bundle-publish.js'
import { enumerateBundleDirs } from './bundle-scan.js'
import { applyIndexDeltaForBundle } from './curator/commit.js'
import type { AuthoredDeltaCheckpoint } from './curator/author-contract.js'
import { disposeDelta } from './curator/disposition.js'
import { refreshWriterLeaseAuthority } from './lease/writer-lease.js'
import type { WriterLeaseAuthority } from './lease/writer-lease.js'

export type RollbackKind = 'job' | 'campaign'

export interface RollbackCounterEvent {
  recordId: RecordId
  evidenceToken: string
  curationJobId: string
  type: 'confirmed' | 'deprecated' | 'superseded' | 'promoted'
}

export interface RollbackAffectedSet {
  mintedBundleIds: RecordId[]
  counterEvents: RollbackCounterEvent[]
}

export interface RollbackReport {
  receiptId: string
  inverseCount: number
  restoredVictims: RecordId[]
  deprecatedBundles: RecordId[]
  /** Bundles whose surviving promoted events were cascade-retracted after support loss. */
  retractedPromotions: RecordId[]
  /** Auditable exact resolution that drove inverse construction. */
  affected: RollbackAffectedSet
}

export type RollbackMutationKind = 'append' | 'projection'

export interface RollbackHooks {
  /** Test/chaos seam after canonical resolution and causal preflight, before the first write. */
  afterResolution?: () => void
  /** Test/chaos seam after one actual append or projection mutation completes. */
  afterMutation?: (kind: RollbackMutationKind, recordId: RecordId) => void
}

interface RollbackBaseInput {
  knowledgeRoot: string
  auditBaseDir: string
  resolvedAtOrdinal: number
  /** Governed maintenance callers fence this exact lease at every mutation boundary. */
  writerAuthority?: WriterLeaseAuthority
  hooks?: RollbackHooks
}

export interface RollbackCurationJobInput extends RollbackBaseInput {
  curationJobId: string
}

export interface RollbackCampaignInput extends RollbackBaseInput {
  fromOrdinal?: number
  toOrdinal?: number
  anchorClusterKey?: string
  originClass?: OriginClass
}

interface CanonicalRollbackBundle {
  recordId: RecordId
  product: string
  bundle: LoadedBundle
}

interface ResolvedCounterEvent extends RollbackCounterEvent {
  event: BundleOutcomeEvent
  product: string
}

interface RollbackResolution {
  receiptId: string
  mintedBundles: CanonicalRollbackBundle[]
  counterEvents: ResolvedCounterEvent[]
}

export type ResolveRollbackAffectedSetInput =
  | RollbackCurationJobInput
  | RollbackCampaignInput

/**
 * CR-02: a rollback must never attest success at a resolution ordinal that is powerless to
 * change lifecycle status. At equal buildOrdinal the trust fold's fixed STATUS_PRECEDENCE keeps
 * active above deprecated, and an older event can never replace a newer status, so a
 * non-strictly-later resolvedAtOrdinal cannot causally invert a minted bundle.
 */
export class RollbackCausalityError extends Error {
  readonly offendingRecordIds: RecordId[]
  readonly minimumRequiredOrdinal: number

  constructor(offendingRecordIds: RecordId[], minimumRequiredOrdinal: number) {
    super(
      `rollback resolvedAtOrdinal must be at least ${minimumRequiredOrdinal} `
      + `to invert ${offendingRecordIds.join(', ')}`,
    )
    this.name = 'RollbackCausalityError'
    this.offendingRecordIds = offendingRecordIds
    this.minimumRequiredOrdinal = minimumRequiredOrdinal
  }
}

const ORIGIN_CLASSES = new Set<OriginClass>([
  'user',
  'agent-verified',
  'agent-observed',
  'import',
])
const ANCHOR_CLUSTER_KEY = /^[0-9a-f]{64}$/

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function assertOrdinal(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`)
  }
}

function assertBaseInput(input: RollbackBaseInput): void {
  if (!isAbsolute(input.knowledgeRoot)) {
    throw new TypeError('rollback knowledgeRoot must be absolute')
  }
  if (!isAbsolute(input.auditBaseDir)) {
    throw new TypeError('rollback auditBaseDir must be absolute')
  }
  if (
    input.writerAuthority !== undefined
    && input.writerAuthority.knowledgeRoot !== input.knowledgeRoot
  ) {
    throw new TypeError('rollback writerAuthority must belong to knowledgeRoot')
  }
  assertOrdinal(input.resolvedAtOrdinal, 'rollback resolvedAtOrdinal')
}

function fenceWriterAuthority(input: RollbackBaseInput): void {
  if (input.writerAuthority === undefined) return
  if (input.writerAuthority.knowledgeRoot !== input.knowledgeRoot) {
    throw new TypeError('rollback writerAuthority must belong to knowledgeRoot')
  }
  refreshWriterLeaseAuthority(input.writerAuthority)
}

function campaignKeys(input: RollbackCampaignInput): Readonly<Record<string, unknown>> {
  if (input.fromOrdinal !== undefined) {
    assertOrdinal(input.fromOrdinal, 'rollback fromOrdinal')
  }
  if (input.toOrdinal !== undefined) {
    assertOrdinal(input.toOrdinal, 'rollback toOrdinal')
  }
  if (
    input.fromOrdinal !== undefined
    && input.toOrdinal !== undefined
    && input.fromOrdinal > input.toOrdinal
  ) {
    throw new RangeError('rollback fromOrdinal must be less than or equal to toOrdinal')
  }
  if (
    input.anchorClusterKey !== undefined
    && !ANCHOR_CLUSTER_KEY.test(input.anchorClusterKey)
  ) {
    throw new TypeError('rollback anchorClusterKey must be a canonical 64-hex key')
  }
  if (
    input.originClass !== undefined
    && !ORIGIN_CLASSES.has(input.originClass)
  ) {
    throw new TypeError('rollback originClass is not recognized')
  }
  if (
    input.fromOrdinal === undefined
    && input.toOrdinal === undefined
    && input.anchorClusterKey === undefined
    && input.originClass === undefined
  ) {
    throw new TypeError('rollbackCampaign requires at least one campaign predicate')
  }

  return {
    ...(input.fromOrdinal === undefined ? {} : { fromOrdinal: input.fromOrdinal }),
    ...(input.toOrdinal === undefined ? {} : { toOrdinal: input.toOrdinal }),
    ...(input.anchorClusterKey === undefined
      ? {}
      : { anchorClusterKey: input.anchorClusterKey }),
    ...(input.originClass === undefined ? {} : { originClass: input.originClass }),
  }
}

/** Content-addressed identity for one stable affected-set resolution horizon. */
export function rollbackReceiptId(
  kind: RollbackKind,
  keys: Readonly<Record<string, unknown>>,
  resolvedAtOrdinal: number,
): string {
  assertOrdinal(resolvedAtOrdinal, 'rollback resolvedAtOrdinal')
  return `rollback:${sha256hex(canonicalJson({ kind, keys, resolvedAtOrdinal }))}`
}

function canonicalBundles(knowledgeRoot: string): CanonicalRollbackBundle[] {
  const bundles: CanonicalRollbackBundle[] = []
  for (const entry of enumerateBundleDirs(knowledgeRoot)) {
    const loaded = loadBundle(entry.dir)
    if (loaded.kind !== 'loaded') continue
    bundles.push({
      recordId: asRecordId(loaded.bundle.manifest.id),
      product: entry.product,
      bundle: loaded.bundle,
    })
  }
  return bundles
}

function isCounterEvent(
  event: BundleOutcomeEvent,
): event is BundleOutcomeEvent & { type: RollbackCounterEvent['type'] } {
  return event.type === 'confirmed'
    || event.type === 'deprecated'
    || event.type === 'superseded'
    || event.type === 'promoted'
}

function publicAffectedSet(resolution: RollbackResolution): RollbackAffectedSet {
  return {
    mintedBundleIds: resolution.mintedBundles
      .map(({ recordId }) => recordId)
      .sort(compareText),
    counterEvents: resolution.counterEvents.map((event) => ({
      recordId: event.recordId,
      evidenceToken: event.evidenceToken,
      curationJobId: event.curationJobId,
      type: event.type,
    })),
  }
}

/** Resolve the canonical rollback preview without appending inverse events or touching indexes. */
export function resolveRollbackAffectedSet(
  input: ResolveRollbackAffectedSetInput,
): RollbackAffectedSet {
  return publicAffectedSet(
    'curationJobId' in input
      ? resolveCurationJob(input)
      : resolveCampaign(input),
  )
}

function counterEventsFor(
  bundles: readonly CanonicalRollbackBundle[],
  mintedIds: ReadonlySet<RecordId>,
  predicate: (bundle: CanonicalRollbackBundle, event: BundleOutcomeEvent) => boolean,
): ResolvedCounterEvent[] {
  const events: ResolvedCounterEvent[] = []
  for (const bundle of bundles) {
    // A minted bundle is inverted as a whole. Its initial confirmation is part of that Add,
    // Supersede, or MintUnknown effect and must not be independently retracted.
    if (mintedIds.has(bundle.recordId)) continue
    for (const event of bundle.bundle.events) {
      if (!isCounterEvent(event) || event.curationJobId.startsWith('rollback:')) continue
      if (!predicate(bundle, event)) continue
      events.push({
        recordId: bundle.recordId,
        evidenceToken: event.evidenceToken,
        curationJobId: event.curationJobId,
        type: event.type,
        event,
        product: bundle.product,
      })
    }
  }
  return events.sort((left, right) =>
    compareText(left.recordId, right.recordId)
    || compareText(left.evidenceToken, right.evidenceToken)
    || compareText(left.curationJobId, right.curationJobId)
    || compareText(left.type, right.type),
  )
}

function resolveCurationJob(input: RollbackCurationJobInput): RollbackResolution {
  assertBaseInput(input)
  if (input.curationJobId.trim() === '') {
    throw new TypeError('rollback curationJobId must be non-empty')
  }
  const bundles = canonicalBundles(input.knowledgeRoot)
  const mintedBundles = bundles.filter(({ bundle }) =>
    bundle.provenance.mode === 'run-linked'
    && bundle.provenance.curationJobId === input.curationJobId,
  )
  const mintedIds = new Set(mintedBundles.map(({ recordId }) => recordId))
  return {
    receiptId: rollbackReceiptId(
      'job',
      { curationJobId: input.curationJobId },
      input.resolvedAtOrdinal,
    ),
    mintedBundles,
    counterEvents: counterEventsFor(
      bundles,
      mintedIds,
      (_bundle, event) => event.curationJobId === input.curationJobId,
    ),
  }
}

function ordinalMatches(
  ordinal: number,
  input: RollbackCampaignInput,
): boolean {
  return (input.fromOrdinal === undefined || ordinal >= input.fromOrdinal)
    && (input.toOrdinal === undefined || ordinal <= input.toOrdinal)
}

function bundleAxesMatch(
  bundle: CanonicalRollbackBundle,
  input: RollbackCampaignInput,
): boolean {
  return (
    input.anchorClusterKey === undefined
    || supersessionKey(bundle.bundle.frontmatter.anchors.map(({ normalized }) => normalized))
      === input.anchorClusterKey
  ) && (
    input.originClass === undefined
    || bundle.bundle.frontmatter.originClass === input.originClass
  )
}

function resolveCampaign(input: RollbackCampaignInput): RollbackResolution {
  assertBaseInput(input)
  const keys = campaignKeys(input)
  const bundles = canonicalBundles(input.knowledgeRoot)
  const mintedBundles = bundles.filter((bundle) =>
    bundle.bundle.provenance.mode === 'run-linked'
    && bundle.bundle.provenance.sourceBuildOrdinal !== undefined
    && ordinalMatches(bundle.bundle.provenance.sourceBuildOrdinal, input)
    && bundleAxesMatch(bundle, input),
  )
  const mintedIds = new Set(mintedBundles.map(({ recordId }) => recordId))
  return {
    receiptId: rollbackReceiptId('campaign', keys, input.resolvedAtOrdinal),
    mintedBundles,
    counterEvents: counterEventsFor(
      bundles,
      mintedIds,
      (bundle, event) => ordinalMatches(event.buildOrdinal, input)
        && bundleAxesMatch(bundle, input),
    ),
  }
}

function bundleConfig(
  input: RollbackBaseInput,
  productKey: string,
): BundleStoreConfig {
  return {
    knowledgeRoot: input.knowledgeRoot,
    productKey,
    auditBaseDir: input.auditBaseDir,
    commitArtifacts: 'none',
    ...(input.writerAuthority === undefined
      ? {}
      : { writerLeaseId: input.writerAuthority.leaseId }),
  }
}

/**
 * Every inverse token binds the receipt, target, and exact effect key. The existing
 * (recordId, evidenceToken, curationJobId) append dedup therefore makes a repeated rollback a
 * byte-level noop while a different resolution horizon receives a different audit identity.
 */
function inverseEvidenceToken(
  receiptId: string,
  targetRecordId: RecordId,
  retractedKey: string,
) {
  return asEvidenceToken(sha256hex(canonicalJson({
    rollbackReceiptId: receiptId,
    targetRecordId,
    retractedKey,
  })))
}

function appendedOrThrow(
  outcome: ReturnType<typeof appendOutcomeEvent>,
  targetRecordId: RecordId,
): boolean {
  switch (outcome.kind) {
    case 'appended':
      return true
    case 'duplicate':
      return false
    case 'egress-blocked':
      throw new Error(
        `rollback inverse for ${targetRecordId} was blocked at committed egress`,
      )
    case 'not-found':
      throw new Error(`rollback target ${targetRecordId} disappeared during commit`)
  }
}

function appendRollbackEvent(
  input: RollbackBaseInput,
  product: string,
  targetRecordId: RecordId,
  event: BundleOutcomeEvent,
): boolean {
  fenceWriterAuthority(input)
  const appended = appendedOrThrow(
    appendOutcomeEvent(bundleConfig(input, product), targetRecordId, event),
    targetRecordId,
  )
  if (appended) input.hooks?.afterMutation?.('append', targetRecordId)
  return appended
}

function maintenanceCheckpoint(delta: Delta, targetRecordId: RecordId): AuthoredDeltaCheckpoint {
  const authorship = {
    path: 'deterministic-fallback' as const,
    executionContext: 'local-interactive' as const,
  }
  return {
    schemaVersion: 1,
    delta,
    neighborIds: [targetRecordId],
    preconditions: [],
    authorship,
  }
}

/**
 * RATIFICATION / Pitfall 8: inverse Deprecates are mechanical maintenance deltas with origin
 * `system`. They pass the ordinary deterministic disposition floor; `agent` would be downgraded
 * for an active target, while `user` would incorrectly make this lifecycle choice sovereign and
 * permanent. The disposed delta is then emitted through the canonical append + projection tail.
 */
function appendInverseDeprecate(
  input: RollbackBaseInput,
  resolution: RollbackResolution,
  target: CanonicalRollbackBundle,
): boolean {
  const delta: Extract<Delta, { kind: 'Deprecate' }> = {
    kind: 'Deprecate',
    origin: 'system',
    scope: target.bundle.frontmatter.scope,
    citedIds: [],
    targetId: target.recordId,
    reason: `rollback:${resolution.receiptId}`,
    authorship: {
      path: 'deterministic-fallback',
      executionContext: 'local-interactive',
    },
  }
  const targetAlreadyDeprecated = deriveBundleTrust(target.bundle).status === 'deprecated'
  const disposed = targetAlreadyDeprecated
    ? { kind: 'apply' as const, delta }
    : disposeDelta({
        delta,
        checkpoint: maintenanceCheckpoint(delta, target.recordId),
        profile: { mode: 'drain-to-active' },
        knowledgeRoot: input.knowledgeRoot,
        drainState: { supersedesSeenByAnchorKey: new Map() },
      })
  if (disposed.kind !== 'apply' || disposed.delta.kind !== 'Deprecate') {
    throw new Error(
      `rollback maintenance Deprecate for ${target.recordId} did not pass disposition`,
    )
  }

  return appendRollbackEvent(
    input,
    target.product,
    target.recordId,
    {
      type: 'deprecated',
      evidenceToken: inverseEvidenceToken(
        resolution.receiptId,
        target.recordId,
        'minted-bundle',
      ),
      curationJobId: resolution.receiptId,
      buildOrdinal: input.resolvedAtOrdinal,
      reason: disposed.delta.reason,
    },
  )
}

function appendRetraction(
  input: RollbackBaseInput,
  resolution: RollbackResolution,
  counter: ResolvedCounterEvent,
  targetEvidenceToken: string,
): boolean {
  const retractedKey = eventDedupKey({
    ...counter.event,
    evidenceToken: asEvidenceToken(targetEvidenceToken),
    curationJobId: counter.curationJobId,
  })
  return appendRollbackEvent(
    input,
    counter.product,
    counter.recordId,
    {
      type: 'retracted',
      evidenceToken: inverseEvidenceToken(
        resolution.receiptId,
        counter.recordId,
        retractedKey,
      ),
      curationJobId: resolution.receiptId,
      buildOrdinal: input.resolvedAtOrdinal,
      retractsEvidenceToken: asEvidenceToken(targetEvidenceToken),
      retractsCurationJobId: counter.curationJobId,
      rollbackReceiptId: resolution.receiptId,
    },
  )
}

function latestSurvivingLifecycleOrdinal(bundle: LoadedBundle): number {
  let latest = bundle.manifest.createdAtOrdinal
  for (const event of survivingOutcomeEvents(bundle.events)) {
    // Window-close and observation events never derive status, so they cannot gate causality.
    if (
      (event.type === 'promoted' || event.type === 'superseded' || event.type === 'deprecated')
      && event.buildOrdinal > latest
    ) {
      latest = event.buildOrdinal
    }
  }
  return latest
}

/**
 * Atomic strictly-later causal preflight (CR-02). Runs before ANY append or projection write:
 * every minted bundle in the resolved set must be invertible at input.resolvedAtOrdinal. A
 * bundle is admitted when its surviving fold status is already deprecated (the inverse
 * end-state already holds) or when its log already carries this receipt's exact
 * inverse-deprecate identity (byte replay). Otherwise the resolution must be strictly later
 * than the bundle's latest surviving lifecycle ordinal — at an equal ordinal the fold's fixed
 * status precedence makes the inverse deprecation lose, so success would be a lie. All
 * violators are collected first and reported in one throw; no partial mutation ever precedes it.
 */
function assertCausalResolution(
  input: RollbackBaseInput,
  resolution: RollbackResolution,
): void {
  const offenders: { recordId: RecordId; latestOrdinal: number }[] = []
  for (const minted of resolution.mintedBundles) {
    if (deriveBundleTrust(minted.bundle).status === 'deprecated') continue
    const inverseToken = inverseEvidenceToken(
      resolution.receiptId,
      minted.recordId,
      'minted-bundle',
    )
    const alreadyInverted = minted.bundle.events.some((event) =>
      event.evidenceToken === inverseToken
      && event.curationJobId === resolution.receiptId,
    )
    if (alreadyInverted) continue
    const latestOrdinal = latestSurvivingLifecycleOrdinal(minted.bundle)
    if (input.resolvedAtOrdinal > latestOrdinal) continue
    offenders.push({ recordId: minted.recordId, latestOrdinal })
  }
  if (offenders.length === 0) return
  throw new RollbackCausalityError(
    offenders.map(({ recordId }) => recordId).sort(compareText),
    1 + Math.max(...offenders.map(({ latestOrdinal }) => latestOrdinal)),
  )
}

function emitRollback(
  input: RollbackBaseInput,
  resolution: RollbackResolution,
): RollbackReport {
  assertCausalResolution(input, resolution)
  input.hooks?.afterResolution?.()

  let inverseCount = 0
  const touched = new Set<RecordId>()
  const restoredVictims = new Set<RecordId>()
  const retractedPromotions = new Set<RecordId>()
  const supportLossCandidates = new Map<RecordId, string>()

  for (const minted of resolution.mintedBundles) {
    if (appendInverseDeprecate(input, resolution, minted)) inverseCount += 1
    touched.add(minted.recordId)
  }

  for (const counter of resolution.counterEvents) {
    if (appendRetraction(
      input,
      resolution,
      counter,
      counter.evidenceToken,
    )) {
      inverseCount += 1
    }
    touched.add(counter.recordId)
    if (counter.type === 'confirmed') {
      supportLossCandidates.set(counter.recordId, counter.product)
    }

    if (counter.type === 'superseded') {
      const closeToken = asEvidenceToken(sha256hex(canonicalJson({
        token: counter.evidenceToken,
        event: 'window-close',
      })))
      if (appendRetraction(input, resolution, counter, closeToken)) {
        inverseCount += 1
      }
      restoredVictims.add(counter.recordId)
    }
  }

  /**
   * D-15/D-17 support-loss cascade: the V4 promotion-gate support
   * (`confirmedOutcomeEvidenceTokens` in assemblePromotionGateInput) is at least one surviving
   * confirmation, so a promotion whose last qualifying support this rollback removed is
   * retracted here under the same auditable receipt. The cascade fires only where THIS
   * rollback retracted a confirmed event and no confirmation survives: a promotion that never
   * had confirmed support was not deposed by this receipt and is left to the D-17 gate. If
   * surviving evidence still merits promotion, the gate re-grants it on the next drain;
   * authority is never left standing on support this rollback removed. Cascade targets are
   * exact eventDedupKey identities and every inverse is an append — existing outcome lines are
   * never rewritten.
   */
  const cascadeTargets = [...supportLossCandidates.entries()]
    .sort(([left], [right]) => compareText(left, right))
  if (cascadeTargets.length > 0) {
    const bundleDirs = enumerateBundleDirs(input.knowledgeRoot)
    for (const [recordId, product] of cascadeTargets) {
      const dir = bundleDirs.find((entry) => entry.dir.endsWith(`/${recordId}`))?.dir
      if (dir === undefined) {
        throw new Error(`rollback target ${recordId} disappeared during commit`)
      }
      const reloaded = loadBundle(dir)
      if (reloaded.kind !== 'loaded') {
        throw new Error(`rollback target ${recordId} disappeared during commit`)
      }
      const surviving = survivingOutcomeEvents(reloaded.bundle.events)
      const survivingPromoted = surviving.filter((event) => event.type === 'promoted')
      if (
        surviving.some((event) => event.type === 'confirmed')
        || survivingPromoted.length === 0
      ) {
        continue
      }
      for (const promoted of survivingPromoted) {
        const appended = appendRetraction(
          input,
          resolution,
          {
            recordId,
            evidenceToken: promoted.evidenceToken,
            curationJobId: promoted.curationJobId,
            type: 'promoted',
            event: promoted,
            product,
          },
          promoted.evidenceToken,
        )
        if (appended) inverseCount += 1
      }
      retractedPromotions.add(recordId)
    }
  }

  // Re-project every touched bundle even on duplicate replay. This is the same healing property
  // as commitCurationDelta's append-before-index recovery: canonical truth always wins.
  for (const recordId of [...touched].sort(compareText)) {
    fenceWriterAuthority(input)
    applyIndexDeltaForBundle({ knowledgeRoot: input.knowledgeRoot, bundleId: recordId })
    input.hooks?.afterMutation?.('projection', recordId)
  }

  return {
    receiptId: resolution.receiptId,
    inverseCount,
    restoredVictims: [...restoredVictims].sort(compareText),
    deprecatedBundles: resolution.mintedBundles
      .map(({ recordId }) => recordId)
      .sort(compareText),
    retractedPromotions: [...retractedPromotions].sort(compareText),
    affected: publicAffectedSet(resolution),
  }
}

/** Resolve and append the ratified inverse map for one curation job. */
export function rollbackCurationJob(input: RollbackCurationJobInput): RollbackReport {
  return emitRollback(input, resolveCurationJob(input))
}

/** Resolve and append the inverse map for an AND-composed provenance campaign. */
export function rollbackCampaign(input: RollbackCampaignInput): RollbackReport {
  return emitRollback(input, resolveCampaign(input))
}
