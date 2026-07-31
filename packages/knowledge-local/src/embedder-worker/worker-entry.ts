import { randomUUID } from 'node:crypto'
import { chmodSync, rmSync } from 'node:fs'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { connect } from 'node:net'
import { basename, resolve } from 'node:path'

import type { EmbeddingProfile } from '@vostride/agent-qa-schema'

import { resolveEmbedderCapability } from '../embedder-acquire.js'
import type { EmbedderPort } from '../embedder-port.js'
import { resolveProcessIncarnation } from '../lease/writer-lease.js'
import {
  asEmbeddingProfile,
  embedderWorkerAgentQaRoot,
  embedderWorkerRequestSchema,
  embedderWorkerSocketPath,
  EMBEDDER_WORKER_PROTOCOL_SCHEMA_VERSION,
  EMBEDDER_WORKER_REGISTRATION_SCHEMA_VERSION,
  EMBEDDER_WORKER_UNVERIFIABLE_INCARNATION,
  embeddingProfileSchema,
  MAX_EMBEDDER_WORKER_BODY_BYTES,
  prepareEmbedderWorkerSocketParent,
  removeEmbedderWorkerRegistration,
  writeEmbedderWorkerRegistration,
  type EmbedderWorkerRegistration,
  type EmbedderWorkerRequest,
} from './worker-registration.js'

class EmbedderWorkerRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmbedderWorkerRequestError'
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > MAX_EMBEDDER_WORKER_BODY_BYTES) {
      throw new EmbedderWorkerRequestError(
        `Embedder request exceeds ${MAX_EMBEDDER_WORKER_BODY_BYTES} bytes`,
      )
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function parseRequest(request: IncomingMessage): Promise<EmbedderWorkerRequest> {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(await readRequestBody(request)) as unknown
  } catch (error) {
    if (error instanceof EmbedderWorkerRequestError) throw error
    throw new EmbedderWorkerRequestError(
      `Embedder request body must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const parsed = embedderWorkerRequestSchema.safeParse(parsedJson)
  if (!parsed.success) {
    throw new EmbedderWorkerRequestError(
      parsed.error.issues
        .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
        .join('; '),
    )
  }
  return parsed.data
}

function json(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

async function embedOne(
  embedder: EmbedderPort,
  request: Extract<EmbedderWorkerRequest, { method: 'embedDocument' | 'embedQuery' }>,
): Promise<Float32Array> {
  return request.method === 'embedDocument'
    ? embedder.embedDocument(request.rendering)
    : embedder.embedQuery(request.rendering)
}

async function serveEmbeddingRequest(
  embedder: EmbedderPort,
  request: EmbedderWorkerRequest,
): Promise<readonly Float32Array[]> {
  if (request.method === 'embedBatch') {
    return Promise.all(request.requests.map((item) => embedOne(embedder, item)))
  }
  return [await embedOne(embedder, request)]
}

function createEmbedderServer(embedder: EmbedderPort): Server {
  return createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== '/embed') {
        json(response, 404, { error: 'not-found' })
        return
      }

      try {
        const envelope = await parseRequest(request)
        const vectors = await serveEmbeddingRequest(embedder, envelope)
        json(response, 200, {
          schemaVersion: EMBEDDER_WORKER_PROTOCOL_SCHEMA_VERSION,
          vectors: vectors.map((vector) => Array.from(vector)),
        })
      } catch (error) {
        const statusCode = error instanceof EmbedderWorkerRequestError ? 400 : 500
        json(response, statusCode, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()
  })
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      rejectListen(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolveListen()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(socketPath)
  })
}

function probeSocket(socketPath: string): Promise<boolean> {
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

async function listenWithStaleRecovery(server: Server, socketPath: string): Promise<void> {
  try {
    await listen(server, socketPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (
      (code !== 'EADDRINUSE' && code !== 'EINVAL')
      || process.platform === 'win32'
    ) {
      throw error
    }
    if (await probeSocket(socketPath)) {
      throw new Error(`Embedder worker socket is already live: ${socketPath}`)
    }
    rmSync(socketPath)
    await listen(server, socketPath)
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error !== undefined) rejectClose(error)
      else resolveClose()
    })
  })
}

async function acquireProcessLocalEmbedder(profile: EmbeddingProfile): Promise<EmbedderPort> {
  const outcome = await resolveEmbedderCapability({
    preferredProfile: profile,
    allowDownload: false,
    probes: {
      discoverWorker: () => Promise.resolve({ kind: 'no-worker' }),
    },
  })
  if (outcome.kind !== 'ready') {
    throw new Error(`Embedder worker could not resolve profile: ${outcome.kind}`)
  }
  return outcome.embedder
}

export interface RunEmbedderWorkerOptions {
  readonly projectRoot: string
  readonly profile: EmbeddingProfile
  /** Host-minted generation identity; standalone workers mint their own nonce. */
  readonly instanceId?: string
}

export interface EmbedderWorkerHandle {
  readonly registration: EmbedderWorkerRegistration
  close(): Promise<void>
}

/** Start the child worker after resolving its process-local embedder through the normal ladder. */
export async function runEmbedderWorker(
  options: RunEmbedderWorkerOptions,
): Promise<EmbedderWorkerHandle> {
  const projectRoot = resolve(options.projectRoot)
  const agentQaRoot = embedderWorkerAgentQaRoot(projectRoot)
  const instanceId = options.instanceId ?? randomUUID()
  const socketPath = embedderWorkerSocketPath(agentQaRoot, projectRoot, instanceId)
  const embedder = await acquireProcessLocalEmbedder(options.profile)
  const server = createEmbedderServer(embedder)
  prepareEmbedderWorkerSocketParent(socketPath)
  await listenWithStaleRecovery(server, socketPath)

  const registration: EmbedderWorkerRegistration = {
    schemaVersion: EMBEDDER_WORKER_REGISTRATION_SCHEMA_VERSION,
    instanceId,
    pid: process.pid,
    socketPath,
    profile: options.profile,
    startedAtMs: Date.now(),
    // The worker attributes ITSELF: it is the only party that can say, without a race, which
    // process incarnation this registration belongs to. A worker that cannot resolve its own start
    // time records the sentinel rather than a fabricated token, accepting that it will then be
    // replaced without a signal instead of terminated.
    incarnation:
      resolveProcessIncarnation(process.pid) ?? EMBEDDER_WORKER_UNVERIFIABLE_INCARNATION,
  }
  try {
    if (process.platform !== 'win32') chmodSync(socketPath, 0o600)
    writeEmbedderWorkerRegistration(agentQaRoot, registration)
  } catch (error) {
    await closeServer(server).catch(() => undefined)
    removeEmbedderWorkerRegistration(agentQaRoot, registration)
    if (process.platform !== 'win32') rmSync(socketPath, { force: true })
    throw error
  }

  let closePromise: Promise<void> | undefined
  return {
    registration,
    close() {
      closePromise ??= (async () => {
        try {
          await closeServer(server)
        } finally {
          try {
            removeEmbedderWorkerRegistration(agentQaRoot, registration)
          } finally {
            if (process.platform !== 'win32') rmSync(socketPath, { force: true })
          }
        }
      })()
      return closePromise
    },
  }
}

function parseProfile(raw: string | undefined): EmbeddingProfile {
  if (raw === undefined) throw new Error('Embedder worker requires a profile JSON argument')
  return asEmbeddingProfile(embeddingProfileSchema.parse(JSON.parse(raw) as unknown))
}

async function main(): Promise<void> {
  const projectRoot = process.argv[2]
  if (projectRoot === undefined) throw new Error('Embedder worker requires a project root argument')
  const handle = await runEmbedderWorker({
    projectRoot,
    profile: parseProfile(process.argv[3]),
    ...(process.argv[4] === undefined ? {} : { instanceId: process.argv[4] }),
  })

  let stopping = false
  const stop = (exitCode: number): void => {
    if (stopping) return
    stopping = true
    void handle.close().then(
      () => process.exit(exitCode),
      (error: unknown) => {
        process.stderr.write(
          `Embedder worker cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`,
        )
        process.exit(1)
      },
    )
  }
  process.once('SIGTERM', () => stop(0))
  process.once('SIGINT', () => stop(0))
}

const entryBasename = process.argv[1] === undefined ? undefined : basename(process.argv[1])
if (entryBasename === 'worker-entry.js' || entryBasename === 'worker-entry.cjs') {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `Embedder worker failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
