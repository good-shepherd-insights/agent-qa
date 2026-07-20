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

/**
 * Validates an ElementInfo member of `stateBefore.elements` at the VALUE level the
 * load-boundary consumers operate on: locatorForElement applies `.trim()` to attribute
 * values and `.replaceAll()` to attribute/label values, and elementAnchor mints `el`
 * anchors from `role`/`nameNormalized` that normalizeAnchor string-normalizes
 * (normalizeHumanText). Rejects no honest document: `role` and `nameNormalized` are
 * required strings on ElementInfo, `attributes` is Record<string,string>, and every
 * ElementLabels member is an optional string.
 */
function hasCompleteElementShape(value: unknown): boolean {
  if (!isNonArrayObject(value)) return false
  if (typeof value.role !== 'string') return false
  if (typeof value.nameNormalized !== 'string') return false
  const attributes = value.attributes
  const labels = value.labels
  return (
    isNonArrayObject(attributes) &&
    Object.values(attributes).every((member) => typeof member === 'string') &&
    isNonArrayObject(labels) &&
    Object.values(labels).every((member) => typeof member === 'string')
  )
}

/**
 * Validates a `subActions` element against the consumer-dereferenced surface: actionRefs
 * applies the `in` operator to `plannedAction`, resolvedElementEvidence/captureEvidence
 * walk `stateBefore.elements`, and resolvedActionRefs flatMaps `grounding.attempts` for
 * EVERY subAction — so a present `grounding` must be a non-array object and present
 * `attempts` an array of non-array objects (absence stays legal: the consumer's `?? []`
 * handles it; attempt interiors stay unvalidated because the consumer's `outcome`
 * strict-equality and `resolvedRef` undefined-check reads are crash-safe on any
 * non-null object). classifySubActionRoute reads BOTH `stateBefore.url` and
 * `stateAfter?.url`, and when both are defined and differ it mints the AFTER leg as
 * the navigated `page` Anchor route normalizeAnchor trims — so both urls must be
 * strings when present. `stateAfter` absence stays legal (the consumer's optional
 * chain handles it); when present it must be a non-array object, and its interiors
 * beyond `url` stay unvalidated because no load-boundary consumer dereferences them.
 * `stateBefore.platform` stays unvalidated — its only read is an absence-safe
 * identity join.
 */
function hasCompleteSubActionShape(value: unknown): boolean {
  if (!isNonArrayObject(value)) return false
  if (!isNonArrayObject(value.plannedAction)) return false
  if ('grounding' in value) {
    const grounding = value.grounding
    if (!isNonArrayObject(grounding)) return false
    if (
      'attempts' in grounding &&
      (!Array.isArray(grounding.attempts) ||
        !grounding.attempts.every(isNonArrayObject))
    ) {
      return false
    }
  }
  const stateBefore = value.stateBefore
  if (!isNonArrayObject(stateBefore)) return false
  if ('url' in stateBefore && typeof stateBefore.url !== 'string') return false
  if (
    !Array.isArray(stateBefore.elements) ||
    !stateBefore.elements.every(hasCompleteElementShape)
  ) {
    return false
  }
  if ('stateAfter' in value) {
    const stateAfter = value.stateAfter
    if (!isNonArrayObject(stateAfter)) return false
    if ('url' in stateAfter && typeof stateAfter.url !== 'string') return false
  }
  return true
}

/**
 * Mirrors the six-kind Anchor union (discriminant `t` plus its payload) so every
 * guard-admitted `citedAnchors` member survives normalizeAnchor in the curator drain (WR-02).
 */
function isAnchorShape(value: unknown): boolean {
  if (!isNonArrayObject(value)) return false
  switch (value.t) {
    case 'page':
      return typeof value.route === 'string'
    case 'flow':
      return typeof value.name === 'string'
    case 'el':
      return (
        typeof value.role === 'string' &&
        typeof value.name === 'string' &&
        (!('ordinal' in value) || typeof value.ordinal === 'number')
      )
    case 'platform':
      return (
        value.platform === 'web' ||
        value.platform === 'android' ||
        value.platform === 'ios'
      )
    case 'selector':
      return typeof value.literal === 'string'
    case 'error':
      return typeof value.message === 'string'
    default:
      return false
  }
}

/**
 * Requires string `id`/`sha` so artifact descriptor mapping is total (`ref.id.startsWith`
 * runs once the sha regex passes); hex-format enforcement stays the consumer's filter (WR-02).
 */
function isArtifactRefShape(value: unknown): boolean {
  return (
    isNonArrayObject(value) &&
    typeof value.id === 'string' &&
    typeof value.sha === 'string'
  )
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
    !evidence.citedAnchors.every(isAnchorShape)
  ) {
    return false
  }
  if (
    !Array.isArray(evidence.citedArtifacts) ||
    !evidence.citedArtifacts.every(isArtifactRefShape)
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

/**
 * Validates a present `interpolatedVariables` at the depth its one consumer dereferences
 * (381 G-381-3): the procedure-extraction emit fold applies exact string equality against
 * `value` to classify a trajectory value slot and copies `name` VERBATIM as the forced
 * parameter name — so every admitted member must be a non-array object carrying string
 * `name` AND string `value`, and nothing deeper exists to validate. Absence stays legal
 * (the field is additive-optional; a step that interpolated nothing omits it), and an
 * empty array is legal emptiness, distinct from malformed.
 */
function hasCompleteInterpolatedVariablesShape(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (member) =>
        isNonArrayObject(member) &&
        typeof member.name === 'string' &&
        typeof member.value === 'string',
    )
  )
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
    servedBrief.channel1.every(isNonArrayObject) &&
    Array.isArray(value.subActions) &&
    value.subActions.every(hasCompleteSubActionShape) &&
    isNonArrayObject(verifierVerdict) &&
    typeof verifierVerdict.pass === 'boolean' &&
    typeof verifierVerdict.reasoning === 'string' &&
    (!('planSource' in value) || hasCompletePlanSourceShape(value.planSource)) &&
    (!('interpolatedVariables' in value) ||
      hasCompleteInterpolatedVariablesShape(value.interpolatedVariables))
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
 * and traversed step before a handoff reaches direct consumers, including the complete
 * discriminated shapes of the two traversed optional blocks — `planSource` and `rootCause`
 * (CR-02) — the string `name`/`value` of every present `interpolatedVariables` member, the
 * pair the emit fold value-matches and name-copies (G-381-3 capture half; absence and
 * emptiness both stay legal) — the element shapes of the consumer-traversed arrays — every `subActions` member
 * is dereferenceable through `plannedAction`, `grounding.attempts` (flatMapped by
 * resolvedActionRefs for every subAction), and `stateBefore.elements[]` down to the
 * string values consumers apply string operations to: string `role`/`nameNormalized`,
 * all-string `attributes`/`labels` member values, and string-if-present urls on BOTH
 * `stateBefore` and `stateAfter` — the two legs classifySubActionRoute reads
 * (CR-01/WR-01 grounding-depth and value-level closure; round-9 CR-01 stateAfter-url
 * closure); every `servedBrief.channel1`
 * member is a non-array object — and the `rootCause.evidence` members: `citedAnchors`
 * satisfy the six-kind Anchor union and `citedArtifacts` carry string id/sha (WR-02).
 * Only genuinely untraversed deep evidence — verified untraversed at the consumers'
 * dereference sites (handoff-anchors.ts, emit-candidates.ts, emit-canary-outcomes.ts,
 * normalize-anchor.ts) — stays unvalidated at this load boundary: workingMemory,
 * decision context, stagnation, cycle, planning failure, stateAfter interiors beyond
 * url, `grounding.descriptor` and attempt interiors (stage/outcome/resolvedRef value
 * types), and element state/bounds/hierarchy; element name/value are read by
 * captureEvidence (emit-candidates.ts) but only carried without string operations,
 * so they stay unvalidated as read-but-crash-safe reads.
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
