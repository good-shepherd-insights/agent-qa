import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { STATIC_FLOOR_EMBEDDING_PROFILE } from '@vostride/agent-qa-schema'
import { build } from 'tsup'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  discoverEmbedderWorker,
  resetEmbedderCapability,
  resolveEmbedderCapability,
} from '../embedder-acquire.js'
import { createFloorEmbedder } from '../embedder-floor.js'
import {
  EMBEDDER_WORKER_REGISTRATION_SCHEMA_VERSION,
  embedderWorkerAgentQaRoot,
  embedderWorkerRegistrationPath,
  embedderWorkerSocketPath,
  readEmbedderWorkerRegistration,
  writeEmbedderWorkerRegistration,
} from '../embedder-worker/worker-registration.js'

const packageRoot = fileURLToPath(new URL('../..', import.meta.url))
const roots: string[] = []
const children: ChildProcess[] = []
const originalCwd = process.cwd()
let workerEntryPath = ''
let workerBuildRoot = ''

function temporaryProject(label: string): string {
  const base = process.platform === 'win32' ? tmpdir() : '/tmp'
  const root = mkdtempSync(join(base, `agent-qa-embedder-worker-${label}-`))
  roots.push(root)
  return root
}

async function eventually(
  predicate: () => boolean,
  message: string | (() => string),
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(typeof message === 'function' ? message() : message)
}

function registration(
  projectRoot: string,
  overrides: Partial<{
    pid: number
    socketPath: string
  }> = {},
): void {
  const agentQaRoot = join(projectRoot, '.agent-qa')
  writeEmbedderWorkerRegistration(agentQaRoot, {
    schemaVersion: EMBEDDER_WORKER_REGISTRATION_SCHEMA_VERSION,
    pid: overrides.pid ?? process.pid,
    socketPath: overrides.socketPath ?? embedderWorkerSocketPath(agentQaRoot, projectRoot),
    profile: STATIC_FLOOR_EMBEDDING_PROFILE,
    startedAtMs: Date.now(),
  })
}

function rawWorkerRequest(socketPath: string, body: unknown): Promise<unknown> {
  const payload = JSON.stringify(body)
  return new Promise((resolveRequest, rejectRequest) => {
    const workerRequest = request(
      {
        socketPath,
        path: '/embed',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        response.on('end', () => {
          try {
            resolveRequest(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
          } catch (error) {
            rejectRequest(error)
          }
        })
      },
    )
    workerRequest.once('error', rejectRequest)
    workerRequest.end(payload)
  })
}

beforeAll(async () => {
  workerBuildRoot = mkdtempSync(join(packageRoot, '.embedder-worker-test-build-'))
  await build({
    entry: {
      'embedder-worker/worker-entry': join(
        packageRoot,
        'src/embedder-worker/worker-entry.ts',
      ),
    },
    outDir: workerBuildRoot,
    format: ['esm'],
    dts: false,
    clean: true,
    sourcemap: false,
    target: 'node24',
    platform: 'node',
    splitting: false,
    silent: true,
  })
  workerEntryPath = join(workerBuildRoot, 'embedder-worker', 'worker-entry.js')
})

afterEach(async () => {
  process.chdir(originalCwd)
  resetEmbedderCapability()

  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
  }
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

afterAll(() => {
  if (workerBuildRoot !== '') rmSync(workerBuildRoot, { force: true, recursive: true })
})

describe.sequential('embedder worker discovery', () => {
  it('returns no-worker when registration is absent', async () => {
    const projectRoot = temporaryProject('absent')
    process.chdir(projectRoot)

    await expect(discoverEmbedderWorker()).resolves.toEqual({ kind: 'no-worker' })
  })

  it('removes a dead-pid registration and returns no-worker', async () => {
    const projectRoot = temporaryProject('dead-pid')
    const agentQaRoot = join(projectRoot, '.agent-qa')
    process.chdir(projectRoot)
    const exitedChild = spawn(process.execPath, ['-e', 'process.exit(0)'])
    const deadPid = exitedChild.pid
    if (deadPid === undefined) throw new Error('Expected the fixture child to have a pid')
    await once(exitedChild, 'exit')
    registration(projectRoot, { pid: deadPid })
    expect(readEmbedderWorkerRegistration(agentQaRoot)).toMatchObject({ kind: 'parsed' })

    await expect(discoverEmbedderWorker()).resolves.toEqual({ kind: 'no-worker' })
    expect(existsSync(embedderWorkerRegistrationPath(agentQaRoot))).toBe(false)
  })

  it('removes a dead-socket registration and returns no-worker', async () => {
    const projectRoot = temporaryProject('dead-socket')
    const agentQaRoot = join(projectRoot, '.agent-qa')
    process.chdir(projectRoot)
    registration(projectRoot, {
      socketPath: embedderWorkerSocketPath(agentQaRoot, projectRoot),
    })
    expect(readEmbedderWorkerRegistration(agentQaRoot)).toMatchObject({ kind: 'parsed' })

    await expect(discoverEmbedderWorker()).resolves.toEqual({ kind: 'no-worker' })
    expect(existsSync(embedderWorkerRegistrationPath(agentQaRoot))).toBe(false)
  })

  it('round-trips floor embeddings through a real child and cleans up on SIGTERM', async () => {
    const projectRoot = temporaryProject('live')
    const agentQaRoot = embedderWorkerAgentQaRoot(projectRoot)
    const registrationPath = embedderWorkerRegistrationPath(agentQaRoot)
    process.chdir(projectRoot)

    const child = spawn(
      process.execPath,
      [workerEntryPath, projectRoot, JSON.stringify(STATIC_FLOOR_EMBEDDING_PROFILE)],
      { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    children.push(child)
    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })

    await eventually(
      () => existsSync(registrationPath),
      () => `worker did not register (exit=${child.exitCode}); stderr: ${stderr}`,
    )
    const registeredWorker = JSON.parse(readFileSync(registrationPath, 'utf8')) as {
      socketPath: string
    }
    expect(registeredWorker).toMatchObject({
      pid: child.pid,
      profile: STATIC_FLOOR_EMBEDDING_PROFILE,
    })
    await expect(discoverEmbedderWorker()).resolves.toMatchObject({ kind: 'worker' })

    const outcome = await resolveEmbedderCapability({
      preferredProfile: STATIC_FLOOR_EMBEDDING_PROFILE,
      allowDownload: false,
    })
    expect(outcome.kind).toBe('ready')
    if (outcome.kind !== 'ready') throw new Error(`Expected ready, received ${outcome.kind}`)

    const rendering = 'worker and in-process floor embeddings must remain byte-identical'
    const inProcessFloor = createFloorEmbedder()
    const expected = await inProcessFloor.embedDocument(rendering)
    const actual = await outcome.embedder.embedDocument(rendering)
    expect(Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength)).toEqual(
      Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength),
    )

    const query = 'Which embeddings must remain identical?'
    const expectedQuery = await inProcessFloor.embedQuery(query)
    const actualQuery = await outcome.embedder.embedQuery(query)
    expect(Buffer.from(actualQuery.buffer, actualQuery.byteOffset, actualQuery.byteLength)).toEqual(
      Buffer.from(expectedQuery.buffer, expectedQuery.byteOffset, expectedQuery.byteLength),
    )

    const batchResponse = await rawWorkerRequest(registeredWorker.socketPath, {
      schemaVersion: 1,
      method: 'embedBatch',
      requests: [
        { schemaVersion: 1, method: 'embedDocument', rendering },
        { schemaVersion: 1, method: 'embedQuery', rendering: query },
      ],
    })
    expect(batchResponse).toEqual({
      schemaVersion: 1,
      vectors: [Array.from(expected), Array.from(expectedQuery)],
    })

    child.kill('SIGTERM')
    await once(child, 'exit')
    await eventually(
      () => !existsSync(registrationPath),
      () => `worker registration remained after SIGTERM; stderr: ${stderr}`,
    )
  })
})
