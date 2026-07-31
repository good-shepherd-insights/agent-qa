import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { KnowledgePort } from '@vostride/agent-qa-agent'
import {
  asEvidenceToken,
  canonicalJson,
  committedFileText,
  deriveEvidenceToken,
  evaluatePromotionGate,
  eventDedupKey,
  foldBundleTrust,
  sha256hex,
  survivingOutcomeEvents,
} from '@vostride/agent-qa-schema'
import type {
  BundleDraft,
  CanaryOutcome,
  CurationAuthorship,
  Delta,
  ExecutionContext,
  GuardrailPolicy,
  PromotionGateHoldReason,
  RecordId,
  ScreenState,
} from '@vostride/agent-qa-schema'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'

import { appendOutcomeEvent } from '../bundle-append.js'
import { deriveBundleTrust, loadBundle } from '../bundle-read.js'
import type { LoadedBundle } from '../bundle-read.js'
import type { BundleStoreConfig } from '../bundle-publish.js'
import {
  BundleTargetResolutionError,
  resolveProductQualifiedBundleDir,
} from '../bundle-scan.js'
import { readCurrentEpoch, readWriterLease } from '../lease/writer-lease.js'
import { claimedCandidateDir } from '../queue/queue-layout.js'
import {
  CURATION_QUEUE_SCHEMA_VERSION,
  artifactFreeCaptureReceipt,
  buildCurationCandidateAddressFields,
  candidateContentAddress,
} from '../queue/queue-payload.js'
import type {
  CurationCandidateAddressFields,
  CurationCandidatePayload,
} from '../queue/queue-payload.js'
import { resolveDispositionProfile } from './author-contract.js'
import type { AuthoredDeltaCheckpoint, DispositionProfile } from './author-contract.js'
import {
  applyIndexDeltaForBundle,
  assemblePromotionGateInput,
  commitCurationDelta,
  derivePromotedEvidenceToken,
} from './commit.js'
import { canaryOutcomeObservationId } from './disposition.js'
import type {
  CommitCurationDependencies,
  CommitCurationJob,
  CommitCurationOutcome,
} from './commit.js'

/**
 * CR-02 takeover barriers. Test-only seams naming the three points at which a canary flow is
 * about to make canonical state durable; production callers omit them.
 */
export interface CanaryAuthorityHooks {
  /** Before the negative arm's contradicted append. */
  beforeNegativeAppend?: () => void
  /** Before the promoted append that finalizes a positive canary. */
  beforePromotionAppend?: () => void
  /** Before the negative arm's index projection. */
  beforeIndexProjection?: () => void
}

export interface CreateLocalKnowledgeStoreConfig {
  knowledgeRoot: string
  auditBaseDir: string
  executionContext: ExecutionContext
  /** The holder's fresh lease epoch. Defaults to a fresh disk read for composition roots. */
  epoch?: number
  /**
   * The holder's lease id, paired with `epoch` and defaulting the same way.
   *
   * CR-01: canonical mutation now requires the exact live identity, so this bridge can no longer
   * synthesize one. When the caller supplies nothing the currently published holder is adopted;
   * if no holder is published the fence refuses by name instead of laundering a fabricated id.
   */
  writerLeaseId?: string
  policy?: GuardrailPolicy
  /** Port calls lack a run ordinal; callers with run context should supply it. */
  sourceBuildOrdinal?: number
  sourceRunId?: string
  screenStates?: readonly ScreenState[]
  /** Fault-injection seam; production callers must omit it. */
  canaryAuthorityHooks?: CanaryAuthorityHooks
  operations?: {
    /** Test/chaos seam; production always uses commitCurationDelta. */
    commitCurationDelta?: typeof commitCurationDelta
  }
}

/**
 * @deprecated `recordCanaryOutcome` is implemented. The exported class remains only so code
 * compiled against the pre-380 package surface does not lose its named import.
 */
export class KnowledgeStoreNotImplementedError extends Error {
  readonly operation: 'recordCanaryOutcome'

  constructor(operation: 'recordCanaryOutcome', _retiredOwnerPhase?: 380) {
    super(`${operation} compatibility error is retired because the operation is implemented`)
    this.name = 'KnowledgeStoreNotImplementedError'
    this.operation = operation
  }
}

export type KnowledgePromotionErrorReason =
  | PromotionGateHoldReason
  | 'propose-only'
  | 'not-found'
  | 'egress-blocked'

/** Typed refusal for the evidence-gated promote port; callers never receive a force path. */
export class KnowledgePromotionError extends Error {
  readonly candidateId: RecordId
  readonly reason: KnowledgePromotionErrorReason
  readonly detections?: readonly { label: string; detector: string }[]

  constructor(
    candidateId: RecordId,
    reason: KnowledgePromotionErrorReason,
    detections?: readonly { label: string; detector: string }[],
  ) {
    super(`knowledge promotion refused for ${candidateId}: ${reason}`)
    this.name = 'KnowledgePromotionError'
    this.candidateId = candidateId
    this.reason = reason
    if (detections !== undefined) this.detections = detections
  }
}

export class KnowledgeCommitError extends Error {
  readonly outcome: CommitCurationOutcome

  constructor(outcome: CommitCurationOutcome) {
    super(`local knowledge commit did not complete: ${outcome.kind}`)
    this.name = 'KnowledgeCommitError'
    this.outcome = outcome
  }
}

/** Typed WR-02 refusal for procedure drafts that require evidence this port cannot carry. */
export class KnowledgeUnsupportedDeltaError extends Error {
  readonly deltaKind: Delta['kind']
  readonly reason: 'procedure-evidence-unsupported'

  constructor(deltaKind: Delta['kind']) {
    super(
      `local KnowledgePort cannot author ${deltaKind} procedure drafts: the public port carries no durable trajectory/capture evidence; use the evidence-bearing curation queue/drainer`,
    )
    this.name = 'KnowledgeUnsupportedDeltaError'
    this.deltaKind = deltaKind
    this.reason = 'procedure-evidence-unsupported'
  }
}

interface ResolvedTruth {
  id: RecordId
  bundle: LoadedBundle
  bundleDir: string
  product: string
  observedStatus: string
  observedOrdinal: number
}

function resolveTruth(knowledgeRoot: string, id: RecordId): ResolvedTruth | undefined {
  let target: ReturnType<typeof resolveProductQualifiedBundleDir>
  try {
    target = resolveProductQualifiedBundleDir({ knowledgeRoot, recordId: id })
  } catch (error) {
    if (
      error instanceof BundleTargetResolutionError
      && error.reason === 'not-found'
    ) return undefined
    throw error
  }
  const loaded = loadBundle(target.dir)
  if (loaded.kind !== 'loaded' || loaded.bundle.manifest.id !== id) return undefined
  const trust = deriveBundleTrust(loaded.bundle)
  return {
    id,
    bundle: loaded.bundle,
    bundleDir: target.dir,
    product: target.product,
    observedStatus: trust.status,
    observedOrdinal: trust.validity.closedAtOrdinal ?? trust.validity.openedAtOrdinal,
  }
}

function targetId(delta: Delta): RecordId | undefined {
  switch (delta.kind) {
    case 'Confirm':
    case 'Deprecate':
      return delta.targetId
    case 'Supersede':
      return delta.victimId
    case 'MintUnknown':
      return delta.conflict.recordIds[0]
    case 'Add':
    case 'Noop':
      return undefined
  }
}

function draft(delta: Delta): BundleDraft | undefined {
  if (delta.kind === 'Add') return delta.bundle
  if (delta.kind === 'Supersede') return delta.newBundle
  return undefined
}

function syntheticEvidenceToken(delta: Delta): string {
  if (delta.kind === 'Confirm' || delta.kind === 'Supersede') return delta.evidenceToken
  return sha256hex(canonicalJson({ delta, source: 'knowledge-port' }))
}

function addressFields(
  config: CreateLocalKnowledgeStoreConfig,
  delta: Delta,
  target: ResolvedTruth | undefined,
  buildOrdinal: number,
): CurationCandidateAddressFields {
  const authored = draft(delta)
  const kind = authored?.kind ?? target?.bundle.frontmatter.kind ?? 'unknown'
  const subtype = authored?.subtype ?? target?.bundle.frontmatter.subtype
  const anchors = authored?.anchors
    ?? target?.bundle.frontmatter.anchors.map(({ raw }) => raw)
    ?? [{ t: 'error' as const, message: `unresolved knowledge-port ${delta.kind}` }]
  return buildCurationCandidateAddressFields({
    schemaVersion: CURATION_QUEUE_SCHEMA_VERSION,
    sourceRunId: config.sourceRunId ?? 'knowledge-port',
    scope: delta.scope,
    buildOrdinal,
    executionContext: config.executionContext,
    secretFlagged: false,
    injectionFlagged: false,
    kind,
    ...(kind === 'fact'
      ? { subtype: subtype ?? 'content' }
      : {}),
    anchors,
    summarySeed: authored?.summary ?? target?.bundle.summary ?? `KnowledgePort ${delta.kind}`,
    bodySeed: authored?.body ?? target?.bundle.body ?? canonicalJson(delta),
    distilledObservations: [],
    evidenceToken: syntheticEvidenceToken(delta),
    attributingObservationId: `knowledge-port:${sha256hex(canonicalJson(delta))}`,
    artifactInventory: [],
    captureReceipt: artifactFreeCaptureReceipt(),
    emittedAt: '1970-01-01T00:00:00.000Z',
  })
}

function syntheticAuthorship(
  config: CreateLocalKnowledgeStoreConfig,
  delta: Delta,
): CurationAuthorship {
  return delta.authorship ?? {
    path: 'llm',
    model: { id: 'knowledge-port-bridge' },
    executionContext: config.executionContext,
  }
}

/** Path-safe stand-in used only when no holder is published; the fence then refuses by name. */
const UNHELD_BRIDGE_LEASE_ID = 'knowledge-port'

function bridgeLeaseId(config: CreateLocalKnowledgeStoreConfig): string {
  if (config.writerLeaseId !== undefined) return config.writerLeaseId
  const current = readWriterLease(config.knowledgeRoot)
  return current.kind === 'parsed' ? current.lease.leaseId : UNHELD_BRIDGE_LEASE_ID
}

function bridgeDelta(
  config: CreateLocalKnowledgeStoreConfig,
  delta: Delta,
): { job: CommitCurationJob; checkpoint: AuthoredDeltaCheckpoint } {
  const neighbors = delta.citedIds
    .map((id) => resolveTruth(config.knowledgeRoot, id))
    .filter((truth): truth is ResolvedTruth => truth !== undefined)
  const target = targetId(delta)
  const targetTruth = target === undefined
    ? undefined
    : neighbors.find(({ id }) => id === target) ?? resolveTruth(config.knowledgeRoot, target)
  const observedOrdinals = [...neighbors, ...(targetTruth === undefined ? [] : [targetTruth])]
    .map(({ observedOrdinal }) => observedOrdinal)
  const buildOrdinal = config.sourceBuildOrdinal
    ?? (observedOrdinals.length === 0 ? 0 : Math.max(...observedOrdinals) + 1)
  const fields = addressFields(config, delta, targetTruth, buildOrdinal)
  const candidateId = candidateContentAddress(fields)
  const leaseId = bridgeLeaseId(config)
  const candidateDir = claimedCandidateDir(config.knowledgeRoot, leaseId, candidateId)
  const artifactsDir = join(candidateDir, 'artifacts')
  const payload: CurationCandidatePayload = { candidateId, ...fields }
  mkdirSync(artifactsDir, { recursive: true })
  writeFileSync(join(candidateDir, 'payload.json'), committedFileText(payload), 'utf8')

  const authorship = syntheticAuthorship(config, delta)
  return {
    job: {
      kind: 'claimed',
      candidateId,
      leaseId,
      payload,
      candidateDir,
      payloadPath: join(candidateDir, 'payload.json'),
      artifactsDir,
      targetProducts: Object.fromEntries(
        [...neighbors, ...(targetTruth === undefined ? [] : [targetTruth])]
          .map((truth) => [truth.id, truth.product]),
      ),
      ...(config.screenStates === undefined ? {} : { screenStates: config.screenStates }),
    },
    checkpoint: {
      schemaVersion: 1,
      delta,
      neighborIds: neighbors.map(({ id }) => id),
      preconditions: neighbors.map(({ id, observedStatus, observedOrdinal }) => ({
        recordId: id,
        observedStatus,
        observedOrdinal,
      })),
      authorship,
    },
  }
}

function completed(outcome: CommitCurationOutcome): boolean {
  return outcome.kind === 'applied'
    || outcome.kind === 'downgraded'
    || outcome.kind === 'converted-confirm'
    || outcome.kind === 'noop'
    || (outcome.kind === 'withheld' && outcome.reason === 'injection-restricted')
}

function promotionBuildOrdinal(
  config: CreateLocalKnowledgeStoreConfig,
  bundle: LoadedBundle,
): number {
  return config.sourceBuildOrdinal ?? Math.max(
    bundle.frontmatter.createdAtOrdinal,
    ...bundle.events.map(({ buildOrdinal }) => buildOrdinal),
  )
}

function expectedPromotionHold(error: unknown): error is KnowledgePromotionError {
  return error instanceof KnowledgePromotionError
    && error.reason !== 'not-found'
    && error.reason !== 'egress-blocked'
}

function unreachableCanaryOutcome(outcome: never): never {
  throw new TypeError(`unsupported canary outcome: ${canonicalJson(outcome)}`)
}

/**
 * Realizes the four-method agent port over one mutation function. D-08 propose-only is a
 * disposition profile inside commitCurationDelta, never a second mutation path. Because the port
 * carries bare deltas, this bridge materializes the smallest queue/checkpoint envelope and resolves
 * cited neighbor truth from canonical bundles before entering disposition.
 */
export function createLocalKnowledgeStore(
  config: CreateLocalKnowledgeStoreConfig,
): KnowledgePort {
  const operation = config.operations?.commitCurationDelta ?? commitCurationDelta
  const policy = config.policy ?? loadGuardrailPolicy(defaultGuardrailPolicyInput)

  async function commitWithProfile(
    deltas: Delta[],
    profile: DispositionProfile,
  ): Promise<void> {
    const drainState: CommitCurationDependencies['drainState'] = {
      supersedesSeenByAnchorKey: new Map(),
    }
    for (const delta of deltas) {
      /**
       * WR-02 / D-02: this bridge intentionally has no durable procedure observations or
       * capture artifacts. Disposition would therefore return a guaranteed procedure Noop,
       * which completed() would otherwise launder into a resolved void. Reject before
       * bridgeDelta materializes a claimed queue envelope; evidence carriage remains M4 scope.
       */
      if (draft(delta)?.kind === 'procedure') {
        throw new KnowledgeUnsupportedDeltaError(delta.kind)
      }
      const { job, checkpoint } = bridgeDelta(config, delta)
      const outcome = operation(
        {
          knowledgeRoot: config.knowledgeRoot,
          auditBaseDir: config.auditBaseDir,
          epoch: config.epoch ?? readCurrentEpoch(config.knowledgeRoot),
          profile,
          drainState,
          policy,
        },
        job,
        checkpoint,
      )
      if (!completed(outcome)) throw new KnowledgeCommitError(outcome)
    }
  }

  const store: KnowledgePort = {
    proposeDeltas(deltas: Delta[]): Promise<void> {
      return commitWithProfile(deltas, { mode: 'propose-only' })
    },
    commit(deltas: Delta[]): Promise<void> {
      return commitWithProfile(deltas, resolveDispositionProfile(config.executionContext))
    },
    async recordCanaryOutcome(outcome: CanaryOutcome): Promise<void> {
      const resolved = resolveTruth(config.knowledgeRoot, outcome.candidateId)
      if (resolved === undefined) {
        throw new KnowledgePromotionError(outcome.candidateId, 'not-found')
      }

      const observationId = canaryOutcomeObservationId(outcome)
      const evidenceToken = deriveEvidenceToken({
        attributingObservationId: observationId,
        anchor: outcome.exercisedAnchor,
        buildOrdinal: outcome.buildOrdinal,
      })

      switch (outcome.runOutcome) {
        case 'positive': {
          // D-22: the LLM never re-enters candidate lifecycle disposition. The one commit path
          // appends the replay-safe Confirm before the existing promotion gate re-evaluates it.
          const confirm: Extract<Delta, { kind: 'Confirm' }> = {
            kind: 'Confirm',
            origin: 'system',
            scope: resolved.bundle.frontmatter.scope,
            citedIds: [outcome.candidateId],
            targetId: outcome.candidateId,
            evidenceToken,
            authorship: {
              path: 'deterministic-fallback',
              executionContext: config.executionContext,
            },
          }
          await store.commit([confirm])
          try {
            await store.promote(outcome.candidateId)
          } catch (error) {
            // A gate hold or propose-only posture means "not yet". The durable Confirm remains
            // valid evidence and must not turn a crash replay into a permanently failing job.
            if (!expectedPromotionHold(error)) throw error
          }
          return
        }
        case 'negative': {
          // D-22: negative canary evidence joins the canonical outcome log and therefore reuses
          // the existing deterministic trust/status fold; no parallel lifecycle logic is added.
          const appendConfig: BundleStoreConfig = {
            knowledgeRoot: config.knowledgeRoot,
            productKey: resolved.product,
            auditBaseDir: config.auditBaseDir,
            commitArtifacts: 'none',
            writerLeaseId: 'knowledge-port',
            policy,
          }
          config.canaryAuthorityHooks?.beforeNegativeAppend?.()
          const appended = appendOutcomeEvent(appendConfig, outcome.candidateId, {
            type: 'contradicted',
            evidenceToken,
            curationJobId: observationId,
            buildOrdinal: outcome.buildOrdinal,
            observationOrdinal: outcome.stepIndex,
            observationId,
            origin: 'agent-verified',
          })
          if (appended.kind === 'egress-blocked') {
            throw new KnowledgePromotionError(
              outcome.candidateId,
              appended.kind,
              appended.detections,
            )
          }
          if (appended.kind === 'not-found') {
            throw new KnowledgePromotionError(outcome.candidateId, appended.kind)
          }
          config.canaryAuthorityHooks?.beforeIndexProjection?.()
          applyIndexDeltaForBundle({
            knowledgeRoot: config.knowledgeRoot,
            bundleId: outcome.candidateId,
            product: resolved.product,
          })
          return
        }
        default:
          return unreachableCanaryOutcome(outcome.runOutcome)
      }
    },
    async promote(candidateId: RecordId): Promise<void> {
      /**
       * D-17: later callers add evidence first, then ask this same gate to judge it. The
       * execution posture is deliberately resolved at call time, and no override input exists.
       */
      if (resolveDispositionProfile(config.executionContext).mode === 'propose-only') {
        throw new KnowledgePromotionError(candidateId, 'propose-only')
      }

      const resolved = resolveTruth(config.knowledgeRoot, candidateId)
      if (resolved === undefined) {
        throw new KnowledgePromotionError(candidateId, 'not-found')
      }
      const appendConfig: BundleStoreConfig = {
        knowledgeRoot: config.knowledgeRoot,
        productKey: resolved.product,
        auditBaseDir: config.auditBaseDir,
        commitArtifacts: 'none',
        writerLeaseId: 'knowledge-port',
        policy,
      }
      if (resolved.observedStatus === 'active') {
        /**
         * CR-01: the active fast path is a gate re-validation, never a bypass. A crash
         * between a rollback's confirmation retraction and its Plan-23 promotion cascade
         * leaves canonical active-with-zero-support until replay; attesting success over
         * that stale authority would launder a rolled-back promotion. The same pure gate
         * (D-17) is re-evaluated over the promoted-set-aside status: the status the record
         * would hold if its promoted authority were set aside.
         */
        const gateInput = assemblePromotionGateInput({
          knowledgeRoot: config.knowledgeRoot,
          bundleDir: resolved.bundleDir,
          bundle: resolved.bundle,
        })
        const setAside = foldBundleTrust(
          survivingOutcomeEvents(resolved.bundle.events)
            .filter(({ type }) => type !== 'promoted'),
          {
            originClass: resolved.bundle.frontmatter.originClass,
            evidenceIncomplete: resolved.bundle.manifest.evidenceIncomplete,
            createdAtOrdinal: resolved.bundle.frontmatter.createdAtOrdinal,
          },
        )
        const revalidated = evaluatePromotionGate({ ...gateInput, status: setAside.status })
        if (revalidated.verdict === 'promote') {
          // Still authorized: heal append-before-projection retries while preserving the
          // already-active noop contract byte-for-byte.
          applyIndexDeltaForBundle({
            knowledgeRoot: config.knowledgeRoot,
            bundleId: candidateId,
            product: resolved.product,
          })
          return
        }
        // Stale authority: append-only retraction of every surviving promoted event under a
        // deterministic replay-safe identity, then re-project and refuse with the gate's
        // hold reason. History is never rewritten; replayed heals dedup to no-ops.
        const survivingPromoted = survivingOutcomeEvents(resolved.bundle.events)
          .filter(({ type }) => type === 'promoted')
        const healReceiptId = `promote-heal:${candidateId}`
        for (const promoted of survivingPromoted) {
          const appended = appendOutcomeEvent(appendConfig, candidateId, {
            type: 'retracted',
            evidenceToken: asEvidenceToken(sha256hex(canonicalJson({
              healedPromotedEventKey: eventDedupKey(promoted),
              candidateId,
            }))),
            curationJobId: healReceiptId,
            buildOrdinal: promotionBuildOrdinal(config, resolved.bundle),
            retractsEvidenceToken: promoted.evidenceToken,
            retractsCurationJobId: promoted.curationJobId,
            rollbackReceiptId: healReceiptId,
          })
          if (appended.kind === 'egress-blocked') {
            throw new KnowledgePromotionError(candidateId, appended.kind, appended.detections)
          }
          if (appended.kind === 'not-found') {
            throw new KnowledgePromotionError(candidateId, appended.kind)
          }
        }
        applyIndexDeltaForBundle({
          knowledgeRoot: config.knowledgeRoot,
          bundleId: candidateId,
          product: resolved.product,
        })
        throw new KnowledgePromotionError(candidateId, revalidated.reason)
      }

      const gate = evaluatePromotionGate(assemblePromotionGateInput({
        knowledgeRoot: config.knowledgeRoot,
        bundleDir: resolved.bundleDir,
        bundle: resolved.bundle,
      }))
      if (gate.verdict === 'hold') {
        throw new KnowledgePromotionError(candidateId, gate.reason)
      }
      config.canaryAuthorityHooks?.beforePromotionAppend?.()
      const appended = appendOutcomeEvent(appendConfig, candidateId, {
        type: 'promoted',
        evidenceToken: derivePromotedEvidenceToken(candidateId),
        curationJobId: `promote:${candidateId}`,
        buildOrdinal: promotionBuildOrdinal(config, resolved.bundle),
      })
      if (appended.kind === 'egress-blocked') {
        throw new KnowledgePromotionError(candidateId, appended.kind, appended.detections)
      }
      if (appended.kind === 'not-found') {
        throw new KnowledgePromotionError(candidateId, appended.kind)
      }
      applyIndexDeltaForBundle({
        knowledgeRoot: config.knowledgeRoot,
        bundleId: candidateId,
        product: resolved.product,
      })
    },
  }
  return store
}
