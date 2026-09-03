import { createHash } from 'node:crypto'

import {
  DEFAULT_EMBEDDING_PROFILE,
  type EmbeddingProfile,
} from '@vostride/agent-qa-schema'

export interface BenchCandidate {
  id: string
  model_id: string
  backend: 'node' | 'static'
  artifact: string
  revision: string
  dtype: 'q8'
  dim: number
  pooling: 'mean' | 'cls'
  normalize: true
  max_tokens: number | null
  query_prefix: string
  doc_prefix: string
}

/**
 * Benchmark profile used by the local Transformers.js adapter.
 *
 * Production currently locks pooling to `mean`, while the benchmark must honor
 * each candidate model's published contract (for example, GTE and Granite use
 * CLS pooling). All other profile fields intentionally stay aligned with the
 * production schema.
 */
export interface BenchEmbeddingProfile {
  model_id: EmbeddingProfile['model_id']
  revision: EmbeddingProfile['revision']
  dim: EmbeddingProfile['dim']
  dtype: EmbeddingProfile['dtype']
  pooling: BenchCandidate['pooling']
  normalize: EmbeddingProfile['normalize']
  query_prefix: EmbeddingProfile['query_prefix']
  doc_prefix: EmbeddingProfile['doc_prefix']
  backend: EmbeddingProfile['backend']
  session_options: EmbeddingProfile['session_options']
}

export interface BenchDocument {
  id: string
  kind: 'element' | 'page'
  text: string
  apps: string[]
  sourcePaths: string[]
}

export interface BenchQuery {
  id?: string
  app: string
  query: string
  goldDocIds: string[]
}

export interface BenchCorpus {
  documents: BenchDocument[]
  recordedQueries: Array<BenchQuery & {
    id: string
    sourceCassetteId: string
    sourcePath: string
  }>
}

export interface AuthoredQueries {
  provenance: Record<string, string>
  queries: Array<BenchQuery & { category: string }>
}

export interface HitRates {
  queries: number
  hitAt1: number
  hitAt3: number
  hitAt5: number
}

export interface SliceMetrics {
  perApp: Record<string, HitRates>
  macro: HitRates
}

export interface CandidateBenchSuccess {
  candidateId: string
  status: 'ok'
  profile: BenchEmbeddingProfile
  slices: {
    recorded: SliceMetrics
    authored: SliceMetrics
  }
  distributions: {
    recorded: { goldPairCosines: number[]; randomPairCosines: number[] }
    authored: { goldPairCosines: number[]; randomPairCosines: number[] }
  }
}

export interface CandidateBenchError {
  candidateId: string
  status: 'error'
  error: { name: string; message: string }
}

export type CandidateBenchResult = CandidateBenchSuccess | CandidateBenchError

export interface BenchRunResult {
  schemaVersion: 1
  documents: number
  queries: { recorded: number; authored: number }
  candidates: CandidateBenchResult[]
}

export interface BenchEmbedder {
  embedDocument(rendering: string): Promise<Float32Array>
  embedQuery(rendering: string): Promise<Float32Array>
}

export interface RunBenchOptions {
  candidates: readonly BenchCandidate[]
  corpus: BenchCorpus
  authored: AuthoredQueries
  allowDownload?: boolean
  createEmbedder?: (
    candidate: BenchCandidate,
    profile: BenchEmbeddingProfile,
  ) => Promise<BenchEmbedder>
}

interface RankedDocument {
  id: string
  cosine: number
}

interface SliceAccumulator {
  queryCount: number
  hitAt1: number
  hitAt3: number
  hitAt5: number
}

interface EmbeddedDocument extends BenchDocument {
  vector: Float32Array
}

const NORMALIZATION_TOLERANCE = 1e-3

export function candidateProfile(candidate: BenchCandidate): BenchEmbeddingProfile {
  return {
    model_id: candidate.model_id,
    revision: candidate.revision,
    dim: candidate.dim,
    dtype: candidate.dtype,
    pooling: candidate.pooling,
    normalize: candidate.normalize,
    query_prefix: candidate.query_prefix,
    doc_prefix: candidate.doc_prefix,
    backend: candidate.backend,
    session_options:
      candidate.backend === 'node'
        ? DEFAULT_EMBEDDING_PROFILE.session_options
        : {},
  }
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function stringAt(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${path} must be ${allowEmpty ? 'a string' : 'a nonempty string'}`)
  }
  return value
}

function uniqueStringsAt(
  value: unknown,
  path: string,
  options: { allowEmptyArray?: boolean } = {},
): string[] {
  if (!Array.isArray(value) || (!options.allowEmptyArray && value.length === 0)) {
    throw new TypeError(`${path} must be a${options.allowEmptyArray ? '' : ' nonempty'} string array`)
  }
  const strings = value.map((entry, index) => stringAt(entry, `${path}[${index}]`))
  if (new Set(strings).size !== strings.length) {
    throw new TypeError(`${path} must not contain duplicates`)
  }
  return strings
}

function validateQuery(value: unknown, path: string, recorded: boolean): void {
  const query = recordAt(value, path)
  if (recorded) {
    stringAt(query.id, `${path}.id`)
    stringAt(query.sourceCassetteId, `${path}.sourceCassetteId`)
    stringAt(query.sourcePath, `${path}.sourcePath`)
  } else {
    if (query.id !== undefined) stringAt(query.id, `${path}.id`)
    stringAt(query.category, `${path}.category`)
  }
  stringAt(query.app, `${path}.app`)
  stringAt(query.query, `${path}.query`)
  uniqueStringsAt(query.goldDocIds, `${path}.goldDocIds`)
}

/** Validate decoded corpus input before any model work or child-process attribution. */
export function assertBenchCorpus(value: unknown): asserts value is BenchCorpus {
  const corpus = recordAt(value, 'corpus')
  if (!Array.isArray(corpus.documents)) {
    throw new TypeError('corpus.documents must be an array')
  }
  if (corpus.documents.length === 0) {
    throw new TypeError('corpus.documents must contain at least one document')
  }
  const documentIds = new Set<string>()
  corpus.documents.forEach((value, index) => {
    const path = `corpus.documents[${index}]`
    const document = recordAt(value, path)
    const id = stringAt(document.id, `${path}.id`)
    if (documentIds.has(id)) throw new TypeError(`${path}.id duplicates ${id}`)
    documentIds.add(id)
    if (document.kind !== 'element' && document.kind !== 'page') {
      throw new TypeError(`${path}.kind must be "element" or "page"`)
    }
    stringAt(document.text, `${path}.text`, true)
    uniqueStringsAt(document.apps, `${path}.apps`)
    uniqueStringsAt(document.sourcePaths, `${path}.sourcePaths`)
  })
  if (!Array.isArray(corpus.recordedQueries)) {
    throw new TypeError('corpus.recordedQueries must be an array')
  }
  if (corpus.recordedQueries.length === 0) {
    throw new TypeError('corpus.recordedQueries must contain at least one query')
  }
  const recordedIds = new Set<string>()
  corpus.recordedQueries.forEach((value, index) => {
    validateQuery(value, `corpus.recordedQueries[${index}]`, true)
    const id = (value as { id: string }).id
    if (recordedIds.has(id)) {
      throw new TypeError(`corpus.recordedQueries[${index}].id duplicates ${id}`)
    }
    recordedIds.add(id)
  })
}

/** Validate the independently reported authored-query slice. */
export function assertAuthoredQueries(value: unknown): asserts value is AuthoredQueries {
  const authored = recordAt(value, 'authoredQueries')
  const provenance = recordAt(authored.provenance, 'authoredQueries.provenance')
  for (const [key, entry] of Object.entries(provenance)) {
    stringAt(entry, `authoredQueries.provenance.${key}`, true)
  }
  if (!Array.isArray(authored.queries)) {
    throw new TypeError('authoredQueries.queries must be an array')
  }
  authored.queries.forEach((query, index) => {
    validateQuery(query, `authoredQueries.queries[${index}]`, false)
  })
}

/** Cross-check every query against the exact validated document population. */
export function assertBenchRelationships(
  corpus: BenchCorpus,
  authored: AuthoredQueries,
): void {
  const documents = new Map(corpus.documents.map((document) => [document.id, document]))
  for (const [slice, queries] of [
    ['recorded', corpus.recordedQueries],
    ['authored', authored.queries],
  ] as const) {
    queries.forEach((query, index) => {
      for (const goldId of query.goldDocIds) {
        const gold = documents.get(goldId)
        if (gold === undefined) {
          throw new TypeError(`${slice} query ${index} references unknown gold ${goldId}`)
        }
        if (!gold.apps.includes(query.app)) {
          throw new TypeError(
            `${slice} query ${index} gold ${goldId} does not belong to app ${query.app}`,
          )
        }
      }
    })
  }
}

/** Construct candidates with the bench-owned latest Transformers.js runtime or bundled floor. */
export async function createCandidateEmbedder(
  candidate: BenchCandidate,
  profile = candidateProfile(candidate),
  options: { allowDownload?: boolean } = {},
): Promise<BenchEmbedder> {
  if (candidate.backend === 'static') {
    const { createFloorEmbedder } = await import('@vostride/agent-qa-knowledge-local')
    return createFloorEmbedder(
      candidate.max_tokens === null ? {} : { maxTokens: candidate.max_tokens },
    )
  }
  const { createTransformersJsEmbedder } = await import('./transformers-js-backend.ts')
  return createTransformersJsEmbedder(candidate, profile, {
    allowDownload: options.allowDownload ?? true,
  })
}

function errorEntry(candidate: BenchCandidate, error: unknown): CandidateBenchError {
  return {
    candidateId: candidate.id,
    status: 'error',
    error: {
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
    },
  }
}

function assertNormalized(
  vector: Float32Array,
  expectedDim: number,
  label: string,
): void {
  if (vector.length !== expectedDim) {
    throw new RangeError(`${label} has ${vector.length} dimensions; expected ${expectedDim}`)
  }
  let squaredLength = 0
  for (const value of vector) {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite value`)
    squaredLength += value * value
  }
  if (Math.abs(squaredLength - 1) > NORMALIZATION_TOLERANCE) {
    throw new RangeError(`${label} is not L2-normalized (squared length ${squaredLength})`)
  }
}

function cosine(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) {
    throw new RangeError(`cosine dimensions differ (${left.length} versus ${right.length})`)
  }
  let dot = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!
  }
  return dot
}

function emptyAccumulator(): SliceAccumulator {
  return { queryCount: 0, hitAt1: 0, hitAt3: 0, hitAt5: 0 }
}

function toHitRates(accumulator: SliceAccumulator): HitRates {
  if (accumulator.queryCount === 0) {
    return { queries: 0, hitAt1: 0, hitAt3: 0, hitAt5: 0 }
  }
  return {
    queries: accumulator.queryCount,
    hitAt1: accumulator.hitAt1 / accumulator.queryCount,
    hitAt3: accumulator.hitAt3 / accumulator.queryCount,
    hitAt5: accumulator.hitAt5 / accumulator.queryCount,
  }
}

function macroRates(perApp: Record<string, HitRates>): HitRates {
  const entries = Object.values(perApp)
  if (entries.length === 0) return { queries: 0, hitAt1: 0, hitAt3: 0, hitAt5: 0 }
  const totals = entries.reduce(
    (sum, entry) => ({
      queries: sum.queries + entry.queries,
      hitAt1: sum.hitAt1 + entry.hitAt1,
      hitAt3: sum.hitAt3 + entry.hitAt3,
      hitAt5: sum.hitAt5 + entry.hitAt5,
    }),
    { queries: 0, hitAt1: 0, hitAt3: 0, hitAt5: 0 },
  )
  return {
    queries: totals.queries,
    hitAt1: totals.hitAt1 / entries.length,
    hitAt3: totals.hitAt3 / entries.length,
    hitAt5: totals.hitAt5 / entries.length,
  }
}

function deterministicRandomDocument(
  queryKey: string,
  documents: readonly EmbeddedDocument[],
  goldIds: ReadonlySet<string>,
): EmbeddedDocument | undefined {
  const eligible = documents
    .filter((document) => !goldIds.has(document.id))
    .sort((left, right) => left.id.localeCompare(right.id))
  if (eligible.length === 0) return undefined
  const digest = createHash('sha256').update(queryKey).digest()
  return eligible[digest.readUInt32BE(0) % eligible.length]
}

async function scoreSlice(
  sliceName: 'recorded' | 'authored',
  queries: readonly BenchQuery[],
  documentsByApp: ReadonlyMap<string, readonly EmbeddedDocument[]>,
  allDocuments: ReadonlyMap<string, EmbeddedDocument>,
  embedder: BenchEmbedder,
  profile: BenchEmbeddingProfile,
): Promise<{
  metrics: SliceMetrics
  goldPairCosines: number[]
  randomPairCosines: number[]
}> {
  const accumulators = new Map<string, SliceAccumulator>()
  const goldPairCosines: number[] = []
  const randomPairCosines: number[] = []

  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    const query = queries[queryIndex]!
    const documents = documentsByApp.get(query.app)
    if (documents === undefined || documents.length === 0) {
      throw new Error(`${sliceName} query ${queryIndex} has no documents for app ${query.app}`)
    }
    if (query.goldDocIds.length === 0) {
      throw new Error(`${sliceName} query ${queryIndex} has an empty gold set`)
    }

    const vector = await embedder.embedQuery(query.query)
    assertNormalized(vector, profile.dim, `${sliceName} query ${queryIndex}`)
    const ranked: RankedDocument[] = documents
      .map((document) => ({ id: document.id, cosine: cosine(vector, document.vector) }))
      .sort(
        (left, right) => right.cosine - left.cosine || left.id.localeCompare(right.id),
      )
    const goldIds = new Set(query.goldDocIds)
    for (const goldId of goldIds) {
      const gold = allDocuments.get(goldId)
      if (gold === undefined || !gold.apps.includes(query.app)) {
        throw new Error(
          `${sliceName} query ${queryIndex} references missing gold document ${goldId}`,
        )
      }
      goldPairCosines.push(cosine(vector, gold.vector))
    }
    const random = deterministicRandomDocument(
      `${sliceName}\u0000${query.id ?? queryIndex}\u0000${query.app}\u0000${query.query}`,
      documents,
      goldIds,
    )
    if (random !== undefined) randomPairCosines.push(cosine(vector, random.vector))

    const accumulator = accumulators.get(query.app) ?? emptyAccumulator()
    accumulator.queryCount += 1
    if (ranked.slice(0, 1).some(({ id }) => goldIds.has(id))) accumulator.hitAt1 += 1
    if (ranked.slice(0, 3).some(({ id }) => goldIds.has(id))) accumulator.hitAt3 += 1
    if (ranked.slice(0, 5).some(({ id }) => goldIds.has(id))) accumulator.hitAt5 += 1
    accumulators.set(query.app, accumulator)
  }

  const perApp = Object.create(null) as Record<string, HitRates>
  for (const app of [...accumulators.keys()].sort()) {
    perApp[app] = toHitRates(accumulators.get(app)!)
  }
  return {
    metrics: { perApp, macro: macroRates(perApp) },
    goldPairCosines,
    randomPairCosines,
  }
}

async function runCandidate(
  candidate: BenchCandidate,
  options: RunBenchOptions,
): Promise<CandidateBenchSuccess> {
  const profile = candidateProfile(candidate)
  const embedder =
    options.createEmbedder === undefined
      ? await createCandidateEmbedder(candidate, profile, {
          allowDownload: options.allowDownload,
        })
      : await options.createEmbedder(candidate, profile)
  const embeddedDocuments: EmbeddedDocument[] = []
  const documentIds = new Set<string>()
  for (const document of options.corpus.documents) {
    if (documentIds.has(document.id)) throw new Error(`duplicate document id ${document.id}`)
    documentIds.add(document.id)
    const vector = await embedder.embedDocument(document.text)
    assertNormalized(vector, profile.dim, `document ${document.id}`)
    embeddedDocuments.push({ ...document, vector })
  }

  const documentsByApp = new Map<string, EmbeddedDocument[]>()
  for (const document of embeddedDocuments) {
    for (const app of document.apps) {
      const documents = documentsByApp.get(app) ?? []
      documents.push(document)
      documentsByApp.set(app, documents)
    }
  }
  for (const documents of documentsByApp.values()) {
    documents.sort((left, right) => left.id.localeCompare(right.id))
  }
  const allDocuments = new Map(
    embeddedDocuments.map((document) => [document.id, document] as const),
  )
  const recorded = await scoreSlice(
    'recorded',
    options.corpus.recordedQueries,
    documentsByApp,
    allDocuments,
    embedder,
    profile,
  )
  const authored = await scoreSlice(
    'authored',
    options.authored.queries,
    documentsByApp,
    allDocuments,
    embedder,
    profile,
  )

  return {
    candidateId: candidate.id,
    status: 'ok',
    profile,
    slices: { recorded: recorded.metrics, authored: authored.metrics },
    distributions: {
      recorded: {
        goldPairCosines: recorded.goldPairCosines,
        randomPairCosines: recorded.randomPairCosines,
      },
      authored: {
        goldPairCosines: authored.goldPairCosines,
        randomPairCosines: authored.randomPairCosines,
      },
    },
  }
}

export async function runBench(options: RunBenchOptions): Promise<BenchRunResult> {
  assertBenchCorpus(options.corpus)
  assertAuthoredQueries(options.authored)
  assertBenchRelationships(options.corpus, options.authored)
  const results: CandidateBenchResult[] = []
  for (const candidate of options.candidates) {
    try {
      results.push(await runCandidate(candidate, options))
    } catch (error) {
      results.push(errorEntry(candidate, error))
    }
  }
  return {
    schemaVersion: 1,
    documents: options.corpus.documents.length,
    queries: {
      recorded: options.corpus.recordedQueries.length,
      authored: options.authored.queries.length,
    },
    candidates: results,
  }
}
