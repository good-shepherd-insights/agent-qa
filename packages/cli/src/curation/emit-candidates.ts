import { isAbsolute, join } from 'node:path'

import { z } from 'zod'

import {
  enqueueCurationCandidateProjection,
  type CurationCandidateProjection,
  type CurationProjectionArtifactSource,
  type EnqueueCurationCandidateProjectionOutcome,
} from '@vostride/agent-qa-knowledge-local'
import { RUN_EVIDENCE_BLOBS_SUBDIR } from '@vostride/agent-qa-runner-local'
import {
  canonicalJson,
  DISTILLED_OBSERVATION_SCHEMA_VERSION,
  deriveEvidenceToken,
  elementOrdinal,
  isCredentialValueField,
  procedureJsonValueSchema,
  type Anchor,
  type ArtifactRef,
  type CautionRootCauseClass,
  type CompletedRunHandoff,
  type DistilledObservation,
  type FactSubtype,
  type GuardrailPolicy,
  type PerTestOutcome,
  type Platform,
  type ProcedureJsonValue,
  type StepEvidence,
  type SubActionEvidence,
} from '@vostride/agent-qa-schema'
import { detectEmails, getActiveMaskingContext, scan } from '@vostride/agent-qa-safety'

import {
  actionRefs,
  classifySubActionRoute,
  elementAnchor,
  elementNaturalKey,
  exercisedAnchors,
  resolvedElementEvidence,
  uniqueAnchors,
  type ResolvedElementEvidence,
} from './handoff-anchors.js'

export const LEARNABLE_CAUTION_ROOT_CAUSES = [
  'environment',
  'timeout',
  'flake',
] as const satisfies readonly CautionRootCauseClass[]

interface MeasurementSeed {
  metric: string
  value: string
}

type CurationArtifactDescriptor =
  CurationCandidateProjection['artifactDescriptors'][number]
type CaptureElementEvidence =
  CurationCandidateProjection['captureEvidence']['elements'][number]
type CaptureStepInteraction =
  CurationCandidateProjection['stepInteractions'][number]

type CandidateInjectionEvidence = Pick<
  CurationCandidateProjection,
  | 'anchors'
  | 'summarySeed'
  | 'bodySeed'
  | 'distilledObservations'
  | 'captureEvidence'
>

const SHA256_HEX = /^[0-9a-f]{64}$/

function observationId(
  handoff: CompletedRunHandoff,
  testIndex: number,
  stepIndex: number,
): string {
  return `${handoff.runId}:test-${testIndex}:step-${stepIndex}`
}

function observationPlatform(platform: Platform): 'web' | 'mobile' {
  return platform === 'web' ? 'web' : 'mobile'
}

function artifactDescriptor(
  ref: ArtifactRef,
  stepIndex: number,
  forcedRole?: CurationArtifactDescriptor['role'],
): CurationArtifactDescriptor {
  const role = forcedRole
    ?? (ref.id.startsWith('decision-screenshot:')
      ? 'screenshot'
      : ref.id.startsWith('dom-snapshot:')
        ? 'dom-snapshot'
        : ref.id.startsWith('ax-snapshot:')
          ? 'ax-snapshot'
          : 'opaque-evidence')
  const originalName = role === 'screenshot'
    ? 'decision-screenshot.png'
    : role === 'dom-snapshot'
      ? 'dom-snapshot.json'
      : role === 'ax-snapshot'
        ? 'ax-snapshot.json'
        : 'opaque-evidence.bin'
  return { ref, stepIndex, role, originalName }
}

function artifactDescriptorsForRefs(
  refs: readonly ArtifactRef[],
  stepIndex: number,
): CurationArtifactDescriptor[] {
  const seen = new Set<string>()
  const descriptors: CurationArtifactDescriptor[] = []
  for (const ref of refs) {
    if (!SHA256_HEX.test(ref.sha) || seen.has(ref.id)) continue
    seen.add(ref.id)
    descriptors.push(artifactDescriptor(ref, stepIndex))
  }
  return descriptors
}

function stepArtifactDescriptors(step: StepEvidence): CurationArtifactDescriptor[] {
  const descriptors = step.subActions.flatMap((subAction) => [
    ...(subAction.decisionScreenshotRef === undefined
      || !SHA256_HEX.test(subAction.decisionScreenshotRef.sha)
      ? []
      : [artifactDescriptor(
          subAction.decisionScreenshotRef,
          step.stepIndex,
          'screenshot',
        )]),
    ...artifactDescriptorsForRefs(subAction.artifactRefs ?? [], step.stepIndex),
  ])
  const seen = new Set<string>()
  return descriptors.filter((descriptor) => {
    if (seen.has(descriptor.ref.id)) return false
    seen.add(descriptor.ref.id)
    return true
  })
}

function captureEvidence(steps: readonly StepEvidence[]): {
  elements: CaptureElementEvidence[]
} {
  return {
    elements: steps.flatMap((step) =>
      step.subActions.flatMap((subAction) =>
        subAction.stateBefore.elements.map((element) => ({
          stepIndex: step.stepIndex,
          elementRef: element.ref,
          role: element.role,
          name: element.name,
          nameNormalized: element.nameNormalized,
          ...(element.attributes.type === undefined
            ? {}
            : { inputType: element.attributes.type }),
          ...(element.value === undefined ? {} : { value: element.value }),
        })),
      ),
    ),
  }
}

function stepInteractions(steps: readonly StepEvidence[]): CaptureStepInteraction[] {
  const interactions = steps.flatMap((step) =>
    step.subActions.flatMap((subAction) =>
      actionRefs(subAction).map((elementRef) => ({
        stepIndex: step.stepIndex,
        elementRef,
      })),
    ),
  )
  interactions.sort((left, right) =>
    left.stepIndex - right.stepIndex
    || (left.elementRef < right.elementRef
      ? -1
      : left.elementRef > right.elementRef
        ? 1
        : 0),
  )
  const seen = new Set<string>()
  return interactions.filter((interaction) => {
    const key = `${interaction.stepIndex}\u0000${interaction.elementRef}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function candidateEvidenceText(evidence: CandidateInjectionEvidence): string {
  return canonicalJson({
    summarySeed: evidence.summarySeed,
    bodySeed: evidence.bodySeed,
    anchors: evidence.anchors,
    distilledObservations: evidence.distilledObservations,
    captureEvidence: {
      elements: evidence.captureEvidence.elements.map((element) => ({
        stepIndex: element.stepIndex,
        elementRef: element.elementRef,
        role: element.role,
        name: element.name,
        nameNormalized: element.nameNormalized,
        ...(element.inputType === undefined ? {} : { inputType: element.inputType }),
      })),
    },
  })
}

function candidateInjectionFlag(
  evidence: CandidateInjectionEvidence,
  policy: GuardrailPolicy,
): boolean {
  return scan(candidateEvidenceText(evidence), policy).fired.some(
    (detection) => detection.detector === 'injectionShape',
  )
}

function commonFields(
  handoff: CompletedRunHandoff,
  input: {
    kind: CurationCandidateProjection['kind']
    subtype?: FactSubtype
    rootCauseClass?: CautionRootCauseClass
    anchors: Anchor[]
    summarySeed: string
    bodySeed: string
    observations: DistilledObservation[]
    attributingObservationId: string
    secretFlagged: boolean
    steps: readonly StepEvidence[]
    artifactDescriptors: CurationArtifactDescriptor[]
  },
  policy: GuardrailPolicy,
): CurationCandidateProjection {
  const evidence = {
    anchors: input.anchors,
    summarySeed: input.summarySeed,
    bodySeed: input.bodySeed,
    distilledObservations: input.observations,
    captureEvidence: captureEvidence(input.steps),
  }
  return {
    sourceRunId: handoff.runId,
    scope: handoff.scope,
    buildOrdinal: handoff.buildOrdinal,
    executionContext: handoff.executionContext,
    secretFlagged: input.secretFlagged,
    injectionFlagged: candidateInjectionFlag(evidence, policy),
    kind: input.kind,
    ...(input.subtype === undefined ? {} : { subtype: input.subtype }),
    ...(input.rootCauseClass === undefined
      ? {}
      : { rootCauseClass: input.rootCauseClass }),
    anchors: evidence.anchors,
    summarySeed: evidence.summarySeed,
    bodySeed: evidence.bodySeed,
    distilledObservations: evidence.distilledObservations,
    evidenceToken: deriveEvidenceToken({
      attributingObservationId: input.attributingObservationId,
      anchor: input.anchors[0]!,
      buildOrdinal: handoff.buildOrdinal,
    }),
    attributingObservationId: input.attributingObservationId,
    artifactDescriptors: input.artifactDescriptors,
    captureEvidence: evidence.captureEvidence,
    stepInteractions: stepInteractions(input.steps),
    emittedAt: new Date(handoff.endedAt).toISOString(),
  }
}

function factSubtype(
  evidence: ResolvedElementEvidence,
): { subtype: FactSubtype; route?: string } {
  const classification = classifySubActionRoute(evidence.subAction)
  if (classification.navigated && classification.route !== undefined) {
    return { subtype: 'navigational', route: classification.route }
  }
  return evidence.locator === undefined
    ? { subtype: 'behavioral' }
    : { subtype: 'selector' }
}

function projectFact(
  handoff: CompletedRunHandoff,
  test: PerTestOutcome,
  step: StepEvidence,
  policy: GuardrailPolicy,
): CurationCandidateProjection | undefined {
  if (!step.verifierVerdict.pass) return undefined
  const resolved = resolvedElementEvidence(step)
  if (resolved.length !== 1) return undefined

  const evidence = resolved[0]!
  const id = observationId(handoff, test.testIndex, step.stepIndex)
  const platform = evidence.subAction.stateBefore.platform
  const classification = factSubtype(evidence)
  const element = elementAnchor(evidence)
  const selector = evidence.locator === undefined
    ? undefined
    : ({ t: 'selector', literal: evidence.locator } satisfies Anchor)
  const page = classification.route === undefined
    ? undefined
    : ({ t: 'page', route: classification.route } satisfies Anchor)
  const primary = page ?? selector ?? element
  const anchors = uniqueAnchors([
    primary,
    element,
    ...(selector === undefined ? [] : [selector]),
    { t: 'platform', platform },
    ...(page === undefined ? [] : [page]),
  ])
  const observation: DistilledObservation = {
    schemaVersion: DISTILLED_OBSERVATION_SCHEMA_VERSION,
    step: { naturalKey: id, ordinal: step.stepIndex },
    platform: observationPlatform(platform),
    test: { id: test.testId },
    ...(evidence.subAction.stateBefore.url === undefined
      ? {}
      : {
          surface: {
            kind: 'page' as const,
            naturalKey: classification.route ?? evidence.subAction.stateBefore.url,
          },
        }),
    element: { naturalKey: elementNaturalKey(evidence) },
    ...(evidence.locator === undefined
      ? {}
      : { locator: { selector: evidence.locator } }),
    observedAtOrdinal: handoff.buildOrdinal,
  }

  const subject = `${evidence.element.role} "${evidence.element.nameNormalized}"`
  const summarySeed = classification.subtype === 'selector'
    ? `${subject} selector ${evidence.locator}`
    : classification.subtype === 'navigational'
      ? `${subject} navigates to ${classification.route}`
      : `${subject} resolved as a verified element`
  const bodySeed = classification.subtype === 'selector'
    ? `Verified ${subject} at ${evidence.locator}.`
    : classification.subtype === 'navigational'
      ? `Verified ${subject} before navigation to ${classification.route}.`
      : `Verified ${subject} from the recorded screen state.`

  return commonFields(
    handoff,
    {
      kind: 'fact',
      subtype: classification.subtype,
      anchors,
      summarySeed,
      bodySeed,
      observations: [observation],
      attributingObservationId: id,
      secretFlagged: step.cacheStatus === 'bypass',
      steps: [step],
      artifactDescriptors: stepArtifactDescriptors(step),
    },
    policy,
  )
}

function measurementSeeds(step: StepEvidence): MeasurementSeed[] {
  const reported = step.reportedValue === undefined
    ? []
    : [{ metric: 'reported-value', value: step.reportedValue.value }]
  const asserted =
    step.assertOutcome === undefined || !step.assertOutcome.passed
      ? []
      : [
          {
            metric: `assert-value:${step.assertOutcome.source}`,
            value: step.assertOutcome.actual === null
              ? 'null'
              : (step.assertOutcome.actual ?? 'undefined'),
          },
        ]
  return [...reported, ...asserted]
}

function projectMeasurements(
  handoff: CompletedRunHandoff,
  test: PerTestOutcome,
  step: StepEvidence,
  policy: GuardrailPolicy,
): CurationCandidateProjection[] {
  if (!step.verifierVerdict.pass) return []
  const firstSubAction = step.subActions[0]
  if (firstSubAction === undefined) return []
  const resolved = resolvedElementEvidence(step)
  const singleElement = resolved.length === 1 ? resolved[0] : undefined
  const platform = firstSubAction.stateBefore.platform
  const id = observationId(handoff, test.testIndex, step.stepIndex)

  return measurementSeeds(step).map((measurement) => {
    const metricAnchor = {
      t: 'flow' as const,
      name: `measurement:${measurement.metric}`,
    }
    const anchors = uniqueAnchors([
      ...(singleElement === undefined ? [] : [elementAnchor(singleElement)]),
      metricAnchor,
      { t: 'platform', platform },
    ])
    const observation: DistilledObservation = {
      schemaVersion: DISTILLED_OBSERVATION_SCHEMA_VERSION,
      step: { naturalKey: id, ordinal: step.stepIndex },
      platform: observationPlatform(platform),
      test: { id: test.testId },
      flow: { name: measurement.metric },
      ...(singleElement === undefined
        ? {}
        : { element: { naturalKey: elementNaturalKey(singleElement) } }),
      observedAtOrdinal: handoff.buildOrdinal,
    }
    return commonFields(
      handoff,
      {
        kind: 'fact',
        subtype: 'measurement',
        anchors,
        summarySeed: `${measurement.metric} measured as ${measurement.value}`,
        bodySeed: `Verified ${measurement.metric} value: ${measurement.value}.`,
        observations: [observation],
        attributingObservationId: id,
        secretFlagged: step.cacheStatus === 'bypass',
        steps: [step],
        artifactDescriptors: stepArtifactDescriptors(step),
      },
      policy,
    )
  })
}

function isLearnableCaution(
  value: string,
): value is CautionRootCauseClass {
  return (LEARNABLE_CAUTION_ROOT_CAUSES as readonly string[]).includes(value)
}

function projectCaution(
  handoff: CompletedRunHandoff,
  test: PerTestOutcome,
  policy: GuardrailPolicy,
): CurationCandidateProjection | undefined {
  const rootCause = test.rootCause
  if (rootCause === undefined || !isLearnableCaution(rootCause.class)) return undefined
  const stepIndex = rootCause.evidence.citedSteps[0] ?? 0
  const id = observationId(handoff, test.testIndex, stepIndex)
  const fallbackAnchor: Anchor = {
    t: 'error',
    message: `${rootCause.class}: ${rootCause.evidence.rationale}`,
  }
  const anchors = uniqueAnchors([
    ...(rootCause.evidence.citedAnchors.length === 0
      ? [fallbackAnchor]
      : rootCause.evidence.citedAnchors),
    fallbackAnchor,
  ])
  const citedSteps = new Set(rootCause.evidence.citedSteps)
  const producingSteps = test.steps.filter((step) => citedSteps.has(step.stepIndex))
  const platform = producingSteps[0]?.subActions[0]?.stateBefore.platform
  const observation: DistilledObservation = {
    schemaVersion: DISTILLED_OBSERVATION_SCHEMA_VERSION,
    step: { naturalKey: id, ordinal: stepIndex },
    ...(platform === undefined ? {} : { platform: observationPlatform(platform) }),
    test: { id: test.testId },
    error: {
      naturalKey: `${rootCause.class}:${rootCause.evidence.rationale}`,
      rootCauseClass: rootCause.class,
    },
    observedAtOrdinal: handoff.buildOrdinal,
  }

  return commonFields(
    handoff,
    {
      kind: 'caution',
      rootCauseClass: rootCause.class,
      anchors,
      summarySeed: `${rootCause.class} caution for ${test.testId}`,
      bodySeed: `${rootCause.class}: ${rootCause.evidence.rationale}`,
      observations: [observation],
      attributingObservationId: id,
      secretFlagged: producingSteps.some((step) => step.cacheStatus === 'bypass'),
      steps: producingSteps,
      artifactDescriptors: artifactDescriptorsForRefs(
        rootCause.evidence.citedArtifacts,
        stepIndex,
      ),
    },
    policy,
  )
}

export const PROCEDURE_TRAJECTORY_SEED_VERSION = 1

const trajectoryGuardTargetSchema = z
  .object({
    ref: z.string().min(1),
    role: z.string(),
    nameNormalized: z.string(),
    ordinal: z.number().int().nonnegative(),
  })
  .strict()

const trajectoryCompositeValueSchema = z.union([
  z.null(),
  z.array(procedureJsonValueSchema),
  z.record(z.string(), procedureJsonValueSchema),
])

const trajectoryValueSlotSchema = z
  .object({
    // WR-04: boolean and numeric action fields are replay semantics, not decoration. Dropping
    // fill.submit, scroll.maxSwipes/retryOpposite, durations, or scale here would author a
    // procedure whose behavior differs from the verified trajectory.
    observed: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      trajectoryCompositeValueSchema,
    ]),
    source: z.enum(['literal', 'test-variable', 'masked-secret']),
    // G-381-3: the live binding name behind this slot, when the evidence names it —
    // a test variable matched against Plan 381-41's interpolation provenance, or a secret
    // recovered from its recorded masked form. `curator-author` forces the covering
    // parameter to exactly this name so consult-time fillability (D-08, which matches on
    // binding NAMES) succeeds. Absent when the source is an anonymous literal.
    sourceName: z.string().min(1).optional(),
    targetRef: z.string().min(1).optional(),
  })
  .strict()

const trajectoryStepSchema = z
  .object({
    ordinal: z.number().int().nonnegative(),
    instruction: z.string(),
    action: z
      .object({
        type: z.string().min(1),
        targets: z.record(z.string(), trajectoryGuardTargetSchema),
        values: z.record(z.string(), trajectoryValueSlotSchema),
      })
      .strict()
      .optional(),
    pageRoute: z.string().optional(),
  })
  .strict()

/**
 * The code-built trajectory a procedure candidate carries in its existing `bodySeed` string —
 * no new queue machinery (D-01/D-02). The extraction author decodes it to build the committed
 * step sequence deterministically; the LLM only ever proposes segmentation + parameter names.
 */
export const procedureTrajectorySeedSchema = z
  .object({
    version: z.literal(PROCEDURE_TRAJECTORY_SEED_VERSION),
    flowName: z.string().min(1),
    steps: z.array(trajectoryStepSchema).min(2),
  })
  .strict()

export type ProcedureTrajectorySeed = z.infer<typeof procedureTrajectorySeedSchema>
export type ProcedureTrajectoryStep = ProcedureTrajectorySeed['steps'][number]

/** Fail-closed decode of a procedure candidate's code-built bodySeed trajectory. */
export function parseProcedureTrajectorySeed(
  bodySeed: string,
): ProcedureTrajectorySeed | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodySeed)
  } catch {
    return undefined
  }
  const result = procedureTrajectorySeedSchema.safeParse(parsed)
  return result.success ? result.data : undefined
}

/**
 * Handoff evidence is masked-before-record: secrets surface as `<SECRET_n>`/`<EMAIL_n>`
 * placeholders (or an unexpanded `{{secret:...}}` template) and test variables as `{{env:...}}`
 * templates. This deterministic labeling is what D-03's forced parameterization keys on.
 */
const MASKED_VALUE_PATTERN = /<(?:SECRET|EMAIL)_\d+>|\{\{\s*secret:|\[secret:\w+\]/
const TEST_VARIABLE_PATTERN = /\{\{\s*env:/

/**
 * The two recorded secret forms, mirroring `runner/src/loop/secrets.ts:35-36`
 * (SECRET_TEMPLATE_RE / REDACTED_SECRET_MARKER_RE — the authority). Mirrored rather than
 * imported: the CLI curation fold must not depend on the runner's loop internals.
 * Both carry the secret NAME only; no secret VALUE is ever read here (D-08 names-not-values).
 */
const SECRET_TEMPLATE_NAME_PATTERN = /\{\{\s*secret:(\w+)\s*\}\}/
const SECRET_MARKER_NAME_PATTERN = /\[secret:(\w+)\]/

function secretSourceName(observed: string): string | undefined {
  const name =
    SECRET_TEMPLATE_NAME_PATTERN.exec(observed)?.[1]
    ?? SECRET_MARKER_NAME_PATTERN.exec(observed)?.[1]
  // Case is preserved verbatim: the committed parameter name must equal the binding name
  // the consult-time availability set carries, and that set is case-sensitive.
  return name
}

/**
 * Names the live binding behind an observed value by EXACT string equality against the
 * step's interpolation provenance (Plan 381-41). Ties break to the lexicographically
 * smallest name so the authored parameter name is deterministic across runs.
 *
 * Containment deliberately does NOT match. If `PROBE_USER=probe-user-7` and the observed
 * value is `prefix-probe-user-7-suffix`, parameterizing that superstring under PROBE_USER
 * would bind the wrong value at replay — replay substitutes the binding's value for the
 * WHOLE slot, not for the embedded region. Such slots stay literal-source (D-03).
 *
 * The equality is shape-insensitive on purpose: email-valued and credential-named bindings
 * are the canonical login shapes, not edge cases, and they only stay matchable while 381-41
 * records provenance unmasked against a likewise-unmasked plannedAction.
 */
function testVariableSourceName(
  observed: string,
  interpolated: readonly { name: string; value: string }[] | undefined,
): string | undefined {
  if (interpolated === undefined) return undefined
  let best: string | undefined
  for (const pair of interpolated) {
    if (pair.value !== observed) continue
    if (best === undefined || pair.name < best) best = pair.name
  }
  return best
}

/**
 * A whole-slot EMAIL placeholder: the ENTIRE observed string is one `<EMAIL_n>` token.
 * EMAIL-category only — `<SECRET_n>` is deliberately excluded because secret names come
 * solely from the recorded `{{secret:NAME}}`/`[secret:NAME]` forms; provenance must never
 * name a secret slot (D-08 names-not-values, T-381-113).
 */
const EMAIL_PLACEHOLDER_FORM = /^<EMAIL_\d+>$/

/**
 * Placeholder-mode provenance matching (F-381-45-1). The guardrail's model-bound email pass
 * can replace an interpolated test-variable value with its `<EMAIL_n>` placeholder BEFORE
 * evidence capture, so the observed value can never equal the raw binding value and the
 * exact-equality mode above cannot fire. Per-step provenance (381-41, recorded VERBATIM) is
 * then the only surviving carrier of the binding name. Email-shapedness is delegated to the
 * ONE authority that minted the placeholder — safety's detectEmails — a pair value counts
 * iff its sole detection spans the whole value; no second email definition is hand-rolled.
 *
 * Fail-closed rules (T-381-112): candidates spanning two or more DISTINCT email values yield
 * NO name (the mint ordinal is unrecoverable, so the binding cannot be known); candidates
 * sharing ONE value tie-break to the lexicographically smallest name (mint dedupes by value,
 * so any of those names binds the correct value at replay — 381-42's tie rule).
 *
 * Parameterization then REPLACES the placeholder literal with `{param: NAME}` — strictly
 * stronger protection than redaction (D-03): the committed body carries neither the raw
 * value nor the placeholder, and extraction success is proposal-independent.
 */
function emailPlaceholderSourceName(
  interpolated: readonly { name: string; value: string }[] | undefined,
): string | undefined {
  if (interpolated === undefined) return undefined
  let candidateValue: string | undefined
  let best: string | undefined
  for (const pair of interpolated) {
    const detections = detectEmails(pair.value)
    if (detections.length !== 1 || detections[0] !== pair.value) continue
    if (candidateValue === undefined) {
      candidateValue = pair.value
      best = pair.name
      continue
    }
    if (pair.value !== candidateValue) return undefined
    if (pair.name < best!) best = pair.name
  }
  return best
}

function trajectoryValueClassification(
  observed: string,
  interpolated: readonly { name: string; value: string }[] | undefined,
): { source: 'literal' | 'test-variable' | 'masked-secret'; sourceName?: string } {
  if (MASKED_VALUE_PATTERN.test(observed)) {
    const sourceName = secretSourceName(observed)
    if (sourceName !== undefined) return { source: 'masked-secret', sourceName }
    // Placeholder mode fires ONLY here: the masked arm matched, no secret name was recorded,
    // and the whole slot is one EMAIL placeholder with unambiguous email-valued provenance.
    if (EMAIL_PLACEHOLDER_FORM.test(observed)) {
      const bindingName = emailPlaceholderSourceName(interpolated)
      if (bindingName !== undefined) {
        return { source: 'test-variable', sourceName: bindingName }
      }
    }
    return { source: 'masked-secret' }
  }
  if (TEST_VARIABLE_PATTERN.test(observed)) return { source: 'test-variable' }
  const sourceName = testVariableSourceName(observed, interpolated)
  if (sourceName !== undefined) return { source: 'test-variable', sourceName }
  return { source: 'literal' }
}

const ACTION_REF_KEYS: readonly string[] = ['ref', 'fromRef', 'toRef']

function jsonRepresentable(
  value: unknown,
  ancestors: Set<object> = new Set(),
): value is ProcedureJsonValue {
  if (value === null) return true
  if (typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (ancestors.has(value)) return false

  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value)
      if (keys.some((key) => typeof key === 'symbol')) return false
      if (keys.length !== value.length + 1 || !keys.includes('length')) return false

      ancestors.add(value)
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (
          descriptor === undefined
          || !descriptor.enumerable
          || !('value' in descriptor)
          || !jsonRepresentable(descriptor.value, ancestors)
        ) {
          return false
        }
      }
      return true
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false

    ancestors.add(value)
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') return false
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (
        descriptor === undefined
        || !descriptor.enumerable
        || !('value' in descriptor)
        || !jsonRepresentable(descriptor.value, ancestors)
      ) {
        return false
      }
    }
    return true
  } catch {
    return false
  } finally {
    ancestors.delete(value)
  }
}

function isCompositeJsonValue(
  value: ProcedureJsonValue,
): value is null | ProcedureJsonValue[] | { [key: string]: ProcedureJsonValue } {
  return value === null || typeof value === 'object'
}

/**
 * F-381-48-1: step instruction TEXT is recorded post-interpolation, so a `{{env:}}`-bound
 * email rides the handoff's stepText VERBATIM into every procedure-candidate prose surface
 * (summarySeed, seed instructions, observation naturalKeys). The committed-egress
 * checkpoint then blocks the publish (redact-action detections block on non-user parts)
 * and the drain's 'withheld' outcome is structurally silent at the tail. The projection
 * therefore masks prose through the SAME ambient masking context that minted the
 * plannedAction's placeholder — the candidate survives UNDER the transform; the wall is
 * untouched. Value slots are not routed here: D-03 forced parameterization owns them.
 * Outside a safety scope (pure unit fixtures) this is the identity function, and
 * non-email, unregistered values (the sentinel arm) pass through byte-identical.
 * Deliberately NOT `{{env:}}` re-templatization — that prose design ruling stays deferred
 * (Plan 381-42 third prohibition).
 */
function maskedProse(text: string): string {
  return getActiveMaskingContext()?.mask(text) ?? text
}

function completingSubAction(step: StepEvidence): SubActionEvidence | undefined {
  for (let index = step.subActions.length - 1; index >= 0; index -= 1) {
    const candidate = step.subActions[index]!
    if (actionRefs(candidate).length > 0) return candidate
  }
  return step.subActions.at(-1)
}

function trajectoryTargets(
  subAction: SubActionEvidence,
): Record<string, z.infer<typeof trajectoryGuardTargetSchema>> {
  const targets: Record<string, z.infer<typeof trajectoryGuardTargetSchema>> = {}
  const action = subAction.plannedAction as unknown as Record<string, unknown>
  for (const key of ACTION_REF_KEYS) {
    const ref = action[key]
    if (typeof ref !== 'string') continue
    const element = subAction.stateBefore.elements.find(
      (candidate) => candidate.ref === ref,
    )
    if (element === undefined) continue
    targets[key] = {
      ref,
      role: element.role,
      nameNormalized: element.nameNormalized,
      ordinal: elementOrdinal(element, subAction.stateBefore.elements),
    }
  }
  return targets
}

function trajectoryValues(
  subAction: SubActionEvidence,
  interpolated: readonly { name: string; value: string }[] | undefined,
): Record<string, z.infer<typeof trajectoryValueSlotSchema>> | undefined {
  const values: Record<string, z.infer<typeof trajectoryValueSlotSchema>> = {}
  const action = subAction.plannedAction as unknown as Record<string, unknown>
  const primaryRef = typeof action['ref'] === 'string' ? action['ref'] : undefined
  for (const [key, value] of Object.entries(action)) {
    if (key === 'type' || ACTION_REF_KEYS.includes(key)) continue
    // CR-01/T-381-52: one lossy field invalidates the whole action. Silently dropping a value
    // would author replay behavior different from the verified trajectory.
    if (!jsonRepresentable(value)) return undefined
    const composite = isCompositeJsonValue(value)
    // T-381-50: D-03's parameter union is scalar-only, so masked/env material nested inside a
    // composite cannot be made safe by forced parameterization. Reject it before authoring.
    if (composite) {
      const serialized = JSON.stringify(value)
      if (
        MASKED_VALUE_PATTERN.test(serialized)
        || TEST_VARIABLE_PATTERN.test(serialized)
      ) {
        return undefined
      }
    }
    values[key] = {
      observed: value,
      // Masking placeholders and variable templates are string phenomena. Numbers and booleans
      // therefore remain literal-source while preserving their original JSON scalar type; JSON
      // composites are admitted only after the fail-closed scan above and remain literal-source.
      ...(!composite && typeof value === 'string'
        ? trajectoryValueClassification(value, interpolated)
        : { source: 'literal' as const }),
      ...(primaryRef !== undefined
        && isCredentialValueField(subAction.plannedAction.type, key)
        ? { targetRef: primaryRef }
        : {}),
    }
  }
  return values
}

function trajectoryStep(step: StepEvidence): ProcedureTrajectoryStep {
  const completing = completingSubAction(step)
  const values =
    completing === undefined
      ? undefined
      : trajectoryValues(completing, step.interpolatedVariables)
  // Replay evaluates the page guard before executing the action (D-10), so this route must
  // describe the pre-action page. Recording a navigation destination made healthy steps miss
  // their guards and fed false staleness negatives into the D-05/D-11 confirmation ladder.
  const route = completing === undefined
    ? undefined
    : completing.stateBefore.url
  return {
    ordinal: step.stepIndex,
    instruction: maskedProse(step.stepText),
    ...(completing === undefined || values === undefined
      ? {}
      : {
          action: {
            type: completing.plannedAction.type,
            targets: trajectoryTargets(completing),
            values,
          },
        }),
    ...(route === undefined ? {} : { pageRoute: route }),
  }
}

function projectProcedureTarget(
  handoff: CompletedRunHandoff,
  test: PerTestOutcome,
  policy: GuardrailPolicy,
): CurationCandidateProjection | undefined {
  if (test.outcome !== 'passed') return undefined
  if (test.steps.length < 2) return undefined
  if (!test.steps.every((step) => step.verifierVerdict.pass)) return undefined

  const flowName = test.testId
  const pageAnchors = test.steps.flatMap((step) =>
    exercisedAnchors(step).filter((anchor) => anchor.t === 'page'),
  )
  const platform = test.steps[0]?.subActions[0]?.stateBefore.platform
  const anchors = uniqueAnchors([
    { t: 'flow', name: flowName },
    ...pageAnchors,
    ...(platform === undefined ? [] : [{ t: 'platform' as const, platform }]),
  ])

  const observations: DistilledObservation[] = test.steps.map((step, position) => {
    const completing = completingSubAction(step)
    const stepPlatform = completing?.stateBefore.platform
    const route = completing === undefined
      ? undefined
      : completing.stateBefore.url
    const resolved = resolvedElementEvidence(step).at(-1)
    const previous = test.steps[position - 1]
    return {
      schemaVersion: DISTILLED_OBSERVATION_SCHEMA_VERSION,
      step: { naturalKey: maskedProse(step.stepText), ordinal: step.stepIndex },
      ...(stepPlatform === undefined
        ? {}
        : { platform: observationPlatform(stepPlatform) }),
      test: { id: test.testId },
      flow: {
        name: flowName,
        ...(previous === undefined ? {} : { precedes: maskedProse(previous.stepText) }),
      },
      ...(route === undefined || stepPlatform === undefined
        ? {}
        : {
            surface: {
              kind: stepPlatform === 'web' ? ('page' as const) : ('screen' as const),
              naturalKey: route,
            },
          }),
      ...(resolved === undefined || stepPlatform === undefined
        ? {}
        : { element: { naturalKey: elementNaturalKey(resolved) } }),
      observedAtOrdinal: handoff.buildOrdinal,
    }
  })

  const seed: ProcedureTrajectorySeed = {
    version: PROCEDURE_TRAJECTORY_SEED_VERSION,
    flowName,
    steps: test.steps.map(trajectoryStep),
  }
  const seenArtifacts = new Set<string>()
  const artifactDescriptors = test.steps
    .flatMap(stepArtifactDescriptors)
    .filter((descriptor) => {
      if (seenArtifacts.has(descriptor.ref.id)) return false
      seenArtifacts.add(descriptor.ref.id)
      return true
    })

  return commonFields(
    handoff,
    {
      kind: 'procedure',
      anchors,
      summarySeed: `Procedure ${flowName}: ${test.steps
        .map((step) => maskedProse(step.stepText))
        .join(' -> ')}`,
      bodySeed: canonicalJson(seed),
      observations,
      attributingObservationId: observationId(
        handoff,
        test.testIndex,
        test.steps[0]!.stepIndex,
      ),
      secretFlagged: test.steps.some((step) => step.cacheStatus === 'bypass'),
      steps: test.steps,
      artifactDescriptors,
    },
    policy,
  )
}

/**
 * D-01: EVERY verified-PASS multi-step trajectory becomes exactly one procedure-extraction
 * target on EVERY drain — no repetition threshold, no seen-before check, no user marking.
 * Content-addressing IS the dedup policy: a re-extracted duplicate address disposes as
 * Confirm downstream. Single-step, zero-step, failing, and skipped trajectories never target.
 */
export function projectProcedureTargets(
  handoff: CompletedRunHandoff,
  policy: GuardrailPolicy,
): CurationCandidateProjection[] {
  return handoff.tests.flatMap((test) => {
    const target = projectProcedureTarget(handoff, test, policy)
    return target === undefined ? [] : [target]
  })
}

/** Pure post-verdict projection. Host artifact bytes are resolved only by the emit wrapper. */
export function projectCurationCandidates(
  handoff: CompletedRunHandoff,
  policy: GuardrailPolicy,
): CurationCandidateProjection[] {
  return [
    ...handoff.tests.flatMap((test) => {
      const factsAndMeasurements = test.steps.flatMap((step) => {
        const fact = projectFact(handoff, test, step, policy)
        return [
          ...(fact === undefined ? [] : [fact]),
          ...projectMeasurements(handoff, test, step, policy),
        ]
      })
      const caution = projectCaution(handoff, test, policy)
      return [...factsAndMeasurements, ...(caution === undefined ? [] : [caution])]
    }),
    ...projectProcedureTargets(handoff, policy),
  ]
}

export interface EmitCurationCandidatesOptions {
  handoff: CompletedRunHandoff
  /** Absolute completed-run directory containing runner-local's blobs/ subdirectory. */
  runDir: string
  /** Absolute agent-qa-knowledge root that owns the durable queue. */
  knowledgeRoot: string
  policy: GuardrailPolicy
}

export type EmitCandidateOutcome =
  | EnqueueCurationCandidateProjectionOutcome
  | { kind: 'refused'; reason: 'artifact-io-error' }

export interface EmitCandidateDetail {
  candidateId?: string
  outcome: EmitCandidateOutcome
}

export interface EmitReport {
  enqueued: number
  coalesced: number
  capExceeded: number
  refused: number
  details: EmitCandidateDetail[]
}

function bindArtifactSources(
  projection: CurationCandidateProjection,
  runDir: string,
): CurationProjectionArtifactSource[] {
  return projection.artifactDescriptors.map((descriptor) => ({
    artifactId: descriptor.ref.id,
    sourcePath: join(runDir, RUN_EVIDENCE_BLOBS_SUBDIR, descriptor.ref.sha),
  }))
}

function incrementReport(report: EmitReport, outcome: EmitCandidateOutcome): void {
  if (outcome.kind === 'enqueued') {
    report.enqueued += 1
  } else if (outcome.kind === 'coalesced') {
    report.coalesced += 1
  } else if (outcome.kind === 'cap-exceeded') {
    report.capExceeded += 1
  } else {
    report.refused += 1
  }
}

/**
 * Resolves runner-local artifact blobs and synchronously publishes each candidate in isolation.
 * Queue publication owns temp-write, fsync, cap enforcement, and atomic rename semantics.
 */
export function emitCurationCandidates(opts: EmitCurationCandidatesOptions): EmitReport {
  if (!isAbsolute(opts.runDir)) throw new TypeError('runDir must be absolute')
  if (!isAbsolute(opts.knowledgeRoot)) throw new TypeError('knowledgeRoot must be absolute')

  const report: EmitReport = {
    enqueued: 0,
    coalesced: 0,
    capExceeded: 0,
    refused: 0,
    details: [],
  }
  for (const projected of projectCurationCandidates(opts.handoff, opts.policy)) {
    const artifactSources = bindArtifactSources(projected, opts.runDir)
    let outcome: EmitCandidateOutcome
    try {
      outcome = enqueueCurationCandidateProjection({
        knowledgeRoot: opts.knowledgeRoot,
        projection: projected,
        artifactSources,
      })
    } catch (error) {
      if (error instanceof TypeError) throw error
      outcome = { kind: 'refused', reason: 'artifact-io-error' }
    }
    incrementReport(report, outcome)
    report.details.push({
      ...('candidateId' in outcome ? { candidateId: outcome.candidateId } : {}),
      outcome,
    })
  }
  return report
}
