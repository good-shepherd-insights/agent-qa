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

/**
 * D-11: only guard misses that evidence procedure STALENESS attribute negatives. `gate-refused`
 * and `non-replayable-action` are policy walls — they say the runner refused to replay, not that
 * the procedure's descriptors or page anchors drifted — so they never damn the procedure.
 */
const STALENESS_MISS_REASONS = new Set([
  'descriptor-ambiguous',
  'descriptor-missing',
  'page-anchor-mismatch',
])

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
  /** D-12: per-source split of the planSource attribution stream; totals cover BOTH sources. */
  procedure: {
    emitted: number
    refused: number
    unresolved: number
  }
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

function nonAttributableFailure(test: PerTestOutcome): boolean {
  return test.rootCause !== undefined && NON_ATTRIBUTABLE_FAILURES.has(test.rootCause.class)
}

function attributedOutcome(
  test: PerTestOutcome,
  step: StepEvidence,
): CanaryOutcome['runOutcome'] | undefined {
  if (step.verifierVerdict.pass) return 'positive'
  if (nonAttributableFailure(test)) return undefined
  return 'negative'
}

/**
 * D-12's second attribution source: the typed `planSource` marker. A clean full replay flows
 * through the SAME classifier gate as Pin 1 (`attributedOutcome`). An adapter execution failure
 * after a passed guard can never certify the procedure positive, even when live planning later
 * recovers the step; a staleness guard miss likewise attributes a negative regardless of the
 * eventual verdict. Both remain gated by the root-cause classifier, because
 * environment/timeout/flake failures never damn the procedure (D-11). `procedure-hint`
 * exposure is recorded, never judged.
 */
function procedureReplayOutcome(
  test: PerTestOutcome,
  step: StepEvidence,
): CanaryOutcome['runOutcome'] | undefined {
  const source = step.planSource
  if (source === undefined || source.kind !== 'procedure-replay') return undefined
  if (source.guard.executionFailure !== undefined) {
    return nonAttributableFailure(test) ? undefined : 'negative'
  }
  const miss = source.guard.miss
  if (miss === undefined) return attributedOutcome(test, step)
  if (!STALENESS_MISS_REASONS.has(miss.reason)) return undefined
  return nonAttributableFailure(test) ? undefined : 'negative'
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

type AttributionSource = 'served-brief' | 'procedure-replay'

type ProjectedCanaryAttribution =
  | { kind: 'outcome'; source: AttributionSource; outcome: CanaryOutcome }
  | {
      kind: 'unresolved'
      source: AttributionSource
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
      projectBriefAttributions(input, test, step, resolveAnchors, projected)
      projectProcedureAttribution(input, test, step, resolveAnchors, projected)
    }
  }
  return projected
}

function projectBriefAttributions(
  input: ProjectCanaryOutcomesInput,
  test: PerTestOutcome,
  step: StepEvidence,
  resolveAnchors: (id: RecordId) => CandidateAnchorResolution,
  projected: ProjectedCanaryAttribution[],
): void {
  const runOutcome = attributedOutcome(test, step)
  if (runOutcome === undefined) return
  const stepAnchors = exercisedAnchors(step)
  if (stepAnchors.length === 0) return

  for (const candidateId of servedCanaryIds(step)) {
    const resolution = resolveAnchors(candidateId)
    if (resolution.kind === 'unresolved') {
      projected.push({
        kind: 'unresolved',
        source: 'served-brief',
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
      source: 'served-brief',
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

/**
 * The planSource attribution source (D-12). Unlike Pin 1, replay is DIRECT exercise: the guard
 * fold proves the procedure drove (or failed to drive) the step, so no anchor-contact match
 * against the step's exercised anchors is required — a guard-miss step's exercised anchors come
 * from the planning fallback and would wrongly drop the staleness negative. The outcome carries
 * the procedure's first canonical anchor as its exercised anchor.
 */
function projectProcedureAttribution(
  input: ProjectCanaryOutcomesInput,
  test: PerTestOutcome,
  step: StepEvidence,
  resolveAnchors: (id: RecordId) => CandidateAnchorResolution,
  projected: ProjectedCanaryAttribution[],
): void {
  const source = step.planSource
  if (source === undefined || source.kind !== 'procedure-replay') return
  const runOutcome = procedureReplayOutcome(test, step)
  if (runOutcome === undefined) return

  const resolution = resolveAnchors(source.procedureId)
  if (resolution.kind === 'unresolved') {
    projected.push({
      kind: 'unresolved',
      source: 'procedure-replay',
      candidateId: source.procedureId,
      testId: test.testId,
      testIndex: test.testIndex,
      stepIndex: step.stepIndex,
      reason: resolution.reason,
      ...(resolution.detail === undefined ? {} : { detail: resolution.detail }),
    })
    return
  }
  const anchor = resolution.anchors[0]
  if (anchor === undefined) return
  const miss = source.guard.miss
  const executionFailure = source.guard.executionFailure
  const attributionDetail = executionFailure !== undefined
    ? `with execution failure at procedure step ${executionFailure.procedureStepIndex}`
    : miss !== undefined
      ? `with guard miss ${miss.reason} at procedure step ${miss.procedureStepIndex}`
      : `with ${runOutcome} verdict`
  projected.push({
    kind: 'outcome',
    source: 'procedure-replay',
    outcome: {
      candidateId: source.procedureId,
      runOutcome,
      runId: String(input.handoff.runId),
      testId: test.testId,
      testIndex: test.testIndex,
      buildOrdinal: input.handoff.buildOrdinal,
      stepIndex: step.stepIndex,
      briefDigest: step.servedBrief.briefDigest,
      attribution: [
        `Procedure ${source.procedureId} replayed`,
        `on test ${test.testIndex} (${test.testId}) step ${step.stepIndex}`,
        attributionDetail,
      ].join(' '),
      exercisedAnchor: normalizeAnchor(anchor),
    } satisfies CanaryOutcome,
  })
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
    procedure: { emitted: 0, refused: 0, unresolved: 0 },
    details: [],
  }

  for (const attribution of projected) {
    const fromProcedure = attribution.source === 'procedure-replay'
    if (attribution.kind === 'unresolved') {
      report.unresolved += 1
      if (fromProcedure) report.procedure.unresolved += 1
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
      if (fromProcedure) report.procedure.emitted += 1
    } catch (error) {
      if (error instanceof TypeError) throw error
      outcome = { kind: 'refused', reason: 'emit-error' }
      report.refused += 1
      if (fromProcedure) report.procedure.refused += 1
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
