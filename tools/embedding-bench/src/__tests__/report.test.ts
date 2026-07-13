import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  applyDecisionRule,
  DECISION_RULE,
  emitReport,
  mergeReports,
  type CorpusManifest,
} from '../report'
import type { CandidateConstantsSuccess } from '../measure-constants'
import type {
  AuthoredQueries,
  BenchCandidate,
  BenchRunResult,
  CandidateBenchSuccess,
  HitRates,
} from '../runner'

function candidate(
  id: string,
  backend: BenchCandidate['backend'],
  dim: number,
): BenchCandidate {
  return {
    id,
    model_id: `fixture/${id}`,
    backend,
    artifact: 'fixture',
    revision: '0123456789abcdef0123456789abcdef01234567',
    dtype: 'q8',
    dim,
    pooling: 'mean',
    normalize: true,
    query_prefix: '',
    doc_prefix: '',
  }
}

const candidates = [
  candidate('bge-small-en-v1.5', 'node', 384),
  candidate('gte-modernbert-base', 'node', 768),
  candidate('granite-embedding-small-english-r2', 'node', 384),
  candidate('potion-retrieval-32m-static-floor', 'static', 512),
]

function rates(hitAt1: number, hitAt5: number): HitRates {
  return { queries: 10, hitAt1, hitAt3: hitAt1, hitAt5 }
}

function success(
  entry: BenchCandidate,
  hitAt1: number,
  hitAt5: number,
): CandidateBenchSuccess {
  const recorded = rates(hitAt1, hitAt5)
  const authored = rates(hitAt1 / 2, hitAt5 / 2)
  return {
    candidateId: entry.id,
    status: 'ok',
    profile: {
      model_id: entry.model_id,
      revision: entry.revision,
      dtype: entry.dtype,
      dim: entry.dim,
      pooling: entry.pooling,
      normalize: entry.normalize,
      query_prefix: entry.query_prefix,
      doc_prefix: entry.doc_prefix,
      backend: entry.backend,
      session_options: {},
      tau_dense: 0.6,
    },
    slices: {
      recorded: { perApp: { fixture: recorded }, macro: recorded },
      authored: { perApp: { fixture: authored }, macro: authored },
    },
    distributions: {
      recorded: {
        goldPairCosines: [0.601, 0.611, 0.7],
        randomPairCosines: [0.1, 0.2, 0.3],
      },
      authored: {
        goldPairCosines: [0.5, 0.6],
        randomPairCosines: [0.05, 0.1],
      },
    },
  }
}

function bench(): BenchRunResult {
  return {
    schemaVersion: 1,
    documents: 20,
    queries: { recorded: 10, authored: 10 },
    candidates: [
      success(candidates[0]!, 0.5, 0.6),
      success(candidates[1]!, 0.5, 0.63),
      success(candidates[2]!, 0.49, 0.9),
      success(candidates[3]!, 0.4, 0.53),
    ],
  }
}

const manifest: CorpusManifest = {
  builderVersion: 'fixture',
  totals: { documents: 20, recordedQueries: 10, sourceCassettes: 2 },
  perApp: { fixture: { documents: 20, recordedQueries: 10 } },
  sources: [],
}

const authored: AuthoredQueries = {
  provenance: { slice: 'authored', reviewStatus: 'fixture' },
  queries: [],
}

function constants(
  platform: NodeJS.Platform,
  arch: string,
): CandidateConstantsSuccess[] {
  return candidates.map((entry, index) => ({
    candidateId: entry.id,
    status: 'ok',
    platform,
    arch,
    sample: {
      singleDocuments: 20,
      batchedDocuments: 200,
      batchSize: 16,
      topKDocuments: 200,
      topK: 5,
      topKIterations: 25,
    },
    warmModelLoadMs: 10 + index,
    singleDocumentDocsPerSecond: 20 + index,
    batchedDocsPerSecond: 30 + index,
    rssBytes: (40 + index) * 1024 * 1024,
    bruteTopKMs: 0.1 + index,
    vec0TopKMs: 0.2 + index,
  }))
}

const references = {
  candidates: { path: 'candidates.json', sha256: 'a'.repeat(64) },
  corpus: { path: 'corpus.json', sha256: 'b'.repeat(64) },
  corpusManifest: { path: 'corpus-manifest.json', sha256: 'c'.repeat(64) },
  authoredQueries: { path: 'authored-queries.json', sha256: 'd'.repeat(64) },
}

describe('embedding bench report', () => {
  it('applies both displacement margins and the floor gap mechanically', () => {
    const verdict = applyDecisionRule(candidates, bench())

    expect(verdict.selectedDefaultCandidateId).toBe('gte-modernbert-base')
    expect(verdict.qualifyingAlternateIds).toEqual(['gte-modernbert-base'])
    expect(verdict.floor.acceptableBeyondEmergencyMode).toBe(true)
    expect(verdict.floor.trailingGap).toBeCloseTo(0.1)
  })

  it('keeps bge-small when no alternate clears the hit@5 margin', () => {
    const result = bench()
    result.candidates[1] = success(candidates[1]!, 0.9, 0.629)
    result.candidates[2] = success(candidates[2]!, 0.9, 0.6)

    expect(applyDecisionRule(candidates, result).selectedDefaultCandidateId).toBe(
      'bge-small-en-v1.5',
    )
  })

  it('writes auditable JSON and separate recorded/authored markdown sections', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'embedding-bench-report-'))
    try {
      const outputPath = join(directory, 'bench-report-fixture.json')
      const emitted = await emitReport({
        outputPath,
        platform: 'fixture-os',
        arch: 'fixture-arch',
        generatedAt: '2026-07-14T00:00:00.000Z',
        candidates,
        bench: bench(),
        constants: [],
        corpusManifest: manifest,
        authored,
        references,
      })
      const markdown = await readFile(emitted.markdownPath, 'utf8')
      const raw = JSON.parse(await readFile(emitted.jsonPath, 'utf8')) as {
        decisionRule: string[]
        calibration: { proposals: Array<{ tauDense: number }> }
      }

      expect(markdown.indexOf('## Recorded Slice hit@k')).toBeLessThan(
        markdown.indexOf('## Authored Slice hit@k'),
      )
      for (const rule of DECISION_RULE) expect(markdown).toContain(rule)
      expect(raw.decisionRule).toEqual(DECISION_RULE)
      expect(raw.calibration.proposals[0]?.tauDense).toBe(0.6)
      expect(markdown).toMatch(/## Ratification\n\s*$/u)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('merges exactly the informative macOS and canonical Linux/Windows reports', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'embedding-bench-merge-'))
    try {
      const platforms = [
        { platform: 'darwin', arch: 'arm64', file: 'bench-report-macos-arm64.json' },
        { platform: 'linux', arch: 'x64', file: 'bench-report-ubuntu-latest.json' },
        { platform: 'win32', arch: 'x64', file: 'bench-report-windows-latest.json' },
      ] as const
      const inputs = await Promise.all(
        platforms.map(async ({ platform, arch, file }, index) => {
          const emitted = await emitReport({
            outputPath: join(directory, file),
            platform,
            arch,
            generatedAt: `2026-07-14T00:00:0${index}.000Z`,
            candidates,
            bench: bench(),
            constants: constants(platform, arch),
            corpusManifest: manifest,
            authored,
            references,
          })
          return { path: file, sha256: String(index).repeat(64), report: emitted.report }
        }),
      )
      const merged = await mergeReports({
        outputPath: join(directory, 'reports', 'REPORT.md'),
        generatedAt: '2026-07-14T00:01:00.000Z',
        inputs,
      })

      expect(merged.markdown).toContain('macos-arm64 (informative)')
      expect(merged.markdown).toContain('ubuntu-latest/linux-x64 (canonical)')
      expect(merged.markdown).toContain('windows-latest/win-x64 (canonical)')
      expect(merged.markdown).toContain('## Recorded Slice hit@k')
      expect(merged.markdown).toContain('## Authored Slice hit@k')
      expect(merged.markdown).toContain('## Cosine Distributions and τ_dense Proposals')
      expect(merged.markdown).toContain('Pending human review in Plan 376-11.')
      for (const rule of DECISION_RULE) expect(merged.markdown).toContain(rule)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('refuses to merge when a canonical platform report is absent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'embedding-bench-missing-'))
    try {
      const local = await emitReport({
        outputPath: join(directory, 'bench-report-missing-platform.json'),
        platform: 'darwin',
        arch: 'arm64',
        generatedAt: '2026-07-14T00:00:00.000Z',
        candidates,
        bench: bench(),
        constants: constants('darwin', 'arm64'),
        corpusManifest: manifest,
        authored,
        references,
      })

      await expect(
        mergeReports({
          inputs: [
            { path: 'macos.json', sha256: 'a'.repeat(64), report: local.report },
          ],
        }),
      ).rejects.toThrow('merge requires 3 raw reports')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
