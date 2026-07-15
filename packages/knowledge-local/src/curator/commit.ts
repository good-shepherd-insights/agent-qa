import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import {
  asEvidenceToken,
  canonicalJson,
  computeStepSequenceSignature,
  renderEmbeddingInput,
  sha256hex,
} from '@vostride/agent-qa-schema'
import type {
  Anchor,
  BundleDiscriminant,
  BundleDraft,
  BundleOutcomeEvent,
  BundleRelation,
  Delta,
  GuardrailPolicy,
  RecordId,
  ScreenState,
} from '@vostride/agent-qa-schema'

import { copyArtifacts } from '../artifact-copy.js'
import type {
  ArtifactCopyInput,
  ArtifactCopyResult,
  SkippedArtifact,
} from '../artifact-copy.js'
import {
  appendOutcomeEvent,
  appendOutcomeEventWithEnrichment,
  appendRelation,
} from '../bundle-append.js'
import { renderBundleParts } from '../bundle-parts.js'
import type { RenderBundlePartsInput } from '../bundle-parts.js'
import { publishBundle } from '../bundle-publish.js'
import type {
  BundleStoreConfig,
  PublishBundleInput,
  PublishBundleOutcome,
} from '../bundle-publish.js'
import { enumerateBundleDirs } from '../bundle-scan.js'
import { projectBundleIndexRow } from '../index-rebuild.js'
import { clearCommitIntent, writeCommitIntent } from '../journal/intent-journal.js'
import { assertEpochCurrent } from '../lease/writer-lease.js'
import type { ClaimedCurationJob } from '../queue/curation-queue.js'
import { writeJobState } from '../queue/job-state.js'
import type { AuthoredCheckpoint, DispositionProfile } from './author-contract.js'
import { disposeDelta } from './disposition.js'
import type { DispositionDrainState, RelationIntent } from './disposition.js'
import { assessEmbeddingInput } from './embed-gate.js'
import { assertRestrictedFallbackDelta } from './fallback.js'

type CheckpointDraft = BundleDraft & { needsEnrichment?: true }

export interface CommitCurationJob extends ClaimedCurationJob {
  screenStates?: readonly ScreenState[]
}

export interface CommitCurationDependencies {
  knowledgeRoot: string
  auditBaseDir: string
  epoch: number
  profile: DispositionProfile
  drainState: DispositionDrainState
  policy: GuardrailPolicy
  hooks?: {
    /** Test/chaos seam immediately after the durable intent rename. */
    afterIntentWritten?: () => void
    /** Test/chaos seam while the complete bundle is staged but still reader-invisible. */
    beforePublishRename?: () => void
    /** Test/chaos seam after each durable mutable-file replacement. */
    afterMutableReplacement?: (targetRelPath: string) => void
    /** Test/chaos seam after a fresh bundle publish and before its index projection. */
    afterBundlePublished?: (bundleId: RecordId) => void
    /** Test/chaos seam after the index transaction and before intent removal. */
    afterIndexApplied?: (bundleId: RecordId) => void
  }
  operations?: {
    /** Test/chaos seam; production always uses the canonical publisher. */
    publishBundle?: typeof publishBundle
  }
}

interface CommittedBundleResult {
  bundleId: RecordId
  bundleDir: string
  deltaKind: Delta['kind']
}

export type CommitCurationOutcome =
  | ({ kind: 'applied' } & CommittedBundleResult)
  | ({ kind: 'downgraded'; reason: string } & CommittedBundleResult)
  | ({ kind: 'converted-confirm' } & CommittedBundleResult)
  | {
      kind: 'withheld'
      reason: 'egress-blocked' | 'injection-restricted'
      detections?: readonly { label: string; detector: string }[]
      bundleId?: RecordId
      bundleDir?: string
    }
  | { kind: 'abandoned-stale-epoch'; observedEpoch: number }
  | {
      kind: 'failed'
      reason: 'restricted-fallback' | 'identity-collision' | 'append-failed'
      collisionReason?: Extract<
        PublishBundleOutcome,
        { kind: 'identity-collision' }
      >['reason']
    }
  | { kind: 'noop'; reason: string }
  | { kind: 'requeue-resynthesis'; reason: string }

export interface ApplyIndexDeltaForBundleInput {
  knowledgeRoot: string
  bundleId: string
  lexicalInput?: string
  suppressDense?: boolean
}

/** Shared Plan 378-10 projection authority used by commit and journal reconciliation. */
export function applyIndexDeltaForBundle(input: ApplyIndexDeltaForBundleInput): void {
  projectBundleIndexRow(input)
}

/** Recovery alias deliberately delegates to the same projection unit as the live tail. */
export function deriveIndexRowFromBundle(input: ApplyIndexDeltaForBundleInput): void {
  projectBundleIndexRow(input)
}

function staleEpoch(
  deps: CommitCurationDependencies,
): Extract<CommitCurationOutcome, { kind: 'abandoned-stale-epoch' }> | undefined {
  const current = assertEpochCurrent({
    knowledgeRoot: deps.knowledgeRoot,
    epoch: deps.epoch,
  })
  return current.current
    ? undefined
    : { kind: 'abandoned-stale-epoch', observedEpoch: current.observedEpoch }
}

function originClass(delta: Delta): RenderBundlePartsInput['originClass'] {
  switch (delta.origin) {
    case 'user':
      return 'user'
    case 'import':
      return 'import'
    case 'agent':
    case 'system':
      return 'agent-verified'
  }
}

function elementRef(anchors: readonly Anchor[]): { role: string; name: string } {
  const element = anchors.find(
    (anchor): anchor is Extract<Anchor, { t: 'el' }> => anchor.t === 'el',
  )
  if (element !== undefined) return { role: element.role, name: element.name }
  const primary = anchors[0]!
  return { role: primary.t, name: canonicalJson(primary) }
}

function discriminant(
  draft: BundleDraft,
  delta: Delta,
  stepKeys: readonly string[],
): BundleDiscriminant {
  switch (draft.kind) {
    case 'fact': {
      if (draft.subtype === undefined) throw new TypeError('fact commit requires a subtype')
      if (draft.subtype === 'measurement') {
        return {
          kind: 'fact',
          subtype: 'measurement',
          metricKey: canonicalJson(draft.anchors),
        }
      }
      return { kind: 'fact', subtype: draft.subtype, elementRef: elementRef(draft.anchors) }
    }
    case 'procedure': {
      const flow = draft.anchors.find(
        (anchor): anchor is Extract<Anchor, { t: 'flow' }> => anchor.t === 'flow',
      )
      return {
        kind: 'procedure',
        flowName: flow?.name ?? canonicalJson(draft.anchors[0]),
        stepSignature: computeStepSequenceSignature(stepKeys),
      }
    }
    case 'caution': {
      const error = draft.anchors.find(
        (anchor): anchor is Extract<Anchor, { t: 'error' }> => anchor.t === 'error',
      )
      return { kind: 'caution', errorKey: error?.message ?? canonicalJson(draft.anchors[0]) }
    }
    case 'unknown':
      return {
        kind: 'unknown',
        conflictRecordIds: delta.kind === 'MintUnknown' ? delta.conflict.recordIds : delta.citedIds,
      }
    case 'policy':
      return { kind: 'policy', ruleKey: canonicalJson(draft.anchors[0]) }
  }
}

function syntheticDraft(job: CommitCurationJob): BundleDraft {
  return {
    kind: job.payload.kind,
    ...(job.payload.subtype === undefined ? {} : { subtype: job.payload.subtype }),
    anchors: [...job.payload.anchors],
    scope: job.payload.scope,
    summary: job.payload.summarySeed,
    body: job.payload.bodySeed,
    distilledEvidenceRef: {
      id: `curation-candidate-${job.candidateId}`,
      sha: job.candidateId,
    },
    originStage: 'run-curation',
  }
}

function draftForDelta(delta: Delta, job: CommitCurationJob): CheckpointDraft | undefined {
  if (delta.kind === 'Add') return delta.bundle
  if (delta.kind === 'Supersede') return delta.newBundle
  if (delta.kind === 'MintUnknown') return syntheticDraft(job)
  return undefined
}

function stepKeys(job: CommitCurationJob): string[] {
  return [...job.payload.distilledObservations]
    .sort((left, right) => left.step.ordinal - right.step.ordinal)
    .map((observation) => observation.step.naturalKey)
}

function evidenceMarkdown(job: CommitCurationJob): string {
  const lines = job.payload.distilledObservations.map(
    (observation) => `- ${canonicalJson(observation)}`,
  )
  return `${lines.length === 0 ? job.payload.bodySeed : lines.join('\n')}\n`
}

function observationOrdinal(job: CommitCurationJob): number | undefined {
  return job.payload.distilledObservations[0]?.observedAtOrdinal
}

function confirmedEvent(
  job: CommitCurationJob,
  delta: Delta,
  evidenceToken = job.payload.evidenceToken,
): BundleOutcomeEvent {
  return {
    type: 'confirmed',
    evidenceToken: asEvidenceToken(evidenceToken),
    curationJobId: job.candidateId,
    buildOrdinal: job.payload.buildOrdinal,
    observationId: job.payload.attributingObservationId,
    ...(observationOrdinal(job) === undefined
      ? {}
      : { observationOrdinal: observationOrdinal(job) }),
    origin: originClass(delta),
  }
}

function relations(
  intents: readonly RelationIntent[],
  delta: Delta,
  job: CommitCurationJob,
): BundleRelation[] {
  const values: BundleRelation[] = intents.map((intent) => ({
    type: intent.type,
    targetId: intent.targetId,
    addedAtOrdinal: job.payload.buildOrdinal,
    curationJobId: job.candidateId,
  }))
  if (delta.kind === 'Supersede') {
    values.unshift({
      type: 'supersedes',
      targetId: delta.victimId,
      addedAtOrdinal: job.payload.buildOrdinal,
      curationJobId: job.candidateId,
    })
  }
  return values
}

function artifactInputs(job: CommitCurationJob): ArtifactCopyInput[] {
  return job.payload.artifactInventory.map((artifact) => ({
    ref: {
      id: `${job.candidateId}:${artifact.stepIndex}:${artifact.sha256}`,
      sha: artifact.sha256,
    },
    sourcePath: join(job.candidateDir, artifact.relativePath),
    stepIndex: artifact.stepIndex,
    role: artifact.role,
    originalName: artifact.originalName,
  }))
}

function receiptInteractionMatchesRegion(
  region: CommitCurationJob['payload']['captureReceipt']['regions'][number],
  interaction: CommitCurationJob['payload']['captureReceipt']['interactions'][number],
): boolean {
  return region.stepIndex === interaction.stepIndex
    && (interaction.elementRef === undefined || interaction.elementRef === region.elementRef)
}

function captureSafePayloadError(): TypeError {
  return new TypeError('claimed job has an inconsistent capture-safe payload')
}

/** Defense-in-depth over value-free queue facts; raw capture classification stays queue-owned. */
function assertCaptureSafePayload(job: CommitCurationJob): void {
  const { artifactInventory, captureReceipt } = job.payload
  const interactedBlacklistedSteps = new Set(
    captureReceipt.regions
      .filter((region) =>
        captureReceipt.interactions.some((interaction) =>
          receiptInteractionMatchesRegion(region, interaction),
        ),
      )
      .map((region) => region.stepIndex),
  )
  const declaredDescriptorRefs = new Set<string>()

  for (const omission of captureReceipt.omissions) {
    if (
      !interactedBlacklistedSteps.has(omission.stepIndex)
      || omission.role === 'dom-snapshot'
      || omission.role === 'ax-snapshot'
      || declaredDescriptorRefs.has(omission.ref)
    ) {
      throw captureSafePayloadError()
    }
    declaredDescriptorRefs.add(omission.ref)
  }

  for (const redaction of captureReceipt.redactions) {
    const safeArtifact = artifactInventory.find((artifact) =>
      artifact.sha256 === redaction.safeSha256
      && artifact.stepIndex === redaction.stepIndex
      && artifact.role === redaction.role
      && artifact.originalName === redaction.originalName,
    )
    if (
      !interactedBlacklistedSteps.has(redaction.stepIndex)
      || safeArtifact === undefined
      || declaredDescriptorRefs.has(redaction.ref)
    ) {
      throw captureSafePayloadError()
    }
    declaredDescriptorRefs.add(redaction.ref)
  }

  for (const artifact of artifactInventory) {
    if (
      interactedBlacklistedSteps.has(artifact.stepIndex)
      && (artifact.role === 'screenshot' || artifact.role === 'opaque-evidence')
    ) {
      throw captureSafePayloadError()
    }
  }
}

function omissionPreSkipped(
  job: CommitCurationJob,
): SkippedArtifact<'capture-blacklist'>[] {
  return job.payload.captureReceipt.omissions.map((omission) => ({
    ref: {
      id: omission.ref,
      sha: sha256hex(canonicalJson({
        schemaVersion: 1,
        kind: 'capture-blacklist-omission',
        stepIndex: omission.stepIndex,
        ref: omission.ref,
        role: omission.role,
        originalName: omission.originalName,
        reason: omission.reason,
      })),
    },
    stepIndex: omission.stepIndex,
    reason: omission.reason,
  }))
}

function preCopyArtifacts(
  job: CommitCurationJob,
  preflightDir: string,
): ArtifactCopyResult<'capture-blacklist'> {
  return copyArtifacts(artifactInputs(job), join(preflightDir, 'artifacts'), {
    preSkipped: omissionPreSkipped(job),
  })
}

function publisherArtifacts(
  preCopy: ArtifactCopyResult<'capture-blacklist'>,
  preflightDir: string,
): ArtifactCopyInput[] {
  return preCopy.copied.map((artifact) => ({
    ref: artifact.ref,
    sourcePath: join(preflightDir, artifact.relPath),
    stepIndex: artifact.stepIndex,
    ...(artifact.role === undefined ? {} : { role: artifact.role }),
    ...(artifact.originalName === undefined ? {} : { originalName: artifact.originalName }),
  }))
}

function storeConfig(
  deps: CommitCurationDependencies,
  productKey: string,
  writerLeaseId: string,
): BundleStoreConfig {
  const hooks: NonNullable<BundleStoreConfig['hooks']> = {
    ...(deps.hooks?.beforePublishRename === undefined
      ? {}
      : { beforePublishRename: deps.hooks.beforePublishRename }),
    ...(deps.hooks?.afterMutableReplacement === undefined
      ? {}
      : { afterMutableReplacement: deps.hooks.afterMutableReplacement }),
  }
  return {
    knowledgeRoot: deps.knowledgeRoot,
    productKey,
    auditBaseDir: deps.auditBaseDir,
    commitArtifacts: 'none',
    writerLeaseId,
    policy: deps.policy,
    ...(Object.keys(hooks).length === 0 ? {} : { hooks }),
  }
}

function productForBundle(
  knowledgeRoot: string,
  bundleId: RecordId,
  fallback: string,
): string {
  return enumerateBundleDirs(knowledgeRoot).find((entry) => {
    const manifest = join(entry.dir, 'manifest.json')
    return entry.dir.endsWith(`/${bundleId}`) || manifest.endsWith(`/${bundleId}/manifest.json`)
  })?.product ?? fallback
}

function markDone(deps: CommitCurationDependencies, job: CommitCurationJob): void {
  writeJobState({
    knowledgeRoot: deps.knowledgeRoot,
    candidateId: job.candidateId,
    lifecycle: 'done',
  })
}

function appendFailure(
  outcome:
    | ReturnType<typeof appendOutcomeEvent>
    | ReturnType<typeof appendOutcomeEventWithEnrichment>
    | ReturnType<typeof appendRelation>,
): CommitCurationOutcome | undefined {
  if (outcome.kind === 'egress-blocked') {
    return { kind: 'withheld', reason: 'egress-blocked', detections: outcome.detections }
  }
  if (outcome.kind === 'not-found') return { kind: 'failed', reason: 'append-failed' }
  return undefined
}

function mutationTarget(delta: Delta): RecordId | undefined {
  if (delta.kind === 'Confirm' || delta.kind === 'Deprecate') return delta.targetId
  if (delta.kind === 'Supersede') return delta.victimId
  return undefined
}

function unreachableRestrictedDelta(delta: never): never {
  throw new TypeError(`unsupported injection-restricted delta: ${canonicalJson(delta)}`)
}

function restrictedInjectionDelta(delta: Delta, job: CommitCurationJob): Delta {
  const envelope = {
    origin: delta.origin,
    scope: delta.scope,
    citedIds: [],
    ...(delta.authorship === undefined ? {} : { authorship: delta.authorship }),
  }

  switch (delta.kind) {
    case 'Add':
      return { kind: 'Add', ...envelope, bundle: delta.bundle }
    case 'MintUnknown':
      return {
        kind: 'MintUnknown',
        ...envelope,
        conflict: { recordIds: [], kind: delta.conflict.kind },
      }
    case 'Supersede':
      return { kind: 'Add', ...envelope, bundle: delta.newBundle }
    case 'Confirm':
    case 'Deprecate':
    case 'Noop':
      return { kind: 'Add', ...envelope, bundle: syntheticDraft(job) }
    default:
      return unreachableRestrictedDelta(delta)
  }
}

/**
 * The one serialized mutation boundary: fresh epoch, disposition, intent, fresh epoch, publish,
 * append-only lifecycle, canonical index projection, intent clear, and queue completion.
 */
export function commitCurationDelta(
  deps: CommitCurationDependencies,
  job: CommitCurationJob,
  checkpoint: AuthoredCheckpoint,
): CommitCurationOutcome {
  const beforeWork = staleEpoch(deps)
  if (beforeWork !== undefined) return beforeWork
  assertCaptureSafePayload(job)

  if (checkpoint.authorship.path === 'deterministic-fallback') {
    try {
      assertRestrictedFallbackDelta(checkpoint.delta)
    } catch {
      markDone(deps, job)
      return { kind: 'failed', reason: 'restricted-fallback' }
    }
  }

  const authoredDraft = draftForDelta(checkpoint.delta, job) ?? syntheticDraft(job)
  const embedding = renderEmbeddingInput({
    summary: authoredDraft.summary,
    body: authoredDraft.body,
    anchors: authoredDraft.anchors,
  })
  const embedGate = assessEmbeddingInput({
    renderedEmbeddingInput: embedding,
    llmAuthoredFields: [authoredDraft.summary, authoredDraft.body],
    secretFlaggedAtEmit: job.payload.secretFlagged,
    policy: deps.policy,
  })
  const injectionRestricted =
    job.payload.injectionFlagged
    || embedGate.detections.some((detection) => detection.detector === 'injectionShape')
  const dispositionDelta = injectionRestricted
    ? restrictedInjectionDelta(checkpoint.delta, job)
    : checkpoint.delta
  const dispositionCheckpoint: AuthoredCheckpoint = {
    ...checkpoint,
    delta: dispositionDelta,
    neighborIds: injectionRestricted ? [] : checkpoint.neighborIds,
    preconditions: injectionRestricted ? [] : checkpoint.preconditions,
  }
  const disposed = disposeDelta({
    delta: dispositionDelta,
    checkpoint: dispositionCheckpoint,
    profile: deps.profile,
    knowledgeRoot: deps.knowledgeRoot,
    candidate: {
      anchors: job.payload.anchors,
      scope: job.payload.scope,
      buildOrdinal: job.payload.buildOrdinal,
    },
    drainState: deps.drainState,
  })
  if (disposed.kind === 'requeue-resynthesis') return disposed
  if (disposed.kind === 'noop') {
    markDone(deps, job)
    return disposed
  }

  const delta = disposed.delta
  const relationRows = relations(disposed.relationIntents ?? [], delta, job)
  const draft = draftForDelta(delta, job)
  const productKey = delta.scope.key
  let bundleId: RecordId
  let bundleDir: string | undefined
  let publishInput: PublishBundleInput | undefined
  const preflightDir = join(job.candidateDir, `.commit-artifacts-${randomUUID()}`)

  writeJobState({
    knowledgeRoot: deps.knowledgeRoot,
    candidateId: job.candidateId,
    lifecycle: 'bundling',
    authored: dispositionCheckpoint,
  })

  try {
    if (draft !== undefined) {
      const preCopy = preCopyArtifacts(job, preflightDir)
      const renderInput: RenderBundlePartsInput = {
        draft,
        discriminant: discriminant(draft, delta, stepKeys(job)),
        originClass: originClass(delta),
        createdAtOrdinal: job.payload.buildOrdinal,
        screenStates: job.screenStates ?? [],
        initialEvents: [confirmedEvent(job, delta)],
        relations: relationRows,
        provenance: {
          mode: 'run-linked',
          runId: job.payload.sourceRunId,
          testId: job.payload.attributingObservationId,
          stepIndex: job.payload.distilledObservations[0]?.step.ordinal ?? 0,
          curationJobId: job.candidateId,
          sourceBuildOrdinal: job.payload.buildOrdinal,
          authorship: checkpoint.authorship,
          ...((draft as CheckpointDraft).needsEnrichment === true
            ? { needsEnrichment: true }
            : {}),
          ...(injectionRestricted ? { withheld: true } : {}),
        },
        copiedArtifacts: preCopy,
        evidenceIncomplete: preCopy.evidenceIncomplete,
        evidenceMarkdown: evidenceMarkdown(job),
        distilledObservations: job.payload.distilledObservations,
      }
      const rendered = renderBundleParts(renderInput)
      bundleId = rendered.id
      publishInput = {
        ...renderInput,
        artifacts: publisherArtifacts(preCopy, preflightDir),
        preSkippedArtifacts: preCopy.skipped,
      }
    } else {
      const target = mutationTarget(delta)
      if (target === undefined) {
        markDone(deps, job)
        return { kind: 'failed', reason: 'append-failed' }
      }
      bundleId = target
    }

    const beforeIntent = staleEpoch(deps)
    if (beforeIntent !== undefined) return beforeIntent
    writeJobState({
      knowledgeRoot: deps.knowledgeRoot,
      candidateId: job.candidateId,
      lifecycle: 'committing',
      authored: dispositionCheckpoint,
    })
    writeCommitIntent(deps.knowledgeRoot, {
      schemaVersion: 1,
      candidateId: job.candidateId,
      bundleId,
      deltaKind: delta.kind,
      ...(mutationTarget(delta) === undefined ? {} : { targetRecordId: mutationTarget(delta) }),
      epoch: deps.epoch,
    })
    deps.hooks?.afterIntentWritten?.()
    const beforePublish = staleEpoch(deps)
    if (beforePublish !== undefined) return beforePublish

    let convertedConfirm = false
    const config = storeConfig(deps, productKey, job.leaseId)
    if (publishInput !== undefined) {
      const published = (deps.operations?.publishBundle ?? publishBundle)(config, publishInput)
      if (published.kind === 'egress-blocked') {
        clearCommitIntent(deps.knowledgeRoot, job.candidateId)
        markDone(deps, job)
        return { kind: 'withheld', reason: 'egress-blocked', detections: published.detections }
      }
      if (published.kind === 'identity-collision') {
        clearCommitIntent(deps.knowledgeRoot, job.candidateId)
        markDone(deps, job)
        return {
          kind: 'failed',
          reason: 'identity-collision',
          collisionReason: published.reason,
        }
      }
      if (published.kind === 'already-exists') {
        const existingConfig = storeConfig(
          deps,
          productForBundle(deps.knowledgeRoot, published.id, productKey),
          job.leaseId,
        )
        const capableEnrichment =
          delta.kind === 'Add'
          && checkpoint.authorship.path !== 'deterministic-fallback'
          && draft !== undefined
            ? {
                summary: draft.summary,
                body: draft.body,
                authorship: checkpoint.authorship,
              }
            : undefined
        const appended = capableEnrichment === undefined
          ? appendOutcomeEvent(
              existingConfig,
              published.id,
              confirmedEvent(job, delta),
            )
          : appendOutcomeEventWithEnrichment(
              existingConfig,
              published.id,
              confirmedEvent(job, delta),
              capableEnrichment,
            )
        const failure = appendFailure(appended)
        if (failure !== undefined) {
          clearCommitIntent(deps.knowledgeRoot, job.candidateId)
          markDone(deps, job)
          return failure
        }
        if (
          appended.kind === 'duplicate'
          && (!('enriched' in appended) || appended.enriched === false)
        ) {
          clearCommitIntent(deps.knowledgeRoot, job.candidateId)
          markDone(deps, job)
          return { kind: 'noop', reason: 'evidence-token-consumed' }
        }
        convertedConfirm = true
      } else {
        bundleDir = published.dir
        deps.hooks?.afterBundlePublished?.(published.id)
      }
    } else if (delta.kind === 'Confirm') {
      const targetConfig = storeConfig(
        deps,
        productForBundle(deps.knowledgeRoot, delta.targetId, productKey),
        job.leaseId,
      )
      const appended = appendOutcomeEvent(
        targetConfig,
        delta.targetId,
        confirmedEvent(job, delta, delta.evidenceToken),
      )
      const failure = appendFailure(appended)
      if (failure !== undefined) {
        clearCommitIntent(deps.knowledgeRoot, job.candidateId)
        markDone(deps, job)
        return failure
      }
      if (appended.kind === 'duplicate') {
        clearCommitIntent(deps.knowledgeRoot, job.candidateId)
        markDone(deps, job)
        return { kind: 'noop', reason: 'evidence-token-consumed' }
      }
    } else if (delta.kind === 'Deprecate') {
      const targetConfig = storeConfig(
        deps,
        productForBundle(deps.knowledgeRoot, delta.targetId, productKey),
        job.leaseId,
      )
      const appended = appendOutcomeEvent(targetConfig, delta.targetId, {
        type: 'deprecated',
        evidenceToken: asEvidenceToken(job.payload.evidenceToken),
        curationJobId: job.candidateId,
        buildOrdinal: job.payload.buildOrdinal,
        reason: delta.reason,
      })
      const failure = appendFailure(appended)
      if (failure !== undefined) {
        clearCommitIntent(deps.knowledgeRoot, job.candidateId)
        markDone(deps, job)
        return failure
      }
    }

    const canonicalConfig = storeConfig(
      deps,
      productForBundle(deps.knowledgeRoot, bundleId, productKey),
      job.leaseId,
    )
    for (const relation of relationRows) {
      const failure = appendFailure(appendRelation(canonicalConfig, bundleId, relation))
      if (failure !== undefined) {
        clearCommitIntent(deps.knowledgeRoot, job.candidateId)
        markDone(deps, job)
        return failure
      }
    }

    if (delta.kind === 'Supersede') {
      const victimConfig = storeConfig(
        deps,
        productForBundle(deps.knowledgeRoot, delta.victimId, productKey),
        job.leaseId,
      )
      const superseded = appendOutcomeEvent(victimConfig, delta.victimId, {
        type: 'superseded',
        evidenceToken: delta.evidenceToken,
        curationJobId: job.candidateId,
        buildOrdinal: job.payload.buildOrdinal,
        byRecordId: bundleId,
      })
      const supersededFailure = appendFailure(superseded)
      if (supersededFailure !== undefined) {
        clearCommitIntent(deps.knowledgeRoot, job.candidateId)
        markDone(deps, job)
        return supersededFailure
      }
      const closeToken = asEvidenceToken(
        sha256hex(canonicalJson({ token: delta.evidenceToken, event: 'window-close' })),
      )
      const closed = appendOutcomeEvent(victimConfig, delta.victimId, {
        type: 'window-close',
        evidenceToken: closeToken,
        curationJobId: job.candidateId,
        buildOrdinal: job.payload.buildOrdinal,
        closedAtOrdinal: job.payload.buildOrdinal,
      })
      const closeFailure = appendFailure(closed)
      if (closeFailure !== undefined) {
        clearCommitIntent(deps.knowledgeRoot, job.candidateId)
        markDone(deps, job)
        return closeFailure
      }
      applyIndexDeltaForBundle({ knowledgeRoot: deps.knowledgeRoot, bundleId: delta.victimId })
    }

    applyIndexDeltaForBundle({
      knowledgeRoot: deps.knowledgeRoot,
      bundleId,
      ...(draft === undefined ? {} : { lexicalInput: embedGate.redactedLexicalInput }),
      ...(draft === undefined ? {} : { suppressDense: embedGate.suppressDense }),
    })
    deps.hooks?.afterIndexApplied?.(bundleId)
    clearCommitIntent(deps.knowledgeRoot, job.candidateId)
    markDone(deps, job)

    const result: CommittedBundleResult = {
      bundleId,
      bundleDir:
        bundleDir
        ?? enumerateBundleDirs(deps.knowledgeRoot).find((entry) => entry.dir.endsWith(`/${bundleId}`))
          ?.dir
        ?? '',
      deltaKind: delta.kind,
    }
    if (injectionRestricted) {
      return {
        kind: 'withheld',
        reason: 'injection-restricted',
        bundleId: result.bundleId,
        bundleDir: result.bundleDir,
      }
    }
    if (convertedConfirm) return { kind: 'converted-confirm', ...result }
    return disposed.kind === 'downgraded'
      ? { kind: 'downgraded', reason: disposed.reason, ...result }
      : { kind: 'applied', ...result }
  } finally {
    rmSync(preflightDir, { recursive: true, force: true })
  }
}
