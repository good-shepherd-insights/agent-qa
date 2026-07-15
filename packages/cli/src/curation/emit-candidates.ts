import { statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import {
  CURATION_QUEUE_SCHEMA_VERSION,
  candidateContentAddress,
  enqueueCurationCandidate,
  type CurationCandidateAddressFields,
  type CurationCandidatePayload,
  type CurationArtifactSource,
  type EnqueueCurationCandidateOutcome,
} from '@vostride/agent-qa-knowledge-local'
import { RUN_EVIDENCE_BLOBS_SUBDIR } from '@vostride/agent-qa-runner-local'
import {
  DISTILLED_OBSERVATION_SCHEMA_VERSION,
  deriveEvidenceToken,
  type Anchor,
  type ArtifactRef,
  type CompletedRunHandoff,
  type DistilledObservation,
  type ElementInfo,
  type FactSubtype,
  type PerTestOutcome,
  type Platform,
  type StepEvidence,
  type SubActionEvidence,
} from '@vostride/agent-qa-schema'

export const LEARNABLE_CAUTION_ROOT_CAUSES = [
  'environment',
  'timeout',
  'flake',
] as const

type LearnableCautionRootCause = (typeof LEARNABLE_CAUTION_ROOT_CAUSES)[number]

interface ResolvedElementEvidence {
  subAction: SubActionEvidence
  element: ElementInfo
  ordinal: number
  locator?: string
}

interface MeasurementSeed {
  metric: string
  value: string
}

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

function ordinalForElement(element: ElementInfo, elements: readonly ElementInfo[]): number {
  let ordinal = 0
  for (const candidate of elements) {
    if (
      candidate.role !== element.role ||
      candidate.nameNormalized !== element.nameNormalized
    ) {
      continue
    }
    if (candidate.ref === element.ref) return ordinal
    ordinal += 1
  }
  return ordinal
}

function quoteAttribute(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function locatorForElement(element: ElementInfo): string | undefined {
  const explicit =
    element.attributes.selector ??
    element.attributes.cssSelector ??
    element.attributes.xpath
  if (explicit !== undefined && explicit.trim() !== '') return explicit.trim()

  const testId = element.attributes['data-testid'] ?? element.labels.testId
  if (testId !== undefined && testId !== '') {
    return `[data-testid="${quoteAttribute(testId)}"]`
  }

  const resourceId = element.attributes['resource-id']
  if (resourceId !== undefined && resourceId !== '') {
    return `[resource-id="${quoteAttribute(resourceId)}"]`
  }

  const accessibilityId = element.attributes['accessibility-id']
  if (accessibilityId !== undefined && accessibilityId !== '') {
    return `[accessibility-id="${quoteAttribute(accessibilityId)}"]`
  }

  const id = element.attributes.id
  return id === undefined || id === '' ? undefined : `[id="${quoteAttribute(id)}"]`
}

function actionRefs(subAction: SubActionEvidence): string[] {
  const action = subAction.plannedAction
  const refs: string[] = []
  if ('ref' in action && typeof action.ref === 'string') refs.push(action.ref)
  if ('fromRef' in action && typeof action.fromRef === 'string') refs.push(action.fromRef)
  if ('toRef' in action && typeof action.toRef === 'string') refs.push(action.toRef)
  return refs
}

function resolvedElementEvidence(step: StepEvidence): ResolvedElementEvidence[] {
  const byIdentity = new Map<string, ResolvedElementEvidence>()
  for (const subAction of step.subActions) {
    for (const ref of actionRefs(subAction)) {
      const element = subAction.stateBefore.elements.find((candidate) => candidate.ref === ref)
      if (element === undefined) continue
      const ordinal = ordinalForElement(element, subAction.stateBefore.elements)
      const identity = [
        subAction.stateBefore.platform,
        element.role,
        element.nameNormalized,
        ordinal,
      ].join('\u0000')
      if (!byIdentity.has(identity)) {
        byIdentity.set(identity, {
          subAction,
          element,
          ordinal,
          ...(locatorForElement(element) === undefined
            ? {}
            : { locator: locatorForElement(element) }),
        })
      }
    }
  }
  return [...byIdentity.values()]
}

function elementNaturalKey(evidence: ResolvedElementEvidence): string {
  return `${evidence.element.role}:${evidence.element.nameNormalized}:${evidence.ordinal}`
}

function elementAnchor(evidence: ResolvedElementEvidence): Extract<Anchor, { t: 'el' }> {
  return {
    t: 'el',
    role: evidence.element.role,
    name: evidence.element.nameNormalized,
    ordinal: evidence.ordinal,
  }
}

function uniqueAnchors(anchors: readonly Anchor[]): Anchor[] {
  const seen = new Set<string>()
  return anchors.filter((anchor) => {
    const key = JSON.stringify(anchor)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function artifactInventory(
  refs: readonly ArtifactRef[],
  stepIndex: number,
): CurationCandidateAddressFields['artifactInventory'] {
  const seen = new Set<string>()
  return refs.flatMap((ref) => {
    if (!SHA256_HEX.test(ref.sha) || seen.has(ref.sha)) return []
    seen.add(ref.sha)
    return [
      {
        relativePath: `artifacts/${ref.sha}`,
        sha256: ref.sha,
        // The pure handoff projection cannot inspect host bytes. emitCurationCandidates resolves
        // this deterministic zero count from the run blob before recomputing the content address.
        bytes: 0,
        stepIndex,
      },
    ]
  })
}

function stepArtifactRefs(step: StepEvidence): ArtifactRef[] {
  return step.subActions.flatMap((subAction) => [
    ...(subAction.decisionScreenshotRef === undefined
      ? []
      : [subAction.decisionScreenshotRef]),
    ...(subAction.artifactRefs ?? []),
  ])
}

function buildCandidate(fields: CurationCandidateAddressFields): CurationCandidatePayload {
  return { candidateId: candidateContentAddress(fields), ...fields }
}

function commonFields(
  handoff: CompletedRunHandoff,
  input: {
    kind: CurationCandidateAddressFields['kind']
    subtype?: FactSubtype
    anchors: Anchor[]
    summarySeed: string
    bodySeed: string
    observations: DistilledObservation[]
    attributingObservationId: string
    secretFlagged: boolean
    artifactInventory: CurationCandidateAddressFields['artifactInventory']
  },
): CurationCandidatePayload {
  const fields: CurationCandidateAddressFields = {
    schemaVersion: CURATION_QUEUE_SCHEMA_VERSION,
    sourceRunId: handoff.runId,
    scope: handoff.scope,
    buildOrdinal: handoff.buildOrdinal,
    executionContext: handoff.executionContext,
    secretFlagged: input.secretFlagged,
    injectionFlagged: false,
    kind: input.kind,
    ...(input.subtype === undefined ? {} : { subtype: input.subtype }),
    anchors: input.anchors,
    summarySeed: input.summarySeed,
    bodySeed: input.bodySeed,
    distilledObservations: input.observations,
    evidenceToken: deriveEvidenceToken({
      attributingObservationId: input.attributingObservationId,
      anchor: input.anchors[0]!,
      buildOrdinal: handoff.buildOrdinal,
    }),
    attributingObservationId: input.attributingObservationId,
    artifactInventory: input.artifactInventory,
    emittedAt: new Date(handoff.endedAt).toISOString(),
  }
  return buildCandidate(fields)
}

function factSubtype(
  evidence: ResolvedElementEvidence,
): { subtype: FactSubtype; route?: string } {
  const before = evidence.subAction.stateBefore.url
  const after = evidence.subAction.stateAfter?.url
  if (before !== undefined && after !== undefined && before !== after) {
    return { subtype: 'navigational', route: after }
  }
  return evidence.locator === undefined
    ? { subtype: 'behavioral' }
    : { subtype: 'selector' }
}

function projectFact(
  handoff: CompletedRunHandoff,
  test: PerTestOutcome,
  step: StepEvidence,
): CurationCandidatePayload | undefined {
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

  return commonFields(handoff, {
    kind: 'fact',
    subtype: classification.subtype,
    anchors,
    summarySeed,
    bodySeed,
    observations: [observation],
    attributingObservationId: id,
    secretFlagged: step.cacheStatus === 'bypass',
    artifactInventory: artifactInventory(stepArtifactRefs(step), step.stepIndex),
  })
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
): CurationCandidatePayload[] {
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
    return commonFields(handoff, {
      kind: 'fact',
      subtype: 'measurement',
      anchors,
      summarySeed: `${measurement.metric} measured as ${measurement.value}`,
      bodySeed: `Verified ${measurement.metric} value: ${measurement.value}.`,
      observations: [observation],
      attributingObservationId: id,
      secretFlagged: step.cacheStatus === 'bypass',
      artifactInventory: artifactInventory(stepArtifactRefs(step), step.stepIndex),
    })
  })
}

function isLearnableCaution(
  value: string,
): value is LearnableCautionRootCause {
  return (LEARNABLE_CAUTION_ROOT_CAUSES as readonly string[]).includes(value)
}

function projectCaution(
  handoff: CompletedRunHandoff,
  test: PerTestOutcome,
): CurationCandidatePayload | undefined {
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
    error: { naturalKey: `${rootCause.class}:${rootCause.evidence.rationale}` },
    observedAtOrdinal: handoff.buildOrdinal,
  }

  return commonFields(handoff, {
    kind: 'caution',
    anchors,
    summarySeed: `${rootCause.class} caution for ${test.testId}`,
    bodySeed: `${rootCause.class}: ${rootCause.evidence.rationale}`,
    observations: [observation],
    attributingObservationId: id,
    secretFlagged: producingSteps.some((step) => step.cacheStatus === 'bypass'),
    artifactInventory: artifactInventory(rootCause.evidence.citedArtifacts, stepIndex),
  })
}

/** Pure post-verdict projection. Host artifact bytes are resolved only by the emit wrapper. */
export function projectCurationCandidates(
  handoff: CompletedRunHandoff,
): CurationCandidatePayload[] {
  return handoff.tests.flatMap((test) => {
    const factsAndMeasurements = test.steps.flatMap((step) => {
      const fact = projectFact(handoff, test, step)
      return [
        ...(fact === undefined ? [] : [fact]),
        ...projectMeasurements(handoff, test, step),
      ]
    })
    const caution = projectCaution(handoff, test)
    return [...factsAndMeasurements, ...(caution === undefined ? [] : [caution])]
  })
}

export interface EmitCurationCandidatesOptions {
  handoff: CompletedRunHandoff
  /** Absolute completed-run directory containing runner-local's blobs/ subdirectory. */
  runDir: string
  /** Absolute agent-qa-knowledge root that owns the durable queue. */
  knowledgeRoot: string
}

export type EmitCandidateOutcome =
  | EnqueueCurationCandidateOutcome
  | { kind: 'refused'; reason: 'artifact-io-error' }

export interface EmitCandidateDetail {
  candidateId: string
  outcome: EmitCandidateOutcome
}

export interface EmitReport {
  enqueued: number
  coalesced: number
  capExceeded: number
  refused: number
  details: EmitCandidateDetail[]
}

function hydrateArtifacts(
  candidate: CurationCandidatePayload,
  runDir: string,
): { payload: CurationCandidatePayload; sources: CurationArtifactSource[] } {
  const sources = candidate.artifactInventory.map((artifact) => ({
    relativePath: artifact.relativePath,
    sourcePath: join(runDir, RUN_EVIDENCE_BLOBS_SUBDIR, artifact.sha256),
  }))
  const inventory = candidate.artifactInventory.map((artifact, index) => {
    let bytes = artifact.bytes
    try {
      bytes = statSync(sources[index]!.sourcePath).size
    } catch {
      // Preserve the valid projected payload and let the queue return artifact-missing. Other
      // host data failures are isolated by the enqueue boundary below.
    }
    return { ...artifact, bytes }
  })
  const { candidateId: _projectedId, ...projectedFields } = candidate
  const fields: CurationCandidateAddressFields = {
    ...projectedFields,
    artifactInventory: inventory,
  }
  return {
    payload: { candidateId: candidateContentAddress(fields), ...fields },
    sources,
  }
}

function incrementReport(report: EmitReport, outcome: EmitCandidateOutcome): void {
  if (outcome === 'enqueued') {
    report.enqueued += 1
  } else if (outcome === 'coalesced') {
    report.coalesced += 1
  } else if (outcome === 'cap-exceeded') {
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
  for (const projected of projectCurationCandidates(opts.handoff)) {
    const hydrated = hydrateArtifacts(projected, opts.runDir)
    let outcome: EmitCandidateOutcome
    try {
      outcome = enqueueCurationCandidate({
        knowledgeRoot: opts.knowledgeRoot,
        payload: hydrated.payload,
        artifactSources: hydrated.sources,
      })
    } catch (error) {
      if (error instanceof TypeError) throw error
      outcome = { kind: 'refused', reason: 'artifact-io-error' }
    }
    incrementReport(report, outcome)
    report.details.push({ candidateId: hydrated.payload.candidateId, outcome })
  }
  return report
}
