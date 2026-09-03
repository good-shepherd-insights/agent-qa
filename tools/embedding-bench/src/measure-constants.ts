import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import {
  parseCandidates,
  validatePerformanceConfig,
  type BenchmarkConfig,
} from './config.ts'
import type { BenchCandidate, BenchCorpus } from './runner.ts'

export interface CandidateConstantsSuccess {
  candidateId: string
  status: 'ok'
  platform: NodeJS.Platform
  arch: string
  sample: {
    singleDocuments: number
    concurrentDocuments: number
    concurrency: number
    topKDocuments: number
    topK: number
    topKIterations: number
  }
  timeToFirstEmbeddingMs: number
  singleDocumentDocsPerSecond: number
  singleDocumentLatencyMs: { p50: number; p95: number }
  concurrentDocsPerSecond: number
  rssBaselineBytes: number
  rssPeakBytes: number
  rssDeltaBytes: number
  vectorBytesPerDocument: number
  bruteTopKMs: number
  vec0TopKMs: number | null
}

export interface CandidateConstantsError {
  candidateId: string
  status: 'error'
  platform: NodeJS.Platform
  arch: string
  error: { name: string; message: string }
}

export type CandidateConstantsResult = CandidateConstantsSuccess | CandidateConstantsError

export interface MeasureConstantsOptions {
  spawnProcess?: typeof spawn
  /** Exact corpus evidence already read by the caller. Mutually exclusive with corpusPath. */
  corpusRaw?: string | Buffer
  corpusPath?: string
  performance?: BenchmarkConfig['performance']
  allowDownload?: boolean
}

const CHILD_FLAG = '--constants-child'
export const DEFAULT_PERFORMANCE_CONFIG: BenchmarkConfig['performance'] = {
  singleDocumentSamples: 20,
  concurrentDocumentSamples: 200,
  concurrency: 16,
  topK: 5,
  topKIterations: 25,
}

export interface EffectivePerformanceSample {
  singleDocuments: number
  concurrentDocuments: number
  concurrency: number
  topKDocuments: number
  topK: number
  topKIterations: number
}

/** Resolve configured sample sizes against the corpus actually present in the snapshot. */
export function effectivePerformanceSample(
  performanceConfig: unknown,
  availableDocuments: number,
): EffectivePerformanceSample {
  const settings = validatePerformanceConfig(performanceConfig)
  if (!Number.isSafeInteger(availableDocuments) || availableDocuments <= 0) {
    throw new RangeError('availableDocuments must be a positive safe integer')
  }
  const concurrentDocuments = Math.min(
    settings.concurrentDocumentSamples,
    availableDocuments,
  )
  return {
    singleDocuments: Math.min(settings.singleDocumentSamples, availableDocuments),
    concurrentDocuments,
    concurrency: Math.min(settings.concurrency, concurrentDocuments),
    topKDocuments: concurrentDocuments,
    topK: Math.min(settings.topK, concurrentDocuments),
    topKIterations: settings.topKIterations,
  }
}

interface ConstantsChildPayload {
  candidate: BenchCandidate
  corpusPath: string
  corpusSha256: string
  performance: BenchmarkConfig['performance']
  allowDownload: boolean
}

interface CorpusSnapshot {
  path: string
  sha256: string
}

function serializeError(candidateId: string, error: unknown): CandidateConstantsError {
  return {
    candidateId,
    status: 'error',
    platform: process.platform,
    arch: process.arch,
    error: {
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
    },
  }
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${path} must be a nonempty string`)
  }
  return value
}

function finiteAt(
  value: unknown,
  path: string,
  options: { minimum?: number; integer?: boolean } = {},
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`)
  }
  if (options.integer === true && !Number.isSafeInteger(value)) {
    throw new TypeError(`${path} must be a safe integer`)
  }
  if (options.minimum !== undefined && value < options.minimum) {
    throw new RangeError(`${path} must be at least ${options.minimum}`)
  }
  return value
}

function positiveIntegerAt(value: unknown, path: string): number {
  return finiteAt(value, path, { minimum: 1, integer: true })
}

function validateConstantsChildResult(value: unknown): CandidateConstantsResult {
  const result = recordAt(value, 'constants result')
  stringAt(result.candidateId, 'constants result.candidateId')
  stringAt(result.platform, 'constants result.platform')
  stringAt(result.arch, 'constants result.arch')
  if (result.status === 'error') {
    const error = recordAt(result.error, 'constants result.error')
    stringAt(error.name, 'constants result.error.name')
    stringAt(error.message, 'constants result.error.message')
    return value as CandidateConstantsResult
  }
  if (result.status !== 'ok') {
    throw new TypeError('constants result.status must be "ok" or "error"')
  }

  const sample = recordAt(result.sample, 'constants result.sample')
  positiveIntegerAt(
    sample.singleDocuments,
    'constants result.sample.singleDocuments',
  )
  const concurrentDocuments = positiveIntegerAt(
    sample.concurrentDocuments,
    'constants result.sample.concurrentDocuments',
  )
  const concurrency = positiveIntegerAt(
    sample.concurrency,
    'constants result.sample.concurrency',
  )
  const topKDocuments = positiveIntegerAt(
    sample.topKDocuments,
    'constants result.sample.topKDocuments',
  )
  const topK = positiveIntegerAt(sample.topK, 'constants result.sample.topK')
  positiveIntegerAt(sample.topKIterations, 'constants result.sample.topKIterations')
  if (concurrency > concurrentDocuments) {
    throw new RangeError(
      'constants result.sample.concurrency must not exceed concurrentDocuments',
    )
  }
  if (topK > topKDocuments) {
    throw new RangeError('constants result.sample.topK must not exceed topKDocuments')
  }
  if (topKDocuments !== concurrentDocuments) {
    throw new RangeError(
      'constants result.sample.topKDocuments must equal concurrentDocuments',
    )
  }
  for (const field of [
    'timeToFirstEmbeddingMs',
    'singleDocumentDocsPerSecond',
    'concurrentDocsPerSecond',
    'bruteTopKMs',
  ] as const) {
    finiteAt(result[field], `constants result.${field}`, { minimum: 0 })
  }
  const latency = recordAt(
    result.singleDocumentLatencyMs,
    'constants result.singleDocumentLatencyMs',
  )
  const p50 = finiteAt(latency.p50, 'constants result.singleDocumentLatencyMs.p50', {
    minimum: 0,
  })
  const p95 = finiteAt(latency.p95, 'constants result.singleDocumentLatencyMs.p95', {
    minimum: 0,
  })
  if (p95 < p50) {
    throw new RangeError('constants result.singleDocumentLatencyMs.p95 must be >= p50')
  }

  const rssBaselineBytes = finiteAt(
    result.rssBaselineBytes,
    'constants result.rssBaselineBytes',
    { minimum: 0, integer: true },
  )
  const rssPeakBytes = finiteAt(result.rssPeakBytes, 'constants result.rssPeakBytes', {
    minimum: 0,
    integer: true,
  })
  const rssDeltaBytes = finiteAt(result.rssDeltaBytes, 'constants result.rssDeltaBytes', {
    minimum: 0,
    integer: true,
  })
  if (rssPeakBytes < rssBaselineBytes) {
    throw new RangeError('constants result.rssPeakBytes must be >= rssBaselineBytes')
  }
  if (rssDeltaBytes !== rssPeakBytes - rssBaselineBytes) {
    throw new RangeError(
      'constants result.rssDeltaBytes must equal rssPeakBytes - rssBaselineBytes',
    )
  }
  positiveIntegerAt(
    result.vectorBytesPerDocument,
    'constants result.vectorBytesPerDocument',
  )
  if (result.vec0TopKMs !== null) {
    finiteAt(result.vec0TopKMs, 'constants result.vec0TopKMs', { minimum: 0 })
  }
  return value as CandidateConstantsResult
}

function metric(value: number): number {
  return Number(value.toFixed(6))
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) throw new RangeError('cannot calculate a percentile of no values')
  const sorted = [...values].sort((left, right) => left - right)
  const position = (sorted.length - 1) * fraction
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const lower = sorted[lowerIndex]!
  const upper = sorted[upperIndex]!
  return lower + (upper - lower) * (position - lowerIndex)
}

function vectorBlob(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)
}

function dot(left: Float32Array, right: Float32Array): number {
  let value = 0
  for (let index = 0; index < left.length; index += 1) {
    value += left[index]! * right[index]!
  }
  return value
}

function bruteTopK(
  query: Float32Array,
  vectors: readonly Float32Array[],
  topK: number,
): number[] {
  return vectors
    .map((vector, index) => ({ index, similarity: dot(query, vector) }))
    .sort(
      (left, right) => right.similarity - left.similarity || left.index - right.index,
    )
    .slice(0, topK)
    .map(({ index }) => index)
}

function averageDurationMs(operation: () => void, iterations: number): number {
  const start = performance.now()
  for (let iteration = 0; iteration < iterations; iteration += 1) operation()
  return (performance.now() - start) / iterations
}

/**
 * Attribute only RSS growth observed after the measurement baseline. An unchanged
 * lifetime high-water mark is pre-baseline history and contributes nothing. Once
 * it increases, however, the process necessarily reached that absolute RSS after
 * the baseline, so compare the new peak with the current-RSS baseline.
 */
export function attributableRssDeltaBytes(
  currentBaselineBytes: number,
  highWaterBaselineBytes: number,
  currentBytes: number,
  highWaterBytes: number,
): number {
  return Math.max(
    0,
    currentBytes - currentBaselineBytes,
    highWaterBytes > highWaterBaselineBytes
      ? highWaterBytes - currentBaselineBytes
      : 0,
  )
}

async function loadCorpusRenderings(
  corpusPath: string,
  expectedSha256: string,
  sampleSize: number,
): Promise<string[]> {
  const raw = await readFile(corpusPath)
  const actualSha256 = sha256(raw)
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `constants corpus snapshot SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`,
    )
  }
  const decoded = JSON.parse(raw.toString('utf8')) as unknown
  const runner: typeof import('./runner') = await import(
    new URL('./runner.ts', import.meta.url).href
  )
  runner.assertBenchCorpus(decoded)
  const corpus: BenchCorpus = decoded
  const renderings = corpus.documents.map(({ text }) => text)
  if (renderings.length === 0) throw new Error('constants measurement needs corpus documents')
  return renderings.slice(0, Math.min(renderings.length, sampleSize))
}

async function measureChild(
  payload: ConstantsChildPayload,
): Promise<CandidateConstantsSuccess> {
  const {
    candidate,
    corpusPath,
    corpusSha256,
    performance: settings,
    allowDownload,
  } = payload
  const { resolveVecCapability } =
    await import('@vostride/agent-qa-knowledge-local')
  const renderings = await loadCorpusRenderings(
    corpusPath,
    corpusSha256,
    Math.max(settings.singleDocumentSamples, settings.concurrentDocumentSamples),
  )
  const effectiveSample = effectivePerformanceSample(settings, renderings.length)
  const singleRenderings = renderings.slice(0, effectiveSample.singleDocuments)
  const concurrentRenderings = renderings.slice(0, effectiveSample.concurrentDocuments)
  const rssBaselineBytes = process.memoryUsage().rss
  const rssHighWaterBaselineBytes = process.resourceUsage().maxRSS * 1024
  let rssDeltaBytes = 0
  const sampleRss = (): void => {
    rssDeltaBytes = Math.max(
      rssDeltaBytes,
      attributableRssDeltaBytes(
        rssBaselineBytes,
        rssHighWaterBaselineBytes,
        process.memoryUsage().rss,
        process.resourceUsage().maxRSS * 1024,
      ),
    )
  }
  const loadStarted = performance.now()
  const runner = (await import(
    new URL('./runner.ts', import.meta.url).href
  )) as typeof import('./runner')
  const profile = runner.candidateProfile(candidate)
  const embedder = await runner.createCandidateEmbedder(candidate, profile, { allowDownload })
  await embedder.embedDocument(renderings[0]!)
  const timeToFirstEmbeddingMs = performance.now() - loadStarted
  sampleRss()

  const singleLatencies: number[] = []
  const singleStarted = performance.now()
  for (const rendering of singleRenderings) {
    const started = performance.now()
    await embedder.embedDocument(rendering)
    singleLatencies.push(performance.now() - started)
    sampleRss()
  }
  const singleElapsedSeconds = (performance.now() - singleStarted) / 1_000

  const vectors: Float32Array[] = []
  const effectiveConcurrency = effectiveSample.concurrency
  const concurrentStarted = performance.now()
  for (
    let offset = 0;
    offset < concurrentRenderings.length;
    offset += effectiveConcurrency
  ) {
    const batch = concurrentRenderings.slice(offset, offset + effectiveConcurrency)
    vectors.push(
      ...(await Promise.all(batch.map((rendering) => embedder.embedDocument(rendering)))),
    )
    sampleRss()
  }
  const concurrentElapsedSeconds = (performance.now() - concurrentStarted) / 1_000
  const query = await embedder.embedQuery(renderings[0]!)
  sampleRss()
  const effectiveTopK = effectiveSample.topK

  const bruteTopKMs = averageDurationMs(
    () => {
      bruteTopK(query, vectors, effectiveTopK)
    },
    settings.topKIterations,
  )
  let vec0TopKMs: number | null = null
  const db = new DatabaseSync(':memory:', { allowExtension: true })
  try {
    if (resolveVecCapability(db) === 'vec0') {
      // Each candidate runs in its own in-memory database, so a local table name
      // avoids coercing a CLS benchmark profile into production's mean-only type.
      const tableName = `bench_vectors_${profile.dim}`
      db.exec(`
        CREATE VIRTUAL TABLE ${tableName} USING vec0(
          record_rowid integer primary key,
          product text partition key,
          embedding float[${profile.dim}] distance_metric=cosine
        )
      `)
      const insert = db.prepare(`
        INSERT INTO ${tableName} (record_rowid, product, embedding)
        VALUES (?, ?, ?)
      `)
      for (let index = 0; index < vectors.length; index += 1) {
        insert.run(BigInt(index + 1), 'bench', vectorBlob(vectors[index]!))
      }
      sampleRss()
      const search = db.prepare(`
        SELECT record_rowid, distance
        FROM ${tableName}
        WHERE embedding MATCH ? AND product = ? AND k = ?
        ORDER BY distance
      `)
      const queryBlob = vectorBlob(query)
      vec0TopKMs = averageDurationMs(
        () => {
          search.all(queryBlob, 'bench', effectiveTopK)
        },
        settings.topKIterations,
      )
      sampleRss()
    }
  } finally {
    db.close()
  }

  const rssPeakBytes = rssBaselineBytes + rssDeltaBytes

  return {
    candidateId: candidate.id,
    status: 'ok',
    platform: process.platform,
    arch: process.arch,
    sample: {
      singleDocuments: singleRenderings.length,
      concurrentDocuments: concurrentRenderings.length,
      concurrency: effectiveConcurrency,
      topKDocuments: vectors.length,
      topK: effectiveTopK,
      topKIterations: effectiveSample.topKIterations,
    },
    timeToFirstEmbeddingMs: metric(timeToFirstEmbeddingMs),
    singleDocumentDocsPerSecond: metric(singleRenderings.length / singleElapsedSeconds),
    singleDocumentLatencyMs: {
      p50: metric(percentile(singleLatencies, 0.5)),
      p95: metric(percentile(singleLatencies, 0.95)),
    },
    concurrentDocsPerSecond: metric(
      concurrentRenderings.length / concurrentElapsedSeconds,
    ),
    rssBaselineBytes,
    rssPeakBytes,
    rssDeltaBytes,
    vectorBytesPerDocument: profile.dim * Float32Array.BYTES_PER_ELEMENT,
    bruteTopKMs: metric(bruteTopKMs),
    vec0TopKMs: vec0TopKMs === null ? null : metric(vec0TopKMs),
  }
}

export function parseConstantsChildJson(stdout: string): CandidateConstantsResult {
  const lines = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let value: unknown
    try {
      value = JSON.parse(lines[index]!) as unknown
    } catch {
      // Native libraries may log before the final JSON line; only the final parseable row counts.
      continue
    }
    return validateConstantsChildResult(value)
  }
  throw new SyntaxError('constants child produced no JSON result')
}

async function withCorpusSnapshot<T>(
  raw: Buffer,
  operation: (snapshot: CorpusSnapshot) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'agent-qa-embedding-constants-'))
  const snapshotPath = join(directory, 'corpus.json')
  try {
    await writeFile(snapshotPath, raw, { flag: 'wx', mode: 0o600 })
    return await operation({ path: snapshotPath, sha256: sha256(raw) })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function withResolvedCorpusSnapshot<T>(
  options: Pick<MeasureConstantsOptions, 'corpusPath' | 'corpusRaw'>,
  operation: (snapshot: CorpusSnapshot) => Promise<T>,
): Promise<T> {
  if (options.corpusRaw !== undefined && options.corpusPath !== undefined) {
    throw new TypeError('corpusRaw and corpusPath are mutually exclusive')
  }

  // Copy caller-owned bytes before the first await so later mutation cannot alter
  // the evidence shared by candidate child processes.
  const raw =
    options.corpusRaw === undefined
      ? await readFile(
          options.corpusPath ??
            fileURLToPath(new URL('../corpus/corpus.json', import.meta.url)),
        )
      : Buffer.from(options.corpusRaw)
  return withCorpusSnapshot(raw, operation)
}

function spawnConstantsCandidate(
  candidate: BenchCandidate,
  snapshot: CorpusSnapshot,
  settings: BenchmarkConfig['performance'],
  allowDownload: boolean,
  spawnProcess: typeof spawn,
): Promise<CandidateConstantsResult> {
  const payload: ConstantsChildPayload = {
    candidate,
    corpusPath: snapshot.path,
    corpusSha256: snapshot.sha256,
    performance: settings,
    allowDownload,
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return new Promise((resolve) => {
    const child = spawnProcess(
      process.execPath,
      [fileURLToPath(import.meta.url), CHILD_FLAG, encodedPayload],
      { stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => resolve(serializeError(candidate.id, error)))
    child.on('close', (code, signal) => {
      if (code !== 0) {
        resolve(
          serializeError(
            candidate.id,
            new Error(
              stderr.trim() ||
                `constants child exited with ${
                  signal === null ? `code ${String(code)}` : `signal ${signal}`
                }`,
            ),
          ),
        )
        return
      }
      try {
        const result = parseConstantsChildJson(stdout)
        if (result.candidateId !== candidate.id) {
          throw new Error(
            `constants child returned ${result.candidateId}; expected ${candidate.id}`,
          )
        }
        resolve(result)
      } catch (error) {
        resolve(serializeError(candidate.id, error))
      }
    })
  })
}

/**
 * Spawn one process for one candidate so the process-lifetime session law cannot pollute RSS.
 * This dev-only benchmark exception lives under tools/; production knowledge-local never spawns.
 */
export function measureConstants(
  candidate: BenchCandidate,
  options: MeasureConstantsOptions = {},
): Promise<CandidateConstantsResult> {
  const settings = validatePerformanceConfig(
    options.performance ?? DEFAULT_PERFORMANCE_CONFIG,
  )
  return withResolvedCorpusSnapshot(options, (snapshot) =>
    spawnConstantsCandidate(
      candidate,
      snapshot,
      settings,
      options.allowDownload ?? true,
      options.spawnProcess ?? spawn,
    ),
  )
}

export function measureAllConstants(
  candidates: readonly BenchCandidate[],
  options: MeasureConstantsOptions = {},
): Promise<CandidateConstantsResult[]> {
  const settings = validatePerformanceConfig(
    options.performance ?? DEFAULT_PERFORMANCE_CONFIG,
  )
  if (candidates.length === 0) return Promise.resolve([])
  return withResolvedCorpusSnapshot(options, async (snapshot) => {
    const results: CandidateConstantsResult[] = []
    for (const candidate of candidates) {
      results.push(
        await spawnConstantsCandidate(
          candidate,
          snapshot,
          settings,
          options.allowDownload ?? true,
          options.spawnProcess ?? spawn,
        ),
      )
    }
    return results
  })
}

async function runChild(encodedPayload: string | undefined): Promise<void> {
  if (encodedPayload === undefined) throw new TypeError('constants child payload is missing')
  const decoded = JSON.parse(
    Buffer.from(encodedPayload, 'base64url').toString('utf8'),
  ) as unknown
  const record = recordAt(decoded, 'constants child payload')
  const [candidate] = parseCandidates([record.candidate])
  const corpusPath = stringAt(record.corpusPath, 'constants child payload.corpusPath')
  const corpusSha256 = stringAt(
    record.corpusSha256,
    'constants child payload.corpusSha256',
  )
  if (!/^[a-f\d]{64}$/u.test(corpusSha256)) {
    throw new TypeError('constants child payload.corpusSha256 must be a SHA-256 hex digest')
  }
  if (typeof record.allowDownload !== 'boolean') {
    throw new TypeError('constants child payload.allowDownload must be a boolean')
  }
  const payload: ConstantsChildPayload = {
    candidate: candidate!,
    corpusPath,
    corpusSha256,
    performance: validatePerformanceConfig(record.performance),
    allowDownload: record.allowDownload,
  }
  let result: CandidateConstantsResult
  try {
    result = await measureChild(payload)
  } catch (error) {
    result = serializeError(payload.candidate.id, error)
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[2] === CHILD_FLAG) {
  runChild(process.argv[3]).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
