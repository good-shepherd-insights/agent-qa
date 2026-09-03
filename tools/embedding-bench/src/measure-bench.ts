import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  AuthoredQueries,
  BenchCandidate,
  BenchCorpus,
  BenchRunResult,
  CandidateBenchResult,
  HitRates,
  RunBenchOptions,
} from './runner.ts'

const CHILD_FLAG = '--bench-candidate-child'
const RATE_TOLERANCE = 1e-12
const ATTAINABLE_HIT_TOLERANCE = 1e-9
const COSINE_TOLERANCE = 2e-3

export interface MeasureBenchOptions {
  spawnProcess?: typeof spawn
  measureCandidate?: (candidate: BenchCandidate) => Promise<CandidateBenchResult>
}

interface BenchInputPaths {
  corpusPath: string
  authoredQueriesPath: string
}

interface CandidateChildPayload {
  candidate: BenchCandidate
  inputPaths: BenchInputPaths
  allowDownload: boolean
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
  options: { minimum?: number; maximum?: number; integer?: boolean } = {},
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
  if (options.maximum !== undefined && value > options.maximum) {
    throw new RangeError(`${path} must be at most ${options.maximum}`)
  }
  return value
}

function validateHitRates(
  value: unknown,
  path: string,
  requireAttainableHits = false,
): HitRates {
  const rates = recordAt(value, path)
  const queries = finiteAt(rates.queries, `${path}.queries`, {
    minimum: 0,
    integer: true,
  })
  const hitAt1 = finiteAt(rates.hitAt1, `${path}.hitAt1`, {
    minimum: 0,
    maximum: 1,
  })
  const hitAt3 = finiteAt(rates.hitAt3, `${path}.hitAt3`, {
    minimum: 0,
    maximum: 1,
  })
  const hitAt5 = finiteAt(rates.hitAt5, `${path}.hitAt5`, {
    minimum: 0,
    maximum: 1,
  })
  if (hitAt1 > hitAt3 || hitAt3 > hitAt5) {
    throw new RangeError(`${path} hit rates must be monotonic from hit@1 through hit@5`)
  }
  if (requireAttainableHits) {
    for (const [name, rate] of [
      ['hitAt1', hitAt1],
      ['hitAt3', hitAt3],
      ['hitAt5', hitAt5],
    ] as const) {
      const hits = rate * queries
      if (Math.abs(hits - Math.round(hits)) > ATTAINABLE_HIT_TOLERANCE) {
        throw new RangeError(
          `${path}.${name} cannot be produced by an integer hit count across ${queries} queries`,
        )
      }
    }
  }
  return { queries, hitAt1, hitAt3, hitAt5 }
}

function validateSlice(value: unknown, path: string): HitRates {
  const slice = recordAt(value, path)
  const perApp = recordAt(slice.perApp, `${path}.perApp`)
  const parsedPerApp: HitRates[] = []
  for (const [app, rates] of Object.entries(perApp)) {
    if (app.length === 0) throw new TypeError(`${path}.perApp keys must be nonempty`)
    parsedPerApp.push(
      validateHitRates(rates, `${path}.perApp.${app}`, true),
    )
  }
  const macro = validateHitRates(slice.macro, `${path}.macro`)
  const expectedMacro = parsedPerApp.reduce(
    (accumulator, rates) => ({
      queries: accumulator.queries + rates.queries,
      hitAt1: accumulator.hitAt1 + rates.hitAt1,
      hitAt3: accumulator.hitAt3 + rates.hitAt3,
      hitAt5: accumulator.hitAt5 + rates.hitAt5,
    }),
    { queries: 0, hitAt1: 0, hitAt3: 0, hitAt5: 0 },
  )
  if (parsedPerApp.length > 0) {
    expectedMacro.hitAt1 /= parsedPerApp.length
    expectedMacro.hitAt3 /= parsedPerApp.length
    expectedMacro.hitAt5 /= parsedPerApp.length
  }
  if (
    macro.queries !== expectedMacro.queries ||
    Math.abs(macro.hitAt1 - expectedMacro.hitAt1) > RATE_TOLERANCE ||
    Math.abs(macro.hitAt3 - expectedMacro.hitAt3) > RATE_TOLERANCE ||
    Math.abs(macro.hitAt5 - expectedMacro.hitAt5) > RATE_TOLERANCE
  ) {
    throw new RangeError(`${path}.macro must be the unweighted mean of per-app hit rates`)
  }
  return macro
}

function validateCosineArray(value: unknown, path: string): number[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`)
  return value.map((entry, index) =>
    finiteAt(entry, `${path}[${index}]`, {
      minimum: -1 - COSINE_TOLERANCE,
      maximum: 1 + COSINE_TOLERANCE,
    }),
  )
}

function validateDistribution(value: unknown, path: string, queries: number): void {
  const distribution = recordAt(value, path)
  const gold = validateCosineArray(
    distribution.goldPairCosines,
    `${path}.goldPairCosines`,
  )
  const random = validateCosineArray(
    distribution.randomPairCosines,
    `${path}.randomPairCosines`,
  )
  if (gold.length < queries) {
    throw new RangeError(`${path}.goldPairCosines must contain at least one value per query`)
  }
  if (random.length > queries) {
    throw new RangeError(`${path}.randomPairCosines cannot contain more than one value per query`)
  }
}

function validateProfile(value: unknown, path: string): void {
  const profile = recordAt(value, path)
  stringAt(profile.model_id, `${path}.model_id`)
  stringAt(profile.revision, `${path}.revision`)
  finiteAt(profile.dim, `${path}.dim`, { minimum: 1, integer: true })
  if (profile.dtype !== 'q8') throw new TypeError(`${path}.dtype must be "q8"`)
  if (profile.pooling !== 'mean' && profile.pooling !== 'cls') {
    throw new TypeError(`${path}.pooling must be "mean" or "cls"`)
  }
  if (profile.normalize !== true) throw new TypeError(`${path}.normalize must be true`)
  if (typeof profile.query_prefix !== 'string') {
    throw new TypeError(`${path}.query_prefix must be a string`)
  }
  if (typeof profile.doc_prefix !== 'string') {
    throw new TypeError(`${path}.doc_prefix must be a string`)
  }
  if (profile.backend !== 'node' && profile.backend !== 'static') {
    throw new TypeError(`${path}.backend must be "node" or "static"`)
  }
  recordAt(profile.session_options, `${path}.session_options`)
}

export function validateCandidateBenchResult(value: unknown): CandidateBenchResult {
  const result = recordAt(value, 'candidate result')
  stringAt(result.candidateId, 'candidate result.candidateId')
  if (result.status === 'error') {
    const error = recordAt(result.error, 'candidate result.error')
    stringAt(error.name, 'candidate result.error.name')
    stringAt(error.message, 'candidate result.error.message')
    return value as CandidateBenchResult
  }
  if (result.status !== 'ok') {
    throw new TypeError('candidate result.status must be "ok" or "error"')
  }
  validateProfile(result.profile, 'candidate result.profile')
  const slices = recordAt(result.slices, 'candidate result.slices')
  const recorded = validateSlice(slices.recorded, 'candidate result.slices.recorded')
  const authored = validateSlice(slices.authored, 'candidate result.slices.authored')
  const distributions = recordAt(result.distributions, 'candidate result.distributions')
  validateDistribution(
    distributions.recorded,
    'candidate result.distributions.recorded',
    recorded.queries,
  )
  validateDistribution(
    distributions.authored,
    'candidate result.distributions.authored',
    authored.queries,
  )
  return value as CandidateBenchResult
}

function candidateError(candidateId: string, error: unknown): CandidateBenchResult {
  return {
    candidateId,
    status: 'error',
    error: {
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
    },
  }
}

export function parseCandidateChildJson(stdout: string): CandidateBenchResult {
  const lines = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let value: unknown
    try {
      value = JSON.parse(lines[index]!) as unknown
    } catch {
      // Native libraries may log before the final JSON row.
      continue
    }
    return validateCandidateBenchResult(value)
  }
  throw new SyntaxError('candidate child produced no result JSON')
}

async function withBenchInputSnapshot<T>(
  corpus: BenchCorpus,
  authored: AuthoredQueries,
  operation: (paths: BenchInputPaths) => Promise<T>,
): Promise<T> {
  // Serialize before creating the directory so even serialization failures leave no residue.
  const corpusJson = `${JSON.stringify(corpus)}\n`
  const authoredJson = `${JSON.stringify(authored)}\n`
  const directory = await mkdtemp(join(tmpdir(), 'agent-qa-embedding-bench-'))
  const paths: BenchInputPaths = {
    corpusPath: join(directory, 'corpus.json'),
    authoredQueriesPath: join(directory, 'authored-queries.json'),
  }
  try {
    await Promise.all([
      writeFile(paths.corpusPath, corpusJson, { encoding: 'utf8', flag: 'wx', mode: 0o600 }),
      writeFile(paths.authoredQueriesPath, authoredJson, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      }),
    ])
    return await operation(paths)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function spawnCandidate(
  candidate: BenchCandidate,
  spawnProcess: typeof spawn,
  inputPaths: BenchInputPaths,
  allowDownload: boolean,
): Promise<CandidateBenchResult> {
  const payload: CandidateChildPayload = { candidate, inputPaths, allowDownload }
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return new Promise((resolveResult) => {
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
    child.on('error', (error) => resolveResult(candidateError(candidate.id, error)))
    child.on('close', (code, signal) => {
      if (code !== 0) {
        resolveResult(
          candidateError(
            candidate.id,
            new Error(
              stderr.trim() ||
                `candidate child exited with ${
                  signal === null ? `code ${String(code)}` : `signal ${signal}`
                }`,
            ),
          ),
        )
        return
      }
      try {
        const result = parseCandidateChildJson(stdout)
        if (result.candidateId !== candidate.id) {
          throw new Error(
            `candidate child returned ${result.candidateId}; expected ${candidate.id}`,
          )
        }
        resolveResult(result)
      } catch (error) {
        resolveResult(candidateError(candidate.id, error))
      }
    })
  })
}

/**
 * Run one candidate per process. Native ONNX sessions live until process exit, so this is the
 * only way the dev-only bench can keep later candidates independent on canonical 7 GiB runners.
 */
export async function measureAllCandidates(
  options: RunBenchOptions,
  measurementOptions: MeasureBenchOptions = {},
): Promise<BenchRunResult> {
  if (options.createEmbedder !== undefined) {
    throw new TypeError(
      'measureAllCandidates cannot isolate RunBenchOptions.createEmbedder in child processes',
    )
  }
  const counts = {
    documents: options.corpus.documents.length,
    recorded: options.corpus.recordedQueries.length,
    authored: options.authored.queries.length,
  }

  const runSequentially = async (
    measure: (candidate: BenchCandidate) => Promise<CandidateBenchResult>,
  ): Promise<CandidateBenchResult[]> => {
    const results: CandidateBenchResult[] = []
    for (const candidate of options.candidates) {
      let result: CandidateBenchResult
      try {
        result = validateCandidateBenchResult(await measure(candidate))
        if (result.candidateId !== candidate.id) {
          throw new Error(
            `candidate measurement returned ${result.candidateId}; expected ${candidate.id}`,
          )
        }
      } catch (error) {
        result = candidateError(candidate.id, error)
      }
      results.push(result)
      process.stderr.write(`[embedding-bench] ${candidate.id}: ${result.status}\n`)
    }
    return results
  }

  const results =
    measurementOptions.measureCandidate === undefined
      ? await withBenchInputSnapshot(options.corpus, options.authored, (inputPaths) =>
          runSequentially((candidate) =>
            spawnCandidate(
              candidate,
              measurementOptions.spawnProcess ?? spawn,
              inputPaths,
              options.allowDownload ?? true,
            ),
          ),
        )
      : await runSequentially(measurementOptions.measureCandidate)

  return {
    schemaVersion: 1,
    documents: counts.documents,
    queries: {
      recorded: counts.recorded,
      authored: counts.authored,
    },
    candidates: results,
  }
}

async function runChild(encodedPayload: string | undefined): Promise<void> {
  if (encodedPayload === undefined) throw new TypeError('candidate child payload is missing')
  const payload = JSON.parse(
    Buffer.from(encodedPayload, 'base64url').toString('utf8'),
  ) as CandidateChildPayload
  const { candidate, inputPaths, allowDownload } = payload
  const [corpusRaw, authoredRaw] = await Promise.all([
    readFile(inputPaths.corpusPath, 'utf8'),
    readFile(inputPaths.authoredQueriesPath, 'utf8'),
  ])
  const runner: typeof import('./runner') = await import(
    new URL('./runner.ts', import.meta.url).href
  )
  const corpus = JSON.parse(corpusRaw) as unknown
  const authored = JSON.parse(authoredRaw) as unknown
  runner.assertBenchCorpus(corpus)
  runner.assertAuthoredQueries(authored)
  const result = await runner.runBench({
    candidates: [candidate],
    corpus,
    authored,
    allowDownload,
  })
  process.stdout.write(`${JSON.stringify(result.candidates[0])}\n`)
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
  process.argv[2] === CHILD_FLAG
) {
  runChild(process.argv[3]).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    process.exitCode = 1
  })
}
