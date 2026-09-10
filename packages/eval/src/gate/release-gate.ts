import { assertBaselineComparator, renderBaselineComparatorRefusal } from '../baseline/comparator'
import { composeBaselineProfileKey } from '../baseline/profile-key'
import type { BaselinePointerLoad } from '../baseline/profile-key'
import { canonicalJson } from '../canonical-json'
import type { DecisionVectorsDocument } from '../match/decision-vectors'
import type { EvalBatchReport } from '../match/metrics'
import { REPLAY_REFUSAL_REASONS } from '../replay/result'
import { FLOOR_AXES, axisVectors } from '../stats/decision-vector'
import type { DecisionCorrectnessVector, FloorAxis } from '../stats/decision-vector'
import { pairedDecisionDiff } from '../stats/paired'
import type { NoiseFloorArtefact } from './floor-artefact'
import { assertFloorArtefactCommittable, renderFloorRefusal } from './floor-artefact'

// prettier-ignore
export const GATE_INCONCLUSIVE_REASONS = ['missing-baseline', 'incomparable-baseline', 'missing-floor', 'stale-baseline', 'stale-floor', 'seed-regime-mismatch', 'harness-errors', 'never-scored', 'refusal-population-differs', 'no-decision-vector'] as const
export type GateInconclusiveReason = (typeof GATE_INCONCLUSIVE_REASONS)[number]
export type GateExit = 0 | 1 | 2

export interface GateRegression {
  axis: FloorAxis
  baseline: number
  current: number
  delta: number
  floor: number
  n: number
}

export interface GateVerdict {
  /** Disclosure only; never an input to the paired-vector floor law. */
  labelMetrics: LabelMetricComparison
  exit: GateExit
  /** One entry per reason; its detail preserves every applicable side and value. */
  inconclusive: readonly { reason: GateInconclusiveReason; detail: string }[]
  regressions: readonly GateRegression[]
  skippedAxes: readonly { axis: FloorAxis; reason: string }[]
  refusals: { baseline: Record<string, number>; current: Record<string, number> }
  pairing: {
    n: number
    discordant: number
    baselineOnly: number
    currentOnly: number
    renderedExcluded: number
  }
  seed: { current?: boolean; floor?: boolean; regime: 'match' | 'mismatch' | 'unknown' }
  population: { proof: number; empty: number; rendered: number }
}

export interface ComputeGateVerdictInput {
  expectedProfileKey: string
  pointer: { kind: 'absent'; others: readonly { profileKey: string }[] } | BaselinePointerLoad
  floor?: NoiseFloorArtefact
  baseline?: { report: EvalBatchReport; vectors?: DecisionVectorsDocument }
  current: {
    report: EvalBatchReport
    vectors: readonly DecisionCorrectnessVector[]
    fingerprint: string
    corpusDigest: string
  }
}

const designate = 'eval report --baseline --from-committed <batchKey> --seed-policy <none|declared>'
const measureFloor = 'eval floor --commit'

type CostUnit = 'promptTokens' | 'completionTokens' | 'totalTokens' | 'durationMs'
type SplitId = 'natural' | 'held-out.shared' | 'held-out.private' | 'adversarial'
export type LabelMetricId = 'verifierFalsePassRate' | 'recovery.raw' | 'recovery.weighted'
  | `perDecisionCost.${CostUnit}` | `perSplit.${SplitId}`
type MetricReason = 'missing-baseline' | 'missing-profile' | 'profile-mismatch'
  | 'missing-field' | 'invalid-field' | 'zero-denominator'
interface MetricIssue { side: 'baseline' | 'current'; reason: MetricReason; field: string }
interface MetricMeasurement {
  numerator?: number
  denominator?: number
  rate?: number
  /** Weighted numerator is derived from the persisted rate and sum, not a new population fold. */
  numeratorBasis?: 'weightedAccuracy * weightSum'
  recoveredPositiveCount?: number
  eligiblePositiveCount?: number
  pairsWithoutWeight?: number
}
export type LabelMetricRow = {
  metric: LabelMetricId
  unit: 'ratio' | CostUnit
  baseline: MetricMeasurement
  current: MetricMeasurement
} & ({ status: 'comparable'; delta: number }
  | { status: 'not-comparable'; reasons: readonly MetricIssue[] })
export interface LabelMetricComparison {
  profileKey: string
  rows: readonly LabelMetricRow[]
  calibration: { baseline: CalibrationEvidence; current: CalibrationEvidence }
}
type CalibrationEvidence = EvalBatchReport['calibration']
  | { status: 'not-available'; reason: 'missing-field' | 'invalid-field' }

function field(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((object, key) =>
    object !== null && typeof object === 'object' && !Array.isArray(object)
      ? (object as Record<string, unknown>)[key] : undefined, value)
}

function amount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function calibrationEvidence(report: EvalBatchReport | undefined): CalibrationEvidence {
  const value = report?.calibration
  if (value === undefined) return { status: 'not-available', reason: 'missing-field' }
  const n = field(value, 'n_gold'), status = field(value, 'status')
  const rate = field(value, 'verifierFalsePassRate')
  const issues: MetricIssue[] = []
  if (rate !== undefined) rateMeasurement(rate, 'baseline', 'calibration.verifierFalsePassRate', issues)
  if ((status !== 'calibrated' && status !== 'uncalibrated')
    || (n !== undefined && !isCount(n)) || issues.some(issue => issue.reason !== 'zero-denominator')
    || (status === 'calibrated' && (n === undefined || rate === undefined))) {
    return { status: 'not-available', reason: 'invalid-field' }
  }
  return { status, ...(n === undefined ? {} : { n_gold: n }),
    ...(rate === undefined ? {} : { verifierFalsePassRate: { ...value.verifierFalsePassRate! } }) } as EvalBatchReport['calibration']
}

function measuredNumber(value: unknown, side: MetricIssue['side'], path: string,
  issues: MetricIssue[], count = false): number | undefined {
  if (!(count ? isCount(value) : amount(value))) {
    issues.push({ side, reason: value === undefined ? 'missing-field' : 'invalid-field', field: path })
    return undefined
  }
  return value as number
}

function rateMeasurement(value: unknown, side: MetricIssue['side'], path: string,
  issues: MetricIssue[]): MetricMeasurement {
  const numerator = measuredNumber(field(value, 'numerator'), side, `${path}.numerator`, issues, true)
  const denominator = measuredNumber(field(value, 'denominator'), side, `${path}.denominator`, issues, true)
  const result = { ...(numerator === undefined ? {} : { numerator }),
    ...(denominator === undefined ? {} : { denominator }) }
  if (denominator === 0) {
    issues.push({ side, reason: 'zero-denominator', field: `${path}.denominator` })
    return result
  }
  const rate = measuredNumber(field(value, 'rate'), side, `${path}.rate`, issues)
  if (rate !== undefined && (rate > 1 || (numerator !== undefined && denominator !== undefined
    && (numerator > denominator || rate !== numerator / denominator)))) {
    issues.push({ side, reason: 'invalid-field', field: `${path}.rate` })
    return result
  }
  return { ...result, ...(rate === undefined ? {} : { rate }) }
}

function recoveryMeasurement(report: EvalBatchReport | undefined, weighted: boolean,
  side: MetricIssue['side'], issues: MetricIssue[]): MetricMeasurement {
  const recovery = report?.recovery
  if (!weighted) return rateMeasurement({ numerator: field(recovery, 'recoveredPositiveCount'),
    denominator: field(recovery, 'eligiblePositiveCount'), rate: field(recovery, 'recoveryAccuracy') },
  side, 'recovery.raw', issues)
  const denominator = measuredNumber(field(recovery, 'weightSum'), side, 'recovery.weightSum', issues)
  const counts = Object.fromEntries(['recoveredPositiveCount', 'eligiblePositiveCount', 'pairsWithoutWeight']
    .flatMap(key => isCount(field(recovery, key)) ? [[key, field(recovery, key)]] : []))
  const result = { ...counts, ...(denominator === undefined ? {} : { denominator }) }
  if (denominator === 0) {
    issues.push({ side, reason: 'zero-denominator', field: 'recovery.weightSum' })
    return result
  }
  const rate = measuredNumber(field(recovery, 'weightedAccuracy'), side, 'recovery.weightedAccuracy', issues)
  if (rate !== undefined && rate > 1) {
    issues.push({ side, reason: 'invalid-field', field: 'recovery.weightedAccuracy' })
    return result
  }
  return { ...result, ...(rate === undefined ? {} : { rate }),
    ...(denominator === undefined || rate === undefined ? {} : {
      numerator: rate * denominator, numeratorBasis: 'weightedAccuracy * weightSum' as const }) }
}

function costMeasurement(report: EvalBatchReport | undefined, unit: CostUnit,
  side: MetricIssue['side'], issues: MetricIssue[]): MetricMeasurement {
  const denominator = measuredNumber(field(report, 'headline.perDecisionCost.decisionCount'), side,
    'headline.perDecisionCost.decisionCount', issues, true)
  const total = measuredNumber(field(report, `totalCost.${unit}`), side, `totalCost.${unit}`, issues)
  // These report fields are already averages. Require their presence, but divide only totals.
  measuredNumber(field(report, `headline.perDecisionCost.${unit}`), side, `headline.perDecisionCost.${unit}`, issues)
  const judgeKeys = unit === 'durationMs' ? [] : unit === 'promptTokens' ? ['inputTokens']
    : unit === 'completionTokens' ? ['outputTokens'] : ['inputTokens', 'outputTokens']
  const judge = judgeKeys.map(key => measuredNumber(field(report, `honesty.judge.cost.${key}`), side,
    `honesty.judge.cost.${key}`, issues))
  const numerator = total === undefined || judge.some(value => value === undefined)
    ? undefined : total + judge.reduce<number>((sum, value) => sum + value!, 0)
  if (numerator !== undefined && !amount(numerator)) {
    issues.push({ side, reason: 'invalid-field', field: `totalCost.${unit}` })
  }
  if (denominator === 0) issues.push({ side, reason: 'zero-denominator', field: 'headline.perDecisionCost.decisionCount' })
  return { ...(numerator === undefined || !amount(numerator) ? {} : { numerator }),
    ...(denominator === undefined ? {} : { denominator }),
    ...(denominator === undefined || denominator === 0 || numerator === undefined || !amount(numerator)
      ? {} : { rate: numerator / denominator }) }
}

function metricIdentityIssues(input: ComputeGateVerdictInput): MetricIssue[] {
  const issues: MetricIssue[] = []
  const { pointer, expectedProfileKey, baseline, current } = input
  if (baseline === undefined) issues.push({ side: 'baseline', reason: 'missing-baseline', field: 'report' })
  if (pointer.kind !== 'v2') return [...issues, { side: 'baseline', reason: 'missing-profile', field: 'pointer' }]
  const p = pointer.pointer
  if (p.profileKey !== expectedProfileKey || composeBaselineProfileKey(p) !== expectedProfileKey) {
    issues.push({ side: 'baseline', reason: 'profile-mismatch', field: 'pointer.profileKey' })
  }
  for (const [side, report] of [['baseline', baseline?.report], ['current', current.report]] as const) {
    if (report === undefined) continue
    if (report.matcherVersion !== p.matcherVersion || report.judge?.judgeModelId !== p.judgeModelId
      || report.judge?.judgeVersion !== p.judgeVersion || !assertBaselineComparator(report).ok
      || (side === 'baseline' && report.batchKey !== p.batchKey)
      || (side === 'current' && current.fingerprint !== p.fingerprint)
      || (report.runIdentity !== undefined && report.runIdentity?.fingerprint !== p.fingerprint)) {
      issues.push({ side, reason: 'profile-mismatch', field: 'report.identity' })
    }
  }
  return issues
}

function compareLabelMetrics(input: ComputeGateVerdictInput): LabelMetricComparison {
  const identity = metricIdentityIssues(input)
  const rows: LabelMetricRow[] = []
  const add = (metric: LabelMetricId, unit: LabelMetricRow['unit'],
    measure: (report: EvalBatchReport | undefined, side: MetricIssue['side'], issues: MetricIssue[]) => MetricMeasurement) => {
    const reasons = [...identity]
    const baseline = measure(input.baseline?.report, 'baseline', reasons)
    const current = measure(input.current.report, 'current', reasons)
    rows.push({ metric, unit, baseline, current, ...(reasons.length > 0
      ? { status: 'not-comparable' as const, reasons }
      : { status: 'comparable' as const, delta: current.rate! - baseline.rate! }) })
  }
  add('verifierFalsePassRate', 'ratio', (report, side, issues) =>
    rateMeasurement(report?.headline?.verifierFalsePassRate, side, 'headline.verifierFalsePassRate', issues))
  for (const weighted of [false, true]) add(weighted ? 'recovery.weighted' : 'recovery.raw', 'ratio',
    (report, side, issues) => recoveryMeasurement(report, weighted, side, issues))
  for (const unit of ['promptTokens', 'completionTokens', 'totalTokens', 'durationMs'] as const) {
    add(`perDecisionCost.${unit}`, unit, (report, side, issues) => costMeasurement(report, unit, side, issues))
  }
  for (const split of ['natural', 'held-out.shared', 'held-out.private', 'adversarial'] as const) {
    const path = `perSplit.${split}.firstAttemptDecisionAccuracy`
    add(`perSplit.${split}`, 'ratio', (report, side, issues) => rateMeasurement(field(report, path), side, path, issues))
  }
  return { profileKey: input.expectedProfileKey, rows, calibration: {
    baseline: calibrationEvidence(input.baseline?.report), current: calibrationEvidence(input.current.report) } }
}

function refusalCounts(report: EvalBatchReport | undefined): Record<string, number> {
  if (!isCounts(report?.honesty?.refusalCounts)) return {}
  return Object.fromEntries(
    REPLAY_REFUSAL_REASONS.map(reason => [reason, report!.honesty.refusalCounts[reason] ?? 0]),
  )
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isCounts(value: unknown): value is Record<string, number> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.values(value).every(isCount)
}

function hasNeverScoredEvidence(value: unknown): boolean {
  if (!isCounts(value)) return false
  // These existing report counters are required evidence, unlike historical refusal keys.
  return ['all-samples-harness-error', 'modal-representative-missing', 'missing-cassette-decision']
    .every(key => isCount(value[key]))
}

function describeCounts(value: unknown): string {
  return value === undefined ? 'absent' : JSON.stringify(value)
}

function duplicateKeys(vectors: readonly DecisionCorrectnessVector[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const vector of vectors) {
    if (seen.has(vector.key)) duplicates.add(vector.key)
    seen.add(vector.key)
  }
  return [...duplicates].sort()
}

/** Pure comparison over loaded evidence. Only caller-contract failures throw. */
export function computeGateVerdict(input: ComputeGateVerdictInput): GateVerdict {
  const { pointer: loaded, floor, baseline, current, expectedProfileKey } = input
  if (typeof expectedProfileKey !== 'string') {
    throw new TypeError('expectedProfileKey must be a string')
  }
  if (typeof current.report.batchKey !== 'string' || current.report.batchKey.length === 0) {
    throw new TypeError('current report must carry a batchKey')
  }

  const details: Partial<Record<GateInconclusiveReason, string[]>> = {}
  const add = (reason: GateInconclusiveReason, detail: string): void => {
    const messages = details[reason] ?? []
    messages.push(detail)
    details[reason] = messages
  }
  const mismatch = (field: string, a: string, av: unknown, b: string, bv: unknown): void => {
    if (av !== bv) {
      add('incomparable-baseline',
        `${field}: ${a}=${av ?? 'absent'} ${b}=${bv ?? 'absent'}; ` +
        `re-designate with ${designate}; re-measure a differing floor with ${measureFloor}`,
      )
    }
  }
  // An absent judge block on a mixed current batch is not honest judge abstention.
  const currentComparator = assertBaselineComparator(current.report)
  if (!currentComparator.ok) {
    add('incomparable-baseline', `current: ${renderBaselineComparatorRefusal(currentComparator.refusal)}`)
  }

  if (loaded.kind === 'absent') {
    add('missing-baseline',
      `no pointer for ${expectedProfileKey}; other profiles for this planner: ` +
      `${loaded.others.map(other => other.profileKey).join(', ') || 'none'}; ${designate}`,
    )
  } else if (loaded.kind === 'rejected') {
    add('incomparable-baseline', `pointer rejected: ${loaded.reason}; ${designate}`)
  } else if (loaded.kind === 'v1') {
    add('incomparable-baseline', `no-fingerprint: historical pointer ${loaded.pointer.profileKey}; ${designate}`)
  }
  const pointer = loaded.kind === 'v1' || loaded.kind === 'v2' ? loaded.pointer : undefined
  if (baseline === undefined) {
    add('missing-baseline', `baseline report for batch ${pointer?.batchKey ?? 'absent'} is absent; ${designate}`)
  } else {
    const comparator = assertBaselineComparator(baseline.report)
    if (!comparator.ok) add('incomparable-baseline', renderBaselineComparatorRefusal(comparator.refusal))
    mismatch('matcherVersion', 'baseline report', baseline.report.matcherVersion, 'current report', current.report.matcherVersion)
    mismatch('judgeModelId', 'baseline report', baseline.report.judge?.judgeModelId, 'current report', current.report.judge?.judgeModelId)
    mismatch('judgeVersion', 'baseline report', baseline.report.judge?.judgeVersion, 'current report', current.report.judge?.judgeVersion)
  }
  if (pointer !== undefined) {
    mismatch('profileKey', 'pointer', pointer.profileKey, 'expected', expectedProfileKey)
    mismatch('matcherVersion', 'pointer', pointer.matcherVersion, 'current report', current.report.matcherVersion)
    mismatch('judgeModelId', 'pointer', pointer.judgeModelId, 'current report', current.report.judge?.judgeModelId)
    mismatch('judgeVersion', 'pointer', pointer.judgeVersion, 'current report', current.report.judge?.judgeVersion)
    if (baseline !== undefined) mismatch('batchKey', 'pointer', pointer.batchKey, 'baseline report', baseline.report.batchKey)
  }
  if (loaded.kind === 'v2') {
    mismatch('fingerprint', 'pointer', loaded.pointer.fingerprint, 'current', current.fingerprint)
    mismatch('profileKey from pointer fields', 'pointer', composeBaselineProfileKey(loaded.pointer), 'expected', expectedProfileKey)
    if (loaded.pointer.corpusDigest !== current.corpusDigest) {
      add('stale-baseline', `corpusDigest: baseline=${loaded.pointer.corpusDigest} current=${current.corpusDigest}; ${designate}`)
    }
  }

  if (floor === undefined) {
    add('missing-floor', `no floor for ${expectedProfileKey}; ${measureFloor}`)
  } else {
    const admission = assertFloorArtefactCommittable(floor)
    if (!admission.ok) add('missing-floor', `${renderFloorRefusal(admission.refusal)}; ${measureFloor}`)
    mismatch('profileKey', 'floor', floor.profileKey, 'expected', expectedProfileKey)
    mismatch('fingerprint', 'floor', floor.fingerprint, 'current', current.fingerprint)
    mismatch('profileKey from floor fields', 'floor', composeBaselineProfileKey(floor), 'expected', expectedProfileKey)
    mismatch('matcherVersion', 'floor', floor.matcherVersion, 'current report', current.report.matcherVersion)
    mismatch('judgeModelId', 'floor', floor.judgeModelId, 'current report', current.report.judge?.judgeModelId)
    mismatch('judgeVersion', 'floor', floor.judgeVersion, 'current report', current.report.judge?.judgeVersion)
    if (pointer !== undefined) mismatch('plannerModelId', 'floor', floor.plannerModelId, 'pointer', pointer.plannerModelId)
    if (floor.corpusDigest !== current.corpusDigest) {
      add('stale-floor', `corpusDigest: floor=${floor.corpusDigest} current=${current.corpusDigest}; ${measureFloor}`)
    }
    if (floor.seedHonored !== current.report.seedHonored) {
      add('seed-regime-mismatch',
        `floor seedHonored=${floor.seedHonored} current seedHonored=${current.report.seedHonored ?? 'absent'}; ` +
        `re-measure the floor with ${measureFloor}`,
      )
    }
  }

  const baselineErrors = baseline?.report.honesty?.harnessErrorCount
  const currentErrors = current.report.honesty?.harnessErrorCount
  if ((baseline !== undefined && !isCount(baselineErrors)) || !isCount(currentErrors)) {
    add('harness-errors',
      `missing or invalid harnessErrorCount evidence: baseline=${baselineErrors ?? 'absent'} current=${currentErrors ?? 'absent'}`,
    )
  }
  if ((isCount(baselineErrors) && baselineErrors > 0) || (isCount(currentErrors) && currentErrors > 0)) {
    add('harness-errors', `baseline=${baselineErrors ?? 'absent'} current=${currentErrors}`)
  }
  const baselineNeverScored = baseline?.report.honesty?.neverScoredCounts
  const currentNeverScored = current.report.honesty?.neverScoredCounts
  if ((baseline !== undefined && !hasNeverScoredEvidence(baselineNeverScored)) ||
      !hasNeverScoredEvidence(currentNeverScored)) {
    add('never-scored',
      `missing or invalid neverScoredCounts evidence: baseline=${describeCounts(baselineNeverScored)} current=${describeCounts(currentNeverScored)}`,
    )
  }
  if ((isCounts(baselineNeverScored) && Object.values(baselineNeverScored).some(count => count !== 0)) ||
      (isCounts(currentNeverScored) && Object.values(currentNeverScored).some(count => count !== 0))) {
    add('never-scored',
      `baseline=${describeCounts(baselineNeverScored)} current=${describeCounts(currentNeverScored)}`,
    )
  }
  const refusals = { baseline: refusalCounts(baseline?.report), current: refusalCounts(current.report) }
  for (const [side, report] of [['baseline', baseline?.report], ['current', current.report]] as const) {
    if (report !== undefined && !isCounts(report.honesty?.refusalCounts)) {
      add('refusal-population-differs', `${side}: refusalCounts missing or invalid: ${describeCounts(report.honesty?.refusalCounts)}`)
    }
  }
  if (baseline !== undefined && isCounts(baseline.report.honesty?.refusalCounts) &&
      isCounts(current.report.honesty?.refusalCounts)) {
    for (const reason of REPLAY_REFUSAL_REASONS) {
      const b = baseline.report.honesty.refusalCounts[reason] ?? 0
      const c = current.report.honesty.refusalCounts[reason] ?? 0
      if (b !== c) add('refusal-population-differs', `${reason}: baseline=${b} current=${c}`)
    }
  }

  const baselineDocument = baseline?.vectors
  if (baselineDocument === undefined) {
    const batchKey = baseline?.report.batchKey ?? pointer?.batchKey ?? 'absent'
    add('no-decision-vector',
      `baseline: decisions.json absent for batch ${batchKey}; eval report --commit can add the ` +
      `sidecar only when the exact baseline report is reproducible under the write-once contract; ` +
      `otherwise stage a replacement with eval report (without --commit), review and replace the ` +
      `committed report parts, then designate it with eval report --baseline --from-committed ` +
      `${batchKey} --seed-policy declared`,
    )
  } else {
    mismatch('batchKey', 'baseline vectors', baselineDocument.batchKey, 'baseline report', baseline!.report.batchKey)
    mismatch('matcherVersion', 'baseline vectors', baselineDocument.matcherVersion, 'baseline report', baseline!.report.matcherVersion)
  }

  const baselineVectors = baselineDocument?.vectors.filter(vector => vector.briefSource !== 'rendered')
  const currentVectors = current.vectors.filter(vector => vector.briefSource !== 'rendered')
  const renderedExcluded = current.vectors.length - currentVectors.length
  const baselineDuplicates = duplicateKeys(baselineDocument?.vectors ?? [])
  const currentDuplicates = duplicateKeys(current.vectors)
  for (const [side, keys] of [['baseline', baselineDuplicates], ['current', currentDuplicates]] as const) {
    if (keys.length > 0) add('no-decision-vector', `${side}: duplicate decision keys: ${keys.join(', ')}; cannot pair without changing the recorded population`)
  }
  const canPair = baselineVectors !== undefined && baselineDuplicates.length === 0 && currentDuplicates.length === 0
  const paired = !canPair ? undefined : pairedDecisionDiff(
    axisVectors(baselineVectors, 'headline'), axisVectors(currentVectors, 'headline'),
  )
  const pairing = {
    n: paired?.n ?? 0,
    discordant: paired === undefined ? 0 : paired.aOnly + paired.bOnly,
    baselineOnly: paired?.aUnpaired ?? 0,
    currentOnly: paired?.bUnpaired ?? 0,
    renderedExcluded,
  }
  // Collect empty-population evidence even when another integrity check already failed.
  if (baselineVectors?.length === 0) {
    add('no-decision-vector', `baseline: zero decision vectors (current has ${currentVectors.length})`)
  }
  if (currentVectors.length === 0) {
    add('no-decision-vector',
      `current: zero decision vectors to pair (rendered excluded: ${renderedExcluded}; baseline has ${baselineVectors?.length ?? 0})`,
    )
  }
  if (baselineVectors !== undefined && baselineVectors.length > 0 && currentVectors.length > 0 && paired?.n === 0) {
    add('no-decision-vector',
      'no paired keys: ' + `baseline ${baselineVectors.length}, current ${currentVectors.length}, shared 0`,
    )
  }
  const seed: GateVerdict['seed'] = {
    ...(current.report.seedHonored === undefined ? {} : { current: current.report.seedHonored }),
    ...(floor === undefined ? {} : { floor: floor.seedHonored }),
    regime: floor === undefined || current.report.seedHonored === undefined ? 'unknown' :
      floor.seedHonored === current.report.seedHonored ? 'match' : 'mismatch',
  }
  // Check applicability before treating an absent optional floor as skippable.
  if (canPair && floor !== undefined) {
    for (const axis of FLOOR_AXES) {
      const diff = axis === 'headline' ? paired! : pairedDecisionDiff(
        axisVectors(baselineVectors, axis), axisVectors(currentVectors, axis),
      )
      if (diff.n > 0 && floor.axes[axis].aggregateFloor === undefined) {
        add('missing-floor', `${axis}: ${diff.n} paired applicable decisions but no aggregate floor; ${measureFloor}`)
      }
    }
  }
  const inconclusive = GATE_INCONCLUSIVE_REASONS.flatMap(reason => {
    const messages = details[reason]
    return messages === undefined ? [] : [{ reason, detail: messages.join('; ') }]
  })
  const regressions: GateRegression[] = []
  const skippedAxes: { axis: FloorAxis; reason: string }[] = []
  if (inconclusive.length === 0 && floor !== undefined && baselineVectors !== undefined) {
    for (const axis of FLOOR_AXES) {
      const diff = axis === 'headline' ? paired! : pairedDecisionDiff(
        axisVectors(baselineVectors, axis), axisVectors(currentVectors, axis),
      )
      if (diff.n === 0) {
        skippedAxes.push({ axis, reason: 'no paired decisions' })
        continue
      }
      const axisFloor = floor.axes[axis].aggregateFloor!
      const baselineRate = (diff.both + diff.aOnly) / diff.n
      const currentRate = (diff.both + diff.bOnly) / diff.n
      // The stats DTO deltaAcc runs the other way. Use counts to avoid cancellation
      // rounding a change exactly at the floor into a strictly-beyond regression.
      const delta = (diff.bOnly - diff.aOnly) / diff.n
      if (delta < -axisFloor) {
        regressions.push({ axis, baseline: baselineRate, current: currentRate, delta, floor: axisFloor, n: diff.n })
      }
    }
  }
  return {
    exit: inconclusive.length > 0 ? 2 : regressions.length > 0 ? 1 : 0,
    labelMetrics: compareLabelMetrics(input),
    inconclusive,
    regressions,
    skippedAxes,
    refusals,
    pairing,
    seed,
    population: {
      proof: current.report.briefSourceCounts?.proof ?? 0,
      empty: current.report.briefSourceCounts?.empty ?? 0,
      rendered: current.report.briefSourceCounts?.rendered ?? 0,
    },
  }
}

export function renderGateLines(verdict: GateVerdict): string[] {
  const messages = ['no regression beyond the floor', 'regression beyond the floor', 'inconclusive']
  const { pairing, seed, population } = verdict
  return [
    `release-gate: exit ${verdict.exit} — ${messages[verdict.exit]}`,
    ...verdict.inconclusive.map(entry => `inconclusive: ${entry.reason}: ${entry.detail}`),
    ...verdict.regressions.map(entry =>
      `regression: ${entry.axis} baseline=${entry.baseline} current=${entry.current} ` +
      `delta=${entry.delta} floor=${entry.floor} n=${entry.n}`,
    ),
    ...verdict.skippedAxes.map(entry => `skipped: ${entry.axis}: ${entry.reason}`),
    `refusals: baseline ${canonicalJson(verdict.refusals.baseline)}`,
    `refusals: current ${canonicalJson(verdict.refusals.current)}`,
    `pairing: n=${pairing.n} discordant=${pairing.discordant} baselineOnly=${pairing.baselineOnly} ` +
      `currentOnly=${pairing.currentOnly} renderedExcluded=${pairing.renderedExcluded}`,
    `seed: current=${seed.current ?? 'absent'} floor=${seed.floor ?? 'absent'} regime=${seed.regime}`,
    `population: proof=${population.proof} empty=${population.empty} rendered=${population.rendered}`,
    ...verdict.labelMetrics.rows.map(row => `label-metric: ${row.metric} ${canonicalJson(row)}`),
    `label-calibration: ${canonicalJson(verdict.labelMetrics.calibration)}`,
  ]
}
