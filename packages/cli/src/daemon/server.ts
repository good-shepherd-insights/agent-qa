import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, rmSync } from 'node:fs'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { invokeFunction } from '@vostride/agent-qa-agent'
import type { FunctionRegistry } from '@vostride/agent-qa-agent'
import type { FunctionCaller } from '@vostride/agent-qa-schema'
import { z } from 'zod'

export const INVOKE_ENVELOPE_SCHEMA_VERSION = 1
export const DAEMON_SOCKET_FILE = 'daemon.sock'

/** Conservative floor below macOS' and Linux' platform-specific `sun_path` limits. */
export const DAEMON_SOCKET_PATH_BUDGET_BYTES = 100

/** Bounded before JSON parsing so malformed peers cannot grow the daemon heap without limit. */
export const MAX_INVOKE_BODY_BYTES = 1_048_576

export const invokeEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(INVOKE_ENVELOPE_SCHEMA_VERSION),
    functionId: z.string().min(1),
    input: z.unknown(),
  })
  .strict()

export type InvokeEnvelope = z.infer<typeof invokeEnvelopeSchema>

export const nudgeEnvelopeSchema = z
  .object({ kind: z.literal('candidates-enqueued') })
  .strict()

export type NudgeEnvelope = z.infer<typeof nudgeEnvelopeSchema>

/**
 * The socket authenticates the local operator through its owner-only directory. Caller grants are
 * therefore minted here and are never accepted from the wire; Phase 396 owns any remote trust
 * model that later replaces this local-only decision.
 */
export const DAEMON_FUNCTION_CALLER: FunctionCaller = Object.freeze({
  surface: 'daemon',
  grantedScopes: ['read', 'run', 'config-write'] as const,
  safeMode: false,
})

export class DaemonSocketInUseError extends Error {
  readonly socketPath: string

  constructor(socketPath: string) {
    super(`agent-qa daemon socket is already served by a live process: ${socketPath}`)
    this.name = 'DaemonSocketInUseError'
    this.socketPath = socketPath
  }
}

export class InvokeEnvelopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvokeEnvelopeError'
  }
}

export class NudgeEnvelopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NudgeEnvelopeError'
  }
}

export class InvokeBodyTooLargeError extends Error {
  readonly limitBytes: number

  constructor(limitBytes: number) {
    super(`Invoke request body exceeds ${limitBytes} bytes`)
    this.name = 'InvokeBodyTooLargeError'
    this.limitBytes = limitBytes
  }
}

export interface InvokeServerHandle {
  readonly socketPath: string
  close(): Promise<void>
}

export interface StartInvokeServerOptions {
  readonly socketPath: string
  readonly registry: FunctionRegistry
  readonly onNudge?: (nudge: NudgeEnvelope) => void
}

interface WireError {
  readonly [field: string]: unknown
  readonly name: string
  readonly message: string
}

function projectHash(projectRoot: string): string {
  return createHash('sha256').update(resolve(projectRoot)).digest('hex').slice(0, 12)
}

/** Resolve the project-scoped IPC address, falling back before POSIX silently truncates it. */
export function daemonSocketPath(agentQaRoot: string, projectRoot: string): string {
  const hash = projectHash(projectRoot)
  if (process.platform === 'win32') return `\\\\.\\pipe\\agent-qa-${hash}`

  const projectLocal = join(agentQaRoot, DAEMON_SOCKET_FILE)
  if (Buffer.byteLength(projectLocal) <= DAEMON_SOCKET_PATH_BUDGET_BYTES) return projectLocal

  const fallback = join(tmpdir(), `agent-qa-${hash}`, DAEMON_SOCKET_FILE)
  if (Buffer.byteLength(fallback) > DAEMON_SOCKET_PATH_BUDGET_BYTES) {
    throw new Error(
      `OS temporary directory is too deep for an agent-qa daemon socket: ${fallback}`,
    )
  }
  return fallback
}

function isNamedPipe(path: string): boolean {
  return process.platform === 'win32' || path.startsWith('\\\\.\\pipe\\')
}

function prepareSocketParent(socketPath: string): void {
  if (isNamedPipe(socketPath)) return
  const parent = dirname(socketPath)
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  chmodSync(parent, 0o700)
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

function probeSocket(socketPath: string): Promise<'live' | 'stale'> {
  return new Promise((resolveProbe, rejectProbe) => {
    const socket = connect(socketPath)
    socket.once('connect', () => {
      socket.destroy()
      resolveProbe('live')
    })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      socket.destroy()
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTSOCK') {
        resolveProbe('stale')
        return
      }
      rejectProbe(error)
    })
  })
}

async function listenWithStaleRecovery(server: Server, socketPath: string): Promise<void> {
  try {
    await listen(server, socketPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // Darwin reports EINVAL when the conflicting path is a plain file. It is still attacker-
    // shaped input, so it goes through the same probe-before-unlink rule as EADDRINUSE.
    if ((code !== 'EADDRINUSE' && code !== 'EINVAL') || isNamedPipe(socketPath)) {
      throw error
    }
    const probe = await probeSocket(socketPath)
    if (probe === 'live') throw new DaemonSocketInUseError(socketPath)
    rmSync(socketPath)
    await listen(server, socketPath)
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > MAX_INVOKE_BODY_BYTES) throw new InvokeBodyTooLargeError(MAX_INVOKE_BODY_BYTES)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function parseEnvelope(request: IncomingMessage): Promise<InvokeEnvelope> {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(await readRequestBody(request)) as unknown
  } catch (error) {
    if (error instanceof InvokeBodyTooLargeError) throw error
    throw new InvokeEnvelopeError(
      `Invoke body must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const parsed = invokeEnvelopeSchema.safeParse(parsedJson)
  if (!parsed.success) {
    throw new InvokeEnvelopeError(
      parsed.error.issues
        .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
        .join('; '),
    )
  }
  return parsed.data
}

async function parseNudgeEnvelope(request: IncomingMessage): Promise<NudgeEnvelope> {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(await readRequestBody(request)) as unknown
  } catch (error) {
    if (error instanceof InvokeBodyTooLargeError) throw error
    throw new NudgeEnvelopeError(
      `Nudge body must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const parsed = nudgeEnvelopeSchema.safeParse(parsedJson)
  if (!parsed.success) {
    throw new NudgeEnvelopeError(
      parsed.error.issues
        .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
        .join('; '),
    )
  }
  return parsed.data
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    connection: 'close',
  })
  response.end(`${JSON.stringify(value)}\n`)
}

function wireError(error: unknown): WireError {
  if (!(error instanceof Error)) return { name: 'Error', message: String(error) }

  // Error's own message/name fields are not enumerable, while the agent refusal classes expose
  // their structured context as enumerable readonly properties. Preserve those fields so the
  // client can reconstruct the exact public refusal class instead of flattening it to Error.
  return {
    ...Object.fromEntries(Object.entries(error)),
    name: error.name,
    message: error.message,
  }
}

function errorStatus(error: unknown): number {
  if (error instanceof InvokeBodyTooLargeError) return 413
  if (error instanceof InvokeEnvelopeError || error instanceof NudgeEnvelopeError) return 400
  return 500
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
  )
}

function streamElementSeq(element: unknown): number {
  if (
    typeof element !== 'object' ||
    element === null ||
    !('seq' in element) ||
    typeof element.seq !== 'number' ||
    !Number.isSafeInteger(element.seq) ||
    element.seq < 0
  ) {
    throw new Error('Stream elements must carry a non-negative integer seq resume token')
  }
  return element.seq
}

async function writeEventStream(
  response: ServerResponse,
  result: AsyncIterable<unknown>,
): Promise<void> {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'close',
  })
  response.flushHeaders()

  for await (const element of result) {
    response.write(`id: ${streamElementSeq(element)}\ndata: ${JSON.stringify(element)}\n\n`)
  }
  response.end()
}

async function handleInvoke(
  request: IncomingMessage,
  response: ServerResponse,
  registry: FunctionRegistry,
): Promise<void> {
  if (request.method !== 'POST') {
    writeJson(response, 405, { name: 'MethodNotAllowedError', message: 'POST required' })
    return
  }

  try {
    const envelope = await parseEnvelope(request)
    const result = await invokeFunction(
      registry,
      envelope.functionId,
      envelope.input,
      DAEMON_FUNCTION_CALLER,
    )
    if (isAsyncIterable(result)) {
      await writeEventStream(response, result)
      return
    }
    writeJson(response, 200, result)
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : new Error(String(error)))
      return
    }
    writeJson(response, errorStatus(error), wireError(error))
  }
}

async function handleNudge(
  request: IncomingMessage,
  response: ServerResponse,
  onNudge: StartInvokeServerOptions['onNudge'],
): Promise<void> {
  if (request.method !== 'POST') {
    writeJson(response, 405, { name: 'MethodNotAllowedError', message: 'POST required' })
    return
  }
  try {
    const envelope = await parseNudgeEnvelope(request)
    onNudge?.(envelope)
    response.writeHead(204, { connection: 'close' })
    response.end()
  } catch (error) {
    writeJson(response, errorStatus(error), wireError(error))
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: StartInvokeServerOptions,
): Promise<void> {
  if (request.url === '/invoke') {
    await handleInvoke(request, response, options.registry)
    return
  }
  if (request.url === '/nudge') {
    await handleNudge(request, response, options.onNudge)
    return
  }
  writeJson(response, 404, { name: 'NotFoundError', message: 'Route not found' })
}

/** Start the local invoke transport plus its typed best-effort curation nudge route. */
export async function startInvokeServer(
  options: StartInvokeServerOptions,
): Promise<InvokeServerHandle> {
  prepareSocketParent(options.socketPath)

  const sockets = new Set<Socket>()
  const responses = new Set<ServerResponse>()
  const server = createServer((request, response) => {
    responses.add(response)
    response.once('close', () => responses.delete(response))
    void handleRequest(request, response, options)
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })

  try {
    await listenWithStaleRecovery(server, options.socketPath)
  } catch (error) {
    for (const socket of sockets) socket.destroy()
    throw error
  }

  let closing: Promise<void> | undefined
  return {
    socketPath: options.socketPath,
    close(): Promise<void> {
      closing ??= new Promise<void>((resolveClose, rejectClose) => {
        for (const response of responses) response.end()
        server.close((error) => {
          for (const socket of sockets) socket.destroy()
          if (!isNamedPipe(options.socketPath)) rmSync(options.socketPath, { force: true })
          if (error) rejectClose(error)
          else resolveClose()
        })
        server.closeIdleConnections()
      })
      return closing
    },
  }
}
