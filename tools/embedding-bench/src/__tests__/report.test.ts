import { link, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { STATIC_FLOOR_EMBEDDING_PROFILE } from '@vostride/agent-qa-schema'

import {
  BUNDLED_STATIC_FLOOR_ARTIFACT,
  BUNDLED_STATIC_FLOOR_ID,
  type BenchmarkConfig,
} from '../config'
import type {
  CandidateConstantsResult,
  CandidateConstantsSuccess,
} from '../measure-constants'
import {
  applyDecisionRule,
  DEFAULT_CLI_PATHS,
  decisionRuleForConfig,
  emitReport,
  mergeReports,
  parseCliOptions,
  runCli,
  type CorpusManifest,
  type RawBenchReport,
} from '../report'
import type {
  AuthoredQueries,
  BenchCandidate,
  BenchCorpus,
  BenchRunResult,
  CandidateBenchSuccess,
  HitRates,
} from '../runner'
import { candidateProfile } from '../runner'
import type { BenchmarkRuntime } from '../transformers-js-backend'

function candidate(
  id: string,
  backend: BenchCandidate['backend'],
  dim: number,
  pooling: BenchCandidate['pooling'] = 'mean',
): BenchCandidate {
  const entry: BenchCandidate = {
    id,
    model_id: `fixture/${id}`,
    backend,
    artifact: 'fixture',
    revision: '0123456789abcdef0123456789abcdef01234567',
    dtype: 'q8',
    dim,
    pooling,
    normalize: true,
    max_tokens: 512,
    query_prefix: '',
    doc_prefix: '',
  }
  if (backend === 'static') {
    return {
      ...entry,
      id: BUNDLED_STATIC_FLOOR_ID,
      model_id: STATIC_FLOOR_EMBEDDING_PROFILE.model_id,
      artifact: BUNDLED_STATIC_FLOOR_ARTIFACT,
      revision: STATIC_FLOOR_EMBEDDING_PROFILE.revision,
      dim: STATIC_FLOOR_EMBEDDING_PROFILE.dim,
      pooling: STATIC_FLOOR_EMBEDDING_PROFILE.pooling,
      max_tokens: null,
    }
  }
  return entry
}

const candidates = [
  candidate('control', 'node', 384),
  candidate('wide-alternate', 'node', 768, 'cls'),
  candidate('compact-alternate', 'node', 256, 'cls'),
  candidate('fallback', 'static', 512),
]

const config: BenchmarkConfig = {
  schemaVersion: 1,
  baselineCandidateId: 'control',
  floorCandidateId: BUNDLED_STATIC_FLOOR_ID,
  selection: {
    minimumRecordedHitAt5Gain: 0.05,
    requireRecordedHitAt1NonRegression: true,
    maximumFloorHitAt5Gap: 0.1,
  },
  performance: {
    singleDocumentSamples: 7,
    concurrentDocumentSamples: 11,
    concurrency: 3,
    topK: 5,
    topKIterations: 13,
  },
  languageMix: 'Fixture English and Japanese queries; both slices reviewed.',
}

function runtime(cpuModel = 'Fixture CPU'): BenchmarkRuntime {
  return {
    engine: '@huggingface/transformers',
    transformersJsVersion: '4.2.0',
    pipeline: 'feature-extraction',
    device: 'cpu',
    nodeVersion: 'v24.15.0',
    osRelease: 'fixture-release',
    cpuModel,
    logicalCpuCount: 8,
    totalMemoryBytes: 16 * 1024 * 1024 * 1024,
  }
}

function rates(hitAt1: number, hitAt5: number): HitRates {
  return { queries: 10, hitAt1, hitAt3: hitAt1, hitAt5 }
}

function success(
  entry: BenchCandidate,
  hitAt1: number,
  hitAt5: number,
): CandidateBenchSuccess {
  const recorded = rates(hitAt1, hitAt5)
  const authored = rates(
    Math.floor((hitAt1 / 2) * 10) / 10,
    Math.floor((hitAt5 / 2) * 10) / 10,
  )
  return {
    candidateId: entry.id,
    status: 'ok',
    profile: candidateProfile(entry),
    slices: {
      recorded: { perApp: { fixture: recorded }, macro: recorded },
      authored: { perApp: { fixture: authored }, macro: authored },
    },
    distributions: {
      recorded: {
        goldPairCosines: Array.from(
          { length: 10 },
          (_, index) => 0.601 + index * 0.01,
        ),
        randomPairCosines: [0.1, 0.2, 0.3],
      },
      authored: {
        goldPairCosines: Array.from(
          { length: 10 },
          (_, index) => 0.5 + index * 0.01,
        ),
        randomPairCosines: [0.05, 0.1],
      },
    },
  }
}

function bench(entries: readonly BenchCandidate[] = candidates): BenchRunResult {
  const metrics = new Map<string, readonly [number, number]>([
    ['control', [0.5, 0.6]],
    ['wide-alternate', [0.5, 0.7]],
    ['compact-alternate', [0.4, 0.9]],
    [BUNDLED_STATIC_FLOOR_ID, [0.4, 0.6]],
  ])
  return {
    schemaVersion: 1,
    documents: 20,
    queries: { recorded: 10, authored: 10 },
    candidates: entries.map((entry) => {
      const [hitAt1, hitAt5] = metrics.get(entry.id) ?? [0.5, 0.5]
      return success(entry, hitAt1, hitAt5)
    }),
  }
}

const manifest: CorpusManifest = {
  builderVersion: 'fixture',
  totals: { documents: 20, recordedQueries: 10, sourceCassettes: 2 },
  perApp: { fixture: { documents: 20, recordedQueries: 10 } },
  sources: [
    {
      path: 'fixture-0/cassette.json',
      sha256: 'e'.repeat(64),
      apps: ['fixture'],
      granularity: 'leaf',
      kind: 'fixture',
    },
    {
      path: 'fixture-1/cassette.json',
      sha256: 'f'.repeat(64),
      apps: ['fixture'],
      granularity: 'procedure',
      kind: 'fixture',
    },
  ],
}

const corpus: BenchCorpus = {
  documents: Array.from({ length: 20 }, (_, index) => ({
    id: `document-${index}`,
    kind: 'element' as const,
    text: `fixture document ${index}`,
    apps: ['fixture'],
    sourcePaths: [`fixture-${index % 2}/cassette.json`],
  })),
  recordedQueries: Array.from({ length: 10 }, (_, index) => ({
    id: `recorded-${index}`,
    app: 'fixture',
    query: `recorded query ${index}`,
    goldDocIds: [`document-${index}`],
    sourceCassetteId: `cassette-${index % 2}`,
    sourcePath: `fixture-${index % 2}/cassette.json`,
  })),
}

const authored: AuthoredQueries = {
  provenance: { slice: 'authored', reviewStatus: 'fixture' },
  queries: Array.from({ length: 10 }, (_, index) => ({
    app: 'fixture',
    query: `authored query ${index}`,
    goldDocIds: [`document-${index}`],
    category: 'fixture',
  })),
}

function constants(
  platform: NodeJS.Platform,
  arch: string,
  entries: readonly BenchCandidate[] = candidates,
): CandidateConstantsSuccess[] {
  return entries.map((entry, index) => ({
    candidateId: entry.id,
    status: 'ok',
    platform,
    arch,
    sample: {
      singleDocuments: 7,
      concurrentDocuments: 11,
      concurrency: 3,
      topKDocuments: 11,
      topK: 5,
      topKIterations: 13,
    },
    timeToFirstEmbeddingMs: 10 + index,
    singleDocumentDocsPerSecond: 20 + index,
    singleDocumentLatencyMs: { p50: 2 + index, p95: 4 + index },
    concurrentDocsPerSecond: 30 + index,
    rssBaselineBytes: (40 + index) * 1024 * 1024,
    rssPeakBytes: (50 + index) * 1024 * 1024,
    rssDeltaBytes: 10 * 1024 * 1024,
    vectorBytesPerDocument: entry.dim * Float32Array.BYTES_PER_ELEMENT,
    bruteTopKMs: 0.1 + index,
    vec0TopKMs: 0.2 + index,
  }))
}

const references = {
  config: { path: 'benchmark.config.json', sha256: '0'.repeat(64) },
  candidates: { path: 'candidates.json', sha256: 'a'.repeat(64) },
  corpus: { path: 'corpus.json', sha256: 'b'.repeat(64) },
  corpusManifest: { path: 'corpus-manifest.json', sha256: 'c'.repeat(64) },
  authoredQueries: { path: 'authored-queries.json', sha256: 'd'.repeat(64) },
}

async function emitFixture(
  directory: string,
  platform: NodeJS.Platform,
  arch: string,
  measured: readonly CandidateConstantsResult[] = constants(platform, arch),
  benchmark: BenchRunResult = bench(),
  fixtureManifest: CorpusManifest = manifest,
  fixtureCorpus: BenchCorpus = corpus,
): Promise<RawBenchReport> {
  const emitted = await emitReport({
    outputPath: join(directory, `${platform}-${arch}.json`),
    platform,
    arch,
    generatedAt: '2026-08-29T00:00:00.000Z',
    config,
    runtime: runtime(`${platform} CPU`),
    execution: { network: 'offline-cache-only', performance: 'measured' },
    candidates,
    corpus: fixtureCorpus,
    bench: benchmark,
    constants: measured,
    corpusManifest: fixtureManifest,
    authored,
    references,
  })
  return emitted.report
}

describe('embedding bench report', () => {
  it('applies configured gates, floor policy, and arbitrary candidate dimensions', () => {
    const verdict = applyDecisionRule(candidates, bench(), config)

    expect(verdict.selectedDefaultCandidateId).toBe('wide-alternate')
    expect(verdict.bestRecordedHitAt5CandidateId).toBe('compact-alternate')
    expect(verdict.qualifyingAlternateIds).toEqual(['wide-alternate'])
    expect(verdict.floor.acceptableBeyondEmergencyMode).toBe(true)
    expect(verdict.floor.trailingGap).toBeCloseTo(0.1)
    expect(verdict.costConsequences).toContain('wide-alternate: 768 dimensions')
    expect(verdict.costConsequences).toContain('2× baseline')
    expect(verdict.costConsequences).toContain('compact-alternate: 256 dimensions')
    expect(verdict.deploymentConsequences).toContain('cls pooling')
    expect(verdict.deploymentConsequences).toContain('512-token cap')
  })

  it('derives decision prose and outcomes from changed policy rather than constants', () => {
    const changed: BenchmarkConfig = {
      ...config,
      floorCandidateId: null,
      selection: {
        ...config.selection,
        minimumRecordedHitAt5Gain: 0.25,
        requireRecordedHitAt1NonRegression: false,
      },
    }
    const selectedCandidates = [candidates[0]!, candidates[2]!]
    const verdict = applyDecisionRule(
      selectedCandidates,
      bench(selectedCandidates),
      changed,
    )
    const policy = decisionRuleForConfig(changed).join('\n')

    expect(verdict.selectedDefaultCandidateId).toBe('compact-alternate')
    expect(verdict.floor.candidateId).toBeNull()
    expect(policy).toContain('25.00 absolute points')
    expect(policy).toContain('hit@1 is reported but is not a selection gate')
    expect(policy).toContain('No floor candidate is configured')
    expect(policy).not.toContain('bge-small')
  })

  it('never promotes a static degradation floor when floor evaluation is disabled', () => {
    const withoutFloorPolicy: BenchmarkConfig = {
      ...config,
      floorCandidateId: null,
      selection: {
        ...config.selection,
        minimumRecordedHitAt5Gain: 0.01,
        requireRecordedHitAt1NonRegression: false,
      },
    }
    const selectedCandidates = [candidates[0]!, candidates[3]!]

    const verdict = applyDecisionRule(
      selectedCandidates,
      bench(selectedCandidates),
      withoutFloorPolicy,
    )

    expect(verdict.selectedDefaultCandidateId).toBe('control')
    expect(verdict.qualifyingAlternateIds).toEqual([])
  })

  it('is indeterminate when a filtered run omits the configured baseline', () => {
    const selectedCandidates = [candidates[2]!]
    const verdict = applyDecisionRule(
      selectedCandidates,
      bench(selectedCandidates),
      config,
    )

    expect(verdict.status).toBe('indeterminate')
    expect(verdict.selectedDefaultCandidateId).toBeNull()
    expect(verdict.costConsequences).toContain('baseline pin control was not included')
  })

  it('is indeterminate when any selected candidate lacks successful evidence', () => {
    const incomplete = bench()
    incomplete.candidates[1] = {
      candidateId: 'wide-alternate',
      status: 'error',
      error: { name: 'Error', message: 'offline cache miss' },
    }

    const verdict = applyDecisionRule(candidates, incomplete, config)

    expect(verdict.status).toBe('indeterminate')
    expect(verdict.selectedDefaultCandidateId).toBeNull()
    expect(verdict.rationale).toContain('wide-alternate')
    expect(verdict.deploymentConsequences).toContain('No deployment recommendation')
  })

  it('makes a measured run indeterminate when performance evidence is incomplete', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'embedding-bench-report-'))
    try {
      const measured: CandidateConstantsResult[] = constants('linux', 'x64')
      measured[1] = {
        candidateId: 'wide-alternate',
        status: 'error',
        platform: 'linux',
        arch: 'x64',
        error: { name: 'Error', message: 'out of memory' },
      }

      const raw = await emitFixture(directory, 'linux', 'x64', measured)

      expect(raw.verdict.status).toBe('indeterminate')
      expect(raw.verdict.selectedDefaultCandidateId).toBeNull()
      expect(raw.verdict.rationale).toContain('wide-alternate')
      expect(raw.verdict.rationale).toContain('performance result')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects quality evidence that does not match its pin or metric schema', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'embedding-bench-quality-schema-'))
    try {
      const profileDrift = bench()
      const drifted = profileDrift.candidates[0]
      if (drifted?.status !== 'ok') throw new Error('expected fixture success')
      drifted.profile.revision = 'f'.repeat(40)
      await expect(
        emitFixture(
          directory,
          'linux',
          'x64',
          constants('linux', 'x64'),
          profileDrift,
        ),
      ).rejects.toThrow('benchmark profile does not match pin control')

      const invalidRates = bench()
      const invalid = invalidRates.candidates[0]
      if (invalid?.status !== 'ok') throw new Error('expected fixture success')
      invalid.slices.recorded.macro.queries = 0.5
      await expect(
        emitFixture(
          directory,
          'linux',
          'x64',
          constants('linux', 'x64'),
          invalidRates,
        ),
      ).rejects.toThrow(
        /candidate result\.slices\.recorded\..*\.queries must be a safe integer/u,
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('binds every manifest source and app to the benchmark corpus', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'embedding-bench-provenance-'))
    try {
      const unrelated = structuredClone(manifest)
      unrelated.sources[0] = {
        ...unrelated.sources[0]!,
        path: 'unrelated/cassette.json',
        sha256: '9'.repeat(64),
        apps: ['unrelated-app'],
      }
      await expect(
        emitFixture(
          directory,
          'linux',
          'x64',
          constants('linux', 'x64'),
          bench(),
          unrelated,
        ),
      ).rejects.toThrow('references source missing from manifest')

      const duplicate = structuredClone(manifest)
      duplicate.sources[1]!.path = duplicate.sources[0]!.path
      await expect(
        emitFixture(
          directory,
          'linux',
          'x64',
          constants('linux', 'x64'),
          bench(),
          duplicate,
        ),
      ).rejects.toThrow('corpus manifest source path is duplicated')

      const extraSourceApp = structuredClone(manifest)
      extraSourceApp.sources[0]!.apps.push('unrelated-app')
      await expect(
        emitFixture(
          directory,
          'linux',
          'x64',
          constants('linux', 'x64'),
          bench(),
          extraSourceApp,
        ),
      ).rejects.toThrow('app unrelated-app is not evidenced by the corpus')

      const perAppDrift = bench()
      const driftedCandidate = perAppDrift.candidates[0]
      if (driftedCandidate?.status !== 'ok') throw new Error('expected fixture success')
      const driftedRates = { queries: 5, hitAt1: 0.4, hitAt3: 0.4, hitAt5: 0.6 }
      driftedCandidate.slices.recorded = {
        perApp: {
          fixture: driftedRates,
          unrelated: { ...driftedRates },
        },
        macro: { queries: 10, hitAt1: 0.4, hitAt3: 0.4, hitAt5: 0.6 },
      }
      await expect(
        emitFixture(
          directory,
          'linux',
          'x64',
          constants('linux', 'x64'),
          perAppDrift,
        ),
      ).rejects.toThrow('recorded per-app query counts do not match report provenance')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('renders effective samples separately from requested performance settings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'embedding-bench-report-'))
    try {
      const measured = constants('linux', 'x64')
      measured[0] = {
        ...measured[0]!,
        sample: {
          singleDocuments: 2,
          concurrentDocuments: 3,
          concurrency: 2,
          topKDocuments: 3,
          topK: 3,
          topKIterations: 13,
        },
      }

      await emitFixture(directory, 'linux', 'x64', measured)
      const markdown = await readFile(join(directory, 'REPORT.md'), 'utf8')

      expect(markdown).toContain('Requested performance samples: 7 single-document')
      expect(markdown).toContain('### Effective Performance Samples')
      expect(markdown).toContain('| control | 2 | 3 | 2 | 3 | 3 | 13 |')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('writes schema-v2 config/runtime evidence and says when performance was skipped', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'embedding-bench-report-'))
    try {
      const outputPath = join(directory, 'bench-report-fixture.json')
      const emitted = await emitReport({
        outputPath,
        platform: 'linux',
        arch: 'arm64',
        generatedAt: '2026-08-29T00:00:00.000Z',
        config,
        runtime: runtime(),
        execution: { network: 'offline-cache-only', performance: 'skipped' },
        candidates,
        corpus,
        bench: bench(),
        constants: [],
        corpusManifest: manifest,
        authored,
        references,
      })
      const markdown = await readFile(emitted.markdownPath, 'utf8')
      const raw = JSON.parse(await readFile(emitted.jsonPath, 'utf8')) as RawBenchReport

      expect(raw.schemaVersion).toBe(2)
      expect(raw.config).toEqual(config)
      expect(raw.runtime.transformersJsVersion).toBe('4.2.0')
      expect(raw.execution).toEqual({
        network: 'offline-cache-only',
        performance: 'skipped',
      })
      expect(raw.inputs.config).toEqual(references.config)
      expect(raw.calibration.proposals[0]?.tauDense).toBe(0.6)
      expect(markdown).toContain('## Runtime')
      expect(markdown).toContain('4.2.0')
      expect(markdown).toContain('v24.15.0')
      expect(markdown).toContain('cpu / feature-extraction')
      expect(markdown).toContain('offline-cache-only')
      expect(markdown).toContain('## Configuration and Policy')
      expect(markdown).toContain(config.languageMix)
      expect(markdown).toContain('| wide-alternate | fixture/wide-alternate |')
      expect(markdown).toContain('| node | cls | 768 |')
      expect(markdown).toContain('Performance measurements were skipped')
      expect(markdown).toContain('## Quality')
      expect(markdown).toContain('## Calibration')
      expect(markdown).not.toContain('Phase 376')
      expect(markdown).not.toContain('## Ratification')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects report paths that could overwrite Markdown or benchmark inputs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'embedding-bench-output-path-'))
    try {
      await expect(
        emitReport({
          outputPath: join(directory, 'REPORT.md'),
          platform: 'linux',
          arch: 'x64',
          config,
          runtime: runtime(),
          execution: { network: 'offline-cache-only', performance: 'skipped' },
          candidates,
          corpus,
          bench: bench(),
          constants: [],
          corpusManifest: manifest,
          authored,
          references,
        }),
      ).rejects.toThrow('must use a .json filename')

      await expect(
        runCli(['--report', DEFAULT_CLI_PATHS.candidatesPath]),
      ).rejects.toThrow('would overwrite candidates input')

      const candidatesInput = join(directory, 'candidate-input.json')
      const hardlinkedOutput = join(directory, 'hardlinked-output.json')
      await writeFile(candidatesInput, '[]\n', 'utf8')
      await link(candidatesInput, hardlinkedOutput)
      await expect(
        runCli([
          '--candidates',
          candidatesInput,
          '--report',
          hardlinkedOutput,
        ]),
      ).rejects.toThrow('would overwrite candidates input')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects merge output hardlinked to a raw input report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'embedding-bench-merge-alias-'))
    try {
      const rawPath = join(directory, 'linux-x64.json')
      const linux = await emitFixture(directory, 'linux', 'x64')
      const outputPath = join(directory, 'merged.md')
      await link(rawPath, outputPath)

      await expect(
        mergeReports({
          outputPath,
          inputs: [{ path: rawPath, sha256: '1'.repeat(64), report: linux }],
        }),
      ).rejects.toThrow('merge output would overwrite input report')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('merges any nonempty unique platform set in deterministic order', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'embedding-bench-merge-'))
    try {
      const linux = await emitFixture(directory, 'linux', 'x64')
      const darwin = await emitFixture(directory, 'darwin', 'arm64')
      linux.inputs.corpus.path = 'D:\\embedding-bench\\corpus.json'
      const merged = await mergeReports({
        outputPath: join(directory, 'reports', 'REPORT.md'),
        generatedAt: '2026-08-29T00:01:00.000Z',
        inputs: [
          { path: 'linux.json', sha256: '1'.repeat(64), report: linux },
          { path: 'darwin.json', sha256: '2'.repeat(64), report: darwin },
        ],
      })

      expect(merged.markdown.indexOf('darwin/arm64')).toBeLessThan(
        merged.markdown.indexOf('linux/x64'),
      )
      expect(merged.markdown).toContain('merged evidence — darwin/arm64, linux/x64')
      expect(merged.markdown).toContain('darwin CPU')
      expect(merged.markdown).toContain('linux CPU')
      expect(merged.markdown).toContain('D:\\embedding-bench\\corpus.json')
      expect(merged.markdown).toContain('Single p50 ms')
      expect(merged.markdown).toContain('Single p95 ms')
      expect(merged.markdown).toContain('Sample: concurrent documents')
      expect(merged.markdown).toContain('Sample: concurrency')
      expect(merged.markdown).toContain('Concurrent docs/s')
      expect(merged.markdown).toContain('RSS baseline MiB')
      expect(merged.markdown).toContain('RSS peak MiB')
      expect(merged.markdown).toContain('RSS delta MiB')
      expect(merged.markdown).toContain('Vector bytes/doc')
      expect(merged.markdown).not.toContain('canonical')
      expect(merged.markdown).not.toContain('Plan 376')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects empty, duplicate, unsuccessful, and identity-drifted merges', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'embedding-bench-invalid-'))
    try {
      await expect(mergeReports({ inputs: [] })).rejects.toThrow(
        'at least one raw report',
      )

      const darwin = await emitFixture(directory, 'darwin', 'arm64')
      await expect(
        mergeReports({
          inputs: [
            { path: 'one.json', sha256: '1'.repeat(64), report: darwin },
            { path: 'two.json', sha256: '2'.repeat(64), report: darwin },
          ],
        }),
      ).rejects.toThrow('duplicate darwin/arm64')

      const noConstants = await emitFixture(directory, 'linux', 'x64', [])
      await expect(
        mergeReports({
          inputs: [
            { path: 'darwin.json', sha256: '1'.repeat(64), report: darwin },
            { path: 'linux.json', sha256: '2'.repeat(64), report: noConstants },
          ],
        }),
      ).rejects.toThrow('does not cover every candidate constant')

      const linux = await emitFixture(directory, 'linux', 'x64')
      await expect(
        mergeReports({
          outputPath: join(directory, 'linux-x64.json'),
          inputs: [
            {
              path: join(directory, 'linux-x64.json'),
              sha256: '2'.repeat(64),
              report: linux,
            },
          ],
        }),
      ).rejects.toThrow('would overwrite input report')

      const skippedPerformance = structuredClone(linux)
      skippedPerformance.execution.performance = 'skipped'
      await expect(
        mergeReports({
          inputs: [
            { path: 'darwin.json', sha256: '1'.repeat(64), report: darwin },
            { path: 'linux.json', sha256: '2'.repeat(64), report: skippedPerformance },
          ],
        }),
      ).rejects.toThrow('skipped performance measurements')

      const sampleDrift = structuredClone(linux)
      const sampleResult = sampleDrift.constants[0]
      if (sampleResult?.status !== 'ok') throw new Error('expected fixture success')
      sampleResult.sample.singleDocuments = 1
      await expect(
        mergeReports({
          inputs: [
            { path: 'darwin.json', sha256: '1'.repeat(64), report: darwin },
            { path: 'linux.json', sha256: '2'.repeat(64), report: sampleDrift },
          ],
        }),
      ).rejects.toThrow('constants sample drifted')

      const rssDrift = structuredClone(linux)
      const rssResult = rssDrift.constants[0]
      if (rssResult?.status !== 'ok') throw new Error('expected fixture success')
      rssResult.rssDeltaBytes += 1
      await expect(
        mergeReports({
          inputs: [
            { path: 'darwin.json', sha256: '1'.repeat(64), report: darwin },
            { path: 'linux.json', sha256: '2'.repeat(64), report: rssDrift },
          ],
        }),
      ).rejects.toThrow('inconsistent control RSS constants')

      const runtimeDrift = structuredClone(linux)
      runtimeDrift.runtime.transformersJsVersion = '5.0.0'
      await expect(
        mergeReports({
          inputs: [
            { path: 'darwin.json', sha256: '1'.repeat(64), report: darwin },
            { path: 'linux.json', sha256: '2'.repeat(64), report: runtimeDrift },
          ],
        }),
      ).rejects.toThrow('runtime Transformers.js version drifted')

      const invalidBaseline = structuredClone(linux)
      invalidBaseline.config.baselineCandidateId = 'unknown-baseline'
      await expect(
        mergeReports({
          inputs: [
            { path: 'linux.json', sha256: '2'.repeat(64), report: invalidBaseline },
          ],
        }),
      ).rejects.toThrow('references unknown candidate')

      const manifestCountDrift = structuredClone(linux)
      manifestCountDrift.corpusManifest.totals.documents += 1
      await expect(
        mergeReports({
          inputs: [
            { path: 'linux.json', sha256: '2'.repeat(64), report: manifestCountDrift },
          ],
        }),
      ).rejects.toThrow('corpus manifest totals do not match benchmark counts')

      const authoredCountDrift = structuredClone(linux)
      authoredCountDrift.authoredQueries.count += 1
      await expect(
        mergeReports({
          inputs: [
            { path: 'linux.json', sha256: '2'.repeat(64), report: authoredCountDrift },
          ],
        }),
      ).rejects.toThrow('authored-query count does not match benchmark counts')

      const authoredAppDrift = structuredClone(linux)
      authoredAppDrift.authoredQueries.perApp = { unrelated: 10 }
      await expect(
        mergeReports({
          inputs: [
            { path: 'linux.json', sha256: '2'.repeat(64), report: authoredAppDrift },
          ],
        }),
      ).rejects.toThrow('authored-query app unrelated is absent from the corpus manifest')

      const candidateDrift = structuredClone(linux)
      candidateDrift.candidatePins[1]!.model_id = 'fixture/different-pin'
      await expect(
        mergeReports({
          inputs: [
            { path: 'darwin.json', sha256: '1'.repeat(64), report: darwin },
            { path: 'linux.json', sha256: '2'.repeat(64), report: candidateDrift },
          ],
        }),
      ).rejects.toThrow('benchmark profile does not match pin wide-alternate')

      const qualityDrift = structuredClone(linux)
      const qualityCandidate = qualityDrift.benchmark.candidates[0]
      if (qualityCandidate?.status !== 'ok') throw new Error('expected fixture success')
      qualityCandidate.slices.recorded.macro.hitAt5 = 0.7
      await expect(
        mergeReports({
          inputs: [
            { path: 'darwin.json', sha256: '1'.repeat(64), report: darwin },
            { path: 'linux.json', sha256: '2'.repeat(64), report: qualityDrift },
          ],
        }),
      ).rejects.toThrow('quality evidence drifted across platforms')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('parses run paths, candidate filters, performance, and offline flags', () => {
    const parsed = parseCliOptions([
      'run',
      '--config=config.json',
      '--candidates',
      'models.json',
      '--corpus',
      'custom-corpus.json',
      '--corpus-manifest=manifest.json',
      '--authored-queries',
      'queries.json',
      '--candidate',
      'one',
      '--candidate=two',
      '--no-baseline',
      '--accuracy-only',
      '--offline',
      '--report',
      'raw.json',
    ])

    expect(parsed).toMatchObject({
      mode: 'run',
      configPath: 'config.json',
      candidatesPath: 'models.json',
      corpusPath: 'custom-corpus.json',
      corpusManifestPath: 'manifest.json',
      authoredQueriesPath: 'queries.json',
      candidateIds: ['one', 'two'],
      includeBaseline: false,
      accuracyOnly: true,
      allowDownload: false,
      outputPath: 'raw.json',
    })
  })

  it('parses all modes, compatibility aliases, defaults, and merge inputs', () => {
    const defaults = parseCliOptions([])
    expect(defaults.mode).toBe('run')
    expect(defaults.configPath).toMatch(/benchmark\.config\.json$/u)
    expect(defaults.candidatesPath).toMatch(/candidates\.json$/u)
    expect(defaults.includeBaseline).toBe(true)
    expect(defaults.allowDownload).toBe(true)

    expect(parseCliOptions(['list']).mode).toBe('list')
    expect(parseCliOptions(['--validate']).mode).toBe('validate')
    expect(
      parseCliOptions(['--merge', '--report=REPORT.md', 'b.json', 'a.json']),
    ).toMatchObject({
      mode: 'merge',
      outputPath: 'REPORT.md',
      inputPaths: ['b.json', 'a.json'],
    })
    expect(() => parseCliOptions(['merge'])).toThrow('requires raw report paths')
    expect(() => parseCliOptions(['run', '--wat'])).toThrow('unknown argument')
    expect(() => parseCliOptions(['--report'])).toThrow('--report requires a value')
    expect(() => parseCliOptions(['list', 'unexpected.json'])).toThrow(
      'unexpected positional argument',
    )
  })
})
