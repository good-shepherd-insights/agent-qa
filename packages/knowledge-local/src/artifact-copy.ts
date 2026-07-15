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
export const ARTIFACT_VALUE_REDACTION_PLACEHOLDER = '<REDACTED:capture-blacklist>'

export interface ArtifactCopyInput {
  ref: ArtifactRef
  sourcePath: string
  stepIndex: number
  role?: string
  originalName?: string
  /** Exact values to replace before hashing and copying a textual DOM/AX snapshot. */
  redactValues?: readonly string[]
}

export interface CopiedArtifact {
  ref: ArtifactRef
  relPath: string
  bytes: number
  stepIndex: number
  role?: string
  originalName?: string
}

export type ArtifactCopySkipReason =
  | 'step-cap'
  | 'run-cap'
  | 'pruned-source'
  | 'sha-mismatch'

export interface SkippedArtifact<Reason extends string = ArtifactCopySkipReason> {
  ref: ArtifactRef
  stepIndex: number
  reason: Reason
}

export interface ArtifactCopyResult<AdditionalReason extends string = never> {
  copied: CopiedArtifact[]
  skipped: SkippedArtifact<ArtifactCopySkipReason | AdditionalReason>[]
  evidenceIncomplete: boolean
}

export interface ArtifactCopyOptions<AdditionalReason extends string = never> {
  /** Pre-copy filter refusals retained in the same inventory as copy-time refusals. */
  preSkipped?: readonly SkippedArtifact<AdditionalReason>[]
}

const ARTIFACT_SHA_RE = /^[0-9a-f]{64}$/

function byteSha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function copiedRow(
  input: ArtifactCopyInput,
  ref: ArtifactRef,
  bytes: number,
): CopiedArtifact {
  return {
    ref,
    relPath: `artifacts/${ref.sha}`,
    bytes,
    stepIndex: input.stepIndex,
    ...(input.role === undefined ? {} : { role: input.role }),
    ...(input.originalName === undefined ? {} : { originalName: input.originalName }),
  }
}

function redactArtifactValues(bytes: Buffer, values: readonly string[] | undefined): Buffer {
  if (values === undefined || values.length === 0) return bytes

  let text = bytes.toString('utf8')
  for (const value of [...new Set(values)].filter(Boolean).sort((left, right) =>
    right.length - left.length || left.localeCompare(right),
  )) {
    text = text.split(value).join(ARTIFACT_VALUE_REDACTION_PLACEHOLDER)
  }
  return Buffer.from(text)
}

function skippedRow(
  input: ArtifactCopyInput,
  reason: ArtifactCopySkipReason,
): SkippedArtifact<ArtifactCopySkipReason> {
  return { ref: input.ref, stepIndex: input.stepIndex, reason }
}

export function copyArtifacts<AdditionalReason extends string = never>(
  inputs: readonly ArtifactCopyInput[],
  destArtifactsDir: string,
  options: ArtifactCopyOptions<AdditionalReason> = {},
): ArtifactCopyResult<AdditionalReason> {
  const copied: CopiedArtifact[] = []
  const skipped: SkippedArtifact<ArtifactCopySkipReason | AdditionalReason>[] = [
    ...(options.preSkipped ?? []),
  ]
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

    const copyBytes = redactArtifactValues(sourceBytes, input.redactValues)
    const copiedRef = copyBytes.equals(sourceBytes)
      ? input.ref
      : { ...input.ref, sha: byteSha(copyBytes) }
    const targetPath = join(destArtifactsDir, copiedRef.sha)
    if (existsSync(targetPath)) {
      const existingBytes = readFileSync(targetPath)
      if (byteSha(existingBytes) !== copiedRef.sha || !existingBytes.equals(copyBytes)) {
        skipped.push(skippedRow(input, 'sha-mismatch'))
        continue
      }
      copied.push(copiedRow(input, copiedRef, copyBytes.byteLength))
      continue
    }

    const stepBytes = copiedBytesByStep.get(input.stepIndex) ?? 0
    if (stepBytes + copyBytes.byteLength > ARTIFACT_STEP_CAP_BYTES) {
      skipped.push(skippedRow(input, 'step-cap'))
      continue
    }
    if (copiedBytesForRun + copyBytes.byteLength > ARTIFACT_RUN_CAP_BYTES) {
      skipped.push(skippedRow(input, 'run-cap'))
      continue
    }

    try {
      writeFileSync(targetPath, copyBytes, { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existingBytes = readFileSync(targetPath)
      if (byteSha(existingBytes) !== copiedRef.sha || !existingBytes.equals(copyBytes)) {
        skipped.push(skippedRow(input, 'sha-mismatch'))
        continue
      }
      copied.push(copiedRow(input, copiedRef, copyBytes.byteLength))
      continue
    }

    copiedBytesByStep.set(input.stepIndex, stepBytes + copyBytes.byteLength)
    copiedBytesForRun += copyBytes.byteLength
    copied.push(copiedRow(input, copiedRef, copyBytes.byteLength))
  }

  return { copied, skipped, evidenceIncomplete: skipped.length > 0 }
}
