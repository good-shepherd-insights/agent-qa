import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'
import { STATIC_FLOOR_EMBEDDING_PROFILE } from '@vostride/agent-qa-schema'

import {
  BUNDLED_STATIC_FLOOR_ARTIFACT,
  BUNDLED_STATIC_FLOOR_ID,
  parseBenchmarkConfig,
  parseBenchmarkConfigJson,
  parseCandidates,
  parseCandidatesJson,
  selectCandidates,
  validateBenchmarkConfigReferences,
  type BenchmarkConfig,
} from '../config'
import type { BenchCandidate } from '../runner'

function candidate(
  id: string,
  backend: BenchCandidate['backend'] = 'node',
): BenchCandidate {
  const entry: BenchCandidate = {
    id,
    model_id: `fixture/${id}`,
    backend,
    artifact: backend === 'node' ? 'hugging-face-hub' : `assets/${id}`,
    revision: '0123456789abcdef0123456789abcdef01234567',
    dtype: 'q8',
    dim: 384,
    pooling: 'mean',
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
      query_prefix: STATIC_FLOOR_EMBEDDING_PROFILE.query_prefix,
      doc_prefix: STATIC_FLOOR_EMBEDDING_PROFILE.doc_prefix,
    }
  }
  return entry
}

function candidates(): BenchCandidate[] {
  return [
    candidate('baseline'),
    candidate('alternate'),
    candidate('static-floor', 'static'),
  ]
}

function config(): BenchmarkConfig {
  return {
    schemaVersion: 1,
    baselineCandidateId: 'baseline',
    floorCandidateId: BUNDLED_STATIC_FLOOR_ID,
    selection: {
      minimumRecordedHitAt5Gain: 0.03,
      requireRecordedHitAt1NonRegression: true,
      maximumFloorHitAt5Gap: 0.1,
    },
    performance: {
      singleDocumentSamples: 20,
      concurrentDocumentSamples: 200,
      concurrency: 16,
      topK: 5,
      topKIterations: 25,
    },
    languageMix: 'English-only fixture',
  }
}

describe('candidate config parsing', () => {
  it('accepts arbitrary nonempty manifests and preserves candidate metadata', () => {
    const prefixValidation = {
      status: 'confirmed',
      source: 'https://example.test/model',
      finding: 'Queries use a prefix.',
    }
    const dtypePrevalidation = {
      status: 'available',
      requested: 'q8',
      available: ['q8'],
    }
    const source = [
      {
        ...candidate('model-a'),
        prefixValidation,
        dtypePrevalidation,
        futureMetadata: { retained: true },
      },
      candidate('model-b'),
    ]

    const parsed = parseCandidates(source)

    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toEqual(source[0])
    expect(parsed[0]?.prefixValidation).toBe(prefixValidation)
    expect(parsed[0]?.dtypePrevalidation).toBe(dtypePrevalidation)
    expect((parsed[0] as Record<string, unknown>).futureMetadata).toEqual({ retained: true })
  })

  it('parses JSON source strings', () => {
    expect(parseCandidatesJson(JSON.stringify([candidate('model-a')]))).toEqual([
      candidate('model-a'),
    ])
  })

  it('accepts the mean and CLS pooling modes supported by Transformers.js', () => {
    expect(
      parseCandidates([{ ...candidate('cls-model'), pooling: 'cls' }])[0]?.pooling,
    ).toBe('cls')
  })

  it('accepts an explicit cap or the backend/model token budget', () => {
    expect(parseCandidates([{ ...candidate('model-default'), max_tokens: null }])[0])
      .toHaveProperty('max_tokens', null)
  })

  it('rejects static labels that do not describe the bundled Potion floor', () => {
    const floor = candidate('static-floor', 'static')

    expect(() => parseCandidates([{ ...floor, id: 'relabeled-floor' }])).toThrow(
      `must be "${BUNDLED_STATIC_FLOOR_ID}" for the bundled static floor`,
    )
    expect(() =>
      parseCandidates([{ ...floor, model_id: 'fixture/not-the-bundled-floor' }]),
    ).toThrow('must be "minishlab/potion-retrieval-32M" for the bundled static floor')
    expect(() => parseCandidates([{ ...floor, pooling: 'cls' }])).toThrow(
      'must be "mean" for the bundled static floor',
    )
    expect(() => parseCandidates([{ ...floor, query_prefix: 'query: ' }])).toThrow(
      'must be "" for the bundled static floor',
    )
  })

  it.each([null, {}, 'not-an-array'])('rejects a non-array manifest: %j', (value) => {
    expect(() => parseCandidates(value)).toThrow('candidates must be an array')
  })

  it('rejects an empty manifest', () => {
    expect(() => parseCandidates([])).toThrow('at least one candidate')
  })

  it.each(['../escape', 'has space', '-leading', 'trailing-', ''])(
    'rejects unsafe candidate id %j',
    (id) => {
      expect(() => parseCandidates([{ ...candidate('valid'), id }])).toThrow(
        'candidates[0].id',
      )
    },
  )

  it('rejects duplicate IDs', () => {
    expect(() => parseCandidates([candidate('same'), candidate('same')])).toThrow(
      'candidate id "same" is duplicated',
    )
  })

  it.each([
    ['model_id', ''],
    ['artifact', '   '],
    ['revision', null],
    ['revision', 'main'],
    ['backend', 'browser'],
    ['dtype', 'fp32'],
    ['dim', 0],
    ['dim', 1.5],
    ['dim', Number.MAX_SAFE_INTEGER + 1],
    ['pooling', 'max'],
    ['normalize', false],
    ['max_tokens', -1],
    ['max_tokens', 3.5],
    ['query_prefix', null],
    ['doc_prefix', 1],
  ])('rejects an invalid %s value', (field, value) => {
    expect(() =>
      parseCandidates([{ ...candidate('invalid-field'), [field]: value }]),
    ).toThrow(`candidates[0].${field}`)
  })
})

describe('benchmark config parsing', () => {
  it('parses the complete schema and validates its candidate references', () => {
    expect(parseBenchmarkConfig(config(), candidates())).toEqual(config())
    expect(parseBenchmarkConfigJson(JSON.stringify(config()), candidates())).toEqual(
      config(),
    )
  })

  it('accepts a null floor candidate', () => {
    const source = { ...config(), floorCandidateId: null }

    expect(parseBenchmarkConfig(source, candidates()).floorCandidateId).toBeNull()
  })

  it.each([
    ['minimumRecordedHitAt5Gain', -0.01],
    ['minimumRecordedHitAt5Gain', 1.01],
    ['minimumRecordedHitAt5Gain', Number.NaN],
    ['maximumFloorHitAt5Gap', -0.01],
    ['maximumFloorHitAt5Gap', 1.01],
  ])('rejects an out-of-range selection.%s', (field, value) => {
    const source = config()
    ;(source.selection as unknown as Record<string, unknown>)[field] = value

    expect(() => parseBenchmarkConfig(source)).toThrow(
      `benchmarkConfig.selection.${field}`,
    )
  })

  it('requires the hit@1 non-regression flag to be boolean', () => {
    const source = config()
    ;(
      source.selection as unknown as Record<string, unknown>
    ).requireRecordedHitAt1NonRegression = 'yes'

    expect(() => parseBenchmarkConfig(source)).toThrow(
      'benchmarkConfig.selection.requireRecordedHitAt1NonRegression',
    )
  })

  it.each([
    'singleDocumentSamples',
    'concurrentDocumentSamples',
    'concurrency',
    'topK',
    'topKIterations',
  ])('requires performance.%s to be a positive integer', (field) => {
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const source = config()
      ;(source.performance as unknown as Record<string, unknown>)[field] = value
      expect(() => parseBenchmarkConfig(source)).toThrow(
        `benchmarkConfig.performance.${field}`,
      )
    }
  })

  it('bounds concurrency by concurrentDocumentSamples', () => {
    const source = config()
    source.performance.concurrentDocumentSamples = 4
    source.performance.concurrency = 5

    expect(() => parseBenchmarkConfig(source)).toThrow(
      'concurrency must not exceed concurrentDocumentSamples',
    )
  })

  it('bounds topK by concurrentDocumentSamples rather than a corpus size', () => {
    const source = config()
    source.performance.concurrentDocumentSamples = 4
    source.performance.concurrency = 4
    source.performance.topK = 5

    expect(() => parseBenchmarkConfig(source)).toThrow(
      'topK must not exceed concurrentDocumentSamples',
    )
  })

  it.each([
    ['schemaVersion', 2],
    ['baselineCandidateId', ''],
    ['floorCandidateId', '../floor'],
    ['languageMix', '   '],
  ])('rejects invalid top-level field %s', (field, value) => {
    const source = { ...config(), [field]: value }

    expect(() => parseBenchmarkConfig(source)).toThrow(`benchmarkConfig.${field}`)
  })

  it('rejects unknown config keys so misspellings cannot silently change policy', () => {
    expect(() => parseBenchmarkConfig({ ...config(), schema_version: 1 })).toThrow(
      'benchmarkConfig.schema_version is not a recognized field',
    )
  })

  it('rejects unknown baseline and floor references', () => {
    expect(() =>
      parseBenchmarkConfig({ ...config(), baselineCandidateId: 'missing' }, candidates()),
    ).toThrow('references unknown candidate "missing"')
    expect(() =>
      parseBenchmarkConfig({ ...config(), floorCandidateId: 'missing' }, candidates()),
    ).toThrow('references unknown candidate "missing"')
  })

  it('requires a node baseline and static floor', () => {
    expect(() =>
      validateBenchmarkConfigReferences(
        { ...config(), baselineCandidateId: BUNDLED_STATIC_FLOOR_ID },
        candidates(),
      ),
    ).toThrow('baselineCandidateId must reference a node candidate')
    expect(() =>
      validateBenchmarkConfigReferences(
        { ...config(), floorCandidateId: 'alternate' },
        candidates(),
      ),
    ).toThrow('floorCandidateId must reference a static candidate')
  })

  it('validates the checked-in candidate and benchmark config JSON together', async () => {
    const [candidateSource, configSource] = await Promise.all([
      readFile(new URL('../../candidates.json', import.meta.url), 'utf8'),
      readFile(new URL('../../benchmark.config.json', import.meta.url), 'utf8'),
    ])
    const parsedCandidates = parseCandidatesJson(candidateSource)
    const parsedConfig = parseBenchmarkConfigJson(configSource, parsedCandidates)

    expect(parsedCandidates).toHaveLength(4)
    expect(parsedConfig).toMatchObject({
      baselineCandidateId: 'bge-small-en-v1.5',
      floorCandidateId: BUNDLED_STATIC_FLOOR_ID,
      performance: {
        singleDocumentSamples: 20,
        concurrentDocumentSamples: 200,
        concurrency: 16,
        topK: 5,
        topKIterations: 25,
      },
    })
  })
})

describe('selectCandidates', () => {
  it('selects all candidates when no ID filter is supplied', () => {
    expect(selectCandidates(candidates(), config()).map(({ id }) => id)).toEqual([
      'baseline',
      'alternate',
      BUNDLED_STATIC_FLOOR_ID,
    ])
  })

  it('preserves manifest order instead of requested-ID order', () => {
    expect(
      selectCandidates(candidates(), config(), {
        requestedIds: [BUNDLED_STATIC_FLOOR_ID, 'alternate'],
      }).map(({ id }) => id),
    ).toEqual(['alternate', BUNDLED_STATIC_FLOOR_ID])
  })

  it('auto-includes the configured policy anchors when requested', () => {
    expect(
      selectCandidates(candidates(), config(), {
        requestedIds: [BUNDLED_STATIC_FLOOR_ID],
        includeBaseline: true,
      }).map(({ id }) => id),
    ).toEqual(['baseline', BUNDLED_STATIC_FLOOR_ID])
  })

  it('does not treat auto-including an explicitly requested baseline as a duplicate', () => {
    expect(
      selectCandidates(candidates(), config(), {
        requestedIds: ['baseline'],
        includeBaseline: true,
      }).map(({ id }) => id),
    ).toEqual(['baseline', BUNDLED_STATIC_FLOOR_ID])
  })

  it('adds both policy anchors to an alternate-only comparison', () => {
    expect(
      selectCandidates(candidates(), config(), {
        requestedIds: ['alternate'],
        includeBaseline: true,
      }).map(({ id }) => id),
    ).toEqual(['baseline', 'alternate', BUNDLED_STATIC_FLOOR_ID])
  })

  it('rejects duplicate, unknown, and empty requested-ID selections', () => {
    expect(() =>
      selectCandidates(candidates(), config(), {
        requestedIds: ['alternate', 'alternate'],
      }),
    ).toThrow('duplicates candidate "alternate"')
    expect(() =>
      selectCandidates(candidates(), config(), { requestedIds: ['missing'] }),
    ).toThrow('references unknown candidate "missing"')
    expect(() => selectCandidates(candidates(), config(), { requestedIds: [] })).toThrow(
      'must select at least one candidate',
    )
  })

  it('rejects malformed runtime selection options', () => {
    expect(() =>
      selectCandidates(candidates(), config(), {
        requestedIds: 'alternate' as unknown as string[],
      }),
    ).toThrow('requestedIds must be an array')
    expect(() =>
      selectCandidates(candidates(), config(), {
        includeBaseline: 'yes' as unknown as boolean,
      }),
    ).toThrow('includeBaseline must be a boolean')
  })
})
