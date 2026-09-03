import { execFile, type spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import {
  attributableRssDeltaBytes,
  effectivePerformanceSample,
  measureAllConstants,
  measureConstants,
  parseConstantsChildJson,
  type CandidateConstantsSuccess,
} from '../measure-constants'
import type { BenchCandidate } from '../runner'

const candidate: BenchCandidate = {
  id: 'fixture-model',
  model_id: 'fixture/model',
  backend: 'node',
  artifact: 'fixture',
  revision: '0123456789abcdef0123456789abcdef01234567',
  dtype: 'q8',
  dim: 2,
  pooling: 'mean',
  normalize: true,
  max_tokens: 128,
  query_prefix: '',
  doc_prefix: '',
}

function success(candidateId = candidate.id): CandidateConstantsSuccess {
  return {
    candidateId,
    status: 'ok',
    platform: process.platform,
    arch: process.arch,
    sample: {
      singleDocuments: 3,
      concurrentDocuments: 7,
      concurrency: 2,
      topKDocuments: 7,
      topK: 3,
      topKIterations: 4,
    },
    timeToFirstEmbeddingMs: 10,
    singleDocumentDocsPerSecond: 20,
    singleDocumentLatencyMs: { p50: 1, p95: 2 },
    concurrentDocsPerSecond: 30,
    rssBaselineBytes: 100,
    rssPeakBytes: 180,
    rssDeltaBytes: 80,
    vectorBytesPerDocument: 8,
    bruteTopKMs: 0.1,
    vec0TopKMs: null,
  }
}

const fixtureCorpus = {
  documents: [
    {
      id: 'doc-1',
      kind: 'page',
      text: 'first fixture document',
      apps: ['fixture'],
      sourcePaths: ['fixture/doc-1'],
    },
    {
      id: 'doc-2',
      kind: 'page',
      text: 'second fixture document',
      apps: ['fixture'],
      sourcePaths: ['fixture/doc-2'],
    },
  ],
  recordedQueries: [],
} as const

const performanceConfig = {
  singleDocumentSamples: 3,
  concurrentDocumentSamples: 7,
  concurrency: 2,
  topK: 3,
  topKIterations: 4,
}

const execFileAsync = promisify(execFile)

async function fixtureCorpusFile(): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'agent-qa-constants-test-'))
  const path = join(directory, 'corpus.json')
  await writeFile(path, `${JSON.stringify(fixtureCorpus)}\n`, 'utf8')
  return { directory, path }
}

describe('constants measurement orchestration', () => {
  it('does not attribute a pre-baseline lifetime RSS peak to the candidate', () => {
    expect(attributableRssDeltaBytes(100, 300, 100, 300)).toBe(0)
    expect(attributableRssDeltaBytes(100, 300, 150, 300)).toBe(50)
    expect(attributableRssDeltaBytes(100, 300, 110, 340)).toBe(240)
  })

  it('parses the last JSON row after runtime diagnostics', () => {
    expect(
      parseConstantsChildJson(`native diagnostic\n${JSON.stringify(success())}\n`),
    ).toEqual(success())
  })

  it('rejects incomplete or impossible success metrics', () => {
    const missing = { ...success(), timeToFirstEmbeddingMs: undefined }
    expect(() => parseConstantsChildJson(`${JSON.stringify(missing)}\n`)).toThrow(
      /timeToFirstEmbeddingMs must be a finite number/u,
    )

    const impossible = success()
    impossible.sample.topK = impossible.sample.topKDocuments + 1
    expect(() => parseConstantsChildJson(`${JSON.stringify(impossible)}\n`)).toThrow(
      /topK must not exceed topKDocuments/u,
    )
  })

  it('clamps reported concurrency and top-k to the actual corpus sample', () => {
    expect(effectivePerformanceSample(performanceConfig, 2)).toEqual({
      singleDocuments: 2,
      concurrentDocuments: 2,
      concurrency: 2,
      topKDocuments: 2,
      topK: 2,
      topKIterations: 4,
    })
  })

  it('rejects unsafe performance settings before reading or spawning', () => {
    expect(() =>
      measureConstants(candidate, {
        corpusPath: '/does/not/exist.json',
        performance: { ...performanceConfig, concurrency: 0 },
      }),
    ).toThrow(/concurrency must be a positive integer/u)
  })

  it('snapshots and hashes a custom corpus before passing it to the child', async () => {
    const fixture = await fixtureCorpusFile()
    let encodedPayload: string | undefined
    let observedRaw: Buffer | undefined
    try {
      const fakeSpawn = ((_command: string, args: readonly string[]) => {
        encodedPayload = args[2]
        const child = new EventEmitter() as EventEmitter & {
          stdout: PassThrough
          stderr: PassThrough
        }
        child.stdout = new PassThrough()
        child.stderr = new PassThrough()
        queueMicrotask(() => {
          void (async () => {
            const payload = JSON.parse(
              Buffer.from(args[2]!, 'base64url').toString('utf8'),
            ) as { corpusPath: string }
            observedRaw = await readFile(payload.corpusPath)
            child.stdout.write(`${JSON.stringify(success())}\n`)
            child.emit('close', 0, null)
          })().catch((error: unknown) => child.emit('error', error))
        })
        return child
      }) as unknown as typeof spawn

      const result = await measureConstants(candidate, {
        spawnProcess: fakeSpawn,
        corpusPath: fixture.path,
        allowDownload: false,
        performance: performanceConfig,
      })

      expect(result.status).toBe('ok')
      const payload = JSON.parse(
        Buffer.from(encodedPayload!, 'base64url').toString('utf8'),
      ) as {
        candidate: BenchCandidate
        corpusPath: string
        corpusSha256: string
        allowDownload: boolean
        performance: typeof performanceConfig
      }
      expect(payload).toMatchObject({
        candidate: { id: candidate.id },
        allowDownload: false,
        performance: performanceConfig,
      })
      expect(payload.corpusPath).not.toBe(fixture.path)
      expect(payload.corpusSha256).toBe(
        createHash('sha256').update(observedRaw!).digest('hex'),
      )
      await expect(access(payload.corpusPath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it('uses already-read corpus evidence after the original path mutates', async () => {
    const fixture = await fixtureCorpusFile()
    const originalRaw = await readFile(fixture.path)
    const originalSha256 = createHash('sha256').update(originalRaw).digest('hex')
    let observedRaw: Buffer | undefined
    let observedSha256: string | undefined
    try {
      await writeFile(
        fixture.path,
        `${JSON.stringify({
          documents: [
            {
              id: 'mutated-doc',
              kind: 'page',
              text: 'corpus content written after the report input was read',
              apps: ['fixture'],
              sourcePaths: ['fixture/mutated'],
            },
          ],
          recordedQueries: [],
        })}\n`,
        'utf8',
      )

      const fakeSpawn = ((_command: string, args: readonly string[]) => {
        const child = new EventEmitter() as EventEmitter & {
          stdout: PassThrough
          stderr: PassThrough
        }
        child.stdout = new PassThrough()
        child.stderr = new PassThrough()
        queueMicrotask(() => {
          void (async () => {
            const payload = JSON.parse(
              Buffer.from(args[2]!, 'base64url').toString('utf8'),
            ) as { corpusPath: string; corpusSha256: string }
            observedRaw = await readFile(payload.corpusPath)
            observedSha256 = payload.corpusSha256
            child.stdout.write(`${JSON.stringify(success())}\n`)
            child.emit('close', 0, null)
          })().catch((error: unknown) => child.emit('error', error))
        })
        return child
      }) as unknown as typeof spawn

      const result = await measureConstants(candidate, {
        spawnProcess: fakeSpawn,
        corpusRaw: originalRaw,
        performance: performanceConfig,
      })

      expect(result.status).toBe('ok')
      expect(observedRaw).toEqual(originalRaw)
      expect(observedSha256).toBe(originalSha256)
      await expect(readFile(fixture.path)).resolves.not.toEqual(originalRaw)
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it('verifies the corpus hash inside the real child before model work', async () => {
    const fixture = await fixtureCorpusFile()
    try {
      const payload = Buffer.from(
        JSON.stringify({
          candidate,
          corpusPath: fixture.path,
          corpusSha256: '0'.repeat(64),
          performance: performanceConfig,
          allowDownload: false,
        }),
      ).toString('base64url')
      const { stdout } = await execFileAsync(process.execPath, [
        fileURLToPath(new URL('../measure-constants.ts', import.meta.url)),
        '--constants-child',
        payload,
      ])
      expect(parseConstantsChildJson(stdout)).toMatchObject({
        candidateId: candidate.id,
        status: 'error',
        error: { message: expect.stringContaining('corpus snapshot SHA-256 mismatch') },
      })
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it('uses one immutable corpus snapshot for all candidates', async () => {
    const fixture = await fixtureCorpusFile()
    const secondCandidate = { ...candidate, id: 'fixture-model-2' }
    const observed: Array<{ path: string; raw: string; sha256: string }> = []
    try {
      const fakeSpawn = ((_command: string, args: readonly string[]) => {
        const child = new EventEmitter() as EventEmitter & {
          stdout: PassThrough
          stderr: PassThrough
        }
        child.stdout = new PassThrough()
        child.stderr = new PassThrough()
        queueMicrotask(() => {
          void (async () => {
            const payload = JSON.parse(
              Buffer.from(args[2]!, 'base64url').toString('utf8'),
            ) as {
              candidate: BenchCandidate
              corpusPath: string
              corpusSha256: string
            }
            observed.push({
              path: payload.corpusPath,
              raw: await readFile(payload.corpusPath, 'utf8'),
              sha256: payload.corpusSha256,
            })
            if (payload.candidate.id === candidate.id) {
              await writeFile(
                fixture.path,
                JSON.stringify({ documents: [], recordedQueries: [] }),
                'utf8',
              )
            }
            child.stdout.write(
              `${JSON.stringify(success(payload.candidate.id))}\n`,
            )
            child.emit('close', 0, null)
          })().catch((error: unknown) => child.emit('error', error))
        })
        return child
      }) as unknown as typeof spawn

      const results = await measureAllConstants([candidate, secondCandidate], {
        spawnProcess: fakeSpawn,
        corpusPath: fixture.path,
        performance: performanceConfig,
      })

      expect(results.map(({ candidateId }) => candidateId)).toEqual([
        candidate.id,
        secondCandidate.id,
      ])
      expect(observed).toHaveLength(2)
      expect(observed[0]!.path).toBe(observed[1]!.path)
      expect(observed[0]!.raw).toBe(observed[1]!.raw)
      expect(observed[0]!.sha256).toBe(observed[1]!.sha256)
      await expect(access(observed[0]!.path)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it('turns a child candidate-id mismatch into an attributed error', async () => {
    const fixture = await fixtureCorpusFile()
    try {
      const fakeSpawn = ((_command: string, _args: readonly string[]) => {
        const child = new EventEmitter() as EventEmitter & {
          stdout: PassThrough
          stderr: PassThrough
        }
        child.stdout = new PassThrough()
        child.stderr = new PassThrough()
        queueMicrotask(() => {
          child.stdout.write(`${JSON.stringify(success('wrong-model'))}\n`)
          child.emit('close', 0, null)
        })
        return child
      }) as unknown as typeof spawn

      const result = await measureConstants(candidate, {
        spawnProcess: fakeSpawn,
        corpusPath: fixture.path,
        performance: performanceConfig,
      })
      expect(result).toMatchObject({
        candidateId: candidate.id,
        status: 'error',
        error: { message: 'constants child returned wrong-model; expected fixture-model' },
      })
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })
})
