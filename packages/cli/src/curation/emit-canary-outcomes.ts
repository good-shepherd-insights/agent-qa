import { isAbsolute } from 'node:path'

import { openKnowledgeReader } from '@vostride/agent-qa-knowledge-local'
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
  resolveCandidateAnchors: (id: RecordId) => Anchor[] | undefined
}

export type EmitCanaryOutcomeResult =
  | { kind: 'emitted' }
  | { kind: 'refused'; reason: 'emit-error' }

export interface EmitCanaryOutcomeDetail {
  candidateId: RecordId
  stepIndex: number
  outcome: EmitCanaryOutcomeResult
}

export interface EmitCanaryOutcomeReport {
  emitted: number
  refused: number
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

/** Pure Pin-1 projection: identical handoff + store snapshot yields identical outcome bytes. */
export function projectCanaryOutcomes(
  input: ProjectCanaryOutcomesInput,
): CanaryOutcome[] {
  const anchorsByCandidate = new Map<RecordId, Anchor[] | undefined>()
  const resolveAnchors = (id: RecordId): Anchor[] | undefined => {
    if (!anchorsByCandidate.has(id)) {
      try {
        anchorsByCandidate.set(id, input.resolveCandidateAnchors(id))
      } catch {
        anchorsByCandidate.set(id, undefined)
      }
    }
    return anchorsByCandidate.get(id)
  }

  return input.handoff.tests.flatMap((test) =>
    test.steps.flatMap((step) => {
      const runOutcome = attributedOutcome(test, step)
      if (runOutcome === undefined) return []
      const stepAnchors = exercisedAnchors(step)
      if (stepAnchors.length === 0) return []

      return servedCanaryIds(step).flatMap((candidateId) => {
        const candidateAnchors = resolveAnchors(candidateId)
        if (candidateAnchors === undefined) return []
        const exercisedAnchor = firstMatchingAnchor(candidateAnchors, stepAnchors)
        if (exercisedAnchor === undefined) return []
        return [{
          candidateId,
          runOutcome,
          runId: String(input.handoff.runId),
          buildOrdinal: input.handoff.buildOrdinal,
          stepIndex: step.stepIndex,
          briefDigest: step.servedBrief.briefDigest,
          attribution: [
            `Candidate ${candidateId}`,
            `matched ${canonicalJson(exercisedAnchor)}`,
            `on step ${step.stepIndex} with ${runOutcome} verdict`,
          ].join(' '),
          exercisedAnchor,
        } satisfies CanaryOutcome]
      })
    }),
  )
}

/** Resolves candidate anchors read-only, then synchronously emits every attribution in isolation. */
export function emitCanaryOutcomes(opts: EmitCanaryOutcomesOptions): EmitCanaryOutcomeReport {
  if (!isAbsolute(opts.knowledgeRoot)) throw new TypeError('knowledgeRoot must be absolute')
  if (!isAbsolute(opts.runDir)) throw new TypeError('runDir must be absolute')

  const reader = openKnowledgeReader({ knowledgeRoot: opts.knowledgeRoot })
  const outcomes = projectCanaryOutcomes({
    handoff: opts.handoff,
    resolveCandidateAnchors: (id) => reader.read(id)?.anchors,
  })
  const report: EmitCanaryOutcomeReport = { emitted: 0, refused: 0, details: [] }

  for (const projected of outcomes) {
    let outcome: EmitCanaryOutcomeResult
    try {
      opts.emit(projected)
      outcome = { kind: 'emitted' }
      report.emitted += 1
    } catch (error) {
      if (error instanceof TypeError) throw error
      outcome = { kind: 'refused', reason: 'emit-error' }
      report.refused += 1
    }
    report.details.push({
      candidateId: projected.candidateId,
      stepIndex: projected.stepIndex,
      outcome,
    })
  }
  return report
}
