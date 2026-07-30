import { request, type IncomingMessage } from 'node:http'

import {
  FunctionDeniedError,
  FunctionInputError,
  FunctionNotBoundError,
  FunctionScopeError,
  StreamReplayFloorError,
  UnknownFunctionError,
} from '@vostride/agent-qa-agent'
import type { FunctionScope } from '@vostride/agent-qa-schema'

import {
  inspectDaemonRegistration,
  type DaemonRegistration,
} from './registration.js'
import { INVOKE_ENVELOPE_SCHEMA_VERSION } from './server.js'

export class DaemonNotRunningError extends Error {
  readonly reason: 'absent' | 'malformed' | 'stale' | 'unreachable'

  constructor(reason: 'absent' | 'malformed' | 'stale' | 'unreachable', detail?: string) {
    super(
      `agent-qa daemon is not running (${reason}${detail ? `: ${detail}` : ''}). ` +
        'Start `agent-qa daemon`, or omit --via-daemon.',
    )
    this.name = 'DaemonNotRunningError'
    this.reason = reason
  }
}

interface InvokeViaDaemonOptions {
  readonly agentQaRoot: string
  readonly functionId: string
  readonly input: unknown
}

interface WireError {
  readonly name?: unknown
  readonly message?: unknown
  readonly functionId?: unknown
  readonly issues?: unknown
  readonly missingScopes?: unknown
  readonly reason?: unknown
  readonly runId?: unknown
  readonly requestedSeq?: unknown
  readonly earliestAvailableSeq?: unknown
}

interface SseElement {
  readonly id: number
  readonly value: unknown
}

class DaemonStreamDisconnectedError extends Error {
  constructor(cause?: unknown) {
    super('agent-qa daemon stream disconnected before its terminating response', { cause })
    this.name = 'DaemonStreamDisconnectedError'
  }
}

function requireLiveRegistration(agentQaRoot: string): DaemonRegistration {
  const registration = inspectDaemonRegistration(agentQaRoot)
  if (registration.kind === 'live') return registration.registration
  throw new DaemonNotRunningError(registration.kind)
}

function parseJson(text: string, context: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new Error(
      `${context} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Restore public agent refusal identity and fields after the daemon JSON boundary. */
export function rehydrateFunctionError(value: unknown, statusCode: number): Error {
  const wire = value as WireError
  const functionId = typeof wire?.functionId === 'string' ? wire.functionId : undefined

  if (wire?.name === 'UnknownFunctionError' && functionId !== undefined) {
    return new UnknownFunctionError(functionId)
  }
  if (
    wire?.name === 'FunctionInputError' &&
    functionId !== undefined &&
    typeof wire.issues === 'string'
  ) {
    return new FunctionInputError(functionId, wire.issues)
  }
  if (
    wire?.name === 'FunctionScopeError' &&
    functionId !== undefined &&
    Array.isArray(wire.missingScopes) &&
    wire.missingScopes.every((scope) => typeof scope === 'string')
  ) {
    return new FunctionScopeError(functionId, wire.missingScopes as FunctionScope[])
  }
  if (
    wire?.name === 'FunctionDeniedError' &&
    functionId !== undefined &&
    typeof wire.reason === 'string'
  ) {
    return new FunctionDeniedError(functionId, wire.reason)
  }
  if (wire?.name === 'FunctionNotBoundError' && functionId !== undefined) {
    return new FunctionNotBoundError(functionId)
  }
  if (
    wire?.name === 'StreamReplayFloorError' &&
    typeof wire.runId === 'string' &&
    typeof wire.requestedSeq === 'number' &&
    typeof wire.earliestAvailableSeq === 'number'
  ) {
    return new StreamReplayFloorError(
      wire.runId,
      wire.requestedSeq,
      wire.earliestAvailableSeq,
    )
  }

  const error = new Error(
    typeof wire?.message === 'string' ? wire.message : `Daemon invocation failed (${statusCode})`,
  )
  error.name = typeof wire?.name === 'string' ? wire.name : 'DaemonInvokeError'
  return error
}

function openInvokeResponse(
  registration: DaemonRegistration,
  functionId: string,
  input: unknown,
): Promise<IncomingMessage> {
  const body = JSON.stringify({
    schemaVersion: INVOKE_ENVELOPE_SCHEMA_VERSION,
    functionId,
    input,
  })

  return new Promise((resolveResponse, rejectResponse) => {
    const outgoing = request(
      {
        socketPath: registration.socketPath,
        path: '/invoke',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          connection: 'close',
        },
      },
      resolveResponse,
    )
    outgoing.once('error', (error) => {
      rejectResponse(new DaemonNotRunningError('unreachable', error.message))
    })
    outgoing.end(body)
  })
}

async function readResponseText(response: IncomingMessage): Promise<string> {
  response.setEncoding('utf8')
  let text = ''
  for await (const chunk of response) text += String(chunk)
  return text
}

async function readUnaryResponse(response: IncomingMessage): Promise<unknown> {
  const statusCode = response.statusCode ?? 500
  const parsed = parseJson(await readResponseText(response), 'agent-qa daemon')
  if (statusCode < 200 || statusCode >= 300) {
    throw rehydrateFunctionError(parsed, statusCode)
  }
  return parsed
}

function isEventStream(response: IncomingMessage): boolean {
  const contentType = String(response.headers['content-type'] ?? '')
  return contentType.toLowerCase().startsWith('text/event-stream')
}

function parseEventFrame(frame: string): SseElement {
  const dataLines: string[] = []
  let id: number | undefined

  for (const line of frame.split('\n')) {
    if (line.length === 0 || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    const rawValue = separator === -1 ? '' : line.slice(separator + 1)
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue
    if (field === 'id') {
      const parsedId = Number(value)
      if (!Number.isSafeInteger(parsedId) || parsedId < 0) {
        throw new Error(`Daemon stream returned an invalid SSE id: ${value}`)
      }
      id = parsedId
    } else if (field === 'data') {
      dataLines.push(value)
    }
  }

  if (id === undefined) throw new Error('Daemon stream event is missing its SSE id')
  if (dataLines.length === 0) throw new Error(`Daemon stream event ${id} is missing data`)
  return {
    id,
    value: parseJson(dataLines.join('\n'), `agent-qa daemon stream event ${id}`),
  }
}

async function* readEventStream(response: IncomingMessage): AsyncIterable<SseElement> {
  response.setEncoding('utf8')
  const iterator = response[Symbol.asyncIterator]()
  let buffer = ''

  while (true) {
    let next: IteratorResult<unknown>
    try {
      next = await iterator.next()
    } catch (error) {
      throw new DaemonStreamDisconnectedError(error)
    }
    if (next.done) break

    buffer = `${buffer}${String(next.value)}`.replaceAll('\r\n', '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      if (frame.length > 0) yield parseEventFrame(frame)
      boundary = buffer.indexOf('\n\n')
    }
  }

  if (!response.complete || buffer.length > 0) {
    throw new DaemonStreamDisconnectedError()
  }
}

function resumeInput(input: unknown, lastEventId: number): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Daemon stream input must be an object to resume with lastEventId')
  }
  return { ...(input as Record<string, unknown>), lastEventId }
}

async function requireEventStream(response: IncomingMessage): Promise<void> {
  const statusCode = response.statusCode ?? 500
  if (statusCode < 200 || statusCode >= 300) {
    const parsed = parseJson(await readResponseText(response), 'agent-qa daemon')
    throw rehydrateFunctionError(parsed, statusCode)
  }
  if (!isEventStream(response)) {
    throw new Error('Daemon stream resume returned a non-SSE response')
  }
}

async function* resumeEventStream(
  firstResponse: IncomingMessage,
  registration: DaemonRegistration,
  functionId: string,
  input: unknown,
): AsyncIterable<unknown> {
  let response = firstResponse
  let lastEventId: number | undefined
  let reconnects = 0

  while (true) {
    try {
      for await (const element of readEventStream(response)) {
        lastEventId = element.id
        yield element.value
      }
      return
    } catch (error) {
      if (
        !(error instanceof DaemonStreamDisconnectedError) ||
        reconnects >= 1 ||
        lastEventId === undefined
      ) {
        throw error
      }
    }

    reconnects += 1
    response = await openInvokeResponse(
      registration,
      functionId,
      resumeInput(input, lastEventId),
    )
    await requireEventStream(response)
  }
}

/** Invoke through the socket path recorded by the live registration; never recompute discovery. */
export async function invokeViaDaemon(options: InvokeViaDaemonOptions): Promise<unknown> {
  const registration = requireLiveRegistration(options.agentQaRoot)
  const response = await openInvokeResponse(registration, options.functionId, options.input)
  const statusCode = response.statusCode ?? 500
  if (statusCode < 200 || statusCode >= 300) return readUnaryResponse(response)
  if (isEventStream(response)) {
    return resumeEventStream(
      response,
      registration,
      options.functionId,
      options.input,
    )
  }
  return readUnaryResponse(response)
}

/** Best-effort curation wake-up. Tail completion never depends on daemon discovery or I/O. */
export async function nudgeDaemon(agentQaRoot: string): Promise<void> {
  try {
    const inspected = inspectDaemonRegistration(agentQaRoot)
    if (inspected.kind !== 'live') return
    const body = JSON.stringify({ kind: 'candidates-enqueued' })
    await new Promise<void>((resolveNudge) => {
      const outgoing = request(
        {
          socketPath: inspected.registration.socketPath,
          path: '/nudge',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            connection: 'close',
          },
        },
        (response) => {
          response.resume()
          response.once('end', resolveNudge)
          response.once('error', resolveNudge)
        },
      )
      outgoing.once('error', resolveNudge)
      outgoing.end(body)
    })
  } catch {
    // A missed nudge is intentionally invisible; the daemon's poll loop is the backstop.
  }
}
