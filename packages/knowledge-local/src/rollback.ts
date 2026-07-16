/**
 * D-15 provenance-keyed rollback.
 *
 * Resolution is derived exclusively from canonical bundle files. Disposable records rows are
 * never consulted, so deleting or rebuilding the local index cannot change the affected set.
 * Task 2 attaches the append-only inverse emitter to this resolution authority.
 */
import { isAbsolute } from 'node:path'

import {
  asRecordId,
  canonicalJson,
  sha256hex,
  supersessionKey,
  type BundleOutcomeEvent,
  type OriginClass,
  type RecordId,
} from '@vostride/agent-qa-schema'

import { loadBundle } from './bundle-read.js'
import type { LoadedBundle } from './bundle-read.js'
import { enumerateBundleDirs } from './bundle-scan.js'

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

function emptyReport(resolution: RollbackResolution): RollbackReport {
  return {
    receiptId: resolution.receiptId,
    inverseCount: 0,
    restoredVictims: [],
    deprecatedBundles: [],
    affected: publicAffectedSet(resolution),
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

/** Resolve one curation job. Task 2 emits the ratified inverse map from this exact set. */
export function rollbackCurationJob(input: RollbackCurationJobInput): RollbackReport {
  return emptyReport(resolveCurationJob(input))
}

/** Resolve an AND-composed ordinal / anchor-cluster / origin-class campaign. */
export function rollbackCampaign(input: RollbackCampaignInput): RollbackReport {
  return emptyReport(resolveCampaign(input))
}
