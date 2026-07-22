import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'

import { canonicalJson } from '@vostride/agent-qa-schema'
import { ZodError } from 'zod'

import { copyArtifacts } from '../artifact-copy.js'
import type {
  ArtifactCopyInput,
  ArtifactCopySkipReason,
  CopiedArtifact,
  SkippedArtifact,
} from '../artifact-copy.js'
import {
  bestEffortFsyncDirectory,
  durableWrite,
  publishStagedQueueEntry,
  removeEmptyDir,
} from '../queue-transport.js'
export {
  bestEffortFsyncDirectory,
  durableWrite,
  publishStagedQueueEntry,
  removeEmptyDir,
} from '../queue-transport.js'
export type { PublishStagedQueueEntryOutcome } from '../queue-transport.js'
import {
  classifyCaptureBlacklist,
  filterArtifactsForCapture,
  sanitizeCaptureBlacklistEvidence,
} from '../curator/capture-blacklist.js'
import {
  claimedCandidateDir,
  claimedLeaseDir,
  claimedRoot,
  QUEUE_MAX_EMITS_PER_RUN,
  QUEUE_MAX_JOBS_PER_SCOPE,
  queueStagingRoot,
  queuedCandidateDir,
  queuedRoot,
} from './queue-layout.js'
import { readJobState, writeJobState } from './job-state.js'
import {
  buildCurationCandidateAddressFields,
  candidateContentAddress,
  CURATION_QUEUE_SCHEMA_VERSION,
  curationCandidatePayloadSchema,
  curationCandidateProjectionSchema,
  type BuildCurationCandidateAddressFieldsInput,
  type CurationArtifactDescriptor,
  type CurationCandidatePayload,
  type CurationCandidateProjection,
  type CurationCaptureReceipt,
} from './queue-payload.js'

export interface CurationProjectionArtifactSource {
  /** Binds one raw projection descriptor by its ArtifactRef id. */
  artifactId: string
  /** Absolute source outside the queue's durable projection. */
  sourcePath: string
}

export interface EnqueueCurationCandidateProjectionOptions {
  knowledgeRoot: string
  projection: CurationCandidateProjection
  artifactSources: readonly CurationProjectionArtifactSource[]
}

export type CurationEnqueueRefusalReason =
  | 'invalid-payload'
  | 'artifact-inventory-mismatch'
  | 'artifact-missing'
  | 'artifact-sha-mismatch'
  | 'artifact-byte-length-mismatch'
  | 'artifact-step-cap'
  | 'artifact-run-cap'

export type EnqueueCurationCandidateProjectionOutcome =
  | { kind: 'enqueued'; candidateId: string }
  | { kind: 'coalesced'; candidateId: string }
  | { kind: 'cap-exceeded'; candidateId: string }
  | { kind: 'refused'; reason: CurationEnqueueRefusalReason }

export type ReadCurationCandidatePayloadOutcome =
  | { kind: 'absent'; present: false }
  | { kind: 'parsed'; present: true; payload: CurationCandidatePayload }
  | { kind: 'malformed'; present: true }

export interface ClaimNextJobOptions {
  knowledgeRoot: string
  leaseId: string
}

export interface ClaimedCurationJob {
  kind: 'claimed'
  candidateId: string
  leaseId: string
  payload: CurationCandidatePayload
  candidateDir: string
  payloadPath: string
  artifactsDir: string
}

export interface MalformedClaimedCurationJob {
  kind: 'malformed'
  candidateId: string
  leaseId: string
  candidateDir: string
  payloadPath: string
  artifactsDir: string
  payloadPresent: true
}

export type ClaimNextJobOutcome = ClaimedCurationJob | MalformedClaimedCurationJob

export interface RequeueClaimedOptions {
  knowledgeRoot: string
  leaseId: string
}

function directoryNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

const CANDIDATE_ID = /^[0-9a-f]{64}$/
const SAFE_LEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Return deterministic candidate-id order and ignore non-contract directory names. */
export function listQueuedCandidates(knowledgeRoot: string): string[] {
  return directoryNames(queuedRoot(knowledgeRoot)).filter((name) => CANDIDATE_ID.test(name))
}

/** Return deterministic active/recoverable lease directory order. */
export function listClaimedLeases(knowledgeRoot: string): string[] {
  return directoryNames(claimedRoot(knowledgeRoot)).filter((name) => SAFE_LEASE_ID.test(name))
}

export function readCurationCandidatePayload(
  candidateDir: string,
): ReadCurationCandidatePayloadOutcome {
  const file = join(candidateDir, 'payload.json')
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return existsSync(file) || existsSync(candidateDir)
      ? { kind: 'malformed', present: true }
      : { kind: 'absent', present: false }
  }

  try {
    const parsed = curationCandidatePayloadSchema.safeParse(JSON.parse(raw))
    return parsed.success && parsed.data.candidateId === basename(candidateDir)
      ? { kind: 'parsed', present: true, payload: parsed.data }
      : { kind: 'malformed', present: true }
  } catch {
    return { kind: 'malformed', present: true }
  }
}

function queuedPayloads(knowledgeRoot: string): CurationCandidatePayload[] {
  return listQueuedCandidates(knowledgeRoot).flatMap((candidateId) => {
    const outcome = readCurationCandidatePayload(
      queuedCandidateDir(knowledgeRoot, candidateId),
    )
    return outcome.kind === 'parsed' ? [outcome.payload] : []
  })
}

function initializeClaimedState(knowledgeRoot: string, candidateId: string): void {
  const state = readJobState(knowledgeRoot, candidateId)
  if (state.kind === 'absent') {
    writeJobState({ knowledgeRoot, candidateId, lifecycle: 'queued' })
  }
}

/** Atomically claim the lexicographically first queued content address. */
export function claimNextJob(opts: ClaimNextJobOptions): ClaimNextJobOutcome | undefined {
  for (const candidateId of listQueuedCandidates(opts.knowledgeRoot)) {
    const sourceDir = queuedCandidateDir(opts.knowledgeRoot, candidateId)
    const leaseDir = claimedLeaseDir(opts.knowledgeRoot, opts.leaseId)
    const candidateDir = claimedCandidateDir(
      opts.knowledgeRoot,
      opts.leaseId,
      candidateId,
    )
    mkdirSync(leaseDir, { recursive: true })
    try {
      renameSync(sourceDir, candidateDir)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        removeEmptyDir(leaseDir)
        continue
      }
      if ((code === 'EEXIST' || code === 'ENOTEMPTY') && existsSync(candidateDir)) {
        removeEmptyDir(leaseDir)
        continue
      }
      throw error
    }
    bestEffortFsyncDirectory(leaseDir)
    bestEffortFsyncDirectory(queuedRoot(opts.knowledgeRoot))
    initializeClaimedState(opts.knowledgeRoot, candidateId)

    const payloadPath = join(candidateDir, 'payload.json')
    const artifactsDir = join(candidateDir, 'artifacts')
    const payload = readCurationCandidatePayload(candidateDir)
    if (payload.kind !== 'parsed') {
      return {
        kind: 'malformed',
        candidateId,
        leaseId: opts.leaseId,
        candidateDir,
        payloadPath,
        artifactsDir,
        payloadPresent: true,
      }
    }
    return {
      kind: 'claimed',
      candidateId,
      leaseId: opts.leaseId,
      payload: payload.payload,
      candidateDir,
      payloadPath,
      artifactsDir,
    }
  }
  return undefined
}

/** Reclaim one dead lease without discarding an already-authored deterministic checkpoint. */
export function requeueClaimed(opts: RequeueClaimedOptions): string[] {
  const leaseDir = claimedLeaseDir(opts.knowledgeRoot, opts.leaseId)
  const candidateIds = directoryNames(leaseDir).filter((name) => CANDIDATE_ID.test(name))
  const requeued: string[] = []
  mkdirSync(queuedRoot(opts.knowledgeRoot), { recursive: true })
  for (const candidateId of candidateIds) {
    const sourceDir = claimedCandidateDir(opts.knowledgeRoot, opts.leaseId, candidateId)
    const targetDir = queuedCandidateDir(opts.knowledgeRoot, candidateId)
    if (existsSync(targetDir)) {
      rmSync(sourceDir, { recursive: true, force: true })
    } else {
      try {
        renameSync(sourceDir, targetDir)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if ((code === 'EEXIST' || code === 'ENOTEMPTY') && existsSync(targetDir)) {
          rmSync(sourceDir, { recursive: true, force: true })
        } else if (code === 'ENOENT') {
          continue
        } else {
          throw error
        }
      }
    }

    const state = readJobState(opts.knowledgeRoot, candidateId)
    if (state.kind === 'parsed') {
      writeJobState({
        knowledgeRoot: opts.knowledgeRoot,
        candidateId,
        lifecycle: 'queued',
        embedCrashCount: state.state.embedCrashCount,
        ...(state.state.authored === undefined ? {} : { authored: state.state.authored }),
      })
    } else if (state.kind === 'absent') {
      writeJobState({ knowledgeRoot: opts.knowledgeRoot, candidateId, lifecycle: 'queued' })
    }
    requeued.push(candidateId)
  }
  removeEmptyDir(leaseDir)
  removeEmptyDir(claimedRoot(opts.knowledgeRoot))
  bestEffortFsyncDirectory(queuedRoot(opts.knowledgeRoot))
  return requeued
}

function queueCapExceeded(
  knowledgeRoot: string,
  payload: CurationCandidatePayload,
): boolean {
  let scopeCount = 0
  let sourceRunCount = 0
  const scopeKey = canonicalJson(payload.scope)
  for (const queued of queuedPayloads(knowledgeRoot)) {
    if (canonicalJson(queued.scope) === scopeKey) scopeCount += 1
    if (queued.sourceRunId === payload.sourceRunId) sourceRunCount += 1
  }
  return (
    scopeCount >= QUEUE_MAX_JOBS_PER_SCOPE || sourceRunCount >= QUEUE_MAX_EMITS_PER_RUN
  )
}

function skippedArtifactReason(reason: SkippedArtifact['reason']): CurationEnqueueRefusalReason {
  switch (reason) {
    case 'step-cap':
      return 'artifact-step-cap'
    case 'run-cap':
      return 'artifact-run-cap'
    case 'pruned-source':
      return 'artifact-missing'
    case 'sha-mismatch':
      return 'artifact-sha-mismatch'
  }
}

type ProjectionArtifactInputsOutcome =
  | { kind: 'ready'; inputs: ArtifactCopyInput[] }
  | { kind: 'refused'; reason: CurationEnqueueRefusalReason }

function projectionArtifactInputs(
  projection: CurationCandidateProjection,
  artifactSources: readonly CurationProjectionArtifactSource[],
): ProjectionArtifactInputsOutcome {
  const sourceByArtifactId = new Map<string, string>()
  for (const source of artifactSources) {
    if (
      source.artifactId === ''
      || !isAbsolute(source.sourcePath)
      || sourceByArtifactId.has(source.artifactId)
    ) {
      return { kind: 'refused', reason: 'artifact-inventory-mismatch' }
    }
    sourceByArtifactId.set(source.artifactId, source.sourcePath)
  }
  if (
    sourceByArtifactId.size !== projection.artifactDescriptors.length
    || projection.artifactDescriptors.some(
      (descriptor) => !sourceByArtifactId.has(descriptor.ref.id),
    )
  ) {
    return { kind: 'refused', reason: 'artifact-inventory-mismatch' }
  }

  return {
    kind: 'ready',
    inputs: projection.artifactDescriptors.map((descriptor) => ({
      ref: descriptor.ref,
      sourcePath: sourceByArtifactId.get(descriptor.ref.id)!,
      stepIndex: descriptor.stepIndex,
      role: descriptor.role,
      originalName: descriptor.originalName,
    })),
  }
}

function copyFailure(
  skipped: SkippedArtifact<ArtifactCopySkipReason | 'capture-blacklist'>,
): skipped is SkippedArtifact<ArtifactCopySkipReason> {
  return skipped.reason !== 'capture-blacklist'
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sanitizeCaptureInteractions(
  interactions: CurationCaptureReceipt['interactions'],
): CurationCaptureReceipt['interactions'] {
  const sorted = [...interactions].sort((left, right) =>
    left.stepIndex - right.stepIndex
    || compareText(left.elementRef ?? '', right.elementRef ?? ''),
  )
  const seen = new Set<string>()
  return sorted.filter((interaction) => {
    const key = JSON.stringify([interaction.stepIndex, interaction.elementRef ?? null])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function descriptorById(
  descriptors: readonly CurationArtifactDescriptor[],
): Map<string, CurationArtifactDescriptor> {
  return new Map(descriptors.map((descriptor) => [descriptor.ref.id, descriptor]))
}

function artifactInventoryFromSafeCopies(
  copied: readonly CopiedArtifact[],
  descriptors: ReadonlyMap<string, CurationArtifactDescriptor>,
): BuildCurationCandidateAddressFieldsInput['artifactInventory'] | undefined {
  const inventory: BuildCurationCandidateAddressFieldsInput['artifactInventory'] = []
  for (const artifact of copied) {
    const descriptor = descriptors.get(artifact.ref.id)
    if (descriptor === undefined) return undefined
    inventory.push({
      relativePath: artifact.relPath,
      sha256: artifact.ref.sha,
      bytes: artifact.bytes,
      stepIndex: artifact.stepIndex,
      role: descriptor.role,
      originalName: descriptor.originalName,
    })
  }
  return inventory.sort((left, right) =>
    compareText(left.relativePath, right.relativePath)
    || left.stepIndex - right.stepIndex
    || compareText(left.role, right.role)
    || compareText(left.originalName, right.originalName),
  )
}

function fsyncCopiedArtifacts(stagingDir: string, copied: readonly CopiedArtifact[]): void {
  for (const artifact of copied) {
    const fd = openSync(join(stagingDir, artifact.relPath), 'r')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  }
}

type FinalizeProjectionOutcome =
  | { kind: 'ready'; payload: CurationCandidatePayload }
  | { kind: 'refused'; reason: CurationEnqueueRefusalReason }

function finalizeProjection(
  stagingDir: string,
  projection: CurationCandidateProjection,
  sourceInputs: readonly ArtifactCopyInput[],
): FinalizeProjectionOutcome {
  const classified = classifyCaptureBlacklist(projection.captureEvidence)
  const filtered = filterArtifactsForCapture({
    artifacts: sourceInputs,
    blacklist: classified,
    stepInteractions: projection.stepInteractions,
  })
  const copied = copyArtifacts<'capture-blacklist'>(
    filtered.toCopy,
    join(stagingDir, 'artifacts'),
    { preSkipped: filtered.skipped },
  )
  const failedCopy = copied.skipped.find(copyFailure)
  if (failedCopy !== undefined) {
    return { kind: 'refused', reason: skippedArtifactReason(failedCopy.reason) }
  }
  fsyncCopiedArtifacts(stagingDir, copied.copied)

  const descriptors = descriptorById(projection.artifactDescriptors)
  const artifactInventory = artifactInventoryFromSafeCopies(copied.copied, descriptors)
  if (artifactInventory === undefined) {
    return { kind: 'refused', reason: 'artifact-inventory-mismatch' }
  }
  const omissions = filtered.skipped
    .map((artifact) => ({
      stepIndex: artifact.stepIndex,
      ref: artifact.ref.id,
      role: artifact.role,
      originalName: artifact.originalName,
      reason: 'capture-blacklist' as const,
    }))
    .sort((left, right) =>
      left.stepIndex - right.stepIndex
      || compareText(left.ref, right.ref)
      || compareText(left.role, right.role)
      || compareText(left.originalName, right.originalName),
    )
  const redactions = copied.copied
    .flatMap((artifact) => {
      const descriptor = descriptors.get(artifact.ref.id)
      if (
        descriptor === undefined
        || (descriptor.role !== 'dom-snapshot' && descriptor.role !== 'ax-snapshot')
        || descriptor.ref.sha === artifact.ref.sha
      ) {
        return []
      }
      return [{
        stepIndex: artifact.stepIndex,
        ref: descriptor.ref.id,
        role: descriptor.role,
        originalName: descriptor.originalName,
        reason: 'capture-blacklist' as const,
        safeSha256: artifact.ref.sha,
      }]
    })
    .sort((left, right) =>
      left.stepIndex - right.stepIndex
      || compareText(left.ref, right.ref)
      || compareText(left.role, right.role)
      || compareText(left.originalName, right.originalName),
    )

  try {
    const fields = buildCurationCandidateAddressFields({
      schemaVersion: CURATION_QUEUE_SCHEMA_VERSION,
      sourceRunId: projection.sourceRunId,
      scope: projection.scope,
      buildOrdinal: projection.buildOrdinal,
      executionContext: projection.executionContext,
      secretFlagged: projection.secretFlagged,
      injectionFlagged: projection.injectionFlagged,
      kind: projection.kind,
      ...(projection.subtype === undefined ? {} : { subtype: projection.subtype }),
      ...(projection.rootCauseClass === undefined
        ? {}
        : { rootCauseClass: projection.rootCauseClass }),
      anchors: projection.anchors,
      summarySeed: projection.summarySeed,
      bodySeed: projection.bodySeed,
      distilledObservations: projection.distilledObservations,
      evidenceToken: projection.evidenceToken,
      attributingObservationId: projection.attributingObservationId,
      artifactInventory,
      captureReceipt: {
        regions: sanitizeCaptureBlacklistEvidence(classified),
        interactions: sanitizeCaptureInteractions(projection.stepInteractions),
        omissions,
        redactions,
      },
      emittedAt: projection.emittedAt,
    })
    const candidateId = candidateContentAddress(fields)
    return {
      kind: 'ready',
      payload: curationCandidatePayloadSchema.parse({ candidateId, ...fields }),
    }
  } catch (error) {
    if (error instanceof ZodError) {
      return { kind: 'refused', reason: 'artifact-inventory-mismatch' }
    }
    throw error
  }
}

/**
 * Finalizes raw capture evidence into safe bytes and a value-free receipt before the candidate
 * content address or any queue-visible directory exists.
 */
export function enqueueCurationCandidateProjection(
  opts: EnqueueCurationCandidateProjectionOptions,
): EnqueueCurationCandidateProjectionOutcome {
  const parsed = curationCandidateProjectionSchema.safeParse(opts.projection)
  if (!parsed.success) return { kind: 'refused', reason: 'invalid-payload' }
  const projection = parsed.data
  const sourceInputs = projectionArtifactInputs(projection, opts.artifactSources)
  if (sourceInputs.kind === 'refused') return sourceInputs

  const stagingRoot = queueStagingRoot(opts.knowledgeRoot)
  const stagingDir = join(stagingRoot, randomUUID())
  mkdirSync(stagingDir, { recursive: true })
  try {
    const finalized = finalizeProjection(stagingDir, projection, sourceInputs.inputs)
    if (finalized.kind === 'refused') return finalized
    const { payload } = finalized
    const candidateId = payload.candidateId
    const finalDir = queuedCandidateDir(opts.knowledgeRoot, candidateId)
    if (existsSync(finalDir)) return { kind: 'coalesced', candidateId }
    if (queueCapExceeded(opts.knowledgeRoot, payload)) {
      return { kind: 'cap-exceeded', candidateId }
    }

    durableWrite(join(stagingDir, 'payload.json'), `${canonicalJson(payload)}\n`)
    bestEffortFsyncDirectory(join(stagingDir, 'artifacts'))
    bestEffortFsyncDirectory(stagingDir)
    const published = publishStagedQueueEntry(
      stagingDir,
      finalDir,
      queuedRoot(opts.knowledgeRoot),
    )
    if (published === 'coalesced') return { kind: 'coalesced', candidateId }
    return { kind: 'enqueued', candidateId }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
    removeEmptyDir(stagingRoot)
  }
}

export const enqueueCurationCandidate = enqueueCurationCandidateProjection
