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
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

import { canonicalJson } from '@vostride/agent-qa-schema'

import {
  ARTIFACT_RUN_CAP_BYTES,
  ARTIFACT_STEP_CAP_BYTES,
  copyArtifacts,
} from '../artifact-copy.js'
import type { ArtifactCopyResult, SkippedArtifact } from '../artifact-copy.js'
import {
  QUEUE_MAX_EMITS_PER_RUN,
  QUEUE_MAX_JOBS_PER_SCOPE,
  queueStagingRoot,
  queuedCandidateDir,
  queuedRoot,
} from './queue-layout.js'
import {
  curationCandidatePayloadSchema,
  type CurationCandidateArtifact,
  type CurationCandidatePayload,
} from './queue-payload.js'

export interface CurationArtifactSource {
  relativePath: string
  /** Absolute source under the completed run's artifact store. */
  sourcePath: string
}

export interface EnqueueCurationCandidateOptions {
  knowledgeRoot: string
  payload: CurationCandidatePayload
  artifactSources: readonly CurationArtifactSource[]
}

export type CurationEnqueueRefusalReason =
  | 'invalid-payload'
  | 'artifact-inventory-mismatch'
  | 'artifact-missing'
  | 'artifact-sha-mismatch'
  | 'artifact-byte-length-mismatch'
  | 'artifact-step-cap'
  | 'artifact-run-cap'

export type EnqueueCurationCandidateOutcome =
  | 'enqueued'
  | 'coalesced'
  | 'cap-exceeded'
  | { kind: 'refused'; reason: CurationEnqueueRefusalReason }

export type ReadCurationCandidatePayloadOutcome =
  | { kind: 'absent'; present: false }
  | { kind: 'parsed'; present: true; payload: CurationCandidatePayload }
  | { kind: 'malformed'; present: true }

function removeEmptyDir(dir: string): void {
  try {
    rmdirSync(dir)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error
  }
}

function durableWrite(file: string, bytes: string | Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true })
  const fd = openSync(file, 'wx')
  try {
    writeFileSync(fd, bytes)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function bestEffortFsyncDirectory(dir: string): void {
  let fd: number | undefined
  try {
    fd = openSync(dir, 'r')
    fsyncSync(fd)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EINVAL' && code !== 'EISDIR' && code !== 'EPERM' && code !== 'ENOTSUP') {
      throw error
    }
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
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
    return parsed.success
      ? { kind: 'parsed', present: true, payload: parsed.data }
      : { kind: 'malformed', present: true }
  } catch {
    return { kind: 'malformed', present: true }
  }
}

function queuedPayloads(knowledgeRoot: string): CurationCandidatePayload[] {
  return directoryNames(queuedRoot(knowledgeRoot)).flatMap((candidateId) => {
    const outcome = readCurationCandidatePayload(
      queuedCandidateDir(knowledgeRoot, candidateId),
    )
    return outcome.kind === 'parsed' ? [outcome.payload] : []
  })
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

function declaredArtifactCapRefusal(
  inventory: readonly CurationCandidateArtifact[],
): CurationEnqueueRefusalReason | undefined {
  const bytesByStep = new Map<number, number>()
  const uniqueShas = new Set<string>()
  let runBytes = 0
  for (const artifact of inventory) {
    if (uniqueShas.has(artifact.sha256)) continue
    uniqueShas.add(artifact.sha256)
    const stepBytes = (bytesByStep.get(artifact.stepIndex) ?? 0) + artifact.bytes
    if (stepBytes > ARTIFACT_STEP_CAP_BYTES) return 'artifact-step-cap'
    bytesByStep.set(artifact.stepIndex, stepBytes)
    runBytes += artifact.bytes
    if (runBytes > ARTIFACT_RUN_CAP_BYTES) return 'artifact-run-cap'
  }
  return undefined
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

function copyCandidateArtifacts(
  stagingDir: string,
  payload: CurationCandidatePayload,
  artifactSources: readonly CurationArtifactSource[],
): ArtifactCopyResult | { kind: 'refused'; reason: CurationEnqueueRefusalReason } {
  const sourceByPath = new Map<string, string>()
  for (const source of artifactSources) {
    if (!isAbsolute(source.sourcePath)) {
      throw new TypeError('artifact sourcePath must be absolute')
    }
    if (sourceByPath.has(source.relativePath)) {
      return { kind: 'refused', reason: 'artifact-inventory-mismatch' }
    }
    sourceByPath.set(source.relativePath, source.sourcePath)
  }
  if (
    sourceByPath.size !== payload.artifactInventory.length ||
    payload.artifactInventory.some((artifact) => !sourceByPath.has(artifact.relativePath))
  ) {
    return { kind: 'refused', reason: 'artifact-inventory-mismatch' }
  }

  const copied = copyArtifacts(
    payload.artifactInventory.map((artifact) => ({
      ref: { id: artifact.relativePath, sha: artifact.sha256 },
      sourcePath: sourceByPath.get(artifact.relativePath)!,
      stepIndex: artifact.stepIndex,
    })),
    join(stagingDir, 'artifacts'),
  )
  const skipped = copied.skipped[0]
  if (skipped !== undefined) {
    return { kind: 'refused', reason: skippedArtifactReason(skipped.reason) }
  }
  for (const artifact of payload.artifactInventory) {
    const row = copied.copied.find((candidate) => candidate.ref.sha === artifact.sha256)
    if (row === undefined || row.bytes !== artifact.bytes) {
      return { kind: 'refused', reason: 'artifact-byte-length-mismatch' }
    }
    const artifactFile = join(stagingDir, artifact.relativePath)
    const fd = openSync(artifactFile, 'r')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  }
  return copied
}

/**
 * Synchronously publishes one self-contained candidate. The per-run cap is derived by scanning
 * current queued payloads, keeping the API stateless for the CLI's single-process emit batch.
 */
export function enqueueCurationCandidate(
  opts: EnqueueCurationCandidateOptions,
): EnqueueCurationCandidateOutcome {
  const parsed = curationCandidatePayloadSchema.safeParse(opts.payload)
  if (!parsed.success) return { kind: 'refused', reason: 'invalid-payload' }
  const payload = parsed.data
  const finalDir = queuedCandidateDir(opts.knowledgeRoot, payload.candidateId)
  if (existsSync(finalDir)) return 'coalesced'
  if (queueCapExceeded(opts.knowledgeRoot, payload)) return 'cap-exceeded'

  const capRefusal = declaredArtifactCapRefusal(payload.artifactInventory)
  if (capRefusal !== undefined) return { kind: 'refused', reason: capRefusal }

  const stagingRoot = queueStagingRoot(opts.knowledgeRoot)
  const stagingDir = join(stagingRoot, `${payload.candidateId}-${randomUUID()}`)
  mkdirSync(stagingDir, { recursive: true })
  try {
    const artifacts = copyCandidateArtifacts(stagingDir, payload, opts.artifactSources)
    if ('kind' in artifacts) return artifacts
    durableWrite(join(stagingDir, 'payload.json'), `${canonicalJson(payload)}\n`)
    bestEffortFsyncDirectory(join(stagingDir, 'artifacts'))
    bestEffortFsyncDirectory(stagingDir)
    mkdirSync(queuedRoot(opts.knowledgeRoot), { recursive: true })
    try {
      renameSync(stagingDir, finalDir)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if ((code === 'EEXIST' || code === 'ENOTEMPTY') && existsSync(finalDir)) {
        return 'coalesced'
      }
      throw error
    }
    bestEffortFsyncDirectory(queuedRoot(opts.knowledgeRoot))
    return 'enqueued'
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
    removeEmptyDir(stagingRoot)
  }
}
