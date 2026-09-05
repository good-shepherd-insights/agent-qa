import { assertBaselineComparator, renderBaselineComparatorRefusal } from '../baseline/comparator'
import { composeBaselineProfileKey } from '../baseline/profile-key'
import type { BaselinePointerLoad } from '../baseline/profile-key'
import { canonicalJson } from '../canonical-json'
import type { DecisionVectorsDocument } from '../match/decision-vectors'
import type { EvalBatchReport } from '../match/metrics'
import { REPLAY_REFUSAL_REASONS } from '../replay/result'
import { axisVectors } from '../stats/decision-vector'
import type { DecisionCorrectnessVector, FloorAxis } from '../stats/decision-vector'
import { pairedDecisionDiff } from '../stats/paired'
import type { NoiseFloorArtefact } from './floor-artefact'

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

function refusalCounts(report: EvalBatchReport | undefined): Record<string, number> {
  if (report === undefined) return {}
  return Object.fromEntries(
    REPLAY_REFUSAL_REASONS.map(reason => [reason, report.honesty.refusalCounts[reason] ?? 0]),
  )
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

  const baselineErrors = baseline?.report.honesty.harnessErrorCount
  const currentErrors = current.report.honesty.harnessErrorCount
  if ((baselineErrors ?? 0) > 0 || currentErrors > 0) {
    add('harness-errors', `baseline=${baselineErrors ?? 'absent'} current=${currentErrors}`)
  }
  const baselineNeverScored = baseline?.report.honesty.neverScoredCounts
  const currentNeverScored = current.report.honesty.neverScoredCounts
  if (Object.values(baselineNeverScored ?? {}).some(count => count !== 0) ||
      Object.values(currentNeverScored).some(count => count !== 0)) {
    add('never-scored',
      `baseline=${baselineNeverScored === undefined ? 'absent' : canonicalJson(baselineNeverScored)} ` +
      `current=${canonicalJson(currentNeverScored)}`,
    )
  }
  const refusals = { baseline: refusalCounts(baseline?.report), current: refusalCounts(current.report) }
  if (baseline !== undefined) {
    for (const reason of REPLAY_REFUSAL_REASONS) {
      const b = baseline.report.honesty.refusalCounts[reason] ?? 0
      const c = current.report.honesty.refusalCounts[reason] ?? 0
      if (b !== c) add('refusal-population-differs', `${reason}: baseline=${b} current=${c}`)
    }
  }

  const baselineDocument = baseline?.vectors
  if (baselineDocument === undefined) {
    add('no-decision-vector',
      `baseline: decisions.json absent; eval report --commit on baseline batch ` +
      `${baseline?.report.batchKey ?? pointer?.batchKey ?? 'absent'} commits decisions.json`,
    )
  } else {
    mismatch('batchKey', 'baseline vectors', baselineDocument.batchKey, 'baseline report', baseline!.report.batchKey)
    mismatch('matcherVersion', 'baseline vectors', baselineDocument.matcherVersion, 'baseline report', baseline!.report.matcherVersion)
  }

  const baselineVectors = baselineDocument?.vectors.filter(vector => vector.briefSource !== 'rendered')
  const currentVectors = current.vectors.filter(vector => vector.briefSource !== 'rendered')
  const renderedExcluded = current.vectors.length - currentVectors.length
  const paired = baselineVectors === undefined ? undefined : pairedDecisionDiff(
    axisVectors(baselineVectors, 'headline'), axisVectors(currentVectors, 'headline'),
  )
  const pairing = {
    n: paired?.n ?? 0,
    discordant: paired === undefined ? 0 : paired.aOnly + paired.bOnly,
    baselineOnly: paired?.aUnpaired ?? 0,
    currentOnly: paired?.bUnpaired ?? 0,
    renderedExcluded,
  }
  const seed: GateVerdict['seed'] = {
    ...(current.report.seedHonored === undefined ? {} : { current: current.report.seedHonored }),
    ...(floor === undefined ? {} : { floor: floor.seedHonored }),
    regime: floor === undefined || current.report.seedHonored === undefined ? 'unknown' :
      floor.seedHonored === current.report.seedHonored ? 'match' : 'mismatch',
  }
  const inconclusive = GATE_INCONCLUSIVE_REASONS.flatMap(reason => {
    const messages = details[reason]
    return messages === undefined ? [] : [{ reason, detail: messages.join('; ') }]
  })
  return {
    exit: inconclusive.length > 0 ? 2 : 0,
    inconclusive,
    regressions: [],
    skippedAxes: [],
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
