import type { SubActionEvidence } from '@vostride/agent-qa-schema'
import type { CassetteCompleteness, MissingCassetteEvidence } from '../cassette/completeness'
import type { CassetteInputLeg } from '../cassette/input-leg'
import type { ArtifactSource } from '../ports'

/** One content-addressed byte payload resolved in memory for a cassette bundle (D-08). */
export interface ExtractedBlob {
  sha: string
  bytes: Uint8Array
}

export interface ResolvedBlobClosure {
  blobs: ExtractedBlob[]
  missingShas: string[]
}

export interface BuildCompletenessInput {
  missingShas: readonly string[]
  anchorUnresolved: boolean
  unresolvedAnchorRef?: string
}

/**
 * Classify required screenshot identity from Plan 12's authoritative persisted modality.
 * Only `stateBefore.metadata.captureMode === 'full'` proves image evidence was attached;
 * a usable dedicated ref satisfies identity even when its bytes are later unavailable (T-367-20).
 */
export function missingRequiredEvidence(input: CassetteInputLeg): MissingCassetteEvidence[] {
  if (input.stateBefore.metadata.captureMode !== 'full') return []

  const ref = input.decisionScreenshotRef
  if (ref !== undefined && ref.evidenceIncomplete !== true) return []

  return [
    {
      kind: 'decision-screenshot-ref',
      stepIndex: input.stepIndex,
      decisionOrdinal: input.decisionOrdinal,
    },
  ]
}

/** Collect the ordered, deduplicated closure demanded by present artifact refs (D-11). */
export function collectBlobShas(subAction: SubActionEvidence): string[] {
  const shas: string[] = []
  const seen = new Set<string>()
  const append = (sha: string): void => {
    if (seen.has(sha)) return
    seen.add(sha)
    shas.push(sha)
  }

  if (subAction.decisionScreenshotRef !== undefined) {
    append(subAction.decisionScreenshotRef.sha)
  }
  for (const artifact of subAction.artifactRefs ?? []) append(artifact.sha)

  return shas
}

/** Resolve every demanded digest while preserving served bytes when siblings are absent (D-11). */
export function resolveBlobClosure(
  shas: readonly string[],
  artifacts: ArtifactSource,
): ResolvedBlobClosure {
  const blobs: ExtractedBlob[] = []
  const missingShas: string[] = []

  for (const sha of shas) {
    const bytes = artifacts.getBlob(sha)
    if (bytes === undefined) missingShas.push(sha)
    else blobs.push({ sha, bytes })
  }

  return { blobs, missingShas }
}

/** Fold independent missing-evidence facts into the single D-11 status vocabulary. */
export function buildCompleteness(input: BuildCompletenessInput): CassetteCompleteness {
  const hasMissingBlobs = input.missingShas.length > 0
  const status = hasMissingBlobs
    ? 'evidence-incomplete'
    : input.anchorUnresolved
      ? 'anchor-unresolved'
      : 'complete'

  return {
    status,
    ...(hasMissingBlobs ? { missingBlobShas: [...input.missingShas] } : {}),
    ...(input.anchorUnresolved && input.unresolvedAnchorRef !== undefined
      ? { unresolvedAnchorRef: input.unresolvedAnchorRef }
      : {}),
  }
}
