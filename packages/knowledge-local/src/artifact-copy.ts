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

export function copyArtifacts(
  _inputs: readonly ArtifactCopyInput[],
  _destArtifactsDir: string,
): ArtifactCopyResult {
  throw new Error('artifact-copy behavior is not implemented')
}
