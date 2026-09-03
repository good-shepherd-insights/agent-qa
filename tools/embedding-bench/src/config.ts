import { STATIC_FLOOR_EMBEDDING_PROFILE } from '@vostride/agent-qa-schema'

import type { BenchCandidate } from './runner'

export const BUNDLED_STATIC_FLOOR_ARTIFACT =
  'packages/knowledge-local/assets/potion-retrieval-32m'
export const BUNDLED_STATIC_FLOOR_ID = 'potion-retrieval-32m-static-floor'

export interface BenchmarkConfig {
  schemaVersion: 1
  baselineCandidateId: string
  floorCandidateId: string | null
  selection: {
    minimumRecordedHitAt5Gain: number
    requireRecordedHitAt1NonRegression: boolean
    maximumFloorHitAt5Gap: number
  }
  performance: {
    singleDocumentSamples: number
    concurrentDocumentSamples: number
    concurrency: number
    topK: number
    topKIterations: number
  }
  languageMix: string
}

/**
 * Candidate definitions may carry provenance gathered while pinning a model.
 * The benchmark runtime only consumes BenchCandidate fields, but keeping these
 * two established metadata records makes parse/write/report cycles lossless.
 */
export interface ParsedBenchCandidate extends BenchCandidate {
  [key: string]: unknown
  prefixValidation?: unknown
  dtypePrevalidation?: unknown
}

export interface CandidateSelectionOptions {
  requestedIds?: readonly string[]
  includeBaseline?: boolean
}

type JsonObject = Record<string, unknown>

const SAFE_CANDIDATE_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u

function fail(path: string, expectation: string): never {
  throw new TypeError(`${path} ${expectation}`)
}

function objectAt(value: unknown, path: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(path, 'must be an object')
  }
  return value as JsonObject
}

function onlyKeys(record: JsonObject, path: string, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed)
  const unknown = Object.keys(record).find((key) => !allowedKeys.has(key))
  if (unknown !== undefined) fail(`${path}.${unknown}`, 'is not a recognized field')
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== 'string') return fail(path, 'must be a string')
  return value
}

function nonEmptyStringAt(value: unknown, path: string): string {
  const parsed = stringAt(value, path)
  if (parsed.trim().length === 0) return fail(path, 'must be a nonempty string')
  return parsed
}

function candidateIdAt(value: unknown, path: string): string {
  const parsed = nonEmptyStringAt(value, path)
  if (!SAFE_CANDIDATE_ID.test(parsed)) {
    return fail(
      path,
      'must start and end with a letter or digit and contain only letters, digits, dots, underscores, or hyphens',
    )
  }
  return parsed
}

function pinnedRevisionAt(value: unknown, path: string): string {
  const parsed = nonEmptyStringAt(value, path)
  if (!/^[a-f\d]{40}$/u.test(parsed)) {
    return fail(path, 'must be a pinned 40-character lowercase Git commit SHA')
  }
  return parsed
}

function literalAt<const T extends string | number | boolean>(
  value: unknown,
  expected: T,
  path: string,
): T {
  if (value !== expected) return fail(path, `must be ${JSON.stringify(expected)}`)
  return expected
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') return fail(path, 'must be a boolean')
  return value
}

function poolingAt(value: unknown, path: string): BenchCandidate['pooling'] {
  if (value !== 'mean' && value !== 'cls') {
    return fail(path, 'must be "mean" or "cls"')
  }
  return value
}

function positiveIntegerAt(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return fail(path, 'must be a positive integer')
  }
  return value
}

function positiveIntegerOrNullAt(value: unknown, path: string): number | null {
  return value === null ? null : positiveIntegerAt(value, path)
}

function unitIntervalAt(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    return fail(path, 'must be a finite number between 0 and 1')
  }
  return value
}

function parseCandidate(value: unknown, index: number): ParsedBenchCandidate {
  const path = `candidates[${index}]`
  const record = objectAt(value, path)
  const backend = record.backend
  if (backend !== 'node' && backend !== 'static') {
    return fail(`${path}.backend`, 'must be "node" or "static"')
  }

  const candidate: ParsedBenchCandidate = {
    ...record,
    id: candidateIdAt(record.id, `${path}.id`),
    model_id: nonEmptyStringAt(record.model_id, `${path}.model_id`),
    backend,
    artifact: nonEmptyStringAt(record.artifact, `${path}.artifact`),
    revision: pinnedRevisionAt(record.revision, `${path}.revision`),
    dtype: literalAt(record.dtype, 'q8', `${path}.dtype`),
    dim: positiveIntegerAt(record.dim, `${path}.dim`),
    pooling: poolingAt(record.pooling, `${path}.pooling`),
    normalize: literalAt(record.normalize, true, `${path}.normalize`),
    max_tokens: positiveIntegerOrNullAt(record.max_tokens, `${path}.max_tokens`),
    query_prefix: stringAt(record.query_prefix, `${path}.query_prefix`),
    doc_prefix: stringAt(record.doc_prefix, `${path}.doc_prefix`),
  }

  if (candidate.backend === 'static') {
    const lockedFields = {
      id: BUNDLED_STATIC_FLOOR_ID,
      model_id: STATIC_FLOOR_EMBEDDING_PROFILE.model_id,
      artifact: BUNDLED_STATIC_FLOOR_ARTIFACT,
      revision: STATIC_FLOOR_EMBEDDING_PROFILE.revision,
      dtype: STATIC_FLOOR_EMBEDDING_PROFILE.dtype,
      dim: STATIC_FLOOR_EMBEDDING_PROFILE.dim,
      pooling: STATIC_FLOOR_EMBEDDING_PROFILE.pooling,
      normalize: STATIC_FLOOR_EMBEDDING_PROFILE.normalize,
      query_prefix: STATIC_FLOOR_EMBEDDING_PROFILE.query_prefix,
      doc_prefix: STATIC_FLOOR_EMBEDDING_PROFILE.doc_prefix,
      max_tokens: null,
    } as const
    for (const [field, expected] of Object.entries(lockedFields)) {
      if (candidate[field] !== expected) {
        fail(
          `${path}.${field}`,
          `must be ${JSON.stringify(expected)} for the bundled static floor`,
        )
      }
    }
  }

  return candidate
}

/** Parse and validate the already-decoded contents of candidates.json. */
export function parseCandidates(value: unknown): ParsedBenchCandidate[] {
  if (!Array.isArray(value)) fail('candidates', 'must be an array')
  if (value.length === 0) fail('candidates', 'must contain at least one candidate')

  const candidates = value.map(parseCandidate)
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) {
      fail(`candidate id ${JSON.stringify(candidate.id)}`, 'is duplicated')
    }
    seen.add(candidate.id)
  }
  return candidates
}

/** Parse a candidates.json source string and validate its decoded value. */
export function parseCandidatesJson(source: string): ParsedBenchCandidate[] {
  return parseCandidates(JSON.parse(source) as unknown)
}

/**
 * Validate candidate relationships which cannot be checked from the config in
 * isolation. Kept separate so callers can validate decoded inputs in either order.
 */
export function validateBenchmarkConfigReferences(
  config: BenchmarkConfig,
  candidates: readonly BenchCandidate[],
): void {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const baseline = candidatesById.get(config.baselineCandidateId)
  if (baseline === undefined) {
    fail(
      'benchmarkConfig.baselineCandidateId',
      `references unknown candidate ${JSON.stringify(config.baselineCandidateId)}`,
    )
  }
  if (baseline.backend !== 'node') {
    fail('benchmarkConfig.baselineCandidateId', 'must reference a node candidate')
  }

  if (config.floorCandidateId === null) return
  const floor = candidatesById.get(config.floorCandidateId)
  if (floor === undefined) {
    fail(
      'benchmarkConfig.floorCandidateId',
      `references unknown candidate ${JSON.stringify(config.floorCandidateId)}`,
    )
  }
  if (floor.backend !== 'static') {
    fail('benchmarkConfig.floorCandidateId', 'must reference a static candidate')
  }
}

/** Validate performance settings for both config files and direct measurement API calls. */
export function validatePerformanceConfig(
  value: unknown,
): BenchmarkConfig['performance'] {
  const performance = objectAt(value, 'benchmarkConfig.performance')
  onlyKeys(performance, 'benchmarkConfig.performance', [
    'singleDocumentSamples',
    'concurrentDocumentSamples',
    'concurrency',
    'topK',
    'topKIterations',
  ])
  const parsed: BenchmarkConfig['performance'] = {
    singleDocumentSamples: positiveIntegerAt(
      performance.singleDocumentSamples,
      'benchmarkConfig.performance.singleDocumentSamples',
    ),
    concurrentDocumentSamples: positiveIntegerAt(
      performance.concurrentDocumentSamples,
      'benchmarkConfig.performance.concurrentDocumentSamples',
    ),
    concurrency: positiveIntegerAt(
      performance.concurrency,
      'benchmarkConfig.performance.concurrency',
    ),
    topK: positiveIntegerAt(performance.topK, 'benchmarkConfig.performance.topK'),
    topKIterations: positiveIntegerAt(
      performance.topKIterations,
      'benchmarkConfig.performance.topKIterations',
    ),
  }
  if (parsed.concurrency > parsed.concurrentDocumentSamples) {
    fail(
      'benchmarkConfig.performance.concurrency',
      'must not exceed concurrentDocumentSamples',
    )
  }
  if (parsed.topK > parsed.concurrentDocumentSamples) {
    fail('benchmarkConfig.performance.topK', 'must not exceed concurrentDocumentSamples')
  }
  return parsed
}

/** Parse and validate the already-decoded contents of benchmark.config.json. */
export function parseBenchmarkConfig(
  value: unknown,
  candidates?: readonly BenchCandidate[],
): BenchmarkConfig {
  const record = objectAt(value, 'benchmarkConfig')
  onlyKeys(record, 'benchmarkConfig', [
    'schemaVersion',
    'baselineCandidateId',
    'floorCandidateId',
    'selection',
    'performance',
    'languageMix',
  ])
  const selection = objectAt(record.selection, 'benchmarkConfig.selection')
  onlyKeys(selection, 'benchmarkConfig.selection', [
    'minimumRecordedHitAt5Gain',
    'requireRecordedHitAt1NonRegression',
    'maximumFloorHitAt5Gap',
  ])

  const floorCandidateId =
    record.floorCandidateId === null
      ? null
      : candidateIdAt(record.floorCandidateId, 'benchmarkConfig.floorCandidateId')
  const parsed: BenchmarkConfig = {
    schemaVersion: literalAt(record.schemaVersion, 1, 'benchmarkConfig.schemaVersion'),
    baselineCandidateId: candidateIdAt(
      record.baselineCandidateId,
      'benchmarkConfig.baselineCandidateId',
    ),
    floorCandidateId,
    selection: {
      minimumRecordedHitAt5Gain: unitIntervalAt(
        selection.minimumRecordedHitAt5Gain,
        'benchmarkConfig.selection.minimumRecordedHitAt5Gain',
      ),
      requireRecordedHitAt1NonRegression: booleanAt(
        selection.requireRecordedHitAt1NonRegression,
        'benchmarkConfig.selection.requireRecordedHitAt1NonRegression',
      ),
      maximumFloorHitAt5Gap: unitIntervalAt(
        selection.maximumFloorHitAt5Gap,
        'benchmarkConfig.selection.maximumFloorHitAt5Gap',
      ),
    },
    performance: validatePerformanceConfig(record.performance),
    languageMix: nonEmptyStringAt(record.languageMix, 'benchmarkConfig.languageMix'),
  }

  if (candidates !== undefined) validateBenchmarkConfigReferences(parsed, candidates)
  return parsed
}

/** Parse a benchmark.config.json source string and validate its decoded value. */
export function parseBenchmarkConfigJson(
  source: string,
  candidates?: readonly BenchCandidate[],
): BenchmarkConfig {
  return parseBenchmarkConfig(JSON.parse(source) as unknown, candidates)
}

/**
 * Select candidates without allowing CLI order to change benchmark/report order.
 * With no requestedIds filter, all candidates are selected.
 */
export function selectCandidates<TCandidate extends BenchCandidate>(
  candidates: readonly TCandidate[],
  config: BenchmarkConfig,
  options: CandidateSelectionOptions = {},
): TCandidate[] {
  validateBenchmarkConfigReferences(config, candidates)
  const requestedIds = options.requestedIds
  if (options.includeBaseline !== undefined && typeof options.includeBaseline !== 'boolean') {
    fail('includeBaseline', 'must be a boolean')
  }
  if (requestedIds === undefined) return [...candidates]
  if (!Array.isArray(requestedIds)) fail('requestedIds', 'must be an array')

  const availableIds = new Set(candidates.map(({ id }) => id))
  const selectedIds = new Set<string>()
  for (let index = 0; index < requestedIds.length; index += 1) {
    const id = candidateIdAt(requestedIds[index], `requestedIds[${index}]`)
    if (selectedIds.has(id)) {
      fail(`requestedIds[${index}]`, `duplicates candidate ${JSON.stringify(id)}`)
    }
    if (!availableIds.has(id)) {
      fail(
        `requestedIds[${index}]`,
        `references unknown candidate ${JSON.stringify(id)}`,
      )
    }
    selectedIds.add(id)
  }
  if (options.includeBaseline === true) {
    selectedIds.add(config.baselineCandidateId)
    if (config.floorCandidateId !== null) selectedIds.add(config.floorCandidateId)
  }
  if (selectedIds.size === 0) fail('requestedIds', 'must select at least one candidate')
  return candidates.filter(({ id }) => selectedIds.has(id))
}
