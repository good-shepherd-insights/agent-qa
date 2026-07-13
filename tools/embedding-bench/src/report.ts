import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  CandidateConstantsResult,
  CandidateConstantsSuccess,
} from './measure-constants'
import type {
  AuthoredQueries,
  BenchCandidate,
  BenchRunResult,
  CandidateBenchSuccess,
  HitRates,
} from './runner'

export const DECISION_RULE = [
  'An alternate displaces bge-small only if it beats it on recorded-slice hit@5 by ≥ 3.0 absolute points AND its recorded-slice hit@1 is not lower; the report must note dim/cost consequences (gte 768-d = 2× vector storage, ~4.4× model bytes) — ties go to bge-small.',
  'The floor is "acceptable beyond emergency mode" only if its recorded-slice hit@5 is within 10.0 absolute points of the winner\'s.',
  'τ_dense per profile (locked default AND floor) = the 5th percentile of gold-pair cosine similarities on the recorded slice, rounded DOWN to 2 decimals — a permissive admission floor; the gold and random-pair distributions are recorded so the number is auditable.',
] as const

export const LANGUAGE_MIX_RECORD =
  'English-only validated; multilingual unbenched; granite-multilingual-r2 is the documented escape hatch, benched when a real non-English app arrives.'

const BASELINE_CANDIDATE_ID = 'bge-small-en-v1.5'
const EXPECTED_CANDIDATE_COUNT = 4
const DISPLACEMENT_MARGIN = 0.03
const FLOOR_MARGIN = 0.1
const COMPARISON_TOLERANCE = 1e-12

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
    granularity: string
    kind: string
  }>
}

export interface InputReference {
  path: string
  sha256: string
}

export interface ReportReferences {
  candidates: InputReference
  corpus: InputReference
  corpusManifest: InputReference
  authoredQueries: InputReference
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
}

export interface RawBenchReport {
  schemaVersion: 1
  generatedAt: string
  platform: string
  arch: string
  inputs: ReportReferences
  corpusManifest: CorpusManifest
  authoredQueries: {
    provenance: Record<string, string>
    count: number
  }
  candidatePins: readonly BenchCandidate[]
  benchmark: BenchRunResult
  constants: readonly CandidateConstantsResult[]
  calibration: {
    percentile: 0.05
    rounding: 'down-to-2-decimals'
    proposals: TauProposal[]
  }
  decisionRule: typeof DECISION_RULE
  verdict: MechanicalVerdict
  languageMix: typeof LANGUAGE_MIX_RECORD
}

export interface EmitReportOptions {
  outputPath?: string
  platform?: string
  arch?: string
  generatedAt?: string
  candidates: readonly BenchCandidate[]
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

interface MarkdownRenderOptions {
  generatedAt?: string
  platformSummary?: string
  preCorpusLines?: readonly string[]
  constantsLines?: readonly string[]
  constantsNote?: string
  ratification?: string
}

interface ExpectedPlatform {
  platform: NodeJS.Platform
  arch: string
  label: string
}

const EXPECTED_PLATFORMS: readonly ExpectedPlatform[] = [
  { platform: 'darwin', arch: 'arm64', label: 'macos-arm64 (informative)' },
  { platform: 'linux', arch: 'x64', label: 'ubuntu-latest/linux-x64 (canonical)' },
  { platform: 'win32', arch: 'x64', label: 'windows-latest/win-x64 (canonical)' },
]

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

function compareRecorded(left: CandidateBenchSuccess, right: CandidateBenchSuccess): number {
  const hitAt5 = right.slices.recorded.macro.hitAt5 - left.slices.recorded.macro.hitAt5
  if (Math.abs(hitAt5) > COMPARISON_TOLERANCE) return hitAt5
  const hitAt1 = right.slices.recorded.macro.hitAt1 - left.slices.recorded.macro.hitAt1
  if (Math.abs(hitAt1) > COMPARISON_TOLERANCE) return hitAt1
  if (left.candidateId === BASELINE_CANDIDATE_ID) return -1
  if (right.candidateId === BASELINE_CANDIDATE_ID) return 1
  return left.candidateId.localeCompare(right.candidateId)
}

export function applyDecisionRule(
  candidates: readonly BenchCandidate[],
  bench: BenchRunResult,
): MechanicalVerdict {
  const successes = successfulCandidates(bench)
  const resultById = new Map(successes.map((result) => [result.candidateId, result]))
  const rawLeader = [...successes].sort(compareRecorded)[0]
  const baseline = resultById.get(BASELINE_CANDIDATE_ID)
  const floorCandidate = candidates.find((candidate) => candidate.backend === 'static')
  const floor = floorCandidate ? resultById.get(floorCandidate.id) : undefined
  const costConsequences =
    'gte-modernbert-base uses 768 dimensions: 2× bge-small vector storage and approximately 4.4× model bytes.'

  if (baseline === undefined) {
    return {
      status: 'indeterminate',
      baselineCandidateId: BASELINE_CANDIDATE_ID,
      bestRecordedHitAt5CandidateId: rawLeader?.candidateId ?? null,
      selectedDefaultCandidateId: null,
      qualifyingAlternateIds: [],
      baselineRecorded: null,
      selectedRecorded: null,
      floor: {
        candidateId: floorCandidate?.id ?? null,
        acceptableBeyondEmergencyMode: null,
        recordedHitAt5: floor?.slices.recorded.macro.hitAt5 ?? null,
        trailingGap: null,
      },
      rationale: 'The bge-small baseline did not complete, so the displacement rule cannot select a default.',
      costConsequences,
    }
  }

  const baselineHitAt1 = baseline.slices.recorded.macro.hitAt1
  const baselineHitAt5 = baseline.slices.recorded.macro.hitAt5
  const qualifying = candidates
    .filter(
      (candidate) =>
        candidate.backend !== 'static' && candidate.id !== BASELINE_CANDIDATE_ID,
    )
    .map((candidate) => resultById.get(candidate.id))
    .filter((candidate): candidate is CandidateBenchSuccess => candidate !== undefined)
    .filter((candidate) => {
      const metrics = candidate.slices.recorded.macro
      return (
        metrics.hitAt5 - baselineHitAt5 + COMPARISON_TOLERANCE >=
          DISPLACEMENT_MARGIN &&
        metrics.hitAt1 + COMPARISON_TOLERANCE >= baselineHitAt1
      )
    })
    .sort(compareRecorded)
  const selected = qualifying[0] ?? baseline
  const selectedHitAt1 = selected.slices.recorded.macro.hitAt1
  const selectedHitAt5 = selected.slices.recorded.macro.hitAt5
  const floorHitAt5 = floor?.slices.recorded.macro.hitAt5 ?? null
  const trailingGap =
    floorHitAt5 === null ? null : Math.max(0, selectedHitAt5 - floorHitAt5)
  const floorAcceptable =
    trailingGap === null ? null : trailingGap <= FLOOR_MARGIN + COMPARISON_TOLERANCE
  const rationale =
    selected.candidateId === BASELINE_CANDIDATE_ID
      ? 'No native alternate cleared both displacement margins; the default remains bge-small, including on ties.'
      : `${selected.candidateId} cleared the +3.0-point hit@5 margin without lowering hit@1 and mechanically displaces bge-small.`

  return {
    status: 'selected',
    baselineCandidateId: BASELINE_CANDIDATE_ID,
    bestRecordedHitAt5CandidateId: rawLeader?.candidateId ?? null,
    selectedDefaultCandidateId: selected.candidateId,
    qualifyingAlternateIds: qualifying.map(({ candidateId }) => candidateId),
    baselineRecorded: { hitAt1: baselineHitAt1, hitAt5: baselineHitAt5 },
    selectedRecorded: { hitAt1: selectedHitAt1, hitAt5: selectedHitAt5 },
    floor: {
      candidateId: floorCandidate?.id ?? null,
      acceptableBeyondEmergencyMode: floorAcceptable,
      recordedHitAt5: floorHitAt5,
      trailingGap,
    },
    rationale,
    costConsequences,
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
  const lines = [
    '| Candidate | OS/arch | Warm load ms | Single docs/s | Batch docs/s | RSS MiB | Brute top-k ms | vec0 top-k ms |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
  ]
  for (const result of constants) {
    if (result.status === 'error') {
      lines.push(
        `| ${markdownCell(result.candidateId)} | ${result.platform}/${result.arch} | ERROR: ${markdownCell(result.error.message)} | — | — | — | — | — |`,
      )
      continue
    }
    lines.push(renderConstantsRow(result))
  }
  return lines
}

function renderConstantsRow(result: CandidateConstantsSuccess): string {
  const rssMib = result.rssBytes / (1024 * 1024)
  return `| ${markdownCell(result.candidateId)} | ${result.platform}/${result.arch} | ${result.warmModelLoadMs.toFixed(3)} | ${result.singleDocumentDocsPerSecond.toFixed(3)} | ${result.batchedDocsPerSecond.toFixed(3)} | ${rssMib.toFixed(2)} | ${result.bruteTopKMs.toFixed(6)} | ${result.vec0TopKMs === null ? 'unavailable' : result.vec0TopKMs.toFixed(6)} |`
}

function constantValue(
  result: CandidateConstantsSuccess,
  metricName:
    | 'warmModelLoadMs'
    | 'singleDocumentDocsPerSecond'
    | 'batchedDocsPerSecond'
    | 'rssMib'
    | 'bruteTopKMs'
    | 'vec0TopKMs',
): string {
  switch (metricName) {
    case 'warmModelLoadMs':
      return result.warmModelLoadMs.toFixed(3)
    case 'singleDocumentDocsPerSecond':
      return result.singleDocumentDocsPerSecond.toFixed(3)
    case 'batchedDocsPerSecond':
      return result.batchedDocsPerSecond.toFixed(3)
    case 'rssMib':
      return (result.rssBytes / (1024 * 1024)).toFixed(2)
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
  const result = input.report.constants.find(
    (constant) => constant.candidateId === candidateId,
  )
  if (result === undefined) {
    throw new Error(`${input.path} is missing constants for ${candidateId}`)
  }
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
  const labels = EXPECTED_PLATFORMS.map(({ label }) => label)
  const lines = [
    `| Candidate | Metric | ${labels.join(' | ')} |`,
    `|---|---|${labels.map(() => '---:').join('|')}|`,
  ]
  const metrics = [
    ['warmModelLoadMs', 'Warm load ms'],
    ['singleDocumentDocsPerSecond', 'Single docs/s'],
    ['batchedDocsPerSecond', 'Batch docs/s'],
    ['rssMib', 'RSS MiB'],
    ['bruteTopKMs', 'Brute top-k ms'],
    ['vec0TopKMs', 'vec0 top-k ms'],
  ] as const

  for (const candidate of candidates) {
    const results = inputs.map((input) => successfulConstant(input, candidate.id))
    for (const [metricName, label] of metrics) {
      lines.push(
        `| ${candidate.id} | ${label} | ${results
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
        `| ${candidate.candidateId} | ${label} | ${summary.count} | ${decimal(summary.min)} | ${decimal(summary.p05)} | ${decimal(summary.median)} | ${decimal(summary.p95)} | ${decimal(summary.max)} |`,
      )
    }
  }
  return lines
}

function renderMarkdown(
  report: RawBenchReport,
  options: MarkdownRenderOptions = {},
): string {
  const lines: string[] = [
    '# Embedding Benchmark Report',
    '',
    `Generated: ${options.generatedAt ?? report.generatedAt}`,
    '',
    `Platform: ${options.platformSummary ?? `${report.platform}/${report.arch}`}`,
    '',
    ...(options.preCorpusLines ?? []),
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
    lines.push(`| ${app} | ${totals.documents} | ${totals.recordedQueries} |`)
  }
  lines.push(
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
    '| Candidate | Model | Revision | Backend | Dim | Dtype |',
    '|---|---|---|---|---:|---|',
    ...report.candidatePins.map(
      (candidate) =>
        `| ${candidate.id} | ${candidate.model_id} | \`${candidate.revision}\` | ${candidate.backend} | ${candidate.dim} | ${candidate.dtype} |`,
    ),
    '',
    '## Recorded Slice hit@k',
    '',
    'This primary cassette-derived slice is reported independently and drives the mechanical verdict.',
    '',
    ...renderHitTable('recorded', report.benchmark),
    '',
    '## Authored Slice hit@k',
    '',
    `Provenance: ${Object.entries(report.authoredQueries.provenance)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ')}. This augmentation is never merged with the recorded slice.`,
    '',
    ...renderHitTable('authored', report.benchmark),
    '',
    '## §5.1 Constants',
    '',
    ...(options.constantsLines ?? renderConstantsTable(report.constants)),
    '',
    options.constantsNote ??
      'Each candidate was measured in its own child process. vec0 is reported only when the sqlite-vec prebuild loaded; brute-force top-k is always measured.',
    '',
    '## Cosine Distributions and τ_dense Proposals',
    '',
    '### Recorded Slice',
    '',
    ...renderDistributionTable('recorded', report.benchmark),
    '',
    '### Authored Slice',
    '',
    ...renderDistributionTable('authored', report.benchmark),
    '',
    '### Recorded Gold-Pair Calibration',
    '',
    '| Candidate profile | Recorded gold pairs | p05 | Proposed τ_dense (round down, 2 decimals) |',
    '|---|---:|---:|---:|',
    ...report.calibration.proposals.map(
      (proposal) =>
        `| ${proposal.candidateId} | ${proposal.goldPairs} | ${decimal(proposal.percentile)} | ${proposal.tauDense === null ? '—' : proposal.tauDense.toFixed(2)} |`,
    ),
    '',
    'The raw JSON retains every gold-pair and deterministic random-pair cosine for audit.',
    '',
    '## Pre-declared Decision Rule',
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
    `Floor candidate: **${report.verdict.floor.candidateId ?? 'none'}**; acceptable beyond emergency mode: **${report.verdict.floor.acceptableBeyondEmergencyMode === null ? 'indeterminate' : String(report.verdict.floor.acceptableBeyondEmergencyMode)}**; trailing recorded hit@5 gap: **${report.verdict.floor.trailingGap === null ? 'indeterminate' : `${(report.verdict.floor.trailingGap * 100).toFixed(2)} points`}**.`,
    '',
    '## D-04 Language Mix Record',
    '',
    report.languageMix,
    '',
    '## Ratification',
    '',
    ...(options.ratification === undefined ? [] : [options.ratification, '']),
  )
  return `${lines.join('\n')}\n`
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
  const report: RawBenchReport = {
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    platform,
    arch,
    inputs: options.references,
    corpusManifest: options.corpusManifest,
    authoredQueries: {
      provenance: options.authored.provenance,
      count: options.authored.queries.length,
    },
    candidatePins: options.candidates,
    benchmark: options.bench,
    constants: options.constants,
    calibration: {
      percentile: 0.05,
      rounding: 'down-to-2-decimals',
      proposals: tauProposals(options.bench),
    },
    decisionRule: DECISION_RULE,
    verdict: applyDecisionRule(options.candidates, options.bench),
    languageMix: LANGUAGE_MIX_RECORD,
  }

  await mkdir(dirname(jsonPath), { recursive: true })
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(markdownPath, renderMarkdown(report), 'utf8')
  return { jsonPath, markdownPath, report }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function validateMergeInput(
  input: MergeReportInput,
  expected: ExpectedPlatform,
  reference: RawBenchReport,
): void {
  const { report } = input
  if (report.schemaVersion !== 1) throw new Error(`${input.path} has an unknown schema`)
  if (report.platform !== expected.platform || report.arch !== expected.arch) {
    throw new Error(
      `${input.path} reports ${report.platform}/${report.arch}; expected ${expected.platform}/${expected.arch}`,
    )
  }
  for (const [label, actual, wanted] of [
    ['input references', report.inputs, reference.inputs],
    ['corpus manifest', report.corpusManifest, reference.corpusManifest],
    ['candidate pins', report.candidatePins, reference.candidatePins],
    ['document count', report.benchmark.documents, reference.benchmark.documents],
    ['query counts', report.benchmark.queries, reference.benchmark.queries],
    ['authored query provenance', report.authoredQueries, reference.authoredQueries],
    ['decision rule', report.decisionRule, DECISION_RULE],
  ] as const) {
    if (!sameJson(actual, wanted)) throw new Error(`${input.path} ${label} drifted`)
  }
  if (report.languageMix !== LANGUAGE_MIX_RECORD) {
    throw new Error(`${input.path} language-mix record drifted`)
  }
  if (report.candidatePins.length !== EXPECTED_CANDIDATE_COUNT) {
    throw new Error(`${input.path} does not contain the four locked candidate pins`)
  }
  const expectedCandidateIds = report.candidatePins.map(({ id }) => id)
  const actualCandidateIds = report.benchmark.candidates.map(
    ({ candidateId }) => candidateId,
  )
  if (!sameJson(actualCandidateIds, expectedCandidateIds)) {
    throw new Error(`${input.path} does not cover every candidate`)
  }
  for (const candidate of report.benchmark.candidates) {
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
        if (!Array.isArray(values) || values.length === 0 || values.some((value) => !Number.isFinite(value))) {
          throw new Error(
            `${input.path} has an invalid ${candidate.candidateId} ${sliceName} ${pairSet} distribution`,
          )
        }
      }
    }
  }
  if (report.constants.length !== reference.candidatePins.length) {
    throw new Error(`${input.path} does not cover every candidate constant`)
  }
  for (const candidate of reference.candidatePins) {
    const result = successfulConstant(input, candidate.id)
    if (result.platform !== report.platform || result.arch !== report.arch) {
      throw new Error(`${input.path} constants platform drifted for ${candidate.id}`)
    }
  }
  const expectedCalibration = {
    percentile: 0.05,
    rounding: 'down-to-2-decimals',
    proposals: tauProposals(report.benchmark),
  }
  if (!sameJson(report.calibration, expectedCalibration)) {
    throw new Error(`${input.path} calibration is not mechanically derived`)
  }
  if (!sameJson(report.verdict, applyDecisionRule(report.candidatePins, report.benchmark))) {
    throw new Error(`${input.path} verdict is not mechanically derived`)
  }
}

function orderMergeInputs(inputs: readonly MergeReportInput[]): MergeReportInput[] {
  if (inputs.length !== EXPECTED_PLATFORMS.length) {
    throw new Error(
      `merge requires ${EXPECTED_PLATFORMS.length} raw reports; received ${inputs.length}`,
    )
  }
  return EXPECTED_PLATFORMS.map((expected) => {
    const matches = inputs.filter(
      ({ report }) =>
        report.platform === expected.platform && report.arch === expected.arch,
    )
    if (matches.length !== 1) {
      throw new Error(
        `merge requires exactly one ${expected.platform}/${expected.arch} raw report`,
      )
    }
    return matches[0]!
  })
}

export async function mergeReports(options: MergeReportOptions): Promise<{
  markdownPath: string
  markdown: string
}> {
  const inputs = orderMergeInputs(options.inputs)
  const localReport = inputs[0]!.report
  for (let index = 0; index < inputs.length; index += 1) {
    validateMergeInput(inputs[index]!, EXPECTED_PLATFORMS[index]!, localReport)
  }
  const mergedReport: RawBenchReport = {
    ...localReport,
    calibration: {
      percentile: 0.05,
      rounding: 'down-to-2-decimals',
      proposals: tauProposals(localReport.benchmark),
    },
    decisionRule: DECISION_RULE,
    verdict: applyDecisionRule(localReport.candidatePins, localReport.benchmark),
    languageMix: LANGUAGE_MIX_RECORD,
  }
  const markdownPath = resolve(options.outputPath ?? 'REPORT.md')
  const rawReportLines = [
    '### Raw Platform Reports',
    '',
    '| Environment | Path | SHA-256 | Generated |',
    '|---|---|---|---|',
    ...inputs.map(
      (input, index) =>
        `| ${EXPECTED_PLATFORMS[index]!.label} | ${markdownCell(input.path)} | \`${input.sha256}\` | ${input.report.generatedAt} |`,
    ),
  ]
  const markdown = renderMarkdown(mergedReport, {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    platformSummary:
      'merged evidence — macos-arm64 informative; ubuntu-latest/linux-x64 and windows-latest/win-x64 canonical',
    preCorpusLines: rawReportLines,
    constantsLines: renderMergedConstantsTable(mergedReport.candidatePins, inputs),
    constantsNote:
      'Every candidate was measured in its own child process on each platform. Linux x64 and Windows x64 are the canonical §5.1 environments; macOS arm64 is informative.',
    ratification: 'Pending human review in Plan 376-11.',
  })
  await mkdir(dirname(markdownPath), { recursive: true })
  await writeFile(markdownPath, markdown, 'utf8')
  return { markdownPath, markdown }
}

function digest(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

async function readJson<T>(url: URL): Promise<{ raw: string; value: T }> {
  const raw = await readFile(url, 'utf8')
  return { raw, value: JSON.parse(raw) as T }
}

type CliOptions =
  | { mode: 'run'; outputPath?: string }
  | { mode: 'merge'; outputPath?: string; inputPaths: string[] }

function parseCliOptions(args: readonly string[]): CliOptions {
  let outputPath: string | undefined
  let merge = false
  const inputPaths: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (argument === '--') continue
    if (argument === '--merge') {
      merge = true
      continue
    }
    if (argument === '--report') {
      outputPath = args[index + 1]
      if (outputPath === undefined) throw new TypeError('--report requires a path')
      index += 1
      continue
    }
    if (argument.startsWith('--report=')) {
      outputPath = argument.slice('--report='.length)
      if (outputPath.length === 0) throw new TypeError('--report requires a path')
      continue
    }
    if (merge && !argument.startsWith('--')) {
      inputPaths.push(argument)
      continue
    }
    throw new TypeError(`unknown argument: ${argument}`)
  }
  if (!merge) return { mode: 'run', outputPath }
  if (inputPaths.length === 0) throw new TypeError('--merge requires raw report paths')
  return { mode: 'merge', outputPath, inputPaths }
}

async function runCli(): Promise<void> {
  const cli = parseCliOptions(process.argv.slice(2))
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
  const candidateInput = await readJson<BenchCandidate[]>(
    new URL('../candidates.json', import.meta.url),
  )
  const corpusInput = await readJson<import('./runner').BenchCorpus>(
    new URL('../corpus/corpus.json', import.meta.url),
  )
  const manifestInput = await readJson<CorpusManifest>(
    new URL('../corpus/corpus-manifest.json', import.meta.url),
  )
  const authoredInput = await readJson<AuthoredQueries>(
    new URL('../fixtures/authored-queries.json', import.meta.url),
  )
  if (!Array.isArray(candidateInput.value) || candidateInput.value.length === 0) {
    throw new TypeError('candidates.json must contain at least one candidate')
  }

  const runner = (await import(
    new URL('./runner.ts', import.meta.url).href
  )) as typeof import('./runner')
  const constants = (await import(
    new URL('./measure-constants.ts', import.meta.url).href
  )) as typeof import('./measure-constants')
  const bench = await runner.runBench({
    candidates: candidateInput.value,
    corpus: corpusInput.value,
    authored: authoredInput.value,
  })
  const measured = await constants.measureAllConstants(candidateInput.value)
  const emitted = await emitReport({
    outputPath: cli.outputPath,
    candidates: candidateInput.value,
    bench,
    constants: measured,
    corpusManifest: manifestInput.value,
    authored: authoredInput.value,
    references: {
      candidates: {
        path: 'tools/embedding-bench/candidates.json',
        sha256: digest(candidateInput.raw),
      },
      corpus: {
        path: 'tools/embedding-bench/corpus/corpus.json',
        sha256: digest(corpusInput.raw),
      },
      corpusManifest: {
        path: 'tools/embedding-bench/corpus/corpus-manifest.json',
        sha256: digest(manifestInput.raw),
      },
      authoredQueries: {
        path: 'tools/embedding-bench/fixtures/authored-queries.json',
        sha256: digest(authoredInput.raw),
      },
    },
  })
  process.stdout.write(
    `${JSON.stringify({ report: emitted.jsonPath, markdown: emitted.markdownPath })}\n`,
  )
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
