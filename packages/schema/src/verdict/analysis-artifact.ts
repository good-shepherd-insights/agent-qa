// The run-directory analysis artifact (Phase 389, D-09).
//
// `analysis.json` is the analysis job's own receipt and the durable truth home for a run's
// authored verdicts and sentence parts — the document M5's run page, 392's chat and eval will
// consume. It is a NEW file beside `handoff.json` and `events.jsonl`, never a mutation of
// either (386 D-16's two-receipt law): the handoff records what the run observed, this file
// records what the analysis authored, and each job writes only its own receipt.
//
// The guard is pure — no fs in schema. The host adapter that puts these bytes on disk lives
// in `agent-local` (`writeAnalysisArtifact`), behind the `persistAnalysis` capability.

import {
  createVersionGuard,
  VersionGuardError,
} from '../versioning/create-version-guard'
import type { MigrationRegistry } from '../versioning/create-version-guard'
import { VerdictSentencePartsSchema } from './sentence-parts'
import type { VerdictSentenceParts } from './sentence-parts'
import type { Verdict } from './verdict'

export const CURRENT_ANALYSIS_SCHEMA_VERSION = 1

/** The artifact's file name inside a run directory: `runs/<slug(runId)>/analysis.json`. */
export const ANALYSIS_FILE = 'analysis.json'

/**
 * What one analysis run durably authored (D-09).
 *
 * `verdicts` is the complete authored array — floor members and upgraded members alike —
 * and `parts` carries one sentence-parts record per verdict, joined by `perTest` (D-07).
 * The `verdicts-authored` checkpoint value stays byte-shape `{runId, verdicts}` exactly as
 * 388 froze it (388 D-02); parts live HERE and nowhere else.
 */
export interface RunAnalysisArtifact {
  schemaVersion: number
  runId: string
  verdicts: Verdict[]
  parts: VerdictSentenceParts[]
}

/**
 * Thrown when a stored artifact declares a `schemaVersion` this build cannot consume:
 * newer than {@link CURRENT_ANALYSIS_SCHEMA_VERSION}, or older with no registered
 * migration (the D-19 / §A8 version discipline the handoff guard set).
 */
export class AnalysisVersionError extends VersionGuardError {
  constructor(found: number, supported: number) {
    super('RunAnalysisArtifact', found, supported)
    this.name = 'AnalysisVersionError'
  }
}

/** The older-version migration seam — empty at version 1, registered so growth is additive. */
export const ANALYSIS_MIGRATIONS: MigrationRegistry = {}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const VERDICT_CLASSES = new Set<string>([
  'test_bug',
  'app_bug',
  'environment',
  'flake',
  'config_error',
  'llm_error',
  'unknown',
  'timeout',
])

/**
 * Structural check on one stored verdict, at the depth the artifact's consumers traverse:
 * class inside the closed union, a declared producer, and consumer-traversable evidence
 * arrays — the same discipline the handoff guard applies to a present `rootCause`.
 */
function hasVerdictShape(value: unknown): boolean {
  if (!isNonArrayObject(value)) return false
  if (typeof value.class !== 'string' || !VERDICT_CLASSES.has(value.class)) return false
  if (
    value.producer !== 'deterministic-classifier' &&
    value.producer !== 'analyze-run'
  ) {
    return false
  }
  if (typeof value.confidence !== 'number') return false
  const evidence = value.evidence
  if (!isNonArrayObject(evidence)) return false
  if (!Array.isArray(evidence.citedSteps)) return false
  if (!Array.isArray(evidence.citedAnchors)) return false
  if (!Array.isArray(evidence.citedArtifacts)) return false
  if (typeof evidence.rationale !== 'string') return false
  if (typeof value.memoryMisdirectionRuledOut !== 'boolean') return false
  if (typeof value.perTest !== 'number') return false
  return true
}

/**
 * The artifact's fail-closed shape: root fields, every verdict structurally complete, and
 * every parts record parsed through the ONE zod contract — which is what routes each
 * `links` member through `EntityUriSchema` (T-389-02) rather than a bare string check.
 */
function hasCompleteArtifactShape(value: unknown): boolean {
  if (!isNonArrayObject(value)) return false
  return (
    typeof value.schemaVersion === 'number' &&
    typeof value.runId === 'string' &&
    value.runId.length > 0 &&
    Array.isArray(value.verdicts) &&
    value.verdicts.every(hasVerdictShape) &&
    Array.isArray(value.parts) &&
    value.parts.every((part) => VerdictSentencePartsSchema.safeParse(part).success)
  )
}

/**
 * The read side of the artifact version discipline: parse → reject-newer with a typed
 * {@link AnalysisVersionError} → migrate-older through {@link ANALYSIS_MIGRATIONS} →
 * structural check. Every future artifact consumer routes through this one guard.
 */
export const guardRunAnalysisArtifact = createVersionGuard<RunAnalysisArtifact>({
  name: 'RunAnalysisArtifact',
  current: CURRENT_ANALYSIS_SCHEMA_VERSION,
  migrations: ANALYSIS_MIGRATIONS,
  error: AnalysisVersionError,
  shape: hasCompleteArtifactShape,
})
