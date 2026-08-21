// The fourth door's HTTP surface (Phase 400 plan 01, DASH-01 / D-02 / D-03).
//
// ONE ROUTE THAT DISPATCHES, ONE THAT LISTS. `POST /api/chat/turn` turns a browser-shaped request
// into exactly one `invokeFunction(agent.ask, …)` — the same single call `agent-qa chat` makes for
// every line a person types — and answers with the typed result the op returned. `GET
// /api/chat/capabilities` says what this door reaches. There is no third route and there must never
// be a per-capability one: `/api/chat/run-test` would be a bespoke handler with no roster row, no
// gate wall measured over it and no parity claim about it, which is 397 D-03 by name.
//
// STATUS COMES FROM THE CLASSIFIER, NEVER FROM THE TRANSPORT (DASH-01, 399.1 D-01..D-03). A turn
// that refused every clause is a 200 carrying receipts whose `status` the per-op classifier folds
// decided. Deriving a receipt status from an HTTP code or from throw-vs-return would put the
// door's own opinion where the classifier's answer belongs, and would make `refused` — a first-class
// outcome meaning the control worked — indistinguishable from `failed`. The only non-200s here are
// the ones that exist BEFORE a turn: a malformed body, an absent host, an unknown path.
//
// NO WILDCARD ORIGIN ON THE MUTATING ROUTE. `routes.ts`'s shared `json()` helper sets
// `Access-Control-Allow-Origin: *` on every response it writes, and the SSE stream sets it too.
// That is a read-idiom and it does not belong on a route that starts work: a wildcard here invites
// any page a person has open to drive their local agent. This file therefore writes its own JSON
// responder rather than importing that one, and the tracer cell asserts the header's ABSENCE — the
// real authz story is Phase 402's, and this is the part of it 400 must not make harder.
//
// THE TURN-EVENTS STREAM ARRIVES IN THIS PLAN'S THIRD TASK (D-03) and lands in this file beside the
// two routes below. Its law is recorded here now so the shape is not re-decided later: the session
// event log stays the SINGLE producer and the stream is a bounded projection of what was appended
// to it, never a parallel in-memory bus free to drift from the durable truth.

import type { IncomingMessage, ServerResponse } from 'node:http'

import type { AgentAskResult } from '@vostride/agent-qa-schema'
import { z } from 'zod'

import { readJsonBody } from '../server/body-parser.js'
import type { AgentHost, ChatTurnFold, ChatTurnResponse } from './host.js'

/** Every path this door owns, so the router can hand it a prefix and nothing else. */
export const CHAT_ROUTE_PREFIX = '/api/chat/'

export const CHAT_TURN_ROUTE = '/api/chat/turn'
export const CHAT_CAPABILITIES_ROUTE = '/api/chat/capabilities'

/**
 * The turn request, validated before anything is minted (T-400-01).
 *
 * The SAME two fields `AgentAskInputSchema` declares, checked here as well as there. That is not a
 * duplicated contract: this one refuses a browser's bytes at the door with a 400 a person's client
 * can act on, before a turn id is minted or a session file is touched, and the op's own schema is
 * what governs the call. `.strict()` so an unknown field is a refusal rather than a silently
 * dropped one — a client sending `{message, scope}` should learn that this door has no `scope`.
 */
const ChatTurnRequestSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().min(1).optional(),
}).strict()

/**
 * JSON, WITHOUT the cross-origin wildcard `routes.ts`'s helper writes.
 *
 * Deliberately a second responder rather than a parameter on the shared one. A flag would make the
 * safe posture opt-in at a seam where every future route author has to remember it; a separate
 * function makes the wildcard something a chat route would have to import to acquire.
 */
function jsonSameOrigin(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** Everything the door answers when it cannot answer. */
function refuse(res: ServerResponse, error: string, status: number): void {
  jsonSameOrigin(res, { error }, status)
}

async function handleTurn(host: AgentHost, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown
  try {
    body = await readJsonBody<unknown>(req)
  } catch {
    refuse(res, 'Invalid request body', 400)
    return
  }

  const parsed = ChatTurnRequestSchema.safeParse(body)
  if (!parsed.success) {
    refuse(res, 'Invalid request body', 400)
    return
  }

  // The op id is SUPPLIED by the composition, never spelled here: a literal `'agent.ask'` in this
  // file would be a second spelling of an id that already has exactly one.
  const AGENT_ASK_FUNCTION_ID = host.agentAskFunctionId

  let result: AgentAskResult
  try {
    result = await host.invokeFunction(
      host.registry,
      AGENT_ASK_FUNCTION_ID,
      parsed.data.sessionId === undefined
        ? { message: parsed.data.message }
        : { message: parsed.data.message, sessionId: parsed.data.sessionId },
      host.caller,
    ) as AgentAskResult
  } catch (error) {
    // A THROW HERE IS NOT A REFUSAL AND IS NOT REPORTED AS ONE. Every refusal this product can
    // express — a scope short, a gate denial, a pin, an unknown op — comes BACK as a turn whose
    // receipts carry a classifier-derived status, on a 200. So anything that arrives here is the
    // turn machinery itself failing, which is a 500 by name and carries no receipt at all: a
    // fabricated `refused` receipt would be this file inventing a verdict nobody reached.
    refuse(
      res,
      `The turn could not be carried out [${error instanceof Error ? error.name : 'Error'}]`,
      500,
    )
    return
  }

  // Folded server-side and shipped BESIDE the payloads, one entry per executed clause in the order
  // the clauses ran. The fold needs the registry, which lives in this process and not in the
  // browser; re-deriving it client-side would be a second classifier.
  const folds: ChatTurnFold[] = result.results.map((clause) => ({
    functionId: clause.functionId,
    ...host.foldFunctionResult(host.registry, clause.functionId, clause.payload),
  }))

  const response: ChatTurnResponse = { result, folds }
  jsonSameOrigin(res, response)
}

function handleCapabilities(host: AgentHost, res: ServerResponse): void {
  // Read off the door's OWN registry under the door's OWN caller, which is what makes a listing
  // taken through this route a fact about the door rather than about whoever asked.
  const ops = host.listDeclarations(host.registry, host.caller).map((row) => ({ id: row.id }))
  jsonSameOrigin(res, { ops })
}

/**
 * The chat door's router: total over its own prefix, and never anything else.
 *
 * TOTAL BY DESIGN. It answers 404 for an unrecognised `/api/chat/*` path rather than falling
 * through, because the fall-through it would land in is `routes.ts`'s shared `notFound`, which
 * writes the wildcard origin header this door's whole first paragraph is about.
 *
 * The absent-host arm is a 501 rather than a 404, on the idiom every optional dependency in
 * `routes.ts` already uses: the route EXISTS, this server was simply started without an agent host
 * (a bare `createRouter(db)`, or a dashboard embedded somewhere that composes none). "Not
 * implemented here" and "no such path" are different facts and a client can act on the difference.
 */
export function createChatRouter(
  host: AgentHost | undefined,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname

    // The door answers its OWN preflight, and the answer carries no `Access-Control-Allow-Origin`
    // at all. The shared `cors()` helper grants `*`, which would hand any page a person has open
    // the permission it needs to POST a turn at their local agent — the precise thing the turn
    // route's own missing header is there to withhold. 204 with no grant is a preflight a
    // cross-origin caller cannot use and a same-origin one never needs.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Content-Length': 0 })
      res.end()
      return
    }

    if (host === undefined) {
      refuse(res, 'Chat is not available: this server was started without an agent host', 501)
      return
    }

    if (path === CHAT_TURN_ROUTE && req.method === 'POST') {
      void handleTurn(host, req, res)
      return
    }

    if (path === CHAT_CAPABILITIES_ROUTE && req.method === 'GET') {
      handleCapabilities(host, res)
      return
    }

    refuse(res, 'Not found', 404)
  }
}
