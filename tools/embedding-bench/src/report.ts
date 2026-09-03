import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseBenchmarkConfig,
  parseCandidates,
  selectCandidates,
  type BenchmarkConfig,
} from './config.ts'
import type {
  CandidateConstantsResult,
  CandidateConstantsSuccess,
} from './measure-constants'
import { validateCandidateBenchResult } from './measure-bench.ts'
import {
  assertAuthoredQueries,
  assertBenchCorpus,
  assertBenchRelationships,
  candidateProfile,
  type AuthoredQueries,
  type BenchCandidate,
  type BenchCorpus,
  type BenchRunResult,
  type CandidateBenchSuccess,
  type HitRates,
} from './runner.ts'
import type { BenchmarkRuntime } from './transformers-js-backend'

const COMPARISON_TOLERANCE = 1e-12
const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT

export interface CorpusManifest {
  builderVersion: string
  totals: {
    documents: number
    recordedQueries: number
    sourceCassettes: number
  }
  perApp: Record<string, { documents: number; recordedQueries: number }>
  sources: Array<{
    path: string
    sha256: string
    apps: string[]
    granularity: 'leaf' | 'procedure'
    kind: 'canonical' | 'extracted' | 'fixture'
  }>
}

export interface InputReference {
  path: string
  sha256: string
}

export interface ReportReferences {
  config: InputReference
  candidates: InputReference
  corpus: InputReference
  corpusManifest: InputReference
  authoredQueries: InputReference
}

export interface BenchmarkExecutionPolicy {
  network: 'downloads-allowed' | 'offline-cache-only'
  performance: 'measured' | 'skipped'
}

export interface TauProposal {
  candidateId: string
  percentile: number | null
  tauDense: number | null
  goldPairs: number
}

export interface MechanicalVerdict {
  status: 'selected' | 'indeterminate'
  baselineCandidateId: string
  bestRecordedHitAt5CandidateId: string | null
  selectedDefaultCandidateId: string | null
  qualifyingAlternateIds: string[]
  baselineRecorded: { hitAt1: number; hitAt5: number } | null
  selectedRecorded: { hitAt1: number; hitAt5: number } | null
  floor: {
    candidateId: string | null
    acceptableBeyondEmergencyMode: boolean | null
    recordedHitAt5: number | null
    trailingGap: number | null
  }
  rationale: string
  costConsequences: string
  deploymentConsequences: string
}

export interface RawBenchReport {
  schemaVersion: 2
  generatedAt: string
  platform: string
  arch: string
  runtime: BenchmarkRuntime
  execution: BenchmarkExecutionPolicy
  config: BenchmarkConfig
  inputs: ReportReferences
  corpusManifest: CorpusManifest
  authoredQueries: {
    provenance: Record<string, string>
    count: number
    perApp: Record<string, number>
  }
  candidatePins: readonly BenchCandidate[]
  benchmark: BenchRunResult
  constants: readonly CandidateConstantsResult[]
  calibration: {
    percentile: 0.05
    rounding: 'down-to-2-decimals'
    proposals: TauProposal[]
  }
  decisionRule: readonly string[]
  verdict: MechanicalVerdict
}

export interface EmitReportOptions {
  outputPath?: string
  platform?: string
  arch?: string
  generatedAt?: string
  config: BenchmarkConfig
  runtime: BenchmarkRuntime
  execution: BenchmarkExecutionPolicy
  candidates: readonly BenchCandidate[]
  corpus: BenchCorpus
  bench: BenchRunResult
  constants: readonly CandidateConstantsResult[]
  corpusManifest: CorpusManifest
  authored: AuthoredQueries
  references: ReportReferences
}

export interface MergeReportInput {
  path: string
  sha256: string
  report: RawBenchReport
}

export interface MergeReportOptions {
  outputPath?: string
  generatedAt?: string
  inputs: readonly MergeReportInput[]
}

interface DistributionSummary {
  count: number
  min: number | null
  p05: number | null
  median: number | null
  p95: number | null
  max: number | null
}

interface RuntimeRenderInput {
  label: string
  runtime: BenchmarkRuntime
  execution: BenchmarkExecutionPolicy
}

interface MarkdownRenderOptions {
  generatedAt?: string
  platformSummary?: string
  runtimeInputs?: readonly RuntimeRenderInput[]
  preCorpusLines?: readonly string[]
  constantsLines?: readonly string[]
  constantsNote?: string
  qualitySourceLabel?: string
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const position = (sorted.length - 1) * fraction
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const lower = sorted[lowerIndex]!
  const upper = sorted[upperIndex]!
  return lower + (upper - lower) * (position - lowerIndex)
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6))
}

function roundDownToTwoDecimals(value: number): number {
  return Math.floor(value * 100 + COMPARISON_TOLERANCE) / 100
}

function summarizeDistribution(values: readonly number[]): DistributionSummary {
  if (values.length === 0) {
    return { count: 0, min: null, p05: null, median: null, p95: null, max: null }
  }
  return {
    count: values.length,
    min: roundMetric(Math.min(...values)),
    p05: roundMetric(percentile(values, 0.05)!),
    median: roundMetric(percentile(values, 0.5)!),
    p95: roundMetric(percentile(values, 0.95)!),
    max: roundMetric(Math.max(...values)),
  }
}

function successfulCandidates(bench: BenchRunResult): CandidateBenchSuccess[] {
  return bench.candidates.filter(
    (candidate): candidate is CandidateBenchSuccess => candidate.status === 'ok',
  )
}

function compareRecorded(
  left: CandidateBenchSuccess,
  right: CandidateBenchSuccess,
  baselineCandidateId: string,
): number {
  const hitAt5 = right.slices.recorded.macro.hitAt5 - left.slices.recorded.macro.hitAt5
  if (Math.abs(hitAt5) > COMPARISON_TOLERANCE) return hitAt5
  const hitAt1 = right.slices.recorded.macro.hitAt1 - left.slices.recorded.macro.hitAt1
  if (Math.abs(hitAt1) > COMPARISON_TOLERANCE) return hitAt1
  if (left.candidateId === baselineCandidateId) return -1
  if (right.candidateId === baselineCandidateId) return 1
  return left.candidateId.localeCompare(right.candidateId)
}

function points(value: number): string {
  return `${(value * 100).toFixed(2)} absolute points`
}

/** Render the exact mechanical policy represented by a benchmark configuration. */
export function decisionRuleForConfig(config: BenchmarkConfig): readonly string[] {
  const hitAt1Rule = config.selection.requireRecordedHitAt1NonRegression
    ? ' and its recorded-slice hit@1 does not regress'
    : '; recorded-slice hit@1 is reported but is not a selection gate'
  const floorRule =
    config.floorCandidateId === null
      ? 'No floor candidate is configured, so floor acceptability is not evaluated.'
      : `${config.floorCandidateId} is acceptable beyond emergency mode only when its recorded-slice hit@5 trails the selected default by no more than ${points(config.selection.maximumFloorHitAt5Gap)}.`
  return [
    `An alternate displaces ${config.baselineCandidateId} only when it gains at least ${points(config.selection.minimumRecordedHitAt5Gain)} on recorded-slice hit@5${hitAt1Rule}. Among qualifying alternates, recorded hit@5, then hit@1, then candidate id determine the winner.`,
    floorRule,
    'The proposed τ_dense for each completed candidate is the 5th percentile of recorded gold-pair cosine similarities, rounded down to two decimals. Gold and deterministic random-pair distributions remain in the raw report for audit.',
    'A selected benchmark default is not deployed automatically. Adoption must preserve the candidate pin, pooling, prefixes, normalization, dtype, dimension, and token cap in the production profile and backend.',
  ]
}

function compactRatio(value: number): string {
  return value.toFixed(2).replace(/\.00$/u, '').replace(/(\.\d)0$/u, '$1')
}

function dimensionCostConsequences(
  candidates: readonly BenchCandidate[],
  baselineCandidateId: string,
): string {
  const baseline = candidates.find(({ id }) => id === baselineCandidateId)
  if (baseline === undefined) {
    return `Dimension and vector-storage consequences are unavailable because the configured baseline pin ${baselineCandidateId} was not included in this run.`
  }
  const baselineBytes = baseline.dim * FLOAT32_BYTES
  const comparisons = candidates
    .filter(({ id }) => id !== baseline.id)
    .map((candidate) => {
      const bytes = candidate.dim * FLOAT32_BYTES
      return `${candidate.id}: ${candidate.dim} dimensions and ${bytes} bytes/document (${compactRatio(candidate.dim / baseline.dim)}× baseline)`
    })
  if (comparisons.length === 0) {
    return `${baseline.id} stores ${baseline.dim} dimensions, or ${baselineBytes} bytes per float32 document vector; no alternate was included for comparison.`
  }
  return `Relative to ${baseline.id} (${baseline.dim} dimensions; ${baselineBytes} bytes per float32 document vector), ${comparisons.join('; ')}.`
}

function deploymentConsequences(candidate: BenchCandidate | undefined): string {
  if (candidate === undefined) {
    return 'No deployment recommendation is available from this run. Resolve incomplete evidence and rerun with the configured baseline before changing production.'
  }
  const prefixSummary =
    candidate.query_prefix.length === 0 && candidate.doc_prefix.length === 0
      ? 'no query/document prefixes'
      : `query prefix ${JSON.stringify(candidate.query_prefix)} and document prefix ${JSON.stringify(candidate.doc_prefix)}`
  const tokenBudget =
    candidate.max_tokens === null
      ? 'the backend/model default token budget'
      : `the ${candidate.max_tokens}-token cap`
  return `Adopting ${candidate.id} requires production to preserve revision ${candidate.revision}, ${candidate.pooling} pooling, ${candidate.dtype} dtype, ${candidate.dim} dimensions, L2 normalization, ${prefixSummary}, and ${tokenBudget}. The benchmark does not make that production change; CLS candidates require compatible production profile/backend support before rollout.`
}

export function applyDecisionRule(
  candidates: readonly BenchCandidate[],
  bench: BenchRunResult,
  config: BenchmarkConfig,
): MechanicalVerdict {
  const candidateIds = new Set(candidates.map(({ id }) => id))
  const successes = successfulCandidates(bench).filter(({ candidateId }) =>
    candidateIds.has(candidateId),
  )
  const resultById = new Map(successes.map((result) => [result.candidateId, result]))
  const compare = (left: CandidateBenchSuccess, right: CandidateBenchSuccess): number =>
    compareRecorded(left, right, config.baselineCandidateId)
  const rawLeader = [...successes].sort(compare)[0]
  const baseline = resultById.get(config.baselineCandidateId)
  const floor =
    config.floorCandidateId === null
      ? undefined
      : resultById.get(config.floorCandidateId)
  const costConsequences = dimensionCostConsequences(
    candidates,
    config.baselineCandidateId,
  )
  const failedCandidateIds = candidates
    .filter((candidate) => {
      const result = bench.candidates.find(({ candidateId }) => candidateId === candidate.id)
      return result === undefined || result.status === 'error'
    })
    .map(({ id }) => id)

  if (failedCandidateIds.length > 0) {
    return {
      status: 'indeterminate',
      baselineCandidateId: config.baselineCandidateId,
      bestRecordedHitAt5CandidateId: rawLeader?.candidateId ?? null,
      selectedDefaultCandidateId: null,
      qualifyingAlternateIds: [],
      baselineRecorded:
        baseline === undefined
          ? null
          : {
              hitAt1: baseline.slices.recorded.macro.hitAt1,
              hitAt5: baseline.slices.recorded.macro.hitAt5,
            },
      selectedRecorded: null,
      floor: {
        candidateId: config.floorCandidateId,
        acceptableBeyondEmergencyMode: null,
        recordedHitAt5: floor?.slices.recorded.macro.hitAt5 ?? null,
        trailingGap: null,
      },
      rationale: `The run is incomplete because these selected candidates did not produce successful evidence: ${failedCandidateIds.join(', ')}. No default can be selected until they complete.`,
      costConsequences,
      deploymentConsequences: deploymentConsequences(undefined),
    }
  }

  if (baseline === undefined) {
    return {
      status: 'indeterminate',
      baselineCandidateId: config.baselineCandidateId,
      bestRecordedHitAt5CandidateId: rawLeader?.candidateId ?? null,
      selectedDefaultCandidateId: null,
      qualifyingAlternateIds: [],
      baselineRecorded: null,
      selectedRecorded: null,
      floor: {
        candidateId: config.floorCandidateId,
        acceptableBeyondEmergencyMode: null,
        recordedHitAt5: floor?.slices.recorded.macro.hitAt5 ?? null,
        trailingGap: null,
      },
      rationale: `The configured baseline ${config.baselineCandidateId} did not complete or was not included, so the displacement policy cannot select a default.`,
      costConsequences,
      deploymentConsequences: deploymentConsequences(undefined),
    }
  }

  const baselineHitAt1 = baseline.slices.recorded.macro.hitAt1
  const baselineHitAt5 = baseline.slices.recorded.macro.hitAt5
  const qualifying = candidates
    .filter(
      ({ id, backend }) =>
        backend === 'node' && id !== config.baselineCandidateId,
    )
    .map(({ id }) => resultById.get(id))
    .filter((candidate): candidate is CandidateBenchSuccess => candidate !== undefined)
    .filter((candidate) => {
      const metrics = candidate.slices.recorded.macro
      const hitAt5Qualifies =
        metrics.hitAt5 - baselineHitAt5 + COMPARISON_TOLERANCE >=
        config.selection.minimumRecordedHitAt5Gain
      const hitAt1Qualifies =
        !config.selection.requireRecordedHitAt1NonRegression ||
        metrics.hitAt1 + COMPARISON_TOLERANCE >= baselineHitAt1
      return hitAt5Qualifies && hitAt1Qualifies
    })
    .sort(compare)
  const selected = qualifying[0] ?? baseline
  const selectedHitAt1 = selected.slices.recorded.macro.hitAt1
  const selectedHitAt5 = selected.slices.recorded.macro.hitAt5
  const floorHitAt5 = floor?.slices.recorded.macro.hitAt5 ?? null
  const trailingGap =
    floorHitAt5 === null ? null : Math.max(0, selectedHitAt5 - floorHitAt5)
  const floorAcceptable =
    trailingGap === null
      ? null
      : trailingGap <=
        config.selection.maximumFloorHitAt5Gap + COMPARISON_TOLERANCE
  const hitAt1Description = config.selection.requireRecordedHitAt1NonRegression
    ? ' and did not regress recorded hit@1'
    : ''
  const rationale =
    selected.candidateId === config.baselineCandidateId
      ? `No alternate cleared the configured ${points(config.selection.minimumRecordedHitAt5Gain)} recorded hit@5 gain${config.selection.requireRecordedHitAt1NonRegression ? ' plus the hit@1 non-regression gate' : ''}; ${config.baselineCandidateId} remains the default.`
      : `${selected.candidateId} cleared the configured ${points(config.selection.minimumRecordedHitAt5Gain)} recorded hit@5 gain${hitAt1Description} and is the highest-ranked qualifying alternate, so it displaces ${config.baselineCandidateId}.`

  return {
    status: 'selected',
    baselineCandidateId: config.baselineCandidateId,
    bestRecordedHitAt5CandidateId: rawLeader?.candidateId ?? null,
    selectedDefaultCandidateId: selected.candidateId,
    qualifyingAlternateIds: qualifying.map(({ candidateId }) => candidateId),
    baselineRecorded: { hitAt1: baselineHitAt1, hitAt5: baselineHitAt5 },
    selectedRecorded: { hitAt1: selectedHitAt1, hitAt5: selectedHitAt5 },
    floor: {
      candidateId: config.floorCandidateId,
      acceptableBeyondEmergencyMode: floorAcceptable,
      recordedHitAt5: floorHitAt5,
      trailingGap,
    },
    rationale,
    costConsequences,
    deploymentConsequences: deploymentConsequences(
      candidates.find(({ id }) => id === selected.candidateId),
    ),
  }
}

function applyPerformanceCompleteness(
  verdict: MechanicalVerdict,
  candidates: readonly BenchCandidate[],
  constants: readonly CandidateConstantsResult[],
  execution: BenchmarkExecutionPolicy,
): MechanicalVerdict {
  if (execution.performance === 'skipped' || verdict.status === 'indeterminate') {
    return verdict
  }
  const incompleteIds = candidates
    .filter((candidate) => {
      const matches = constants.filter(
        ({ candidateId }) => candidateId === candidate.id,
      )
      return matches.length !== 1 || matches[0]!.status === 'error'
    })
    .map(({ id }) => id)
  if (incompleteIds.length === 0) return verdict

  return {
    ...verdict,
    status: 'indeterminate',
    selectedDefaultCandidateId: null,
    qualifyingAlternateIds: [],
    selectedRecorded: null,
    floor: {
      ...verdict.floor,
      acceptableBeyondEmergencyMode: null,
      trailingGap: null,
    },
    rationale: `The run is incomplete because these selected candidates did not produce exactly one successful performance result: ${incompleteIds.join(', ')}. No default can be selected until they complete.`,
    deploymentConsequences: deploymentConsequences(undefined),
  }
}

function tauProposals(bench: BenchRunResult): TauProposal[] {
  return successfulCandidates(bench).map((candidate) => {
    const values = candidate.distributions.recorded.goldPairCosines
    const fifthPercentile = percentile(values, 0.05)
    return {
      candidateId: candidate.candidateId,
      percentile: fifthPercentile === null ? null : roundMetric(fifthPercentile),
      tauDense:
        fifthPercentile === null ? null : roundDownToTwoDecimals(fifthPercentile),
      goldPairs: values.length,
    }
  })
}

function markdownCell(value: unknown): string {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function rate(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

function decimal(value: number | null): string {
  return value === null ? '—' : value.toFixed(6)
}

function mebibytes(value: number): string {
  return (value / (1024 * 1024)).toFixed(2)
}

function gibibytes(value: number): string {
  return (value / (1024 * 1024 * 1024)).toFixed(2)
}

function renderHitTable(
  slice: 'recorded' | 'authored',
  bench: BenchRunResult,
): string[] {
  const lines = [
    '| Candidate | Scope | Queries | hit@1 | hit@3 | hit@5 |',
    '|---|---|---:|---:|---:|---:|',
  ]
  for (const candidate of bench.candidates) {
    if (candidate.status === 'error') {
      lines.push(
        `| ${markdownCell(candidate.candidateId)} | ERROR: ${markdownCell(candidate.error.message)} | — | — | — | — |`,
      )
      continue
    }
    const metrics = candidate.slices[slice]
    for (const app of Object.keys(metrics.perApp).sort()) {
      lines.push(renderHitRow(candidate.candidateId, app, metrics.perApp[app]!))
    }
    lines.push(renderHitRow(candidate.candidateId, '**macro**', metrics.macro))
  }
  return lines
}

function renderHitRow(candidateId: string, scope: string, metrics: HitRates): string {
  return `| ${markdownCell(candidateId)} | ${scope} | ${metrics.queries} | ${rate(metrics.hitAt1)} | ${rate(metrics.hitAt3)} | ${rate(metrics.hitAt5)} |`
}

function renderConstantsTable(constants: readonly CandidateConstantsResult[]): string[] {
  if (constants.length === 0) {
    return [
      'Performance measurements were skipped. Re-run without `--accuracy-only` to collect them.',
    ]
  }
  const lines = [
    '### Effective Performance Samples',
    '',
    '| Candidate | Single documents | Concurrent documents | Concurrency | Top-k documents | k | Iterations |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...constants.map((result) =>
      result.status === 'error'
        ? `| ${markdownCell(result.candidateId)} | — | — | — | — | — | — |`
        : `| ${markdownCell(result.candidateId)} | ${result.sample.singleDocuments} | ${result.sample.concurrentDocuments} | ${result.sample.concurrency} | ${result.sample.topKDocuments} | ${result.sample.topK} | ${result.sample.topKIterations} |`,
    ),
    '',
    '### Performance Metrics',
    '',
    '| Candidate | OS/arch | Time-to-first embedding ms | Single docs/s | Single p50 ms | Single p95 ms | Concurrent docs/s | RSS baseline MiB | RSS peak MiB | RSS delta MiB | Vector bytes/doc | Brute top-k ms | vec0 top-k ms |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ]
  for (const result of constants) {
    if (result.status === 'error') {
      lines.push(
        `| ${markdownCell(result.candidateId)} | ${result.platform}/${result.arch} | ERROR: ${markdownCell(result.error.message)} | ${Array.from({ length: 10 }, () => '—').join(' | ')} |`,
      )
      continue
    }
    lines.push(renderConstantsRow(result))
  }
  return lines
}

function renderConstantsRow(result: CandidateConstantsSuccess): string {
  return `| ${markdownCell(result.candidateId)} | ${result.platform}/${result.arch} | ${result.timeToFirstEmbeddingMs.toFixed(3)} | ${result.singleDocumentDocsPerSecond.toFixed(3)} | ${result.singleDocumentLatencyMs.p50.toFixed(3)} | ${result.singleDocumentLatencyMs.p95.toFixed(3)} | ${result.concurrentDocsPerSecond.toFixed(3)} | ${mebibytes(result.rssBaselineBytes)} | ${mebibytes(result.rssPeakBytes)} | ${mebibytes(result.rssDeltaBytes)} | ${result.vectorBytesPerDocument} | ${result.bruteTopKMs.toFixed(6)} | ${result.vec0TopKMs === null ? 'unavailable' : result.vec0TopKMs.toFixed(6)} |`
}

type ConstantMetricName =
  | 'sampleSingleDocuments'
  | 'sampleConcurrentDocuments'
  | 'sampleConcurrency'
  | 'sampleTopKDocuments'
  | 'sampleTopK'
  | 'sampleTopKIterations'
  | 'timeToFirstEmbeddingMs'
  | 'singleDocumentDocsPerSecond'
  | 'singleDocumentLatencyP50Ms'
  | 'singleDocumentLatencyP95Ms'
  | 'concurrentDocsPerSecond'
  | 'rssBaselineMib'
  | 'rssPeakMib'
  | 'rssDeltaMib'
  | 'vectorBytesPerDocument'
  | 'bruteTopKMs'
  | 'vec0TopKMs'

function constantValue(
  result: CandidateConstantsSuccess,
  metricName: ConstantMetricName,
): string {
  switch (metricName) {
    case 'sampleSingleDocuments':
      return String(result.sample.singleDocuments)
    case 'sampleConcurrentDocuments':
      return String(result.sample.concurrentDocuments)
    case 'sampleConcurrency':
      return String(result.sample.concurrency)
    case 'sampleTopKDocuments':
      return String(result.sample.topKDocuments)
    case 'sampleTopK':
      return String(result.sample.topK)
    case 'sampleTopKIterations':
      return String(result.sample.topKIterations)
    case 'timeToFirstEmbeddingMs':
      return result.timeToFirstEmbeddingMs.toFixed(3)
    case 'singleDocumentDocsPerSecond':
      return result.singleDocumentDocsPerSecond.toFixed(3)
    case 'singleDocumentLatencyP50Ms':
      return result.singleDocumentLatencyMs.p50.toFixed(3)
    case 'singleDocumentLatencyP95Ms':
      return result.singleDocumentLatencyMs.p95.toFixed(3)
    case 'concurrentDocsPerSecond':
      return result.concurrentDocsPerSecond.toFixed(3)
    case 'rssBaselineMib':
      return mebibytes(result.rssBaselineBytes)
    case 'rssPeakMib':
      return mebibytes(result.rssPeakBytes)
    case 'rssDeltaMib':
      return mebibytes(result.rssDeltaBytes)
    case 'vectorBytesPerDocument':
      return String(result.vectorBytesPerDocument)
    case 'bruteTopKMs':
      return result.bruteTopKMs.toFixed(6)
    case 'vec0TopKMs':
      return result.vec0TopKMs === null
        ? 'unavailable'
        : result.vec0TopKMs.toFixed(6)
  }
}

function successfulConstant(
  input: MergeReportInput,
  candidateId: string,
): CandidateConstantsSuccess {
  const matches = input.report.constants.filter(
    (constant) => constant.candidateId === candidateId,
  )
  if (matches.length !== 1) {
    throw new Error(
      `${input.path} must contain exactly one constants result for ${candidateId}`,
    )
  }
  const result = matches[0]!
  if (result.status === 'error') {
    throw new Error(
      `${input.path} constants failed for ${candidateId}: ${result.error.message}`,
    )
  }
  return result
}

function renderMergedConstantsTable(
  candidates: readonly BenchCandidate[],
  inputs: readonly MergeReportInput[],
): string[] {
  const labels = inputs.map(({ report }) => `${report.platform}/${report.arch}`)
  const lines = [
    `| Candidate | Metric | ${labels.join(' | ')} |`,
    `|---|---|${labels.map(() => '---:').join('|')}|`,
  ]
  const metrics: ReadonlyArray<readonly [ConstantMetricName, string]> = [
    ['sampleSingleDocuments', 'Sample: single documents'],
    ['sampleConcurrentDocuments', 'Sample: concurrent documents'],
    ['sampleConcurrency', 'Sample: concurrency'],
    ['sampleTopKDocuments', 'Sample: top-k documents'],
    ['sampleTopK', 'Sample: k'],
    ['sampleTopKIterations', 'Sample: top-k iterations'],
    ['timeToFirstEmbeddingMs', 'Time-to-first embedding ms'],
    ['singleDocumentDocsPerSecond', 'Single docs/s'],
    ['singleDocumentLatencyP50Ms', 'Single p50 ms'],
    ['singleDocumentLatencyP95Ms', 'Single p95 ms'],
    ['concurrentDocsPerSecond', 'Concurrent docs/s'],
    ['rssBaselineMib', 'RSS baseline MiB'],
    ['rssPeakMib', 'RSS peak MiB'],
    ['rssDeltaMib', 'RSS delta MiB'],
    ['vectorBytesPerDocument', 'Vector bytes/doc'],
    ['bruteTopKMs', 'Brute top-k ms'],
    ['vec0TopKMs', 'vec0 top-k ms'],
  ]

  for (const candidate of candidates) {
    const results = inputs.map((input) => successfulConstant(input, candidate.id))
    for (const [metricName, label] of metrics) {
      lines.push(
        `| ${markdownCell(candidate.id)} | ${label} | ${results
          .map((result) => constantValue(result, metricName))
          .join(' | ')} |`,
      )
    }
  }
  return lines
}

function renderDistributionTable(
  slice: 'recorded' | 'authored',
  bench: BenchRunResult,
): string[] {
  const lines = [
    '| Candidate | Pair set | n | min | p05 | median | p95 | max |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
  ]
  for (const candidate of successfulCandidates(bench)) {
    const distribution = candidate.distributions[slice]
    for (const [label, values] of [
      ['gold', distribution.goldPairCosines],
      ['random', distribution.randomPairCosines],
    ] as const) {
      const summary = summarizeDistribution(values)
      lines.push(
        `| ${markdownCell(candidate.candidateId)} | ${label} | ${summary.count} | ${decimal(summary.min)} | ${decimal(summary.p05)} | ${decimal(summary.median)} | ${decimal(summary.p95)} | ${decimal(summary.max)} |`,
      )
    }
  }
  return lines
}

function renderRuntimeTable(inputs: readonly RuntimeRenderInput[]): string[] {
  return [
    '| Environment | Engine | Transformers.js | Node | Network | Performance | Device / pipeline | CPU | Logical CPUs | Memory GiB | OS release |',
    '|---|---|---|---|---|---|---|---|---:|---:|---|',
    ...inputs.map(
      ({ label, runtime, execution }) =>
        `| ${markdownCell(label)} | ${markdownCell(runtime.engine)} | ${markdownCell(runtime.transformersJsVersion)} | ${markdownCell(runtime.nodeVersion)} | ${execution.network} | ${execution.performance} | ${runtime.device} / ${runtime.pipeline} | ${markdownCell(runtime.cpuModel)} | ${runtime.logicalCpuCount} | ${gibibytes(runtime.totalMemoryBytes)} | ${markdownCell(runtime.osRelease)} |`,
    ),
  ]
}

function renderMarkdown(
  report: RawBenchReport,
  options: MarkdownRenderOptions = {},
): string {
  const runtimeInputs =
    options.runtimeInputs ?? [
      {
        label: `${report.platform}/${report.arch}`,
        runtime: report.runtime,
        execution: report.execution,
      },
    ]
  const constantsLines = options.constantsLines ?? renderConstantsTable(report.constants)
  const constantsNote =
    options.constantsNote ??
    (report.constants.length === 0
      ? undefined
      : 'Each candidate was measured in its own child process. vec0 is reported only when the sqlite-vec prebuild loaded; brute-force top-k is always measured.')
  const lines: string[] = [
    '# Embedding Benchmark Report',
    '',
    `Generated: ${options.generatedAt ?? report.generatedAt}`,
    '',
    `Platform: ${options.platformSummary ?? `${report.platform}/${report.arch}`}`,
    '',
    '## Runtime',
    '',
    ...renderRuntimeTable(runtimeInputs),
    '',
    ...(options.preCorpusLines ?? []),
    '',
    '## Configuration and Policy',
    '',
    `Baseline candidate: **${markdownCell(report.config.baselineCandidateId)}**`,
    '',
    `Floor candidate: **${markdownCell(report.config.floorCandidateId ?? 'none')}**`,
    '',
    `Minimum recorded hit@5 gain: **${points(report.config.selection.minimumRecordedHitAt5Gain)}**; hit@1 non-regression required: **${String(report.config.selection.requireRecordedHitAt1NonRegression)}**; maximum floor hit@5 gap: **${points(report.config.selection.maximumFloorHitAt5Gap)}**.`,
    '',
    `Requested performance samples: ${report.config.performance.singleDocumentSamples} single-document; ${report.config.performance.concurrentDocumentSamples} concurrent at concurrency ${report.config.performance.concurrency}; top-k ${report.config.performance.topK} over ${report.config.performance.topKIterations} iterations. Effective per-candidate samples are reported with the measurements and may be clamped by corpus size.`,
    '',
    `Language mix: ${report.config.languageMix}`,
    '',
    '### Input Provenance',
    '',
    '| Input | Path | SHA-256 |',
    '|---|---|---|',
    ...Object.entries(report.inputs).map(
      ([name, reference]) =>
        `| ${name} | ${markdownCell(reference.path)} | \`${reference.sha256}\` |`,
    ),
    '',
    '### Candidate Pins',
    '',
    '| Candidate | Model | Revision | Backend | Pooling | Dim | Dtype | Max tokens |',
    '|---|---|---|---|---|---:|---|---:|',
    ...report.candidatePins.map(
      (candidate) =>
        `| ${markdownCell(candidate.id)} | ${markdownCell(candidate.model_id)} | \`${markdownCell(candidate.revision)}\` | ${candidate.backend} | ${candidate.pooling} | ${candidate.dim} | ${candidate.dtype} | ${candidate.max_tokens ?? 'model/default'} |`,
    ),
    '',
    '## Corpus Manifest Summary',
    '',
    `Builder: ${report.corpusManifest.builderVersion}`,
    '',
    `Documents: ${report.corpusManifest.totals.documents}; recorded queries: ${report.corpusManifest.totals.recordedQueries}; authored queries: ${report.authoredQueries.count}; source cassettes: ${report.corpusManifest.totals.sourceCassettes}.`,
    '',
    '| App | Documents | Recorded queries |',
    '|---|---:|---:|',
  ]
  for (const app of Object.keys(report.corpusManifest.perApp).sort()) {
    const totals = report.corpusManifest.perApp[app]!
    lines.push(`| ${markdownCell(app)} | ${totals.documents} | ${totals.recordedQueries} |`)
  }
  lines.push(
    '',
    '## Quality',
    '',
    ...(options.qualitySourceLabel === undefined
      ? []
      : [
          `Quality and calibration tables below use the deterministic reference report from ${options.qualitySourceLabel}; every source report remains linked above.`,
          '',
        ]),
    '### Recorded Slice hit@k',
    '',
    'This primary cassette-derived slice is reported independently and drives the mechanical verdict.',
    '',
    ...renderHitTable('recorded', report.benchmark),
    '',
    '### Authored Slice hit@k',
    '',
    `Provenance: ${Object.entries(report.authoredQueries.provenance)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ')}. This augmentation is never merged with the recorded slice.`,
    '',
    ...renderHitTable('authored', report.benchmark),
    '',
    '## Performance',
    '',
    ...constantsLines,
    ...(constantsNote === undefined ? [] : ['', constantsNote]),
    '',
    '## Calibration',
    '',
    '### Recorded Slice Cosine Distributions',
    '',
    ...renderDistributionTable('recorded', report.benchmark),
    '',
    '### Authored Slice Cosine Distributions',
    '',
    ...renderDistributionTable('authored', report.benchmark),
    '',
    '### Recorded Gold-Pair τ_dense Proposals',
    '',
    '| Candidate profile | Recorded gold pairs | p05 | Proposed τ_dense (round down, 2 decimals) |',
    '|---|---:|---:|---:|',
    ...report.calibration.proposals.map(
      (proposal) =>
        `| ${markdownCell(proposal.candidateId)} | ${proposal.goldPairs} | ${decimal(proposal.percentile)} | ${proposal.tauDense === null ? '—' : proposal.tauDense.toFixed(2)} |`,
    ),
    '',
    'The raw JSON retains every gold-pair and deterministic random-pair cosine for audit.',
    '',
    '## Decision Policy',
    '',
    ...report.decisionRule.map((rule, index) => `${index + 1}. ${rule}`),
    '',
    '## Mechanical Verdict',
    '',
    `Status: **${report.verdict.status}**`,
    '',
    `Selected default: **${report.verdict.selectedDefaultCandidateId ?? 'none'}**`,
    '',
    report.verdict.rationale,
    '',
    report.verdict.costConsequences,
    '',
    report.verdict.deploymentConsequences,
    '',
    `Floor candidate: **${report.verdict.floor.candidateId ?? 'none'}**; acceptable beyond emergency mode: **${report.verdict.floor.acceptableBeyondEmergencyMode === null ? 'indeterminate' : String(report.verdict.floor.acceptableBeyondEmergencyMode)}**; trailing recorded hit@5 gap: **${report.verdict.floor.trailingGap === null ? 'indeterminate' : `${(report.verdict.floor.trailingGap * 100).toFixed(2)} points`}**.`,
    '',
  )
  return `${lines.join('\n').trimEnd()}\n`
}

function assertNonnegativeInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a nonnegative safe integer`)
  }
}

function assertCorpusManifestMatches(
  corpus: BenchCorpus,
  manifest: CorpusManifest,
  authored: AuthoredQueries,
  bench?: BenchRunResult,
): void {
  assertBenchCorpus(corpus)
  assertAuthoredQueries(authored)
  assertBenchRelationships(corpus, authored)
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new TypeError('corpusManifest must be an object')
  }
  if (typeof manifest.builderVersion !== 'string' || manifest.builderVersion.length === 0) {
    throw new TypeError('corpusManifest.builderVersion must be a nonempty string')
  }
  if (manifest.totals === null || typeof manifest.totals !== 'object') {
    throw new TypeError('corpusManifest.totals must be an object')
  }
  assertNonnegativeInteger(manifest.totals.documents, 'corpusManifest.totals.documents')
  assertNonnegativeInteger(
    manifest.totals.recordedQueries,
    'corpusManifest.totals.recordedQueries',
  )
  assertNonnegativeInteger(
    manifest.totals.sourceCassettes,
    'corpusManifest.totals.sourceCassettes',
  )
  if (manifest.totals.documents !== corpus.documents.length) {
    throw new TypeError('corpus manifest document total does not match corpus')
  }
  if (manifest.totals.recordedQueries !== corpus.recordedQueries.length) {
    throw new TypeError('corpus manifest recorded-query total does not match corpus')
  }
  if (!Array.isArray(manifest.sources)) {
    throw new TypeError('corpusManifest.sources must be an array')
  }
  if (manifest.totals.sourceCassettes !== manifest.sources.length) {
    throw new TypeError('corpus manifest source-cassette total does not match sources')
  }
  const sourcesByPath = new Map<string, CorpusManifest['sources'][number]>()
  manifest.sources.forEach((source, index) => {
    if (source === null || typeof source !== 'object' || Array.isArray(source)) {
      throw new TypeError(`corpusManifest.sources[${index}] must be an object`)
    }
    if (typeof source.path !== 'string' || source.path.length === 0) {
      throw new TypeError(`corpusManifest.sources[${index}].path must be nonempty`)
    }
    if (!/^[a-f\d]{64}$/u.test(source.sha256)) {
      throw new TypeError(`corpusManifest.sources[${index}].sha256 must be SHA-256`)
    }
    if (
      !Array.isArray(source.apps) ||
      source.apps.length === 0 ||
      source.apps.some((app) => typeof app !== 'string' || app.length === 0) ||
      new Set(source.apps).size !== source.apps.length
    ) {
      throw new TypeError(
        `corpusManifest.sources[${index}].apps must be a nonempty unique string array`,
      )
    }
    if (source.granularity !== 'leaf' && source.granularity !== 'procedure') {
      throw new TypeError(
        `corpusManifest.sources[${index}].granularity must be leaf or procedure`,
      )
    }
    if (
      source.kind !== 'canonical' &&
      source.kind !== 'extracted' &&
      source.kind !== 'fixture'
    ) {
      throw new TypeError(
        `corpusManifest.sources[${index}].kind must be canonical, extracted, or fixture`,
      )
    }
    if (sourcesByPath.has(source.path)) {
      throw new TypeError(`corpus manifest source path is duplicated: ${source.path}`)
    }
    sourcesByPath.set(source.path, source)
  })

  const referencedSourcePaths = new Set<string>()
  const evidencedAppsBySource = new Map(
    manifest.sources.map((source) => [source.path, new Set<string>()]),
  )
  for (const document of corpus.documents) {
    const associatedApps = new Set<string>()
    for (const sourcePath of document.sourcePaths) {
      const source = sourcesByPath.get(sourcePath)
      if (source === undefined) {
        throw new TypeError(
          `corpus document ${document.id} references source missing from manifest: ${sourcePath}`,
        )
      }
      referencedSourcePaths.add(sourcePath)
      const commonApps = source.apps.filter((app) => document.apps.includes(app))
      if (commonApps.length === 0) {
        throw new TypeError(
          `corpus document ${document.id} has no app in common with source ${sourcePath}`,
        )
      }
      commonApps.forEach((app) => evidencedAppsBySource.get(sourcePath)!.add(app))
      source.apps.forEach((app) => associatedApps.add(app))
    }
    for (const app of document.apps) {
      if (!associatedApps.has(app)) {
        throw new TypeError(
          `corpus document ${document.id} app ${app} is not backed by its manifest sources`,
        )
      }
    }
  }
  for (const query of corpus.recordedQueries) {
    const source = sourcesByPath.get(query.sourcePath)
    if (source === undefined) {
      throw new TypeError(
        `recorded query ${query.id} references source missing from manifest: ${query.sourcePath}`,
      )
    }
    referencedSourcePaths.add(query.sourcePath)
    if (!source.apps.includes(query.app)) {
      throw new TypeError(
        `recorded query ${query.id} app ${query.app} does not match source ${query.sourcePath}`,
      )
    }
    evidencedAppsBySource.get(query.sourcePath)!.add(query.app)
  }
  for (const source of manifest.sources) {
    if (!referencedSourcePaths.has(source.path)) {
      throw new TypeError(`corpus manifest source is not referenced by corpus: ${source.path}`)
    }
    for (const app of source.apps) {
      if (!evidencedAppsBySource.get(source.path)!.has(app)) {
        throw new TypeError(
          `corpus manifest source ${source.path} app ${app} is not evidenced by the corpus`,
        )
      }
    }
  }

  const derived = new Map<string, { documents: number; recordedQueries: number }>()
  for (const document of corpus.documents) {
    for (const app of document.apps) {
      const totals = derived.get(app) ?? { documents: 0, recordedQueries: 0 }
      totals.documents += 1
      derived.set(app, totals)
    }
  }
  for (const query of corpus.recordedQueries) {
    const totals = derived.get(query.app) ?? { documents: 0, recordedQueries: 0 }
    totals.recordedQueries += 1
    derived.set(query.app, totals)
  }
  const derivedPerApp = Object.fromEntries([...derived.entries()].sort())
  const manifestPerApp = Object.fromEntries(
    Object.entries(manifest.perApp ?? {}).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  )
  if (!sameJson(manifestPerApp, derivedPerApp)) {
    throw new TypeError('corpus manifest per-app totals do not match corpus')
  }
  if (
    bench !== undefined &&
    (bench.documents !== corpus.documents.length ||
      bench.queries.recorded !== corpus.recordedQueries.length ||
      bench.queries.authored !== authored.queries.length)
  ) {
    throw new TypeError('benchmark counts do not match validated report inputs')
  }
}

interface SliceQueryCounts {
  recorded: Record<string, number>
  authored: Record<string, number>
}

function queryCountsByApp(queries: readonly { app: string }[]): Record<string, number> {
  const counts = new Map<string, number>()
  for (const query of queries) counts.set(query.app, (counts.get(query.app) ?? 0) + 1)
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  ))
}

function sortedRecord<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  )
}

function validateBenchmarkEvidence(
  candidates: readonly BenchCandidate[],
  bench: BenchRunResult,
  path: string,
  expectedPerAppQueries?: SliceQueryCounts,
): void {
  if (bench === null || typeof bench !== 'object' || bench.schemaVersion !== 1) {
    throw new TypeError(`${path} has an invalid benchmark schema`)
  }
  assertNonnegativeInteger(bench.documents, `${path}.benchmark.documents`)
  assertNonnegativeInteger(
    bench.queries?.recorded,
    `${path}.benchmark.queries.recorded`,
  )
  assertNonnegativeInteger(
    bench.queries?.authored,
    `${path}.benchmark.queries.authored`,
  )
  if (!Array.isArray(bench.candidates) || bench.candidates.length !== candidates.length) {
    throw new TypeError(`${path} benchmark must contain one result per candidate pin`)
  }

  bench.candidates.forEach((rawResult, index) => {
    const result = validateCandidateBenchResult(rawResult)
    const pin = candidates[index]!
    if (result.candidateId !== pin.id) {
      throw new TypeError(
        `${path} benchmark candidate ${index} is ${result.candidateId}; expected ${pin.id}`,
      )
    }
    if (result.status === 'error') return
    if (!sameJson(result.profile, candidateProfile(pin))) {
      throw new TypeError(`${path} benchmark profile does not match pin ${pin.id}`)
    }
    for (const [sliceName, expectedQueries] of [
      ['recorded', bench.queries.recorded],
      ['authored', bench.queries.authored],
    ] as const) {
      const slice = result.slices[sliceName]
      const perAppQueries = Object.values(slice.perApp).reduce(
        (sum, rates) => sum + rates.queries,
        0,
      )
      if (
        slice.macro.queries !== expectedQueries ||
        perAppQueries !== expectedQueries
      ) {
        throw new TypeError(
          `${path} ${pin.id} ${sliceName} query counts do not match benchmark totals`,
        )
      }
      if (expectedPerAppQueries !== undefined) {
        const actual = Object.fromEntries(
          Object.entries(slice.perApp).map(([app, rates]) => [app, rates.queries]),
        )
        if (!sameJson(sortedRecord(actual), expectedPerAppQueries[sliceName])) {
          throw new TypeError(
            `${path} ${pin.id} ${sliceName} per-app query counts do not match report provenance`,
          )
        }
      }
    }
  })
}

interface PathIdentity {
  absolute: string
  canonical: string
  deviceAndInode: string | null
  symbolicLink: boolean
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

async function canonicalizeProspectivePath(path: string): Promise<string> {
  let cursor = resolve(path)
  const missingSegments: string[] = []
  while (true) {
    try {
      return resolve(await realpath(cursor), ...missingSegments)
    } catch (error) {
      if (!isMissingPathError(error)) throw error
      const parent = dirname(cursor)
      if (parent === cursor) throw error
      missingSegments.unshift(basename(cursor))
      cursor = parent
    }
  }
}

async function inspectPathIdentity(path: string): Promise<PathIdentity> {
  const absolute = resolve(path)
  let entry: Awaited<ReturnType<typeof lstat>> | null = null
  try {
    entry = await lstat(absolute)
  } catch (error) {
    if (!isMissingPathError(error)) throw error
  }
  let deviceAndInode: string | null = null
  if (entry !== null) {
    try {
      const target = await stat(absolute)
      // Some Windows filesystems report zero for every inode. Canonical path
      // comparison still covers symlinks there; avoid treating all files as aliases.
      if (target.ino !== 0) deviceAndInode = `${target.dev}:${target.ino}`
    } catch (error) {
      if (!isMissingPathError(error)) throw error
    }
  }
  return {
    absolute,
    canonical: await canonicalizeProspectivePath(absolute),
    deviceAndInode,
    symbolicLink: entry?.isSymbolicLink() ?? false,
  }
}

function pathsAlias(left: PathIdentity, right: PathIdentity): boolean {
  return (
    left.absolute === right.absolute ||
    left.canonical === right.canonical ||
    (left.deviceAndInode !== null && left.deviceAndInode === right.deviceAndInode)
  )
}

async function assertSafeOutputPaths(
  outputs: readonly { path: string; label: string }[],
  inputs: readonly { path: string; label: string }[] = [],
  inputCollisionPrefix = 'benchmark output would overwrite',
): Promise<void> {
  const outputIdentities = await Promise.all(
    outputs.map(async (output) => ({
      output,
      identity: await inspectPathIdentity(output.path),
    })),
  )
  for (const { output, identity } of outputIdentities) {
    if (identity.symbolicLink) {
      throw new TypeError(`${output.label} output must not be a symbolic link: ${output.path}`)
    }
  }
  for (let leftIndex = 0; leftIndex < outputIdentities.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < outputIdentities.length;
      rightIndex += 1
    ) {
      const left = outputIdentities[leftIndex]!
      const right = outputIdentities[rightIndex]!
      if (pathsAlias(left.identity, right.identity)) {
        throw new TypeError(
          `${left.output.label} and ${right.output.label} output paths must be distinct`,
        )
      }
    }
  }
  const inputIdentities = await Promise.all(
    inputs.map(async (input) => ({
      input,
      identity: await inspectPathIdentity(input.path),
    })),
  )
  for (const { output, identity } of outputIdentities) {
    const collision = inputIdentities.find(({ identity: input }) =>
      pathsAlias(identity, input),
    )
    if (collision !== undefined) {
      throw new TypeError(
        `${inputCollisionPrefix} ${collision.input.label} ${collision.input.path}`,
      )
    }
  }
}

export async function emitReport(options: EmitReportOptions): Promise<{
  jsonPath: string
  markdownPath: string
  report: RawBenchReport
}> {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const jsonPath = resolve(
    options.outputPath ?? `bench-report-${platform}-${arch}.json`,
  )
  const markdownPath = resolve(dirname(jsonPath), 'REPORT.md')
  if (extname(jsonPath).toLowerCase() !== '.json') {
    throw new TypeError('benchmark raw report output must use a .json filename')
  }
  if (jsonPath === markdownPath) {
    throw new TypeError('benchmark JSON and Markdown output paths must be distinct')
  }
  await assertSafeOutputPaths([
    { path: jsonPath, label: 'benchmark JSON' },
    { path: markdownPath, label: 'benchmark Markdown' },
  ])
  assertCorpusManifestMatches(
    options.corpus,
    options.corpusManifest,
    options.authored,
    options.bench,
  )
  const perAppQueries: SliceQueryCounts = {
    recorded: queryCountsByApp(options.corpus.recordedQueries),
    authored: queryCountsByApp(options.authored.queries),
  }
  validateBenchmarkEvidence(
    options.candidates,
    options.bench,
    'report',
    perAppQueries,
  )
  const report: RawBenchReport = {
    schemaVersion: 2,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    platform,
    arch,
    runtime: options.runtime,
    execution: options.execution,
    config: options.config,
    inputs: options.references,
    corpusManifest: options.corpusManifest,
    authoredQueries: {
      provenance: options.authored.provenance,
      count: options.authored.queries.length,
      perApp: perAppQueries.authored,
    },
    candidatePins: options.candidates,
    benchmark: options.bench,
    constants: options.constants,
    calibration: {
      percentile: 0.05,
      rounding: 'down-to-2-decimals',
      proposals: tauProposals(options.bench),
    },
    decisionRule: decisionRuleForConfig(options.config),
    verdict: applyPerformanceCompleteness(
      applyDecisionRule(options.candidates, options.bench, options.config),
      options.candidates,
      options.constants,
      options.execution,
    ),
  }

  await mkdir(dirname(jsonPath), { recursive: true })
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(markdownPath, renderMarkdown(report), 'utf8')
  return { jsonPath, markdownPath, report }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function validateRuntime(runtime: BenchmarkRuntime, path: string): void {
  if (runtime === null || typeof runtime !== 'object') {
    throw new Error(`${path} has an invalid runtime`)
  }
  if (runtime.engine !== '@huggingface/transformers') {
    throw new Error(`${path} has an unsupported runtime engine`)
  }
  for (const [label, value] of [
    ['Transformers.js version', runtime.transformersJsVersion],
    ['Node version', runtime.nodeVersion],
    ['OS release', runtime.osRelease],
    ['CPU model', runtime.cpuModel],
  ] as const) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`${path} has an invalid runtime ${label}`)
    }
  }
  if (runtime.pipeline !== 'feature-extraction' || runtime.device !== 'cpu') {
    throw new Error(`${path} has an unsupported runtime pipeline/device`)
  }
  if (!Number.isSafeInteger(runtime.logicalCpuCount) || runtime.logicalCpuCount <= 0) {
    throw new Error(`${path} has an invalid runtime logical CPU count`)
  }
  if (!Number.isSafeInteger(runtime.totalMemoryBytes) || runtime.totalMemoryBytes <= 0) {
    throw new Error(`${path} has an invalid runtime memory total`)
  }
}

function validateExecution(
  execution: BenchmarkExecutionPolicy,
  path: string,
): void {
  if (
    execution === null ||
    typeof execution !== 'object' ||
    (execution.network !== 'downloads-allowed' &&
      execution.network !== 'offline-cache-only') ||
    (execution.performance !== 'measured' && execution.performance !== 'skipped')
  ) {
    throw new Error(`${path} has an invalid execution policy`)
  }
}

function validateReferences(references: ReportReferences, path: string): void {
  for (const key of [
    'config',
    'candidates',
    'corpus',
    'corpusManifest',
    'authoredQueries',
  ] as const) {
    const reference = references[key]
    if (
      reference === undefined ||
      typeof reference.path !== 'string' ||
      reference.path.length === 0 ||
      !/^[a-f\d]{64}$/u.test(reference.sha256)
    ) {
      throw new Error(`${path} has an invalid ${key} input reference`)
    }
  }
}

function evidenceRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function validateRawReportProvenance(
  report: RawBenchReport,
  path: string,
): SliceQueryCounts {
  const manifest = evidenceRecord(report.corpusManifest, `${path}.corpusManifest`)
  if (
    typeof manifest.builderVersion !== 'string' ||
    manifest.builderVersion.length === 0
  ) {
    throw new Error(`${path} has an invalid corpus manifest builder version`)
  }
  const totals = evidenceRecord(
    manifest.totals,
    `${path}.corpusManifest.totals`,
  )
  assertNonnegativeInteger(totals.documents, `${path}.corpusManifest.totals.documents`)
  assertNonnegativeInteger(
    totals.recordedQueries,
    `${path}.corpusManifest.totals.recordedQueries`,
  )
  assertNonnegativeInteger(
    totals.sourceCassettes,
    `${path}.corpusManifest.totals.sourceCassettes`,
  )
  if (
    totals.documents !== report.benchmark.documents ||
    totals.recordedQueries !== report.benchmark.queries.recorded
  ) {
    throw new Error(`${path} corpus manifest totals do not match benchmark counts`)
  }

  const sources = manifest.sources
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error(`${path}.corpusManifest.sources must be a nonempty array`)
  }
  if (totals.sourceCassettes !== sources.length) {
    throw new Error(`${path} corpus manifest source total does not match sources`)
  }
  const sourcePaths = new Set<string>()
  const sourceApps = new Set<string>()
  sources.forEach((value, index) => {
    const source = evidenceRecord(value, `${path}.corpusManifest.sources[${index}]`)
    if (typeof source.path !== 'string' || source.path.length === 0) {
      throw new Error(`${path} has an invalid corpus manifest source path`)
    }
    if (sourcePaths.has(source.path)) {
      throw new Error(`${path} has a duplicate corpus manifest source path`)
    }
    sourcePaths.add(source.path)
    if (typeof source.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(source.sha256)) {
      throw new Error(`${path} has an invalid corpus manifest source SHA-256`)
    }
    if (
      !Array.isArray(source.apps) ||
      source.apps.length === 0 ||
      source.apps.some((app) => typeof app !== 'string' || app.length === 0) ||
      new Set(source.apps).size !== source.apps.length
    ) {
      throw new Error(`${path} has invalid corpus manifest source apps`)
    }
    source.apps.forEach((app) => sourceApps.add(app))
    if (source.granularity !== 'leaf' && source.granularity !== 'procedure') {
      throw new Error(`${path} has an invalid corpus manifest source granularity`)
    }
    if (
      source.kind !== 'canonical' &&
      source.kind !== 'extracted' &&
      source.kind !== 'fixture'
    ) {
      throw new Error(`${path} has an invalid corpus manifest source kind`)
    }
  })

  const perApp = evidenceRecord(manifest.perApp, `${path}.corpusManifest.perApp`)
  const recorded: Record<string, number> = {}
  let perAppDocumentTotal = 0
  let perAppRecordedTotal = 0
  for (const [app, value] of Object.entries(perApp)) {
    if (app.length === 0) throw new Error(`${path} has an empty corpus manifest app`)
    const appTotals = evidenceRecord(
      value,
      `${path}.corpusManifest.perApp.${app}`,
    )
    assertNonnegativeInteger(
      appTotals.documents,
      `${path}.corpusManifest.perApp.${app}.documents`,
    )
    assertNonnegativeInteger(
      appTotals.recordedQueries,
      `${path}.corpusManifest.perApp.${app}.recordedQueries`,
    )
    if (appTotals.documents === 0) {
      throw new Error(`${path} corpus manifest app ${app} has no documents`)
    }
    perAppDocumentTotal += appTotals.documents
    perAppRecordedTotal += appTotals.recordedQueries
    if (appTotals.recordedQueries > 0) recorded[app] = appTotals.recordedQueries
  }
  if (
    perAppDocumentTotal < totals.documents ||
    perAppRecordedTotal !== totals.recordedQueries
  ) {
    throw new Error(`${path} corpus manifest per-app totals are inconsistent`)
  }
  const manifestApps = new Set(Object.keys(perApp))
  if (
    manifestApps.size !== sourceApps.size ||
    [...manifestApps].some((app) => !sourceApps.has(app))
  ) {
    throw new Error(`${path} corpus manifest source apps do not match per-app totals`)
  }

  const authored = evidenceRecord(report.authoredQueries, `${path}.authoredQueries`)
  const provenance = evidenceRecord(
    authored.provenance,
    `${path}.authoredQueries.provenance`,
  )
  for (const [key, value] of Object.entries(provenance)) {
    if (key.length === 0 || typeof value !== 'string') {
      throw new Error(`${path} has invalid authored-query provenance`)
    }
  }
  assertNonnegativeInteger(authored.count, `${path}.authoredQueries.count`)
  if (authored.count !== report.benchmark.queries.authored) {
    throw new Error(`${path} authored-query count does not match benchmark counts`)
  }
  const authoredPerApp = evidenceRecord(
    authored.perApp,
    `${path}.authoredQueries.perApp`,
  )
  const authoredCounts: Record<string, number> = {}
  let authoredTotal = 0
  for (const [app, count] of Object.entries(authoredPerApp)) {
    if (app.length === 0) throw new Error(`${path} has an empty authored-query app`)
    if (!manifestApps.has(app)) {
      throw new Error(`${path} authored-query app ${app} is absent from the corpus manifest`)
    }
    assertNonnegativeInteger(count, `${path}.authoredQueries.perApp.${app}`)
    if (count === 0) {
      throw new Error(`${path} authored-query app ${app} must have a positive count`)
    }
    authoredCounts[app] = count
    authoredTotal += count
  }
  if (authoredTotal !== authored.count) {
    throw new Error(`${path} authored-query per-app counts are inconsistent`)
  }

  return {
    recorded: sortedRecord(recorded),
    authored: sortedRecord(authoredCounts),
  }
}

function validateFiniteBenchmark(input: MergeReportInput): void {
  for (const candidate of input.report.benchmark.candidates) {
    if (candidate.status === 'error') {
      throw new Error(
        `${input.path} benchmark failed for ${candidate.candidateId}: ${candidate.error.message}`,
      )
    }
    for (const sliceName of ['recorded', 'authored'] as const) {
      const slice = candidate.slices[sliceName]
      for (const [scope, metrics] of [
        ['macro', slice.macro],
        ...Object.entries(slice.perApp),
      ] as const) {
        for (const metricName of ['queries', 'hitAt1', 'hitAt3', 'hitAt5'] as const) {
          if (!Number.isFinite(metrics[metricName])) {
            throw new Error(
              `${input.path} has a non-finite ${candidate.candidateId} ${sliceName} ${scope} ${metricName}`,
            )
          }
        }
      }
      for (const pairSet of ['goldPairCosines', 'randomPairCosines'] as const) {
        const values = candidate.distributions[sliceName][pairSet]
        if (
          !Array.isArray(values) ||
          values.some((value) => !Number.isFinite(value))
        ) {
          throw new Error(
            `${input.path} has an invalid ${candidate.candidateId} ${sliceName} ${pairSet} distribution`,
          )
        }
      }
    }
  }
}

function validateConstantEvidence(
  result: CandidateConstantsSuccess,
  candidate: BenchCandidate,
  report: RawBenchReport,
  path: string,
): void {
  const expectedConcurrent = Math.min(
    report.config.performance.concurrentDocumentSamples,
    report.benchmark.documents,
  )
  const expectedSample = {
    singleDocuments: Math.min(
      report.config.performance.singleDocumentSamples,
      report.benchmark.documents,
    ),
    concurrentDocuments: expectedConcurrent,
    concurrency: Math.min(report.config.performance.concurrency, expectedConcurrent),
    topKDocuments: expectedConcurrent,
    topK: Math.min(report.config.performance.topK, expectedConcurrent),
    topKIterations: report.config.performance.topKIterations,
  }
  if (!sameJson(result.sample, expectedSample)) {
    throw new Error(`${path} constants sample drifted for ${candidate.id}`)
  }

  const nonnegativeMetrics = [
    ['timeToFirstEmbeddingMs', result.timeToFirstEmbeddingMs],
    ['singleDocumentDocsPerSecond', result.singleDocumentDocsPerSecond],
    ['singleDocumentLatencyMs.p50', result.singleDocumentLatencyMs?.p50],
    ['singleDocumentLatencyMs.p95', result.singleDocumentLatencyMs?.p95],
    ['concurrentDocsPerSecond', result.concurrentDocsPerSecond],
    ['bruteTopKMs', result.bruteTopKMs],
  ] as const
  for (const [name, value] of nonnegativeMetrics) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`${path} has invalid ${candidate.id} constants ${name}`)
    }
  }
  if (result.singleDocumentLatencyMs.p95 < result.singleDocumentLatencyMs.p50) {
    throw new Error(`${path} has invalid ${candidate.id} constants latency percentiles`)
  }
  if (
    result.vec0TopKMs !== null &&
    (typeof result.vec0TopKMs !== 'number' ||
      !Number.isFinite(result.vec0TopKMs) ||
      result.vec0TopKMs < 0)
  ) {
    throw new Error(`${path} has invalid ${candidate.id} constants vec0TopKMs`)
  }

  for (const [name, value] of [
    ['rssBaselineBytes', result.rssBaselineBytes],
    ['rssPeakBytes', result.rssPeakBytes],
    ['rssDeltaBytes', result.rssDeltaBytes],
    ['vectorBytesPerDocument', result.vectorBytesPerDocument],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${path} has invalid ${candidate.id} constants ${name}`)
    }
  }
  if (
    result.rssPeakBytes < result.rssBaselineBytes ||
    result.rssDeltaBytes !== result.rssPeakBytes - result.rssBaselineBytes
  ) {
    throw new Error(`${path} has inconsistent ${candidate.id} RSS constants`)
  }
  if (result.vectorBytesPerDocument !== candidate.dim * FLOAT32_BYTES) {
    throw new Error(`${path} has invalid ${candidate.id} vector byte size`)
  }
}

function validateMergeInput(
  input: MergeReportInput,
  reference: RawBenchReport,
): void {
  const { report } = input
  if (report.schemaVersion !== 2) throw new Error(`${input.path} has an unknown schema`)
  if (typeof report.platform !== 'string' || report.platform.length === 0) {
    throw new Error(`${input.path} has an invalid platform`)
  }
  if (typeof report.arch !== 'string' || report.arch.length === 0) {
    throw new Error(`${input.path} has an invalid architecture`)
  }
  validateRuntime(report.runtime, input.path)
  validateExecution(report.execution, input.path)
  if (report.execution.performance !== 'measured') {
    throw new Error(`${input.path} skipped performance measurements and cannot be merged`)
  }
  validateReferences(report.inputs, input.path)
  const candidatePins = parseCandidates(report.candidatePins)
  parseBenchmarkConfig(report.config, candidatePins)
  const perAppQueries = validateRawReportProvenance(report, input.path)
  validateBenchmarkEvidence(
    candidatePins,
    report.benchmark,
    input.path,
    perAppQueries,
  )

  for (const [label, actual, wanted] of [
    ['configuration', report.config, reference.config],
    [
      'input hashes',
      Object.fromEntries(
        Object.entries(report.inputs).map(([key, value]) => [key, value.sha256]),
      ),
      Object.fromEntries(
        Object.entries(reference.inputs).map(([key, value]) => [key, value.sha256]),
      ),
    ],
    ['corpus manifest', report.corpusManifest, reference.corpusManifest],
    ['candidate pins', report.candidatePins, reference.candidatePins],
    ['document count', report.benchmark.documents, reference.benchmark.documents],
    ['query counts', report.benchmark.queries, reference.benchmark.queries],
    ['authored query provenance', report.authoredQueries, reference.authoredQueries],
  ] as const) {
    if (!sameJson(actual, wanted)) throw new Error(`${input.path} ${label} drifted`)
  }
  const qualityEvidence = report.benchmark.candidates.map((candidate) =>
    candidate.status === 'error'
      ? candidate
      : {
          candidateId: candidate.candidateId,
          status: candidate.status,
          profile: candidate.profile,
          slices: candidate.slices,
        },
  )
  const referenceQualityEvidence = reference.benchmark.candidates.map((candidate) =>
    candidate.status === 'error'
      ? candidate
      : {
          candidateId: candidate.candidateId,
          status: candidate.status,
          profile: candidate.profile,
          slices: candidate.slices,
        },
  )
  if (!sameJson(qualityEvidence, referenceQualityEvidence)) {
    throw new Error(`${input.path} quality evidence drifted across platforms`)
  }
  for (const [label, actual, wanted] of [
    ['engine', report.runtime.engine, reference.runtime.engine],
    [
      'Transformers.js version',
      report.runtime.transformersJsVersion,
      reference.runtime.transformersJsVersion,
    ],
    ['Node version', report.runtime.nodeVersion, reference.runtime.nodeVersion],
    ['pipeline', report.runtime.pipeline, reference.runtime.pipeline],
    ['device', report.runtime.device, reference.runtime.device],
  ] as const) {
    if (actual !== wanted) throw new Error(`${input.path} runtime ${label} drifted`)
  }

  const expectedCandidateIds = report.candidatePins.map(({ id }) => id)
  const actualCandidateIds = report.benchmark.candidates.map(
    ({ candidateId }) => candidateId,
  )
  if (!sameJson(actualCandidateIds, expectedCandidateIds)) {
    throw new Error(`${input.path} benchmark candidate identity drifted`)
  }
  validateFiniteBenchmark(input)

  if (report.constants.length !== report.candidatePins.length) {
    throw new Error(`${input.path} does not cover every candidate constant`)
  }
  for (const candidate of report.candidatePins) {
    const result = successfulConstant(input, candidate.id)
    if (result.platform !== report.platform || result.arch !== report.arch) {
      throw new Error(`${input.path} constants platform drifted for ${candidate.id}`)
    }
    validateConstantEvidence(result, candidate, report, input.path)
  }

  const expectedCalibration = {
    percentile: 0.05,
    rounding: 'down-to-2-decimals',
    proposals: tauProposals(report.benchmark),
  }
  if (!sameJson(report.calibration, expectedCalibration)) {
    throw new Error(`${input.path} calibration is not mechanically derived`)
  }
  if (!sameJson(report.decisionRule, decisionRuleForConfig(report.config))) {
    throw new Error(`${input.path} decision policy is not mechanically derived`)
  }
  if (
    !sameJson(
      report.verdict,
      applyPerformanceCompleteness(
        applyDecisionRule(report.candidatePins, report.benchmark, report.config),
        report.candidatePins,
        report.constants,
        report.execution,
      ),
    )
  ) {
    throw new Error(`${input.path} verdict is not mechanically derived`)
  }
  if (!sameJson(report.verdict, reference.verdict)) {
    throw new Error(`${input.path} mechanical verdict drifted across platforms`)
  }
}

function orderMergeInputs(inputs: readonly MergeReportInput[]): MergeReportInput[] {
  if (inputs.length === 0) throw new Error('merge requires at least one raw report')
  const seen = new Set<string>()
  for (const input of inputs) {
    const identity = `${input.report.platform}/${input.report.arch}`
    if (seen.has(identity)) {
      throw new Error(`merge requires unique platform/arch reports; duplicate ${identity}`)
    }
    seen.add(identity)
  }
  return [...inputs].sort((left, right) => {
    const platform = left.report.platform.localeCompare(right.report.platform)
    if (platform !== 0) return platform
    const arch = left.report.arch.localeCompare(right.report.arch)
    if (arch !== 0) return arch
    return left.path.localeCompare(right.path)
  })
}

export async function mergeReports(options: MergeReportOptions): Promise<{
  markdownPath: string
  markdown: string
}> {
  const inputs = orderMergeInputs(options.inputs)
  const referenceReport = inputs[0]!.report
  for (const input of inputs) validateMergeInput(input, referenceReport)

  const markdownPath = resolve(options.outputPath ?? 'REPORT.md')
  await assertSafeOutputPaths(
    [{ path: markdownPath, label: 'merge Markdown' }],
    inputs.map((input) => ({ path: input.path, label: 'input report' })),
    'merge output would overwrite',
  )
  const rawReportLines = [
    '### Raw Platform Reports',
    '',
    '| Environment | Path | SHA-256 | Generated |',
    '|---|---|---|---|',
    ...inputs.map(
      (input) =>
        `| ${input.report.platform}/${input.report.arch} | ${markdownCell(input.path)} | \`${input.sha256}\` | ${input.report.generatedAt} |`,
    ),
    '',
    '### Per-platform Input Provenance',
    '',
    '| Environment | Input | Path | SHA-256 |',
    '|---|---|---|---|',
    ...inputs.flatMap((input) =>
      Object.entries(input.report.inputs).map(
        ([name, reference]) =>
          `| ${input.report.platform}/${input.report.arch} | ${name} | ${markdownCell(reference.path)} | \`${reference.sha256}\` |`,
      ),
    ),
  ]
  const labels = inputs.map(({ report }) => `${report.platform}/${report.arch}`)
  const markdown = renderMarkdown(referenceReport, {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    platformSummary: `merged evidence — ${labels.join(', ')}`,
    runtimeInputs: inputs.map(({ report }) => ({
      label: `${report.platform}/${report.arch}`,
      runtime: report.runtime,
      execution: report.execution,
    })),
    preCorpusLines: rawReportLines,
    constantsLines: renderMergedConstantsTable(referenceReport.candidatePins, inputs),
    constantsNote: `Every candidate has a successful isolated-process performance measurement on each merged environment: ${labels.join(', ')}.`,
    qualitySourceLabel: labels[0],
  })
  await mkdir(dirname(markdownPath), { recursive: true })
  await writeFile(markdownPath, markdown, 'utf8')
  return { markdownPath, markdown }
}

function digest(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

async function readJson<T>(path: string): Promise<{ raw: string; value: T }> {
  const raw = await readFile(resolve(path), 'utf8')
  return { raw, value: JSON.parse(raw) as T }
}

export const DEFAULT_CLI_PATHS = {
  configPath: fileURLToPath(new URL('../benchmark.config.json', import.meta.url)),
  candidatesPath: fileURLToPath(new URL('../candidates.json', import.meta.url)),
  corpusPath: fileURLToPath(new URL('../corpus/corpus.json', import.meta.url)),
  corpusManifestPath: fileURLToPath(
    new URL('../corpus/corpus-manifest.json', import.meta.url),
  ),
  authoredQueriesPath: fileURLToPath(
    new URL('../fixtures/authored-queries.json', import.meta.url),
  ),
} as const

const DEFAULT_REFERENCE_PATHS = {
  configPath: 'tools/embedding-bench/benchmark.config.json',
  candidatesPath: 'tools/embedding-bench/candidates.json',
  corpusPath: 'tools/embedding-bench/corpus/corpus.json',
  corpusManifestPath: 'tools/embedding-bench/corpus/corpus-manifest.json',
  authoredQueriesPath: 'tools/embedding-bench/fixtures/authored-queries.json',
} as const

export type CliMode = 'run' | 'list' | 'validate' | 'merge'

export interface CliOptions {
  mode: CliMode
  configPath: string
  candidatesPath: string
  corpusPath: string
  corpusManifestPath: string
  authoredQueriesPath: string
  candidateIds: string[]
  includeBaseline: boolean
  accuracyOnly: boolean
  allowDownload: boolean
  outputPath?: string
  inputPaths: string[]
}

function requiredOptionValue(
  args: readonly string[],
  index: number,
  option: string,
): { value: string; nextIndex: number } | null {
  const argument = args[index]!
  if (argument === option) {
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new TypeError(`${option} requires a value`)
    }
    return { value, nextIndex: index + 1 }
  }
  if (!argument.startsWith(`${option}=`)) return null
  const value = argument.slice(option.length + 1)
  if (value.length === 0) throw new TypeError(`${option} requires a value`)
  return { value, nextIndex: index }
}

/** Parse the public embedding benchmark CLI without touching the filesystem or models. */
export function parseCliOptions(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    mode: 'run',
    ...DEFAULT_CLI_PATHS,
    candidateIds: [],
    includeBaseline: true,
    accuracyOnly: false,
    allowDownload: true,
    inputPaths: [],
  }
  let explicitMode: CliMode | undefined
  const positionals: string[] = []
  const setMode = (mode: CliMode): void => {
    if (explicitMode !== undefined && explicitMode !== mode) {
      throw new TypeError(`conflicting CLI modes: ${explicitMode} and ${mode}`)
    }
    explicitMode = mode
  }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (argument === '--') continue
    if (
      argument === 'run' ||
      argument === 'list' ||
      argument === 'validate' ||
      argument === 'merge'
    ) {
      setMode(argument)
      continue
    }
    if (
      argument === '--run' ||
      argument === '--list' ||
      argument === '--validate' ||
      argument === '--merge'
    ) {
      setMode(argument.slice(2) as CliMode)
      continue
    }
    if (argument === '--no-baseline') {
      options.includeBaseline = false
      continue
    }
    if (argument === '--accuracy-only') {
      options.accuracyOnly = true
      continue
    }
    if (argument === '--offline') {
      options.allowDownload = false
      continue
    }

    let parsed = requiredOptionValue(args, index, '--config')
    if (parsed !== null) {
      options.configPath = parsed.value
      index = parsed.nextIndex
      continue
    }
    parsed = requiredOptionValue(args, index, '--candidates')
    if (parsed !== null) {
      options.candidatesPath = parsed.value
      index = parsed.nextIndex
      continue
    }
    parsed = requiredOptionValue(args, index, '--corpus')
    if (parsed !== null) {
      options.corpusPath = parsed.value
      index = parsed.nextIndex
      continue
    }
    parsed = requiredOptionValue(args, index, '--corpus-manifest')
    if (parsed !== null) {
      options.corpusManifestPath = parsed.value
      index = parsed.nextIndex
      continue
    }
    parsed = requiredOptionValue(args, index, '--authored-queries')
    if (parsed !== null) {
      options.authoredQueriesPath = parsed.value
      index = parsed.nextIndex
      continue
    }
    parsed = requiredOptionValue(args, index, '--candidate')
    if (parsed !== null) {
      options.candidateIds.push(parsed.value)
      index = parsed.nextIndex
      continue
    }
    parsed = requiredOptionValue(args, index, '--report')
    if (parsed !== null) {
      options.outputPath = parsed.value
      index = parsed.nextIndex
      continue
    }

    if (argument.startsWith('--')) throw new TypeError(`unknown argument: ${argument}`)
    positionals.push(argument)
  }

  options.mode = explicitMode ?? 'run'
  if (options.mode === 'merge') {
    if (positionals.length === 0) throw new TypeError('merge requires raw report paths')
    options.inputPaths = positionals
  } else if (positionals.length > 0) {
    throw new TypeError(`unexpected positional argument: ${positionals[0]}`)
  }
  return options
}

function referencePath(
  actual: string,
  key: keyof typeof DEFAULT_CLI_PATHS,
): string {
  return actual === DEFAULT_CLI_PATHS[key] ? DEFAULT_REFERENCE_PATHS[key] : actual
}

async function assertRunOutputPaths(cli: CliOptions): Promise<void> {
  const jsonPath = resolve(
    cli.outputPath ?? `bench-report-${process.platform}-${process.arch}.json`,
  )
  const markdownPath = resolve(dirname(jsonPath), 'REPORT.md')
  if (extname(jsonPath).toLowerCase() !== '.json') {
    throw new TypeError('benchmark raw report output must use a .json filename')
  }
  if (jsonPath === markdownPath) {
    throw new TypeError('benchmark JSON and Markdown output paths must be distinct')
  }
  await assertSafeOutputPaths(
    [
      { path: jsonPath, label: 'benchmark JSON' },
      { path: markdownPath, label: 'benchmark Markdown' },
    ],
    [
      { label: 'config input', path: cli.configPath },
      { label: 'candidates input', path: cli.candidatesPath },
      { label: 'corpus input', path: cli.corpusPath },
      { label: 'corpus manifest input', path: cli.corpusManifestPath },
      { label: 'authored queries input', path: cli.authoredQueriesPath },
    ],
  )
}

async function detectRuntime(): Promise<BenchmarkRuntime> {
  const backend = (await import(
    new URL('./transformers-js-backend.ts', import.meta.url).href
  )) as typeof import('./transformers-js-backend')
  return backend.detectBenchmarkRuntime()
}

export async function runCli(args = process.argv.slice(2)): Promise<void> {
  const cli = parseCliOptions(args)
  if (cli.mode === 'merge') {
    const inputs = await Promise.all(
      cli.inputPaths.map(async (path): Promise<MergeReportInput> => {
        const raw = await readFile(resolve(path), 'utf8')
        return {
          path,
          sha256: digest(raw),
          report: JSON.parse(raw) as RawBenchReport,
        }
      }),
    )
    const merged = await mergeReports({ outputPath: cli.outputPath, inputs })
    process.stdout.write(`${JSON.stringify({ markdown: merged.markdownPath })}\n`)
    return
  }

  if (cli.mode === 'run') await assertRunOutputPaths(cli)

  const candidateInput = await readJson<unknown>(cli.candidatesPath)
  const allCandidates = parseCandidates(candidateInput.value)
  if (cli.mode === 'list') {
    const rows = [
      ['ID', 'MODEL', 'REVISION', 'BACKEND'],
      ...allCandidates.map((candidate) => [
        candidate.id,
        candidate.model_id,
        candidate.revision,
        candidate.backend,
      ]),
    ]
    process.stdout.write(`${rows.map((row) => row.join('\t')).join('\n')}\n`)
    return
  }

  const configInput = await readJson<unknown>(cli.configPath)
  const config = parseBenchmarkConfig(configInput.value, allCandidates)
  const runtime = await detectRuntime()
  if (cli.mode === 'validate') {
    process.stdout.write(
      `${JSON.stringify({ valid: true, candidates: allCandidates.length, runtime }, null, 2)}\n`,
    )
    return
  }

  const [corpusInput, manifestInput, authoredInput] = await Promise.all([
    readJson<BenchCorpus>(cli.corpusPath),
    readJson<CorpusManifest>(cli.corpusManifestPath),
    readJson<AuthoredQueries>(cli.authoredQueriesPath),
  ])
  assertCorpusManifestMatches(
    corpusInput.value,
    manifestInput.value,
    authoredInput.value,
  )
  const candidates = selectCandidates(allCandidates, config, {
    requestedIds: cli.candidateIds.length === 0 ? undefined : cli.candidateIds,
    includeBaseline: cli.includeBaseline,
  })
  const isolatedBench = (await import(
    new URL('./measure-bench.ts', import.meta.url).href
  )) as typeof import('./measure-bench')
  const bench = await isolatedBench.measureAllCandidates(
    {
      candidates,
      corpus: corpusInput.value,
      authored: authoredInput.value,
      allowDownload: cli.allowDownload,
    },
  )
  let measured: CandidateConstantsResult[] = []
  if (!cli.accuracyOnly) {
    const constants = (await import(
      new URL('./measure-constants.ts', import.meta.url).href
    )) as typeof import('./measure-constants')
    measured = await constants.measureAllConstants(candidates, {
      // Bind performance measurements to the same exact bytes used for corpus
      // validation, quality measurement, and the report provenance digest.
      corpusRaw: corpusInput.raw,
      performance: config.performance,
      allowDownload: cli.allowDownload,
    })
  }
  const emitted = await emitReport({
    outputPath: cli.outputPath,
    config,
    runtime,
    execution: {
      network: cli.allowDownload ? 'downloads-allowed' : 'offline-cache-only',
      performance: cli.accuracyOnly ? 'skipped' : 'measured',
    },
    candidates,
    corpus: corpusInput.value,
    bench,
    constants: measured,
    corpusManifest: manifestInput.value,
    authored: authoredInput.value,
    references: {
      config: {
        path: referencePath(cli.configPath, 'configPath'),
        sha256: digest(configInput.raw),
      },
      candidates: {
        path: referencePath(cli.candidatesPath, 'candidatesPath'),
        sha256: digest(candidateInput.raw),
      },
      corpus: {
        path: referencePath(cli.corpusPath, 'corpusPath'),
        sha256: digest(corpusInput.raw),
      },
      corpusManifest: {
        path: referencePath(cli.corpusManifestPath, 'corpusManifestPath'),
        sha256: digest(manifestInput.raw),
      },
      authoredQueries: {
        path: referencePath(cli.authoredQueriesPath, 'authoredQueriesPath'),
        sha256: digest(authoredInput.raw),
      },
    },
  })
  process.stdout.write(
    `${JSON.stringify({ report: emitted.jsonPath, markdown: emitted.markdownPath })}\n`,
  )
  const failedBench = bench.candidates.filter(({ status }) => status === 'error')
  const failedConstants = measured.filter(({ status }) => status === 'error')
  if (failedBench.length > 0 || failedConstants.length > 0) {
    process.stderr.write(
      `[embedding-bench] incomplete report: ${failedBench.length} quality failure(s), ${failedConstants.length} performance failure(s)\n`,
    )
    process.exitCode = 1
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    process.exitCode = 1
  })
}
