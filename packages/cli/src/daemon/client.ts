import { request } from 'node:http'

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

function remoteError(value: unknown, statusCode: number): Error {
  const wire = value as WireError
  const error = new Error(
    typeof wire?.message === 'string' ? wire.message : `Daemon invocation failed (${statusCode})`,
  )
  error.name = typeof wire?.name === 'string' ? wire.name : 'DaemonInvokeError'
  return error
}

/** Invoke through the socket path recorded by the live registration; never recompute discovery. */
export async function invokeViaDaemon(options: InvokeViaDaemonOptions): Promise<unknown> {
  const registration = requireLiveRegistration(options.agentQaRoot)
  const body = JSON.stringify({
    schemaVersion: INVOKE_ENVELOPE_SCHEMA_VERSION,
    functionId: options.functionId,
    input: options.input,
  })

  return new Promise<unknown>((resolveInvoke, rejectInvoke) => {
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
      (response) => {
        response.setEncoding('utf8')
        let text = ''
        response.on('data', (chunk: string) => {
          text += chunk
        })
        response.once('error', rejectInvoke)
        response.once('end', () => {
          const statusCode = response.statusCode ?? 500
          try {
            const parsed = parseJson(text, 'agent-qa daemon')
            if (statusCode < 200 || statusCode >= 300) {
              rejectInvoke(remoteError(parsed, statusCode))
              return
            }
            resolveInvoke(parsed)
          } catch (error) {
            rejectInvoke(error)
          }
        })
      },
    )
    outgoing.once('error', (error) => {
      rejectInvoke(new DaemonNotRunningError('unreachable', error.message))
    })
    outgoing.end(body)
  })
}
