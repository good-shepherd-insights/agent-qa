import { CURRENT_HANDOFF_SCHEMA_VERSION } from './completed-run-handoff'
import type { CompletedRunHandoff } from './completed-run-handoff'
import {
  createVersionGuard,
  VersionGuardError,
} from '../versioning/create-version-guard'
import type { MigrationRegistry } from '../versioning/create-version-guard'

/**
 * Thrown when a stored handoff declares a `schemaVersion` this build cannot consume:
 * either newer than {@link CURRENT_HANDOFF_SCHEMA_VERSION} (forward-incompatible) or an
 * older version with no registered migration (D-19, §A8 version discipline).
 */
export class HandoffVersionError extends VersionGuardError {
  constructor(found: number, supported: number) {
    super('CompletedRunHandoff', found, supported)
    this.name = 'HandoffVersionError'
  }
}

/**
 * The older-version migration seam (D-19). Maps a source `schemaVersion` to a function
 * that upgrades a document of that version to the next. The seam exists so every future
 * consumer imports the ONE guard instead of re-implementing the version rule.
 */
export const HANDOFF_MIGRATIONS: MigrationRegistry = {
  /** v2 → v3 (D-01): rootCause is optional-additive; v2 handoffs load unchanged. */
  2: (doc) => doc,
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonNullObject(value: unknown): value is object {
  return value !== null && typeof value === 'object'
}

const PLAN_SOURCE_MISS_REASONS = new Set<string>([
  'descriptor-ambiguous',
  'descriptor-missing',
  'page-anchor-mismatch',
  'gate-refused',
  'parameter-unbound',
  'non-replayable-action',
])

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

const TEST_BUG_SUBTYPES = new Set<string>([
  'stale_selector',
  'outdated_flow',
  'bad_assertion',
  'wrong_expected_value',
])

function hasProcedureStepIndexShape(value: unknown): boolean {
  return isNonArrayObject(value) && typeof value.procedureStepIndex === 'number'
}

/**
 * Validates a present `planSource` against the complete discriminated StepPlanSource
 * union (D-12): canary projection dereferences the replay guard's fold fields, so an
 * admitted procedure-replay source must carry them in full (CR-02).
 */
function hasCompletePlanSourceShape(value: unknown): boolean {
  if (!isNonArrayObject(value)) return false
  if (typeof value.procedureId !== 'string' || value.procedureId.length === 0) {
    return false
  }
  if (value.kind === 'procedure-hint') return true
  if (value.kind !== 'procedure-replay') return false

  const guard = value.guard
  if (!isNonArrayObject(guard)) return false
  if (typeof guard.checksPassed !== 'number' || typeof guard.total !== 'number') {
    return false
  }
  if ('miss' in guard) {
    const miss = guard.miss
    if (!isNonArrayObject(miss)) return false
    if (typeof miss.procedureStepIndex !== 'number') return false
    if (
      typeof miss.reason !== 'string' ||
      !PLAN_SOURCE_MISS_REASONS.has(miss.reason)
    ) {
      return false
    }
  }
  if ('executionFailure' in guard && !hasProcedureStepIndexShape(guard.executionFailure)) {
    return false
  }
  if ('verifierRejection' in guard && !hasProcedureStepIndexShape(guard.verifierRejection)) {
    return false
  }
  return true
}

/**
 * Validates a present `rootCause` against the complete Verdict shape: candidate
 * emission traverses `evidence.citedSteps`/`citedAnchors`/`citedArtifacts`/`rationale`,
 * so an admitted verdict must carry them in consumer-traversable form (CR-02).
 */
function hasCompleteRootCauseShape(value: unknown): boolean {
  if (!isNonArrayObject(value)) return false
  if (typeof value.class !== 'string' || !VERDICT_CLASSES.has(value.class)) {
    return false
  }
  if (
    value.producer !== 'deterministic-classifier' &&
    value.producer !== 'analyze-run'
  ) {
    return false
  }
  if (typeof value.confidence !== 'number') return false

  const evidence = value.evidence
  if (!isNonArrayObject(evidence)) return false
  if (
    !Array.isArray(evidence.citedSteps) ||
    !evidence.citedSteps.every((step) => typeof step === 'number')
  ) {
    return false
  }
  if (
    !Array.isArray(evidence.citedAnchors) ||
    !evidence.citedAnchors.every(isNonNullObject)
  ) {
    return false
  }
  if (
    !Array.isArray(evidence.citedArtifacts) ||
    !evidence.citedArtifacts.every(isNonNullObject)
  ) {
    return false
  }
  if (typeof evidence.rationale !== 'string') return false

  if (typeof value.memoryMisdirectionRuledOut !== 'boolean') return false
  if (typeof value.perTest !== 'number') return false

  if ('attribution' in value) {
    const attribution = value.attribution
    if (!isNonArrayObject(attribution)) return false
    if (!Array.isArray(attribution.records) || !Array.isArray(attribution.anchors)) {
      return false
    }
  }
  if ('subtype' in value) {
    if (value.class !== 'test_bug') return false
    if (
      typeof value.subtype !== 'string' ||
      !TEST_BUG_SUBTYPES.has(value.subtype)
    ) {
      return false
    }
  }
  return true
}

function hasCompleteStepShape(value: unknown): boolean {
  if (!isNonArrayObject(value)) return false

  const servedBrief = value.servedBrief
  const verifierVerdict = value.verifierVerdict

  return (
    typeof value.stepIndex === 'number' &&
    typeof value.stepText === 'string' &&
    (value.cacheStatus === 'hit' ||
      value.cacheStatus === 'miss' ||
      value.cacheStatus === 'bypass') &&
    isNonArrayObject(servedBrief) &&
    Array.isArray(servedBrief.channel1) &&
    Array.isArray(value.subActions) &&
    isNonArrayObject(verifierVerdict) &&
    typeof verifierVerdict.pass === 'boolean' &&
    typeof verifierVerdict.reasoning === 'string' &&
    (!('planSource' in value) || hasCompletePlanSourceShape(value.planSource))
  )
}

function hasCompleteTestShape(value: unknown): boolean {
  if (!isNonArrayObject(value)) return false

  return (
    typeof value.testId === 'string' &&
    typeof value.testName === 'string' &&
    value.testName.length > 0 &&
    typeof value.filePath === 'string' &&
    value.filePath.length > 0 &&
    typeof value.testIndex === 'number' &&
    (value.outcome === 'passed' ||
      value.outcome === 'failed' ||
      value.outcome === 'healed' ||
      value.outcome === 'timeout' ||
      value.outcome === 'cancelled' ||
      value.outcome === 'skipped') &&
    Array.isArray(value.steps) &&
    value.steps.every(hasCompleteStepShape) &&
    (!('rootCause' in value) || hasCompleteRootCauseShape(value.rootCause))
  )
}

/**
 * Guarantees every required root field plus the required fields on each per-test outcome
 * and traversed step before a handoff reaches direct consumers (WR-01), including the
 * complete discriminated shapes of the two traversed optional blocks — `planSource` and
 * `rootCause` (CR-02). Only genuinely untraversed deep evidence (workingMemory, decision
 * context, stagnation) stays unvalidated at this load boundary.
 */
function hasCompleteHandoffShape(value: unknown): boolean {
  if (!isNonArrayObject(value)) return false

  const scope = value.scope
  const configDigests = value.configDigests

  return (
    typeof value.schemaVersion === 'number' &&
    typeof value.runId === 'string' &&
    value.runId.length > 0 &&
    isNonArrayObject(scope) &&
    (scope.tier === 'global' ||
      scope.tier === 'product' ||
      scope.tier === 'suite' ||
      scope.tier === 'test') &&
    typeof scope.key === 'string' &&
    scope.key.length > 0 &&
    typeof value.buildOrdinal === 'number' &&
    (!('excludedFromOutcomes' in value) || value.excludedFromOutcomes === true) &&
    (value.executionContext === 'local-interactive' ||
      value.executionContext === 'local-headless' ||
      value.executionContext === 'ci' ||
      value.executionContext === 'cloud') &&
    (value.aggregateVerdict === 'passed' ||
      value.aggregateVerdict === 'failed' ||
      value.aggregateVerdict === 'healed' ||
      value.aggregateVerdict === 'timeout' ||
      value.aggregateVerdict === 'cancelled') &&
    isNonArrayObject(configDigests) &&
    typeof configDigests.suiteConfigDigest === 'string' &&
    typeof configDigests.testConfigDigest === 'string' &&
    typeof value.startedAt === 'number' &&
    typeof value.endedAt === 'number' &&
    Array.isArray(value.tests) &&
    value.tests.every(hasCompleteTestShape)
  )
}

/**
 * The read side of the handoff version discipline (D-19): parse → version check →
 * reject-newer-than-known with a typed {@link HandoffVersionError} → migrate-older through
 * {@link HANDOFF_MIGRATIONS}. Pure — no fs (the runner-local fs leg lands in Plan 07 and
 * delegates here). Every future handoff consumer routes through this one guard.
 */
export const guardCompletedRunHandoff = createVersionGuard<CompletedRunHandoff>({
  name: 'CompletedRunHandoff',
  current: CURRENT_HANDOFF_SCHEMA_VERSION,
  migrations: HANDOFF_MIGRATIONS,
  error: HandoffVersionError,
  shape: hasCompleteHandoffShape,
})
