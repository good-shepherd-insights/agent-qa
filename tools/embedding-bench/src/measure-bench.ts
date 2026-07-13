import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  AuthoredQueries,
  BenchCandidate,
  BenchCorpus,
  BenchRunResult,
  CandidateBenchResult,
  RunBenchOptions,
} from './runner'

const CHILD_FLAG = '--bench-candidate-child'

export interface MeasureBenchOptions {
  spawnProcess?: typeof spawn
  measureCandidate?: (candidate: BenchCandidate) => Promise<CandidateBenchResult>
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
    try {
      const value = JSON.parse(lines[index]!) as CandidateBenchResult
      if (
        typeof value === 'object' &&
        value !== null &&
        typeof value.candidateId === 'string' &&
        (value.status === 'ok' || value.status === 'error')
      ) {
        return value
      }
    } catch {
      // Native libraries may log before the final JSON row.
    }
  }
  throw new SyntaxError('candidate child produced no result JSON')
}

function spawnCandidate(
  candidate: BenchCandidate,
  spawnProcess: typeof spawn,
): Promise<CandidateBenchResult> {
  const encodedCandidate = Buffer.from(JSON.stringify(candidate)).toString('base64url')
  return new Promise((resolveResult) => {
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
    child.on('error', (error) => resolveResult(candidateError(candidate.id, error)))
    child.on('close', (code, signal) => {
      if (code !== 0) {
        resolveResult(
          candidateError(
            candidate.id,
            new Error(
              stderr.trim() ||
                `candidate child exited with ${signal === null ? `code ${String(code)}` : `signal ${signal}`}`,
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
  const measure =
    measurementOptions.measureCandidate ??
    ((candidate: BenchCandidate) =>
      spawnCandidate(candidate, measurementOptions.spawnProcess ?? spawn))
  const results: CandidateBenchResult[] = []
  for (const candidate of options.candidates) {
    const result = await measure(candidate)
    results.push(result)
    process.stderr.write(`[embedding-bench] ${candidate.id}: ${result.status}\n`)
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

async function runChild(encodedCandidate: string | undefined): Promise<void> {
  if (encodedCandidate === undefined) throw new TypeError('candidate child is missing')
  const candidate = JSON.parse(
    Buffer.from(encodedCandidate, 'base64url').toString('utf8'),
  ) as BenchCandidate
  const [corpusRaw, authoredRaw] = await Promise.all([
    readFile(new URL('../corpus/corpus.json', import.meta.url), 'utf8'),
    readFile(new URL('../fixtures/authored-queries.json', import.meta.url), 'utf8'),
  ])
  const runner = (await import(
    new URL('./runner.ts', import.meta.url).href
  )) as typeof import('./runner')
  const result = await runner.runBench({
    candidates: [candidate],
    corpus: JSON.parse(corpusRaw) as BenchCorpus,
    authored: JSON.parse(authoredRaw) as AuthoredQueries,
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
