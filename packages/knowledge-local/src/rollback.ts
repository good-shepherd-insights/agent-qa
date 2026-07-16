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
import type { AuthoredCheckpoint } from './curator/author-contract.js'
import { disposeDelta } from './curator/disposition.js'

export type RollbackKind = 'job' | 'campaign'

export interface RollbackCounterEvent {
  recordId: RecordId
  evidenceToken: string
  curationJobId: string
  type: 'confirmed' | 'deprecated' | 'superseded'
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
  /** Auditable exact resolution that drove inverse construction. */
  affected: RollbackAffectedSet
}

interface RollbackBaseInput {
  knowledgeRoot: string
  auditBaseDir: string
  resolvedAtOrdinal: number
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
  assertOrdinal(input.resolvedAtOrdinal, 'rollback resolvedAtOrdinal')
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

function maintenanceCheckpoint(delta: Delta, targetRecordId: RecordId): AuthoredCheckpoint {
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

  return appendedOrThrow(
    appendOutcomeEvent(
      bundleConfig(input, target.product),
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
    ),
    target.recordId,
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
  return appendedOrThrow(
    appendOutcomeEvent(
      bundleConfig(input, counter.product),
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
    ),
    counter.recordId,
  )
}

function emitRollback(
  input: RollbackBaseInput,
  resolution: RollbackResolution,
): RollbackReport {
  let inverseCount = 0
  const touched = new Set<RecordId>()
  const restoredVictims = new Set<RecordId>()

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

  // Re-project every touched bundle even on duplicate replay. This is the same healing property
  // as commitCurationDelta's append-before-index recovery: canonical truth always wins.
  for (const recordId of [...touched].sort(compareText)) {
    applyIndexDeltaForBundle({ knowledgeRoot: input.knowledgeRoot, bundleId: recordId })
  }

  return {
    receiptId: resolution.receiptId,
    inverseCount,
    restoredVictims: [...restoredVictims].sort(compareText),
    deprecatedBundles: resolution.mintedBundles
      .map(({ recordId }) => recordId)
      .sort(compareText),
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
