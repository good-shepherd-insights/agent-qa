import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import type {
  BenchCandidate,
  BenchCorpus,
  BenchEmbedder,
} from './runner'

export interface CandidateConstantsSuccess {
  candidateId: string
  status: 'ok'
  platform: NodeJS.Platform
  arch: string
  sample: {
    singleDocuments: number
    batchedDocuments: number
    batchSize: number
    topKDocuments: number
    topK: number
    topKIterations: number
  }
  warmModelLoadMs: number
  singleDocumentDocsPerSecond: number
  batchedDocsPerSecond: number
  rssBytes: number
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
}

const CHILD_FLAG = '--constants-child'
const SINGLE_DOCUMENT_SAMPLES = 20
const BATCHED_DOCUMENT_SAMPLES = 200
const BATCH_SIZE = 16
const TOP_K = 5
const TOP_K_ITERATIONS = 25

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

function metric(value: number): number {
  return Number(value.toFixed(6))
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

function bruteTopK(query: Float32Array, vectors: readonly Float32Array[]): number[] {
  return vectors
    .map((vector, index) => ({ index, similarity: dot(query, vector) }))
    .sort(
      (left, right) => right.similarity - left.similarity || left.index - right.index,
    )
    .slice(0, TOP_K)
    .map(({ index }) => index)
}

function averageDurationMs(operation: () => void): number {
  const start = performance.now()
  for (let iteration = 0; iteration < TOP_K_ITERATIONS; iteration += 1) operation()
  return (performance.now() - start) / TOP_K_ITERATIONS
}

async function createRuntime(candidate: BenchCandidate): Promise<{
  embedder: BenchEmbedder
  profile: ReturnType<(typeof import('./runner'))['candidateProfile']>
}> {
  const runner = (await import(
    new URL('./runner.ts', import.meta.url).href
  )) as typeof import('./runner')
  const profile = runner.candidateProfile(candidate)
  return {
    profile,
    embedder: await runner.createCandidateEmbedder(candidate, profile),
  }
}

async function loadCorpusRenderings(): Promise<string[]> {
  const raw = await readFile(new URL('../corpus/corpus.json', import.meta.url), 'utf8')
  const corpus = JSON.parse(raw) as BenchCorpus
  const renderings = corpus.documents.map(({ text }) => text)
  if (renderings.length < BATCHED_DOCUMENT_SAMPLES) {
    throw new Error(
      `constants measurement requires at least ${BATCHED_DOCUMENT_SAMPLES} corpus documents`,
    )
  }
  return renderings.slice(0, BATCHED_DOCUMENT_SAMPLES)
}

async function measureChild(candidate: BenchCandidate): Promise<CandidateConstantsSuccess> {
  const { resolveVecCapability, vecTableName } =
    await import('@vostride/agent-qa-knowledge-local')
  const renderings = await loadCorpusRenderings()
  const loadStarted = performance.now()
  const { embedder, profile } = await createRuntime(candidate)
  await embedder.embedDocument(renderings[0]!)
  const warmModelLoadMs = performance.now() - loadStarted

  const singleStarted = performance.now()
  for (const rendering of renderings.slice(0, SINGLE_DOCUMENT_SAMPLES)) {
    await embedder.embedDocument(rendering)
  }
  const singleElapsedSeconds = (performance.now() - singleStarted) / 1_000

  const vectors: Float32Array[] = []
  const batchedStarted = performance.now()
  for (let offset = 0; offset < renderings.length; offset += BATCH_SIZE) {
    const batch = renderings.slice(offset, offset + BATCH_SIZE)
    vectors.push(
      ...(await Promise.all(batch.map((rendering) => embedder.embedDocument(rendering)))),
    )
  }
  const batchedElapsedSeconds = (performance.now() - batchedStarted) / 1_000
  const query = await embedder.embedQuery(renderings[0]!)

  const bruteTopKMs = averageDurationMs(() => {
    bruteTopK(query, vectors)
  })
  let vec0TopKMs: number | null = null
  const db = new DatabaseSync(':memory:', { allowExtension: true })
  try {
    if (resolveVecCapability(db) === 'vec0') {
      const tableName = vecTableName(profile)
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
      const search = db.prepare(`
        SELECT record_rowid, distance
        FROM ${tableName}
        WHERE embedding MATCH ? AND product = ? AND k = ?
        ORDER BY distance, record_rowid
      `)
      const queryBlob = vectorBlob(query)
      vec0TopKMs = averageDurationMs(() => {
        search.all(queryBlob, 'bench', TOP_K)
      })
    }
  } finally {
    db.close()
  }

  return {
    candidateId: candidate.id,
    status: 'ok',
    platform: process.platform,
    arch: process.arch,
    sample: {
      singleDocuments: SINGLE_DOCUMENT_SAMPLES,
      batchedDocuments: renderings.length,
      batchSize: BATCH_SIZE,
      topKDocuments: vectors.length,
      topK: TOP_K,
      topKIterations: TOP_K_ITERATIONS,
    },
    warmModelLoadMs: metric(warmModelLoadMs),
    singleDocumentDocsPerSecond: metric(SINGLE_DOCUMENT_SAMPLES / singleElapsedSeconds),
    batchedDocsPerSecond: metric(renderings.length / batchedElapsedSeconds),
    rssBytes: process.memoryUsage().rss,
    bruteTopKMs: metric(bruteTopKMs),
    vec0TopKMs: vec0TopKMs === null ? null : metric(vec0TopKMs),
  }
}

function parseChildJson(stdout: string): CandidateConstantsResult {
  const lines = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]!) as CandidateConstantsResult
    } catch {
      // Native libraries may log before the final JSON line; only the final parseable row counts.
    }
  }
  throw new SyntaxError('constants child produced no JSON result')
}

/**
 * Spawn one process for one candidate so the process-lifetime session law cannot pollute RSS.
 * This dev-only benchmark exception lives under tools/; production knowledge-local never spawns.
 */
export function measureConstants(
  candidate: BenchCandidate,
  options: MeasureConstantsOptions = {},
): Promise<CandidateConstantsResult> {
  const spawnProcess = options.spawnProcess ?? spawn
  const encodedCandidate = Buffer.from(JSON.stringify(candidate)).toString('base64url')
  return new Promise((resolve) => {
    const child = spawnProcess(
      process.execPath,
      [fileURLToPath(import.meta.url), CHILD_FLAG, encodedCandidate],
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
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(
          serializeError(
            candidate.id,
            new Error(stderr.trim() || `constants child exited with code ${String(code)}`),
          ),
        )
        return
      }
      try {
        resolve(parseChildJson(stdout))
      } catch (error) {
        resolve(serializeError(candidate.id, error))
      }
    })
  })
}

export async function measureAllConstants(
  candidates: readonly BenchCandidate[],
): Promise<CandidateConstantsResult[]> {
  const results: CandidateConstantsResult[] = []
  for (const candidate of candidates) results.push(await measureConstants(candidate))
  return results
}

async function runChild(encodedCandidate: string | undefined): Promise<void> {
  if (encodedCandidate === undefined) throw new TypeError('constants child candidate is missing')
  const candidate = JSON.parse(
    Buffer.from(encodedCandidate, 'base64url').toString('utf8'),
  ) as BenchCandidate
  let result: CandidateConstantsResult
  try {
    result = await measureChild(candidate)
  } catch (error) {
    result = serializeError(candidate.id, error)
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[2] === CHILD_FLAG) {
  runChild(process.argv[3]).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
