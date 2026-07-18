import { isAbsolute } from 'node:path'

import { readCanonicalBundleAnchors } from '@vostride/agent-qa-knowledge-local'
import {
  canonicalJson,
  normalizeAnchor,
  type Anchor,
  type CanaryOutcome,
  type CompletedRunHandoff,
  type PerTestOutcome,
  type RecordId,
  type StepEvidence,
} from '@vostride/agent-qa-schema'

import { exercisedAnchors } from './handoff-anchors.js'

const NON_ATTRIBUTABLE_FAILURES = new Set(['environment', 'timeout', 'flake'])

export interface ProjectCanaryOutcomesInput {
  handoff: CompletedRunHandoff
  resolveCandidateAnchors: (id: RecordId) => CandidateAnchorResolution
}

export type CandidateAnchorResolution =
  | { kind: 'resolved'; anchors: Anchor[] }
  | { kind: 'unresolved'; reason: 'not-found' | 'invalid' | 'lookup-error'; detail?: string }

export type EmitCanaryOutcomeResult =
  | { kind: 'emitted' }
  | { kind: 'refused'; reason: 'emit-error' }
  | {
      kind: 'unresolved'
      reason: Extract<CandidateAnchorResolution, { kind: 'unresolved' }>['reason']
      detail?: string
    }

export interface EmitCanaryOutcomeDetail {
  candidateId: RecordId
  testId: string
  testIndex: number
  stepIndex: number
  outcome: EmitCanaryOutcomeResult
}

export interface EmitCanaryOutcomeReport {
  emitted: number
  refused: number
  unresolved: number
  details: EmitCanaryOutcomeDetail[]
}

export interface EmitCanaryOutcomesOptions {
  handoff: CompletedRunHandoff
  /** Absolute agent-qa-knowledge root used for store lookup and durable queue emission. */
  knowledgeRoot: string
  /** Absolute completed-run directory retained to keep the two post-verdict emit seams aligned. */
  runDir: string
  emit: (outcome: CanaryOutcome) => void
}

function normalizedKey(anchor: Anchor): string {
  return canonicalJson(normalizeAnchor(anchor))
}

function attributedOutcome(
  test: PerTestOutcome,
  step: StepEvidence,
): CanaryOutcome['runOutcome'] | undefined {
  if (step.verifierVerdict.pass) return 'positive'
  if (test.rootCause !== undefined && NON_ATTRIBUTABLE_FAILURES.has(test.rootCause.class)) {
    return undefined
  }
  return 'negative'
}

function servedCanaryIds(step: StepEvidence): RecordId[] {
  const seen = new Set<RecordId>()
  const ids: RecordId[] = []
  // Pin 1 is deliberately Channel-1-only: ReadTrace has no servedAsCanary authority.
  for (const line of step.servedBrief.channel1) {
    if (!line.servedAsCanary || seen.has(line.id)) continue
    seen.add(line.id)
    ids.push(line.id)
  }
  return ids
}

function firstMatchingAnchor(
  candidateAnchors: readonly Anchor[],
  stepAnchors: readonly Anchor[],
): Anchor | undefined {
  const exercisedByKey = new Map(
    stepAnchors.map((anchor) => [normalizedKey(anchor), normalizeAnchor(anchor)]),
  )
  for (const candidateAnchor of candidateAnchors) {
    const match = exercisedByKey.get(normalizedKey(candidateAnchor))
    if (match !== undefined) return match
  }
  return undefined
}

type ProjectedCanaryAttribution =
  | { kind: 'outcome'; outcome: CanaryOutcome }
  | {
      kind: 'unresolved'
      candidateId: RecordId
      testId: string
      testIndex: number
      stepIndex: number
      reason: Extract<CandidateAnchorResolution, { kind: 'unresolved' }>['reason']
      detail?: string
    }

function projectCanaryAttributions(
  input: ProjectCanaryOutcomesInput,
): ProjectedCanaryAttribution[] {
  const resolutionByCandidate = new Map<RecordId, CandidateAnchorResolution>()
  const resolveAnchors = (id: RecordId): CandidateAnchorResolution => {
    if (!resolutionByCandidate.has(id)) {
      try {
        resolutionByCandidate.set(id, input.resolveCandidateAnchors(id))
      } catch (error) {
        resolutionByCandidate.set(id, {
          kind: 'unresolved',
          reason: 'lookup-error',
          detail: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return resolutionByCandidate.get(id)!
  }

  const projected: ProjectedCanaryAttribution[] = []
  for (const test of input.handoff.tests) {
    for (const step of test.steps) {
      const runOutcome = attributedOutcome(test, step)
      if (runOutcome === undefined) continue
      const stepAnchors = exercisedAnchors(step)
      if (stepAnchors.length === 0) continue

      for (const candidateId of servedCanaryIds(step)) {
        const resolution = resolveAnchors(candidateId)
        if (resolution.kind === 'unresolved') {
          projected.push({
            kind: 'unresolved',
            candidateId,
            testId: test.testId,
            testIndex: test.testIndex,
            stepIndex: step.stepIndex,
            reason: resolution.reason,
            ...(resolution.detail === undefined ? {} : { detail: resolution.detail }),
          })
          continue
        }
        const exercisedAnchor = firstMatchingAnchor(resolution.anchors, stepAnchors)
        if (exercisedAnchor === undefined) continue
        projected.push({
          kind: 'outcome',
          outcome: {
            candidateId,
            runOutcome,
            runId: String(input.handoff.runId),
            testId: test.testId,
            testIndex: test.testIndex,
            buildOrdinal: input.handoff.buildOrdinal,
            stepIndex: step.stepIndex,
            briefDigest: step.servedBrief.briefDigest,
            attribution: [
              `Candidate ${candidateId}`,
              `matched ${canonicalJson(exercisedAnchor)}`,
              `on test ${test.testIndex} (${test.testId}) step ${step.stepIndex}`,
              `with ${runOutcome} verdict`,
            ].join(' '),
            exercisedAnchor,
          } satisfies CanaryOutcome,
        })
      }
    }
  }
  return projected
}

/** Pure Pin-1 projection: identical handoff + canonical snapshot yields identical outcome bytes. */
export function projectCanaryOutcomes(
  input: ProjectCanaryOutcomesInput,
): CanaryOutcome[] {
  return projectCanaryAttributions(input).flatMap((projected) =>
    projected.kind === 'outcome' ? [projected.outcome] : [],
  )
}

/** Resolves candidate anchors read-only, then synchronously emits every attribution in isolation. */
export function emitCanaryOutcomes(opts: EmitCanaryOutcomesOptions): EmitCanaryOutcomeReport {
  if (!isAbsolute(opts.knowledgeRoot)) throw new TypeError('knowledgeRoot must be absolute')
  if (!isAbsolute(opts.runDir)) throw new TypeError('runDir must be absolute')

  const projected = projectCanaryAttributions({
    handoff: opts.handoff,
    resolveCandidateAnchors: (id) => readCanonicalBundleAnchors({
      knowledgeRoot: opts.knowledgeRoot,
      bundleId: id,
    }),
  })
  const report: EmitCanaryOutcomeReport = {
    emitted: 0,
    refused: 0,
    unresolved: 0,
    details: [],
  }

  for (const attribution of projected) {
    if (attribution.kind === 'unresolved') {
      report.unresolved += 1
      report.details.push({
        candidateId: attribution.candidateId,
        testId: attribution.testId,
        testIndex: attribution.testIndex,
        stepIndex: attribution.stepIndex,
        outcome: {
          kind: 'unresolved',
          reason: attribution.reason,
          ...(attribution.detail === undefined ? {} : { detail: attribution.detail }),
        },
      })
      continue
    }

    let outcome: EmitCanaryOutcomeResult
    try {
      opts.emit(attribution.outcome)
      outcome = { kind: 'emitted' }
      report.emitted += 1
    } catch (error) {
      if (error instanceof TypeError) throw error
      outcome = { kind: 'refused', reason: 'emit-error' }
      report.refused += 1
    }
    report.details.push({
      candidateId: attribution.outcome.candidateId,
      testId: attribution.outcome.testId,
      testIndex: attribution.outcome.testIndex,
      stepIndex: attribution.outcome.stepIndex,
      outcome,
    })
  }
  return report
}
