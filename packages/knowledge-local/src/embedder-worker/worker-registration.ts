import { randomUUID, createHash } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { request } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import type { EmbeddingProfile } from '@vostride/agent-qa-schema'
import { z } from 'zod'

import type { EmbedderPort } from '../embedder-port.js'

export const EMBEDDER_WORKER_REGISTRATION_FILE = 'embedder-worker.json'
export const EMBEDDER_WORKER_REGISTRATION_SCHEMA_VERSION = 1
export const EMBEDDER_WORKER_PROTOCOL_SCHEMA_VERSION = 1
export const EMBEDDER_WORKER_SOCKET_FILE = 'embedder-worker.sock'
export const EMBEDDER_WORKER_SOCKET_PATH_BUDGET_BYTES = 100
export const MAX_EMBEDDER_WORKER_BODY_BYTES = 4_194_304

export const embeddingProfileSchema = z
  .object({
    model_id: z.string().min(1),
    revision: z.string().min(1),
    dim: z.number().int().positive(),
    dtype: z.literal('q8'),
    pooling: z.literal('mean'),
    normalize: z.literal(true),
    query_prefix: z.string(),
    doc_prefix: z.string(),
    backend: z.enum(['node', 'static']),
    session_options: z.record(z.string(), z.unknown()),
    tau_dense: z.number().finite(),
  })
  .strict()

export const embedderWorkerRegistrationSchema = z
  .object({
    schemaVersion: z.literal(EMBEDDER_WORKER_REGISTRATION_SCHEMA_VERSION),
    pid: z.number().int().positive(),
    socketPath: z.string().min(1),
    profile: embeddingProfileSchema,
    startedAtMs: z.number().int().nonnegative(),
  })
  .strict()

export type EmbedderWorkerRegistration = z.infer<typeof embedderWorkerRegistrationSchema>

export type ReadEmbedderWorkerRegistrationOutcome =
  | { kind: 'absent' }
  | { kind: 'malformed' }
  | { kind: 'parsed'; registration: EmbedderWorkerRegistration }

export type ProcessIsAlive = (pid: number) => boolean

const singleEmbeddingRequestSchema = z.discriminatedUnion('method', [
  z
    .object({
      schemaVersion: z.literal(EMBEDDER_WORKER_PROTOCOL_SCHEMA_VERSION),
      method: z.literal('embedDocument'),
      rendering: z.string(),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(EMBEDDER_WORKER_PROTOCOL_SCHEMA_VERSION),
      method: z.literal('embedQuery'),
      rendering: z.string(),
    })
    .strict(),
])

export const embedderWorkerRequestSchema = z.discriminatedUnion('method', [
  ...singleEmbeddingRequestSchema.options,
  z
    .object({
      schemaVersion: z.literal(EMBEDDER_WORKER_PROTOCOL_SCHEMA_VERSION),
      method: z.literal('embedBatch'),
      requests: z.array(singleEmbeddingRequestSchema).min(1).max(256),
    })
    .strict(),
])

export type EmbedderWorkerRequest = z.infer<typeof embedderWorkerRequestSchema>

export const embedderWorkerResponseSchema = z
  .object({
    schemaVersion: z.literal(EMBEDDER_WORKER_PROTOCOL_SCHEMA_VERSION),
    vectors: z.array(z.array(z.number().finite())),
  })
  .strict()

export type EmbedderWorkerResponse = z.infer<typeof embedderWorkerResponseSchema>

function projectHash(projectRoot: string): string {
  return createHash('sha256').update(realpathSync(projectRoot)).digest('hex').slice(0, 12)
}

export function embedderWorkerAgentQaRoot(projectRoot = process.cwd()): string {
  return join(realpathSync(projectRoot), '.agent-qa')
}

export function embedderWorkerRegistrationPath(agentQaRoot: string): string {
  return join(agentQaRoot, EMBEDDER_WORKER_REGISTRATION_FILE)
}

/** Resolve a project-scoped UDS path without crossing conservative POSIX sun_path limits. */
export function embedderWorkerSocketPath(agentQaRoot: string, projectRoot: string): string {
  const hash = projectHash(projectRoot)
  if (process.platform === 'win32') return `\\\\.\\pipe\\agent-qa-embedder-${hash}`

  const canonicalAgentQaRoot = join(realpathSync(dirname(agentQaRoot)), basename(agentQaRoot))
  const projectLocal = join(canonicalAgentQaRoot, EMBEDDER_WORKER_SOCKET_FILE)
  if (Buffer.byteLength(projectLocal) <= EMBEDDER_WORKER_SOCKET_PATH_BUDGET_BYTES) {
    return projectLocal
  }

  const fallback = join(tmpdir(), `agent-qa-${hash}`, EMBEDDER_WORKER_SOCKET_FILE)
  if (Buffer.byteLength(fallback) > EMBEDDER_WORKER_SOCKET_PATH_BUDGET_BYTES) {
    throw new Error(
      `OS temporary directory is too deep for an agent-qa embedder socket: ${fallback}`,
    )
  }
  return fallback
}

export function prepareEmbedderWorkerSocketParent(socketPath: string): void {
  if (process.platform === 'win32' || socketPath.startsWith('\\\\.\\pipe\\')) return
  const parent = dirname(socketPath)
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  chmodSync(parent, 0o700)
}

function bestEffortFsyncDirectory(dir: string): void {
  let fd: number | undefined
  try {
    fd = openSync(dir, 'r')
    fsyncSync(fd)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (
      code !== 'ENOENT'
      && code !== 'EINVAL'
      && code !== 'EISDIR'
      && code !== 'EPERM'
      && code !== 'ENOTSUP'
    ) {
      throw error
    }
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function atomicRewrite(file: string, text: string): void {
  const parent = dirname(file)
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  chmodSync(parent, 0o700)
  const temporary = `${file}.tmp-${randomUUID()}`
  let fd: number | undefined
  try {
    fd = openSync(temporary, 'wx', 0o600)
    writeFileSync(fd, text, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(temporary, file)
    bestEffortFsyncDirectory(parent)
  } finally {
    if (fd !== undefined) closeSync(fd)
    rmSync(temporary, { force: true })
  }
}

export function writeEmbedderWorkerRegistration(
  agentQaRoot: string,
  registration: EmbedderWorkerRegistration,
): void {
  const validated = embedderWorkerRegistrationSchema.parse(registration)
  atomicRewrite(
    embedderWorkerRegistrationPath(agentQaRoot),
    `${JSON.stringify(validated)}\n`,
  )
}

export function readEmbedderWorkerRegistration(
  agentQaRoot: string,
): ReadEmbedderWorkerRegistrationOutcome {
  const file = embedderWorkerRegistrationPath(agentQaRoot)
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return existsSync(file) ? { kind: 'malformed' } : { kind: 'absent' }
  }

  try {
    const parsed = embedderWorkerRegistrationSchema.safeParse(JSON.parse(raw))
    return parsed.success
      ? { kind: 'parsed', registration: parsed.data }
      : { kind: 'malformed' }
  } catch {
    return { kind: 'malformed' }
  }
}

/** Signal-zero liveness probe: EPERM proves existence; only ESRCH proves a stale pid. */
export function embedderWorkerProcessIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    if (code === 'EPERM') return true
    throw error
  }
}

function sameRegistration(
  left: EmbedderWorkerRegistration,
  right: EmbedderWorkerRegistration,
): boolean {
  return left.pid === right.pid
    && left.startedAtMs === right.startedAtMs
    && left.socketPath === right.socketPath
}

/** Remove only the registration still owned by the caller; never unlink a replacement worker. */
export function removeEmbedderWorkerRegistration(
  agentQaRoot: string,
  expected?: EmbedderWorkerRegistration,
): boolean {
  const file = embedderWorkerRegistrationPath(agentQaRoot)
  if (expected !== undefined) {
    const current = readEmbedderWorkerRegistration(agentQaRoot)
    if (current.kind !== 'parsed' || !sameRegistration(current.registration, expected)) {
      return false
    }
  }

  const existed = existsSync(file)
  rmSync(file, { force: true })
  if (existed) bestEffortFsyncDirectory(dirname(file))
  return existed
}

export function probeEmbedderWorkerSocket(socketPath: string): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = connect(socketPath)
    socket.once('connect', () => {
      socket.destroy()
      resolveProbe(true)
    })
    socket.once('error', () => {
      socket.destroy()
      resolveProbe(false)
    })
  })
}

function requestWorker(
  socketPath: string,
  envelope: EmbedderWorkerRequest,
): Promise<EmbedderWorkerResponse> {
  const body = JSON.stringify(embedderWorkerRequestSchema.parse(envelope))
  return new Promise((resolveRequest, rejectRequest) => {
    const workerRequest = request(
      {
        socketPath,
        path: '/embed',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        let bytes = 0
        response.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          bytes += buffer.byteLength
          if (bytes <= MAX_EMBEDDER_WORKER_BODY_BYTES) chunks.push(buffer)
        })
        response.on('end', () => {
          try {
            if (bytes > MAX_EMBEDDER_WORKER_BODY_BYTES) {
              throw new Error('Embedder worker response exceeded the body limit')
            }
            const parsedBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
            if (response.statusCode !== 200) {
              const message = z
                .object({ error: z.string() })
                .passthrough()
                .safeParse(parsedBody)
              throw new Error(
                message.success
                  ? `Embedder worker rejected the request: ${message.data.error}`
                  : `Embedder worker returned HTTP ${response.statusCode ?? 0}`,
              )
            }
            resolveRequest(embedderWorkerResponseSchema.parse(parsedBody))
          } catch (error) {
            rejectRequest(error)
          }
        })
      },
    )
    workerRequest.once('error', rejectRequest)
    workerRequest.end(body)
  })
}

function vectorFromResponse(
  response: EmbedderWorkerResponse,
  expectedDimension: number,
): Float32Array {
  const [vector] = response.vectors
  if (vector === undefined || response.vectors.length !== 1) {
    throw new Error('Embedder worker returned an invalid single-vector response')
  }
  if (vector.length !== expectedDimension) {
    throw new Error(
      `Embedder worker returned dimension ${vector.length}; expected ${expectedDimension}`,
    )
  }
  return Float32Array.from(vector)
}

export function createEmbedderWorkerPort(
  socketPath: string,
  expectedDimension: number,
): EmbedderPort {
  return {
    async embedDocument(rendering) {
      return vectorFromResponse(
        await requestWorker(socketPath, {
          schemaVersion: EMBEDDER_WORKER_PROTOCOL_SCHEMA_VERSION,
          method: 'embedDocument',
          rendering,
        }),
        expectedDimension,
      )
    },
    async embedQuery(rendering) {
      return vectorFromResponse(
        await requestWorker(socketPath, {
          schemaVersion: EMBEDDER_WORKER_PROTOCOL_SCHEMA_VERSION,
          method: 'embedQuery',
          rendering,
        }),
        expectedDimension,
      )
    },
  }
}

export function asEmbeddingProfile(
  profile: EmbedderWorkerRegistration['profile'],
): EmbeddingProfile {
  return profile as EmbeddingProfile
}
