// The run-detail READ route (Phase 405 plan 01, D-03).
//
// `GET /api/runs/:id/detail` is what the rebuilt run-detail page reads, and this module is the
// whole of the HTTP half: validate the id with the OP'S OWN input schema, dispatch through the
// injected host, map the op's named refusals onto status codes. It formats nothing. It opens no
// database. There is no SQLite read in `routes.ts` for this arm and there must never be one —
// that was the shipped v1 arrangement, and a private store read is a capability the function
// layer cannot see, cannot audit and cannot offer to the CLI, MCP or chat (D-03, the fourth-door
// law of 404 D-16).
//
// EVERY REFUSAL IS NAMED, on `post-processing-routes.ts`'s measured precedent. A page unable to
// distinguish an unrecorded run and a composition that binds no run-detail port renders one grey
// error for two completely different operator actions. Names are read STRUCTURALLY off
// `error.name` because this package may not import the packages that mint those classes
// (validate:arch), and comparing messages would be comparing against prose somebody will rewrite.

import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  RunsDetailInputSchema,
  type RunDetailProjection,
} from '@vostride/agent-qa-schema'

import type { AgentHost } from '../chat/host.js'

/** A refusal, already carrying its status and its single-key body. */
interface RunDetailRefusal {
  readonly kind: 'refused'
  readonly status: number
  readonly body: Record<string, string>
}

export type RunDetailReadOutcome =
  | { readonly kind: 'ok'; readonly body: RunDetailProjection }
  | RunDetailRefusal

/** The name a rejection carries, read structurally — never by class, never by message. */
function errorNameOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'UnknownError'
  const name = (error as { name?: unknown }).name
  return typeof name === 'string' && name.length > 0 ? name : 'UnknownError'
}

function errorMessageOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return ''
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' ? message : ''
}

/**
 * The op's refusals, classified into this door's vocabulary.
 *
 * `FunctionNotBoundError` CARRIES ITS MESSAGE because that text tells an operator what to do —
 * which op this host does not bind. `RunNotFoundError` does NOT: it would echo the requested id
 * back into a response body, and a refusal that quotes untrusted input is a reflection this door
 * has no reason to offer. Anything else is an unclassified throw from inside the store, whose
 * message may name a path or quote a row; that one travels as a NAME, which is a classification
 * rather than a disclosure.
 */
function refusalFor(error: unknown): RunDetailRefusal {
  const name = errorNameOf(error)
  if (name === 'RunNotFoundError') {
    return { kind: 'refused', status: 404, body: { error: 'unknown_run' } }
  }
  if (name === 'FunctionNotBoundError') {
    return {
      kind: 'refused',
      status: 503,
      body: { error: 'agent_host_unavailable', reason: errorMessageOf(error) },
    }
  }
  return { kind: 'refused', status: 500, body: { error: 'read_failed', reason: name } }
}

/**
 * THE READ. Exported so a cell can measure the outcome without a socket, and so any second door
 * (405-05's authed remote row) answers with byte-identical bytes by CALLING this rather than by a
 * second spelling that agrees today.
 */
export async function readRunDetail(
  host: AgentHost,
  runId: string,
): Promise<RunDetailReadOutcome> {
  // THE ID IS VALIDATED BY THE OP'S OWN INPUT SCHEMA, HERE, BEFORE THE DOOR IS TOUCHED
  // (T-405-01). Not a second regex: `runIdSchema` refuses exactly the ids the path layer would
  // have to REWRITE before using them, and the whole point of that codec is that there is one of
  // it. Refusing early also means an untrusted path segment never reaches a dispatch at all.
  const parsed = RunsDetailInputSchema.safeParse({ runId })
  if (!parsed.success) {
    return { kind: 'refused', status: 400, body: { error: 'invalid_run_id' } }
  }

  try {
    const projection = await host.invokeFunction(
      host.registry,
      host.runsDetailFunctionId,
      parsed.data,
      host.caller,
    ) as RunDetailProjection
    return { kind: 'ok', body: projection }
  } catch (error) {
    return refusalFor(error)
  }
}

function respondJson(res: ServerResponse, status: number, data: unknown): void {
  if (res.headersSent || res.writableEnded) {
    res.destroy()
    return
  }
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

export interface RunDetailReadDeps {
  /** The DECODED run id. Decoding can throw, and that throw is the caller's refusal to answer. */
  readonly runId: string
  /** The injected host. Its absence is the ROUTER'S 503, not this function's. */
  readonly host: AgentHost
}

/** `GET /api/runs/:id/detail` — what the rebuilt run-detail page reads (D-03). */
export function serveRunDetailRead(
  _req: IncomingMessage,
  res: ServerResponse,
  deps: RunDetailReadDeps,
): void {
  void readRunDetail(deps.host, deps.runId).then(
    (outcome) => {
      if (outcome.kind === 'refused') {
        respondJson(res, outcome.status, outcome.body)
        return
      }
      respondJson(res, 200, outcome.body)
    },
    // The read classifies every refusal it can name; anything reaching here is this module
    // failing, which is a 500 by name and never a body that looks like an answer.
    (error: unknown) => { respondJson(res, 500, refusalFor(error).body) },
  )
}
