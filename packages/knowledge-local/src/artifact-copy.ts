// Binary artifact bytes land only in the gitignore-covered artifacts/ directory and bypass the
// committed-text checkpoint, following the eval-local blob precedent (BNDL-01/D-13). The writer
// commits a separately checkpointed inventory containing only this function's `copied` rows.
// Credential-region masking belongs to SAFE-02 in Phase 378; this layer verifies content hashes,
// enforces copied-byte caps, and never emits a row before its content-addressed file exists.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ArtifactRef } from '@vostride/agent-qa-schema'

export const ARTIFACT_STEP_CAP_BYTES = 2 * 1024 * 1024
export const ARTIFACT_RUN_CAP_BYTES = 25 * 1024 * 1024

export interface ArtifactCopyInput {
  ref: ArtifactRef
  sourcePath: string
  stepIndex: number
  role?: string
  originalName?: string
}

export interface CopiedArtifact {
  ref: ArtifactRef
  relPath: string
  bytes: number
  stepIndex: number
  role?: string
  originalName?: string
}

export interface SkippedArtifact {
  ref: ArtifactRef
  stepIndex: number
  reason: 'step-cap' | 'run-cap' | 'pruned-source' | 'sha-mismatch'
}

export interface ArtifactCopyResult {
  copied: CopiedArtifact[]
  skipped: SkippedArtifact[]
  evidenceIncomplete: boolean
}

const ARTIFACT_SHA_RE = /^[0-9a-f]{64}$/

function byteSha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function copiedRow(input: ArtifactCopyInput, bytes: number): CopiedArtifact {
  return {
    ref: input.ref,
    relPath: `artifacts/${input.ref.sha}`,
    bytes,
    stepIndex: input.stepIndex,
    ...(input.role === undefined ? {} : { role: input.role }),
    ...(input.originalName === undefined ? {} : { originalName: input.originalName }),
  }
}

function skippedRow(
  input: ArtifactCopyInput,
  reason: SkippedArtifact['reason'],
): SkippedArtifact {
  return { ref: input.ref, stepIndex: input.stepIndex, reason }
}

export function copyArtifacts(
  inputs: readonly ArtifactCopyInput[],
  destArtifactsDir: string,
): ArtifactCopyResult {
  const copied: CopiedArtifact[] = []
  const skipped: SkippedArtifact[] = []
  const copiedBytesByStep = new Map<number, number>()
  let copiedBytesForRun = 0

  mkdirSync(destArtifactsDir, { recursive: true })

  for (const input of inputs) {
    if (!ARTIFACT_SHA_RE.test(input.ref.sha)) {
      skipped.push(skippedRow(input, 'sha-mismatch'))
      continue
    }

    let sourceBytes: Buffer
    try {
      sourceBytes = readFileSync(input.sourcePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        skipped.push(skippedRow(input, 'pruned-source'))
        continue
      }
      throw error
    }

    if (byteSha(sourceBytes) !== input.ref.sha) {
      skipped.push(skippedRow(input, 'sha-mismatch'))
      continue
    }

    const targetPath = join(destArtifactsDir, input.ref.sha)
    if (existsSync(targetPath)) {
      const existingBytes = readFileSync(targetPath)
      if (byteSha(existingBytes) !== input.ref.sha || !existingBytes.equals(sourceBytes)) {
        skipped.push(skippedRow(input, 'sha-mismatch'))
        continue
      }
      copied.push(copiedRow(input, sourceBytes.byteLength))
      continue
    }

    const stepBytes = copiedBytesByStep.get(input.stepIndex) ?? 0
    if (stepBytes + sourceBytes.byteLength > ARTIFACT_STEP_CAP_BYTES) {
      skipped.push(skippedRow(input, 'step-cap'))
      continue
    }
    if (copiedBytesForRun + sourceBytes.byteLength > ARTIFACT_RUN_CAP_BYTES) {
      skipped.push(skippedRow(input, 'run-cap'))
      continue
    }

    try {
      writeFileSync(targetPath, sourceBytes, { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existingBytes = readFileSync(targetPath)
      if (byteSha(existingBytes) !== input.ref.sha || !existingBytes.equals(sourceBytes)) {
        skipped.push(skippedRow(input, 'sha-mismatch'))
        continue
      }
      copied.push(copiedRow(input, sourceBytes.byteLength))
      continue
    }

    copiedBytesByStep.set(input.stepIndex, stepBytes + sourceBytes.byteLength)
    copiedBytesForRun += sourceBytes.byteLength
    copied.push(copiedRow(input, sourceBytes.byteLength))
  }

  return { copied, skipped, evidenceIncomplete: skipped.length > 0 }
}
