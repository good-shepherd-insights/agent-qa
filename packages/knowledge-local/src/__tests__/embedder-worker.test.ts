import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { STATIC_FLOOR_EMBEDDING_PROFILE } from '@vostride/agent-qa-schema'
import { build } from 'tsup'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  discoverEmbedderWorker,
  resetEmbedderCapability,
  resolveEmbedderCapability,
} from '../embedder-acquire.js'
import { createFloorEmbedder } from '../embedder-floor.js'
import {
  EMBEDDER_WORKER_REGISTRATION_SCHEMA_VERSION,
  embedderWorkerRegistrationPath,
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
  message: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(message)
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
    socketPath: overrides.socketPath ?? join(agentQaRoot, 'embedder-worker.sock'),
    profile: STATIC_FLOOR_EMBEDDING_PROFILE,
    startedAtMs: Date.now(),
  })
}

beforeAll(async () => {
  workerBuildRoot = mkdtempSync(join(packageRoot, '.embedder-worker-test-build-'))
  await build({
    entry: [join(packageRoot, 'src/embedder-worker/worker-entry.ts')],
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
  workerEntryPath = join(workerBuildRoot, 'worker-entry.js')
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
    registration(projectRoot, { pid: 2_147_483_647 })

    await expect(discoverEmbedderWorker()).resolves.toEqual({ kind: 'no-worker' })
    expect(existsSync(embedderWorkerRegistrationPath(agentQaRoot))).toBe(false)
  })

  it('removes a dead-socket registration and returns no-worker', async () => {
    const projectRoot = temporaryProject('dead-socket')
    const agentQaRoot = join(projectRoot, '.agent-qa')
    process.chdir(projectRoot)
    registration(projectRoot, { socketPath: join(agentQaRoot, 'missing.sock') })

    await expect(discoverEmbedderWorker()).resolves.toEqual({ kind: 'no-worker' })
    expect(existsSync(embedderWorkerRegistrationPath(agentQaRoot))).toBe(false)
  })

  it('round-trips floor embeddings through a real child and cleans up on SIGTERM', async () => {
    const projectRoot = temporaryProject('live')
    const agentQaRoot = join(projectRoot, '.agent-qa')
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
      `worker did not register; stderr: ${stderr}`,
    )
    expect(JSON.parse(readFileSync(registrationPath, 'utf8'))).toMatchObject({
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
    const expected = await createFloorEmbedder().embedDocument(rendering)
    const actual = await outcome.embedder.embedDocument(rendering)
    expect(Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength)).toEqual(
      Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength),
    )

    child.kill('SIGTERM')
    await once(child, 'exit')
    await eventually(
      () => !existsSync(registrationPath),
      `worker registration remained after SIGTERM; stderr: ${stderr}`,
    )
  })
})
