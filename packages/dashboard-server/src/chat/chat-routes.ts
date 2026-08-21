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
// THE TURN-EVENTS STREAM IS A PROJECTION OF THE LOG, NEVER A SECOND PRODUCER (D-03). Every frame
// `GET /api/chat/sessions/:id/events` emits was appended to that session's own JSONL file BEFORE
// this process was told about it, so the durable truth and the push can disagree only by the file
// being wrong. The buffer that makes reconnect replay possible is a bounded window over the same
// records — it answers "what did I miss", never "what happened", which is the log's question.

import type { IncomingMessage, ServerResponse } from 'node:http'

import type { AgentAskResult, ChatSessionEvent } from '@vostride/agent-qa-schema'
import { z } from 'zod'

import { readJsonBody } from '../server/body-parser.js'
import type { AgentHost, ChatTurnFold, ChatTurnResponse } from './host.js'

/** Every path this door owns, so the router can hand it a prefix and nothing else. */
export const CHAT_ROUTE_PREFIX = '/api/chat/'

export const CHAT_TURN_ROUTE = '/api/chat/turn'
export const CHAT_CAPABILITIES_ROUTE = '/api/chat/capabilities'

/** `/api/chat/sessions/<id>/events` — the one streaming path, matched rather than parsed. */
const CHAT_SESSION_EVENTS_PATTERN = /^\/api\/chat\/sessions\/([^/]+)\/events$/

/**
 * How many events one session's replay window holds (T-400-04).
 *
 * BOUNDED, and the bound is the point rather than the number. A window that grew with the
 * conversation would let a long-lived server accumulate every event of every session it has ever
 * served, in memory, for the sake of a reconnect nobody may ever make. What a reconnect actually
 * needs is the gap since the client's last acknowledged id, and a turn's worth of events is two
 * orders of magnitude below this. A client that fell further behind than the window gets what the
 * window holds — and its remedy is the durable log, which is where the whole conversation lives.
 */
const CHAT_STREAM_REPLAY_LIMIT = 512

/**
 * How many sessions this server keeps a replay window for (T-400-04).
 *
 * The second bound, and it is a different hazard from the first: one session cannot grow without
 * limit, but a process serving a person all day accumulates SESSIONS. Least-recently-appended is
 * evicted, which is the right direction — the window exists for a browser that is watching, and a
 * session nobody has appended to in a while has no watcher to serve.
 */
const CHAT_STREAM_SESSION_LIMIT = 32

/** The heartbeat interval, in the shipped run-events stream's own spelling. */
const CHAT_STREAM_HEARTBEAT_MS = 15_000

/** One buffered event, with the id a client acknowledges it by. */
interface StreamedSessionEvent {
  readonly id: number
  readonly event: ChatSessionEvent
}

/**
 * The bounded replay window and the live subscriber set, for one server.
 *
 * IDS ARE PER SESSION AND ASSIGNED AT APPEND, so they are the append ORDER made addressable — the
 * only currency `Last-Event-ID` can be spent in. They are not the log's own line numbers and must
 * not be mistaken for them: a client acknowledges what it has seen on THIS stream.
 */
export interface SessionStreamWindow {
  readonly events: StreamedSessionEvent[]
  nextId: number
}

/**
 * Record one appended event into its session's window, enforcing BOTH bounds (T-400-04).
 *
 * EXTRACTED AND EXPORTED so the bounds can be DRIVEN rather than asserted about. A cap enforced
 * inside a closure is only reachable by a cell willing to post five hundred turns, which is a cell
 * nobody runs — and a source assertion that a constant exists says nothing about whether anything
 * applies it (measured: removing the enforcement left every behavioural cell green). This function
 * is pure over its map, total, and synchronous, so a control cell drives six hundred synthetic
 * events in a millisecond and the eviction is a fact rather than a comment.
 *
 * The map's ITERATION ORDER is the eviction order, and the delete-then-set is what maintains it:
 * `Map` preserves insertion order, so re-inserting a session on every append makes the first key
 * the least-recently-APPENDED one. A plain `set` on an existing key would not move it, and the
 * eviction would then throw away whichever session was created first — including the one somebody
 * is watching right now.
 */
export function recordStreamedEvent(
  windows: Map<string, SessionStreamWindow>,
  sessionId: string,
  event: ChatSessionEvent,
): StreamedSessionEvent {
  let window = windows.get(sessionId)
  if (window === undefined) {
    window = { events: [], nextId: 1 }
  } else {
    windows.delete(sessionId)
  }
  windows.set(sessionId, window)
  const entry: StreamedSessionEvent = { id: window.nextId, event }
  window.nextId += 1
  window.events.push(entry)
  // Both bounds are enforced on the WRITE rather than trusted to a reader: a reader that trimmed
  // would have held the memory already, which is the whole of what the bound is for.
  while (window.events.length > CHAT_STREAM_REPLAY_LIMIT) window.events.shift()
  while (windows.size > CHAT_STREAM_SESSION_LIMIT) {
    const oldest = windows.keys().next()
    if (oldest.done === true) break
    windows.delete(oldest.value)
  }
  return entry
}

/** The two bounds, published so a cell can state them without re-spelling a number. */
export const CHAT_STREAM_BOUNDS = Object.freeze({
  replayLimit: CHAT_STREAM_REPLAY_LIMIT,
  sessionLimit: CHAT_STREAM_SESSION_LIMIT,
})

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
 * The door's request handler, plus one read about itself.
 *
 * `openStreamCount` is a DIAGNOSTIC and not a capability: it answers how many SSE connections this
 * router is holding open right now and nothing else — no identity, no content, no control. It is on
 * the returned handler because an abandoned stream's listener and heartbeat are invisible from
 * outside the process (T-400-04), so without it the teardown below would be an untested claim, and
 * an untested teardown is the leak.
 */
export interface ChatRouter {
  (req: IncomingMessage, res: ServerResponse): void
  openStreamCount(): number
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
 *
 * IT SUBSCRIBES ONCE, AT CONSTRUCTION, and every stream it serves reads the window that
 * subscription fills. One subscription per server rather than one per connection: a window filled
 * per connection would start empty, so a browser reconnecting after a dropped socket would be told
 * the turn it missed never happened.
 */
export function createChatRouter(host: AgentHost | undefined): ChatRouter {
  // The bounded replay windows, keyed by session, filled by the door's ONE subscription to the
  // append path. Insertion order is least-recently-created first, which is what makes the eviction
  // below a plain `keys().next()`; re-inserting on append keeps it least-recently-APPENDED.
  const windows = new Map<string, SessionStreamWindow>()
  /** Every live stream, so a frame reaches whoever is watching and a close removes exactly one. */
  const streams = new Set<(entry: StreamedSessionEvent, sessionId: string) => void>()

  host?.onSessionEvent((sessionId, event) => {
    const entry = recordStreamedEvent(windows, sessionId, event)
    for (const write of [...streams]) write(entry, sessionId)
  })

  function handleSessionEvents(sessionId: string, req: IncomingMessage, res: ServerResponse): void {
    // The shipped SSE idiom (`routes.ts`'s run-events stream), with ONE deliberate omission: no
    // `Access-Control-Allow-Origin`. That header is on the run stream because it predates this
    // door's posture; a chat transcript is a person's conversation with their own agent, and a
    // wildcard here would let any page they have open read it.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    res.write(':ok\n\n')

    const frame = (entry: StreamedSessionEvent): void => {
      // The event is written AS PERSISTED — masked. `unmaskForHumanOutput` runs exactly once, at
      // each surface's own display boundary, and for this door that is the browser's render.
      res.write(
        `id: ${String(entry.id)}\n`
        + `event: ${entry.event.kind}\n`
        + `data: ${JSON.stringify(entry.event)}\n\n`,
      )
    }

    // REPLAY FIRST, then subscribe, and in that order for a reason: a subscription taken before
    // the replay would deliver a concurrently appended event twice, and one taken after a slow
    // replay would miss it. Both halves read the same window under one synchronous turn of the
    // loop, so no append can land between them.
    const lastEventId = req.headers['last-event-id']
    const since = typeof lastEventId === 'string' ? Number.parseInt(lastEventId, 10) : Number.NaN
    const window = windows.get(sessionId)
    for (const entry of window?.events ?? []) {
      if (Number.isInteger(since) && entry.id <= since) continue
      frame(entry)
    }

    const write = (entry: StreamedSessionEvent, eventSessionId: string): void => {
      if (eventSessionId !== sessionId) return
      frame(entry)
    }
    streams.add(write)

    const heartbeat = setInterval(() => {
      res.write(':\n\n')
    }, CHAT_STREAM_HEARTBEAT_MS)
    // `unref` so an open stream cannot hold a process alive past its work — the interval exists to
    // keep a proxy from reaping an idle socket, which is not a reason to keep node running.
    heartbeat.unref?.()

    // TEARDOWN IS THE WHOLE OF T-400-04's OTHER HALF. A browser tab closes, a laptop sleeps, a
    // reverse proxy drops the socket — and every one of those leaves a listener and a 15s timer
    // behind unless this fires. Both are released together because they were taken together.
    req.on('close', () => {
      clearInterval(heartbeat)
      streams.delete(write)
    })
  }

  const router = (req: IncomingMessage, res: ServerResponse): void => {
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

    const streaming = CHAT_SESSION_EVENTS_PATTERN.exec(path)
    if (streaming !== null && req.method === 'GET') {
      handleSessionEvents(decodeURIComponent(streaming[1]!), req, res)
      return
    }

    refuse(res, 'Not found', 404)
  }

  router.openStreamCount = (): number => streams.size
  return router as ChatRouter
}
