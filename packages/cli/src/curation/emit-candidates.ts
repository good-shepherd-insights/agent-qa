import { isAbsolute, join } from 'node:path'

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
  type Anchor,
  type ArtifactRef,
  type CautionRootCauseClass,
  type CompletedRunHandoff,
  type DistilledObservation,
  type FactSubtype,
  type GuardrailPolicy,
  type PerTestOutcome,
  type Platform,
  type StepEvidence,
} from '@vostride/agent-qa-schema'
import { scan } from '@vostride/agent-qa-safety'

import {
  actionRefs,
  classifySubActionRoute,
  elementAnchor,
  elementNaturalKey,
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

/** Pure post-verdict projection. Host artifact bytes are resolved only by the emit wrapper. */
export function projectCurationCandidates(
  handoff: CompletedRunHandoff,
  policy: GuardrailPolicy,
): CurationCandidateProjection[] {
  return handoff.tests.flatMap((test) => {
    const factsAndMeasurements = test.steps.flatMap((step) => {
      const fact = projectFact(handoff, test, step, policy)
      return [
        ...(fact === undefined ? [] : [fact]),
        ...projectMeasurements(handoff, test, step, policy),
      ]
    })
    const caution = projectCaution(handoff, test, policy)
    return [...factsAndMeasurements, ...(caution === undefined ? [] : [caution])]
  })
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
