import type { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { access, readFile } from 'node:fs/promises'
import { PassThrough } from 'node:stream'

import { describe, expect, it } from 'vitest'

import {
  measureAllCandidates,
  parseCandidateChildJson,
} from '../measure-bench'
import type {
  AuthoredQueries,
  BenchCandidate,
  BenchCorpus,
  CandidateBenchResult,
} from '../runner'

function candidate(id: string): BenchCandidate {
  return {
    id,
    model_id: `fixture/${id}`,
    backend: 'node',
    artifact: 'fixture',
    revision: '0123456789abcdef0123456789abcdef01234567',
    dtype: 'q8',
    dim: 2,
    pooling: 'mean',
    normalize: true,
    max_tokens: 512,
    query_prefix: '',
    doc_prefix: '',
  }
}

const corpus: BenchCorpus = {
  documents: [],
  recordedQueries: [],
}

const authored: AuthoredQueries = {
  provenance: { slice: 'fixture' },
  queries: [],
}

function successfulResult(id: string): CandidateBenchResult {
  return {
    candidateId: id,
    status: 'ok',
    profile: {
      model_id: `fixture/${id}`,
      revision: '0123456789abcdef0123456789abcdef01234567',
      dim: 2,
      dtype: 'q8',
      pooling: 'mean',
      normalize: true,
      query_prefix: '',
      doc_prefix: '',
      backend: 'node',
      session_options: {},
    },
    slices: {
      recorded: {
        perApp: {},
        macro: { queries: 0, hitAt1: 0, hitAt3: 0, hitAt5: 0 },
      },
      authored: {
        perApp: {},
        macro: { queries: 0, hitAt1: 0, hitAt3: 0, hitAt5: 0 },
      },
    },
    distributions: {
      recorded: { goldPairCosines: [], randomPairCosines: [] },
      authored: { goldPairCosines: [], randomPairCosines: [] },
    },
  }
}

describe('isolated candidate measurement', () => {
  it('parses the final JSON row after native-library diagnostics', () => {
    expect(
      parseCandidateChildJson(
        `native warning\n${JSON.stringify({
          candidateId: 'fixture',
          status: 'error',
          error: { name: 'Error', message: 'failed' },
        })}\n`,
      ),
    ).toMatchObject({ candidateId: 'fixture', status: 'error' })
  })

  it('rejects a parseable child row with an incomplete success payload', () => {
    expect(() =>
      parseCandidateChildJson('{"candidateId":"fixture","status":"ok"}\n'),
    ).toThrow(/candidate result\.profile/u)
  })

  it('rejects non-finite or out-of-range quality metrics', () => {
    const result = successfulResult('fixture')
    if (result.status !== 'ok') throw new Error('fixture must be successful')
    result.slices.recorded.macro.hitAt1 = 2
    expect(() => parseCandidateChildJson(`${JSON.stringify(result)}\n`)).toThrow(
      /hitAt1 must be at most 1/u,
    )
  })

  it('rejects unattainable per-app hit fractions and macros not derived from apps', () => {
    const unattainable = successfulResult('fixture')
    if (unattainable.status !== 'ok') throw new Error('fixture must be successful')
    unattainable.slices.recorded = {
      perApp: {
        fixture: { queries: 3, hitAt1: 0.5, hitAt3: 2 / 3, hitAt5: 1 },
      },
      macro: { queries: 3, hitAt1: 0.5, hitAt3: 2 / 3, hitAt5: 1 },
    }
    expect(() =>
      parseCandidateChildJson(`${JSON.stringify(unattainable)}\n`),
    ).toThrow(/cannot be produced by an integer hit count/u)

    const macroDrift = successfulResult('fixture')
    if (macroDrift.status !== 'ok') throw new Error('fixture must be successful')
    macroDrift.slices.recorded = {
      perApp: {
        fixture: { queries: 3, hitAt1: 1 / 3, hitAt3: 2 / 3, hitAt5: 1 },
      },
      macro: { queries: 3, hitAt1: 1 / 3, hitAt3: 2 / 3, hitAt5: 0.9 },
    }
    expect(() =>
      parseCandidateChildJson(`${JSON.stringify(macroDrift)}\n`),
    ).toThrow(/macro must be the unweighted mean of per-app hit rates/u)
  })

  it('rejects missing or physically impossible cosine calibration evidence', () => {
    const missingGold = successfulResult('fixture')
    if (missingGold.status !== 'ok') throw new Error('fixture must be successful')
    missingGold.slices.recorded = {
      perApp: {
        fixture: { queries: 1, hitAt1: 1, hitAt3: 1, hitAt5: 1 },
      },
      macro: { queries: 1, hitAt1: 1, hitAt3: 1, hitAt5: 1 },
    }
    expect(() =>
      parseCandidateChildJson(`${JSON.stringify(missingGold)}\n`),
    ).toThrow(/goldPairCosines must contain at least one value per query/u)

    const impossibleCosine = structuredClone(missingGold)
    impossibleCosine.distributions.recorded.goldPairCosines = [2]
    expect(() =>
      parseCandidateChildJson(`${JSON.stringify(impossibleCosine)}\n`),
    ).toThrow(/goldPairCosines\[0\] must be at most/u)
  })

  it('measures candidates sequentially and preserves truthful errors', async () => {
    let active = 0
    let maximumActive = 0
    const order: string[] = []
    const result = await measureAllCandidates(
      { candidates: [candidate('first'), candidate('second')], corpus, authored },
      {
        measureCandidate: async (entry): Promise<CandidateBenchResult> => {
          active += 1
          maximumActive = Math.max(maximumActive, active)
          order.push(entry.id)
          await Promise.resolve()
          active -= 1
          return {
            candidateId: entry.id,
            status: 'error',
            error: { name: 'Error', message: `${entry.id} failed` },
          }
        },
      },
    )

    expect(maximumActive).toBe(1)
    expect(order).toEqual(['first', 'second'])
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[1]).toMatchObject({
      candidateId: 'second',
      status: 'error',
      error: { message: 'second failed' },
    })
  })

  it('snapshots in-memory inputs once for every child and removes the snapshot', async () => {
    const encodedPayloads: string[] = []
    const observedInputs: Array<{ corpus: unknown; authored: unknown }> = []
    const fakeSpawn = ((_command: string, args: readonly string[]) => {
      encodedPayloads.push(args[2]!)
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
            inputPaths: { corpusPath: string; authoredQueriesPath: string }
          }
          observedInputs.push({
            corpus: JSON.parse(await readFile(payload.inputPaths.corpusPath, 'utf8')),
            authored: JSON.parse(
              await readFile(payload.inputPaths.authoredQueriesPath, 'utf8'),
            ),
          })
          child.stdout.write(`${JSON.stringify(successfulResult(payload.candidate.id))}\n`)
          child.emit('close', 0, null)
        })().catch((error: unknown) => child.emit('error', error))
      })
      return child
    }) as unknown as typeof spawn

    await measureAllCandidates(
      {
        candidates: [candidate('first'), candidate('second')],
        corpus,
        authored,
        allowDownload: false,
      },
      {
        spawnProcess: fakeSpawn,
      },
    )

    const payloads = encodedPayloads.map(
      (encoded) =>
        JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
          candidate: BenchCandidate
          inputPaths: { corpusPath: string; authoredQueriesPath: string }
          allowDownload: boolean
        },
    )
    expect(payloads.map(({ candidate: entry }) => entry.id)).toEqual(['first', 'second'])
    expect(payloads[0]!.inputPaths).toEqual(payloads[1]!.inputPaths)
    expect(payloads.every(({ allowDownload }) => allowDownload === false)).toBe(true)
    expect(observedInputs).toEqual([
      { corpus, authored },
      { corpus, authored },
    ])
    await expect(access(payloads[0]!.inputPaths.corpusPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('does not silently discard an in-process embedder factory', async () => {
    await expect(
      measureAllCandidates({
        candidates: [candidate('first')],
        corpus,
        authored,
        createEmbedder: async () => ({
          embedDocument: async () => new Float32Array([1, 0]),
          embedQuery: async () => new Float32Array([1, 0]),
        }),
      }),
    ).rejects.toThrow(/cannot isolate RunBenchOptions\.createEmbedder/u)
  })

  it('attributes a mismatched custom result to the requested candidate as an error', async () => {
    const result = await measureAllCandidates(
      { candidates: [candidate('expected')], corpus, authored },
      { measureCandidate: async () => successfulResult('wrong') },
    )
    expect(result.candidates[0]).toMatchObject({
      candidateId: 'expected',
      status: 'error',
      error: { message: 'candidate measurement returned wrong; expected expected' },
    })
  })
})
