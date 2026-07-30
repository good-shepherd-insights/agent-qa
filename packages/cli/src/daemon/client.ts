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
import {
  INVOKE_ENVELOPE_SCHEMA_VERSION,
  STREAM_END_EVENT,
  STREAM_ERROR_EVENT,
} from './server.js'

/** Provisional stream reconnect budget; retune from operational evidence without adding config. */
export const STREAM_RESUME_MAX_ATTEMPTS = 3

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

type DaemonStreamInterruptionReason =
  | 'transport-error'
  | 'missing-terminal-frame'
  | 'daemon-unavailable'
  | 'resume-attempts-exhausted'

export class DaemonStreamInterruptedError extends Error {
  constructor(
    readonly lastEventId: number | undefined,
    readonly reason: DaemonStreamInterruptionReason,
    cause?: unknown,
  ) {
    super(
      `agent-qa daemon stream was interrupted (${reason}) before semantic completion` +
        (lastEventId === undefined ? '' : ` after event ${lastEventId}`),
      cause === undefined ? undefined : { cause },
    )
    this.name = 'DaemonStreamInterruptedError'
  }
}

type SseFrame =
  | { readonly kind: 'element'; readonly id: number; readonly value: unknown }
  | { readonly kind: 'end' }
  | { readonly kind: 'error'; readonly value: unknown }

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

function parseEventFrame(frame: string): SseFrame {
  const dataLines: string[] = []
  let id: number | undefined
  let eventName = 'message'

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
    } else if (field === 'event') {
      eventName = value
    } else if (field === 'data') {
      dataLines.push(value)
    }
  }

  if (eventName === STREAM_END_EVENT || eventName === STREAM_ERROR_EVENT) {
    if (id !== undefined) throw new Error(`Daemon ${eventName} frame must not carry an SSE id`)
    if (dataLines.length === 0) throw new Error(`Daemon ${eventName} frame is missing data`)
    const value = parseJson(dataLines.join('\n'), `agent-qa daemon ${eventName} frame`)
    return eventName === STREAM_END_EVENT
      ? { kind: 'end' }
      : { kind: 'error', value }
  }
  if (eventName !== 'message') {
    throw new Error(`Daemon stream returned an unknown SSE event: ${eventName}`)
  }
  if (id === undefined) throw new Error('Daemon stream event is missing its SSE id')
  if (dataLines.length === 0) throw new Error(`Daemon stream event ${id} is missing data`)
  return {
    kind: 'element',
    id,
    value: parseJson(dataLines.join('\n'), `agent-qa daemon stream event ${id}`),
  }
}

async function* readEventStream(response: IncomingMessage): AsyncIterable<{
  readonly id: number
  readonly value: unknown
}> {
  response.setEncoding('utf8')
  const iterator = response[Symbol.asyncIterator]()
  let buffer = ''
  let lastEventId: number | undefined
  let terminalSeen = false

  while (true) {
    let next: IteratorResult<unknown>
    try {
      next = await iterator.next()
    } catch (error) {
      if (terminalSeen) return
      throw new DaemonStreamInterruptedError(lastEventId, 'transport-error', error)
    }
    if (next.done) break

    buffer = `${buffer}${String(next.value)}`.replaceAll('\r\n', '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      if (frame.length > 0) {
        const parsed = parseEventFrame(frame)
        if (terminalSeen) throw new Error('Daemon stream emitted a frame after stream-end')
        if (parsed.kind === 'end') {
          terminalSeen = true
        } else if (parsed.kind === 'error') {
          throw rehydrateFunctionError(parsed.value, 500)
        } else {
          lastEventId = parsed.id
          yield parsed
        }
      }
      boundary = buffer.indexOf('\n\n')
    }
  }

  if (buffer.length > 0) {
    throw new DaemonStreamInterruptedError(lastEventId, 'transport-error')
  }
  if (!terminalSeen) {
    throw new DaemonStreamInterruptedError(lastEventId, 'missing-terminal-frame')
  }
}

function resumeInput(input: unknown, lastEventId: number | undefined): unknown {
  if (lastEventId === undefined) return input
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
  agentQaRoot: string,
  functionId: string,
  input: unknown,
): AsyncIterable<unknown> {
  let response = firstResponse
  let lastEventId: number | undefined
  let resumeAttempts = 0

  while (true) {
    try {
      for await (const element of readEventStream(response)) {
        lastEventId = element.id
        yield element.value
      }
      return
    } catch (error) {
      if (!(error instanceof DaemonStreamInterruptedError)) throw error
      lastEventId = error.lastEventId ?? lastEventId
      if (resumeAttempts >= STREAM_RESUME_MAX_ATTEMPTS) {
        throw new DaemonStreamInterruptedError(
          lastEventId,
          'resume-attempts-exhausted',
          error,
        )
      }
    }

    resumeAttempts += 1
    let registration: DaemonRegistration
    try {
      registration = requireLiveRegistration(agentQaRoot)
      response = await openInvokeResponse(
        registration,
        functionId,
        resumeInput(input, lastEventId),
      )
    } catch (error) {
      throw new DaemonStreamInterruptedError(lastEventId, 'daemon-unavailable', error)
    }
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
      options.agentQaRoot,
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
