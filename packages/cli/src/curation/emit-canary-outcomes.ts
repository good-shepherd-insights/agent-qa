import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import { LOCAL_CURATION_CAPABILITIES } from '@vostride/agent-qa-agent-local'
import {
  admitAnalysisArtifactForRun,
  ANALYSIS_FILE,
  canonicalJson,
  deriveMemoryOnPathSites,
  guardRunAnalysisArtifact,
  misdirectionSourceDigest,
  normalizeAnchor,
  resolveRunVerdicts,
  type Anchor,
  type CanaryOutcome,
  type CompletedRunHandoff,
  type CrossCheck,
  type MisdirectionRecordResult,
  type PerTestOutcome,
  type RecordId,
  type RunAnalysisArtifact,
  type StepEvidence,
  type Verdict,
} from '@vostride/agent-qa-schema'

import { exercisedAnchors } from './handoff-anchors.js'
import { readCompletedCanaryAblations, saveCompletedCanaryAblation } from './canary-run-state.js'
import { readCompletedMisdirectionChecks } from './misdirection-run-state.js'
import { creditCanaryAttributions, emptyCanaryCreditCounters,
  type CanaryAblation, type CanaryCreditCounters, type CreditedCanaryAttribution } from './canary-credit.js'

// 2026-09-07, 418 D-10: runtime and never-bar pin this closed vocabulary.
export type NonSignalClass = 'environment' | 'timeout' | 'flake'
// prettier-ignore
export const NON_SIGNAL_CLASSES = ['environment', 'timeout', 'flake'] as const satisfies readonly NonSignalClass[]
const NON_ATTRIBUTABLE_FAILURES = new Set<string>(NON_SIGNAL_CLASSES)
export function isNonSignalClass(value: string): value is NonSignalClass {
  return NON_ATTRIBUTABLE_FAILURES.has(value)
}

/**
 * The RESOLVED class per member test, computed ONCE per fold (389-06, D-10).
 *
 * Two layers, in overwrite order:
 *
 * 1. Members OUTSIDE the accessor's domain first — clean passes keep their persisted
 *    classification (the runner's one pass-mintable class is `flake`, `classifyRootCause`'s
 *    retry rule). The supersession law governs failure-worthy members only, so this read can
 *    never contradict a resolved verdict: the accessor never serves one for these members,
 *    and the analysis boundary discards author entries that re-class them.
 * 2. THE one supersedable-verdict read — `resolveRunVerdicts` (D-10): artifact verdicts when
 *    the artifact is present, the deterministic floor when it is absent. It OVERWRITES layer
 *    1 for every member it governs, which is exactly how an unknown→flake upgrade flips
 *    attribution here (flake is non-attributable) instead of the outcome log contradicting
 *    the resolved verdict (SC2's "second independent observation" in disguise).
 */
type ResolvedClasses = ReadonlyMap<number, Verdict['class']>

function resolveAttributionClasses(
  artifact: RunAnalysisArtifact | undefined,
  handoff: CompletedRunHandoff,
): ResolvedClasses {
  const classes = new Map<number, Verdict['class']>()
  for (const member of handoff.tests) {
    if (member.rootCause !== undefined) classes.set(member.testIndex, member.rootCause.class)
  }
  for (const verdict of resolveRunVerdicts(artifact, handoff)) {
    classes.set(verdict.perTest, verdict.class)
  }
  return classes
}

/**
 * One run's persisted analysis artifact, loaded from the fold's OWN `runDir` through the one
 * schema guard (RESEARCH A4 — `runDir` is already on the fold's options, no new port). An
 * absent file is `undefined` — the floor; a newer schemaVersion is the guard's typed hard
 * failure, never swallowed into a silent floor. A PRESENT file recording ANOTHER run's id
 * is refused by identity (`admitAnalysisArtifactForRun`, G-389-3A) and folds to the floor:
 * attribution never flips off another run's verdicts, the 388 cross-instance class.
 */
function loadRunAnalysisArtifact(
  runDir: string,
  runId: string,
): RunAnalysisArtifact | undefined {
  let bytes: string
  try {
    bytes = readFileSync(join(runDir, ANALYSIS_FILE), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const admission = admitAnalysisArtifactForRun(
    guardRunAnalysisArtifact(JSON.parse(bytes)),
    runId,
  )
  return admission.kind === 'admitted' ? admission.artifact : undefined
}

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
  /**
   * The run's persisted analysis artifact when one exists (389-06, D-10). Data, not a port:
   * `emitCanaryOutcomes` loads it from the fold's own `runDir`; the pure projection takes it
   * as an argument so identical (handoff, artifact) bytes keep yielding identical outcomes.
   */
  artifact?: RunAnalysisArtifact
  /**
   * The circularity arbiter's per-record rows (422-16, D-20), when the handoff's own published
   * sidecar is not the copy the caller holds — `emitCanaryOutcomes` supplies this only for the
   * durable-recovery case below. ABSENT here means "read `handoff.misdirectionEvidence`", which
   * is itself absent on every run written before 422. Data, never a port.
   */
  misdirectionEvidence?: readonly MisdirectionRecordResult[]
  resolveCandidateAnchors: (id: RecordId) => CandidateAnchorResolution
}

export type CandidateAnchorResolution =
  | { kind: 'resolved'; anchors: Anchor[] }
  | { kind: 'unresolved'; reason: 'not-found' | 'invalid' | 'lookup-error'; detail?: string }

export type EmitCanaryOutcomeResult =
  | { kind: 'non-signal'; class: NonSignalClass }
  | { kind: 'emitted' }
  | { kind: 'refused'; reason: 'emit-error' }
  | {
      kind: 'unresolved'
      reason: Extract<CandidateAnchorResolution, { kind: 'unresolved' }>['reason']
      detail?: string
    }

export type EmitCanaryOutcomeDetail = {
  staged?: never
  benefit?: never
  crossCheck?: never
  corpusDigestMoved?: never
  misdirectionFlipped?: never
  candidateId?: never
  stepIndex?: never
  testId: string
  testIndex: number
  outcome: { kind: 'rerun-excluded' }
} | {
  staged?: true
  benefit: CanaryOutcome['benefit']
  crossCheck?: CrossCheck
  corpusDigestMoved?: true
  /**
   * 422-16 (D-20): this row reached the harmed-outcome writer on the arbiter's CAUSAL evidence,
   * not on anchor contact. Distinct from `crossCheck` beside it, which is the Gate-2 ABLATION's
   * answer about a positive — two different cross-checks, and conflating them would read a
   * removal that proved harm as a removal that proved benefit.
   */
  misdirectionFlipped?: true
  candidateId: RecordId
  testId: string
  testIndex: number
  stepIndex: number
  outcome: EmitCanaryOutcomeResult
}

export interface EmitCanaryOutcomeReport {
  canary: CanaryCreditCounters
  emitted: number
  refused: number
  unresolved: number
  /** D-12: per-source split of the planSource attribution stream; totals cover BOTH sources. */
  procedure: {
    emitted: number
    refused: number
    unresolved: number
  }
  /**
   * 422-16 (D-20): rows the arbiter's FLIPPED evidence sent to the harmed-outcome writer carry
   * `misdirectionFlipped` on their DETAIL, and are counted from there rather than from a
   * fourth total here. Two reasons, both deliberate. The consequence is the ordinary harmed
   * outcome, so a parallel total would invite a reader to add it to `emitted`. And a required
   * new member on this report would break every existing `emitCanaryOutcomes` double in the
   * tree — the tail reads the rows it already renders, exactly as `candidateSummaryLine` does.
   */
  details: EmitCanaryOutcomeDetail[]
}

export interface EmitCanaryOutcomesOptions {
  credit?: Partial<Pick<import('./canary-credit.js').CanaryCreditInput, 'ablation' | 'maxAblations' | 'readBundleStateDigests'>>
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

/** The class switch consumes the RESOLVED class (D-10) — never the handoff field. */
function nonAttributableFailure(test: PerTestOutcome, resolved: ResolvedClasses): boolean {
  const resolvedClass = resolved.get(test.testIndex)
  return resolvedClass !== undefined && NON_ATTRIBUTABLE_FAILURES.has(resolvedClass)
}

function attributedOutcome(
  test: PerTestOutcome,
  step: StepEvidence,
  resolved: ResolvedClasses,
): CanaryOutcome['runOutcome'] | undefined {
  if (step.verifierVerdict.pass) return 'positive'
  if (nonAttributableFailure(test, resolved)) return undefined
  return 'negative'
}

/**
 * THE CAUSAL EXPOSURE SET (422-16, D-20).
 *
 * `attributedOutcome` above suppresses attribution for the three non-signal classes because
 * CONTACT evidence — a served record whose anchor the failing step happened to touch — cannot
 * distinguish "the record misled the run" from "the record rode along while the network died"
 * (418 D-11). That reasoning does not survive contact with CAUSAL evidence. A `flipped` row is
 * the arbiter having REMOVED the record, replayed, and watched the outcome change: it is a
 * measurement of causation, and no class word outranks a measurement.
 *
 * So this set is folded BEFORE the class switch and consumed ahead of it. What it deliberately
 * does NOT read is the class, the producer, the model that minted either, or the evaluation-root
 * posture the run operated under — vary any of those with the rows held fixed and the emitted
 * consequence is the same bytes.
 *
 * KEY INTEGRITY IS FAIL-CLOSED AND IS APPLIED HERE, not inherited. `aggregateMisdirectionEvidence`
 * refuses a foreign run, a foreign source-digest identity, an exposure no brief recorded and a
 * second conflicting row for one exposure; the handoff loader refuses the first three again at
 * the load boundary. Trust motion is the one consequence that cannot be taken back, so the same
 * four refusals are re-applied at the point where trust actually moves, and each one mints
 * NOTHING rather than harm. A second row disagreeing with the first withdraws the exposure
 * entirely: two answers to one check is not a check.
 */
/** U+001F, a separator no component can contain: (1, '1x') and (11, 'x') stay two exposures. */
const EXPOSURE_SEPARATOR = '\u001F'

function exposureKey(perTest: number, stepIndex: number, recordId: RecordId): string {
  return [perTest, stepIndex, recordId].join(EXPOSURE_SEPARATOR)
}

function flippedExposures(
  handoff: CompletedRunHandoff,
  evidence: readonly MisdirectionRecordResult[] | undefined,
): ReadonlySet<string> {
  if (evidence === undefined || evidence.length === 0) return new Set<string>()
  const runId = String(handoff.runId)
  const baseDigest = misdirectionSourceDigest(handoff)
  // The exposures the run's OWN briefs recorded — the same code-owned membership 422-11's
  // `deriveMemoryOnPathSites` computes, so a row can never name a site nobody served.
  const exposed = new Set<string>()
  for (const test of handoff.tests) {
    for (const site of deriveMemoryOnPathSites(test.steps)) {
      exposed.add(exposureKey(test.testIndex, site.stepIndex, site.recordId))
    }
  }
  const flipped = new Set<string>()
  const answered = new Set<string>()
  for (const row of evidence) {
    if (row.runId !== runId) continue
    if (row.handoffBaseDigest !== baseDigest) continue
    const key = exposureKey(row.perTest, row.stepIndex, row.recordId)
    if (!exposed.has(key)) continue
    if (answered.has(key)) {
      flipped.delete(key)
      continue
    }
    answered.add(key)
    if (row.crossCheck === 'flipped') flipped.add(key)
  }
  return flipped
}

/**
 * The records this step's own briefs exposed whose cross-check flipped, in brief order.
 *
 * Read off `deriveMemoryOnPathSites` rather than `servedCanaryIds`, and that is the whole
 * difference between the two id sources: the canary source is Channel-1 lines carrying the
 * `servedAsCanary` marker, while the arbiter checks every LOW-TRUST exposure — an ordinary
 * pre-promotion candidate included. A causal record that never rode a canary slot is still the
 * record that misled the run.
 */
function causalRecordsOn(
  test: PerTestOutcome,
  step: StepEvidence,
  flipped: ReadonlySet<string>,
): RecordId[] {
  if (flipped.size === 0 || step.verifierVerdict.pass) return []
  const ids: RecordId[] = []
  for (const site of deriveMemoryOnPathSites([step])) {
    if (!flipped.has(exposureKey(test.testIndex, site.stepIndex, site.recordId))) continue
    if (!ids.includes(site.recordId)) ids.push(site.recordId)
  }
  return ids
}

/**
 * D-12's second attribution source: the typed `planSource` marker. A clean full replay flows
 * through the SAME classifier gate as Pin 1 (`attributedOutcome`). An adapter execution failure
 * after a passed guard can never certify the procedure positive, even when live planning later
 * recovers the step; a verifier rejection is likewise attributable negative evidence. A clean
 * fold can earn positive attribution only after every stored action completed and the verifier
 * accepted the result — incomplete replay can never borrow a later live-planned PASS (CR-02).
 * A staleness guard miss attributes a negative regardless of the eventual verdict. All negative
 * lanes remain gated by the root-cause classifier, because environment/timeout/flake failures
 * never damn the procedure (D-11). `procedure-hint` exposure is recorded, never judged.
 *
 * Positive replay confirmations adopt D-01's per-trajectory passing gate (extraction and
 * confirmation feed the same trust ladder, D-05), so a run that fails cannot raise the
 * confidence of the procedure that failed it; suppression is never inversion (D-11) — a
 * verified-PASS replayed step inside a non-passed test projects nothing at all.
 */
function procedureReplayOutcome(
  test: PerTestOutcome,
  step: StepEvidence,
  resolved: ResolvedClasses,
): CanaryOutcome['runOutcome'] | undefined {
  const source = step.planSource
  if (source === undefined || source.kind !== 'procedure-replay') return undefined
  if (source.guard.executionFailure !== undefined) {
    return nonAttributableFailure(test, resolved) ? undefined : 'negative'
  }
  if (source.guard.verifierRejection !== undefined) {
    return nonAttributableFailure(test, resolved) ? undefined : 'negative'
  }
  const miss = source.guard.miss
  if (miss === undefined) {
    const outcome = attributedOutcome(test, step, resolved)
    if (outcome === 'positive' && source.guard.checksPassed !== source.guard.total) {
      return undefined
    }
    if (outcome === 'positive' && test.outcome !== 'passed') {
      return undefined
    }
    return outcome
  }
  if (!STALENESS_MISS_REASONS.has(miss.reason)) return undefined
  return nonAttributableFailure(test, resolved) ? undefined : 'negative'
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

export type ProjectedCanaryAttribution =
  | { kind: 'rerun-excluded'; testId: string; testIndex: number }
  | {
      kind: 'non-signal'
      source: AttributionSource
      class: NonSignalClass
      candidateId: RecordId
      testId: string
      testIndex: number
      stepIndex: number
    }
  | {
      kind: 'outcome'
      source: AttributionSource
      outcome: CanaryOutcome
      /** 422-16 (D-20): selected by the arbiter's flipped row rather than by anchor contact. */
      misdirectionFlipped?: true
    }
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

  // Resolved ONCE per fold, consumed by every class-switched site below (D-10).
  const resolved = resolveAttributionClasses(input.artifact, input.handoff)
  // Folded ONCE per fold, consumed AHEAD of every class-switched site (422-16, D-20). The
  // handoff's own published sidecar is the authority; an explicit argument is the durable
  // recovery `emitCanaryOutcomes` supplies when no sidecar member exists at all.
  const flipped = flippedExposures(
    input.handoff,
    input.misdirectionEvidence ?? input.handoff.misdirectionEvidence,
  )

  const projected: ProjectedCanaryAttribution[] = []
  for (const test of input.handoff.tests) {
    // 418 D-09: one diagnostic per member, before either attribution source or lookup.
    if (test.isRerun === true) {
      projected.push({ kind: 'rerun-excluded', testId: test.testId, testIndex: test.testIndex })
      continue
    }
    for (const step of test.steps) {
      projectBriefAttributions(input, test, step, resolveAnchors, resolved, flipped, projected)
      projectProcedureAttribution(input, test, step, resolveAnchors, resolved, projected)
    }
  }
  return projected
}

function projectBriefAttributions(
  input: ProjectCanaryOutcomesInput,
  test: PerTestOutcome,
  step: StepEvidence,
  resolveAnchors: (id: RecordId) => CandidateAnchorResolution,
  resolved: ResolvedClasses,
  flipped: ReadonlySet<string>,
  projected: ProjectedCanaryAttribution[],
): void {
  const runOutcome = attributedOutcome(test, step, resolved)
  const resolvedClass = resolved.get(test.testIndex)
  const causal = causalRecordsOn(test, step, flipped)
  const causalSet = new Set<RecordId>(causal)
  const nonSignal = (candidateId: RecordId): void => {
    if (resolvedClass === undefined || !isNonSignalClass(resolvedClass)) return
    projected.push({ kind: 'non-signal', source: 'served-brief', class: resolvedClass,
      candidateId, testId: test.testId, testIndex: test.testIndex, stepIndex: step.stepIndex })
  }
  if (runOutcome === undefined && causal.length === 0) {
    for (const candidateId of servedCanaryIds(step)) nonSignal(candidateId)
    return
  }
  const stepAnchors = exercisedAnchors(step)
  if (stepAnchors.length === 0 && causal.length === 0) return

  // ONE row per (record, member, step), whichever source selected it. A causal record that was
  // ALSO served as a canary takes the causal answer and is not offered a second, parallel
  // attribution — two rows for one exposure would be two votes on one observation.
  const served = servedCanaryIds(step)
  const candidateIds = [...served, ...causal.filter((id) => !served.includes(id))]

  for (const candidateId of candidateIds) {
    const causalRow = causalSet.has(candidateId)
    // D-20: causal evidence takes precedence over the resolved class. Reached BEFORE the
    // suppression `attributedOutcome` applied, and reading no class, producer or model identity.
    const rowOutcome = causalRow ? 'negative' : runOutcome
    if (rowOutcome === undefined) {
      nonSignal(candidateId)
      continue
    }
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
    // A removal cross-check is DIRECT exercise, the way a procedure replay is: the arbiter
    // proved the record drove this step by taking it away. So a causal row is not gated on the
    // anchor-contact match Pin 1 requires — it prefers the contacted anchor when one exists and
    // otherwise carries the record's first canonical anchor, exactly as the replay source does.
    const contacted = firstMatchingAnchor(resolution.anchors, stepAnchors)
    const fallback = resolution.anchors[0]
    const exercisedAnchor = contacted
      ?? (causalRow && fallback !== undefined ? normalizeAnchor(fallback) : undefined)
    if (exercisedAnchor === undefined) continue
    projected.push({
      kind: 'outcome',
      source: 'served-brief',
      ...(causalRow ? { misdirectionFlipped: true as const } : {}),
      outcome: {
        candidateId,
        runOutcome: rowOutcome,
        // 2026-09-07, 418 D-01/D-08: pure projection stays uncredited until ablated.
        benefit: 'rode-along',
        stateValidity: 'unknown',
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
          `with ${rowOutcome} verdict`,
          ...(causalRow ? ['after the misdirection cross-check flipped'] : []),
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
  resolved: ResolvedClasses,
  projected: ProjectedCanaryAttribution[],
): void {
  const source = step.planSource
  if (source === undefined || source.kind !== 'procedure-replay') return
  const runOutcome = procedureReplayOutcome(test, step, resolved)
  if (runOutcome === undefined) {
    const resolvedClass = resolved.get(test.testIndex)
    const failed = source.guard.executionFailure !== undefined
      || source.guard.verifierRejection !== undefined
      || (source.guard.miss !== undefined && STALENESS_MISS_REASONS.has(source.guard.miss.reason))
      || (source.guard.miss === undefined && !step.verifierVerdict.pass)
    if (failed && resolvedClass !== undefined && isNonSignalClass(resolvedClass)) {
      projected.push({ kind: 'non-signal', source: 'procedure-replay', class: resolvedClass,
        candidateId: source.procedureId, testId: test.testId, testIndex: test.testIndex,
        stepIndex: step.stepIndex })
    }
    return
  }

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
  const verifierRejection = source.guard.verifierRejection
  const attributionDetail = executionFailure !== undefined
    ? `with execution failure at procedure step ${executionFailure.procedureStepIndex}`
    : verifierRejection !== undefined
      ? `with verifier rejection at procedure step ${verifierRejection.procedureStepIndex}`
      : miss !== undefined
        ? `with guard miss ${miss.reason} at procedure step ${miss.procedureStepIndex}`
        : `with ${runOutcome} verdict`
  projected.push({
    kind: 'outcome',
    source: 'procedure-replay',
    outcome: {
      candidateId: source.procedureId,
      runOutcome,
      // 2026-09-07, 418 D-01/D-08: pure projection stays uncredited until ablated.
      benefit: 'rode-along',
      stateValidity: 'unknown',
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

/** Resolves anchors read-only, credits evidence, then emits every attribution in isolation. */
export async function emitCanaryOutcomes(opts: EmitCanaryOutcomesOptions): Promise<EmitCanaryOutcomeReport> {
  if (!isAbsolute(opts.knowledgeRoot)) throw new TypeError('knowledgeRoot must be absolute')
  if (!isAbsolute(opts.runDir)) throw new TypeError('runDir must be absolute')

  // The D-10 rewire (389-06): the artifact is loaded from the fold's OWN runDir, once per
  // fold, and every class switch downstream consumes the resolved verdict — an upgraded run
  // re-folds with flipped attribution rather than a second independent observation (SC2).
  const artifact = loadRunAnalysisArtifact(opts.runDir, String(opts.handoff.runId))
  // 422-16 (D-20/D-18): the arbiter's rows, read ABSENT-vs-EMPTY exactly as 422-07 drew the
  // line and 422-12 held it at four boundaries. A PRESENT sidecar — including `[]` — is the
  // published authority and is used as it stands: `[]` is an arbiter that ran and recorded
  // nothing, and looking past it would read a deliberate silence as a missing file. Only a
  // handoff with NO member at all falls through to the run's own durable completions, which
  // is the crash window between the arbiter finishing and `persistMisdirectionSidecar`
  // landing. Every row is re-checked against this run's identity before it can move trust.
  const recovered = opts.handoff.misdirectionEvidence === undefined
    ? readCompletedMisdirectionChecks(opts.runDir, String(opts.handoff.runId))
    : undefined
  const projected = projectCanaryAttributions({
    handoff: opts.handoff,
    ...(artifact === undefined ? {} : { artifact }),
    ...(recovered === undefined || recovered.length === 0 ? {} : { misdirectionEvidence: recovered }),
    resolveCandidateAnchors: (id) => LOCAL_CURATION_CAPABILITIES.readCanonicalBundleAnchors({
      knowledgeRoot: opts.knowledgeRoot,
      bundleId: id,
    }),
  })
  const credit = opts.credit === undefined ? undefined : await creditCanaryAttributions({
    completedAblations: readCompletedCanaryAblations(opts.runDir, String(opts.handoff.runId)),
    saveCompletedAblation: entry => saveCompletedCanaryAblation(opts.runDir, entry),
    attributions: projected, handoff: opts.handoff, runDir: opts.runDir,
    ...opts.credit, knowledgeRoot: opts.knowledgeRoot, observationIdOf: LOCAL_CURATION_CAPABILITIES.canaryOutcomeObservationId,
    maxAblations: opts.credit.maxAblations ?? (await import('../eval-session-composition.js')).GATE2_DEFAULT_MAX_ABLATIONS,
    readBundleStateDigests: opts.credit.readBundleStateDigests ?? LOCAL_CURATION_CAPABILITIES.readCanonicalBundleStateDigests,
  })
  const canary = credit?.counters ?? emptyCanaryCreditCounters()
  if (credit === undefined) {
    canary.rideAlongUncredited = projected.filter(row =>
      row.kind === 'outcome' && row.outcome.runOutcome === 'positive').length
  }
  const report: EmitCanaryOutcomeReport = {
    canary,
    emitted: 0,
    refused: 0,
    unresolved: 0,
    procedure: { emitted: 0, refused: 0, unresolved: 0 },
    details: [],
  }

  const attributions: CreditedCanaryAttribution[] = credit?.attributions ?? projected
  for (const attribution of attributions) {
    if (attribution.kind === 'rerun-excluded') {
      report.canary.rerunExcluded += 1
      report.details.push({ testId: attribution.testId, testIndex: attribution.testIndex,
        outcome: { kind: 'rerun-excluded' } })
      continue
    }
    if (attribution.kind === 'non-signal') {
      report.canary.nonSignal[attribution.class] += 1
      report.details.push({ benefit: 'rode-along', candidateId: attribution.candidateId,
        testId: attribution.testId, testIndex: attribution.testIndex, stepIndex: attribution.stepIndex,
        outcome: { kind: 'non-signal', class: attribution.class } })
      continue
    }
    const fromProcedure = attribution.source === 'procedure-replay'
    if (attribution.kind === 'unresolved') {
      report.unresolved += 1
      if (fromProcedure) report.procedure.unresolved += 1
      report.details.push({
        benefit: 'rode-along',
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

    const causal = attribution.misdirectionFlipped === true
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
      benefit: attribution.outcome.benefit,
      crossCheck: attribution.crossCheck ?? 'not-run',
      ...(attribution.staged === undefined ? {} : { staged: attribution.staged }),
      ...(attribution.corpusDigestMoved === undefined ? {} : { corpusDigestMoved: attribution.corpusDigestMoved }),
      ...(causal ? { misdirectionFlipped: true as const } : {}),
      candidateId: attribution.outcome.candidateId,
      testId: attribution.outcome.testId,
      testIndex: attribution.outcome.testIndex,
      stepIndex: attribution.outcome.stepIndex,
      outcome,
    })
  }
  return report
}
